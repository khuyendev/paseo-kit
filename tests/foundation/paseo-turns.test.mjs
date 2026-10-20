import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { loadKitConfig } from "../../ship/.agents/harness/config.mjs";
import { CONTINUE_PROMPT, NO_OWNER_REPLY, pluginEnv } from "../../ship/.agents/harness/paseo-client/index.mjs";
import { FILE_PLUGIN_ID } from "../../ship/.agents/harness/platform.mjs";
import { createFakeClock } from "../fakes/fake-clock.mjs";
import { createFakeDaemon } from "../fakes/fake-daemon.mjs";
import { testEnv } from "../helpers/env.mjs";
import { connectFake } from "../helpers/run.mjs";
import { makeTempDir } from "../helpers/temp.mjs";

const CALLER = "caller00-0000-4000-8000-000000000001";
const SEL = { provider: "circle-agent", model: "m1" };

async function setup(responder) {
  const clock = createFakeClock();
  const fake = createFakeDaemon({ clock, responder });
  const session = await connectFake(fake, { env: testEnv({ PASEO_AGENT_ID: CALLER }), root: makeTempDir(), cfg: loadKitConfig(), clock });
  const agent = await session.createAgent({ sel: SEL, prompt: "go", title: "a", name: "a", swarm: "a" });
  return { fake, session, clock, agent };
}

const turnsBy = (...perTurn) => (agent, text, { turn }) => perTurn[Math.min(turn, perTurn.length) - 1];
const continues = (fake) => fake.callsOf("sendAgentMessage").filter((c) => c.args[1] === CONTINUE_PROMPT).length;
const pauses = (clock) => clock.sleeps.filter((ms) => ms >= 1000);

test("PCLI-11 usage counted once from creation: early event, duplicate turn id, late event", async () => {
  const early = await setup(() => [{ reply: "r", usage: { inputTokens: 3, cachedInputTokens: 2, outputTokens: 7, totalCostUsd: 0.5 } }]);
  await early.session.waitTurn(early.agent.id);
  assert.deepEqual(early.session.usage.get(early.agent.id), { turns: 1, input: 3, cachedInput: 2, output: 7, reportedCostUsd: 0.5 });
  early.fake.emit(early.agent.id, { type: "turn_completed", turnId: "dup", usage: { outputTokens: 1 } });
  early.fake.emit(early.agent.id, { type: "turn_completed", turnId: "dup", usage: { outputTokens: 1 } });
  assert.equal(early.session.usage.get(early.agent.id).output, 8);
  assert.equal(early.session.usage.get(early.agent.id).turns, 2);

  const late = await setup(() => [{ reply: "r", usage: { outputTokens: 4 }, lateUsage: true }]);
  await late.session.waitTurn(late.agent.id);
  assert.deepEqual(late.session.usage.get(late.agent.id), { turns: 1, input: 0, cachedInput: 0, output: 4, reportedCostUsd: null });
  late.fake.emitLate(late.agent.id);
  assert.equal(late.session.usage.get(late.agent.id).turns, 1);
  assert.equal(late.session.usage.get(late.agent.id).output, 4);
});

test("PCLI-11 a failed usage subscription archives the new agent", async () => {
  const clock = createFakeClock();
  const fake = createFakeDaemon({ clock });
  const session = await connectFake(fake, { env: testEnv({ PASEO_AGENT_ID: CALLER }), root: makeTempDir(), cfg: loadKitConfig(), clock });
  fake.failNext("observeTimeline", new Error("boom"));
  await assert.rejects(session.createAgent({ sel: SEL, prompt: "go", title: "a", name: "a", swarm: "a" }),
    /^Error: agent [0-9a-f-]{8} created but its usage tracking failed \(archived\): boom$/);
  assert.equal(fake.callsOf("archiveAgent").length, 1);
});

