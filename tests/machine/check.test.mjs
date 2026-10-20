import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { main as kitMain } from "../../kit.mjs";
import { loadKitConfig } from "../../ship/.agents/harness/config.mjs";
import { KIT_DIR, makeTempDir } from "../helpers/temp.mjs";
import { machineContext } from "../../kit/machine/context.mjs";
import { completeMachine, makeMachine, snapshot } from "./helpers.mjs";

const WORKER_DENIES = ["Agent", "AskUserQuestion", "CronCreate", "CronDelete", "CronList", "DesignSync", "EnterPlanMode", "EnterWorktree", "ExitPlanMode", "ExitWorktree", "ListAgents", "Monitor", "PushNotification", "ReportFindings", "ScheduleWakeup", "SendMessage", "WebSearch", "Workflow"];

function kitFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if ([".git", "node_modules", ".planning"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    out.push(full);
    if (entry.isDirectory()) kitFiles(full, out);
  }
  return out;
}

test("MACH-01 unknown subcommands and retired flags print usage, exit 1, write nothing", async () => {
  const m = await completeMachine();
  const watched = [m.config, path.join(m.home, ".claude"), path.join(m.home, ".claude-circle")];
  const before = snapshot(watched);
  const backups = m.backups();
  for (const argv of [["bogus"], ["apply", "--dirs", "C:/"], ["apply", "--fs-server", "x"], ["apply", "--remove-local", "p"], ["check", "--x"], ["apply", "--link-user-skills", "--unlink-user-skills"], []]) {
    const r = await m.run(argv);
    assert.equal(r.code, 1, argv.join(" "));
    assert.match(r.err[0], /^usage: node kit\.mjs machine check \| apply/);
    assert.deepEqual(r.out, []);
  }
  assert.deepEqual(snapshot(watched), before);
  assert.deepEqual(m.backups(), backups);
});

test("MACH-01 kit.mjs dispatches machine verbs; no sync_agent_provider.mjs shim in the kit tree", async () => {
  const err = [];
  assert.equal(await kitMain(["machine", "bogus"], { out: () => {}, err: (l) => err.push(l), env: makeMachine().env }), 1);
  assert.match(err.join("\n"), /usage: node kit\.mjs machine/);
  assert.equal(kitFiles(KIT_DIR).some((f) => path.basename(f) === "sync_agent_provider.mjs"), false);
});

test("MACH-01 an expected failure prints failed: <msg> and exits 1", async () => {
  const m = makeMachine({ live: null });
  const r = await m.run(["check"]);
  assert.equal(r.code, 1);
  assert.match(r.err[0], /^failed: cannot read the Paseo config .*config\.json: missing$/);
});

test("MACH-02 check is read-only: bytes and mtimes unchanged, only claude --version, no Paseo call", async () => {
  const m = await completeMachine();
  fs.rmSync(m.env.FAKE_CLAUDE_LOG, { force: true });
  const watched = [m.config, path.join(m.home, ".claude"), path.join(m.home, ".claude-circle"), path.join(m.home, ".paseo-kit")];
  const before = snapshot(watched);
  const r = await m.run(["check"]);
  assert.equal(r.code, 0, r.stdout);
  assert.deepEqual(snapshot(watched), before);
  assert.deepEqual(m.logOf("claude").map((c) => c.args), [["--version"]]);
  assert.deepEqual(m.logOf("paseo"), []);
  assert.ok(r.out.every((l) => /^(ok|problem|note) /.test(l)), r.stdout);
});

test("MACH-02 a missing or unparsable Paseo config exits 1", async () => {
  assert.equal((await makeMachine({ live: null }).run(["check"])).code, 1);
  const m = makeMachine();
  fs.writeFileSync(m.config, "{ not json", "utf8");
  const r = await m.run(["check"]);
  assert.equal(r.code, 1);
  assert.match(r.err[0], /^failed: cannot read the Paseo config .*invalid JSON/);
});

