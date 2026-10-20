import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { VERBS } from "../../ship/.agents/harness/gsd/commands.mjs";
import { testEnv } from "../helpers/env.mjs";
import { runNode, runPh } from "../helpers/run.mjs";
import { makeTempDir } from "../helpers/temp.mjs";
import { P1, gsd, plan, project } from "./fixture.mjs";

const PH = fileURLToPath(new URL("../../ship/.agents/harness/ph.mjs", import.meta.url));
const phNode = (p, args, opts = {}) => runNode(PH, ["gsd", ...args], { cwd: p.root, env: { ...testEnv(), PASEO_HARNESS_ROOT: p.root }, ...opts });

function commit(p, file, subject) {
  p.write(file, `${subject}\n`);
  p.git("add", "-A");
  p.git("commit", "-q", "-m", subject);
  return p.git("rev-parse", "HEAD");
}

test("GSDC-02 ph gsd output and exit contract through the ph entry", async () => {
  const p = project({ files: { [`${P1}/01-01-PLAN.md`]: plan() } });
  const ok = await runPh(["gsd", "find-phase", "1"], { root: p.root });
  assert.equal(ok.code, 0);
  assert.equal(JSON.parse(ok.out.at(-1)).found, true);
  const missing = await runPh(["gsd", "roadmap", "get-phase", "9"], { root: p.root });
  assert.equal(missing.code, 66);
  const unported = await runPh(["gsd", "query", "todo.match-phase"], { root: p.root });
  assert.equal(unported.code, 69);
  const absent = await runPh(["gsd", "find-phase", "1", "--pick", "missing.field"], { root: p.root });
  assert.deepEqual([absent.code, absent.stdout], [1, ""]);
  assert.match(absent.stderr, /pick_field_absent: missing\.field; available keys: .*found/);
  const nul = await runPh(["gsd", "roadmap", "get-phase", "1", "--pick", "goal"], { root: p.root });
  assert.equal(nul.stdout, "Core works\n");
  const nullField = await runPh(["gsd", "init.plan-phase", "1", "--pick", "context_path"], { root: p.root });
  assert.deepEqual([nullField.code, nullField.stdout], [0, "\n"]);
  assert.equal((await runPh(["gsd", "roadmap", "analyze", "--pick", "phases[-1].name"], { root: p.root })).stdout, "Ui\n");
  const hash = phNode(p, ["hash"], { input: "x\n" });
  assert.match(hash.stdout, /^\{"hash":"[0-9a-f]{64}"\}\n$/);
  const rwt = phNode(p, ["run-with-timeout", "5", "--", process.execPath, "-e", "console.log('x');process.exit(3)"]);
  assert.equal(rwt.code, 3);
  assert.equal(rwt.out[0], "x");
  assert.deepEqual(JSON.parse(rwt.out.at(-1)).code, 3);
  const err = await runPh(["gsd", "waves"], { root: p.root });
  assert.equal(err.code, 1);
  assert.equal(JSON.parse(err.out.at(-1)).status, "error");
  const bad = project({ overlay: { adapter: { unknown_x: 1 } } });
  const cfg = await runPh(["gsd", "find-phase", "1"], { root: bad.root });
  assert.equal(cfg.code, 1);
  assert.match(JSON.parse(cfg.out.at(-1)).error, /invalid harness config adapter\.unknown_x: unknown key/);
});

test("GSDC-03 --root reads another worktree; a folder without .git exits 69", async () => {
  const p = project();
  const wt = path.join(makeTempDir("paseo kit wt "), "wt one");
  p.git("worktree", "add", "-q", "--detach", wt);
  fs.mkdirSync(path.join(wt, P1), { recursive: true });
  fs.writeFileSync(path.join(wt, P1, "01-01-PLAN.md"), plan());
  assert.deepEqual((await gsd(p, ["waves", "1"])).json.waves, []);
  const r = await gsd(p, ["waves", "1", "--root", wt]);
  assert.deepEqual(r.json.waves, [{ wave: 1, plans: ["01-01"] }]);
  const plain = makeTempDir("paseo kit plain ");
  assert.equal((await gsd(p, ["waves", "1", "--root", plain])).code, 69);
});

test("GSDC-04 every not-ported verb answers 69 with its reason, never 0", async () => {
  const p = project();
  const r = await gsd(p, ["query", "todo.match-phase"]);
  assert.deepEqual([r.code, r.json.status, r.json.verb], [69, "unavailable", "todo.match-phase"]);
  assert.ok(r.json.reason);
  for (const [verb, entry] of Object.entries(VERBS)) {
    if (entry.ported) continue;
    const res = await gsd(p, [verb]);
    assert.equal(res.code, 69, verb);
  }
  assert.equal((await gsd(p, ["no-such-verb"])).code, 69);
});

