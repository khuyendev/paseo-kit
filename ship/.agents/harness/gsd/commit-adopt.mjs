// `ph gsd commit adopt <phase> <sha> --reason <text>` (kit feedback 94 F2): the owner's answer to a safe-resume gate that stops on
// a commit the owner made between runs. The gate reconciles a commit only through a `Plans:` trailer that names every plan owning
// its files (a path meant for orchestrator commits whose record failed); an owner fix of completed plans' files, often with a file
// outside the phase, has no such route. This verb records the commit in <phase>/commits.json as the owner's: an entry
// {sha, phase, wave: null, owner: {reason, plans: {<id>: [files]}, outside: [files], at}}, so the gate counts it among the recorded
// commits and goes on, without a history rewrite. The plan files sit under `owner`, never under a top-level `plans`, so evaluation
// scope, review scope and changed lines never take the owner's commit for a plan's own commit. Only a commit after the execute
// baseline, reachable from HEAD and not recorded yet qualifies, and only when every file it changes belongs to plans with a recorded
// commit or to no plan of the phase: a file of a plan not committed yet belongs to that plan's run, so the verb refuses and names it.
import fs from "node:fs";
import path from "node:path";
import { readStateFile, STATE_FILE } from "../lib/execute-state.mjs";
import { readJsonIf, writeJsonAtomic } from "../lib/io.mjs";
import { done, fail, nowIso, rel, withFileLock } from "./common.mjs";
import { ownsDepth } from "./adapter-hooks.mjs";
import { git } from "./git.mjs";
import { appendAnswer } from "./owner-answers.mjs";
import { readPlans, summaryPath } from "./planning.mjs";
import { guardWriter } from "./state.mjs";

const lines = (r) => (r.code === 0 ? r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : []);

// The plans owning a file through their most specific owns entry, as the resume gate judges (workflows/lib/flow-owns.mjs
// specificOwners, with the same matcher); repeated here because the harness is installed without the workflows.
function ownersOf(file, plans, prefixes) {
  const bare = (entry) => {
    let p = String(entry).trim().replace(/^`|`$/g, "");
    for (const pre of prefixes) if (p.startsWith(pre)) { p = p.slice(pre.length).trim(); break; }
    return p.replace(/\\/g, "/").replace(/^\.\//, "");
  };
  let best = -1;
  let out = [];
  for (const pl of plans) {
    const d = Math.max(-1, ...pl.owns.map(bare).filter(Boolean).map((o) => ownsDepth(o, file)));
    if (d < 0 || d < best) continue;
    if (d > best) { best = d; out = []; }
    out.push(pl.id);
  }
  return out;
}

// The owns the resume gate judges with: a plan's handoff tasks (<phase>/handoff/*.args.json), else its frontmatter owns.
function handoffOwns(phase) {
  const dir = path.join(phase.dir, "handoff");
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".args.json"))) {
    let h = null;
    try { h = readJsonIf(path.join(dir, f), null); } catch { h = null; }
    for (const t of Array.isArray(h?.tasks) ? h.tasks : []) if (t?.plan) out[t.plan] = [...new Set([...(out[t.plan] ?? []), ...(t.owns ?? []).map(String)])];
  }
  return out;
}

export function commitAdopt(g, phase, ref, reason) {
  guardWriter(g.env);
  const root = g.codeRoot;
  const why = String(reason ?? "").trim();
  if (!ref) throw fail("commit adopt needs the commit: ph gsd commit adopt <phase> <sha> --reason <why the commit stands>");
  if (!why) throw fail("commit adopt needs --reason <why the commit stands>");
  const resolved = git(root, ["rev-parse", "--verify", "-q", `${ref}^{commit}`]);
  if (resolved.code !== 0) throw fail(`commit adopt: ${ref} is not a commit of this repository`);
  const sha = resolved.stdout.trim();
  const base = readJsonIf(path.join(phase.dir, "execute-baseline.json"), null);
  if (!base?.head) throw fail(`commit adopt: ${rel(root, phase.dir)} has no execute baseline, so no resume gate waits on a commit; nothing to adopt`);
  if (!lines(git(root, ["rev-list", `${base.head}..HEAD`])).includes(sha)) throw fail(`commit adopt: ${sha.slice(0, 12)} is not a commit after the execute baseline ${base.head.slice(0, 12)} on HEAD; the resume gate never looks at it`);
  const commitsFile = path.join(phase.dir, "commits.json");
  const recorded = readJsonIf(commitsFile, []) ?? [];
  if (!Array.isArray(recorded)) throw fail(`${rel(root, commitsFile)} is not a JSON array`);
  if (recorded.some((c) => c?.sha === sha)) throw fail(`commit adopt: ${sha.slice(0, 12)} is recorded in ${rel(root, commitsFile)} already`);
  // A plan is committed when execute-progress.json or a plan entry of commits.json holds its commit.
  const st = readStateFile(path.join(phase.dir, STATE_FILE)).state;
  const committed = new Set([...Object.keys(st.plans ?? {}).filter((id) => st.plans[id]?.commit !== undefined), ...recorded.flatMap((c) => Object.keys(c?.plans ?? {}))]);
  const fromHandoff = handoffOwns(phase);
  const plans = readPlans(phase).map((p) => ({ id: p.id, owns: [...(fromHandoff[p.id] ?? p.owns), rel(root, summaryPath(phase, p.id))] }));
  const prefixes = (g.cfg.adapter?.ownership?.owns_forms ?? [{ prefix: "Path:" }]).map((f) => f.prefix).filter(Boolean);
  const files = lines(git(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", "-m", "--root", sha]));
  if (!files.length) throw fail(`commit adopt: ${sha.slice(0, 12)} changes no file`);
  const byPlan = {};
  const outside = [];
  const open = [];
  for (const f of [...new Set(files)]) {
    const owners = ownersOf(f, plans, prefixes);
    if (!owners.length) outside.push(f);
    else if (owners.every((id) => committed.has(id))) for (const id of owners) (byPlan[id] ??= []).push(f);
    else open.push(`${f} (${owners.filter((id) => !committed.has(id)).join(", ")})`);
  }
  if (open.length) throw fail(`commit adopt: ${sha.slice(0, 12)} changes files of plans not committed yet: ${open.join(", ")}; those files belong to the plan's own run: commit them apart from the rest (or revert them), then adopt the commit that holds only the others`);
  const entry = { sha, phase: phase.padded, wave: null, owner: { reason: why, plans: byPlan, outside, at: nowIso() } };
  withFileLock(`${commitsFile}.lock`, () => {
    const now = readJsonIf(commitsFile, []) ?? [];
    if (now.some((c) => c?.sha === sha)) throw fail(`commit adopt: ${sha.slice(0, 12)} is recorded in ${rel(root, commitsFile)} already`);
    writeJsonAtomic(commitsFile, [...now, entry]);
  });
  const answer = appendAnswer(phase, { kind: "commit", sha, reason: why });
  return done({ adopted: sha, answered: answer.id, plans: byPlan, outside, reason: why, commits: rel(root, commitsFile), next: "rerun gsd-execute with the same args; the resume gate counts the commit as recorded" });
}
