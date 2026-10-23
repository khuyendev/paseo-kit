// Execute plumbing: anti-pattern gate (GSDF-11), cwd/branch guard (GSDF-40), execute baseline and safe-resume
// gate (GSDF-38), worktree transfer transaction (GSDF-94) and SUMMARY spot-check (GSDF-43).
import fs from "node:fs";
import path from "node:path";
import { readJsonIf, readText, writeJsonAtomic } from "../../harness/lib/io.mjs";
import { loadConfig } from "../../harness/config.mjs";
import { sha256 } from "../../harness/lib/hash.mjs";
import { isInside, resolveInside, samePath, toSlash } from "../../harness/lib/paths.mjs";
import { git, gitLines, head, status } from "./flow-git.mjs";
import { contentHash, keyFiles, owned, ownsPrefixes, specificOwners } from "./flow-owns.mjs";
import { matchesGlob } from "../../harness/adapter/contract.mjs";
import { readWorktreeSeed } from "../../harness/runtime/worktree-seed.mjs";
import { runGit } from "../../harness/runtime/worktrees.mjs";

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
// adapter.ownership.<key> globs as a path test; an unreadable config matches nothing.
const ownershipGlobs = (root, key) => {
  let globs = [];
  try { globs = loadConfig(root).adapter.ownership[key] ?? []; } catch { globs = []; }
  return (p) => globs.some((g) => matchesGlob(p, g));
};
// adapter.ownership.ignore: paths the orchestrator or the owner edits during a run (notes, feedback logs, kit-feedback
// 23); neither the resume gate nor the commit check treats them as plan output.
const ignoredBy = (root) => ownershipGlobs(root, "ignore");

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

