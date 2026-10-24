// Hand edits (kit feedback 68): what the orchestrator or the owner changed outside the flow, which the revisions only notice
// as a moved hash (and not at all after a hand `revisions record`). Each is listed with its cause category once, answered by
// `ph gsd hand-edit record`, and counted by `ph review-stats`. The log is `<phase dir>/hand-edits.json`, written only here.
// The run result lists the edits and the categories seen twice. Kit feedback 123: execute also reads this log (a matching
// owned edit of a committed plan is committed at the resume gate; `attached` names the plan whose commit takes the file).
// Kit feedback 93, 99: what the flow itself made is never listed (flowEvidence); the first scan of a log the previous kit wrote
// (`v: 1`) drops its open entries the flow made.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { readJsonIf, writeJsonAtomic } from "../lib/io.mjs";
import { sha256, textDigest } from "../lib/hash.mjs";
import { isInside, toSlash } from "../lib/paths.mjs";
import { matchesGlob } from "../adapter/contract.mjs";
import { DEFAULT_RUNS_DIR, RUN_FILES } from "../workflow/journal.mjs";
import { done, fail, isFile, nowIso, rel, withFileLock } from "./common.mjs";
import { GIT_TIMEOUT_MS, git } from "./git.mjs";
import { CATEGORIES, HAND_EDITS_FILE, candidateLine, projectEdits, readEdits, summarize } from "../lib/hand-edit-log.mjs";
import { normPlanId, planPath, readPlans } from "./planning.mjs";
import { ownsDepth } from "./adapter-hooks.mjs";
import { STATE_FILE, readStateFile } from "../lib/execute-state.mjs";
import { guardWriter } from "./state.mjs";
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
const LOG_VERSION = 2;
// The entries the v1 migration dropped stay listed (id, file, why), so an id is never given twice.
const droppedOf = (phase) => {
  try {
    const d = readJsonIf(handEditsFile(phase), null)?.dropped;
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
};
const writeStore = (phase, edits, dropped = droppedOf(phase)) => writeJsonAtomic(handEditsFile(phase), { v: LOG_VERSION, edits, ...(dropped.length ? { dropped } : {}) });
const nextId = (edits, dropped = []) => `HE-${[...edits, ...dropped].reduce((n, e) => Math.max(n, Number(/^HE-(\d+)$/.exec(e.id)?.[1] ?? 0)), 0) + 1}`;
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

// A commits.json entry the flow made: a `reconciled` entry is an orchestrator commit with a Plans trailer, an owner entry an
// owner commit recorded for the resume gate; neither holds the flow's content.
const flowCommit = (c) => typeof c?.sha === "string" && /^[0-9a-f]{7,64}$/.test(c.sha) && !c.reconciled && !c.owner && !c.adopted && c.by !== "owner" && c.kind !== "owner";
const committedPaths = (c) => [...Object.values(c.plans ?? {}).flatMap((l) => (Array.isArray(l) ? l : [])), ...(Array.isArray(c.integration) ? c.integration : [])];
const gitBytes = (root, args, input) => {
  const r = spawnSync("git", args, { cwd: root, input, timeout: GIT_TIMEOUT_MS, windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
  return r.status === 0 && !r.error ? r.stdout : null;
};
// The digests a committed blob can have in the tree: as committed, and with CRLF line ends (a checkout under core.autocrlf).
const blobDigests = (body) => [sha256(body), sha256(Buffer.from(body.toString("latin1").replace(/\r?\n/g, "\r\n"), "latin1"))];

// What the flow commits of commits.json committed for each of `labels`, oldest first: `label -> [{sha, at (ms), digests}]`
// (`deleted` for a commit that removed it). The fixers' edits of a wave land in its commit. No git or no record: nothing.
function flowCommitted(g, phase, labels) {
  const out = new Map();
  let commits = [];
  try {
    commits = readJsonIf(path.join(phase.dir, "commits.json"), []) ?? [];
  } catch {
    return out;
  }
  if (!Array.isArray(commits)) return out;
  const want = new Set(labels.filter((p) => !/[\r\n]/.test(p)));
  const pairs = commits.filter(flowCommit).flatMap((c) => [...new Set(committedPaths(c))].filter((p) => want.has(p)).map((p) => [p, c.sha]));
  if (!pairs.length) return out;
  const prefix = git(g.codeRoot, ["rev-parse", "--show-prefix"]);
  const times = git(g.codeRoot, ["show", "-s", "--format=%H %cI", ...new Set(pairs.map(([, sha]) => sha))]);
  const blobs = prefix.code === 0 ? gitBytes(g.codeRoot, ["cat-file", "--batch"], pairs.map(([p, sha]) => `${sha}:${prefix.stdout.trim()}${p}\n`).join("")) : null;
  if (!blobs || times.code !== 0) return out;
  const commitTimes = times.stdout.split("\n").map((l) => l.trim().split(" ")).filter((l) => l.length === 2);
  let pos = 0;
  for (const [p, sha] of pairs) {
    const nl = blobs.indexOf(0x0a, pos);
    if (nl < 0) break;
    const head = /^[0-9a-f]+ (\w+) (\d+)$/.exec(blobs.toString("utf8", pos, nl));
    pos = nl + 1;
    let digests = ["deleted"];
    if (head) {
      const body = blobs.subarray(pos, pos + Number(head[2]));
      pos += Number(head[2]) + 1;
      digests = head[1] === "blob" ? blobDigests(body) : [];
    }
    const at = Date.parse(commitTimes.find(([full]) => full.startsWith(sha))?.[1]);
    if (!out.has(p)) out.set(p, []);
    out.get(p).push({ sha, at: Number.isFinite(at) ? at : null, digests });
  }
  return out;
}

const mtimeOf = (file) => {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
};

// The workflow runs of this phase (`args.phaseDir` names its directory) as [id, start, end] in ms; a run without an end (live,
// or its runner died) ends at its journal's last write. The runs directory is the calling run's, else the default.
function phaseRuns(g, phase) {
  const runDir = g.env?.PASEO_HARNESS_WORKFLOW_RUN_DIR;
  const dir = runDir ? path.dirname(runDir) : path.resolve(g.harnessRoot ?? g.codeRoot, DEFAULT_RUNS_DIR);
  const name = path.basename(phase.dir);
  const runs = [];
  let ids = [];
  try {
    ids = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return runs;
  }
  for (const id of ids) {
    let run = null;
    let args = null;
    try {
      run = readJsonIf(path.join(dir, id, RUN_FILES.run), null);
      args = readJsonIf(path.join(dir, id, RUN_FILES.args), null);
    } catch {
      continue;
    }
    if (typeof args?.phaseDir !== "string" || path.posix.basename(toSlash(args.phaseDir).replace(/\/+$/, "")) !== name) continue;
    const start = Date.parse(run?.startedAt);
    if (!Number.isFinite(start)) continue;
    const ended = Date.parse(run.endedAt);
    runs.push([id, start, Number.isFinite(ended) ? ended : Math.max(mtimeOf(path.join(dir, id, RUN_FILES.journal)) ?? 0, mtimeOf(path.join(dir, id, RUN_FILES.run)) ?? 0)]);
  }
  return runs;
}

// Kit feedback 93, 99: the evidence that the flow itself made a file's content. `of(label, kind, digest, before)` names it or
// returns null: a generator output (adapter.ownership.regenerated); an owned file holding what a flow commit committed; an
// artifact holding what a revisions record holds; with `before` (a logged entry's time) only a commit or record made by then
// counts, since a later flow commit takes in whatever edit the tree held. `run(label)`: the file was last written inside a
// workflow run of this phase (what an agent or verb of a run wrote when the run stopped before its commit or record: an outline
// revision, a fixer's answer to a request); a hand edit made while a run of the phase is live counts as the run's.
function flowEvidence(g, phase, labels) {
  const generated = g.cfg.adapter?.ownership?.regenerated ?? [];
  const committed = flowCommitted(g, phase, labels);
  const records = Object.entries(readRevisions(phase).keys ?? {}).filter(([, r]) => r?.parts);
  let runs = null;
  const of = (label, kind, digest, before = null) => {
    if (generated.some((glob) => matchesGlob(label, glob))) return "regenerated";
    if (kind === "owned") {
      const list = committed.get(label) ?? [];
      const hit = before === null ? list.slice(-1).find((c) => c.digests.includes(digest)) : list.find((c) => c.at !== null && c.at <= before && c.digests.includes(digest));
      return hit ? `commit ${hit.sha.slice(0, 7)}` : null;
    }
    // Without `before`: the newest record covering the artifact holds it (an older key that still differs is only stale, e.g. a
    // plan key recorded before an outline revision).
    const holding = records.filter(([, r]) => Object.hasOwn(r.parts, label) && (before === null || Date.parse(r.at) <= before));
    const newest = holding.reduce((m, [, r]) => (String(r.at) > m ? String(r.at) : m), "");
    const hit = holding.find(([, r]) => (before !== null || String(r.at) === newest) && r.parts[label] === digest);
    return hit ? `record ${hit[0]}` : null;
  };
  const run = (label) => {
    const at = mtimeOf(path.resolve(g.codeRoot, label));
    if (at === null) return null;
    runs ??= phaseRuns(g, phase);
    const hit = runs.find(([, start, end]) => start <= at && at <= end);
    return hit ? `run ${hit[0]}` : null;
  };
  return { of, run };
}

// Takes the flow's own changes out of `found` (`label -> {kind, digest}`) and returns them as [{file, by}].
function withoutFlow(g, phase, found) {
  if (!found.size) return [];
  const ev = flowEvidence(g, phase, [...found.keys()]);
  const made = [];
  for (const [label, { kind, digest }] of found) {
    const by = ev.of(label, kind, digest) ?? ev.run(label);
    if (by) made.push({ file: label, by });
  }
  for (const { file } of made) found.delete(file);
  return made;
}

// The first scan of a log the previous kit wrote (`v: 1`, before flow-made changes were told apart) drops its open entries whose
// logged content the flow made: a commit or record made by the time of the entry holds it, or the file still holds it and was
// written inside a run. They are kept under `dropped` with the reason. Answered entries stay, and later scans never re-check an
// entry (a hand edit a later flow commit takes in is still a hand edit).
function migrateLog(g, phase) {
  const file = handEditsFile(phase);
  let data = null;
  try {
    data = readJsonIf(file, null);
  } catch {
    return [];
  }
  if (data?.v !== 1) return [];
  return withFileLock(`${file}.lock`, () => {
    const edits = readStore(phase);
    const pending = edits.filter((e) => open(e) && typeof e.files[0] === "string" && typeof e.digest === "string");
    const ev = flowEvidence(g, phase, pending.map((e) => e.files[0]));
    const currentOf = (e) => {
      if (e.kind === "owned") return contentOf(path.resolve(g.codeRoot, e.files[0]));
      try {
        return new Map(keyParts(g, phase, e.key).parts).get(e.files[0]) ?? null;
      } catch {
        return null;
      }
    };
    const gone = [];
    for (const e of pending) {
      const loggedAt = Date.parse(e.at);
      const by = ev.of(e.files[0], e.kind, e.digest, Number.isFinite(loggedAt) ? loggedAt : -Infinity) ?? (currentOf(e) === e.digest ? ev.run(e.files[0]) : null);
      if (by) gone.push({ e, by });
    }
    const at = nowIso();
    writeStore(phase, edits.filter((e) => !gone.some((x) => x.e === e)), [...droppedOf(phase), ...gone.map(({ e, by }) => ({ id: e.id, files: e.files, digest: e.digest, by, at }))]);
    return gone.map(({ e }) => e.id);
  });
}

// Adds what is not in the log yet: an edit with the same file and content is known (answered or not); a file edited again
// while its earlier edit is unanswered updates that entry, so one file is one question.
function addFound(phase, found) {
  if (!found.size) return [];
  const added = [];
  withFileLock(`${handEditsFile(phase)}.lock`, () => {
    const edits = readStore(phase);
    const dropped = droppedOf(phase);
    for (const [label, { key, kind, digest }] of found) {
      if (edits.some((e) => e.files[0] === label && e.digest === digest)) continue;
      const earlier = edits.find((e) => e.files[0] === label && open(e));
      if (earlier) Object.assign(earlier, { key, kind, digest, at: nowIso() });
      else edits.push({ id: nextId(edits, dropped), key, kind, files: [label], digest, at: nowIso(), category: null, note: null });
      added.push(label);
    }
    writeStore(phase, edits, dropped);
  });
  return added;
}

// A hand `revisions record` (outside a workflow run: the engine sets PASEO_HARNESS_WORKFLOW_RUN for its shell calls)
// overwrites the record the change shows against, so what changed in the key's flow-written files is kept first.
export function captureBeforeRecord(g, phase, key) {
  if (!g.cfg.gsd.review_metrics || g.env?.PASEO_HARNESS_WORKFLOW_RUN) return [];
  const found = changedArtifacts(g, phase, [key]);
  withoutFlow(g, phase, found);
  return addFound(phase, found);
}

export function scanHandEdits(g, phase) {
  const dropped = migrateLog(g, phase);
  const found = changedArtifacts(g, phase, Object.keys(readRevisions(phase).keys));
  for (const [label, v] of changedOwned(g, phase)) if (!found.has(label)) found.set(label, v);
  const flowMadeNow = withoutFlow(g, phase, found);
  const added = addFound(phase, found);
  const edits = readStore(phase);
  const pending = edits.filter(open);
  return done({
    phase: phase.padded,
    new: added.length,
    pending: pending.map(({ id, key, kind, files, at }) => ({ id, key, kind, files, at })),
    logged: edits.length - pending.length,
    flowMade: flowMadeNow,
    ...(dropped.length ? { dropped } : {}),
    candidates: candidatesOf(g),
    ...(pending.length ? { ask: `say why each was changed: ph gsd hand-edit record ${phase.number} <id> --category ${CATEGORIES.join("|")} --note "<one line, at most ${NOTE_MAX} characters>"` } : {}),
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

export function recordHandEdit(g, phase, ref, { category, note, amend = false } = {}) {
  if (!ref) throw fail("hand-edit record needs an id (HE-<n>), a plan:<id> key or a file");
  const line = String(note ?? "").trim();
  if (!line) throw fail("--note needs one line: what was changed and why");
  if (/[\r\n]/.test(String(note ?? "")) || line.length > NOTE_MAX) throw fail(`--note is one line of at most ${NOTE_MAX} characters (got ${line.length})`);
  if (amend) {
    if (category != null && category !== "" && !CATEGORIES.includes(category)) throw fail(`--category is one of ${CATEGORIES.join(", ")}`);
    return amendHandEdit(g, phase, ref, { category, note: line });
  }
  if (!CATEGORIES.includes(category)) throw fail(`--category is one of ${CATEGORIES.join(", ")}`);
  const answered = [];
  withFileLock(`${handEditsFile(phase)}.lock`, () => {
    const edits = readStore(phase);
    const dropped = droppedOf(phase);
    let hits = edits.filter((e) => open(e) && (e.id === ref || e.key === ref || e.files.includes(ref)));
    if (!hits.length) {
      if (edits.some((e) => e.id === ref)) throw fail(`${ref} is already logged`);
      const made = manualEdit(g, phase, ref);
      if (made.files.length && edits.some((e) => e.files[0] === made.files[0] && e.digest === made.digest)) throw fail(`${ref} is already logged in its current content`);
      const edit = { id: nextId(edits, dropped), ...made, at: nowIso(), category: null, note: null };
      edits.push(edit);
      hits = [edit];
    }
    for (const e of hits) {
      Object.assign(e, { category, note: line, loggedAt: nowIso() });
      answered.push(e.id);
    }
    writeStore(phase, edits, dropped);
  });
  const count = summarize(projectEdits(g.codeRoot).edits).byCategory.find((c) => c.category === category)?.count ?? 0;
  const warning = commitWarning(g, phase, readStore(phase).filter((e) => answered.includes(e.id)));
  return done({ phase: phase.padded, logged: answered, category, note: line, count, candidates: candidatesOf(g), ...(warning ?? {}) });
}

// Kit feedback 113 F1: replace the note of a record that is already logged. The note it had (and each note replaced since)
// stays on `history`, so a placeholder can be corrected. A pending edit is not a record yet: record it without --amend.
function amendHandEdit(g, phase, ref, { category, note }) {
  const answered = [];
  let kept = null;
  withFileLock(`${handEditsFile(phase)}.lock`, () => {
    const edits = readStore(phase);
    const hits = edits.filter((e) => CATEGORIES.includes(e.category) && (e.id === ref || e.key === ref || e.files.includes(ref)));
    if (!hits.length) throw fail(`${ref} is not a logged hand edit (ph gsd hand-edit list ${phase.number})`);
    for (const e of hits) {
      const next = category || e.category;
      if (e.note !== note || next !== e.category) {
        const history = Array.isArray(e.history) ? e.history.slice() : [];
        history.push({ note: e.note, at: e.loggedAt ?? e.at, category: e.category });
        Object.assign(e, { note, category: next, loggedAt: nowIso(), history });
      }
      answered.push(e.id);
      kept = e;
    }
    writeStore(phase, edits);
  });
  const count = summarize(projectEdits(g.codeRoot).edits).byCategory.find((c) => c.category === kept.category)?.count ?? 0;
  const warning = commitWarning(g, phase, readStore(phase).filter((e) => answered.includes(e.id)));
  return done({ phase: phase.padded, logged: answered, amended: true, category: kept.category, note, history: kept.history ?? [], count, candidates: candidatesOf(g), ...(warning ?? {}) });
}

// The plans that already have a commit (execute-progress.json, or a plan entry of commits.json including an owner adopt).
function committedPlanIds(g, phase) {
  let commits = [];
  try {
    const raw = readJsonIf(path.join(phase.dir, "commits.json"), []) ?? [];
    commits = Array.isArray(raw) ? raw : [];
  } catch { commits = []; }
  let fromState = [];
  try {
    const st = readStateFile(path.join(phase.dir, STATE_FILE)).state;
    fromState = Object.keys(st.plans ?? {}).filter((id) => st.plans[id]?.commit !== undefined);
  } catch { fromState = []; }
  return new Set([...fromState, ...commits.flatMap((c) => [...Object.keys(c?.plans ?? {}), ...Object.keys(c?.owner?.plans ?? {})])]);
}

// Most specific owners of a repo path among the phase's plans, the same measure the resume gate uses.
function fileOwners(g, phase, file) {
  const prefixes = (g.cfg.adapter?.ownership?.owns_forms ?? [{ prefix: "Path:" }]).map((f) => f.prefix).filter(Boolean);
  const bare = (entry) => {
    let p = String(entry).trim().replace(/^`|`$/g, "");
    for (const pre of prefixes) if (p.startsWith(pre)) { p = p.slice(pre.length).trim(); break; }
    return p.replace(/\\/g, "/").replace(/^\.\//, "");
  };
  let best = -1;
  let out = [];
  for (const pl of readPlans(phase)) {
    const d = Math.max(-1, ...pl.owns.map(bare).filter(Boolean).map((o) => ownsDepth(o, file)));
    if (d < 0 || d < best) continue;
    if (d > best) { best = d; out = []; }
    out.push(pl.id);
  }
  return out;
}

// Kit feedback 123 F3: recording an owned edit whose plan is already committed says what the next execute run will do.
function commitWarning(g, phase, edits) {
  const owned = (edits ?? []).filter((e) => e.kind === "owned" && typeof e.files?.[0] === "string");
  if (!owned.length) return null;
  let committed;
  try { committed = committedPlanIds(g, phase); } catch { return null; }
  const lines = [];
  for (const e of owned) {
    let owners = [];
    try { owners = fileOwners(g, phase, e.files[0]); } catch { owners = []; }
    const keyPlan = /^owned:(.+)$/.exec(e.key ?? "")?.[1];
    const ids = owners.length ? owners : (keyPlan ? [keyPlan] : []);
    const doneIds = ids.filter((id) => committed.has(id));
    const open = ids.filter((id) => !committed.has(id));
    if (!doneIds.length) continue;
    if (open.length) lines.push(`${e.id}: ${e.files[0]} belongs to committed plan ${doneIds.join(", ")} and to ${open.join(", ")}, which is not committed. The next execute run will not commit it. Attach it to the plan of the wave that should take it: ph gsd hand-edit.attach ${phase.number} ${e.id} --plan <id>`);
    else lines.push(`${e.id}: ${e.files[0]} belongs to committed plan ${doneIds.join(", ")}. The next execute run commits it as a follow-up of ${doneIds.join(", ")} before any agent, and records that commit in commits.json.`);
  }
  if (!lines.length) return null;
  return { warning: lines.join(" "), next: lines[0] };
}

// Kit feedback 123 F5: attach a recorded hand edit to a plan that is not committed yet. That plan's transfer and commit
// take the file (a file a committed plan also owns has no other verb that will).
export function attachHandEdit(g, phase, ref, planRef) {
  guardWriter(g.env);
  if (!ref) throw fail("hand-edit attach needs a hand edit: ph gsd hand-edit.attach <phase> <HE-n|file> --plan <id>");
  if (!planRef) throw fail("hand-edit attach needs --plan <id>, a plan of the wave being gated");
  const id = /^\d+$/.test(planRef) ? `${phase.padded}-${String(planRef).padStart(2, "0")}` : normPlanId(planRef);
  if (!readPlans(phase).some((p) => p.id === id)) throw fail(`hand-edit attach: no plan ${id} in ${rel(g.codeRoot, phase.dir)}`);
  if (committedPlanIds(g, phase).has(id)) throw fail(`hand-edit attach: ${id} is committed. A hand edit of its files is committed as a follow-up at the next execute run's start; or commit the file and ph gsd commit adopt ${phase.number} <sha> --reason "<why the commit stands>"`);
  const attached = [];
  let file = null;
  withFileLock(`${handEditsFile(phase)}.lock`, () => {
    const edits = readStore(phase);
    const hits = edits.filter((e) => e.id === ref || e.files.includes(ref) || e.key === ref);
    if (!hits.length) throw fail(`no hand edit ${ref} (ph gsd hand-edit list ${phase.number}); record it first with ph gsd hand-edit record`);
    for (const e of hits) {
      if (typeof e.files[0] !== "string") throw fail(`${e.id} names no file, so no plan's commit can take it`);
      Object.assign(e, { attached: id, attachedAt: nowIso() });
      attached.push(e.id);
      file = e.files[0];
    }
    writeStore(phase, edits);
  });
  return done({ phase: phase.padded, attached, plan: id, file, next: `the commit of ${id} takes ${file}` });
}

export function listHandEdits(g, phase) {
  const edits = readStore(phase);
  return done({ phase: phase.padded, edits, pending: edits.filter(open).length, candidates: candidatesOf(g) });
}
