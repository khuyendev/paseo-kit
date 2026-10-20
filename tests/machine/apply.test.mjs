import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { KIT_DIR } from "../helpers/temp.mjs";
import { completeMachine, ENDPOINT, makeMachine, SECRETS, SHIPPED_TEMPLATE, snapshot, TOKEN } from "./helpers.mjs";

const template = () => JSON.parse(fs.readFileSync(SHIPPED_TEMPLATE, "utf8"));
const shippedIds = (name) => template().providers[name].models.map((m) => m.id);
const writeLive = (m, live) => fs.writeFileSync(m.config, `${JSON.stringify(live, null, 2)}\n`, "utf8");

test("MACH-07 a Claude Code below the minimum fails before any write, backup or link", async () => {
  const m = makeMachine();
  const before = snapshot([m.config, path.join(m.home, ".claude-circle"), path.join(m.home, ".paseo-kit")]);
  const r = await m.run(["apply", "--link-user-skills"], { ...SECRETS, FAKE_CLAUDE_VERSION: "2.1.295" });
  assert.equal(r.code, 1);
  assert.match(r.err[0], /^failed: Claude Code 2\.1\.295 \(unavailable or too old\); the harness-files mod needs >= 2\.1\.296$/);
  assert.deepEqual(snapshot([m.config, path.join(m.home, ".claude-circle"), path.join(m.home, ".paseo-kit")]), before);
  assert.deepEqual(m.backups(), []);
  assert.deepEqual(m.logOf("paseo"), []);
});

test("MACH-07 an unresolvable secret or a non-array worker disallowedTools fails with nothing written", async () => {
  const m = makeMachine();
  const before = m.configBytes();
  const r = await m.run(["apply", "--link-user-skills"]);
  assert.equal(r.code, 1);
  assert.equal(r.err[0], "failed: no value for the secret ANTHROPIC_BASE_URL: set the environment variable PASEO_KIT_ANTHROPIC_BASE_URL");
  assert.deepEqual(m.configBytes(), before);
  assert.deepEqual(m.backups(), []);
  assert.equal(fs.existsSync(path.join(m.home, ".claude-circle")), false);

  const c = await completeMachine();
  const live = c.readConfig();
  live.agents.providers["circle-agent"].disallowedTools = "x";
  live.agents.providers.circle.models.pop();
  writeLive(c, live);
  const bytes = c.configBytes();
  const backups = c.backups();
  const r2 = await c.run(["apply"]);
  assert.equal(r2.code, 1);
  assert.match(r2.err[0], /^failed: Paseo provider circle-agent: disallowedTools is not a list/);
  assert.deepEqual(c.configBytes(), bytes);
  assert.deepEqual(c.backups(), backups);
});

test("MACH-08 an empty config gets both providers with the template models; a second apply writes nothing", async () => {
  const m = makeMachine();
  const r = await m.run(["apply", "--no-reload"], SECRETS);
  assert.equal(r.code, 0, r.stdout);
  assert.ok(r.out.includes("paseo: added provider circle"));
  assert.ok(r.out.includes("paseo: added provider circle-agent"));
  const p = m.readConfig().agents.providers;
  assert.deepEqual(p.circle.models.map((x) => x.id), shippedIds("circle"));
  assert.deepEqual(p["circle-agent"].models.map((x) => x.id), shippedIds("circle-agent"));
  assert.equal(p.circle.env.ANTHROPIC_AUTH_TOKEN, TOKEN);
  assert.equal(p.circle.env.CLAUDE_CONFIG_DIR, path.join(m.home, ".claude-circle"));
  assert.equal("_notes" in m.readConfig(), false);
  const bytes = m.configBytes();
  const mtime = fs.statSync(m.config).mtimeMs;
  const r2 = await m.run(["apply"], SECRETS);
  assert.equal(r2.code, 0, r2.stdout);
  assert.equal(r2.out[0], "paseo: every template provider, model and policy entry is present");
  assert.deepEqual(m.configBytes(), bytes);
  assert.equal(fs.statSync(m.config).mtimeMs, mtime);
  assert.deepEqual(m.logOf("paseo"), []);
});