const commitFiles = (root, sha) => gitLines(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", "-m", "--root", sha], { allowFail: true });
const trailerPlans = (root, sha) => {
  const body = git(root, ["show", "-s", "--format=%B", sha], { allowFail: true }).out;
  const m = /^Plans:\s*(\S.*)$/m.exec(body);
  return m ? m[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
};

// input: {plans: [{id, owns[], summary, complete}], integration?: [path]} — the plans of the phase with their SUMMARY
// state, and the paths the run's integration fixer was given (orchestrator output, recorded in execute-progress.json).
// A moved HEAD is checked commit by commit: a commit the orchestrator made but could not record (its `Plans:` trailer
// names plans of this phase and every file it touches is theirs) is written into commits.json (`reconciled`); a
// commit touching no file any plan of the phase owns (a docs commit between runs, kit-feedback 24) is `accepted`;
// any other commit is foreign.
export function resumeGate(root, phaseDir, { plans, integration = [] }) {
  const base = readJsonIf(baselineFile(root, phaseDir), null);
  if (!base) throw new Error(`no execute baseline in ${phaseDir}`);
  const prefixes = ownsPrefixes(root);
  const ignored = ignoredBy(root);
  const ownsOf = (pl) => [...(pl.owns ?? []), pl.summary].filter(Boolean);
  const problems = [];
  const reconciled = [];
  const accepted = [];
  if (!samePath(base.codeRoot, root)) problems.push({ kind: "code-root-moved", detail: `baseline code root ${base.codeRoot} != ${toSlash(root)}` });
  const { commits, transfers } = accounted(root, phaseDir);
  const now = snapshot(root);
  const own = new Set(commits.map((c) => c.sha));
  if (now.head !== base.head) {
    const moved = base.head ? gitLines(root, ["rev-list", "--reverse", `${base.head}..HEAD`], { allowFail: true }) : [];
    const foreign = [];
    for (const sha of moved.filter((s) => !own.has(s))) {
      const files = commitFiles(root, sha);
      const ids = trailerPlans(root, sha);
      const mine = ids.length && ids.every((id) => plans.some((pl) => pl.id === id)) ? plans.filter((pl) => ids.includes(pl.id)) : [];
      const assigned = mine.length ? files.map((f) => [f, specificOwners(f, mine, prefixes, ownsOf)[0]?.id ?? (bookkeeping(f) ? null : undefined)]) : [];
      if (mine.length && files.length && assigned.every(([, id]) => id !== undefined)) {
        const entry = { sha, phase: path.basename(phaseDir).split("-")[0], wave: null, plans: Object.fromEntries(mine.map((pl) => [pl.id, assigned.filter(([, id]) => id === pl.id).map(([f]) => f)])), reconciled: true };
        const list = readJsonIf(path.join(resolveInside(root, phaseDir), "commits.json"), []) ?? [];
        writeJsonAtomic(path.join(resolveInside(root, phaseDir), "commits.json"), [...list, entry]);
        reconciled.push({ sha, plans: mine.map((pl) => pl.id) });
      } else if (files.length && files.every((f) => !plans.some((pl) => owned(f, ownsOf(pl), prefixes)))) accepted.push({ sha, files });
      else foreign.push(sha);
    }
    if (!moved.length || foreign.length) problems.push({ kind: "head-moved", detail: `HEAD ${now.head} moved outside the orchestrator's commits (${foreign.length || "unrelated"} foreign${foreign.length ? `: ${foreign.slice(0, 3).map((s) => s.slice(0, 7)).join(", ")}` : ""})`, head: now.head });
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
    if (ignored(p)) continue;
    const owners = specificOwners(p, plans, prefixes, ownsOf);
    if (!owners.length && (bookkeeping(p) || integration.includes(p))) continue;
    if (!owners.length) problems.push({ kind: "unauthorized path", path: p });
    else if (owners.length > 1) problems.push({ kind: "ambiguous owner", path: p, plans: owners.map((o) => o.id) });
    else if (!owners[0].complete && !integration.includes(p)) problems.push({ kind: "incomplete plan changed", path: p, plan: owners[0].id });
  }
  return { ok: problems.length === 0, problems, head: now.head, reconciled, accepted, code: problems.length ? 1 : 0 };
}

// Every change of the main tree since the baseline, assigned for the commit manifest (GSDF-53, CR-GSF-07):
// input {plans: [{id, owns, summary, claimed?}], pending?: [{id, owns, summary}], integration?: [path], ignore?: [prefix]}.
// A path claimed by a plan's transfer record goes to that plan, else to every plan owning it; deleted paths go to
// `removed`; unowned paths the integration fixer was given go to `integration`; paths owned only by `pending` plans
// (committed later in the run) are left alone; everything else is `unowned` and must stop the commit.
export function ownedChanges(root, phaseDir, { plans, pending = [], integration = [], ignore = [] }) {
  const base = readJsonIf(baselineFile(root, phaseDir), null);
  if (!base) throw new Error(`no execute baseline in ${phaseDir}`);
  const prefixes = ownsPrefixes(root);
  const baseDirty = new Map(base.dirty.map((d) => [d.path, d.sha256]));
  const now = snapshot(root);
  const files = Object.fromEntries(plans.map((p) => [p.id, []]));
  const removed = Object.fromEntries(plans.map((p) => [p.id, []]));
  const integrated = [];
  const unowned = [];
  const ownsOf = (p) => [...(p.owns ?? []), p.summary].filter(Boolean);
  const byConfig = ignoredBy(root);
  const ignored = (p) => byConfig(p) || ignore.some((pre) => p.startsWith(`${toSlash(pre).replace(/\/$/, "")}/`));
  for (const e of [...now.dirty, ...now.untracked.map((p) => ({ path: p, sha256: contentHash(path.join(root, p)) }))]) {
    if (baseDirty.get(e.path) === e.sha256 || (base.untracked.includes(e.path) && now.untracked.includes(e.path))) continue;
    if (ignored(e.path)) continue;
    const claimants = plans.filter((p) => (p.claimed ?? []).includes(e.path));
    // A nested file goes to the plan owning it most specifically, not to every plan owning a parent directory.
    const owners = claimants.length ? claimants : specificOwners(e.path, [...plans, ...pending], prefixes, ownsOf).filter((p) => plans.includes(p));
    const gone = e.sha256 === "deleted";
    if (owners.length) for (const o of owners) (gone ? removed : files)[o.id].push(e.path);
    else if (integration.includes(e.path)) integrated.push(e.path);
    else if (pending.some((p) => owned(e.path, ownsOf(p), prefixes))) continue;
    else if (!bookkeeping(e.path)) unowned.push(e.path);
  }
  return { files, removed, integration: integrated, unowned };
}

// The owners of each path among the given plans, by their most specific owns entry and the adapter's owns forms
// (G072: `Path:src/api` does not own src/api-v2/x.js): {owners: {<path as given>: [plan ids]}}.
export function ownersOf(root, { paths = [], plans = [] }) {
  const prefixes = ownsPrefixes(root);
  const ownsOf = (p) => [...(p.owns ?? []), p.summary].filter(Boolean);
  return { owners: Object.fromEntries(paths.map((p) => [p, specificOwners(toSlash(String(p)).replace(/^\.\//, ""), plans, prefixes, ownsOf).map((x) => x.id)])) };
}

// Owned paths an owner had already edited (or created) before the execute baseline: a worktree starts from HEAD
// without them, so worktree execution of those plans is refused before dispatch (CR-GSF-03).
export function dirtyOwned(root, phaseDir, { plans }) {
  const base = readJsonIf(baselineFile(root, phaseDir), null);
  if (!base) throw new Error(`no execute baseline in ${phaseDir}`);
  const prefixes = ownsPrefixes(root);
  const paths = [...base.dirty.map((d) => d.path), ...base.untracked].filter((p) => !bookkeeping(p));
  const found = [];
  for (const p of paths) for (const pl of plans) if (owned(p, pl.owns ?? [], prefixes)) found.push({ path: p, plan: pl.id });
  return { dirty: found, code: found.length ? 1 : 0 };
}

// GSDF-41: worktree agents read content-addressed planning inputs, not mutable/uncommitted main paths.
export function executionInputs(root) {
  const cfg = loadConfig(root);
  const scopes = [".planning", ".agents", ".claude/skills", ...(cfg.adapter.instructions ?? [])];
  const names = [...new Set(gitLines(root, ["ls-files", "-co", "--exclude-standard", "-z", "--", ...scopes]).flatMap((l) => l.split("\0")).filter(Boolean))].sort();
  const files = names.filter((p) => fs.existsSync(resolveInside(root, p)) && fs.statSync(resolveInside(root, p)).isFile()).map((p) => ({ path: p, bytes: fs.readFileSync(resolveInside(root, p)) }));
  const hash = sha256(JSON.stringify(files.map((f) => [f.path, sha256(f.bytes)])));
  const dir = resolveInside(root, `_workspace/gsd-inputs/${hash}`);
  for (const f of files) {
    const dest = resolveInside(dir, f.path);
    if (fs.existsSync(dest)) {
      if (!fs.readFileSync(dest).equals(f.bytes)) throw new Error(`execution input snapshot changed: ${f.path}`);
    } else {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, f.bytes, { flag: "wx" });
    }
  }
  return { root: toSlash(dir), hash };
}

export function dependencySeed(root, phaseDir, { plans }) {
  const files = new Map();
  for (const plan of plans) {
    if (!/^\d+(\.\d+)?-\d+$/.test(plan)) throw new Error("invalid dependency plan id");
    const record = readJsonIf(resolveInside(root, `${phaseDir}/transfers/${plan}.json`), null);
    if (!record || record.plan !== plan) throw new Error(`no accepted transfer for dependency ${plan}`);
    for (const file of record.files) {
      if (contentHash(resolveInside(root, file.path)) !== (file.deleted ? "deleted" : file.sha256)) throw new Error(`accepted dependency changed: ${file.path}`);
      files.set(file.path, file);
    }
  }
  return { head: head(root), files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)) };
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

// A tracked file whose only difference from its base commit is line endings (a toolchain rewrote CRLF or LF). An
// untracked file has no base copy to compare with, and a file equal to its base (a restored seed, GSDF-94) differs in
// more than line endings from what the worktree was given, so neither qualifies.
const eolOnly = (wt, base, rel) => git(wt, ["cat-file", "-e", `${base}:${rel}`], { allowFail: true }).code === 0
  && git(wt, ["diff", "--quiet", base, "--", rel], { allowFail: true }).code !== 0
  && git(wt, ["diff", "--ignore-cr-at-eol", "--quiet", base, "--", rel], { allowFail: true }).code === 0;

// GSDF-94: validate everything first, then copy file by file; a refusal writes nothing and keeps the worktree.
// kit-feedback 26: a path outside owns that matches adapter.ownership.regenerated, or differs only in line endings, is
// dropped (not copied; the main tree keeps its own version) and listed in the record, instead of refusing the transfer.
export function transfer(root, phaseDir, { plan, worktree, owns = [], summary, files_deleted = [] }) {
  const prefixes = ownsPrefixes(root);
  const wt = path.resolve(root, worktree);
  const delta = worktreeChanges(wt);
  const base = delta.base;
  const seed = readWorktreeSeed(wt, runGit);
  if (seed && seed.head !== base) throw new Error("seeded worktree HEAD changed");
  const seeded = new Map((seed?.files ?? []).map((f) => [f.path, f.deleted ? "deleted" : f.sha256]));
  const changes = delta.changes.filter((c) => !seeded.has(c.path) || contentHash(resolveInside(wt, c.path)) !== seeded.get(c.path));
  // A worker restoring a seed to HEAD is still a change, even though git status is clean for it.
  for (const [p, hash] of seeded) if (!delta.changes.some((c) => c.path === p) && contentHash(resolveInside(wt, p)) !== hash) changes.push({ path: p, kind: fs.existsSync(resolveInside(wt, p)) ? "modified" : "deleted" });
  const allowed = [...owns, summary].filter(Boolean);
  const regenerated = ownershipGlobs(root, "regenerated");
  const refused = [];
  const dropped = [];
  for (const c of changes) {
    if (owned(c.path, allowed, prefixes)) {
      if (c.kind === "deleted" && !files_deleted.some((d) => toSlash(d) === c.path)) refused.push({ path: c.path, reason: "deletion not declared in files_deleted" });
    } else if (regenerated(c.path)) dropped.push({ path: c.path, reason: "regenerated" });
    else if (c.kind === "modified" && eolOnly(wt, base, c.path)) dropped.push({ path: c.path, reason: "line endings only" });
    else refused.push({ path: c.path, reason: "outside owns" });
  }
  const kept = changes.filter((c) => !dropped.some((d) => d.path === c.path));
  const baseline = readJsonIf(baselineFile(root, phaseDir), null);
  const mainNow = new Map(status(root).map((e) => [e.path, e]));
  const baseDirty = new Map((baseline?.dirty ?? []).map((d) => [d.path, d.sha256]));
  const { transfers } = accounted(root, phaseDir);
  const baseUntracked = new Set(baseline?.untracked ?? []);
  for (const c of kept) {
    if (refused.some((r) => r.path === c.path)) continue;
    // CR-GSF-03: the worktree started from HEAD without the owner's pre-baseline edit; copying would drop that edit.
    if ((baseDirty.has(c.path) || baseUntracked.has(c.path)) && transfers[c.path] === undefined) {
      refused.push({ path: c.path, reason: "owner edit from before the execute baseline is not in the worktree" });
      continue;
    }
    if (!mainNow.has(c.path)) continue;
    const cur = contentHash(path.join(root, c.path));
    if (baseDirty.get(c.path) !== cur && transfers[c.path] !== cur) refused.push({ path: c.path, reason: "main tree path changed since the execute baseline" });
  }
  if (refused.length) return { ok: false, plan, refused, worktree: toSlash(worktree), code: 1 };
  // A copy that dies half way (a kill, a Windows rename refused by a lock) must not look done on resume: the intent is
  // recorded first and removed only with the final record, and the SUMMARY is copied last, after the code it describes.
  const pending = pendingTransferFile(root, phaseDir, plan);
  writeJsonAtomic(pending, { plan, worktree: toSlash(worktree), base, paths: kept.map((c) => c.path) });
  const files = [];
  const order = [...kept.filter((c) => c.path !== summary), ...kept.filter((c) => c.path === summary)];
  for (const c of order) {
    const dest = resolveInside(root, c.path);
    if (c.kind === "deleted") {
      fs.rmSync(dest, { force: true });
      files.push({ path: c.path, deleted: true });
      continue;
    }
    const data = fs.readFileSync(path.join(wt, c.path));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.transfer-${process.pid}`;
    try {
      fs.writeFileSync(tmp, data);
      fs.renameSync(tmp, dest);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    files.push({ path: c.path, sha256: contentHash(dest) });
  }
  const record = { plan, worktree: toSlash(worktree), base, files, dropped };
  writeJsonAtomic(path.join(resolveInside(root, phaseDir), "transfers", `${plan}.json`), record);
  fs.rmSync(pending, { force: true });
  return { ok: true, ...record };
}

const pendingTransferFile = (root, phaseDir, plan) => path.join(resolveInside(root, phaseDir), "transfers-pending", `${plan}.json`);

// Plans whose transfer started and never finished (G069): their main-tree files are a partial copy of the worktree.
export function pendingTransfers(root, phaseDir) {
  const dir = path.join(resolveInside(root, phaseDir), "transfers-pending");
  const plans = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => readJsonIf(path.join(dir, f), null)).filter(Boolean) : [];
  return { pending: plans.map((p) => ({ plan: p.plan, worktree: p.worktree, paths: p.paths ?? [] })) };
}

export function spotCheck(root, summaryRel) {
  const abs = resolveInside(root, summaryRel);
  if (!fs.existsSync(abs)) return { ok: false, missing: [summaryRel], code: 1 };
  const kf = keyFiles(readText(abs));
  const checked = [...kf.created, ...kf.modified].slice(0, 2);
  const missing = checked.filter((p) => !fs.existsSync(path.resolve(root, p)));
  return { ok: missing.length === 0, checked, missing, code: missing.length ? 1 : 0 };
}
