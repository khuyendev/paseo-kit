import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { loadKitConfig } from "../../ship/.agents/harness/config.mjs";
import {
  PARENT_LABEL, READ_ONLY_DENIED_TOOLS, TESTED_PASEO_CLI, clampThinking, connect, daemonTarget, findCliDir,
} from "../../ship/.agents/harness/paseo-client/index.mjs";
import { createFakeClock } from "../fakes/fake-clock.mjs";
import { createFakeDaemon } from "../fakes/fake-daemon.mjs";
import { testEnv } from "../helpers/env.mjs";
import { connectFake } from "../helpers/run.mjs";
import { KIT_DIR, makeTempDir, SHIP_DIR } from "../helpers/temp.mjs";

const CALLER = "caller00-0000-4000-8000-000000000001";
const SEL = { provider: "circle-agent", model: "m1", thinking: "high" };

async function setup({ responder, models, capabilities, cfg, env = {}, root = makeTempDir() } = {}) {
  const clock = createFakeClock();
  const fake = createFakeDaemon({ clock, responder, models, capabilities });
  const session = await connectFake(fake, { env: testEnv({ PASEO_AGENT_ID: CALLER, ...env }), root, cfg: cfg ?? loadKitConfig(), clock });
  return { fake, session, clock, root };
}

const spec = (extra = {}) => ({ sel: SEL, prompt: "do it", title: "worker-a", name: "worker-a", swarm: "worker", ...extra });

function sourceFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(abs, out);
    else if (/\.(mjs|js|cjs|ts|tsx)$/.test(entry.name)) out.push(abs);
  }
  return out;
}

test("PCLI-01 only paseo-client imports @getpaseo; plugins use only the plugin SDK", () => {
  const clientDir = path.join(SHIP_DIR, ".agents", "harness", "paseo-client");
  const shipOffenders = sourceFiles(SHIP_DIR)
    .filter((f) => !f.startsWith(clientDir + path.sep))
    .filter((f) => /@getpaseo\/|connectToDaemon|dist[\\/]utils[\\/]client\.js/.test(fs.readFileSync(f, "utf8")));
  assert.deepEqual(shipOffenders, []);
  const pluginOffenders = sourceFiles(path.join(KIT_DIR, "plugins"))
    .filter((f) => /@getpaseo\/(cli|server)\b/.test(fs.readFileSync(f, "utf8")));
  assert.deepEqual(pluginOffenders, []);
});

test("PCLI-01 the session works against an injected client with no network", async () => {
  const { fake, session } = await setup();
  const agent = await session.createAgent(spec());
  const turn = await session.waitTurn(agent.id);
  assert.equal(turn.text, "ok");
  await session.archive(agent.id);
  await session.close();
  assert.deepEqual(fake.calls.map((c) => c.method).filter((m) => m !== "waitForFinish" && m !== "fetchAgent"),
    ["listProviderModels", "createAgent", "observeTimeline", "archiveAgent", "close"]);
});

test("PCLI-02 Paseo CLI location", () => {
  const empty = makeTempDir();
  const base = { PATH: empty, APPDATA: empty };
  assert.throws(() => findCliDir({ ...base, PASEO_CLI_DIR: empty }),
    { message: "the npm-installed Paseo CLI was not found (npm i -g @getpaseo/cli, or set PASEO_CLI_DIR)" });
  const bin = path.join(makeTempDir("paseo kit bin "), "npm dir");
  fs.mkdirSync(path.join(bin, "node_modules", "@getpaseo", "cli", "dist", "utils"), { recursive: true });
  fs.writeFileSync(path.join(bin, "paseo.cmd"), "@echo off\n");
  fs.writeFileSync(path.join(bin, "node_modules", "@getpaseo", "cli", "dist", "utils", "client.js"), "");
  assert.equal(findCliDir({ ...base, PATH: [empty, bin].join(path.delimiter) }), path.join(bin, "node_modules", "@getpaseo", "cli"));
  const prefix = makeTempDir("paseo kit prefix ");
  fs.mkdirSync(path.join(prefix, "bin"));
  fs.writeFileSync(path.join(prefix, "bin", "paseo"), "");
  fs.mkdirSync(path.join(prefix, "lib", "node_modules", "@getpaseo", "cli", "dist", "utils"), { recursive: true });
  fs.writeFileSync(path.join(prefix, "lib", "node_modules", "@getpaseo", "cli", "dist", "utils", "client.js"), "");
  assert.equal(findCliDir({ ...base, PATH: path.join(prefix, "bin") }), path.join(prefix, "lib", "node_modules", "@getpaseo", "cli"));
  assert.equal(findCliDir({ ...base, PASEO_CLI_DIR: path.join(bin, "node_modules", "@getpaseo", "cli") }), path.join(bin, "node_modules", "@getpaseo", "cli"));
});