test("MACH-08 existing models, fields, owner providers and metadataGeneration stay; only missing ids are appended", async () => {
  const m = await completeMachine();
  const live = m.readConfig();
  const circle = live.agents.providers.circle;
  circle.models = circle.models.filter((x) => x.id !== "claude-haiku-4-5");
  circle.models[0].label = "Owner label";
  circle.models.push({ id: "custom-model", label: "Custom" });
  circle.env.ANTHROPIC_AUTH_TOKEN = "owner-token";
  live.agents.providers.owner = { extends: "claude", label: "Owner provider", models: [{ id: "x" }] };
  live.agents.metadataGeneration = { providers: [{ provider: "owner", model: "x" }] };
  writeLive(m, live);
  const r = await m.run(["apply", "--no-reload"]);
  assert.equal(r.code, 0, r.stdout);
  assert.ok(r.out.includes("paseo: added to circle: claude-haiku-4-5"), r.stdout);
  const after = m.readConfig();
  assert.deepEqual(after.agents.providers.owner, live.agents.providers.owner);
  assert.deepEqual(after.agents.metadataGeneration, live.agents.metadataGeneration);
  const want = structuredClone(circle);
  want.models.push(template().providers.circle.models.find((x) => x.id === "claude-haiku-4-5"));
  assert.deepEqual(after.agents.providers.circle, want);
});

test("MACH-08 a missing worker is a deep copy of the live main", async () => {
  const m = await completeMachine();
  const live = m.readConfig();
  delete live.agents.providers["circle-agent"];
  live.agents.providers.circle.env.OWNER_SETTING = "kept";
  writeLive(m, live);
  const r = await m.run(["apply", "--no-reload"]);
  assert.equal(r.code, 0, r.stdout);
  assert.ok(r.out.includes("paseo: added provider circle-agent (copy of circle)"));
  const w = m.readConfig().agents.providers["circle-agent"];
  assert.equal(w.label, `${live.agents.providers.circle.label} (harness agents)`);
  assert.equal(w.description, "Copy of circle for harness agents, made by kit.mjs machine apply");
  assert.equal(w.env.OWNER_SETTING, "kept");
  assert.equal(w.env.ENABLE_TOOL_SEARCH, "true");
});

test("MACH-09 union-only policy: an owner deny survives; the clone inherits OwnerOnMain, not KitMainOnly", async () => {
  const defaults = (d) => ({ ...d, main_provider_disallowed_tools: ["Agent", "Workflow", "KitMainOnly"] });
  const m = await completeMachine();
  const live = m.readConfig();
  delete live.agents.providers["circle-agent"];
  live.agents.providers.circle.disallowedTools = ["OwnerOnMain", "Agent"];
  const k = makeMachine({ live, defaults });
  const r = await k.run(["apply", "--no-reload"]);
  assert.equal(r.code, 0, r.stdout);
  const p = k.readConfig().agents.providers;
  assert.ok(p["circle-agent"].disallowedTools.includes("OwnerOnMain"));
  assert.ok(!p["circle-agent"].disallowedTools.includes("KitMainOnly"));
  assert.deepEqual(p.circle.disallowedTools, ["OwnerOnMain", "Agent", "Workflow", "KitMainOnly"]);
  const bytes = k.configBytes();
  const mtime = fs.statSync(k.config).mtimeMs;
  assert.equal((await k.run(["apply", "--no-reload"])).code, 0);
  assert.deepEqual(k.configBytes(), bytes);
  assert.equal(fs.statSync(k.config).mtimeMs, mtime);
});

