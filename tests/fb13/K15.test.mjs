// Kit feedback W16 (K15): an owner's owns edit replans the affected plans, not the outline. A planner's own owns are no owner question (upstream files_modified). Verb tests run the real verbs on a temp
// project; the flow test drives gsd-plan on the fake host.
import assert from "node:assert/strict";
import test from "node:test";
import { P1, gsd, plan as planFile, project, workerEnv } from "../gsd-core/fixture.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR as PD, plannerResponder } from "../gsd-flows/world.mjs";
import { planPrompt } from "../../ship/.agents/workflows/lib/flow-plan.mjs";

const SIG = "Future<void> pause()";
const OUTLINE = `# Outline\n\n| Requirements | Plan ID | Wave | Objective | Depends on |\n|---|---|---|---|---|\n| CORE-01 | \`01-01\` | 1 | do | none |\n| CORE-02 | \`01-02\` | 2 | do | 01-01 |\n| CORE-01 | \`01-03\` | 1 | do | none |\n\n## OUTLINE COMPLETE\n`;
const produced = (over = {}) => ({ symbol: "DaemonClient.pause", kind: "method", file: "src/a.js", signature: SIG, ...over });
const plans = () => [
  { id: "01-01", owns: ["Path:src/a.js"], requirements: ["CORE-01"], produces: [produced()], consumes: [], tracer: { is: false }, verify: [] },
  { id: "01-02", owns: ["Path:src/b.js"], requirements: ["CORE-02"], produces: [], consumes: [{ plan: "01-01", symbol: "Reader.open" }], tracer: { is: false }, verify: [] },
  { id: "01-03", owns: ["Path:src/c.js"], requirements: ["CORE-01"], produces: [{ symbol: "Kept.stay", kind: "method", file: "src/c.js", signature: "void stay()" }], consumes: [], tracer: { is: false }, verify: [] },
];
const world = () => project({ files: {
  [`${P1}/01-PLAN-OUTLINE.md`]: OUTLINE,
  [`${P1}/01-PLAN-OUTLINE.manifest.json`]: JSON.stringify({ phase: "01", plans: plans() }),
  [`${P1}/01-01-PLAN.md`]: planFile({}),
  [`${P1}/01-02-PLAN.md`]: planFile({ id: "02", wave: 2, depends: "[01-01]", reqs: "[CORE-02]", files: "[src/b.js]", owns: '["Path:src/b.js"]' }),
  [`${P1}/01-03-PLAN.md`]: planFile({ id: "03", files: "[src/c.js]", owns: '["Path:src/c.js"]' }),
} });
const manifest = (p) => p.readJson(`${P1}/01-PLAN-OUTLINE.manifest.json`);
const record = async (p, key) => gsd(p, ["revisions", "record", "1", key]);
const check = (p, key) => gsd(p, ["revisions", "check", "1", key]);
const hash = async (p, key) => (await gsd(p, ["revisions", "hash", "1", key])).json.hash;
async function recorded(p) {
  for (const key of ["freeze", "skeleton", "plan:01-01", "plan:01-02", "plan:01-03"]) assert.equal((await record(p, key)).code, 0, key);
}

test("K15 W16 owns add appends paths no plan of the same wave owns, logs the answer, and drops only that plan's key", async () => {
  const p = world();
  await recorded(p);
  const before = await hash(p, "freeze");
  const clash = await gsd(p, ["owns", "add", "1", "--plan", "01-01", "--path", "src/c.js", "--reason", "no"]);
  assert.match(clash.json.error, /owned by 01-03 of the same wave/);
  assert.equal(manifest(p).plans[0].owns.length, 1);
  const worker = await gsd(p, ["owns", "add", "1", "--plan", "01-01", "--path", "src/new.js", "--reason", "no"], { env: workerEnv() });
  assert.match(worker.json.error, /orchestrator only/);
  const ok = await gsd(p, ["owns", "add", "1", "--plan", "01-01", "--path", "src/new.js", "--path", "src/also.js", "--reason", "the reader needs them"]);
  assert.equal(ok.code, 0, JSON.stringify(ok.json));
  assert.deepEqual(ok.json.paths, ["Path:src/new.js", "Path:src/also.js"]);
  assert.deepEqual(manifest(p).plans[0].owns, ["Path:src/a.js", "Path:src/new.js", "Path:src/also.js"]);
  assert.deepEqual(manifest(p).plans[0].owns_outline, ["Path:src/a.js"]);
  assert.equal(await hash(p, "freeze"), before);
  assert.equal((await check(p, "skeleton")).code, 0);
  assert.equal((await check(p, "plan:01-02")).code, 0);
  assert.equal((await check(p, "plan:01-03")).code, 0);
  assert.equal((await check(p, "plan:01-01")).code, 66);
  const answers = p.readJson(`${P1}/owner-answers.json`);
  assert.equal(answers.at(-1).kind, "owns");
  assert.deepEqual(answers.at(-1).paths, ["Path:src/new.js", "Path:src/also.js"]);
  const again = await gsd(p, ["owns", "add", "1", "--plan", "01-01", "--path", "src/new.js", "--reason", "again"]);
  assert.equal(again.json.already, true);
  assert.equal(p.readJson(`${P1}/owner-answers.json`).length, 1);
  // As upstream, plans of different waves may change the same file: 01-02 (wave 2) owns src/b.js, 01-01 (wave 1) may too.
  const crossWave = await gsd(p, ["owns", "add", "1", "--plan", "01-01", "--path", "src/b.js", "--reason", "wave 1 writes it first"]);
  assert.equal(crossWave.code, 0, JSON.stringify(crossWave.json));
  assert.deepEqual(manifest(p).plans[1].owns, ["Path:src/b.js"]);
  assert.equal((await check(p, "plan:01-02")).code, 0);
});

