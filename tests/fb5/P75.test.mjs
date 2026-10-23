// Kit feedback #75 (P75): executor worktrees are removed after their plan's commit (their delta landed by transfer), a halted plan's
// worktree after its halt is cleared and the plan runs again, `ph worktrees --prune` removes a `transferred` tree, and every
// harness removal unlinks all links of the tree first (a junction an agent made included) and refuses when one stays.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { mock } from "node:test";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../../ship/.agents/harness/config.mjs";
import { clearLinks, findLinks } from "../../ship/.agents/harness/runtime/worktree-links.mjs";
import { classify, createWorktree, discardWorktree, listHarnessWorktrees, removeWorktree, runGit } from "../../ship/.agents/harness/runtime/worktrees.mjs";
import { sha256 } from "../../ship/.agents/harness/lib/hash.mjs";
import { executor, makeExecWorld, task } from "../gsd-flows/exec-world.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { PHASE_DIR } from "../gsd-flows/world.mjs";
import { gsd as runGsdIn, project as gsdProject } from "../gsd-core/fixture.mjs";
import { makeTempDir, SHIP_DIR } from "../helpers/temp.mjs";
import { setup } from "../ph/setup.mjs";

const { main } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
const RUN = "wf_20261020-120000_ab12";
const IGNORE = { ".gitignore": ".claude/worktrees/\n_workspace/\n", "src/tracked.txt": "t\n" };

