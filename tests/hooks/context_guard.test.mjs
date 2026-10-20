import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { claimBand, contextBand, isMainSession, lastUsage, readHead, runContextGuard } from "../../ship/.claude/hooks/context_guard.mjs";
import { loadConfig, loadKitConfig } from "../../ship/.agents/harness/config.mjs";
import { makeTempDir, SHIP_DIR } from "../helpers/temp.mjs";
import { contextOf, hookEnv, hookProject, runHookAsync, runHookSync, T, writeTranscript } from "./helpers.mjs";

const CFG = loadKitConfig().context_guard;
const MAIN_ENV = {};

// In-process guard with kit defaults and a private state dir.
function guard({ stateDir = makeTempDir("cg state "), loadConfig: loader = async () => loadKitConfig(), env = MAIN_ENV } = {}) {
  const dir = makeTempDir("cg transcript ");
  return {
    stateDir,
    async at(entries, input = {}) {
      const transcript_path = writeTranscript(dir, Array.isArray(entries) ? entries : [entries]);
      const res = await runContextGuard({ session_id: "s1", transcript_path, ...input }, { env, stateDir, loadConfig: loader });
      return res?.output?.hookSpecificOutput?.additionalContext ?? "";
    },
  };
}

test("HOOK-06 main session by role identity, not by agent_type or model", async () => {
  const cases = [
    [{}, {}, true],
    [{ agent_type: "planner" }, {}, true],
    [{ agent_id: "a" }, {}, false],
    [{ agentId: "a" }, {}, false],
    [{ parent_agent_id: "a" }, {}, false],
    [{}, { PASEO_HARNESS_LEADER: "lead" }, false],
    [{}, { PASEO_HARNESS_ROLE: "worker" }, false],
  ];
  for (const [input, env, main] of cases) assert.equal(isMainSession(input, env), main, JSON.stringify([input, env]));
  const g = guard();
  assert.match(await g.at(T.usage(600000, { model: "unknown-model-xyz" })), /60%/);
});

test("HOOK-07 usage from the newest main assistant line; sidechain, child and synthetic skipped", () => {
  const lines = (entries) => entries.map((e) => JSON.stringify(e)).join("\n");
  assert.deepEqual(lastUsage(lines([T.usage(600000), T.usage(950000, { sidechain: true })])), { used: 600000, window: null });
  assert.equal(lastUsage(lines([T.usage(600000), T.usage(950000, { agentId: "c" })])).used, 600000);
  assert.equal(lastUsage(lines([T.usage(600000), T.usage(950000, { model: "<synthetic>" })])).used, 600000);
  const u = T.usage(100);
  u.message.usage = { input_tokens: 100, cache_read_input_tokens: 50, cache_creation_input_tokens: 25, context_window: 200000 };
  assert.deepEqual(lastUsage(lines([u])), { used: 175, window: 200000 });
  const bad = T.usage(1);
  bad.message.usage.input_tokens = -5;
  assert.equal(lastUsage(lines([T.usage(42), bad])).used, 42);
  assert.equal(lastUsage(lines([{ type: "user", message: { content: "hi" } }])), null);
});

test("HOOK-08 band computation over the reported or configured window", () => {
  assert.equal(contextBand(599999, CFG).band, -1);
  assert.equal(contextBand(600000, CFG).band, 0);
  assert.equal(contextBand(650000, CFG).band, 1);
  assert.equal(contextBand(120000, CFG, 200000).band, 0);
  assert.throws(() => contextBand(1, { ...CFG, step_pct: 0 }), /context_guard needs a positive window and step, and start_pct between 0 and 100/);
  assert.throws(() => contextBand(1, { ...CFG, start_pct: 0 }), /start_pct between 0 and 100/);
});

test("HOOK-09 one reminder per band; any downward move re-arms", async () => {
  const g = guard();
  assert.match(await g.at(T.usage(650000)), /65%/);
  assert.equal(await g.at(T.usage(650000)), "");
  assert.equal(await g.at(T.usage(610000)), "");
  assert.match(await g.at(T.usage(650000)), /65%/);
  assert.equal(await g.at(T.usage(1000)), "");
  assert.match(await g.at(T.usage(600000)), /60%/);
  assert.equal(await g.at(T.usage(600000)), "");
});

test("HOOK-09 a planted claim with a bad pid does not silence the next band", async () => {
  const g = guard();
  assert.match(await g.at(T.usage(600000)), /60%/);
  const [dir] = fs.readdirSync(g.stateDir).filter((n) => n.startsWith("ph-context-guard-"));
  fs.writeFileSync(path.join(g.stateDir, `${dir}.json.claim`), '{"pid":"x"}');
  fs.writeFileSync(path.join(g.stateDir, dir, "state.json.claim"), '{"pid":"x"}');
  assert.match(await g.at(T.usage(650000)), /65%/);
});

test("HOOK-09 a crash after the decision loses that one reminder; the next downward move re-arms", () => {
  const dir = makeTempDir("cg chain ");
  claimBand(dir, 0); // decided and committed, then the process died before its output
  assert.deepEqual([-1, 0, -1, 0].map((band) => claimBand(dir, band)), [false, true, false, true]);
});

test("HOOK-09 a reset racing a climb cannot overwrite the climb and silence the next one", () => {
  const dir = makeTempDir("cg race ");
  assert.equal(claimBand(dir, 1), true);
  const stale = readHead(dir); // reset A reads {band 1} and pauses
  assert.equal(claimBand(dir, 0), false); // reset B
  assert.equal(claimBand(dir, 1), true); // climb C reminds
  assert.equal(claimBand(dir, 0, stale), false); // A resumes from its stale read
  assert.equal(readHead(dir).band, 0);
  assert.equal(claimBand(dir, 1), true);
  assert.equal(claimBand(dir, 1), false);
});

