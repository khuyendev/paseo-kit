// Hand edits (kit feedback 68): what the orchestrator or the owner changed outside the flow, which the revisions only notice
// as a moved hash (and not at all after a hand `revisions record`). Each is listed with its cause category once, answered by
// `ph gsd hand-edit record`, and counted by `ph review-stats`. The log is `<phase dir>/hand-edits.json`, written only here.
// Measurement only: the run result lists the edits and the categories seen twice; no flow decision reads them.
import fs from "node:fs";
import path from "node:path";
import { readJsonIf, writeJsonAtomic } from "../lib/io.mjs";
import { sha256, textDigest } from "../lib/hash.mjs";
import { isInside } from "../lib/paths.mjs";
import { done, fail, isFile, nowIso, rel, withFileLock } from "./common.mjs";
import { CATEGORIES, HAND_EDITS_FILE, candidateLine, projectEdits, readEdits, summarize } from "../lib/hand-edit-log.mjs";
import { planPath } from "./planning.mjs";
import { FIXED_KEYS, changedParts, keyParts, readRevisions } from "./revisions.mjs";

const NOTE_MAX = 300;
// Files the flow writes for a phase: the plans and the planning artifacts its revisions keys cover. Owner inputs (CONTEXT,
// PROJECT, requirements, role text, the ROADMAP section) and settings are not hand fixes of the kit's output.
const ARTIFACT = /-(?:PLAN|PLAN-OUTLINE|WIRING|RESEARCH)\.md$|-PLAN-OUTLINE\.manifest\.json$|-SKELETON-LANES\.json$/;
const flowWritten = (g, phase, label) => label.startsWith(`${rel(g.codeRoot, phase.dir)}/`) && ARTIFACT.test(label);
const kindOf = (label) => (/-PLAN\.md$/.test(label) ? "plan" : "artifact");
const KEY_ORDER = ["inputs", "freeze", "skeleton", "plans", "checked", "handoff", "research"];
// Which key names a changed file: a plan file belongs to its `plan:<id>` key before `checked` and the rest, any other artifact to the
// fixed keys before the plan keys (every plan key also covers the outline).
const keyRank = (key, label) => ((key.startsWith("plan:") ? kindOf(label) === "plan" : kindOf(label) !== "plan") ? 0 : 1) * 100 + (key.startsWith("plan:") ? 0 : 1 + Math.max(0, KEY_ORDER.indexOf(key)));
const open = (e) => !CATEGORIES.includes(e.category);

export const handEditsFile = (phase) => path.join(phase.dir, HAND_EDITS_FILE);
const contentOf = (abs) => (isFile(abs) ? sha256(fs.readFileSync(abs)) : "deleted");
const readStore = (phase) => readEdits(handEditsFile(phase)).edits;
const nextId = (edits) => `HE-${edits.reduce((n, e) => Math.max(n, Number(/^HE-(\d+)$/.exec(e.id)?.[1] ?? 0)), 0) + 1}`;
const candidatesOf = (g) => summarize(projectEdits(g.codeRoot).edits).candidates.map(candidateLine);

// Flow-written files that differ from the record of the given revisions keys: `label -> {key, kind, digest}`.
function changedArtifacts(g, phase, keys) {
  const data = readRevisions(phase);
  const found = new Map();
  for (const key of keys) {
    const recorded = data.keys[key];
    if (!recorded) continue;
    let parts;
    try {
      parts = keyParts(g, phase, key).parts;
    } catch {
      continue;
    }
    const now = new Map(parts);
    for (const label of changedParts(recorded, parts) ?? []) {
      if (!flowWritten(g, phase, label)) continue;
      const earlier = found.get(label);
      if (!earlier || keyRank(key, label) < keyRank(earlier.key, label)) found.set(label, { key, kind: kindOf(label), digest: now.get(label) ?? "missing" });
    }
  }
  return found;
}

// Transferred owned files whose content is no longer what the transfer wrote (a transfer record names path and hash).
function changedOwned(g, phase) {
  const found = new Map();
  const dir = path.join(phase.dir, "transfers");
  if (!fs.existsSync(dir)) return found;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => [f, fs.statSync(path.join(dir, f)).mtimeMs]).sort((a, b) => a[1] - b[1]);
  const last = new Map();
  for (const [f] of files) {
    let t = null;
    try {
      t = readJsonIf(path.join(dir, f), null);
    } catch {
      continue;
    }
    for (const file of t?.files ?? []) if (typeof file?.path === "string") last.set(file.path, { plan: t.plan, sha: file.deleted ? "deleted" : file.sha256 });
  }
  for (const [p, { plan, sha }] of last) {
    const abs = path.resolve(g.codeRoot, p);
    if (!isInside(abs, g.codeRoot) || p.startsWith(".planning/") || sha === undefined) continue;
    const now = contentOf(abs);
    if (now !== sha) found.set(p, { key: `owned:${plan}`, kind: "owned", digest: now });
  }
  return found;
}

