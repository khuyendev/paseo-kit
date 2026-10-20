// Execute plumbing: anti-pattern gate (GSDF-11), cwd/branch guard (GSDF-40), execute baseline and safe-resume
// gate (GSDF-38), worktree transfer transaction (GSDF-94) and SUMMARY spot-check (GSDF-43).
import fs from "node:fs";
import path from "node:path";
import { readJsonIf, readText, writeJsonAtomic } from "../../harness/lib/io.mjs";
import { isInside, resolveInside, samePath, toSlash } from "../../harness/lib/paths.mjs";
import { git, gitLines, head, status } from "./flow-git.mjs";
import { contentHash, keyFiles, owned, ownsPrefixes } from "./flow-owns.mjs";

const ANSWER_KEYS = ["what", "manifested", "prevention"];

// `.continue-here.md` "Critical Anti-Patterns" rows of severity blocking need three written answers in
// `.continue-here.answers.json` ({<pattern>: {what, manifested, prevention}}) before discuss or execute.
export function antiPatterns(root, phaseDir) {
  const file = path.join(resolveInside(root, phaseDir), ".continue-here.md");
  if (!fs.existsSync(file)) return { blocking: [], unanswered: [] };
  const rows = [];
  let inTable = false;
  let cols = null;
  for (const line of readText(file).split(/\r?\n/)) {
    if (/^#{2,4}\s+Critical Anti-Patterns/i.test(line)) { inTable = true; cols = null; continue; }
    if (inTable && /^#{1,4}\s/.test(line)) break;
    if (!inTable || !line.trim().startsWith("|")) continue;
    const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    if (!cols) { cols = cells.map((c) => c.toLowerCase()); continue; }
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    const row = Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? ""]));
    if ((row.severity ?? "").toLowerCase() === "blocking") rows.push(row.pattern ?? cells[0]);
  }
  const answers = readJsonIf(path.join(path.dirname(file), ".continue-here.answers.json"), {}) ?? {};
  const unanswered = rows.filter((p) => !ANSWER_KEYS.every((k) => String(answers[p]?.[k] ?? "").trim()));
  return { blocking: rows, unanswered, answersFile: `${toSlash(phaseDir)}/.continue-here.answers.json`, code: unanswered.length ? 1 : 0 };
}

export function cwdGuard(root, worktreeDir, cwd) {
  const problems = [];
  const wtRoot = path.resolve(root, worktreeDir);
  if (isInside(cwd, wtRoot)) problems.push(`orchestrator cwd ${toSlash(cwd)} is inside a ph agent worktree (${toSlash(worktreeDir)})`);
  const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"], { allowFail: true }).out.trim();
  if (branch.startsWith("harness/")) problems.push(`orchestrator is on agent branch ${branch}`);
  if (!problems.length) return { ok: true, branch };
  const top = git(cwd, ["rev-parse", "--show-toplevel"], { allowFail: true }).out.trim();
  const stranded = gitLines(cwd, ["log", "--oneline", "--branches", "--not", "--remotes", "--max-count=20", "HEAD"], { allowFail: true });
  const dirty = top ? status(top).map((e) => `${e.code.trim() || "?"} ${e.path}`) : [];
  return { ok: false, problems, branch, stranded, dirty, code: 1 };
}

// Orchestrator bookkeeping (planning records, run records) is not plan output; owned SUMMARY files still count.
const bookkeeping = (p) => p.startsWith(".planning/") || p.startsWith("_workspace/");

const baselineFile = (root, phaseDir) => path.join(resolveInside(root, phaseDir), "execute-baseline.json");

function snapshot(root) {
  const entries = status(root);
  return {
    codeRoot: toSlash(root),
    head: head(root),
    dirty: entries.filter((e) => e.code !== "??").map((e) => ({ path: e.path, sha256: contentHash(path.join(root, e.path)) })),
    untracked: entries.filter((e) => e.code === "??").map((e) => e.path),
  };
}

// Kept for the whole phase: a resumed run compares against the first run's baseline (GSDF-38).
export function recordBaseline(root, phaseDir) {
  const file = baselineFile(root, phaseDir);
  const existing = readJsonIf(file, null);
  if (existing) return { kept: true, baseline: existing };
  const base = snapshot(root);
  writeJsonAtomic(file, base);
  return { kept: false, baseline: base };
}

function accounted(root, phaseDir) {
  const dir = resolveInside(root, phaseDir);
  const commits = readJsonIf(path.join(dir, "commits.json"), []) ?? [];
  const transfers = {};
  const tdir = path.join(dir, "transfers");
  if (fs.existsSync(tdir)) for (const f of fs.readdirSync(tdir)) {
    const t = readJsonIf(path.join(tdir, f), null);
    for (const file of t?.files ?? []) transfers[file.path] = file.sha256 ?? "deleted";
  }
  return { commits, transfers };
}