test("PCLI-03 daemon address from PASEO_HOST, else daemon.listen; paseo.pid never read", () => {
  const env = testEnv();
  assert.deepEqual(daemonTarget({ ...env, PASEO_HOST: "h:1" }), { kind: "endpoint", host: "h:1" });
  fs.writeFileSync(path.join(env.PASEO_HOME, "config.json"), "﻿" + JSON.stringify({ daemon: { listen: "127.0.0.1:6767" } }));
  fs.writeFileSync(path.join(env.PASEO_HOME, "paseo.pid"), "99999");
  const opened = [];
  const originalRead = fs.readFileSync;
  const originalOpen = fs.openSync;
  fs.readFileSync = (file, ...rest) => (opened.push(String(file)), originalRead(file, ...rest));
  fs.openSync = (file, ...rest) => (opened.push(String(file)), originalOpen(file, ...rest));
  try {
    assert.deepEqual(daemonTarget(env), { kind: "endpoint", host: "127.0.0.1:6767" });
  } finally {
    fs.readFileSync = originalRead;
    fs.openSync = originalOpen;
  }
  assert.ok(opened.some((f) => f.endsWith("config.json")));
  assert.ok(!opened.some((f) => f.endsWith("paseo.pid")));
  fs.writeFileSync(path.join(env.PASEO_HOME, "config.json"), "{}");
  assert.throws(() => daemonTarget(env), /no daemon address: set PASEO_HOST or daemon.listen in /);
});

test("PCLI-04 the tested CLI version is one constant; the session records the loaded version", async () => {
  const literal = TESTED_PASEO_CLI.replace(/\./g, "\\.");
  const holders = sourceFiles(SHIP_DIR).filter((f) => new RegExp(`["'\`]${literal}["'\`]`).test(fs.readFileSync(f, "utf8")));
  assert.deepEqual(holders.map((f) => path.basename(f)), ["index.mjs"]);
  const clock = createFakeClock();
  const fake = createFakeDaemon({ clock, version: "0.12.0" });
  const session = await connectFake(fake, { env: testEnv(), root: makeTempDir(), cfg: loadKitConfig(), clock });
  assert.equal(session.version, "0.12.0");
  assert.notEqual(session.version, TESTED_PASEO_CLI);
});

test("PCLI-05 outbound size is checked in bytes before any daemon call", async () => {
  const { fake, session } = await setup();
  const big = "x".repeat(300 * 1024);
  await assert.rejects(session.createAgent(spec({ prompt: big })),
    { message: `prompt is ${big.length} bytes > max_prompt_bytes 262144; pass a file path instead of inlining content` });
  const target = fake.addAgent({ parent: CALLER });
  const before = fake.calls.length;
  await assert.rejects(session.sendPrompt(target.id, big), /max_prompt_bytes 262144/);
  assert.equal(fake.calls.length, before);
  assert.equal(fake.calls.length, 0);
  const small = await setup({ cfg: { ...loadKitConfig(), max_prompt_bytes: 10 } });
  await assert.rejects(small.session.createAgent(spec({ prompt: "é".repeat(7) })), { message: /^prompt is 14 bytes > max_prompt_bytes 10;/ });
  assert.equal(small.fake.calls.length, 0);
});

