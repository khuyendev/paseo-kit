// Cross-plan contracts with one owner (kit feedback 67, 76): the outline manifest's `produces` is the only source of what a
// plan hands to another ({symbol, kind, file, signature}); plans quote it, `verify contracts` checks the quotes, a reviser changes
// it only through `contracts change` (CONTRACT_CHANGE), and the wave gate checks the produced symbols exist after execute.
import fs from "node:fs";
import path from "node:path";
import { readJsonIf, writeJsonAtomic } from "../lib/io.mjs";
import { loadConfig } from "../config.mjs";
import { matchesGlob } from "../adapter/contract.mjs";
import { asArray, done, escapeRe, fail, none, readIf, rel, withFileLock } from "./common.mjs";
import { covers, ownsPath } from "./adapter-hooks.mjs";
import { normPlanId, phaseFile, readPlans } from "./planning.mjs";

export const REQUIRE_KINDS = ["ancestor_widget", "provider_override", "registration"];

// A signature compares without whitespace, backticks or a trailing comma before a closer: the planner may wrap lines.
export const squash = (s) => String(s ?? "").replace(/[`\s]+/g, "").replace(/,(?=[)\]}>])/g, "");
const WORD = "[A-Za-z0-9_$]";
export const wordIn = (text, name) => Boolean(name) && new RegExp(`(^|[^A-Za-z0-9_$])${escapeRe(name)}(?!${WORD})`).test(String(text ?? ""));
// `DaemonClient.pause`, `DaemonClient::pause`, `DaemonClient#pause` -> `pause`
export const lastSegment = (symbol) => String(symbol ?? "").split(/[.:#]+/).filter(Boolean).at(-1) ?? "";
const str = (v) => (typeof v === "string" ? v.trim() : "");

// One element of a manifest entry's `produces`. Structured = symbol, kind, file and signature given; anything else is legacy
// free text (a string, or an object with only a symbol) that is never checked beyond a word match. `problems` lists a
// half-structured object (some of kind/file/signature missing), which outline check refuses.
export function producedOf(entry) {
  if (typeof entry === "string") return { symbol: entry.trim(), kind: null, file: null, signature: null, supersedes: [], structured: false, text: entry, problems: [] };
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return { symbol: "", kind: null, file: null, signature: null, supersedes: [], structured: false, text: "", problems: ["is not a string or an object"] };
  const e = { symbol: str(entry.symbol), kind: str(entry.kind), file: str(entry.file).replace(/\\/g, "/").replace(/^\.\//, ""), signature: str(entry.signature), supersedes: asArray(entry.supersedes).map(String) };
  // An object with a file or a signature means to be a contract and must give all of kind, file and signature; a symbol
  // (with a kind or other keys) alone is the earlier free-form entry.
  const problems = [];
  if (!e.symbol) problems.push("has no symbol");
  if ((e.file || e.signature) && !(e.kind && e.file && e.signature)) problems.push(`is missing ${["kind", "file", "signature"].filter((k) => !e[k]).join(", ")}`);
  return { ...e, structured: Boolean(e.symbol) && Boolean(e.kind && e.file && e.signature), text: JSON.stringify(entry), problems };
}
export const producesOf = (planEntry) => asArray(planEntry?.produces).map(producedOf);

// The produced entry a consumes edge names: the same symbol, a member of a structured symbol (`Client` for `Client.pause`), or a
// legacy free-text entry that holds the symbol as a word.
export function resolveEdge(produced, symbol) {
  const sym = String(symbol ?? "").trim();
  return produced.find((p) => p.structured && p.symbol === sym)
    ?? produced.find((p) => p.structured && sym.startsWith(p.symbol) && /^[.:#]/.test(sym.slice(p.symbol.length)))
    ?? produced.find((p) => !p.structured && (p.symbol === sym || wordIn(p.text, sym)))
    ?? null;
}

export function readManifest(phase) {
  const file = phaseFile(phase, "PLAN-OUTLINE.manifest.json");
  const text = readIf(file);
  if (text === null) return { file, manifest: null, error: "manifest missing" };
  try {
    const manifest = JSON.parse(text);
    if (!manifest || !Array.isArray(manifest.plans)) return { file, manifest: null, error: "manifest has no plans array" };
    return { file, manifest, error: null };
  } catch (e) {
    return { file, manifest: null, error: `manifest is not valid JSON (${e.message})` };
  }
}
const entriesOf = (manifest) => (manifest?.plans ?? []).filter((p) => p && typeof p === "object" && typeof p.id === "string");

// The manifest text the freeze key hashes. A CONTRACT_CHANGE edits `produces[*].signature`, `supersedes` and `contract_changes`
// in the manifest; those parts stay out of the frozen skeleton's identity, so the change does not stale the reviewed skeleton and
// every plan written on it. A manifest with no structured signature hashes as written (unchanged for every earlier project).
export function manifestFreezeText(text) {
  if (text === null || text === undefined) return text ?? null;
  let m;
  try { m = JSON.parse(text); } catch { return text; }
  const structured = entriesOf(m).some((p) => asArray(p.produces).some((e) => e && typeof e === "object" && typeof e.signature === "string"));
  if (!structured) return text;
  const { contract_changes: _drop, ...rest } = m;
  return JSON.stringify({ ...rest, plans: asArray(m.plans).map((p) => (p && typeof p === "object" && Array.isArray(p.produces) ? { ...p, produces: p.produces.map((e) => { if (!e || typeof e !== "object") return e; const { signature: _s, supersedes: _u, ...keep } = e; return keep; }) } : p)) });
}

// Outline check's view (outline.mjs): problems and warnings of a manifest's produces, and the consumed-symbol resolution.
export function producesProblems(entry, ownedPaths) {
  const errors = [];
  const warnings = [];
  const id = String(entry.id);
  const list = asArray(entry.produces).map(producedOf);
  const legacy = list.filter((p) => !p.structured);
  list.forEach((p, i) => {
    for (const msg of p.problems) errors.push(`${id}: produces[${i}] ${msg}`);
    if (p.structured && ownedPaths?.length && !ownedPaths.some((o) => covers(o, p.file))) errors.push(`${id}: produces ${p.symbol} at ${p.file}, which is outside its owns`);
  });
  const seen = new Set();
  for (const p of list) {
    if (p.structured && seen.has(p.symbol)) errors.push(`${id}: produces ${p.symbol} twice`);
    seen.add(p.symbol);
  }
  if (legacy.length && !legacy.every((p) => p.problems.length)) warnings.push(`${id}: produces holds ${legacy.length} free-text entr${legacy.length === 1 ? "y" : "ies"}; give {symbol, kind, file, signature} so the contract is checked`);
  return { errors, warnings };
}

// --- verify contracts ---

const planText = (plan) => plan.text;
// Kit feedback 100 F1: the plans whose planner can fix an error. A missing or wrong quotation is the quoting plan's (the consumer,
// the holder of a superseded signature), an unprovided precondition that names its provider is the provider's; an unresolved edge
// (a manifest edge) and a precondition of a later wave can be fixed on either side.
export function fixPlans(e) {
  const plans = asArray(e?.plans).length ? asArray(e.plans).map(String) : [String(e?.plan ?? "")];
  if (e?.kind === "consumer-signature" || e?.kind === "stale-signature") return plans.slice(0, 1);
  if (e?.kind === "requires-unprovided" && plans.length > 1) return plans.slice(1);
  return plans;
}
const err = (plans, kind, message, extra = {}) => ({ plan: plans[0], plans, kind, message, ...extra, fixers: fixPlans({ plans, kind }) });

// Every error names the plans it involves (`plans`) and the plans whose planner fixes it (`fixers`); the workflow routes it to those.
export function contractCheck(g, phase, { plans: only = null, complete = false } = {}) {
  const errors = [];
  const warnings = [];
  const { manifest, error } = readManifest(phase);
  const onDisk = readPlans(phase);
  const plans = new Map(onDisk.map((p) => [p.id, p]));
  const squashed = new Map(onDisk.map((p) => [p.id, squash(planText(p))]));
  const entries = new Map(entriesOf(manifest).map((p) => [String(p.id), p]));
  const checked = { plans: onDisk.length, produced: 0, consumes: 0, requires: 0 };
  const skipped = [...entries.keys()].filter((id) => !plans.has(id));
  if (complete) for (const id of skipped) errors.push(err([id], "plan-missing", `${id} is in the manifest but has no plan file`, { fix_hint: "write the plan" }));
  if (error) warnings.push(`contracts: ${error}`);
  if (error && !onDisk.length) return { passed: true, errors, warnings, checked, skipped };
  const forms = g.cfg.adapter.ownership.owns_forms;
  const hasText = (id, sig) => squashed.get(id)?.includes(squash(sig));
  const hint = "write it exactly as the manifest has it, or answer with CONTRACT_CHANGE {plan, symbol, old, new, reason} when the signature has to change (the flow then revises its consumers)";
  for (const [id, entry] of entries) {
    const plan = plans.get(id);
    const produced = producesOf(entry);
    if (plan) {
      const owned = plan.owns.map((o) => ownsPath(o, forms)).filter(Boolean);
      for (const p of produced.filter((x) => x.structured)) {
        checked.produced++;
        if (!hasText(id, p.signature)) errors.push(err([id], "producer-signature", `${id} does not write the signature of ${p.symbol} as the manifest declares it: ${p.signature}`, { symbol: p.symbol, fix_hint: hint }));
        if (owned.length && !owned.some((o) => covers(o, p.file))) errors.push(err([id], "file-outside-owns", `${id} produces ${p.symbol} at ${p.file}, which its owns do not cover`, { symbol: p.symbol, fix_hint: `add ${p.file} to the plan's owns, or answer with CONTRACT_CHANGE and ask the owner to move the symbol` }));
      }
    }
    for (const c of asArray(entry.consumes)) {
      if (!c || typeof c !== "object") continue;
      checked.consumes++;
      const producerId = String(c.plan ?? "");
      const norm = entries.has(producerId) ? producerId : normPlanId(producerId);
      const producer = entries.get(norm);
      if (!producer) { errors.push(err([id], "edge-unresolved", `${id} consumes ${c.symbol} from unknown plan ${producerId}`, { symbol: c.symbol, fix_hint: "name a plan of the outline" })); continue; }
      const all = producesOf(producer);
      const hit = resolveEdge(all, c.symbol);
      if (!hit) {
        const msg = `${id} consumes ${c.symbol} from ${norm}, which does not produce it`;
        if (all.some((p) => p.structured)) errors.push(err([id, norm], "edge-unresolved", msg, { symbol: c.symbol, fix_hint: `add ${c.symbol} to ${norm}'s produces in the manifest, or consume a symbol it produces` }));
        else warnings.push(`contracts: ${msg} (free-text produces)`);
        continue;
      }
      if (!hit.structured || !plans.has(id)) continue;
      if (!hasText(id, hit.signature)) errors.push(err([id, norm], "consumer-signature", `${id} uses ${hit.symbol} of ${norm} without quoting its signature: ${hit.signature}`, { symbol: hit.symbol, fix_hint: "quote the signature verbatim in the plan's <interfaces> block and write every call as that signature allows" }));
    }
  }
  // A superseded signature must be gone from every plan.
  for (const [id, entry] of entries) for (const p of producesOf(entry).filter((x) => x.structured && x.supersedes.length)) {
    const now = squash(p.signature);
    for (const old of p.supersedes) {
      const o = squash(old);
      if (!o || now.includes(o)) continue;
      for (const [pid, text] of squashed) if (text.includes(o)) errors.push(err([pid, ...(pid === id ? [] : [id])], "stale-signature", `${pid} still holds the superseded signature of ${p.symbol} (${old}); it is now ${p.signature}`, { symbol: p.symbol, fix_hint: `replace it with ${p.signature}` }));
    }
  }
  // 76 F1: a precondition (an ancestor widget, a provider override, a registration) is provided by a plan of the same or an earlier wave.
  const key = (x) => `${x.kind}\0${squash(x.name)}`;
  const provides = [];
  const requires = [];
  for (const plan of onDisk) for (const k of asArray(plan.fm?.must_haves?.key_links)) {
    if (!k || typeof k !== "object") continue;
    if (k.provides && typeof k.provides === "object") provides.push({ plan: plan.id, wave: plan.wave, kind: str(k.provides.kind), name: str(k.provides.name) });
    if (k.requires && typeof k.requires === "object") requires.push({ plan: plan.id, wave: plan.wave, kind: str(k.requires.kind), name: str(k.requires.name), by: str(k.requires.by) ? normPlanId(str(k.requires.by)) : null, existing: str(k.requires.existing) });
  }
  const everyPlanWritten = skipped.length === 0;
  for (const r of requires) {
    checked.requires++;
    if (!REQUIRE_KINDS.includes(r.kind) || !r.name) { errors.push(err([r.plan], "requires-invalid", `${r.plan}: a requires entry needs kind (${REQUIRE_KINDS.join(", ")}) and name`, { fix_hint: "fix the key_links entry" })); continue; }
    if (r.existing && readIf(path.join(g.codeRoot, r.existing)) !== null) continue;
    const mine = provides.filter((q) => key(q) === key(r));
    if (mine.some((q) => q.wave <= r.wave)) continue;
    const label = `${r.kind.replace("_", " ")} ${r.name}`;
    if (mine.length) {
      const later = mine.map((q) => `${q.plan} (wave ${q.wave})`).join(", ");
      errors.push(err([r.plan, ...mine.map((q) => q.plan)], "requires-later-wave", `${r.plan} (wave ${r.wave}) requires ${label}, provided only by ${later}, a later wave`, { fix_hint: "provide it in the requiring plan's wave or an earlier one, or move the requiring plan to a later wave" }));
    } else if (everyPlanWritten || complete) {
      const by = r.by && plans.has(r.by) ? [r.by] : [];
      errors.push(err([r.plan, ...by], "requires-unprovided", `${r.plan} requires ${label}, and no plan provides it${by.length ? ` (it names ${by[0]})` : ""}`, { fix_hint: `a plan of the same or an earlier wave must mount it and list a key_links entry with provides: {kind: ${r.kind}, name: ${r.name}}${r.existing ? `; ${r.existing} does not exist` : ""}` }));
    }
  }
  const scope = only ? new Set(only) : null;
  const out = scope ? errors.filter((e) => e.plans.some((p) => scope.has(p))) : errors;
  return { passed: out.length === 0, errors: out, warnings, checked, skipped };
}

export function verifyContractsVerb(g, phase, { plans, complete }) {
  const r = contractCheck(g, phase, { plans, complete });
  return done(r, r.passed ? 0 : 1);
}

// --- show and change ---

// The impact set of a reviser: the plan's manifest entry, the producer entries it consumes, and per produced symbol the consumers.
export function contractsShow(g, phase, planId) {
  const { manifest, error } = readManifest(phase);
  if (error) throw none(error);
  const entries = new Map(entriesOf(manifest).map((p) => [String(p.id), p]));
  const id = entries.has(planId) ? planId : normPlanId(planId);
  const entry = entries.get(id);
  if (!entry) throw none(`manifest has no entry for ${planId}`);
  const produces = producesOf(entry).map(({ text, problems, ...p }) => p);
  const consumers = {};
  for (const p of produces) consumers[p.symbol] = [];
  for (const [cid, e] of entries) for (const c of asArray(e.consumes)) {
    if (!c || String(c.plan) !== id && normPlanId(String(c.plan)) !== id) continue;
    const hit = resolveEdge(producesOf(entry), c.symbol);
    if (hit && consumers[hit.symbol] && !consumers[hit.symbol].includes(cid)) consumers[hit.symbol].push(cid);
  }
  const consumes = asArray(entry.consumes).filter((c) => c && typeof c === "object").map((c) => {
    const producer = entries.get(String(c.plan)) ?? entries.get(normPlanId(String(c.plan)));
    const hit = producer ? resolveEdge(producesOf(producer), c.symbol) : null;
    return { plan: String(c.plan), symbol: c.symbol, entry: hit && hit.structured ? { symbol: hit.symbol, kind: hit.kind, file: hit.file, signature: hit.signature } : null };
  });
  return done({ plan: id, produces, consumes, consumers, changes: asArray(manifest.contract_changes).filter((c) => c?.plan === id) });
}

// CONTRACT_CHANGE {plan, symbol, old, new, reason}: the one writer of a produced signature after the outline. Repeating a change
// already applied (a resumed run replays the reviser's reply) is a no-op.
export function contractsChange(g, phase, input) {
  const { file, manifest, error } = readManifest(phase);
  if (error) throw fail(`CONTRACT_CHANGE rejected: ${error}`);
  const plan = String(input?.plan ?? "");
  const symbol = str(input?.symbol);
  const [old, next, reason] = [str(input?.old), str(input?.new), str(input?.reason)];
  if (!plan || !symbol || !old || !next || !reason) throw fail("CONTRACT_CHANGE rejected: needs plan, symbol, old, new and reason");
  return withFileLock(`${file}.lock`, () => {
    const fresh = readManifest(phase).manifest;
    const entry = entriesOf(fresh).find((p) => String(p.id) === plan || normPlanId(String(p.id)) === normPlanId(plan));
    if (!entry) throw fail(`CONTRACT_CHANGE rejected: manifest has no entry for ${plan}`);
    const idx = asArray(entry.produces).findIndex((e) => producedOf(e).structured && producedOf(e).symbol === symbol);
    if (idx < 0) throw fail(`CONTRACT_CHANGE rejected: ${entry.id} produces no structured symbol ${symbol} in the manifest`);
    const cur = entry.produces[idx];
    const edges = (m) => entriesOf(m).filter((e) => asArray(e.consumes).some((c) => c && (String(c.plan) === String(entry.id) || normPlanId(String(c.plan)) === normPlanId(String(entry.id))) && resolveEdge([producedOf(cur)], c.symbol))).map((e) => String(e.id));
    const consumers = edges(fresh);
    if (squash(cur.signature) === squash(next) && asArray(cur.supersedes).some((s) => squash(s) === squash(old))) return done({ changed: false, already: true, plan: entry.id, symbol, signature: cur.signature, consumers });
    if (squash(cur.signature) !== squash(old)) throw fail(`CONTRACT_CHANGE rejected: the manifest signature of ${symbol} is ${cur.signature}, not ${old}`);
    if (squash(next) === squash(old)) throw fail("CONTRACT_CHANGE rejected: new equals old");
    entry.produces[idx] = { ...cur, signature: next, supersedes: [...new Set([...asArray(cur.supersedes), cur.signature])] };
    fresh.contract_changes = [...asArray(fresh.contract_changes), { plan: entry.id, symbol, old: cur.signature, new: next, reason }];
    writeJsonAtomic(file, fresh);
    return done({ changed: true, plan: entry.id, symbol, signature: next, old: cur.signature, consumers, manifest: rel(g.codeRoot, file) });
  });
}

// --- kit feedback 98 F1: an outline revision that changed a symbol's shape in the prose but not in the manifest ---

const IDENT = /[A-Za-z_$][A-Za-z0-9_$]*/g;
// The code of a text: its inline code spans and the lines of its fenced blocks.
function codeSpans(text) {
  const t = String(text ?? "");
  const fenced = [...t.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)].flatMap((m) => m[1].split(/\r?\n/));
  const inline = [...t.replace(/^```[^\n]*\n[\s\S]*?^```/gm, "").matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
  return [...inline, ...fenced].map((s) => s.trim()).filter(Boolean);
}
// The spans that give `symbol` a shape: the symbol (or the last segment of a qualified one, 5+ letters) before `(`, `{` or `<`.
function shapeSpans(text, symbol) {
  const seg = lastSegment(symbol);
  const names = [symbol, ...(seg !== symbol && seg.length >= 5 ? [seg] : [])].map(escapeRe).join("|");
  const re = new RegExp(`(^|[^A-Za-z0-9_$])(${names})\\s*[({<]`);
  return new Map(codeSpans(text).filter((s) => re.test(s)).map((s) => [squash(s), s]));
}
const parseManifest = (text) => { try { return entriesOf(JSON.parse(String(text ?? ""))); } catch { return null; } };

// `before` and `after` are {outline, manifest} texts around a revision. Drift: a structured produced symbol whose manifest
// signature the revision left as it was, while the revision added a code span that shapes it with a name the signature does not
// have. A new symbol, a changed signature, a removed span or a span that only reuses the signature's names is no drift.
export function contractDrift(before = {}, after = {}) {
  const [was, now] = [parseManifest(before.manifest), parseManifest(after.manifest)];
  if (!was || !now) return { drift: [], warnings: [`contract drift not checked: the manifest ${!now ? "after" : "before"} the revision is not valid JSON`] };
  const drift = [];
  for (const entry of now) for (const p of producesOf(entry).filter((x) => x.structured)) {
    const old = producesOf(was.find((e) => e.id === entry.id)).find((x) => x.structured && x.symbol === p.symbol);
    if (!old || squash(old.signature) !== squash(p.signature)) continue;
    const known = new Set([...p.signature.matchAll(IDENT)].map((m) => m[0]));
    const prior = shapeSpans(before.outline, p.symbol);
    const added = [...shapeSpans(after.outline, p.symbol)].filter(([k]) => !prior.has(k)).map(([, s]) => s);
    const names = new Set([p.symbol, lastSegment(p.symbol), ...p.symbol.split(/[.:#]+/)]);
    const spans = added.filter((s) => [...s.matchAll(IDENT)].some((m) => !names.has(m[0]) && !known.has(m[0])));
    if (spans.length) drift.push({ plan: entry.id, symbol: p.symbol, signature: p.signature, spans });
  }
  const errors = drift.map((d) => `contract drift: the outline now shapes ${d.symbol} as \`${d.spans[0]}\`, but the manifest still freezes it (${d.plan} produces) as \`${d.signature}\`; change that produces entry's signature to the new shape (add the old one to its supersedes), or write the outline's code span as the manifest signature`);
  return { drift, errors, warnings: [] };
}

// --- F5: the produced symbols after execute (called by the wave gate) ---

// A catalog signature is one key path, optionally with a `{ ... }` body of the same form. `name({{token}})` (and
// `name({{a}}, {{b}})`) is the key `name`: the placeholder marks the string, it is not a child. `a.b { c, d }` means the keys
// `a.b.c` and `a.b.d`; a plain `a.b.c` is that one path. Null when the signature is not this form (a code signature).
export function signatureKeyPaths(signature) {
  const s = String(signature ?? "").replace(/`/g, "").trim();
  if (!s) return null;
  let tokens;
  try { tokens = tokenizeSignature(s); } catch { return null; }
  try {
    const p = { tokens, i: 0 };
    const paths = parseMember(p).map((segs) => segs.join("."));
    if (p.i !== p.tokens.length || !paths.length) return null;
    return paths;
  } catch { return null; }
}

function tokenizeSignature(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (s.startsWith("{{", i)) {
      const end = s.indexOf("}}", i + 2);
      if (end < 0) throw new Error("placeholder");
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s.slice(i + 2, end).trim())) throw new Error("placeholder");
      out.push({ t: "ph" });
      i = end + 2;
      continue;
    }
    if ("{}(),.".includes(c)) { out.push({ t: c }); i++; continue; }
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
    if (!m) throw new Error("token");
    out.push({ t: "id", v: m[0] });
    i += m[0].length;
  }
  return out;
}

function parseSegment(p) {
  const tok = p.tokens[p.i];
  if (tok?.t !== "id") throw new Error("id");
  p.i++;
  if (p.tokens[p.i]?.t !== "(") return tok.v;
  p.i++;
  if (p.tokens[p.i]?.t !== "ph") throw new Error("ph");
  p.i++;
  while (p.tokens[p.i]?.t === ",") {
    p.i++;
    if (p.tokens[p.i]?.t !== "ph") throw new Error("ph");
    p.i++;
  }
  if (p.tokens[p.i]?.t !== ")") throw new Error(")");
  p.i++;
  return tok.v;
}

function parsePath(p) {
  const segs = [parseSegment(p)];
  while (p.tokens[p.i]?.t === ".") { p.i++; segs.push(parseSegment(p)); }
  return segs;
}

function parseMember(p) {
  const segs = parsePath(p);
  if (p.tokens[p.i]?.t !== "{") return [segs];
  p.i++;
  const kids = [];
  if (p.tokens[p.i]?.t !== "}") {
    kids.push(parseMember(p));
    while (p.tokens[p.i]?.t === ",") {
      p.i++;
      if (p.tokens[p.i]?.t === "}") break;
      kids.push(parseMember(p));
    }
  }
  if (p.tokens[p.i]?.t !== "}") throw new Error("brace");
  p.i++;
  return kids.flatMap((k) => k.map((path) => [...segs, ...path]));
}

const catalogGlobs = (root) => {
  try {
    const list = loadConfig(root).adapter.catalogs;
    return Array.isArray(list) ? list : [];
  } catch { return []; }
};

// `.json`, or a file the adapter names with adapter.catalogs. A bad glob matches nothing rather than failing the gate.
function isCatalog(file, globs) {
  const rel = String(file ?? "").replace(/\\/g, "/");
  if (path.posix.extname(rel).toLowerCase() === ".json") return true;
  return globs.some((g) => { try { return matchesGlob(rel, g); } catch { return false; } });
}

const parseJson = (text) => { try { return JSON.parse(String(text).replace(/^﻿/, "")); } catch { return undefined; } };

function hasKeyPath(value, keyPath) {
  let cur = value;
  for (const seg of keyPath.split(".")) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur) || !Object.hasOwn(cur, seg)) return false;
    cur = cur[seg];
  }
  return true;
}

// For each plan of `planIds` the manifest says produces structured symbols: the declared file exists and holds the symbol's last
// identifier segment as a word. The signature text is compared too, but a code form differs by language, so a textual mismatch
// is a note, not a failure. A catalog file (`.json`, or a file matching `adapter.catalogs`) whose signature is a key path is
// checked by those keys instead (kit feedback 103): a missing key is a note naming the path, and a file that holds them has no
// note. A signature that is not a key path keeps the text comparison. Returns [{plan, ok, problems, notes, symbols}].
export function producedCheck(root, phaseDir, planIdList) {
  const dir = path.resolve(root, phaseDir);
  const nn = /^(\d+(?:\.\d+)*)/.exec(path.basename(dir))?.[1];
  if (!nn) return [];
  const padded = nn.split(".").map((p, i) => (i === 0 ? String(Number(p)).padStart(2, "0") : String(Number(p)))).join(".");
  let manifest;
  try { manifest = readJsonIf(path.join(dir, `${padded}-PLAN-OUTLINE.manifest.json`), null); } catch { return []; }
  if (!manifest) return [];
  const globs = catalogGlobs(root);
  const out = [];
  for (const entry of entriesOf(manifest)) {
    if (!planIdList.includes(String(entry.id))) continue;
    const symbols = producesOf(entry).filter((p) => p.structured);
    if (!symbols.length) continue;
    const problems = [];
    const notes = [];
    for (const p of symbols) {
      let text = null;
      try { text = fs.readFileSync(path.resolve(root, p.file), "utf8"); } catch { text = null; }
      if (text === null) { problems.push(`${p.symbol}: declared file ${p.file} does not exist`); continue; }
      if (!wordIn(text, lastSegment(p.symbol))) { problems.push(`${p.symbol}: ${lastSegment(p.symbol)} is not in ${p.file}`); continue; }
      const paths = isCatalog(p.file, globs) ? signatureKeyPaths(p.signature) : null;
      if (!paths) {
        if (!squash(text).includes(squash(p.signature))) notes.push(`${p.symbol}: ${p.file} does not hold the manifest signature text (${p.signature})`);
        continue;
      }
      const json = parseJson(text);
      if (json === undefined) { notes.push(`${p.symbol}: ${p.file} is not JSON, so its key paths were not checked`); continue; }
      for (const keyPath of paths) if (!hasKeyPath(json, keyPath)) notes.push(`${p.symbol}: ${p.file} missing key path ${keyPath}`);
    }
    out.push({ plan: String(entry.id), ok: problems.length === 0, problems, notes, symbols: symbols.length });
  }
  return out;
}

