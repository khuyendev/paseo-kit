// G094: a custom verify parser that extracts no target must not turn an obligation into no check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeTempProject } from "../helpers/temp.mjs";
import { loadConfig } from "../../ship/.agents/harness/config.mjs";
import { gateObligation } from "../../ship/.agents/harness/adapter/contract.mjs";
import { executionProblem, requiredSteps } from "../../ship/.agents/harness/adapter/evidence.mjs";
import { P1, gsd, plan, project } from "../gsd-core/fixture.mjs";

// A project parser that extracts nothing from any argument.
const EMPTY_PARSER = "import fs from 'node:fs';\nfs.readFileSync(0, 'utf8');\nconsole.log(JSON.stringify({ v: 1, targets: [] }));\n";
const RESOLVER = "import fs from 'node:fs';\nconst r = JSON.parse(fs.readFileSync(0, 'utf8'));\nconsole.log(JSON.stringify({ v: 1, results: r.targets.map((target) => ({ target, status: 'ok' })) }));\n";
const VOCAB = {
  build: { prefix: "build", parser: null, resolver: null, runner: null, evidence_parser: null, exit_code_sufficient: true },
  cmd: { prefix: "cmd:", parser: null, resolver: null, runner: null, evidence_parser: null, exit_code_sufficient: true },
  test: { prefix: "test:", parser: "tools/parse.mjs", resolver: null, runner: "unit", evidence_parser: null, exit_code_sufficient: false },
  gen: { prefix: "gen:", parser: "tools/parse.mjs", resolver: null, runner: "unit", evidence_parser: null, exit_code_sufficient: true },
};
const COMMANDS = { build: null, test: null, build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: { unit: { argv: ["node", "-e", "process.exit(0)"], timeout_s: 30 } } };

test("G094 a parser that extracts no target leaves the gate obligation unavailable, with no runner argv", async () => {
  const p = makeTempProject({ git: false, files: { "tools/parse.mjs": EMPTY_PARSER }, overlay: { adapter: { commands: COMMANDS, verify_vocabulary: VOCAB } } });
  const cfg = loadConfig(p.root);
  const o = await gateObligation(cfg, { codeRoot: p.root, kind: "test", command: "test: login flow" });
  assert.equal(o.outcome, "unavailable");
  assert.equal(o.argv, null);
  assert.match(o.reason, /no concrete targets/);
  const steps = await requiredSteps(cfg, { codeRoot: p.root, plans: [{ id: "01", verify: [{ task: "1", kind: "test", command: "test: login flow" }] }] });
  assert.match(steps.find((s) => s.name === "01-1-test").unresolvable, /no concrete targets/);
});

test("G094 an exit-code-sufficient kind may still run targetless when its parser extracts nothing", async () => {
  const p = makeTempProject({ git: false, files: { "tools/parse.mjs": EMPTY_PARSER }, overlay: { adapter: { commands: COMMANDS, verify_vocabulary: VOCAB } } });
  const o = await gateObligation(loadConfig(p.root), { codeRoot: p.root, kind: "gen", command: "gen: anything" });
  assert.equal(o.outcome, "ready");
  assert.deepEqual(o.targets, []);
});

test("G094 executionProblem rejects a count with no named targets unless the kind is exit-code-sufficient", () => {
  assert.match(executionProblem({ targets: [], executed: { count: 40, targets: [] } }), /no concrete targets/);
  assert.equal(executionProblem({ targets: [], executed: { count: 40, targets: [] }, exitCodeSufficient: true }), null);
});

test("G094 the pre-check reports an obligation whose parser extracts no target as a blocker", async () => {
  const files = {
    "tools/parse.mjs": EMPTY_PARSER,
    "tools/resolve.mjs": RESOLVER,
    "src/a.js": "",
    [`${P1}/01-01-PLAN.md`]: plan({
      tasks: [
        "<task type=\"auto\">\n<name>T1</name><action>a</action><verify><automated>test: login flow</automated><fails_when>x</fails_when></verify>\n</task>",
        "<task type=\"auto\">\n<name>T2</name><action>a</action><verify><automated>gen: anything</automated><fails_when>x</fails_when></verify>\n</task>",
      ].join("\n"),
    }),
  };
  const overlay = { adapter: { commands: COMMANDS, verify_vocabulary: { ...VOCAB, test: { ...VOCAB.test, resolver: "tools/resolve.mjs" }, gen: { ...VOCAB.gen, resolver: "tools/resolve.mjs" } } } };
  const r = await gsd(project({ files, overlay }), ["check", "verify-command-paths", "1"]);
  assert.equal(r.code, 0);
  assert.equal(r.json.status, "issues");
  assert.equal(r.json.blockers, 1);
  const testRow = r.json.commands.find((c) => c.command === "test: login flow");
  assert.deepEqual([testRow.kind, testRow.status, testRow.severity], ["test", "missing", "blocker"]);
  assert.match(testRow.detail, /no concrete target/);
  const gen = r.json.commands.find((c) => c.command === "gen: anything");
  assert.deepEqual([gen.kind, gen.status, gen.severity], ["gen", "ok", "none"]);
});