test("PCLI-06 agent creation requires the caller", async () => {
  const { fake, session } = await setup({ env: { PASEO_AGENT_ID: undefined } });
  await assert.rejects(session.createAgent(spec()),
    { message: "PASEO_AGENT_ID is not set: run ph from an agent inside Paseo, so every agent is created as its subagent" });
  assert.equal(fake.calls.length, 0);
});

test("PCLI-07 createAgent payload keys, features only when set, never mcpServers", async () => {
  const { fake, session, root } = await setup({ models: { "circle-agent": [{ id: "m1", thinkingOptions: [{ id: "low" }, { id: "high" }] }] } });
  await session.createAgent(spec({ sel: { ...SEL, features: { fast_mode: true } } }));
  await session.createAgent(spec({ name: "b", title: "b" }));
  const [withFeatures, without] = fake.callsOf("createAgent").map((c) => c.args[0]);
  assert.deepEqual(Object.keys(withFeatures).sort(),
    ["callerAgentId", "cwd", "env", "featureValues", "initialPrompt", "labels", "modeId", "model", "provider", "thinkingOptionId", "title"]);
  assert.deepEqual(withFeatures.featureValues, { fast_mode: true });
  assert.ok(!("featureValues" in without) && !("mcpServers" in without) && !("mcpServers" in withFeatures));
  assert.equal(withFeatures.modeId, "bypassPermissions");
  assert.equal(withFeatures.callerAgentId, CALLER);
  assert.equal(withFeatures.cwd, root);
  assert.equal(withFeatures.thinkingOptionId, "high");
  const order = fake.calls.slice(0, 3).map((c) => c.method);
  assert.deepEqual(order, ["listProviderModels", "createAgent", "observeTimeline"]);
});

test("PCLI-07 read-only agents get the six denies only when the daemon supports them", async () => {
  const on = await setup({ capabilities: { agentDisallowedTools: true } });
  await on.session.createAgent(spec({ readOnly: true }));
  assert.deepEqual(on.fake.callsOf("createAgent")[0].args[0].disallowedTools, [...READ_ONLY_DENIED_TOOLS]);
  const off = await setup();
  await off.session.createAgent(spec({ readOnly: true }));
  assert.ok(!("disallowedTools" in off.fake.callsOf("createAgent")[0].args[0]));
});

test("PCLI-08 labels and title: parent label last, workflow titles cut to 60", async () => {
  const { fake, session } = await setup();
  const label = `${"w".repeat(10)}:${"l".repeat(80)}`;
  await session.createAgent(spec({ title: label, name: label, swarm: "wfname", run: "wf_1", labels: { [PARENT_LABEL]: "x", extra: "1" } }));
  const sent = fake.callsOf("createAgent")[0].args[0];
  assert.equal(sent.labels[PARENT_LABEL], CALLER);
  assert.equal(sent.labels["ph.swarm"], "wfname");
  assert.equal(sent.labels["harness.run"], "wf_1");
  assert.equal(sent.labels["harness.name"], label);
  assert.equal(sent.labels.extra, "1");
  assert.equal(Object.keys(sent.labels).at(-1), PARENT_LABEL);
  assert.equal(sent.title.length, 60);
});

test("PCLI-10 thinking clamp", async () => {
  assert.equal(clampThinking("xhigh", ["high"]), "high");
  assert.equal(clampThinking("low", ["off", "medium", "high"]), "medium");
  assert.equal(clampThinking("medium", ["low", "high"]), "high");
  assert.equal(clampThinking("medium", ["none"]), undefined);
  assert.equal(clampThinking("off", ["off", "low"]), "off");
  assert.equal(clampThinking(undefined, ["low"]), undefined);
  assert.equal(clampThinking("bogus", ["low"]), undefined);
  assert.equal(clampThinking("high", []), undefined);
  const { fake, session } = await setup({ models: { "circle-agent": new Error("catalogue down") } });
  await session.createAgent(spec());
  assert.ok(!("thinkingOptionId" in fake.callsOf("createAgent")[0].args[0]));
});

