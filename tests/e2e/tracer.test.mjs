// ROADMAP Phase 1 tracer and the D-109 project flow, end to end on an installed temp project (offline fakes).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { policyLines as machinePolicy } from "../../kit/machine/providers.mjs";
import { policyLines as doctorPolicy } from "../../ship/.agents/harness/lib/provider-policy.mjs";
import { main as kitMain } from "../../kit.mjs";
import { P1, plan, REQUIREMENTS, ROADMAP } from "../gsd-core/fixture.mjs";
import { CALLER, installedProject, lineMatching, TIERS } from "./world.mjs";

const PLANNING = {
  ".planning/PROJECT.md": "# Project\n",
  ".planning/ROADMAP.md": ROADMAP,
  ".planning/REQUIREMENTS.md": REQUIREMENTS,
  [`${P1}/01-CONTEXT.md`]: "<decisions>\n- **D-01:** keep it small\n</decisions>\n",
  [`${P1}/01-01-PLAN.md`]: plan(),
  [`${P1}/01-02-PLAN.md`]: plan({ id: "02", wave: 2, depends: "[01-01]", files: "[src/b.js]", owns: '["Path:src/b.js"]' }),
  ".planning/phases/02-api/.keep": "",
  ".planning/phases/03-ui/.keep": "",
};

const writeOverlay = (w, extra = {}) => w.project.writeJson(".agents/harness.config.json", { ...w.project.readJson(".agents/harness.config.json"), tiers: TIERS, ...extra });