test("PCLI-12 waitTurn outcomes", async () => {
  const idle = await setup(() => [{ reply: "the answer" }]);
  const res = await idle.session.waitTurn(idle.agent.id);
  assert.equal(res.text, "the answer");
  assert.equal(res.agent.id, idle.agent.id);
  const empty = await setup(() => [{ reply: "" }]);
  await assert.rejects(empty.session.waitTurn(empty.agent.id), { message: "finished without a reply" });
  const hang = await setup(() => [{ hang: true }]);
  await assert.rejects(hang.session.waitTurn(hang.agent.id, { timeoutS: 5 }), { message: "no reply within 5 s" });
  const closed = await setup(() => [{ status: "closed" }]);
  await assert.rejects(closed.session.waitTurn(closed.agent.id), { message: "agent status closed" });
});

test("PCLI-13 provider-error replies continued 5 times with growing pauses, then agent error", async () => {
  const { fake, session, clock, agent } = await setup(() => [{ reply: "API Error: overloaded" }]);
  await assert.rejects(session.waitTurn(agent.id), { message: "agent error: API Error: overloaded" });
  assert.equal(continues(fake), 5);
  assert.deepEqual(pauses(clock), [30000, 60000, 120000, 240000, 300000]);
});

test("PCLI-13 quota errors are never continued; a rate-limit error then idle continues once", async () => {
  const quota = await setup(() => [{ error: "quota exceeded for this key" }]);
  await assert.rejects(quota.session.waitTurn(quota.agent.id), { message: "agent error: quota exceeded for this key" });
  assert.equal(continues(quota.fake), 0);
  const quotaReply = await setup(() => [{ reply: "API Error: credit balance too low" }]);
  await assert.rejects(quotaReply.session.waitTurn(quotaReply.agent.id), /agent error: API Error: credit balance/);
  assert.equal(continues(quotaReply.fake), 0);
  const rate = await setup(turnsBy([{ error: "rate limited" }], [{ reply: "done" }]));
  assert.equal((await rate.session.waitTurn(rate.agent.id)).text, "done");
  assert.equal(continues(rate.fake), 1);
  assert.deepEqual(pauses(rate.clock), [30000]);
  const multiLine = await setup(() => [{ reply: "The server returned 503 earlier.\nHere is the full result." }]);
  assert.match((await multiLine.session.waitTurn(multiLine.agent.id)).text, /full result/);
});

test("PCLI-14 AskUserQuestion denied up to 3 times; other permissions fail", async () => {
  const ask = { permission: { name: "AskUserQuestion" } };
  const two = await setup(() => [ask, ask, { reply: "fine" }]);
  assert.equal((await two.session.waitTurn(two.agent.id)).text, "fine");
  const denials = two.fake.callsOf("respondToPermission");
  assert.equal(denials.length, 2);
  for (const d of denials) assert.deepEqual(d.args[2], { behavior: "deny", message: NO_OWNER_REPLY });
  assert.ok(NO_OWNER_REPLY.startsWith("Nobody answers questions from subagents. Do not ask:"));
  const four = await setup(() => [ask, ask, ask, ask, { reply: "never" }]);
  await assert.rejects(four.session.waitTurn(four.agent.id), { message: "agent is waiting for a permission: AskUserQuestion" });
  assert.equal(four.fake.callsOf("respondToPermission").length, 3);
  const edit = await setup(() => [{ permission: { name: "Edit" } }]);
  await assert.rejects(edit.session.waitTurn(edit.agent.id), { message: "agent is waiting for a permission: Edit" });
  assert.equal(edit.fake.callsOf("respondToPermission").length, 0);
});