test("GSDC-38 commit: docs skip envelope, message verbatim, unrelated dirty file unstaged", async () => {
  const p = project();
  p.write(".planning/notes.md", "n");
  const skip = await gsd(p, ["commit", "docs: notes", "--files", ".planning/notes.md"]);
  assert.deepEqual(skip.json, { committed: false, skipped: true, hash: null, reason: "skipped_commit_docs_false" });
  p.write(".gitignore", "build/\n");
  p.git("add", ".gitignore");
  p.git("commit", "-q", "-m", "ignore");
  p.write("build/out.txt", "x");
  assert.equal((await gsd(p, ["commit", "chore: out", "--files", "build/out.txt"])).json.reason, "skipped_gitignored");
  p.write("src/a.js", "a");
  p.write("src/dirty.js", "d");
  const msg = 'feat(01-01): add "; rm -rf x';
  const r = await gsd(p, ["commit", msg, "--files", "src/a.js"]);
  assert.equal(r.json.committed, true, JSON.stringify(r.json));
  assert.equal(p.git("log", "-1", "--format=%s"), msg);
  assert.match(p.git("status", "--porcelain"), /\?\? src\/dirty\.js/);
  p.git("rm", "-q", "--cached", "src/a.js");
  fs.rmSync(p.path("src/a.js"));
  assert.equal((await gsd(p, ["commit", "chore: drop a", "--files-removed", "src/a.js"])).json.committed, true);
});

test("GSDC-39 evaluation-scope: own commits only, exact plan scope, wave commits through commits.json", async () => {
  const p = project({ files: { ".planning/phases/02.1-y/.keep": "" } });
  const a = commit(p, "src/one.js", "feat(03-01): one");
  commit(p, "src/other.js", "chore: unrelated");
  const b = commit(p, "src/two.js", "feat(03-02): two");
  const c = commit(p, "src/ten.js", "feat(03-010): ten");
  const phase = (await gsd(p, ["check", "evaluation-scope", "--phase", "3"])).json;
  assert.deepEqual(phase.commits.map((x) => x.sha).sort(), [a, b, c].sort());
  assert.ok(!phase.files.includes("src/other.js"));
  const one = (await gsd(p, ["check", "evaluation-scope", "--plan", "03-01"])).json;
  assert.deepEqual(one.commits.map((x) => x.sha), [a]);
  p.write("src/w1a.js", "a");
  p.write("src/w1b.js", "b");
  p.git("add", "-A");
  p.git("commit", "-q", "-m", "feat(02.1-w1): wave 1");
  const w = p.git("rev-parse", "HEAD");
  p.writeJson(".planning/phases/02.1-y/commits.json", [{ sha: w, phase: "02.1", wave: 1, plans: { "02.1-01": ["src/w1a.js"], "02.1-02": ["src/w1b.js"] } }]);
  const two = (await gsd(p, ["check", "evaluation-scope", "--plan", "02.1-02"])).json;
  assert.deepEqual([two.status, two.commits.map((x) => x.sha), two.files], ["resolved", [w], ["src/w1b.js"]]);
  const none = (await gsd(p, ["check", "evaluation-scope", "--plan", "03-05"])).json;
  assert.deepEqual([none.status, none.reason], ["resolved", "no-matching-commits"]);
  const plain = makeTempDir("paseo kit norepo ");
  fs.mkdirSync(path.join(plain, ".git"));
  assert.equal((await gsd(p, ["check", "evaluation-scope", "--phase", "3", "--root", plain])).code, 69);
});

test("GSDC-40 select-revert-commits: exact scopes, shared wave commits named with siblings", async () => {
  const p = project();
  const base = p.git("rev-parse", "HEAD");
  const two = commit(p, "src/two.js", "feat(03-02): two");
  commit(p, "src/twenty.js", "feat(03-020): twenty");
  p.write("src/w.js", "w");
  p.git("add", "-A");
  p.git("commit", "-q", "-m", "feat(03-w1): wave");
  const w = p.git("rev-parse", "HEAD");
  p.writeJson(".planning/phases/03-ui/commits.json", [{ sha: w, phase: "03", wave: 1, plans: { "03-01": ["src/w.js"], "03-02": ["src/w.js"] } }]);
  const r = (await gsd(p, ["select-revert-commits", "--plan", "03-02", "--range", `${base}..HEAD`])).json;
  assert.deepEqual(r.commits.map((c) => [c.sha, c.shared, c.siblings]), [[w, true, ["03-01"]], [two, false, []]]);
  const ph = (await gsd(p, ["select-revert-commits", "--phase", "3", "--range", `${base}..HEAD`])).json;
  assert.equal(ph.commits.length, 3);
});

test("GSDC-41 run-with-timeout kills at the deadline; normalize-test-command", async () => {
  const p = project({ git: false });
  const t0 = Date.now();
  const r = phNode(p, ["run-with-timeout", "1", "--", process.execPath, "-e", "setTimeout(() => console.log('late'), 30000)"]);
  assert.equal(r.code, 124);
  assert.equal(JSON.parse(r.out.at(-1)).timedOut, true);
  assert.ok(Date.now() - t0 < 20000);
  assert.ok(!r.stdout.includes("late"));
  assert.deepEqual((await gsd(p, ["normalize-test-command", "vitest"])).json, { command: "vitest run" });
  assert.deepEqual((await gsd(p, ["normalize-test-command", "jest", "--watch"])).json, { command: "jest" });
  assert.deepEqual((await gsd(p, ["normalize-test-command", "pytest", "-q"])).json, { command: "pytest -q" });
});
