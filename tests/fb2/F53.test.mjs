// kit-feedback 53: a review fix that needs a file a committed earlier-wave plan owns stops needs-owner with a grant
// option (ph gsd grant); the grant lets the phase's fixers change that file, and the wave commit records it as integration.
import assert from "node:assert/strict";
import test from "node:test";
import { executor, makeExecWorld, task } from "../gsd-flows/exec-world.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { PHASE_DIR } from "../gsd-flows/world.mjs";
import { gsd as runGsdIn, plan, project } from "../gsd-core/fixture.mjs";

const PD = PHASE_DIR;
const finding = (id, extra = {}) => ({ id, severity: "high", trigger: "empty input", likelihood: "likely", confidence: 90, impact: "crash", file: "src/01-02/impl.js", line: 1, description: `finding ${id}`, ...extra });

// The fix of the review finding: the fixer can change src/01-01/shared.js only when the grant put it in its owns.
const fixOverrides = (w) => ({
  "review-01-02": () => ({ findings: [finding("F1")] }),
  "fix-review": (prompt) => {
    if (!/You own: .*"src\/01-01\/shared\.js"/.test(prompt)) {
      return { status: "unresolved", remaining_failures: 1, evidence: "the fix needs src/01-01/shared.js, outside owns", requests: [{ path: "src/01-01/shared.js", change: "reject oversized sends", reason: "R2-CR-02" }] };
    }
    w.write("src/01-01/shared.js", "reject\n");
    return { status: "fixed", attempts: 1, remaining_failures: 0 };
  },
});

test("F53 a review fix that needs a file a committed plan owns stops with a grant option; the grant lets the fixer change it and the wave commit records it as integration", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")], [task("01-02")]] });
  const first = await runScript("gsd-execute", { root: w.root, args: { phaseDir: PD }, gsd: w.gsd, agent: executor(w, fixOverrides(w)) });
  assert.equal(first.result.status, "needs-owner", JSON.stringify(first.result));
  assert.equal(first.result.stage, "Fix");
  assert.deepEqual(first.result.grantRequests, [{ path: "src/01-01/shared.js", change: "reject oversized sends", reason: "R2-CR-02", plan: "01-01" }]);
  assert.match(first.result.options[0], /ph gsd grant 0?1 --path src\/01-01\/shared\.js --plan 01-01, then rerun with the same args/);
  // The owner's grant is the file <phase>/grants.json that `ph gsd grant` writes (see the verb test below).
  w.write(`${PD}/grants.json`, JSON.stringify([{ path: "src/01-01/shared.js", plan: "01-01" }]));
  const second = await runScript("gsd-execute", { root: w.root, args: { phaseDir: PD }, gsd: w.gsd, agent: executor(w, fixOverrides(w)) });
  assert.equal(second.result.status, "executed", JSON.stringify(second.result));
  assert.match(second.calls.find((c) => c.opts.label === "fix-review-w2").prompt, /You own: .*"src\/01-01\/shared\.js"/);
  assert.equal(w.read("src/01-01/shared.js"), "reject\n");
  assert.deepEqual(JSON.parse(w.read(`${PD}/commits.json`)).at(-1).integration, ["src/01-01/shared.js"]);
});

test("F53 a granted file changed in the main tree joins the wave commit as integration, though no fixer touched it", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")], [task("01-02")]] });
  w.write(`${PD}/grants.json`, JSON.stringify([{ path: "src/01-01/shared.js", plan: "01-01" }]));
  const run = executor(w);
  const r = await runScript("gsd-execute", { root: w.root, args: { phaseDir: PD }, gsd: w.gsd, agent: executor(w, {
    "exec-01-02": async (...a) => {
      w.write("src/01-01/shared.js", "owner edit\n");
      return run(...a);
    },
  }) });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  assert.deepEqual(JSON.parse(w.read(`${PD}/commits.json`)).at(-1).integration, ["src/01-01/shared.js"]);
});

test("F53 ph gsd grant records the grant of a file to the phase; a plan is named only when it owns the file", async () => {
  const p = project({ files: { [`${PD}/01-01-PLAN.md`]: plan({ id: "01", owns: '["Path:src/01-01/"]' }), [`${PD}/01-02-PLAN.md`]: plan({ id: "02", owns: '["Path:src/01-02/"]' }) } });
  const notOwner = await runGsdIn(p, ["grant", "1", "--path", "src/01-01/shared.js", "--plan", "01-02"]);
  assert.equal(notOwner.code, 1);
  assert.match(notOwner.json.error, /01-02 does not own src\/01-01\/shared\.js \(owned by 01-01\)/);
  const noPlan = await runGsdIn(p, ["grant", "1", "--path", "src/01-01/shared.js"]);
  assert.equal(noPlan.code, 1);
  assert.match(noPlan.json.error, /owned by 01-01; grant it with --plan/);
  assert.equal((await runGsdIn(p, ["grant", "1", "--path", "../outside.js"])).code, 1);
  assert.equal((await runGsdIn(p, ["grant", "1", "--path", "src/01-01/shared.js", "--plan", "01-01"])).code, 0);
  assert.equal((await runGsdIn(p, ["grant", "1", "--path", "docs/notes.md"])).code, 0);
  assert.equal((await runGsdIn(p, ["grant", "1", "--path", "src/01-01/shared.js", "--plan", "01-01"])).code, 0);
  // The repeated grant replaces its earlier entry, so the list holds each path once.
  assert.deepEqual(p.readJson(`${PD}/grants.json`).map((x) => [x.path, x.plan]), [["docs/notes.md", null], ["src/01-01/shared.js", "01-01"]]);
});
