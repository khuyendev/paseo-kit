import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadConfigLenient } from "../../ship/.agents/harness/config.mjs";
import { connect } from "../../ship/.agents/harness/paseo-client/index.mjs";
import { runDoctor } from "../../ship/.agents/harness/runtime/doctor.mjs";
import { SHIP_DIR, installRuntime } from "../helpers/temp.mjs";
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
  has(r, /^note free RAM 2048 MB is below max_subagents 20 x 700 MB = 14000 MB/);
  has(r, /^note suggested max_live_subagents 2 \(free RAM 2048 MB \/ 700 MB per agent\)$/);
  has(r, /^problem file mod missing: /);
  has(r, /^note Claude Code version unknown/);
  has(r, /^note file mod not selected/);
  has(r, /^note file mod inactive or unsupported for workers/);
  const old = await doctor(s, { version: "2.1.100" });
  has(old, /^problem Claude Code 2\.1\.100 \(the harness-files mod needs >= 2\.1\.296/);
});

// The GSD method text as the installer lays it down in a project: the runtime, the snapshot and every inventory file.
function installGsd(s) {
  installRuntime(s.root);
  for (const dir of ["agents", "gsd"]) fs.cpSync(path.join(SHIP_DIR, ".agents", dir), s.project.path(`.agents/${dir}`), { recursive: true });
  const inventory = JSON.parse(fs.readFileSync(path.join(SHIP_DIR, ".agents", "gsd", "inventory.json"), "utf8"));
  for (const { installed } of inventory.entries) {
    const from = path.join(SHIP_DIR, ...installed.split("/"));
    if (fs.existsSync(from)) fs.cpSync(from, s.project.path(installed), { recursive: true });
  }
}

test("PHCL-04 GSDC-47 doctor checks the GSD install of the selected project, not the runtime's own tree", async () => {
  const s = setup();
  paseoConfig(s, GOOD_PROVIDERS([]));
  const bare = await doctor(s);
  hasNot(bare, /^ok gsd upstream/);
  has(bare, /^problem gsd upstream /);
  installGsd(s);
  const r = await doctor(s);
  has(r, /^ok gsd upstream check: 0 problems, \d+ warnings; \d+ references followed, \d+ verbs mapped$/);
  const generated = fs.readdirSync(s.project.path(".agents/gsd/generated"), { recursive: true }).find((f) => f.endsWith(".md"));
  fs.appendFileSync(s.project.path(`.agents/gsd/generated/${generated}`), "\nhand edit\n");
  const stale = await doctor(s);
  assert.equal(stale.code, 2);
  has(stale, /^problem gsd upstream generated file stale or hand-edited: /);
  has(stale, /^problem gsd upstream check: [1-9]\d* problems/);
  has(stale, /^ok agent types in /);
});

test("PHCL-04 a project-owned agent beside the GSD agents passes the upstream check; an edited managed one fails", async () => {
  const s = setup();
  installGsd(s);
  s.project.write(".agents/agents/qa-inspector.md", "---\ntools: Read\n---\nInspect.\n");
  has(await doctor(s), /^ok gsd upstream check: 0 problems/);
  const managed = fs.readdirSync(s.project.path(".agents/agents")).find((f) => f.startsWith("gsd-"));
  fs.appendFileSync(s.project.path(`.agents/agents/${managed}`), "\nhand edit\n");
  has(await doctor(s), /^problem gsd upstream /);
});

test("PHCL-04 doctor isolates failing checks: malformed settings or plugin registry is one problem, later checks run", async () => {
  const s = setup();
  s.project.write(".claude/settings.json", "{ broken");
  const r = await doctor(s);
  assert.equal(r.code, 2);
  has(r, /^problem file mod: /);
  has(r, /^problem paseo config .* not found/);
  has(r, /^ok adapter and gsd sections present/);
  has(r, /^\S+ gsd upstream /);
  assert.match(r.out.at(-1), /^note this check does not verify tools loaded into a running session/);
  const t = setup();
  fs.mkdirSync(path.join(t.env.CLAUDE_CONFIG_DIR, "plugins"), { recursive: true });
  fs.writeFileSync(path.join(t.env.CLAUDE_CONFIG_DIR, "plugins", "installed_plugins.json"), "not json");
  const u = await doctor(t);
  assert.equal(u.code, 2);
  has(u, /^problem file mod: /);
  assert.match(u.out.at(-1), /^note this check does not verify tools loaded into a running session/);
});

test("PHCL-04 doctor with a broken overlay and a GSD install checks GSD integrity independently and continues", async () => {
  const s = setup();
  installGsd(s);
  s.project.write(".agents/harness.config.json", "{ broken");
  const r = await doctor(s);
  assert.equal(r.code, 2);
  has(r, /^ok gsd upstream check: 0 problems/);
  has(r, /^problem invalid harness config/);
  has(r, /^ok agent types in /);
  fs.appendFileSync(s.project.path(".agents/agents/gsd-executor.md"), "\nhand edit\n", "utf8");
  const stale = await doctor(s);
  has(stale, /^problem gsd upstream generated file stale or hand-edited:/);
  has(stale, /^ok agent types in /);
});
