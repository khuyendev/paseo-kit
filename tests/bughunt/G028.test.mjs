// G028: the tasks_per_plan limit is enforced (an error, not a warning), and handoff refuses a plan over it.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { P1, gsd, plan, project } from "../gsd-core/fixture.mjs";

const task = (name) => `<task type="auto">\n<name>${name}</name><files>src/a.js</files><action>do</action><verify><automated>cmd: node src/a.js</automated><fails_when>exit 1</fails_when></verify><done>d</done>\n</task>`;
const tasks = (n) => Array.from({ length: n }, (_, i) => task(`T${i + 1}`)).join("\n");
const limits = (tasks_per_plan) => ({ gsd: { plan_limits: { tasks_per_plan, plans_per_phase: 12, waves_per_phase: 4 } } });

test("G028 a plan over gsd.plan_limits.tasks_per_plan is a plan-structure error, and handoff refuses it", async () => {
  const p = project({ files: { [`${P1}/01-01-PLAN.md`]: plan({ tasks: tasks(4) }), "src/a.js": "" } });
  const st = await gsd(p, ["verify", "plan-structure", "1"]);
  assert.equal(st.code, 1);
  assert.equal(st.json.valid, false);
  assert.ok(st.json.errors.includes("4 tasks > gsd.plan_limits.tasks_per_plan 3 (split the plan)"), st.json.errors.join("\n"));
  assert.deepEqual(st.json.warnings, []);
  const h = await gsd(p, ["handoff", "1"]);
  assert.equal(h.code, 1);
  assert.equal(h.json.status, "refused");
  assert.ok(h.json.errors.includes("01-01: 4 tasks > gsd.plan_limits.tasks_per_plan 3 (split the plan)"), h.json.errors.join("\n"));
  assert.ok(!fs.existsSync(p.path(`${P1}/handoff`)), "no handoff written");
});

test("G028 a plan at the limit passes, and the limit is the project's configured value", async () => {
  const atLimit = project({ files: { [`${P1}/01-01-PLAN.md`]: plan({ tasks: tasks(3) }), "src/a.js": "" } });
  assert.equal((await gsd(atLimit, ["verify", "plan-structure", "1"])).code, 0);
  assert.equal((await gsd(atLimit, ["handoff", "1"])).code, 0);
  const wider = project({ files: { [`${P1}/01-01-PLAN.md`]: plan({ tasks: tasks(4) }), "src/a.js": "" }, overlay: limits(4) });
  assert.equal((await gsd(wider, ["verify", "plan-structure", "1"])).code, 0);
  assert.equal((await gsd(wider, ["handoff", "1"])).code, 0);
});

test("G028 the checker overlay takes its task-count limit from the Plan limits line, not fixed 4 and 5 thresholds", () => {
  const overlay = fs.readFileSync(fileURLToPath(new URL("../../ship/.agents/gsd/overlays/gsd-plan-checker.md", import.meta.url)), "utf8");
  assert.match(overlay, /Task count: the `tasks_per_plan` of the Plan limits line in your prompt is the limit/);
});
