// Upstream alignment of gsd-plan (owner, 2026-10-25): upstream chunked planning keeps a written plan on a rerun and lets the
// planner set the files its plan changes (files_modified, disjoint only within a wave). A plan key holds the plan's own outline
// row and manifest entry, the decisions naming it and its file; a planner's added owns need no owner answer.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { gsd, P1, plan as planFile, project } from "../gsd-core/fixture.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR, plannerResponder } from "../gsd-flows/world.mjs";

const plan = (w, args = {}) => runScript("gsd-plan", { root: w.root, args: { phaseDir: PHASE_DIR, ...args }, gsd: w.gsd, agent: plannerResponder(w) });

const CONTEXT = "# Context\n\n<decisions>\n- **D-01:** keep it small\n</decisions>\n";
const outline = (objective = "core") => `| Plan ID | Objective | Wave | Depends | Requirements |\n| --- | --- | --- | --- | --- |\n| 01-01 | ${objective} | 1 | - | CORE-01 |\n| 01-02 | stop | 2 | 01-01 | CORE-02 |\n\n## OUTLINE COMPLETE\n`;
const manifest = (bOwns = ["Path:src/b.js"]) => JSON.stringify({ phase: "1", plans: [{ id: "01-01", owns: ["Path:src/a.js"], requirements: ["CORE-01"], produces: [{ symbol: "Core.run", kind: "method", file: "src/a.js", signature: "void run()" }], consumes: [] }, { id: "01-02", owns: bOwns, requirements: ["CORE-02"], produces: [], consumes: [] }] });
const world = () => project({ files: {
  [`${P1}/01-CONTEXT.md`]: CONTEXT,
  [`${P1}/01-PLAN-OUTLINE.md`]: outline(),
  [`${P1}/01-PLAN-OUTLINE.manifest.json`]: manifest(),
  [`${P1}/01-01-PLAN.md`]: planFile({ id: "01", files: "[src/a.js, src/extra.js]", owns: "[\"Path:src/a.js\", \"Path:src/extra.js\"]" }),
  [`${P1}/01-02-PLAN.md`]: planFile({ id: "02", wave: 2, depends: "[01-01]", files: "[src/b.js]", owns: "[\"Path:src/b.js\"]", reqs: "[CORE-02]" }),
} });
const check = async (p, key) => { const c = await gsd(p, ["revisions", "check", "1", key, "--settings", "S"]); return c.code === 0 ? "same" : c.json.changed; };

test("a plan key holds through a CONTEXT edit, an outline decision and another plan's row; its own row, entry or file changes it", async () => {
  const p = world();
  for (const k of ["plan:01-01", "plan:01-02"]) assert.equal((await gsd(p, ["revisions", "record", "1", k, "--settings", "S"])).code, 0, k);
  p.write(`${P1}/01-CONTEXT.md`, CONTEXT.replace("small", "smaller"));
  await gsd(p, ["decide", "1", "--outline", "--text", "the cache moves to phase 5"]);
  p.write(`${P1}/01-PLAN-OUTLINE.manifest.json`, manifest(["Path:src/b.js", "Path:src/c.js"]));
  assert.equal(await check(p, "plan:01-01"), "same", "CONTEXT, an outline decision and 01-02's entry are no part of 01-01's key");
  assert.deepEqual(await check(p, "plan:01-02"), ["entry:01-02"]);
  p.write(`${P1}/01-PLAN-OUTLINE.md`, outline("core and its cli"));
  assert.deepEqual(await check(p, "plan:01-01"), ["entry:01-01"]);
  assert.deepEqual(await check(p, "plan:01-02"), ["entry:01-02"], "01-02's row did not change; its entry did above");
  // A setting other than the planning limits is the workflow's, not the key's: the same digest keeps the plan.
  assert.deepEqual((await gsd(p, ["revisions", "check", "1", "plan:01-02", "--settings", "T"])).json.changed, ["entry:01-02", "settings"]);
});