// PCLI-09 fixture: a project with the mod in one of three copy states and an owner selection, a worker config dir.
function pluginFixture({ copy, selection, registered, direct, workerConfigDir = false }) {
  const root = makeTempDir("paseo kit mod ");
  const plugin = path.join(root, ".claude", "plugins", "harness-files");
  fs.mkdirSync(path.join(plugin, ".claude-plugin"), { recursive: true });
  fs.mkdirSync(path.join(plugin, "hooks"), { recursive: true });
  if (copy !== "no-plugin-json") fs.writeFileSync(path.join(plugin, ".claude-plugin", "plugin.json"), "{}");
  if (copy !== "no-register") fs.writeFileSync(path.join(plugin, "hooks", "register.ts"), "");
  const env = testEnv(direct ? { CLAUDE_CODE_PLUGIN_DIRS: plugin } : {});
  let configDir = env.CLAUDE_CONFIG_DIR;
  if (workerConfigDir) {
    configDir = path.join(makeTempDir("paseo kit worker cfg "), "claude circle");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(env.PASEO_HOME, "config.json"), JSON.stringify({
      agents: { providers: { claudeish: { env: { CLAUDE_CONFIG_DIR: configDir } }, "circle-agent": { extends: "claudeish", env: { X: "1" } } } },
    }));
  }
  if (selection !== undefined) {
    fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(root, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { [FILE_PLUGIN_ID]: selection } }));
  }
  if (registered) {
    fs.mkdirSync(path.join(env.CLAUDE_CONFIG_DIR, "plugins"), { recursive: true });
    fs.writeFileSync(path.join(env.CLAUDE_CONFIG_DIR, "plugins", "installed_plugins.json"), JSON.stringify({ plugins: { [FILE_PLUGIN_ID]: [{ scope: "user" }] } }));
  }
  return { root, plugin, env, configDir };
}

const snapshotTree = (dir) => fs.readdirSync(dir, { recursive: true }).sort().map((rel) => {
  const abs = path.join(dir, rel);
  return fs.statSync(abs).isFile() ? `${rel}:${fs.readFileSync(abs, "utf8")}` : rel;
});

test("PCLI-09 mod directory only for a copied, selected, not natively loaded mod or a direct entry", () => {
  for (const copy of ["copied", "no-plugin-json", "no-register"]) {
    for (const selection of [undefined, false, true]) {
      for (const registered of [false, true]) {
        for (const direct of [false, true]) {
          const fx = pluginFixture({ copy, selection, registered, direct });
          const before = [snapshotTree(fx.root), snapshotTree(fx.env.HOME)];
          const env = pluginEnv(fx.root, "circle-agent", fx.env);
          const dirs = String(env.CLAUDE_CODE_PLUGIN_DIRS ?? "").split(path.delimiter).filter(Boolean);
          const expected = copy === "copied" && ((selection === true && !registered) || (selection !== false && direct));
          assert.equal(dirs.some((d) => d.toLowerCase() === fx.plugin.toLowerCase()), expected,
            JSON.stringify({ copy, selection, registered, direct }));
          assert.equal(new Set(dirs.map((d) => d.toLowerCase())).size, dirs.length, "duplicate plugin dir");
          assert.deepEqual([snapshotTree(fx.root), snapshotTree(fx.env.HOME)], before, "a settings file was written");
        }
      }
    }
  }
});

test("PCLI-09 settings come from the worker provider's config dir; worker env keys always set", async () => {
  const fx = pluginFixture({ copy: "copied", selection: undefined, registered: true, workerConfigDir: true });
  assert.deepEqual(pluginEnv(fx.root, "circle-agent", fx.env), {}, "no selection anywhere");
  fs.writeFileSync(path.join(fx.configDir, "settings.json"), JSON.stringify({ enabledPlugins: { [FILE_PLUGIN_ID]: true } }));
  assert.ok(pluginEnv(fx.root, "circle-agent", fx.env).CLAUDE_CODE_PLUGIN_DIRS,
    "the selection is read from the worker's config dir and the process dir's registration does not count");
  const clock = createFakeClock();
  const fake = createFakeDaemon({ clock });
  const session = await connectFake(fake, { env: { ...fx.env, PASEO_AGENT_ID: CALLER }, root: fx.root, cfg: loadKitConfig(), clock });
  await session.createAgent({ sel: SEL, prompt: "go", title: "a", name: "a", swarm: "a" });
  const env = fake.callsOf("createAgent")[0].args[0].env;
  assert.equal(env.PASEO_HARNESS_LEADER, CALLER);
  assert.equal(env.PASEO_HARNESS_ROOT, fx.root);
  assert.equal(env.PASEO_HARNESS_ROLE, "worker");
  assert.equal(env.CLAUDE_CODE_PLUGIN_DIRS, fx.plugin);
});
