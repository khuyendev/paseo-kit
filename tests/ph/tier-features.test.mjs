import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { loadConfig, loadKitConfig } from "../../ship/.agents/harness/config.mjs";
import { resolveModel, selectModel } from "../../ship/.agents/harness/runtime/models.mjs";
import { creates, setup, TIERS } from "./setup.mjs";
import { meta, setup as workflowSetup } from "../workflow/helpers.mjs";

const pro = (fast) => ({ provider: "circle/same-model[1m]", thinking: "medium", features: { fast_mode: fast } });

function setFast(project, fast) {
  const rel = ".agents/harness.config.json";
  const overlay = JSON.parse(fs.readFileSync(project.path(rel), "utf8"));
  overlay.tiers.pro.features.fast_mode = fast;
  project.write(rel, JSON.stringify(overlay, null, 2) + "\n");
  return overlay;
}

test("PHCL-21 PHCL-22 a tier carries Fast independently of model, effort and permission mode", () => {
  const s = setup({ overlay: { tiers: { ...TIERS, pro: pro(true) }, gsd: { roles: {
    planner: { model: "pro", effort: "high", reason: "Test tier reference" },
  } } } });
  const cfg = loadConfig(s.root);
  const chosen = selectModel({ cfg, role: "planner" });
  assert.equal(chosen.id, "circle-agent/same-model[1m]");
  assert.equal(chosen.thinking, "high");
  assert.deepEqual(chosen.features, { fast_mode: true });
  const concrete = selectModel({ cfg, role: "planner", explicit: { model: "circle/other-model", effort: "low" } });
  assert.equal(concrete.id, "circle-agent/other-model");
  assert.equal(concrete.thinking, "low");
  assert.deepEqual(concrete.features, {});
  assert.equal(cfg.mode, loadKitConfig().mode);
  assert.deepEqual(resolveModel(cfg, "pro").features, { fast_mode: true });
  assert.equal(loadKitConfig().tiers.pro.provider, "");
});

test("PHCL-05 PCLI-07 owner toggles one tier on/off and fresh spawn requests preserve the rest", async () => {
  const s = setup({ overlay: { tiers: { ...TIERS, pro: pro(true) }, project_prompt_note: "Keep this owner note" } });
  const before = JSON.parse(fs.readFileSync(s.project.path(".agents/harness.config.json"), "utf8"));
  const on = await s.ph(["spawn", "--name", "on", "--model", "pro", "--prompt", "Reply ready"]);
  assert.equal(on.code, 0, on.stderr);
  const after = setFast(s.project, false);
  const expected = structuredClone(before);
  expected.tiers.pro.features.fast_mode = false;
  assert.deepEqual(after, expected);
  const off = await s.ph(["spawn", "--name", "off", "--model", "pro", "--prompt", "Reply ready"]);
  assert.equal(off.code, 0, off.stderr);
  const [first, second] = creates(s.fake);
  assert.deepEqual(first.featureValues, { fast_mode: true });
  assert.deepEqual(second.featureValues, { fast_mode: false });
  for (const key of ["provider", "model", "thinkingOptionId", "modeId"]) assert.equal(first[key], second[key], key);
  assert.equal(first.modeId, loadKitConfig().mode);
  assert.equal(first.model, "same-model[1m]");
});

test("PHCL-08 tier Fast setting reaches fanout without a separate Fast-named tier", async () => {
  const s = setup({ overlay: { tiers: { ...TIERS, pro: pro(true) } }, files: {
    "fanout.txt": "=== reviewer model=pro\nReply ready\n=== checker model=pro\nReply ready\n",
  } });
  const r = await s.ph(["fanout", "--file", "fanout.txt"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(creates(s.fake).length, 2);
  for (const request of creates(s.fake)) assert.deepEqual(request.featureValues, { fast_mode: true });
});

test("FLOW-04 PHCL-22 a role referencing a tier gets its updated Fast value on each new workflow launch", async () => {
  const s = workflowSetup({ overlay: { tiers: { ...TIERS, pro: pro(true) }, gsd: { roles: {
    planner: { model: "pro", effort: "medium", reason: "Test tier selection" },
  } } } });
  s.project.write("tier.js", `${meta()}return await agent("Reply ready", {role: "planner"});\n`);
  const first = await s.ph(["workflow", "--script", "tier.js", "--run-id", "wf_tier_on"]);
  assert.equal(first.code, 0, first.stderr);
  setFast(s.project, false);
  const second = await s.ph(["workflow", "--script", "tier.js", "--run-id", "wf_tier_off"]);
  assert.equal(second.code, 0, second.stderr);
  const requests = s.fake.callsOf("createAgent").map((call) => call.args[0]);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map((r) => r.featureValues), [{ fast_mode: true }, { fast_mode: false }]);
  assert.equal(requests[0].model, requests[1].model);
  assert.equal(requests[0].thinkingOptionId, requests[1].thinkingOptionId);
  assert.equal(requests[0].modeId, requests[1].modeId);
});