test("MACH-09 worker denies are added in order after owner rules, duplicates dropped; kit env values win", async () => {
  const m = await completeMachine();
  const live = m.readConfig();
  const w = live.agents.providers["circle-agent"];
  w.disallowedTools = ["Bash(rm *)", "Agent", "Agent", "SendMessage"];
  w.env.ENABLE_TOOL_SEARCH = "false";
  w.env.OWNER = "1";
  writeLive(m, live);
  const r = await m.run(["apply", "--no-reload"]);
  assert.equal(r.code, 0, r.stdout);
  assert.ok(r.out.includes("paseo: circle-agent env sets ENABLE_TOOL_SEARCH=true"), r.stdout);
  const after = m.readConfig().agents.providers["circle-agent"];
  assert.deepEqual(after.disallowedTools.slice(0, 3), ["Bash(rm *)", "Agent", "SendMessage"]);
  assert.equal(after.disallowedTools.length, 19);
  assert.deepEqual([after.env.ENABLE_TOOL_SEARCH, after.env.OWNER], ["true", "1"]);
});

test("MACH-10 a PASEO_KIT_ token is used; a peer on the same endpoint lends its token, another endpoint never", async () => {
  const peer = (url) => ({ agents: { providers: { other: { extends: "codex", env: { ANTHROPIC_BASE_URL: url, ANTHROPIC_AUTH_TOKEN: "peer-token" } } } } });
  const a = makeMachine({ live: peer(ENDPOINT) });
  assert.equal((await a.run(["apply", "--no-reload"], { PASEO_KIT_ANTHROPIC_BASE_URL: ENDPOINT })).code, 0);
  assert.equal(a.readConfig().agents.providers.circle.env.ANTHROPIC_AUTH_TOKEN, "peer-token");
  const b = makeMachine({ live: peer("https://elsewhere.example.test") });
  const before = b.configBytes();
  const r = await b.run(["apply", "--no-reload"], { PASEO_KIT_ANTHROPIC_BASE_URL: ENDPOINT });
  assert.equal(r.code, 1);
  assert.equal(r.err[0], "failed: no value for the secret ANTHROPIC_AUTH_TOKEN: set the environment variable PASEO_KIT_ANTHROPIC_AUTH_TOKEN");
  assert.deepEqual(b.configBytes(), before);
  const c = makeMachine({ live: peer(ENDPOINT) });
  assert.equal((await c.run(["apply", "--no-reload"], { ...SECRETS, PASEO_KIT_ANTHROPIC_AUTH_TOKEN: "kit-token" })).code, 0);
  assert.equal(c.readConfig().agents.providers.circle.env.ANTHROPIC_AUTH_TOKEN, "kit-token");
  const d = makeMachine();
  assert.equal((await d.run(["apply", "--no-reload"], { ANTHROPIC_BASE_URL: ENDPOINT, ANTHROPIC_AUTH_TOKEN: "env-token" })).code, 0);
  assert.equal(d.readConfig().agents.providers["circle-agent"].env.ANTHROPIC_AUTH_TOKEN, "env-token");
});

test("MACH-11 changing applies back up first with distinct names; a no-change apply makes no backup", async () => {
  const m = await completeMachine();
  const first = m.backups();
  assert.equal(first.length, 1);
  const live = m.readConfig();
  live.agents.providers.circle.models.pop();
  writeLive(m, live);
  const original = m.configBytes();
  const r = await m.run(["apply", "--no-reload"]);
  assert.equal(r.code, 0, r.stdout);
  const backups = m.backups();
  assert.equal(backups.length, 2);
  const added = backups.find((b) => !first.includes(b));
  assert.match(added, /^config\.json\.bak-\d{8}-\d{6}-kit(-\d+)?$/);
  assert.deepEqual(fs.readFileSync(path.join(path.dirname(m.config), added)), original);
  assert.ok(r.out.includes(`paseo: backup ${path.join(path.dirname(m.config), added)}`));
  assert.ok(m.configBytes().toString("utf8").endsWith("}\n"));
  const mtime = fs.statSync(m.config).mtimeMs;
  await m.run(["apply", "--no-reload"]);
  assert.equal(m.backups().length, 2);
  assert.equal(fs.statSync(m.config).mtimeMs, mtime);
});

