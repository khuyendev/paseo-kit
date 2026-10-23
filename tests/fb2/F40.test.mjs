// Fix F40 (kit-feedback 40, 48): a revision check names the part of the key that changed, and forceProceed does not accept the
// plans a planner wrote in the same run. Item 48's wave headers are already left out of the ROADMAP part (G053 covers that).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { P1, ROADMAP, gsd, project } from "../gsd-core/fixture.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR, plannerResponder } from "../gsd-flows/world.mjs";

const check = (p, key, ...more) => gsd(p, ["revisions", "check", "1", key, ...more]);
const plan = (w, args = {}, overrides = {}) => runScript("gsd-plan", { root: w.root, args: { phaseDir: PHASE_DIR, ...args }, gsd: w.gsd, agent: plannerResponder(w, { overrides }) });
const labels = (r) => r.calls.map((c) => c.opts.label);

test("F40 a changed input is named: the check lists the file of the key that differs", async () => {
  const p = project({ files: { [`${P1}/01-CONTEXT.md`]: "<decisions></decisions>\n" } });
  await gsd(p, ["revisions", "record", "1", "inputs"]);
  p.write(`${P1}/01-CONTEXT.md`, "<decisions>\n- **D-01:** changed\n</decisions>\n");
  const r = await check(p, "inputs");
  assert.equal(r.code, 1);
  assert.deepEqual(r.json.changed, [`${P1}/01-CONTEXT.md`]);
});

test("F40 a changed goal of this phase and a changed settings digest are named; another phase's goal is not", async () => {
  const p = project({ files: { [`${P1}/01-CONTEXT.md`]: "<decisions></decisions>\n" } });
  await gsd(p, ["revisions", "record", "1", "research", "--settings", "s1"]);
  p.write(".planning/ROADMAP.md", ROADMAP.replace("**Goal**: Api works", "**Goal**: Api works fast"));
  assert.equal((await check(p, "research", "--settings", "s1")).code, 0, "another phase's goal");
  p.write(".planning/ROADMAP.md", ROADMAP.replace("**Goal**: Core works", "**Goal**: Core works fast"));
  const r = await check(p, "research", "--settings", "s2");
  assert.equal(r.code, 1);
  assert.deepEqual(r.json.changed, ["roadmap", "settings"]);
});

test("F40 a record written before the parts were kept names no input rather than a wrong one", async () => {
  const p = project({ files: { [`${P1}/01-CONTEXT.md`]: "<decisions></decisions>\n" } });
  await gsd(p, ["revisions", "record", "1", "inputs"]);
  const file = path.join(p.root, P1, "revisions.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const k of Object.values(data.keys)) delete k.parts;
  fs.writeFileSync(file, JSON.stringify(data));
  p.write(`${P1}/01-CONTEXT.md`, "<decisions>\n- **D-01:** changed\n</decisions>\n");
  const r = await check(p, "inputs");
  assert.equal(r.code, 1);
  assert.equal(r.json.changed, null);
});

test("F40 forceProceed is refused for plans this run wrote; a rerun that keeps them accepts the stuck plan", async () => {
  const w = makeWorld();
  const stuck = () => ({ issues: [{ plan: "01-01", severity: "blocker", description: "still open" }] });
  const args = { maxCheckIterations: 1, forceProceed: { reason: "owner accepts" } };
  const first = await plan(w, args, { "checker-": stuck });
  assert.equal(first.result.status, "needs-owner");
  assert.match(first.result.reason, /^forceProceed refused: 01-01 written by a planner in this run/);
  assert.equal(w.events.some((e) => e.startsWith("state override")), false);
  const rerun = await plan(w, args, { "checker-": stuck });
  assert.equal(rerun.result.status, "planned");
  assert.equal(rerun.result.override.reason, "owner accepts");
  assert.deepEqual(labels(rerun).filter((l) => l.startsWith("plan-")), []);
});

test("F40 a changed input is logged when the outline is regenerated", async () => {
  const w = makeWorld();
  await plan(w);
  w.write(`${PHASE_DIR}/01-CONTEXT.md`, "<decisions>\n- **D-01:** changed\n</decisions>\n");
  const r = await plan(w);
  assert.ok(r.logs.some((l) => /^log inputs changed: /.test(l)), r.logs.join("\n"));
});
