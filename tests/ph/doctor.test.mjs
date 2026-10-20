import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadConfigLenient } from "../../ship/.agents/harness/config.mjs";
import { connect } from "../../ship/.agents/harness/paseo-client/index.mjs";
import { runDoctor } from "../../ship/.agents/harness/runtime/doctor.mjs";
import { TIERS, setup } from "./setup.mjs";

const PLENTY = () => 64 * 2 ** 30;

function paseoConfig(s, providers) {
  fs.writeFileSync(path.join(s.env.PASEO_HOME, "config.json"), JSON.stringify({ agents: { providers } }));
}

const GOOD_PROVIDERS = (cfgDenies) => ({
  circle: { extends: "claude", disallowedTools: ["Agent", "Workflow"] },
  "circle-agent": { extends: "claude", disallowedTools: cfgDenies, env: { ENABLE_TOOL_SEARCH: "true" } },
});

async function doctor(s, { freemem = PLENTY, version = "2.1.300 (Claude Code)" } = {}) {
  const { cfg, error } = loadConfigLenient(s.root);
  const out = [];
  let session;
  const ctx = {
    env: s.env, root: s.root, cfg, configError: error, clock: s.clock, out: (l) => out.push(l),
    paseo: () => (session ??= connect({ env: s.env, root: s.root, cfg, clock: s.clock, daemon: s.fake.daemon })),
  };
  const code = await runDoctor(ctx, { freemem, claudeVersionText: () => version });
  return { code, out };
}

const has = (r, re) => assert.ok(r.out.some((l) => re.test(l)), `${re}\n${r.out.join("\n")}`);
const hasNot = (r, re) => assert.ok(!r.out.some((l) => re.test(l)), `${re}\n${r.out.join("\n")}`);

test("PHCL-04 doctor with the daemon down: problem paseo, no tier lines, later checks still run", async () => {
  const s = setup({ fake: { down: "connection refused" } });
  const r = await doctor(s);
  assert.equal(r.code, 2);
  has(r, /^ok node /);
  has(r, /^ok PASEO_AGENT_ID c0ffee00/);
  has(r, /^ok harness config valid$/);
  has(r, /^problem paseo: Cannot connect to daemon at fake: connection refused$/);
  hasNot(r, /^\S+ tier /);
  has(r, /^ok default_tier standard -> circle-agent\/std-model\[1m\]$/);
  has(r, /^ok overlay .*harness\.config\.json$/);
  assert.match(r.out.at(-1), /^note this check does not verify tools loaded into a running session/);
});

test("PHCL-04 doctor with broken overlay JSON: one problem, the rest runs on kit defaults", async () => {
  const s = setup();
  s.project.write(".agents/harness.config.json", "{ broken");
  const r = await doctor(s);
  assert.equal(r.code, 2);
  assert.equal(r.out.filter((l) => /invalid harness config overlay: invalid JSON/.test(l)).length, 1);
  has(r, /^problem tier standard has no model; set tiers\.standard\.provider in \.agents\/harness\.config\.json/);
  has(r, /^problem default_tier standard: tier standard has no model/);
  has(r, /^note this check does not verify/);
});

test("PHCL-04 doctor tier lines: clamped thinking, features, a model the provider does not offer", async () => {
  const s = setup({ overlay: { tiers: { ...TIERS, pro: { provider: "circle/pro-model[1m]", thinking: "xhigh", features: { fast_mode: true } } } } });
  s.fake.setModels("circle-agent", [
    { id: "pro-model[1m]", thinkingOptions: [{ id: "low" }, { id: "high" }] },
    { id: "std-model[1m]", thinkingOptions: [] },
  ]);
  const r = await doctor(s);
  has(r, /^note paseo cli 0\.11\.2 at \/fake\/paseo-cli \(tested with 0\.11\.2\); daemon reachable$|^ok paseo cli 0\.11\.2 at \/fake\/paseo-cli \(tested with 0\.11\.2\); daemon reachable$/);
  has(r, /^ok caller agent found: leader$/);
  has(r, /^ok tier pro -> circle\/pro-model\[1m\] thinking high features fast_mode=true$/);
  has(r, /^ok tier standard -> circle\/std-model\[1m\] thinking default$/);
  has(r, /^problem tier frontier -> circle\/front-model\[1m\] thinking default \(model not offered by the provider\)$/);
  assert.equal(r.code, 2);
});

test("PHCL-04 doctor version note, allowlist-gated default tier, provider policy, adapter and agent types", async () => {
  const s = setup({
    overlay: { allowed_models: ["circle/pro-model"], adapter: { instructions: ["docs/missing.md"] } },
    files: { ".agents/agents/rev.md": "---\ntools: Read\n---\nx\n" },
    fake: { version: "0.12.0" },
  });
  paseoConfig(s, GOOD_PROVIDERS(["Agent"]));
  const r = await doctor(s);
  has(r, /^note paseo cli 0\.12\.0 at .* \(tested with 0\.11\.2\); daemon reachable$/);
  has(r, /^problem default_tier standard: model circle\/std-model\[1m\] is not in config allowed_models$/);
  has(r, /^problem agent provider circle-agent does not disallow AskUserQuestion, .*SendMessage.*; run kit.mjs machine apply$/);
  has(r, /^ok main provider circle: Agent, Workflow disallowed/);
  hasNot(r, /SendMessage.*main|main.*SendMessage/);
  has(r, /^problem adapter file missing: docs\/missing\.md \(adapter\.instructions\[0\]\)$/);
  has(r, /^ok agent types in \.agents\/agents\/ \(1\): rev$/);
});

test("PHCL-04 doctor: a main provider without SendMessage gets no line about it; full worker policy is ok", async () => {
  const s = setup();
  const { cfg } = loadConfigLenient(s.root);
  paseoConfig(s, GOOD_PROVIDERS(cfg.agent_provider_disallowed_tools));
  const r = await doctor(s);
  has(r, /^ok agent provider circle-agent: 18 required rule\(s\) and the kit env present; 0 owner extra rule\(s\) preserved$/);
  has(r, /^ok main provider circle: Agent, Workflow disallowed/);
  hasNot(r, /SendMessage/);
});

test("PHCL-04 doctor low-RAM note and mod lines", async () => {
  const s = setup();
  const r = await doctor(s, { freemem: () => 2 * 2 ** 30, version: null });
  has(r, /^note free RAM 2048 MB is below max_subagents 20 x 350 MB = 7000 MB/);
  has(r, /^problem file mod missing: /);
  has(r, /^note Claude Code version unknown/);
  has(r, /^note file mod not selected/);
  has(r, /^note file mod inactive or unsupported for workers/);
  const old = await doctor(s, { version: "2.1.100" });
  has(old, /^problem Claude Code 2\.1\.100 \(the harness-files mod needs >= 2\.1\.296/);
});

test("PHCL-04 GSDC-47 doctor runs gsd upstream check and reports its summary", async () => {
  const s = setup();
  paseoConfig(s, GOOD_PROVIDERS([]));
  const r = await doctor(s);
  has(r, /^ok gsd upstream check: 0 problems, \d+ warnings; \d+ references followed, \d+ verbs mapped$/);
});