test("MACH-03 check prints the lines in order and no backlog, mcp or machine.local line", async () => {
  const m = await completeMachine();
  const r = await m.run(["check"]);
  assert.equal(r.code, 0, r.stdout);
  const want = [
    /^ok node \d+\.\d+\.\d+ \(needs Node 20\.17\+/,
    /^ok platform /,
    /^ok Claude Code 2\.1\.300; the harness-files mod needs >= 2\.1\.296$/,
    /^note the harness-files mod is activated per project: kit\.mjs install\|update <project> --enable-plugin, then verify with ph doctor$/,
    /^ok Paseo providers circle, circle-agent have every template model$/,
    /^ok agent provider circle-agent: 18 required rule\(s\) and the kit env present; 0 owner extra rule\(s\) preserved$/,
    /^ok main provider circle: Agent, Workflow disallowed \(orchestration goes through Paseo\)$/,
    /^note Paseo plugins off \(pluginsEnabled\)$/,
    /^note kit Paseo plugin folder planning-panel: no paseo-plugin\.json$/,
    /^note kit Paseo plugin folder swarm-map: no paseo-plugin\.json$/,
    /^note .*\.claude-circle[\\/]skills[\\/]kit-init: kit-init link missing \(kit\.mjs machine apply --link-user-skills\)$/,
  ];
  assert.equal(r.out.length, want.length, r.stdout);
  want.forEach((re, i) => assert.match(r.out[i], re));
  assert.doesNotMatch(r.stdout, /backlog|mcp|machine\.local/i);
});

test("MACH-03 a missing provider or model is a problem; an extra model id gives exactly one note", async () => {
  const m = await completeMachine();
  const live = m.readConfig();
  live.agents.providers.circle.models.push({ id: "old-x", label: "Old" });
  fs.writeFileSync(m.config, JSON.stringify(live), "utf8");
  const r = await m.run(["check"]);
  assert.equal(r.code, 0, r.stdout);
  const notes = r.out.filter((l) => l.includes("old-x"));
  assert.deepEqual(notes, ["note Paseo provider circle has the model old-x, which the template no longer ships; left for the owner to remove in Paseo"]);
  live.agents.providers.circle.models = live.agents.providers.circle.models.filter((x) => x.id !== "claude-haiku-4-5");
  delete live.agents.providers["circle-agent"];
  fs.writeFileSync(m.config, JSON.stringify(live), "utf8");
  const r2 = await m.run(["check"]);
  assert.equal(r2.code, 2);
  assert.ok(r2.out.includes("problem Paseo provider circle lacks the models claude-haiku-4-5; run kit.mjs machine apply"), r2.stdout);
  assert.ok(r2.out.some((l) => /^problem Paseo provider circle-agent is missing from .*config\.json; run kit\.mjs machine apply$/.test(l)), r2.stdout);
});

async function checkWith(edit) {
  const m = await completeMachine();
  const live = m.readConfig();
  edit(live.agents.providers);
  fs.writeFileSync(m.config, JSON.stringify(live), "utf8");
  return m.run(["check"]);
}

test("MACH-04 a worker lacking SendMessage is a problem naming it", async () => {
  const r = await checkWith((p) => (p["circle-agent"].disallowedTools = p["circle-agent"].disallowedTools.filter((t) => t !== "SendMessage")));
  assert.equal(r.code, 2);
  assert.ok(r.out.includes("problem agent provider circle-agent does not disallow SendMessage; run kit.mjs machine apply"), r.stdout);
});

test("MACH-04 owner extra denies are counted, never a problem; Read gets no special line", async () => {
  const r = await checkWith((p) => p["circle-agent"].disallowedTools.push("Bash(rm *)"));
  assert.equal(r.code, 0, r.stdout);
  assert.ok(r.out.some((l) => /^ok agent provider circle-agent: .*; 1 owner extra rule\(s\) preserved$/.test(l)), r.stdout);
  const r2 = await checkWith((p) => p["circle-agent"].disallowedTools.push("Bash(rm *)", "Read"));
  assert.equal(r2.code, 0, r2.stdout);
  assert.ok(r2.out.some((l) => /2 owner extra rule\(s\) preserved$/.test(l)), r2.stdout);
  assert.equal(r2.out.filter((l) => /\bRead\b/.test(l)).length, 0);
});

test("MACH-04 a non-array disallowedTools, a missing env key and a missing worker are problems", async () => {
  const r = await checkWith((p) => (p["circle-agent"].disallowedTools = "x"));
  assert.equal(r.code, 2);
  assert.ok(r.out.includes("problem agent provider circle-agent: disallowedTools is not a list; owner review needed in Paseo"), r.stdout);
  const r2 = await checkWith((p) => delete p["circle-agent"].env.ENABLE_TOOL_SEARCH);
  assert.ok(r2.out.includes("problem agent provider circle-agent env lacks or differs: ENABLE_TOOL_SEARCH=true; run kit.mjs machine apply"), r2.stdout);
  const r3 = await checkWith((p) => (p["circle-agent"].disallowedTools = null));
  assert.ok(r3.out.some((l) => /^problem agent provider circle-agent does not disallow Agent, AskUserQuestion/.test(l)), r3.stdout);
  const r4 = await checkWith((p) => delete p["circle-agent"]);
  assert.ok(r4.out.includes("problem agent provider circle-agent (copy of circle) is missing; run kit.mjs machine apply"), r4.stdout);
});

test("MACH-05 main provider policy: Agent and Workflow required, SendMessage never", async () => {
  const r = await checkWith((p) => (p.circle.disallowedTools = ["Agent"]));
  assert.equal(r.code, 2);
  assert.ok(r.out.includes("problem main provider circle lacks Workflow (main sessions orchestrate through Paseo, not native subagents); run kit.mjs machine apply"), r.stdout);
  const ok = "ok main provider circle: Agent, Workflow disallowed (orchestration goes through Paseo)";
  const r2 = await checkWith((p) => (p.circle.disallowedTools = ["Agent", "Workflow"]));
  assert.equal(r2.code, 0, r2.stdout);
  assert.ok(r2.out.includes(ok));
  const r3 = await checkWith((p) => (p.circle.disallowedTools = ["Agent", "Workflow", "SendMessage"]));
  assert.equal(r3.code, 0, r3.stdout);
  assert.ok(r3.out.includes(ok));
  assert.equal(r3.out.filter((l) => l.startsWith("problem")).length, 0);
  const r4 = await checkWith((p) => (p.circle.disallowedTools = 5));
  assert.ok(r4.out.includes("problem main provider circle: disallowedTools is not a list; owner review needed in Paseo"), r4.stdout);
});

test("MACH-06 the machine keys in the defaults", () => {
  const cfg = loadKitConfig();
  assert.deepEqual(cfg.agent_providers, { circle: "circle-agent" });
  assert.deepEqual(cfg.agent_provider_disallowed_tools, WORKER_DENIES);
  assert.deepEqual(cfg.agent_provider_env, { ENABLE_TOOL_SEARCH: "true" });
  assert.deepEqual(cfg.main_provider_disallowed_tools, ["Agent", "Workflow"]);
  assert.ok(cfg.agent_provider_disallowed_tools.includes("SendMessage"));
  assert.ok(!cfg.main_provider_disallowed_tools.includes("SendMessage"));
  assert.equal("agent_mcp" in cfg, false);
  const dir = makeTempDir();
  const file = path.join(dir, "harness.defaults.json");
  const shipped = JSON.parse(fs.readFileSync(path.join(KIT_DIR, "ship", ".agents", "harness.defaults.json"), "utf8"));
  fs.writeFileSync(file, JSON.stringify({ ...shipped, agent_providers: { circle: "circle" } }), "utf8");
  assert.throws(() => loadKitConfig({ defaultsFile: file }), /invalid harness config agent_providers\.circle: /);
});

test("MACH-17 the Claude CLI runs under the template's config dir; paths stay in the temp home", async () => {
  const m = makeMachine();
  assert.notEqual(m.env.CLAUDE_CONFIG_DIR, path.join(m.home, ".claude-circle"));
  await m.run(["check"]);
  await m.run(["apply", "--no-reload"], { PASEO_KIT_ANTHROPIC_BASE_URL: "https://e.test", PASEO_KIT_ANTHROPIC_AUTH_TOKEN: "t" });
  const calls = m.logOf("claude");
  assert.ok(calls.length >= 2);
  for (const c of calls) assert.equal(c.configDir, path.join(m.home, ".claude-circle"));
  const ctx = machineContext({ env: m.env, kitDir: m.kitDir });
  assert.equal(ctx.paseoConfig, m.config);
  // Guard: nothing machine resolves may sit under the real home (INST-29).
  const realHome = os.userInfo().homedir.toLowerCase();
  for (const p of [ctx.paseoConfig, ctx.linksRecord, ctx.home, ...calls.map((c) => c.configDir)]) {
    const lower = p.toLowerCase();
    assert.ok(lower.startsWith(os.tmpdir().toLowerCase()) || !lower.startsWith(realHome), p);
  }
});

test("MACH-17 without a template config dir: $CLAUDE_CONFIG_DIR is used", async () => {
  const tpl = JSON.parse(fs.readFileSync(path.join(KIT_DIR, "paseo", "providers.json"), "utf8"));
  for (const p of Object.values(tpl.providers)) delete p.env.CLAUDE_CONFIG_DIR;
  const m = makeMachine({ template: tpl });
  await m.run(["check"]);
  assert.equal(m.logOf("claude")[0].configDir, m.env.CLAUDE_CONFIG_DIR);
});

test("MACH-19 no mcp call across check, apply and export; no machine.local.json; no mcp/ folder", async () => {
  const m = await completeMachine();
  await m.run(["check"]);
  await m.run(["export"]);
  assert.ok(m.logOf("claude").length > 0);
  for (const c of [...m.logOf("claude"), ...m.logOf("paseo")]) assert.doesNotMatch(c.args.join(" "), /mcp/);
  assert.equal(fs.existsSync(path.join(m.kitDir, "machine.local.json")), false);
  assert.equal(fs.existsSync(path.join(KIT_DIR, "machine.local.json")), false);
  assert.equal(fs.existsSync(path.join(KIT_DIR, "mcp")), false);
});