test("K15 W16 owns handover moves a path across waves and refuses a same-wave move or a path the source does not own", async () => {
  const p = world();
  await recorded(p);
  const before = await hash(p, "freeze");
  const same = await gsd(p, ["owns", "handover", "1", "--from", "01-01", "--to", "01-03", "--path", "src/a.js", "--reason", "same wave"]);
  assert.match(same.json.error, /both wave 1/);
  assert.match(same.json.error, /decide --outline/);
  const missing = await gsd(p, ["owns", "handover", "1", "--from", "01-02", "--to", "01-01", "--path", "src/missing.js", "--reason", "no"]);
  assert.match(missing.json.error, /does not own src\/missing.js/);
  const ok = await gsd(p, ["owns", "handover", "1", "--from", "01-02", "--to", "01-01", "--path", "src/b.js", "--reason", "wave 1 reads it"]);
  assert.equal(ok.code, 0, JSON.stringify(ok.json));
  assert.deepEqual(manifest(p).plans[0].owns, ["Path:src/a.js", "Path:src/b.js"]);
  assert.deepEqual(manifest(p).plans[1].owns, []);
  assert.equal(await hash(p, "freeze"), before);
  assert.equal((await check(p, "plan:01-03")).code, 0);
  assert.equal((await check(p, "skeleton")).code, 0);
  assert.equal((await check(p, "plan:01-01")).code, 66);
  assert.equal((await check(p, "plan:01-02")).code, 66);
  const answer = p.readJson(`${P1}/owner-answers.json`).at(-1);
  assert.deepEqual([answer.kind, answer.op, answer.from, answer.to], ["owns", "handover", "01-02", "01-01"]);
  const replay = await gsd(p, ["owns", "handover", "1", "--from", "01-02", "--to", "01-01", "--path", "src/b.js", "--reason", "wave 1 reads it"]);
  assert.equal(replay.json.already, true, JSON.stringify(replay.json));
  assert.equal(p.readJson(`${P1}/owner-answers.json`).length, 1);
  // A path covered only by a directory is not an exact hand-over.
  const dir = world();
  const m = dir.readJson(`${P1}/01-PLAN-OUTLINE.manifest.json`);
  m.plans[1].owns = ["Path:src"];
  dir.writeJson(`${P1}/01-PLAN-OUTLINE.manifest.json`, m);
  const via = await gsd(dir, ["owns", "handover", "1", "--from", "01-02", "--to", "01-01", "--path", "src/b.js", "--reason", "narrow"]);
  assert.match(via.json.error, /only through Path:src/);
});

test("K15 W16 a planner's owns are its own: no ownership stop; a SOURCE AUDIT stays a decide", async () => {
  const rows = [{ id: "01-01", wave: 1 }, { id: "01-02", wave: 1 }];
  const run = (overrides) => {
    const w = makeWorld();
    return runScript("gsd-plan", { root: w.root, gsd: w.gsd, args: { phaseDir: PD, planReview: false }, agent: plannerResponder(w, { rows, overrides }) }).then((r) => ({ r, w }));
  };
  const ok = await run({});
  assert.equal(ok.r.result.status, "planned", JSON.stringify(ok.r.result));
  const prompt = ok.r.calls.find((c) => c.opts.label === "plan-01-01").prompt;
  assert.ok(prompt.includes('owns from the outline (put them in the plan frontmatter and add every path your tasks change that they lack): ["Path:src/01-01/"]'), prompt);
  assert.ok(prompt.includes("Owned by other plans of wave 1 (never in this plan's owns; a change one of them needs goes to its plan in plan_changes): 01-02 Path:src/01-02/"), prompt);
  assert.match(prompt, /SOURCE AUDIT is a requirement, decision or research item no plan covers; ownership never is/);
  assert.doesNotMatch(prompt, /owns_changes|repeat exactly/);
  const audit = await run({ "plan-01-01": () => ({ marker: "SOURCE AUDIT", summary: "which source?", plans: ["keep", "split"] }) });
  assert.equal(audit.r.result.answer.verb, "decide");
  assert.match(audit.r.result.answer.command, /decide 01/);
  assert.equal(audit.w.recorded.has("plan:01-02"), true, "a planner that finished is recorded");
});

test("K15 W16 the planner prompts name the plan's own owns, and decide --outline stays for an outline change", () => {
  const root = "C:/Users/fish/Desktop/kit-fixwt/K15";
  const ctx = { N: "1", nn: "01", phaseDir: PD, phaseName: "Core", reqIds: ["R-1"], instructions: [], tracer: true, reversibilityGates: true, granularity: "standard", planLimits: { tasks_per_plan: 5, plans_per_phase: 8, waves_per_phase: 4 }, contractsOn: true, validation: null };
  const revise = planPrompt(root, "revise", { ctx, plans: [`${PD}/01-01-PLAN.md`], issues: [], shows: [{ id: "01-01", show: { plan: "01-01", produces: [{ structured: true, symbol: "S", kind: "method", file: "src/a.js", signature: "void s()" }], consumes: [], consumers: {} } }], key: "freeze", digest: "f" });
  assert.match(revise.text, /decide --outline/);
  const write = planPrompt(root, "write", { ctx, id: "01-01", entry: { id: "01-01", owns: ["Path:src/a.js"] }, wiringText: "", carried: [], contract: { show: { produces: [], consumes: [] } }, digest: "f" });
  assert.match(write.text, /add to it every path its tasks change, unless another plan of its wave owns the path/);
  assert.match(write.text, /producer order is an outline decision/);
  assert.doesNotMatch(write.text, /owns_changes/);
});
