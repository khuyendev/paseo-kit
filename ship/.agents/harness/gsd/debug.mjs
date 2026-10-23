// Debug session verbs (GSDC-43): one session per failure signature under .planning/debug/, built from the
// vendored upstream DEBUG template; untrusted text is fenced in DATA_START/DATA_END and indented 4 spaces.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonIf, writeTextAtomic } from "../lib/io.mjs";
import { sha256, textDigest } from "../lib/hash.mjs";
import { pidAlive } from "../lib/proc.mjs";
import { done, fail, lf, none, nowIso, readIf, unavailable } from "./common.mjs";
import { planningDir } from "./planning.mjs";
import { frontmatter } from "./yaml.mjs";

export const DEBUG_TEMPLATE = fileURLToPath(new URL("../../gsd/upstream/gsd-core/templates/DEBUG.md", import.meta.url));
const SYMPTOM_KEYS = ["expected", "actual", "errors", "reproduction", "started"];
const GOALS = new Set(["find_and_fix", "find_root_cause_only"]);
// A checkpoint id and type are written on one line of the Checkpoints entry; one token keeps a newline from splitting it.
const CHECKPOINT_TOKEN = /^[A-Za-z0-9._:-]{1,64}$/;
const VAGUE = /^(|-|tbd|todo|none|null|n\/a|continue|continue investigating|investigate|investigate further|keep going|keep investigating|debug|look into it|\[.*\])\.?$/i;

const debugDir = (root) => path.join(planningDir(root), "debug");
const kbFile = (root) => path.join(debugDir(root), "knowledge-base.md");

// The template's file block: {statuses, body} with the upstream section skeleton.
export function loadTemplate() {
  const text = readIf(DEBUG_TEMPLATE);
  if (text === null) throw unavailable(`vendored DEBUG template missing: ${DEBUG_TEMPLATE}`);
  const block = /## File Template[\s\S]*?```markdown\n([\s\S]*?)\n```/.exec(lf(text))?.[1];
  if (!block) throw unavailable("vendored DEBUG template has no File Template block");
  const parsed = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(block);
  const statuses = /^status:\s*(.+)$/m.exec(parsed?.[1] ?? "")?.[1].split("|").map((s) => s.trim()) ?? [];
  return { statuses, body: parsed?.[2] ?? block };
}

export const dataBlock = (text) => ["    DATA_START", ...lf(String(text ?? "")).split("\n").map((l) => `    ${l}`), "    DATA_END"].join("\n");

export function slugify(label) {
  const s = String(label ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 30)
    .replace(/-+$/, "");
  return /^[a-z0-9]/.test(s) ? s : `debug-${s}`.slice(0, 30).replace(/-+$/, "");
}

// Sections by `## ` headings at column 0 (data blocks are indented, so their headings never split a section).
export function sections(body) {
  const out = new Map();
  let cur = null;
  for (const line of lf(body).split("\n")) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) out.set((cur = h[1]), []);
    else if (cur) out.get(cur).push(line);
  }
  return out;
}

const sectionText = (body, name) => (sections(body).get(name) ?? []).join("\n").trim();

// Symptoms are fenced data, so immutability is checked on each value's words: a re-wrap, indent, trailing space or
// blank line inside a value is formatting, while a changed word is a new symptom (G116).
function symptomsDigest(body) {
  const text = sectionText(body, "Symptoms");
  const values = SYMPTOM_KEYS.map((k) => {
    const value = new RegExp(`^${k}:[\\s\\S]*?DATA_START([\\s\\S]*?)DATA_END`, "m").exec(text)?.[1] ?? "";
    return `${k}: ${value.split(/\s+/).filter(Boolean).join(" ")}`;
  });
  return sha256(values.join("\n"));
}

