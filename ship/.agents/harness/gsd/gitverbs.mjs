// Commit and commit-scope verbs: commit (GSDC-38), evaluation-scope (GSDC-39), select-revert-commits (GSDC-40).
// Subjects carry the conventional scope `type(<phase>-<plan>)` or `type(<phase>-w<k>)`; commits.json maps wave commits to plans.
import path from "node:path";
import { readJsonIf } from "../lib/io.mjs";
import { done, fail, rel, unavailable } from "./common.mjs";
import { git, gitOk } from "./git.mjs";
import { findPhase, normPlanId, padPhase } from "./planning.mjs";
import { guardWriter } from "./state.mjs";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export function commitVerb(g, message, files, removed) {
  guardWriter(g.env);
  if (!message) throw fail("commit needs a message");
  if (!files.length && !removed.length) throw fail("commit needs --files <paths...>");
  const all = [...files, ...removed].map((f) => f.replace(/\\/g, "/"));
  if (!g.cfg.gsd.commit_policy.docs && all.every((f) => f.replace(/^\.\//, "").startsWith(".planning/"))) {
    return done({ committed: false, skipped: true, hash: null, reason: "skipped_commit_docs_false" });
  }
  const ignored = new Set(git(g.codeRoot, ["check-ignore", "--", ...files]).stdout.split(/\r?\n/).filter(Boolean).map((f) => f.replace(/\\/g, "/")));
  const stage = files.filter((f) => !ignored.has(f.replace(/\\/g, "/")));
  if (!stage.length && !removed.length) return done({ committed: false, skipped: true, hash: null, reason: "skipped_gitignored" });
  if (stage.length) gitOk(g.codeRoot, ["add", "--", ...stage]);
  if (removed.length) gitOk(g.codeRoot, ["rm", "-q", "--cached", "--ignore-unmatch", "--", ...removed]);
  const r = git(g.codeRoot, ["commit", "-q", "-m", message, "--", ...stage, ...removed]);
  if (r.code !== 0) throw fail(`git commit failed: ${(r.stderr || r.stdout).trim().split("\n")[0]}`);
  return done({ committed: true, hash: gitOk(g.codeRoot, ["rev-parse", "HEAD"]).trim(), files: stage, removed, skipped_ignored: files.filter((f) => !stage.includes(f)) });
}

// `feat(02.1-w1): x` -> {phase: "02.1", unit: "w1"}; anything else -> null.
export function subjectScope(subject) {
  const m = /^[a-z]+\(([^)]+)\)!?:/i.exec(subject);
  if (!m) return null;
  const s = /^(\d+(?:\.\d+)*)-(w\d+|\d+)$/.exec(m[1].trim());
  return s ? { raw: m[1].trim(), phase: padPhase(s[1]), unit: s[2], plan: /^\d+$/.test(s[2]) ? normPlanId(`${s[1]}-${s[2]}`) : null } : { raw: m[1].trim(), phase: null, unit: null, plan: null };
}

function logCommits(root, range, max) {
  const args = ["log", "--format=%H%x09%s", `--max-count=${max}`];
  if (range) args.push(range);
  return gitOk(root, args)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [sha, ...rest] = line.split("\t");
      const subject = rest.join("\t");
      return { sha, subject, scope: subjectScope(subject) };
    });
}

const changedFiles = (root, sha) => gitOk(root, ["show", "--name-only", "--format=", "--no-renames", sha]).split(/\r?\n/).filter(Boolean);

const commitMap = (phase) => (phase ? (readJsonIf(path.join(phase.dir, "commits.json"), []) ?? []) : []);

const mappedPlans = (map, sha) => map.find((e) => e.sha === sha || (e.sha && sha.startsWith(e.sha)))?.plans ?? null;