test("a plan record of the previous kit holds while its plan, the outline and the manifest are as recorded, and is reported legacy", async () => {
  const p = world();
  assert.equal((await gsd(p, ["revisions", "record", "1", "freeze", "--settings", "F"])).code, 0);
  assert.equal((await gsd(p, ["revisions", "record", "1", "plan:01-01", "--settings", "S"])).code, 0);
  // The previous kit's plan record: every freeze part, the plan file, the roadmap and the planner's settings, no entry part.
  const file = p.path(`${P1}/revisions.json`);
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const planLabel = `${P1}/01-01-PLAN.md`;
  const { settings: _f, ...freezeParts } = data.keys.freeze.parts;
  data.keys["plan:01-01"] = { ...data.keys["plan:01-01"], hash: "previous-kit", parts: { ...freezeParts, [planLabel]: data.keys["plan:01-01"].parts[planLabel], settings: "planner-role-digest" } };
  fs.writeFileSync(file, JSON.stringify(data));
  p.write(`${P1}/01-CONTEXT.md`, CONTEXT.replace("small", "smaller"));
  const shown = await gsd(p, ["revisions", "show", "1"]);
  assert.deepEqual([shown.json.keys["plan:01-01"].form, shown.json.keys.freeze.form], ["previous", undefined]);
  const held = await gsd(p, ["revisions", "check", "1", "plan:01-01", "--settings", "S"]);
  assert.deepEqual([held.code, held.json.legacy, held.json.changed], [0, true, []], JSON.stringify(held.json));
  p.write(`${P1}/01-PLAN-OUTLINE.md`, outline("core and its cli"));
  const moved = await gsd(p, ["revisions", "check", "1", "plan:01-01", "--settings", "S"]);
  assert.deepEqual([moved.code, moved.json.legacy], [1, true], "an outline changed since that record: planned again, as before");
});

test("gsd-plan renews a previous-form plan record that holds before the outline stage, and only that one", async () => {
  const w = makeWorld();
  assert.equal((await plan(w)).result.status, "planned");
  w.gsd.on("revisions show", () => ({ keys: { "plan:01-01": { form: "previous" }, "plan:01-02": {} } }));
  const baseCheck = w.gsd.handlers["revisions check"];
  w.gsd.on("revisions check", (args, input, argv) => (args[1] === "plan:01-01" && !w.events.includes("renewed") ? { code: 0, json: { same: true, legacy: true } } : baseCheck(args, input, argv)));
  w.events.length = 0;
  const r = await plan(w);
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  assert.ok(r.logs.includes("log plan:01-01: record renewed in the plan's own form"), r.logs.join("\n"));
  assert.ok(w.events.includes("record plan:01-01"));
  assert.ok(!r.logs.some((l) => l.includes("plan:01-02: record renewed")));
});


test("the kit defaults run no skeleton review, no wiring stage and no contract gate (upstream GSD has none of them)", async () => {
  const { gsd: d } = JSON.parse(fs.readFileSync(new URL("../../ship/.agents/harness.defaults.json", import.meta.url), "utf8"));
  assert.deepEqual([d.skeleton_lanes, d.wiring, "contract_check" in d], [[], "never", false]);
  const verbs = await import("../../ship/.agents/harness/gsd/verbs.mjs");
  assert.deepEqual(Object.keys(verbs.verbHandlers).filter((k) => /contract/.test(k)), []);
  const arch = { ".agents/agents/arch.md": "---\nname: arch\n---\nbody\n" };
  const rows = [{ id: "01-01", wave: 1 }, { id: "01-02", wave: 2, depends: ["01-01"], consumes: [{ plan: "01-01", symbol: "Api" }] }];
  const w = makeWorld({ files: arch, overlay: { adapter: { agents: { architect: "arch" } }, gsd: { skeleton_lanes: [], wiring: "never" } } });
  const r = await runScript("gsd-plan", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: plannerResponder(w, { rows }) });
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  assert.deepEqual(r.calls.map((c) => c.opts.label).filter((l) => /^(skeleton-|resolve-|architect)/.test(l)), []);
  assert.ok(r.logs.includes("log wiring: skipped (wiring never)"), r.logs.join("\n"));
});