async function flow(root, argv, input = "") {
  let line = "";
  const code = await main(argv, { root, input: typeof input === "string" ? input : JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}
const branches = (git) => git("branch", "--list", "harness/*").split("\n").map((b) => b.replace(/^[*+ ]+/, "").trim()).filter(Boolean);
const registered = (git) => git("worktree", "list", "--porcelain").split("\n").filter((l) => l.startsWith("worktree ")).length;

// A git project, a finished run `RUN`, and a harness worktree `<RUN>-<n>` of it.
async function tree(files = IGNORE, n = 1) {
  const s = setup({ git: true, files });
  const cfg = loadConfig(s.root);
  s.project.write(`_workspace/_runs/${RUN}/run.json`, JSON.stringify({ status: "done" }));
  const wt = await createWorktree(s.root, cfg, `${RUN}-${n}`);
  const top = wt.top;
  const git = s.project.git;
  const listed = () => listHarnessWorktrees(top, cfg).find((w) => w.name === `${RUN}-${n}`);
  const state = () => classify(top, listed(), { runsDir: path.join(s.root, "_workspace/_runs"), root: s.root });
  // What the transfer verb leaves: one entry per copied path with the content hash, and the worktree it came from.
  const record = (files, extra = {}) => s.project.write(`${PHASE_DIR}/transfers/01-01.json`, JSON.stringify({ plan: "01-01", worktree: wt.path.replaceAll("\\", "/"), base: "x", files, dropped: [], ...extra }));
  return { s, cfg, wt, top, git, listed, state, record };
}
const put = (t, rel, text) => { fs.mkdirSync(path.dirname(path.join(t.wt.path, rel)), { recursive: true }); fs.writeFileSync(path.join(t.wt.path, rel), text); return sha256(Buffer.from(text)); };

// ---- F4: links ----

test("P75 F4 discardWorktree unlinks a junction no record names (also a nested one) and never touches its target", async () => {
  const t = await tree();
  const outside = makeTempDir("p75 outside ");
  fs.writeFileSync(path.join(outside, "precious.txt"), "keep");
  fs.mkdirSync(path.join(t.wt.path, "src/deep"), { recursive: true });
  fs.symlinkSync(outside, path.join(t.wt.path, "upstream"), "junction");
  fs.symlinkSync(outside, path.join(t.wt.path, "src/deep/paseo"), "junction");
  const r = discardWorktree(t.wt);
  assert.equal(r.ok, true, r.reason);
  assert.equal(fs.existsSync(t.wt.path), false);
  assert.equal(fs.readFileSync(path.join(outside, "precious.txt"), "utf8"), "keep");
  assert.deepEqual(branches(t.git), []);
  assert.equal(registered(t.git), 1);
});

test("P75 F4 removeWorktree (ph worktrees --prune) does the same for a clean tree holding an unrecorded junction", async () => {
  const t = await tree();
  const outside = makeTempDir("p75 outside ");
  fs.writeFileSync(path.join(outside, "precious.txt"), "keep");
  fs.symlinkSync(outside, path.join(t.wt.path, "extra"), "junction");
  const r = removeWorktree(t.top, { ...t.listed(), missing: false });
  assert.equal(r.ok, true, r.line);
  assert.equal(fs.existsSync(t.wt.path), false);
  assert.equal(fs.readFileSync(path.join(outside, "precious.txt"), "utf8"), "keep");
});

test("P75 F4 findLinks and clearLinks never follow a link: a link inside a linked folder stays with its folder", () => {
  const dir = makeTempDir("p75 links ");
  const wt = path.join(dir, "wt");
  const a = path.join(dir, "a");
  const b = path.join(dir, "b");
  fs.mkdirSync(wt);
  fs.mkdirSync(a);
  fs.mkdirSync(b);
  fs.writeFileSync(path.join(b, "file.txt"), "b");
  fs.symlinkSync(b, path.join(a, "to-b"), "junction");
  fs.symlinkSync(a, path.join(wt, "to-a"), "junction");
  assert.deepEqual(findLinks(wt).links, [path.join(wt, "to-a")]);
  const r = clearLinks(wt);
  assert.deepEqual([r.unlinked.length, r.refused.length], [1, 0]);
  assert.equal(fs.existsSync(path.join(a, "to-b")), true);
  assert.equal(fs.readFileSync(path.join(b, "file.txt"), "utf8"), "b");
});

test("P75 F4 a link that cannot be unlinked keeps the tree, the branch and the target, and says which link", async () => {
  const t = await tree();
  const outside = makeTempDir("p75 outside ");
  fs.writeFileSync(path.join(outside, "precious.txt"), "keep");
  const link = path.join(t.wt.path, "stuck");
  fs.symlinkSync(outside, link, "junction");
  const real = fs.rmSync;
  const stub = mock.method(fs, "rmSync", (p, ...rest) => { if (path.resolve(String(p)) === path.resolve(link)) throw Object.assign(new Error("denied"), { code: "EPERM" }); return real(p, ...rest); });
  try {
    const d = discardWorktree(t.wt);
    assert.equal(d.ok, false);
    assert.match(d.reason, /stuck/);
    assert.match(d.reason, /EPERM/);
    const r = removeWorktree(t.top, { ...t.listed(), missing: false });
    assert.equal(r.ok, false);
    assert.match(r.line, /stuck/);
  } finally {
    stub.mock.restore();
  }
  assert.equal(fs.existsSync(t.wt.path), true);
  assert.deepEqual(branches(t.git), [`harness/${RUN}-1`]);
  assert.equal(fs.readFileSync(path.join(outside, "precious.txt"), "utf8"), "keep");
  assert.equal(discardWorktree(t.wt).ok, true);
});

test("P75 F4 a worktree directory that is itself a link is refused and left alone", () => {
  const outside = makeTempDir("p75 outside ");
  fs.writeFileSync(path.join(outside, "precious.txt"), "keep");
  const holder = makeTempDir("p75 holder ");
  const dir = path.join(holder, "wt");
  fs.symlinkSync(outside, dir, "junction");
  const r = clearLinks(dir);
  assert.equal(r.refused.length, 1);
  assert.match(r.refused[0].reason, /itself a link/);
  assert.equal(fs.readFileSync(path.join(outside, "precious.txt"), "utf8"), "keep");
});

// ---- F1: the transfer record and the `transferred` state ----

test("P75 F1 a dirty tree whose every changed path is in a transfer record with the same hash is transferred and removable", async () => {
  const t = await tree();
  const h = put(t, "src/a.js", "a\n");
  const d = put(t, "src/b.js", "b\n");
  assert.equal(t.state().state, "uncommitted changes");
  t.record([{ path: "src/a.js", sha256: h, wt_sha256: h }, { path: "src/b.js", sha256: d, wt_sha256: d }]);
  const c = t.state();
  assert.deepEqual([c.state, c.removable], ["transferred", true]);
  // A record written before wt_sha256 existed holds the copied bytes' hash in sha256.
  t.record([{ path: "src/a.js", sha256: h }, { path: "src/b.js", sha256: d }]);
  assert.equal(t.state().state, "transferred");
  // adopt rewrites sha256 to the owner's hand fix; wt_sha256 still names what the worktree held.
  t.record([{ path: "src/a.js", sha256: "hand-fixed", wt_sha256: h }, { path: "src/b.js", sha256: d, wt_sha256: d }]);
  assert.equal(t.state().state, "transferred");
});

test("P75 F1 anything not landed keeps the tree: no record, an edit after the transfer, an extra file, a commit, a pending transfer, another worktree's record", async () => {
  const t = await tree();
  const h = put(t, "src/a.js", "a\n");
  assert.equal(t.state().state, "uncommitted changes");
  t.record([{ path: "src/a.js", sha256: h, wt_sha256: h }]);
  assert.equal(t.state().state, "transferred");
  put(t, "src/a.js", "a edited later\n");
  assert.equal(t.state().state, "uncommitted changes");
  put(t, "src/a.js", "a\n");
  put(t, "src/extra.js", "x\n");
  assert.equal(t.state().state, "uncommitted changes");
  fs.rmSync(path.join(t.wt.path, "src/extra.js"));
  assert.equal(t.state().state, "transferred");
  t.s.project.write(`${PHASE_DIR}/transfers-pending/01-01.json`, JSON.stringify({ plan: "01-01" }));
  assert.equal(t.state().state, "uncommitted changes");
  fs.rmSync(t.s.project.path(`${PHASE_DIR}/transfers-pending`), { recursive: true });
  t.record([{ path: "src/a.js", sha256: h, wt_sha256: h }], { worktree: ".claude/worktrees/some-other" });
  assert.equal(t.state().state, "uncommitted changes");
  t.record([{ path: "src/a.js", sha256: h, wt_sha256: h }]);
  runGit(t.wt.path, ["add", "-A"]);
  runGit(t.wt.path, ["-c", "user.email=a@b.c", "-c", "user.name=n", "commit", "-qm", "agent commit"]);
  put(t, "src/more.js", "m\n");
  assert.equal(t.state().state, "uncommitted changes");
});

test("P75 F1 a deleted path counts when the record says deleted and the file is still gone; a dropped path needs its hash", async () => {
  const t = await tree();
  fs.rmSync(path.join(t.wt.path, "src/tracked.txt"));
  const g = put(t, "gen/out.js", "generated\n");
  t.record([{ path: "src/tracked.txt", deleted: true }], { dropped: [{ path: "gen/out.js", reason: "regenerated" }] });
  assert.equal(t.state().state, "uncommitted changes");
  t.record([{ path: "src/tracked.txt", deleted: true }], { dropped: [{ path: "gen/out.js", reason: "regenerated", wt_sha256: g }] });
  assert.equal(t.state().state, "transferred");
  put(t, "src/tracked.txt", "back\n");
  assert.equal(t.state().state, "uncommitted changes");
});

test("P75 F1 ph worktrees --prune removes a transferred tree and its branch, and keeps one with unlanded work", async () => {
  const t = await tree();
  const h = put(t, "src/a.js", "a\n");
  t.record([{ path: "src/a.js", sha256: h, wt_sha256: h }]);
  const other = await createWorktree(t.s.root, t.cfg, `${RUN}-2`);
  fs.writeFileSync(path.join(other.path, "work.js"), "unmerged\n");
  const listed = await t.s.ph(["worktrees"]);
  assert.match(listed.stdout, new RegExp(`transferred\\s+harness/${RUN}-1`));
  assert.match(listed.stdout, new RegExp(`uncommitted changes\\s+harness/${RUN}-2`));
  const pruned = await t.s.ph(["worktrees", "--prune"]);
  assert.match(pruned.stdout, /removed .*-1 and branch/);
  assert.match(pruned.stdout, /1 removed/);
  assert.equal(fs.existsSync(t.wt.path), false);
  assert.equal(fs.existsSync(other.path), true);
  assert.deepEqual(branches(t.git), [`harness/${RUN}-2`]);
});

test("P75 F1 the discard-worktree verb removes a landed tree, keeps an unlanded one, reports a missing one and refuses bad input", async () => {
  const t = await tree();
  const h = put(t, "src/a.js", "a\n");
  const call = (extra = {}) => flow(t.s.root, ["discard-worktree"], { plan: "01-01", worktree: t.wt.path, reason: "landed", ...extra });
  const none = await call();
  assert.deepEqual([none.json.removed, none.json.why], [false, "its delta is not all in the transfer record"]);
  assert.equal(fs.existsSync(t.wt.path), true);
  t.record([{ path: "src/a.js", sha256: h, wt_sha256: h }]);
  const ok = await call();
  assert.equal(ok.json.removed, true, JSON.stringify(ok.json));
  assert.equal(fs.existsSync(t.wt.path), false);
  assert.deepEqual(branches(t.git), []);
  assert.equal((await call()).json.gone, true);
  assert.equal((await call({ reason: "later" })).code, 1);
  assert.equal((await call({ plan: "x" })).code, 1);
});

// ---- the flow ----

const exec = (w, overrides = {}, args = {}, runId) => runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR, ...args }, gsd: w.gsd, agent: executor(w, overrides), ...(runId ? { runId } : {}) });
const worktreeDirs = (w) => (fs.existsSync(path.join(w.root, ".claude/worktrees")) ? fs.readdirSync(path.join(w.root, ".claude/worktrees")).filter((n) => !n.endsWith(".lease")) : []);