test("MACH-11 a failed rename leaves the Paseo config byte-identical", async (t) => {
  const m = makeMachine();
  const before = m.configBytes();
  const rename = fs.renameSync;
  t.after(() => (fs.renameSync = rename));
  fs.renameSync = (from, to) => {
    if (path.resolve(String(to)) === path.resolve(m.config)) throw Object.assign(new Error("injected rename failure"), { code: "EIO" });
    return rename(from, to);
  };
  await assert.rejects(m.run(["apply", "--no-reload"], SECRETS), /injected rename failure/);
  fs.renameSync = rename;
  assert.deepEqual(m.configBytes(), before);
  assert.deepEqual(fs.readdirSync(path.dirname(m.config)).filter((f) => f.endsWith(".tmp")), []);
});

test("MACH-12 reload after a write; a failing reload exits 2 with the hint and the check; never restart", async () => {
  const m = makeMachine();
  const r = await m.run(["apply"], { ...SECRETS, FAKE_PASEO_EXIT: "1" });
  assert.equal(r.code, 2, r.stdout);
  assert.ok(m.readConfig().agents.providers.circle);
  assert.ok(r.out.includes("paseo reload failed (exit 1: daemon unreachable); run it yourself: paseo reload"), r.stdout);
  const at = r.out.indexOf("--- check");
  assert.ok(at > 0);
  assert.match(r.out[at + 1], /^ok node /);
  const ok = makeMachine();
  const r2 = await ok.run(["apply"], SECRETS);
  assert.equal(r2.code, 0, r2.stdout);
  assert.ok(r2.out.includes("paseo: configuration reloaded (paseo reload; no daemon restart)"));
  for (const machine of [m, ok]) assert.deepEqual(machine.logOf("paseo").map((c) => c.args), [["reload"]]);
  for (const c of [...m.logOf("paseo"), ...ok.logOf("paseo")]) assert.doesNotMatch(c.args.join(" "), /restart|start|stop/);
});

test("MACH-12 --no-reload makes no Paseo call; a patch failure exits 1 with nothing written", async () => {
  const m = makeMachine();
  const r = await m.run(["apply", "--no-reload"], SECRETS);
  assert.equal(r.code, 0, r.stdout);
  assert.deepEqual(m.logOf("paseo"), []);
  const tpl = template();
  tpl.providers.circle.models.push({ id: "x" });
  const p = makeMachine({ template: tpl, defaults: (d) => ({ ...d, agent_providers: { circle: "circle-agent", spare: "spare-agent" } }) });
  const before = p.configBytes();
  const r2 = await p.run(["apply"], SECRETS);
  assert.equal(r2.code, 1);
  assert.deepEqual(p.configBytes(), before);
  assert.deepEqual(p.logOf("paseo"), []);
  assert.match(r2.err[0], /^failed: cannot add the worker provider spare-agent/);
});

test("MACH-15 without the flag pluginsEnabled and plugins stay; with it the kit entries are added, the user entry kept", async () => {
  const plugins = { "planning-panel": "planning-panel", "swarm-map": "swarm-map" };
  const base = await completeMachine();
  const live = base.readConfig();
  live.pluginsEnabled = false;
  live.plugins = { "user-plugin": { source: "directory", path: "/owner/plugin", enabled: true } };
  const m = makeMachine({ live, plugins });
  fs.mkdirSync(path.join(m.kitDir, "plugins", "swarm-map", "node_modules"), { recursive: true });
  const r = await m.run(["apply", "--no-reload"]);
  assert.equal(r.code, 0, r.stdout);
  assert.deepEqual([m.readConfig().pluginsEnabled, m.readConfig().plugins], [false, live.plugins]);
  assert.deepEqual(m.logOf("npm"), []);
  const r2 = await m.run(["apply", "--no-reload", "--enable-paseo-plugins"]);
  assert.equal(r2.code, 0, r2.stdout);
  const after = m.readConfig();
  assert.equal(after.pluginsEnabled, true);
  assert.deepEqual(after.plugins["user-plugin"], live.plugins["user-plugin"]);
  assert.deepEqual(after.plugins["planning-panel"], { source: "directory", path: path.join(m.kitDir, "plugins", "planning-panel"), enabled: true });
  assert.deepEqual(after.plugins["swarm-map"], { source: "directory", path: path.join(m.kitDir, "plugins", "swarm-map"), enabled: true });
  assert.deepEqual(m.logOf("npm").map((c) => [c.args, c.cwd]), [[["ci"], path.join(m.kitDir, "plugins", "planning-panel")]]);
  assert.ok(r2.out.includes("paseo: to load it now: paseo plugin reload planning-panel"));
  assert.ok(r2.out.includes("ok Paseo plugin swarm-map runs from the kit"), r2.stdout);
});