// input: {plans: [{id, owns[], summary, complete}]} — the plans of the phase with their SUMMARY state.
export function resumeGate(root, phaseDir, { plans }) {
  const base = readJsonIf(baselineFile(root, phaseDir), null);
  if (!base) throw new Error(`no execute baseline in ${phaseDir}`);
  const prefixes = ownsPrefixes(root);
  const problems = [];
  if (!samePath(base.codeRoot, root)) problems.push({ kind: "code-root-moved", detail: `baseline code root ${base.codeRoot} != ${toSlash(root)}` });
  const { commits, transfers } = accounted(root, phaseDir);
  const now = snapshot(root);
  const own = new Set(commits.map((c) => c.sha));
  if (now.head !== base.head) {
    const moved = base.head ? gitLines(root, ["rev-list", `${base.head}..HEAD`], { allowFail: true }) : [];
    const foreign = moved.filter((sha) => !own.has(sha));
    if (!moved.length || foreign.length) problems.push({ kind: "head-moved", detail: `HEAD ${now.head} moved outside the orchestrator's commits (${foreign.length || "unrelated"} foreign)`, head: now.head });
  }
  const baseDirty = new Map(base.dirty.map((d) => [d.path, d.sha256]));
  const baseUntracked = new Set(base.untracked);
  const changed = [];
  for (const e of [...now.dirty, ...now.untracked.map((p) => ({ path: p, sha256: contentHash(path.join(root, p)) }))]) {
    if (baseDirty.get(e.path) === e.sha256) continue;
    if (baseUntracked.has(e.path) && now.untracked.includes(e.path)) continue;
    if (transfers[e.path] === e.sha256) continue;
    changed.push(e.path);
  }
  for (const p of changed) {
    const owners = plans.filter((pl) => owned(p, [...(pl.owns ?? []), pl.summary].filter(Boolean), prefixes));
    if (!owners.length && bookkeeping(p)) continue;
    if (!owners.length) problems.push({ kind: "unauthorized path", path: p });
    else if (owners.length > 1) problems.push({ kind: "ambiguous owner", path: p, plans: owners.map((o) => o.id) });
    else if (!owners[0].complete) problems.push({ kind: "incomplete plan changed", path: p, plan: owners[0].id });
  }
  return { ok: problems.length === 0, problems, head: now.head, code: problems.length ? 1 : 0 };
}

// Files each plan changed since the baseline (shared tree): the per-plan file lists of commits.json (GSDF-53).
export function ownedChanges(root, phaseDir, { plans }) {
  const base = readJsonIf(baselineFile(root, phaseDir), null);
  if (!base) throw new Error(`no execute baseline in ${phaseDir}`);
  const prefixes = ownsPrefixes(root);
  const baseDirty = new Map(base.dirty.map((d) => [d.path, d.sha256]));
  const now = snapshot(root);
  const files = Object.fromEntries(plans.map((p) => [p.id, []]));
  const unowned = [];
  for (const e of [...now.dirty, ...now.untracked.map((p) => ({ path: p, sha256: contentHash(path.join(root, p)) }))]) {
    if (baseDirty.get(e.path) === e.sha256 || (base.untracked.includes(e.path) && now.untracked.includes(e.path))) continue;
    const owner = plans.find((p) => owned(e.path, [...(p.owns ?? []), p.summary].filter(Boolean), prefixes));
    if (owner) files[owner.id].push(e.path);
    else if (!bookkeeping(e.path)) unowned.push(e.path);
  }
  return { files, unowned };
}

// Changes of an agent worktree against its base commit: tracked edits, deletions and untracked files.
export function worktreeChanges(dir) {
  const entries = status(dir);
  const base = head(dir);
  return {
    base,
    changes: entries.map((e) => ({ path: e.path, kind: e.code === "??" ? "added" : e.code.includes("D") ? "deleted" : "modified" })),
  };
}

// GSDF-94: validate everything first, then copy file by file; a refusal writes nothing and keeps the worktree.
export function transfer(root, phaseDir, { plan, worktree, owns = [], summary, files_deleted = [] }) {
  const prefixes = ownsPrefixes(root);
  const wt = path.resolve(root, worktree);
  const { base, changes } = worktreeChanges(wt);
  const allowed = [...owns, summary].filter(Boolean);
  const refused = [];
  for (const c of changes) {
    if (!owned(c.path, allowed, prefixes)) refused.push({ path: c.path, reason: "outside owns" });
    else if (c.kind === "deleted" && !files_deleted.some((d) => toSlash(d) === c.path)) refused.push({ path: c.path, reason: "deletion not declared in files_deleted" });
  }
  const baseline = readJsonIf(baselineFile(root, phaseDir), null);
  const mainNow = new Map(status(root).map((e) => [e.path, e]));
  const baseDirty = new Map((baseline?.dirty ?? []).map((d) => [d.path, d.sha256]));
  const { transfers } = accounted(root, phaseDir);
  for (const c of changes) {
    if (refused.some((r) => r.path === c.path) || !mainNow.has(c.path)) continue;
    const cur = contentHash(path.join(root, c.path));
    if (baseDirty.get(c.path) !== cur && transfers[c.path] !== cur) refused.push({ path: c.path, reason: "main tree path changed since the execute baseline" });
  }
  if (refused.length) return { ok: false, plan, refused, worktree: toSlash(worktree), code: 1 };
  const files = [];
  for (const c of changes) {
    const dest = resolveInside(root, c.path);
    if (c.kind === "deleted") {
      fs.rmSync(dest, { force: true });
      files.push({ path: c.path, deleted: true });
      continue;
    }
    const data = fs.readFileSync(path.join(wt, c.path));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.transfer-${process.pid}`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, dest);
    files.push({ path: c.path, sha256: contentHash(dest) });
  }
  const record = { plan, worktree: toSlash(worktree), base, files };
  writeJsonAtomic(path.join(resolveInside(root, phaseDir), "transfers", `${plan}.json`), record);
  return { ok: true, ...record };
}

export function spotCheck(root, summaryRel) {
  const abs = resolveInside(root, summaryRel);
  if (!fs.existsSync(abs)) return { ok: false, missing: [summaryRel], code: 1 };
  const kf = keyFiles(readText(abs));
  const checked = [...kf.created, ...kf.modified].slice(0, 2);
  const missing = checked.filter((p) => !fs.existsSync(path.resolve(root, p)));
  return { ok: missing.length === 0, checked, missing, code: missing.length ? 1 : 0 };
}