test("P75 F1 gsd-execute in worktree isolation discards every executor worktree and branch after the commit and says so", async () => {
  const w = makeExecWorld({ waves: [[task("01-01"), task("01-02")]], overlay: { gsd: { isolation: "worktree" } } });
  const r = await exec(w);
  assert.equal(r.result.status, "executed");
  assert.deepEqual([...r.result.worktrees.discarded].sort(), ["01-01", "01-02"]);
  assert.deepEqual(r.result.worktrees.kept, []);
  assert.ok(r.result.events.includes("worktree 01-01 discarded"));
  assert.deepEqual(worktreeDirs(w), []);
  assert.deepEqual(branches((...a) => w.git(...a).stdout.trim()), []);
  assert.equal(registered((...a) => w.git(...a).stdout), 1);
  const rec = JSON.parse(w.read(`${PHASE_DIR}/transfers/01-01.json`));
  const file = rec.files.find((f) => f.path === "src/01-01/impl.js");
  assert.equal(file.wt_sha256, file.sha256);
  assert.equal(w.read("src/01-01/impl.js"), "impl 01-01\n");
  assert.equal(w.git("status", "--porcelain", "--", "src").stdout.trim(), "");
  assert.equal(r.result.leftoverWorktrees, undefined);
});

test("P75 F1 a tree with a change the transfer did not carry is kept after the commit and listed in the result; the run does not fail", async () => {
  const w = makeExecWorld({ waves: [[task("01-01"), task("01-02")]], overlay: { gsd: { isolation: "worktree" } } });
  let first = null;
  const commit = w.gsd.handlers.commit;
  w.gsd.on("commit", (argv, input) => {
    if (first) fs.writeFileSync(path.join(w.root, first, "late.txt"), "after the transfer\n");
    return commit(argv, input);
  });
  const r = await exec(w, { "exec-01-01": (p, o, n, calls) => { first = calls.find((c) => c.n === n).worktree; } });
  assert.equal(r.result.status, "executed");
  assert.deepEqual(r.result.worktrees.discarded.sort(), ["01-02"]);
  assert.equal(r.result.worktrees.kept.length, 1);
  assert.equal(r.result.worktrees.kept[0].plan, "01-01");
  assert.match(r.result.worktrees.kept[0].why, /not all in the transfer record/);
  assert.deepEqual(worktreeDirs(w), [first.split("/").pop()]);
  assert.equal(fs.existsSync(path.join(w.root, first, "late.txt")), true);
  assert.equal(r.result.leftoverWorktrees.total, 1);
});