test("HOOK-09 six concurrent hook processes at band 0 give exactly one reminder", async () => {
  const project = hookProject();
  const transcript_path = writeTranscript(project.root, [T.usage(600000)]);
  const env = hookEnv(project.root);
  const input = { session_id: "concurrent", transcript_path, hook_event_name: "PostToolUse" };
  const runs = await Promise.all(Array.from({ length: 6 }, () => runHookAsync(project.root, "context_guard.mjs", input, { env })));
  assert.ok(runs.every((r) => r.code === 0));
  assert.equal(runs.filter((r) => r.stdout.trim()).length, 1, JSON.stringify(runs));
});

test("HOOK-09 state older than 24 h is pruned", async () => {
  const g = guard();
  const old = path.join(g.stateDir, "ph-context-guard-oldsession");
  fs.mkdirSync(old);
  const past = new Date(Date.now() - 25 * 3600 * 1000);
  fs.utimesSync(old, past, past);
  await g.at(T.usage(600000));
  assert.equal(fs.existsSync(old), false);
});

test("HOOK-10 reminder text points to ph compact-self with used/window", async () => {
  const text = await guard().at(T.usage(650000));
  assert.match(text, /65%/);
  assert.match(text, /650000\/1000000/);
  assert.ok(text.includes('node .agents/harness/ph.mjs compact-self --focus "<what to keep>"'));
  assert.match(text, /threshold 60%/);
  assert.match(text, /next 5% step/);
  assert.ok(fs.existsSync(path.join(SHIP_DIR, ".agents", "harness", "ph.mjs")));
  assert.match(await guard().at(T.usage(120000, { window: 200000 })), /120000\/200000/);
  const res = await runContextGuard(
    { session_id: "u", transcript_path: writeTranscript(makeTempDir(), [T.usage(600000)]), hook_event_name: "UserPromptSubmit" },
    { env: {}, stateDir: makeTempDir(), loadConfig: async () => loadKitConfig() },
  );
  assert.equal(res.output.hookSpecificOutput.hookEventName, "UserPromptSubmit");
});

test("HOOK-11 context_guard overlay merges per field and validates its keys", () => {
  const project = hookProject({ overlay: { context_guard: { start_pct: 45 } } });
  assert.deepEqual(loadConfig(project.root).context_guard, { window_tokens: 1000000, start_pct: 45, step_pct: 5 });
  for (const [overlay, key] of [
    [{ start_pct: 0 }, "context_guard.start_pct"],
    [{ start_pct: 101 }, "context_guard.start_pct"],
    [{ model_pattern: "x" }, "context_guard.model_pattern"],
  ]) {
    project.writeJson(".agents/harness.config.json", { context_guard: overlay });
    assert.throws(() => loadConfig(project.root), (e) => e.message.includes(key));
  }
});

test("HOOK-11 a project overlay start_pct is honoured by the hook process", () => {
  const project = hookProject({ overlay: { context_guard: { start_pct: 45 } } });
  const transcript_path = writeTranscript(project.root, [T.usage(460000)]);
  const r = runHookSync(project.root, "context_guard.mjs", { session_id: "o", transcript_path });
  assert.match(contextOf(r.stdout), /threshold 45%/);
});

test("HOOK-12 non-main sessions read neither config nor transcript", async () => {
  let reads = 0;
  const spy = { loadConfig: async () => (reads++, loadKitConfig()), readTail: () => (reads++, "") };
  const input = { session_id: "w", transcript_path: "C:/nowhere/t.jsonl" };
  assert.equal(await runContextGuard(input, { env: { PASEO_HARNESS_ROLE: "worker" }, stateDir: makeTempDir(), ...spy }), null);
  assert.equal(await runContextGuard({ ...input, agent_id: "c" }, { env: {}, stateDir: makeTempDir(), ...spy }), null);
  assert.equal(reads, 0);
});

test("HOOK-04 hooks find the config from CLAUDE_PROJECT_DIR in a moved project and an unrelated cwd", () => {
  const project = hookProject({ overlay: { context_guard: { start_pct: 45 } } });
  const moved = path.join(makeTempDir("moved "), "proj with space");
  fs.cpSync(project.root, moved, { recursive: true });
  const transcript_path = writeTranscript(moved, [T.usage(460000)]);
  const cwd = makeTempDir("unrelated ");
  const r = runHookSync(moved, "context_guard.mjs", { session_id: "m", transcript_path }, { cwd, env: hookEnv(moved) });
  assert.equal(r.code, 0);
  assert.match(contextOf(r.stdout), /threshold 45%/);
  const io = runHookSync(moved, "io_guard.mjs", { session_id: "m", transcript_path, tool_name: "Grep", tool_input: {} }, { cwd, env: hookEnv(moved) });
  assert.equal(io.code, 0);
  assert.match(contextOf(io.stdout), /first file lookup/);
});

test("HOOK-04 a .claude/harness.config.json overlay is ignored", () => {
  const project = hookProject({ files: { ".claude/harness.config.json": JSON.stringify({ context_guard: { start_pct: 10 } }) } });
  const transcript_path = writeTranscript(project.root, [T.usage(200000)]);
  const r = runHookSync(project.root, "context_guard.mjs", { session_id: "c", transcript_path });
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "");
});