function renderBody(tpl, symptoms) {
  const out = [];
  let cur = null;
  for (const line of lf(tpl.body).split("\n")) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      cur = h[1];
      out.push(line);
      if (cur === "Symptoms") out.push("<!-- Written during gathering, then immutable -->", "", ...SYMPTOM_KEYS.flatMap((k) => [`${k}:`, dataBlock(symptoms[k] ?? ""), ""]));
      continue;
    }
    if (cur === "Symptoms") continue;
    if (cur === "Eliminated" || cur === "Evidence") {
      if (/^\s*<!--/.test(line) || line.trim() === "") out.push(line);
      continue;
    }
    if (cur === "Current Focus") {
      const m = /^(hypothesis|test|expecting|next_action):/.exec(line);
      if (m) {
        out.push(`${m[1]}: ${m[1] === "next_action" ? "reproduce the failure from the Symptoms section and record the observed output under Evidence" : "none yet"}`);
        continue;
      }
    }
    if (cur === "Resolution") {
      const m = /^(root_cause|fix|verification|oracle_type):/.exec(line);
      if (m) {
        out.push(`${m[1]}:`);
        continue;
      }
    }
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

function renderFm(fm) {
  // Objects (budget_used, budget_reserved, budget_extension, pending_checkpoint) are written as JSON flow maps the YAML subset reads.
  const value = (v) => (Array.isArray(v) ? `[${v.map((x) => JSON.stringify(String(x))).join(", ")}]` : v === null ? "null" : typeof v === "object" ? JSON.stringify(v) : JSON.stringify(String(v)));
  const lines = Object.entries(fm).map(([k, v]) => `${k}: ${value(v)}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

const readSession = (file) => {
  const text = readIf(file);
  if (text === null) return null;
  const p = frontmatter(text);
  return { file, text, ...p };
};

const write = (file, fm, body) => writeTextAtomic(file, `${renderFm(fm)}\n${body.trimEnd()}\n`);

// Append an entry to an append-only section (Evidence, Checkpoints).
function appendTo(body, name, entry) {
  const lines = lf(body).split("\n");
  let i = lines.findIndex((l) => l.trim() === `## ${name}`);
  if (i < 0) {
    lines.push("", `## ${name}`, "");
    i = lines.length - 2;
  }
  let end = lines.findIndex((l, k) => k > i && /^##\s/.test(l));
  if (end < 0) end = lines.length;
  while (end - 1 > i && lines[end - 1].trim() === "") end--;
  lines.splice(end, 0, ...entry.split("\n"));
  return lines.join("\n");
}

const evidence = (checked, found, implication) => [`- timestamp: ${nowIso()}`, `  checked: ${checked}`, "  found:", dataBlock(found), `  implication: ${implication}`].join("\n");

const listSessions = (root) =>
  fs.existsSync(debugDir(root))
    ? fs
        .readdirSync(debugDir(root))
        .filter((n) => n.endsWith(".md") && n !== "knowledge-base.md")
        .map((n) => readSession(path.join(debugDir(root), n)))
        .filter(Boolean)
    : [];

const CREATE_LOCK_STALE_MS = 10000;
const CREATE_LOCK_WAIT_MS = 30000;
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// G112: the create scan, reopen and slug loop must not interleave with another create, or two creates for one signature
// (or one label) both pick the same file and the second write replaces the first session. Own lock file, not the
// workflow's `debug` lease: gsd-execute and gsd-quick hold that lease too. Exclusive-create like withStateLock.
function withCreateLock(root, fn) {
  fs.mkdirSync(debugDir(root), { recursive: true });
  const lock = path.join(debugDir(root), "create.lock");
  const start = Date.now();
  for (;;) {
    try {
      fs.writeFileSync(lock, `${process.pid}\n`, { flag: "wx" });
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > CREATE_LOCK_STALE_MS) fs.rmSync(lock, { force: true });
      } catch {
        // removed by its holder meanwhile
      }
      if (Date.now() - start > CREATE_LOCK_WAIT_MS) throw unavailable(`debug create lock is held (${lock}); retry`);
      pause(25 + Math.floor(Math.random() * 50));
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

export function debugCreate(g, input) {
  const sig = input?.signature;
  if (!sig?.kind || !sig?.key) throw fail("debug create needs signature {kind, key, label}");
  const goal = input.goal ?? "find_and_fix";
  if (!GOALS.has(goal)) throw fail("goal must be find_and_fix or find_root_cause_only");
  const signatureId = sha256(`${sig.kind}\0${sig.key}`);
  return withCreateLock(g.codeRoot, () => createSession(g, input, sig, goal, signatureId));
}

function createSession(g, input, sig, goal, signatureId) {
  const dir = debugDir(g.codeRoot);
  const active = listSessions(g.codeRoot).find((s) => s.fm.signature_id === signatureId && s.fm.status !== "resolved");
  if (active) {
    const body = appendTo(active.body, "Evidence", evidence("debug create", `the same failure signature was reported again: ${sig.label ?? sig.key}`, "continue this session; do not start another"));
    write(active.file, { ...active.fm, updated: nowIso() }, body);
    return done({ slug: active.fm.slug, path: rel(g, active.file), reused: true, reopened: false });
  }
  const resolvedDir = path.join(dir, "resolved");
  const old = fs.existsSync(resolvedDir) ? fs.readdirSync(resolvedDir).map((n) => readSession(path.join(resolvedDir, n))).find((s) => s?.fm.signature_id === signatureId) : null;
  if (old) {
    const target = path.join(dir, path.basename(old.file));
    const res = sections(old.body).get("Resolution")?.join("\n") ?? "";
    const body = appendTo(old.body, "Evidence", evidence("debug create (reopen)", `the failure came back after an earlier resolution:\n${res.trim()}`, "the earlier root cause or fix was incomplete; re-check it first"));
    write(target, { ...old.fm, status: "investigating", updated: nowIso() }, body);
    fs.rmSync(old.file);
    return done({ slug: old.fm.slug, path: rel(g, target), reused: true, reopened: true });
  }
  const tpl = loadTemplate();
  const base = slugify(sig.label ?? sig.key);
  let slug = base;
  for (let n = 2; fs.existsSync(path.join(dir, `${slug}.md`)) || fs.existsSync(path.join(resolvedDir, `${slug}.md`)); n++) slug = `${base.slice(0, 30 - String(n).length - 1).replace(/-+$/, "")}-${n}`;
  const body = renderBody(tpl, input.symptoms ?? {});
  const fm = {
    status: tpl.statuses[0] ?? "gathering",
    trigger: sig.label ?? sig.key,
    created: nowIso(),
    updated: nowIso(),
    slug,
    signature_kind: sig.kind,
    signature_key: sig.key,
    signature_id: signatureId,
    symptoms_hash: symptomsDigest(body),
    goal,
    owns: (input.owns ?? []).map(String),
    files: (input.files ?? []).map(String),
  };
  const file = path.join(dir, `${slug}.md`);
  write(file, fm, body);
  return done({ slug, path: rel(g, file), reused: false, reopened: false, signature_id: signatureId });
}

const rel = (g, file) => path.relative(g.codeRoot, file).split(path.sep).join("/");

function sessionFile(g, slug) {
  if (!/^[a-z0-9][a-z0-9-]{0,29}$/.test(String(slug ?? ""))) throw fail(`invalid debug slug ${slug}`);
  const file = path.join(debugDir(g.codeRoot), `${slug}.md`);
  const s = readSession(file);
  if (!s) throw none(`no active debug session ${slug}`);
  return s;
}

export function debugStatus(g, slug) {
  const s = sessionFile(g, slug);
  const problems = [];
  const tpl = loadTemplate();
  if (s.error) problems.push(`frontmatter: ${s.error}`);
  else if (!tpl.statuses.includes(s.fm.status)) problems.push(`status ${JSON.stringify(s.fm.status ?? null)} is not one of ${tpl.statuses.join(", ")}`);
  const secs = sections(s.body);
  if (!secs.has("Current Focus")) problems.push("missing ## Current Focus");
  if (!secs.has("Symptoms")) problems.push("missing ## Symptoms");
  const next = /^next_action:\s*(.*)$/m.exec((secs.get("Current Focus") ?? []).join("\n"))?.[1]?.trim() ?? "";
  if (VAGUE.test(next)) problems.push(`next_action is vague: ${JSON.stringify(next)}`);
  // Sessions created before the value digest hold the raw section digest; an untouched section still passes.
  const hash = s.fm.symptoms_hash;
  if (secs.has("Symptoms") && hash !== symptomsDigest(s.body) && hash !== textDigest(sectionText(s.body, "Symptoms"))) problems.push("Symptoms changed since create (they are immutable)");
  const json = { slug, path: rel(g, s.file), status: s.fm.status ?? null, goal: s.fm.goal ?? null, next_action: next, sections: [...secs.keys()], frontmatter: s.fm, valid: problems.length === 0, problems };
  return done(json, problems.length ? 1 : 0);
}

export function debugList(g) {
  const sessions = listSessions(g.codeRoot);
  if (!sessions.length) throw none("no active debug sessions");
  return done({ sessions: sessions.map((s) => ({ slug: s.fm.slug ?? path.basename(s.file, ".md"), status: s.fm.status ?? null, updated: s.fm.updated ?? null, trigger: s.fm.trigger ?? null, path: rel(g, s.file) })) });
}

// An owner answer or checkpoint question goes into ## Checkpoints as data, never as instructions (GSDF-65).
// Input: a checkpoint {id, type, question, options} (sets pending_checkpoint), {answered: id, response} (records the
// owner answer and clears it), or a plain {question, answer} note.
export function debugCheckpoint(g, slug, input) {
  const s = sessionFile(g, slug);
  const fm = { ...s.fm, updated: nowIso() };
  const lines = [`- at: ${nowIso()}`];
  if (input.answered !== undefined) {
    if (!CHECKPOINT_TOKEN.test(String(input.answered)) || fm.pending_checkpoint?.id !== input.answered) throw fail(`no pending checkpoint ${input.answered} in ${slug}`);
    lines.push(`  answered: ${input.answered}`, "  response:", dataBlock(input.response));
    fm.pending_checkpoint = null;
  } else if (input.id !== undefined) {
    if (!input.question) throw fail("a checkpoint needs {id, type, question, options}");
    const id = String(input.id);
    const type = String(input.type ?? "decision");
    if (!CHECKPOINT_TOKEN.test(id) || !CHECKPOINT_TOKEN.test(type)) throw fail(`checkpoint id and type must be one token of 1-64 letters, digits, . _ : - (got ${JSON.stringify(id)}, ${JSON.stringify(type)})`);
    lines.push(`  checkpoint: ${id} (${type})`, "  question:", dataBlock(input.question));
    if (Array.isArray(input.options) && input.options.length) lines.push("  options:", dataBlock(input.options.map(String).join("\n")));
    fm.pending_checkpoint = { id, type, question: String(input.question), options: (input.options ?? []).map(String) };
  } else {
    if (input.question !== undefined) lines.push("  question:", dataBlock(input.question));
    if (input.answer !== undefined) lines.push("  answer:", dataBlock(input.answer));
  }
  write(s.file, fm, appendTo(s.body, "Checkpoints", lines.join("\n")));
  return done({ slug, appended: "Checkpoints", pending_checkpoint: fm.pending_checkpoint ?? null });
}

// GSDF-67: the used turns and minutes are persisted after every turn; an owner answer never refills them.
// A reserve is a turn about to start: it stays open until a charge settles it, so an interrupted run still counts.
export function debugBudget(g, slug, input) {
  const s = sessionFile(g, slug);
  const add = (k) => {
    const n = Number(input?.[k] ?? 0);
    if (!Number.isFinite(n) || n < 0) throw fail(`debug budget ${k} must be a number >= 0`);
    return n;
  };
  const used = s.fm.budget_used ?? { turns: 0, minutes: 0 };
  const turns = add("turns");
  const budget_used = { turns: (Number(used.turns) || 0) + turns, minutes: (Number(used.minutes) || 0) + add("minutes") };
  const budget_reserved = { turns: Math.max(0, (Number(s.fm.budget_reserved?.turns) || 0) + add("reserve") - turns) };
  write(s.file, { ...s.fm, updated: nowIso(), budget_used, budget_reserved }, s.body);
  return done({ slug, budget_used, budget_reserved, budget_extension: s.fm.budget_extension ?? null });
}

// GSDF-67: the owner's extension adds turns and minutes to budget_extension; the reason is kept under ## Checkpoints.
// Refused while a run holds the code root, so the extension never races the budget writes of a running debugger.
export function debugExtend(g, slug, input) {
  const s = sessionFile(g, slug);
  const held = readJsonIf(path.join(g.codeRoot, "_workspace/locks/debug.lock"), null);
  if (held && (!Number.isInteger(held.pid) || pidAlive(held.pid))) throw fail(`${held.kind ? `a ${held.kind} run` : "another run"} holds this code root (${held.runId ?? "unknown run"}); extend after it ends`);
  const num = (k) => {
    const n = input?.[k];
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0) throw fail(`debug extend ${k} must be a number >= 0`);
    return n;
  };
  const reason = typeof input?.reason === "string" ? input.reason.trim() : "";
  if (!reason) throw fail("debug extend needs a reason");
  const turns = num("turns");
  const minutes = num("minutes");
  const prev = s.fm.budget_extension ?? {};
  const budget_extension = { turns: (Number(prev.turns) || 0) + turns, minutes: (Number(prev.minutes) || 0) + minutes, reason };
  const lines = [`- at: ${nowIso()}`, `  extended: turns +${turns}, minutes +${minutes}`, "  reason:", dataBlock(reason)];
  write(s.file, { ...s.fm, updated: nowIso(), budget_extension }, appendTo(s.body, "Checkpoints", lines.join("\n")));
  return done({ slug, budget_extension, appended: "Checkpoints" });
}

const field = (block, key) => new RegExp(`^${key}:\\s*(.*)$`, "m").exec(block)?.[1]?.trim() ?? "";

export function debugClose(g, slug, outcome, extra) {
  if (!["resolved", "diagnosed"].includes(outcome)) throw fail("--outcome must be resolved or diagnosed");
  let s = sessionFile(g, slug);
  if (extra.evidence !== undefined && extra.evidence !== null) {
    const body = appendTo(s.body, "Evidence", evidence(`debug close --outcome ${outcome}`, JSON.stringify(extra.evidence, null, 2), "verify rerun evidence (ADPT-17)"));
    write(s.file, { ...s.fm, updated: nowIso() }, body);
    s = sessionFile(g, slug);
  }
  if (outcome === "diagnosed") {
    write(s.file, { ...s.fm, updated: nowIso(), outcome: "diagnosed" }, s.body);
    return done({ slug, outcome, path: rel(g, s.file), moved: false });
  }
  const res = (sections(s.body).get("Resolution") ?? []).join("\n");
  const symptoms = sectionText(s.body, "Symptoms");
  const errors = /errors:\n\s*DATA_START\n([\s\S]*?)\n\s*DATA_END/.exec(symptoms)?.[1]?.replace(/^ {4}/gm, "").trim() ?? "";
  const files = /^files_changed:\s*(.*)$/m.exec(res)?.[1]?.trim() ?? "[]";
  const entry = [
    `## ${slug} — ${extra.summary ?? (field(res, "root_cause") || s.fm.trigger || slug)}`,
    "",
    `- Error patterns: ${errors.split("\n")[0] || "-"}`,
    `- Root cause: ${field(res, "root_cause") || "-"}`,
    `- Fix: ${field(res, "fix") || "-"}`,
    `- Files changed: ${files}`,
    `- Why not caught: ${extra.why ?? "-"}`,
    `- Recurrence guard: ${extra.guard ?? "-"}`,
    "",
  ].join("\n");
  const kb = readIf(kbFile(g.codeRoot)) ?? "# Debug knowledge base\n\n";
  writeTextAtomic(kbFile(g.codeRoot), `${kb.trimEnd()}\n\n${entry}`);
  const target = path.join(debugDir(g.codeRoot), "resolved", `${slug}.md`);
  write(target, { ...s.fm, status: "resolved", updated: nowIso() }, s.body);
  fs.rmSync(s.file);
  return done({ slug, outcome, path: rel(g, target), moved: true, knowledge_base: rel(g, kbFile(g.codeRoot)) });
}