test("P75 F1 shared isolation and its result are unchanged: no worktrees entry, no discard call", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  const r = await exec(w);
  assert.equal(r.result.status, "executed");
  assert.equal(r.result.worktrees, undefined);
  assert.equal(r.result.leftoverWorktrees, undefined);
  assert.ok(!r.shells.some((s) => s.argv.includes("discard-worktree") || s.argv.includes("leftover-worktrees")));
});

// Run 1 halts 01-02 (a Rule-4 decision) and the owner clears the halt as `ph gsd halt clear` records it.
async function haltedWorld() {
  const w = makeExecWorld({ waves: [[task("01-01"), task("01-02")]], overlay: { gsd: { isolation: "worktree" } } });
  const decision = () => ({ taskResults: [{ task: "1", status: "partial" }], deviations: [{ rule: 4, note: "pick a schema" }], requests: [] });
  const first = await exec(w, { "exec-01-02": decision });
  const halt = JSON.parse(w.read(`${PHASE_DIR}/01-02-HALT.json`));
  fs.rmSync(path.join(w.root, PHASE_DIR, "01-02-HALT.json"));
  w.write(`${PHASE_DIR}/halt-answers.json`, JSON.stringify([{ plan: "01-02", halt: halt.reason, haltRunId: halt.runId, haltWorktree: halt.worktree, answer: "use schema v1" }]));
  return { w, first, halt };
}