test("INST-01 PHCL-04 tracer: install, ph doctor, spawn/watch/result round and a minimal workflow on the installed copy", async () => {
  const w = await installedProject();
  assert.ok(fs.existsSync(w.project.path(".agents/harness-kit.json")), "manifest written");
  assert.ok(fs.existsSync(w.project.path(".claude/skills/ph/SKILL.md")) && fs.existsSync(w.project.path(".claude/skills/ai-orchestrator/SKILL.md")));
  // CONF-11: an untouched install has unconfigured tiers; spawn fails and creates nothing.
  const unconfigured = await w.ph(["spawn", "--name", "a", "--prompt", "hi"]);
  assert.equal(unconfigured.code, 1, unconfigured.text);
  assert.match(unconfigured.text, /tier standard has no model; set tiers\.standard\.provider in \.agents\/harness\.config\.json/);
  assert.equal(w.fake.callsOf("createAgent").length, 0);
  writeOverlay(w);
  const defaults = w.project.readJson(".agents/harness.defaults.json");
  fs.writeFileSync(path.join(w.env.PASEO_HOME, "config.json"), JSON.stringify({ agents: { providers: {
    circle: { extends: "claude", disallowedTools: ["Agent", "Workflow"] },
    "circle-agent": { extends: "claude", disallowedTools: defaults.agent_provider_disallowed_tools, env: { ENABLE_TOOL_SEARCH: "true" } },
  } } }));
  const models = ["big", "mid", "small"].map((id) => ({ id, thinkingOptions: [{ id: "low" }] }));
  w.fake.setModels("circle-agent", models);
  w.fake.setModels("circle", models);
  const doctor = await w.ph(["doctor"]);
  assert.ok(lineMatching(doctor, /^ok harness config valid$/), doctor.text);
  assert.ok(!lineMatching(doctor, /^problem tier /), doctor.text);
  assert.ok(lineMatching(doctor, /^ok default_tier standard -> circle-agent\/small/), doctor.text);
  assert.ok(lineMatching(doctor, /^ok main provider circle: Agent, Workflow disallowed/), doctor.text);
  assert.ok(lineMatching(doctor, /^ok gsd upstream check: 0 problems/), doctor.text);
  assert.ok(lineMatching(doctor, /^ok agent types in \.agents\/agents\/ \(14\)/), doctor.text);

  const spawn = await w.ph(["spawn", "--name", "a", "--prompt", "say ok"]);
  assert.equal(spawn.code, 0, spawn.text);
  assert.ok(lineMatching(spawn, /^next: /), "non-blocking command ends with the wait hint");
  const created = w.fake.callsOf("createAgent")[0].args[0];
  assert.equal(created.provider, "circle-agent");
  assert.equal(created.labels["paseo.parent-agent-id"], CALLER);
  const watch = await w.ph(["watch", "a"]);
  assert.equal(watch.code, 0, watch.text);
  const result = await w.ph(["result", "a"]);
  assert.equal(result.code, 0, result.text);
  assert.match(result.text, /\bok\b/);

  w.project.write("wf.js", [
    'export const meta = { name: "tracer", description: "two agents and a shell" };',
    'const [x, y] = await parallel([() => agent("one"), () => agent("two")]);',
    "const s = await shell([\"node\", \"-e\", \"process.stdout.write('sh')\"]);",
    "return { x, y, s: s.stdout, runId };",
    "",
  ].join("\n"));
  const wf = await w.ph(["workflow", "--script", "wf.js", "--run-id", "wf_tracer"]);
  assert.equal(wf.code, 0, wf.text);
  assert.ok(lineMatching(wf, /^workflow done wf_tracer: .*\(ok 2, null 0, cached 0/), wf.text);
  // result.json adds the run's roles to an object return (GSDF-18); the script's own keys are unchanged.
  const { roles, ...value } = w.project.readJson("_workspace/_runs/wf_tracer/result.json");
  assert.deepEqual(value, { x: "ok", y: "ok", s: "sh", runId: "wf_tracer" });
  assert.deepEqual(roles.map((r) => [r.role, r.calls]), [[null, 2]]);
  const stats = await w.ph(["run-stats", "wf_tracer"]);
  assert.equal(stats.code, 0, stats.text);
  const status = [];
  assert.equal(await kitMain(["status", w.root], { env: w.env, out: (l) => status.push(l), err: (l) => status.push(l) }), 0, status.join("\n"));
});

test("GSDC-01 tracer: ph gsd verbs on a seeded .planning of the installed project", async () => {
  const w = await installedProject({ files: PLANNING });
  writeOverlay(w);
  const j = async (argv) => {
    const r = await w.ph(["gsd", ...argv]);
    return { ...r, json: JSON.parse(r.out.at(-1) ?? "null") };
  };
  const find = await j(["find-phase", "1"]);
  assert.deepEqual([find.code, find.json.phase_name, find.json.plan_count], [0, "Core", 2]);
  assert.equal((await j(["roadmap", "analyze"])).code, 0);
  assert.equal((await j(["state", "init"])).code, 0);
  assert.ok(fs.existsSync(w.project.path(".planning/STATE.md")));
  const structure = await j(["verify", "plan-structure", "1"]);
  assert.equal(structure.code, 0, structure.text);
  const index = await j(["phase-plan-index", "1"]);
  assert.deepEqual(index.json.plans.map((p) => [p.id, p.ready]), [["01-01", true], ["01-02", false]]);
  const handoff = await j(["handoff", "1"]);
  assert.equal(handoff.code, 0, handoff.text);
  assert.deepEqual(w.project.readJson(`${P1}/handoff/w1.args.json`).tasks.map((t) => t.plan), ["01-01"]);
  assert.equal((await j(["research", "status", P1])).code, 66);
  assert.equal((await j(["bogus-verb"])).code, 69, "an unknown or not-ported verb exits 69");
});

// The researcher fake writes the report the kit contract asks for (path, digest and attempt key from its prompt).
function researcher(root) {
  return (agent, text) => {
    const m = /Write only (\S+)\. Its frontmatter carries status \(complete or blocked\), input_digest: ([0-9a-f]{64}) and attempt_key: ([0-9a-f]{64})/.exec(text);
    if (!m) return [{ reply: "ok" }];
    const [, rel, digest, key] = m;
    const body = [
      "## Summary", "Small core. [VERIFIED: fixture]", "## Standard Stack", "node [ASSUMED]", "## Architecture Patterns", "one module",
      "## Don't Hand-Roll", "-", "## Common Pitfalls", "-", "## Sources", "fixture",
      "<user_constraints>", "D-01 keep it small", "</user_constraints>", "<phase_requirements>", "CORE-01 CORE-02", "</phase_requirements>",
      `<!-- gsd:research-complete ${key} -->`,
    ].join("\n");
    fs.writeFileSync(path.join(root, rel), `---\nstatus: complete\ninput_digest: ${digest}\nattempt_key: ${key}\n---\n${body}\n`, "utf8");
    return [{ reply: JSON.stringify({ status: "complete", path: rel }) }];
  };
}

test("GSDF-12 D-109 project flow: adapter in the overlay, harness lint, then a GSD workflow through the real engine", async () => {
  let root = null;
  const w = await installedProject({ files: PLANNING, responder: (...a) => researcher(root)(...a) });
  root = w.root;
  // D-109: the harness generator writes the project adapter into the overlay; the kit itself ships none.
  writeOverlay(w, { adapter: { commands: { build: null, test: ["node", "-e", "process.exit(0)"], build_timeout_s: 60, test_timeout_s: 60, gates: [], verify: {} } } });
  const cfg = await w.ph(["config"]);
  assert.equal(cfg.code, 0, cfg.text);
  assert.deepEqual(JSON.parse(cfg.out.join("\n")).adapter.commands.test, ["node", "-e", "process.exit(0)"]);
  const lint = await w.ph(["harness", "lint"]);
  assert.equal(lint.code, 0, lint.text);
  assert.ok(lineMatching(lint, /^lint: 0 failed, \d+ warnings/), lint.text);

  const run = await w.ph(["workflow", "--name", "gsd-research", "--args", JSON.stringify({ phaseDir: P1 }), "--run-id", "wf_research"]);
  assert.equal(run.code, 0, run.text);
  const result = w.project.readJson("_workspace/_runs/wf_research/result.json");
  assert.equal(result.status, "researched", JSON.stringify(result));
  const create = w.fake.callsOf("createAgent").map((c) => c.args[0]);
  assert.equal(create.length, 1);
  assert.equal(create[0].model, "mid", "the researcher's tier pro resolves through the overlay");
  assert.match(create[0].initialPrompt, /Kit overlay: gsd-phase-researcher/);
  const again = await w.ph(["workflow", "--name", "gsd-research", "--args", JSON.stringify({ phaseDir: P1 }), "--run-id", "wf_research2"]);
  assert.equal(again.code, 0, again.text);
  assert.equal(w.project.readJson("_workspace/_runs/wf_research2/result.json").status, "reused");
  assert.equal(w.fake.callsOf("createAgent").length, 1, "a current report is reused without a second agent");
});

test("MACH-04 PHCL-04 ph doctor and kit machine check share one provider policy check", () => {
  assert.equal(machinePolicy, doctorPolicy);
});

test("INST-28 node kit.mjs help prints the project help and the machine verbs, exit 0", async () => {
  const out = [];
  assert.equal(await kitMain(["help"], { out: (l) => out.push(l), err: (l) => out.push(l) }), 0);
  assert.ok(out.includes("verbs:") && out.some((l) => l.startsWith("usage: node kit.mjs machine")));
});
