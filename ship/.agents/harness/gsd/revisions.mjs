// Revision hashes (GSDC-28, INV-39) and attempt records (GSDC-30): a changed owner input invalidates what was
// built on it, a code change alone is only reported; an attempt is recorded before its agent is dispatched.
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic, readJsonIf } from "../lib/io.mjs";
import { sha256, textDigest } from "../lib/hash.mjs";
import { markerDigest } from "./validation-strategy.mjs";
import { done, fail, none, nowIso, readIf, rel, withFileLock } from "./common.mjs";
import { loadAgentDef } from "../runtime/agents.mjs";
import { isInside } from "../lib/paths.mjs";
import { headOf } from "./git.mjs";
import { phaseFile, planPath, planIds, readPlan } from "./planning.mjs";
import { manifestFreezeText } from "./contracts.mjs";
import { loadRequirements } from "./requirements.mjs";
import { loadRoadmap, roadmapPhase, sectionContent } from "./roadmap.mjs";

const RESEARCHER = "gsd-phase-researcher";
export const RESEARCH_FRAGMENT = ".agents/gsd/upstream/capabilities/research/fragments/plan-pre.md";
export const FIXED_KEYS = new Set(["research", "inputs", "freeze", "skeleton", "plans", "checked", "checkedbody", "handoff"]);

// Kit feedback 76: a plan's content without the write sets (`owns`, `files_modified`), so a recheck can tell an edit of the write sets from an
// edit of what the plan says. A plan whose frontmatter does not parse is its whole text.
function planContent(phase, id) {
  const p = readPlan(phase, id);
  if (!p) return null;
  if (p.error) return p.text;
  const { owns, files_modified, ...rest } = p.fm;
  return JSON.stringify([rest, p.body]);
}

// An agent's effective role text: its definition plus every include, resolved as prompt assembly resolves
// them, so an edited or added include changes the research revision (INV-22). A definition that does not load
// (missing include) still hashes its own text, which lists the includes.
function roleFiles(g, type) {
  const agent = `.agents/agents/${type}.md`;
  try {
    return [agent, ...loadAgentDef(g.harnessRoot, type).includes.map((i) => i.rel)];
  } catch {
    return [agent];
  }
}