test("P75 F2 a halted plan's worktree stays, and its halt record names it", async () => {
  const { w, first, halt } = await haltedWorld();
  assert.equal(first.result.status, "needs-owner");
  assert.match(halt.worktree, /\.claude\/worktrees\/wf_20261020-120000_ab12-2$/);
  // Nothing was committed (the wave stopped at Execute), so 01-01's transferred tree stays as well.
  assert.deepEqual(first.result.worktrees.kept.map((k) => k.plan), ["01-01", "01-02"]);
  assert.equal(fs.existsSync(path.join(w.root, halt.worktree)), true);
});

test("P75 F2 after halt clear, a new run discards the old tree when the plan is dispatched again", async () => {
  const { w, halt } = await haltedWorld();
  const second = await exec(w, {}, {}, "wf_20261021-090000_cd34");
  assert.equal(second.result.status, "executed");
  assert.ok(second.logs.some((l) => l.includes(`worktree of the cleared halt ${halt.worktree}: discarded`)), second.logs.join(String.fromCharCode(10)));
  assert.deepEqual(worktreeDirs(w), []);
  assert.deepEqual(branches((...a) => w.git(...a).stdout.trim()), []);
});

test("P75 F2 a resumed run (same run id) keeps the halt's tree for its own session", async () => {
  const { w, halt } = await haltedWorld();
  // The host numbers its calls from 1 again; a real resume replays them. Free the name 01-01's old tree holds.
  const old = path.join(w.root, ".claude/worktrees", `${RUN}-1`);
  w.git("worktree", "remove", "--force", old);
  w.git("branch", "-D", `harness/${RUN}-1`);
  const again = await exec(w, {}, {}, halt.runId);
  assert.equal(again.result.status, "executed");
  assert.ok(!again.logs.some((l) => /worktree of the cleared halt/.test(l)));
  assert.deepEqual(worktreeDirs(w), [halt.worktree.split("/").pop()]);
});

test("P75 F2 ph gsd halt clear keeps the halted worktree in halt-answers.json", async () => {
  const p = gsdProject({ files: { ".planning/phases/01-core/01-02-HALT.json": JSON.stringify({ plan: "01-02", reason: "pick", runId: "wf_x", worktree: "/r/.claude/worktrees/wf_x-2" }) } });
  const cleared = await runGsdIn(p, ["halt", "clear", "1", "--plan", "01-02", "--reason", "use schema v1"]);
  assert.equal(cleared.code, 0, JSON.stringify(cleared.json));
  const [a] = p.readJson(".planning/phases/01-core/halt-answers.json");
  assert.deepEqual([a.haltRunId, a.haltWorktree], ["wf_x", "/r/.claude/worktrees/wf_x-2"]);
});

// ---- F3 ----

test("P75 F3 ph doctor and the execute result report leftover harness worktrees of finished runs", async () => {
  const t = await tree();
  put(t, "src/unmerged.js", "x\n");
  const doctor = await t.s.ph(["doctor"]);
  assert.match(doctor.stdout, /note 1 leftover harness worktree\(s\) of finished runs under \.claude\/worktrees \(0 removable\)/);
  const h = put(t, "src/a.js", "a\n");
  fs.rmSync(path.join(t.wt.path, "src/unmerged.js"));
  t.record([{ path: "src/a.js", sha256: h, wt_sha256: h }]);
  assert.match((await t.s.ph(["doctor"])).stdout, /\(1 removable\)/);
  const clean = setup({ git: true, files: IGNORE });
  assert.doesNotMatch((await clean.ph(["doctor"])).stdout, /leftover harness worktree/);
});

test("P75 F3 a run in another project state: a worktree of a running run is not a leftover", async () => {
  const t = await tree();
  put(t, "src/unmerged.js", "x\n");
  t.s.project.write(`_workspace/_runs/${RUN}/run.json`, JSON.stringify({ status: "running", pid: process.pid }));
  assert.equal(t.state().state, "in use");
  assert.doesNotMatch((await t.s.ph(["doctor"])).stdout, /leftover harness worktree/);
});
