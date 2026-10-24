// Kit feedback W13, W14: a concurrent docs commit is not an executor commit, the gate ignores a HEAD
// move that touches none of its inputs, and a gap wave halted before its gate is continued by a rerun.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";
import { executor, makeExecWorld, task } from "../gsd-flows/exec-world.mjs";
import { NULL, runScript } from "../gsd-flows/host.mjs";
import { PHASE_DIR } from "../gsd-flows/world.mjs";

const flowHref = pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href;
const execHref = pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/flow-execute.mjs")).href;
const gateHref = pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/flow-gate.mjs")).href;
const { main } = await import(flowHref);
const { gate } = await import(gateHref);
const PD = PHASE_DIR;
const node = process.execPath;
const green = [node, "-e", "process.exit(0)"];

async function flow(root, argv, input = "") {
  let line = "";
  const code = await main(argv, { root, input: typeof input === "string" ? input : JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}
const exec = (w, args = {}, overrides = {}, runId) => runScript("gsd-execute", { root: w.root, args: { phaseDir: PD, ...args }, gsd: w.gsd, agent: executor(w, overrides), ...(runId ? { runId } : {}) });
const head = (w) => w.git("rev-parse", "HEAD").stdout.trim();

function repo() {
  return makeTempProject({ files: { "src/a.js": "a\n", "src/b/x.js": "b\n", "docs/n.md": "n\n", [`${PD}/.keep`]: "" } });
}

test("K13 W13 exec-head-move accepts a docs commit and moves the base; an owned commit is the executor; a wave-owned commit names the sha", async () => {
  const { headMove, recordBaseline } = await import(execHref);
  assert.equal(typeof headMove, "function");
  const p = repo();
  recordBaseline(p.root, PD);
  const before = p.git("rev-parse", "HEAD");
  const owns = ["Path:src/a.js"];
  const wave = ["Path:src/a.js", "Path:src/b/"];
  p.write("docs/n.md", "docs\n");
  p.git("add", "docs/n.md");
  p.git("commit", "-qm", "docs: outline of another phase");
  const docs = p.git("rev-parse", "HEAD");
  const accepted = headMove(p.root, PD, { before, head: docs, own: [], plan: "01-01", owns, waveOwns: wave });
  assert.equal(accepted.kind, "accepted", JSON.stringify(accepted));
  assert.equal(accepted.commits[0].sha, docs);
  assert.equal(p.readJson(`${PD}/execute-baseline.json`).head, docs);
  assert.notEqual(p.readJson(`${PD}/execute-baseline.json`).gateConfig, undefined);

  const still = headMove(p.root, PD, { before, head: docs, worktreeHead: before, own: [], plan: "01-01", owns, waveOwns: wave });
  assert.equal(still.kind, "accepted", "a worktree still on the old tip is not the executor");

  const ignored = headMove(p.root, PD, { before, head: docs, own: [docs], plan: "01-01", owns, waveOwns: wave });
  assert.equal(ignored.kind, "none");

  p.write("src/b/x.js", "foreign\n");
  p.git("add", "src/b/x.js");
  p.git("commit", "-qm", "touch the other plan");
  const foreignSha = p.git("rev-parse", "HEAD");
  const foreign = headMove(p.root, PD, { before: docs, head: foreignSha, own: [], plan: "01-01", owns, waveOwns: wave });
  assert.equal(foreign.kind, "foreign", JSON.stringify(foreign));
  assert.match(foreign.reason, new RegExp(foreignSha.slice(0, 7)));
  assert.match(foreign.reason, /src\/b\/x\.js/);
  assert.equal(p.readJson(`${PD}/execute-baseline.json`).head, docs, "a foreign owned commit does not move the base");

  p.write("src/a.js", "sneak\n");
  p.git("add", "src/a.js");
  p.git("commit", "-qm", "agent commit");
  const sneak = headMove(p.root, PD, { before: foreignSha, head: p.git("rev-parse", "HEAD"), own: [], plan: "01-01", owns, waveOwns: wave });
  assert.equal(sneak.kind, "executor");
  assert.equal(sneak.reason, "executor committed (HEAD moved)");

  p.git("checkout", "-q", "-b", "side");
  p.write("docs/n.md", "side\n");
  p.git("add", "docs/n.md");
  p.git("commit", "-qm", "worktree commit");
  const side = p.git("rev-parse", "HEAD");
  p.git("checkout", "-q", "main");
  const mainTip = p.git("rev-parse", "HEAD");
  const branched = headMove(p.root, PD, { before: mainTip, head: mainTip, worktreeHead: side, own: [], plan: "01-01", owns, waveOwns: wave });
  assert.equal(branched.kind, "executor", JSON.stringify(branched));

  const verb = await flow(p.root, ["exec-head-move", PD], { before: mainTip, head: mainTip, own: [], plan: "01-01", owns, waveOwns: wave });
  assert.equal(verb.code, 0, JSON.stringify(verb.json));
  assert.equal(verb.json.kind, "none");
});

test("K13 W13 a docs commit during an executor is logged and the run continues; a wave-owned commit halts naming the sha", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  let docs = null;
  const run = executor(w);
  const r = await exec(w, {}, { "exec-": async (...a) => { w.write("docs/note.md", "docs\n"); w.git("add", "docs/note.md"); w.git("commit", "-qm", "docs: outline"); docs = head(w); return run(...a); } });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  assert.ok(r.logs.some((l) => /01-01: commit .* touches no file of this wave/.test(l) && /accepted/.test(l)), r.logs.join("\n"));
  assert.equal(JSON.parse(w.read(`${PD}/execute-baseline.json`)).head, docs);

  const both = makeExecWorld({ waves: [[task("01-01"), task("01-02")]], overlay: { gsd: { parallelization: { enabled: false, max_concurrent: null } } } });
  const sneaky = await exec(both, {}, { "exec-01-01": () => { both.write("src/01-02/x.js", "x\n"); both.git("add", "src/01-02/x.js"); both.git("commit", "-qm", "touch sibling"); return { taskResults: [{ task: "1", status: "implemented", evidence: "ok" }], deviations: [], requests: [] }; } });
  assert.equal(sneaky.result.status, "needs-owner", JSON.stringify(sneaky.result));
  assert.match(sneaky.result.reason, /foreign commit [0-9a-f]{7} touches owned files \(src\/01-02\/x\.js\)/);
  assert.equal(sneaky.result.answer.verb, "halt.clear");
});

test("K13 W13 a worktree commit is the executor's; a main-tree docs commit during a worktree executor is not", async () => {
  const commitIn = (w, wt, rel, text) => {
    const abs = path.join(w.root, wt);
    fs.mkdirSync(path.dirname(path.join(abs, rel)), { recursive: true });
    fs.writeFileSync(path.join(abs, rel), text);
    w.git("-C", abs, "add", "--", rel);
    const c = w.git("-C", abs, "commit", "-qm", "agent commit");
    assert.equal(c.status, 0, c.stderr);
  };
  const branched = makeExecWorld({ waves: [[task("01-01")]], overlay: { gsd: { isolation: "worktree" } } });
  const moved = await exec(branched, {}, { "exec-": async (_p, _o, n, calls) => { commitIn(branched, calls.find((c) => c.n === n).worktree, "src/01-01/c.js", "c\n"); return { taskResults: [], deviations: [], requests: [] }; } });
  assert.match(moved.result.reason, /executor committed \(HEAD moved\)/);

  const docs = makeExecWorld({ waves: [[task("01-01")]], overlay: { gsd: { isolation: "worktree" } } });
  const run = executor(docs);
  const r = await exec(docs, {}, { "exec-": async (...a) => { docs.write("docs/note.md", "docs\n"); docs.git("add", "docs/note.md"); docs.git("commit", "-qm", "docs: outline"); return run(...a); } });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  assert.ok(r.logs.some((l) => /touches no file of this wave/.test(l)), r.logs.join("\n"));
});

test("K13 W13 the gate ignores a HEAD move that touches none of its inputs and still fails one that does", async () => {
  const commitDocs = `import { spawnSync } from "node:child_process"; import fs from "node:fs"; fs.mkdirSync("docs", { recursive: true }); fs.writeFileSync("docs/n.md", "docs\\n"); spawnSync("git", ["add", "docs/n.md"]); const c = spawnSync("git", ["commit", "-qm", "docs: note"]); process.exit(c.status ?? 1);\n`;
  const docs = makeTempProject({ files: { "src/a.js": "a\n", "commit-docs.mjs": commitDocs }, overlay: { adapter: { commands: { build: green, test: [node, "commit-docs.mjs"], build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} } } } });
  const g = await gate(docs.root, PD, { waveId: "w1", plans: [{ id: "01-01", owns: ["Path:src/"], verify: [] }] });
  assert.equal(g.failures.some((f) => f.step === "inputs-stable"), false, JSON.stringify(g.failures));
  assert.ok((g.notes ?? []).some((n) => /inputs-stable: HEAD moved/.test(n) && /no commit touches the gate's inputs/.test(n)), (g.notes ?? []).join("\n"));
  assert.equal(g.green, true, JSON.stringify(g.failures));

  const commitSrc = `import { spawnSync } from "node:child_process"; import fs from "node:fs"; fs.writeFileSync("src/a.js", "new\\n"); spawnSync("git", ["add", "src/a.js"]); const c = spawnSync("git", ["commit", "-qm", "touch input"]); process.exit(c.status ?? 1);\n`;
  const owned = makeTempProject({ files: { "src/a.js": "a\n", "commit-src.mjs": commitSrc }, overlay: { adapter: { commands: { build: green, test: [node, "commit-src.mjs"], build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} } } } });
  const bad = await gate(owned.root, PD, { waveId: "w1", plans: [{ id: "01-01", owns: ["Path:src/"], verify: [] }] });
  const stable = bad.failures.find((f) => f.step === "inputs-stable");
  assert.ok(stable, JSON.stringify(bad.failures));
  assert.match(stable.excerpt, /HEAD/);
  assert.match(stable.excerpt, /src\/a\.js/);
});

test("K13 W14 a gap wave halted before its gate is continued by a new run; one that reached the gate is capped", async () => {
  const g = makeExecWorld({ waves: [[task("01-01"), task("01-02")]], prefix: "gap-", meta: { "01-01": { gap: true }, "01-02": { gap: true } } });
  g.attempts.gap = { key: "k", runId: "wf_plan", inputDigest: "v", before: "b", done: true, result: { plans: ["01-01", "01-02"], waveExecuted: false } };
  let during = null;
  const first = await exec(g, { gapsOnly: true }, { "exec-01-02": () => { during = g.attempts.gap.result.waveExecuted; return NULL("quota exhausted"); } });
  assert.equal(first.result.status, "needs-owner");
  assert.equal(during, false, "the cap is not counted before the gate");
  assert.equal(g.attempts.gap.result.waveExecuted, false);
  fs.rmSync(path.join(g.root, `${PD}/01-02-HALT.json`));
  const fresh = await exec(g, { gapsOnly: true }, {}, "wf_fresh");
  assert.equal(fresh.result.status, "executed", JSON.stringify(fresh.result));
  assert.deepEqual(fresh.calls.filter((c) => c.opts.label.startsWith("exec-")).map((c) => c.opts.label), ["exec-01-02"]);
  assert.equal(g.attempts.gap.result.waveExecuted, true);
  assert.equal(g.attempts.gap.result.waveRunId, "wf_fresh");
  const again = makeExecWorld({ waves: [[task("01-01"), task("01-02")]], prefix: "gap-", meta: { "01-01": { gap: true }, "01-02": { gap: true } } });
  again.attempts.gap = { ...g.attempts.gap, result: { ...g.attempts.gap.result } };
  const capped = await exec(again, { gapsOnly: true }, {}, "wf_other");
  assert.equal(capped.calls.filter((c) => c.opts.label.startsWith("exec-")).length, 0);
  assert.match(capped.result.reason, /capped at one wave/);
});

test("K13 W9 a partial SUMMARY older than a halt clear without --resume is re-dispatched in shared isolation", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  w.write(sumOf("01-01"), "---\nstatus: partial\nkey-files:\n  created: []\n---\npartial\n");
  w.write(`${PD}/halt-answers.json`, `${JSON.stringify([{ plan: "01-01", halt: "owner decision needed: pick one", answer: "do tasks 1-3", at: "2099-01-01T00:00:00.000Z" }])}\n`);
  const r = await exec(w);
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  assert.equal(r.calls.filter((c) => c.opts.label === "exec-01-01").length, 1);
  assert.match(r.calls.find((c) => c.opts.label === "exec-01-01").prompt, /do tasks 1-3/);
  assert.equal(r.logs.some((l) => /SUMMARY present but not committed/.test(l)), false);
});

function sumOf(id) { return `${PD}/${id}-SUMMARY.md`; }