test("PCLI-15 target resolution restricted to own pools", async () => {
  const LEADER = "leader00-0000-4000-8000-000000000002";
  const { fake, session } = await setup({ env: { PASEO_HARNESS_LEADER: LEADER } });
  const a = fake.addAgent({ id: "abcdef12-0000-4000-8000-000000000010", title: "rev", parent: CALLER });
  fake.addAgent({ id: "abcdef99-0000-4000-8000-000000000011", title: "dup", parent: CALLER });
  fake.addAgent({ id: "ffffff00-0000-4000-8000-000000000012", title: "dup", parent: CALLER });
  const sibling = fake.addAgent({ id: "12345678-0000-4000-8000-000000000013", title: "sib", parent: LEADER });
  const archived = fake.addAgent({ id: "99999999-0000-4000-8000-000000000014", title: "old", parent: CALLER, archivedAt: "2026-10-01T00:00:00Z" });
  const foreign = fake.addAgent({ id: "88888888-0000-4000-8000-000000000015", title: "far", parent: "someone-else" });
  await assert.rejects(session.resolveTargets(["abcde"]), { message: "no live subagent named or id 'abcde'" });
  await assert.rejects(session.resolveTargets(["abcdef"]), { message: "'abcdef' matches 2 agents; use the id" });
  assert.equal((await session.resolveTargets(["abcdef1"]))[0].id, a.id);
  assert.equal((await session.resolveTargets(["rev"]))[0].id, a.id);
  await assert.rejects(session.resolveTargets(["dup"]), { message: "'dup' matches 2 agents; use the id" });
  assert.equal((await session.resolveTargets(["sib"]))[0].id, sibling.id);
  await assert.rejects(session.resolveTargets([archived.id]), { message: `no live subagent named or id '${archived.id}'` });
  await assert.rejects(session.resolveTargets([foreign.id]), { message: `no live subagent named or id '${foreign.id}'` });
  await assert.rejects(session.resolveTargets([]), { message: "name at least one agent (title, id or unique id prefix)" });
});

test("PCLI-16 resumed session agents: model readback, refusal, forgotten agent", async () => {
  const { fake, session } = await setup();
  const agent = fake.addAgent({ parent: CALLER, model: "old", provider: "circle-agent" });
  await session.resumeSend(agent.id, { sel: { provider: "circle-agent", model: "new" }, prompt: "next" });
  const methods = fake.calls.map((c) => c.method).filter((m) => m !== "fetchAgent");
  assert.deepEqual(methods.slice(0, 2), ["setAgentModel", "sendAgentMessage"]);
  const setAt = fake.calls.findIndex((c) => c.method === "setAgentModel");
  assert.equal(fake.calls[setAt + 1].method, "fetchAgent");
  const stale = fake.addAgent({ parent: CALLER, model: "old" });
  fake.ignoreModelUpdates = true;
  await assert.rejects(session.resumeSend(stale.id, { sel: { provider: "circle-agent", model: "new" }, prompt: "x" }), { message: "model readback new != old" });
  fake.ignoreModelUpdates = false;
  const busy = fake.addAgent({ parent: CALLER, status: "running" });
  await assert.rejects(session.resumeSend(busy.id, { sel: SEL, prompt: "x" }), /has an active turn/);
  const other = fake.addAgent({ parent: CALLER, provider: "codex" });
  await assert.rejects(session.resumeSend(other.id, { sel: SEL, prompt: "x" }), /runs on codex, not circle-agent/);
  const creates = fake.callsOf("createAgent").length;
  const res = await session.resumeSend("gone0000-0000-4000-8000-000000000099", { sel: SEL, prompt: "short", create: spec({ prompt: "[Your role (planner), complete below:\n\nrole text]\n\n---\n\nshort" }) });
  assert.equal(res.created, true);
  assert.match(res.warning, /is no longer known to the daemon; started .* fresh with the full prompt/);
  assert.equal(fake.callsOf("createAgent").length, creates + 1);
  assert.match(fake.callsOf("createAgent").at(-1).args[0].initialPrompt, /Your role \(planner\)/);
});