test("MACH-15 a user entry with the kit plugin id pointing elsewhere is kept and reported as a conflict", async () => {
  const base = await completeMachine();
  const live = base.readConfig();
  live.plugins = { "swarm-map": { source: "directory", path: "/owner/swarm", enabled: true } };
  const m = makeMachine({ live, plugins: { "planning-panel": "planning-panel", "swarm-map": "swarm-map" } });
  const r = await m.run(["apply", "--no-reload", "--enable-paseo-plugins"]);
  assert.equal(r.code, 2, r.stdout);
  assert.ok(r.out.includes("conflict Paseo plugin swarm-map: user entry kept"));
  assert.deepEqual(m.readConfig().plugins["swarm-map"], live.plugins["swarm-map"]);
  assert.ok(r.out.some((l) => /^problem Paseo plugin swarm-map runs from \/owner\/swarm \(user entry\), not from the kit$/.test(l)), r.stdout);
  assert.equal(fs.existsSync(path.join(KIT_DIR, "plugins", "backlog-plugin")), false);
});

test("MACH-18 apply changes only the kit providers, the plugin keys under the flag and an absent metadataGeneration", async () => {
  const base = await completeMachine();
  const live = base.readConfig();
  delete live.agents.metadataGeneration;
  live.agents.skills = { selection: { mode: "custom", names: ["a"] } };
  live.agents.tools = { selection: ["Bash"] };
  live.browser = { selection: "chrome" };
  live.agents.providers.owner = { extends: "claude", models: [] };
  live.daemon = { listen: "127.0.0.1:1" };
  live.agents.providers.circle.models.pop();
  live.agents.providers["circle-agent"].disallowedTools.pop();
  const m = makeMachine({ live });
  assert.equal((await m.run(["apply", "--no-reload"])).code, 0);
  const after = m.readConfig();
  const strip = (cfg) => {
    const c = structuredClone(cfg);
    delete c.agents.providers.circle;
    delete c.agents.providers["circle-agent"];
    delete c.agents.metadataGeneration;
    return c;
  };
  assert.deepEqual(strip(after), strip(live));
  assert.deepEqual(after.agents.metadataGeneration, template().metadataGeneration);
});

test("MACH-18 template entries outside agent_providers are never created, given models or checked (CR-MAC-02)", async () => {
  const base = await completeMachine();
  const live = base.readConfig();
  live.agents.providers.owner = { extends: "claude", models: [{ id: "owner-model" }] };
  const tpl = template();
  tpl.providers.owner = { extends: "claude", models: [{ id: "template-model" }] };
  tpl.providers.unmapped = { extends: "claude", models: [{ id: "x" }] };
  const m = makeMachine({ live, template: tpl });
  const r = await m.run(["apply", "--no-reload"]);
  assert.equal(r.code, 0, r.stdout);
  const after = m.readConfig();
  assert.deepEqual(after.agents.providers.owner, live.agents.providers.owner);
  assert.equal("unmapped" in after.agents.providers, false);
  assert.equal(r.out.some((l) => /provider (owner|unmapped)|to (owner|unmapped)|template-model/.test(l)), false, r.stdout);
});