export function evaluationScope(g, { phase: phaseRef, plan, quick, since, commitsOnly, maxCommits = 500 }) {
  if ([phaseRef, plan, quick].filter(Boolean).length !== 1) throw fail("evaluation-scope needs exactly one of --phase, --plan, --quick");
  const root = g.codeRoot;
  if (git(root, ["rev-parse", "--git-dir"]).code !== 0) throw unavailable("code root is not a readable git repository");
  const planId = plan ? normPlanId(plan) : null;
  const phaseNum = phaseRef ? padPhase(phaseRef) : planId ? planId.split("-")[0] : null;
  const phase = phaseNum ? findPhase(root, phaseNum) : null;
  const map = commitMap(phase);
  const commits = logCommits(root, since ? `${since}..HEAD` : null, maxCommits);
  const own = [];
  for (const c of commits) {
    const s = c.scope;
    if (quick) {
      if (s?.raw === quick || s?.raw === `quick-${quick}`) own.push({ ...c, files: null });
      continue;
    }
    if (!s?.phase || s.phase !== phaseNum) continue;
    if (!planId) own.push({ ...c, files: null });
    else if (s.plan === planId) own.push({ ...c, files: null });
    else if (s.unit?.startsWith("w")) {
      const plans = mappedPlans(map, c.sha);
      if (plans && Object.hasOwn(plans, planId)) own.push({ ...c, files: plans[planId] });
    }
  }
  const unreachable = map.filter((e) => (!planId || Object.hasOwn(e.plans ?? {}, planId)) && git(root, ["merge-base", "--is-ancestor", e.sha, "HEAD"]).code !== 0).map((e) => e.sha);
  const out = { status: "resolved", source: quick ? "quick" : planId ? "plan" : "phase", unit: quick ?? planId ?? phaseNum, unreachable };
  if (!own.length) {
    if (planId || quick) return done({ ...out, reason: "no-matching-commits", commits: [], files: [], outsideUnion: [] });
    if (!phase) return done({ ...out, reason: "no-matching-commits", commits: [], files: [], outsideUnion: [] });
    const touching = gitOk(root, ["log", "--format=%H", `--max-count=${maxCommits}`, "--", rel(root, phase.dir)]).split(/\r?\n/).filter(Boolean);
    if (!touching.length) return done({ ...out, reason: "no-matching-commits", commits: [], files: [], outsideUnion: [] });
    const first = touching[touching.length - 1];
    const base = git(root, ["rev-parse", "--verify", "-q", `${first}^`]).code === 0 ? `${first}^` : EMPTY_TREE;
    const files = gitOk(root, ["diff", "--name-only", base, "HEAD"]).split(/\r?\n/).filter(Boolean);
    return done({ ...out, status: "degraded", reason: `no scoped commits; used the phase-directory range ${base}..HEAD`, commits: [], files: commitsOnly ? undefined : files.sort(), outsideUnion: [] });
  }
  const union = new Set();
  if (!commitsOnly) for (const c of own) for (const f of c.files ?? changedFiles(root, c.sha)) union.add(f);
  let outsideUnion = [];
  if (since && !commitsOnly) {
    const ranged = gitOk(root, ["diff", "--name-only", since, "HEAD"]).split(/\r?\n/).filter(Boolean);
    outsideUnion = ranged.filter((f) => !union.has(f));
  }
  return done({ ...out, commits: own.map((c) => ({ sha: c.sha, subject: c.subject, ...(c.files ? { mapped_files: c.files } : {}) })), files: commitsOnly ? undefined : [...union].sort(), outsideUnion });
}

export function selectRevertCommits(g, { phase: phaseRef, plan, range }) {
  if (!range) throw fail("select-revert-commits needs --range");
  if (!phaseRef === !plan) throw fail("select-revert-commits needs exactly one of --phase, --plan");
  const planId = plan ? normPlanId(plan) : null;
  const phaseNum = phaseRef ? padPhase(phaseRef) : planId.split("-")[0];
  const map = commitMap(findPhase(g.codeRoot, phaseNum));
  const picked = [];
  for (const c of logCommits(g.codeRoot, range, 10000)) {
    const s = c.scope;
    if (!s?.phase || s.phase !== phaseNum) continue;
    if (!planId) {
      picked.push({ sha: c.sha, subject: c.subject, scope: s.raw });
      continue;
    }
    if (s.plan === planId) picked.push({ sha: c.sha, subject: c.subject, scope: s.raw, shared: false, siblings: [] });
    else if (s.unit?.startsWith("w")) {
      const plans = mappedPlans(map, c.sha);
      if (plans && Object.hasOwn(plans, planId)) {
        const siblings = Object.keys(plans).filter((p) => p !== planId);
        picked.push({ sha: c.sha, subject: c.subject, scope: s.raw, shared: siblings.length > 0, siblings });
      }
    }
  }
  return done({ unit: planId ?? phaseNum, range, commits: picked });
}