const backticked = (text) => [...String(text ?? "").matchAll(/`([^`\s]+)`/g)].map((m) => m[1]).filter((p) => /[/.]/.test(p) && !/^https?:/.test(p));

// The research report without its bookkeeping: the attempt key and the completion marker that carries it change on
// every run, the findings do not.
const reportContent = (text) => text?.replace(/^attempt_key:[^\r\n]*\r?\n?/gm, "").replace(/^<!-- gsd:research-complete\b[^\r\n]*-->\r?\n?/gm, "") ?? null;

// The files of one key: `{label, abs, inside}` entries, or `{label, text}` for content derived from a file (null when the
// file is missing); harness files (role text) are read from the invoking checkout. A code file outside the code root
// (`inside` false) is left out of the hash, so an edit there cannot change it.
export function keyFiles(g, phase, key) {
  const code = (p) => {
    const abs = path.resolve(g.codeRoot, p);
    return { label: p, abs, inside: isInside(abs, g.codeRoot) };
  };
  const harness = (p) => ({ label: `harness:${p}`, abs: path.resolve(g.harnessRoot, p) });
  const inPhase = (name) => code(rel(g.codeRoot, path.join(phase.dir, name)));
  const research = () => {
    const ctxFile = phaseFile(phase, "CONTEXT.md");
    const out = [inPhase(`${phase.padded}-CONTEXT.md`), code(".planning/PROJECT.md")];
    const roadmapEntry = roadmapPhase(loadRoadmap(g.codeRoot, g.cfg), phase.number);
    const reqs = loadRequirements(g.codeRoot);
    // The phase's own requirement entries, not the whole REQUIREMENTS.md: another phase's entry or a formatting edit is no input.
    for (const id of roadmapEntry?.requirements ?? []) {
      const req = reqs.map.get(id);
      out.push({ label: `requirement:${id}`, text: req ? JSON.stringify([req.text, req.spec]) : null });
      if (req?.spec) out.push(code(req.spec.replace(/^`|`$/g, "")));
    }
    const refs = /<canonical_refs>([\s\S]*?)<\/canonical_refs>/.exec(readIf(ctxFile) ?? "")?.[1];
    for (const p of backticked(refs)) out.push(code(p));
    // Owner config is hashed as written, even when it points outside the root (it may be deliberate).
    for (const p of g.cfg.adapter.instructions) out.push({ ...code(p), inside: true });
    for (const p of [...roleFiles(g, RESEARCHER), RESEARCH_FRAGMENT]) out.push(harness(p));
    return out;
  };
  const report = () => {
    const file = inPhase(`${phase.padded}-RESEARCH.md`);
    return { label: file.label, text: reportContent(readIf(file.abs)) };
  };
  const inputs = () => [...research(), report()];
  // Kit feedback 70: the strategy file the flow rendered, as the research digest it was rendered from; a hand-written file or a
  // later edit by validate-phase is no input. Only the checker's verdict (8e) depends on it, so it joins the plan keys, not inputs.
  const validation = () => {
    const file = inPhase(`${phase.padded}-VALIDATION.md`);
    const source = markerDigest(readIf(file.abs));
    return source ? [{ label: file.label, text: `validation-source ${source}` }] : [];
  };
  // Kit feedback 67: the contract-owner parts of a structured manifest (signatures, their history) are not part of the frozen skeleton's identity.
  const manifestKey = () => {
    const file = inPhase(`${phase.padded}-PLAN-OUTLINE.manifest.json`);
    const text = readIf(file.abs);
    const stable = manifestFreezeText(text);
    return stable === text ? file : { label: file.label, text: stable };
  };
  const freeze = () => [...inputs(), inPhase(`${phase.padded}-PLAN-OUTLINE.md`), manifestKey(), inPhase(`${phase.padded}-WIRING.md`)];
  // G009: the skeleton lanes (lens, model, effort, lens texts) are written by gsd-plan beside the outline; the reviewer
  // definition is hashed here, since the freeze key covers the outline and wiring only.
  const skeleton = () => [inPhase(`${phase.padded}-SKELETON-LANES.json`), ...roleFiles(g, g.cfg.adapter.agents?.skeleton_lane ?? "gsd-skeleton-reviewer").map((p) => harness(p))];
  const allPlans = () => [...freeze(), ...validation(), ...planIds(phase).map((id) => code(rel(g.codeRoot, planPath(phase, id))))];
  if (key === "research") return research();
  if (key === "inputs") return inputs();
  if (key === "freeze") return freeze();
  if (key === "skeleton") return skeleton();
  if (key === "plans" || key === "checked" || key === "handoff") return allPlans();
  if (key === "checkedbody") return [...freeze(), ...planIds(phase).map((id) => ({ label: rel(g.codeRoot, planPath(phase, id)), text: planContent(phase, id) }))];
  const m = /^plan:(.+)$/.exec(key);
  if (m) return [...freeze(), code(rel(g.codeRoot, planPath(phase, m[1])))];
  throw fail(`unknown revisions key ${key} (research, inputs, freeze, skeleton, plan:<id>, plans, checked, checkedbody, handoff)`);
}

function digestOf(entry) {
  if ("text" in entry) return entry.text === null ? "missing" : textDigest(entry.text);
  try {
    return textDigest(fs.readFileSync(entry.abs, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT" || e.code === "EISDIR") return "missing";
    throw e;
  }
}

// The digest of each part of a key, in hash order: its files (deduplicated, sorted), this phase's ROADMAP section without its
// generated block, and the settings digest. A record keeps the parts, so a check can name the part that changed (F40).
export function keyParts(g, phase, key, settings = null) {
  const seen = new Map();
  const outside = new Set();
  for (const f of keyFiles(g, phase, key)) {
    if (f.inside === false) outside.add(f.label);
    else seen.set(f.label, f);
  }
  const labels = [...seen.keys()].sort();
  const parts = labels.map((label) => [label, digestOf(seen.get(label))]);
  const section = roadmapPhase(loadRoadmap(g.codeRoot, g.cfg), phase.number)?.section ?? null;
  parts.push(["roadmap", section === null ? "missing" : textDigest(sectionContent(section))]);
  if (settings !== null) parts.push(["settings", settings]);
  const skipped = [...outside].filter((label) => !seen.has(label)).sort();
  return { parts, files: labels, skipped };
}

const hashOf = (parts) => sha256(parts.map(([label, digest]) => `${label}\0${digest}\n`).join(""));

// Hash of a key: its files (deduplicated, sorted) plus this phase's ROADMAP section without its generated block, never
// another phase's section. Files outside the code root are not hashed; they are listed in `skipped` so the caller can report them.
// A workflow passes `settings`, the digest of the effective settings its judgments of this key read (G017): a changed
// lane, role or limit then changes the key even when no file did.
export function keyHash(g, phase, key, settings = null) {
  const { parts, files, skipped } = keyParts(g, phase, key, settings);
  return { hash: hashOf(parts), files, skipped };
}

// The parts whose digest differs from the record (a removed part included); null for a record written before parts were kept.
export function changedParts(recorded, parts) {
  if (!recorded?.parts) return null;
  const now = new Map(parts);
  const was = new Map(Object.entries(recorded.parts));
  return [...new Set([...was.keys(), ...now.keys()])].filter((label) => was.get(label) !== now.get(label)).sort();
}

const revisionsFile = (phase) => path.join(phase.dir, "revisions.json");

export const readRevisions = (phase) => readJsonIf(revisionsFile(phase), null) ?? { v: 1, keys: {}, lists: {} };

// The keys the workflows check with `--settings`, by the digest they pass (gsd-plan `settingsDigest`): a record of one of them
// without a settings part never matches that check (kit feedback 73).
const settingsFamily = (key) => (key === "freeze" || key === "checked" ? key : key.startsWith("plan:") ? "plan" : null);

// The digest a record without --settings reuses: the key's previous record, else the digest the last gsd-plan run of the phase
// checked this family with (plan-progress.json, written only by its plan-run verb; kit feedback 73, 87), else the newest record of
// its family (every plan key carries the planner's digest). The digest is the workflow's, and a hand edit changes no setting, so the
// old one stays exact.
function inheritedSettings(data, key, phase) {
  const family = settingsFamily(key);
  if (family === null) return null;
  const own = data.keys[key]?.parts?.settings;
  if (own) return { digest: own, source: "previous record" };
  const run = readJsonIf(path.join(phase.dir, "plan-progress.json"), null)?.settings?.[family];
  if (typeof run === "string" && run) return { digest: run, source: "the last gsd-plan run (plan-progress.json)" };
  const sibling = Object.entries(data.keys)
    .filter(([k, v]) => k !== key && settingsFamily(k) === family && v.parts?.settings)
    .sort((a, b) => String(b[1].at).localeCompare(String(a[1].at)))[0];
  return sibling ? { digest: sibling[1].parts.settings, source: `record of ${sibling[0]}` } : null;
}

export function recordRevision(g, phase, key, settings = null) {
  const explicit = settings !== null;
  const inherited = explicit ? null : inheritedSettings(readRevisions(phase), key, phase);
  if (inherited) settings = inherited.digest;
  const warnings = [];
  if (!explicit && !inherited && settingsFamily(key) !== null) warnings.push(`${key} recorded without a settings part: the workflow checks it with --settings, so its next run counts the record changed and plans it again; pass --settings <digest> (the settings part of another ${settingsFamily(key) === "plan" ? "plan:<id>" : key} record in revisions.json) or let the flow record it`);
  const { parts, files, skipped } = keyParts(g, phase, key, settings);
  const hash = hashOf(parts);
  const head = headOf(g.codeRoot);
  const list = sha256(files.join("\n")).slice(0, 16);
  // G046: the read, merge and write of revisions.json run under one lock, so a record never replaces another's keys.
  withFileLock(`${revisionsFile(phase)}.lock`, () => {
    const data = readRevisions(phase);
    data.lists[list] = files;
    data.keys[key] = { hash, list, at: nowIso(), head, parts: Object.fromEntries(parts) };
    const used = new Set(Object.values(data.keys).map((k) => k.list));
    for (const id of Object.keys(data.lists)) if (!used.has(id)) delete data.lists[id];
    writeJsonAtomic(revisionsFile(phase), data);
  });
  return { key, hash, files: files.length, skipped, head, settings: settings === null ? null : { digest: settings, source: explicit ? "argument" : inherited.source }, ...(warnings.length ? { warnings } : {}) };
}

export function checkRevision(g, phase, key, settings = null) {
  const recorded = readRevisions(phase).keys[key];
  if (!recorded) throw none(`revisions key ${key} was never recorded`, { key });
  const { parts, skipped } = keyParts(g, phase, key, settings);
  const hash = hashOf(parts);
  const head = headOf(g.codeRoot);
  return { key, same: hash === recorded.hash, recorded: recorded.hash, current: hash, changed: changedParts(recorded, parts), skipped, headChanged: recorded.head !== head, recordedHead: recorded.head, head };
}

export function revisionsVerb(g, sub, phase, key, settings = null) {
  if (sub === "record") {
    const r = recordRevision(g, phase, need(key), settings);
    for (const w of r.warnings ?? []) g.err?.(`warning: ${w}`);
    return done(r);
  }
  if (sub === "hash") return done({ key: need(key), ...keyHash(g, phase, key, settings) });
  if (sub === "check") {
    const r = checkRevision(g, phase, need(key), settings);
    return done({ status: r.same ? "same" : "changed", ...r }, r.same ? 0 : 1);
  }
  const data = readRevisions(phase);
  if (key) {
    const k = data.keys[key];
    if (!k) throw none(`revisions key ${key} was never recorded`, { key });
    return done({ key, ...k, files: data.lists[k.list] ?? [] });
  }
  if (!Object.keys(data.keys).length) throw none("no revisions recorded");
  return done({ keys: Object.fromEntries(Object.entries(data.keys).map(([k, v]) => [k, { hash: v.hash, at: v.at, head: v.head, files: (data.lists[v.list] ?? []).length }])) });
}

const need = (key) => {
  if (!key) throw fail("revisions needs a key");
  return key;
};

// --- attempts ---

export const ATTEMPT_KINDS = new Set(["gap", "verify", "research"]);
export const attemptFile = (phase, kind) => path.join(phase.dir, `${kind}-attempt.json`);
export const attemptKey = (kind, inputDigest, runId) => sha256(`${kind}\0${inputDigest}\0${runId}`);

export const readAttempt = (phase, kind) => readJsonIf(attemptFile(phase, kind), null);

// Record (or continue) the attempt of a run; an unfinished attempt of another run is abandoned, never adopted.
export function recordAttempt(phase, kind, input) {
  if (!ATTEMPT_KINDS.has(kind)) throw fail(`--kind must be gap, verify or research`);
  const runId = String(input.runId ?? "").trim();
  const inputDigest = String(input.inputDigest ?? "").trim();
  if (!runId) throw fail("attempt record needs runId (the ph workflow run id)");
  if (!inputDigest) throw fail("attempt record needs inputDigest");
  const key = attemptKey(kind, inputDigest, runId);
  const old = readAttempt(phase, kind);
  const abandoned = [...(old?.abandoned ?? [])];
  let current;
  if (old && old.key === key) {
    current = { ...old, ...pick(input, ["before", "done", "result"]), at: nowIso() };
  } else {
    if (old && !old.done) abandoned.push({ key: old.key, runId: old.runId, inputDigest: old.inputDigest, before: old.before ?? null, at: old.at });
    current = { key, runId, inputDigest, before: input.before ?? null, done: Boolean(input.done), result: input.result ?? null, at: nowIso() };
    // O66D: what a research attempt asked for (ahead phases, full or code part, the section digests a code refresh must
    // keep) is set once; a resumed run reads it back instead of deriving it again from a report it may have rewritten.
    Object.assign(current, pick(input, ["aheadOf", "part", "base"]));
  }
  const record = { kind, ...current, abandoned: abandoned.slice(-10) };
  writeJsonAtomic(attemptFile(phase, kind), record);
  return { ...record, abandonedNow: old && old.key !== key && !old.done ? old.key : null };
}

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