// Adds what is not in the log yet: an edit with the same file and content is known (answered or not); a file edited again
// while its earlier edit is unanswered updates that entry, so one file is one question.
function addFound(phase, found) {
  if (!found.size) return [];
  const added = [];
  withFileLock(`${handEditsFile(phase)}.lock`, () => {
    const edits = readStore(phase);
    for (const [label, { key, kind, digest }] of found) {
      if (edits.some((e) => e.files[0] === label && e.digest === digest)) continue;
      const earlier = edits.find((e) => e.files[0] === label && open(e));
      if (earlier) Object.assign(earlier, { key, kind, digest, at: nowIso() });
      else edits.push({ id: nextId(edits), key, kind, files: [label], digest, at: nowIso(), category: null, note: null });
      added.push(label);
    }
    writeJsonAtomic(handEditsFile(phase), { v: 1, edits });
  });
  return added;
}

// A hand `revisions record` (outside a workflow run: the engine sets PASEO_HARNESS_WORKFLOW_RUN for its shell calls)
// overwrites the record the change shows against, so what changed in the key's flow-written files is kept first.
export function captureBeforeRecord(g, phase, key) {
  if (!g.cfg.gsd.review_metrics || g.env?.PASEO_HARNESS_WORKFLOW_RUN) return [];
  return addFound(phase, changedArtifacts(g, phase, [key]));
}

export function scanHandEdits(g, phase) {
  const found = changedArtifacts(g, phase, Object.keys(readRevisions(phase).keys));
  for (const [label, v] of changedOwned(g, phase)) if (!found.has(label)) found.set(label, v);
  const added = addFound(phase, found);
  const edits = readStore(phase);
  const pending = edits.filter(open);
  return done({
    phase: phase.padded,
    new: added.length,
    pending: pending.map(({ id, key, kind, files, at }) => ({ id, key, kind, files, at })),
    logged: edits.length - pending.length,
    candidates: candidatesOf(g),
    ...(pending.length ? { ask: `say why each was changed: ph gsd hand-edit record ${phase.number} <id> --category ${CATEGORIES.join("|")} --note "<one line>"` } : {}),
  });
}

// An edit logged after the fact: a plan key or a file of the project that was fixed by hand and no scan saw.
function manualEdit(g, phase, ref) {
  const plan = /^plan:(.+)$/.exec(ref);
  if (plan) {
    const abs = planPath(phase, plan[1]);
    if (!isFile(abs)) throw fail(`no plan ${plan[1]} in ${rel(g.codeRoot, phase.dir)}`);
    return { key: ref, kind: "plan", files: [rel(g.codeRoot, abs)], digest: contentOf(abs) };
  }
  if (FIXED_KEYS.has(ref)) return { key: ref, kind: "artifact", files: [], digest: `manual:${textDigest(nowIso() + ref)}` };
  const abs = path.resolve(g.codeRoot, ref);
  if (isInside(abs, g.codeRoot) && isFile(abs)) {
    const label = rel(g.codeRoot, abs);
    return { key: `file:${label}`, kind: flowWritten(g, phase, label) ? kindOf(label) : "owned", files: [label], digest: contentOf(abs) };
  }
  throw fail(`no pending hand edit ${ref} (ph gsd hand-edit list ${phase.number}); give an id, a plan:<id> key or a file of the project`);
}

export function recordHandEdit(g, phase, ref, { category, note }) {
  if (!ref) throw fail("hand-edit record needs an id (HE-<n>), a plan:<id> key or a file");
  if (!CATEGORIES.includes(category)) throw fail(`--category is one of ${CATEGORIES.join(", ")}`);
  const line = String(note ?? "").trim();
  if (!line) throw fail("--note needs one line: what was changed and why");
  if (/[\r\n]/.test(line) || line.length > NOTE_MAX) throw fail(`--note is one line of at most ${NOTE_MAX} characters`);
  const answered = [];
  withFileLock(`${handEditsFile(phase)}.lock`, () => {
    const edits = readStore(phase);
    let hits = edits.filter((e) => open(e) && (e.id === ref || e.key === ref || e.files.includes(ref)));
    if (!hits.length) {
      if (edits.some((e) => e.id === ref)) throw fail(`${ref} is already logged`);
      const made = manualEdit(g, phase, ref);
      if (made.files.length && edits.some((e) => e.files[0] === made.files[0] && e.digest === made.digest)) throw fail(`${ref} is already logged in its current content`);
      const edit = { id: nextId(edits), ...made, at: nowIso(), category: null, note: null };
      edits.push(edit);
      hits = [edit];
    }
    for (const e of hits) {
      Object.assign(e, { category, note: line, loggedAt: nowIso() });
      answered.push(e.id);
    }
    writeJsonAtomic(handEditsFile(phase), { v: 1, edits });
  });
  const count = summarize(projectEdits(g.codeRoot).edits).byCategory.find((c) => c.category === category)?.count ?? 0;
  return done({ phase: phase.padded, logged: answered, category, note: line, count, candidates: candidatesOf(g) });
}

export function listHandEdits(g, phase) {
  const edits = readStore(phase);
  return done({ phase: phase.padded, edits, pending: edits.filter(open).length, candidates: candidatesOf(g) });
}
