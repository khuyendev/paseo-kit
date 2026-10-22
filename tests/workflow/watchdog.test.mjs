import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../../ship/.agents/harness/config.mjs";
import { createWatchdog, modelMs } from "../../ship/.agents/harness/workflow/watchdog.mjs";
import { toolKind } from "../../ship/.agents/harness/workflow/tools.mjs";
import { createFakeClock } from "../fakes/fake-clock.mjs";
import { connectFake } from "../helpers/run.mjs";
import { CALLER, meta, setup, tick } from "./helpers.mjs";

const S = 1000;

// The mechanism tests count reads against fixed small thresholds, independent of the shipped defaults (raised
// 2026-10-22 to 6 rereads and 40 reads without a write).
const TEST_THRESHOLDS = { watchdog_same_file_reads: 3, watchdog_reads_without_write: 15 };

async function rig(overlay = {}) {
  const clock = createFakeClock({ auto: false });
  const s = setup({ clock, overlay: { ...TEST_THRESHOLDS, ...overlay } });
  const session = await connectFake(s.fake, { env: s.env, root: s.project.root, clock });
  const agent = s.fake.addAgent({ parent: CALLER, status: "running" });
  await session.observe([agent.id]);
  const out = [];
  const cfg = loadConfig(s.project.root);
  const hub = createWatchdog({ session, cfg, clock, out: (l) => out.push(l), root: s.project.root });
  const st = hub.arm(agent.id, "lbl");
  let seq = 0;
  const call = (name, detail, status = "running", callId = `c${++seq}`) => {
    s.fake.emitToolCall(agent.id, { type: "tool_call", callId, name, status, detail });
    return callId;
  };
  const complete = (name, detail) => {
    const id = call(name, detail);
    call(name, detail, "completed", id);
  };
  const at = async (ms) => {
    await clock.advance(ms - (clock.now() - t0));
    hub.tick(clock.now());
    await tick();
  };
  const t0 = clock.now();
  const sends = () => s.fake.callsOf("sendAgentMessage").map((c) => c.args[1]);
  return { s, clock, session, agent, out, hub, st, call, complete, at, t0, sends, cfg };
}

test("FLOW-29 two overlapping 60 s tool calls in a 100 s window leave 40 s of model time", () => {
  const st = { promptAt: 0, toolSpans: [[20 * S, 80 * S], [20 * S, 80 * S]], calls: new Map() };
  assert.equal(modelMs(st, 100 * S), 40 * S);
  const st2 = { promptAt: 0, toolSpans: [[10 * S, 70 * S]], calls: new Map([["x", { inputAt: 30 * S }]]) };
  assert.equal(modelMs(st2, 90 * S), 10 * S);
  const st3 = { promptAt: 50 * S, toolSpans: [[10 * S, 70 * S]], calls: new Map() };
  assert.equal(modelMs(st3, 100 * S), 30 * S, "spans are clipped to the prompt");
});

test("FLOW-29 the ticker runs while agents are armed and is cleared after the last disarm", async () => {
  const r = await rig();
  assert.equal(r.clock.pending(), 1);
  r.st.disarm();
  assert.equal(r.clock.pending(), 0);
  r.hub.close();
});

test("FLOW-30 the recorded incident: Write path at 0 s, content at 104 s, done at 104.2 s -> no interrupt", async () => {
  const r = await rig();
  r.call("Write", { type: "write", filePath: "a.md" }, "running", "w");
  await r.at(104 * S);
  r.call("Write", { type: "write", filePath: "a.md", content: "x".repeat(15000) }, "running", "w");
  await r.at(104.2 * S);
  r.call("Write", { type: "write", filePath: "a.md", content: "x" }, "completed", "w");
  await r.at(400 * S);
  assert.equal(r.s.fake.callsOf("cancelAgent").length, 0);
});

test("FLOW-30 a Write with path only is model time; with content the file limit applies", async () => {
  const r = await rig({ agent_nudge_s: 0, agent_stop_s: 0 });
  r.call("Write", { type: "write", filePath: "a.md" }, "running", "w");
  await r.at(400 * S);
  assert.equal(r.s.fake.callsOf("cancelAgent").length, 0);
  assert.ok(modelMs(r.st, r.clock.now()) >= 399 * S);
  r.call("Write", { type: "write", filePath: "a.md", content: "x" }, "running", "w");
  await r.at(400 * S + 181 * S);
  assert.equal(r.s.fake.callsOf("cancelAgent").length, 1);
});

test("FLOW-31 completed then running for one id: no open call, no stuck interrupt at +900 s", async () => {
  const r = await rig({ agent_nudge_s: 0, agent_stop_s: 0 });
  r.call("Read", { type: "read", filePath: "a" }, "completed", "x");
  r.call("Read", { type: "read", filePath: "a" }, "running", "x");
  assert.equal(r.st.calls.size, 0);
  await r.at(900 * S);
  assert.equal(r.s.fake.callsOf("cancelAgent").length, 0);
  // Timeline items without a callId are ignored.
  r.s.fake.emitToolCall(r.agent.id, { type: "tool_call", name: "Read", status: "running", detail: { type: "read", filePath: "b" } });
  assert.equal(r.st.calls.size, 0);
});

test("FLOW-32 tool kinds by exact name", () => {
  for (const n of ["Write", "Edit", "MultiEdit", "NotebookEdit", "mcp__harness-files__write_multiple_files", "mcp__harness-files__edit_multiple_files"]) assert.equal(toolKind(n, {}), "write", n);
  for (const n of ["Read", "Grep", "Glob", "mcp__harness-files__read_ranges"]) assert.equal(toolKind(n, {}), "read", n);
  assert.equal(toolKind("Bash", { command: "ls" }), "shell");
  assert.equal(toolKind("PowerShell", { command: "dir" }), "shell");
  assert.equal(toolKind("Bash", { command: 'node -e "a=>a"' }), "shell");
  assert.equal(toolKind("Bash", { command: "make 2>&1" }), "shell");
  assert.equal(toolKind("Bash", { command: "build > build.log" }), "write");
  assert.equal(toolKind("Bash", { command: "echo x >> f" }), "write");
  assert.equal(toolKind("PowerShell", { command: "Set-Content a.txt x" }), "write");
  assert.equal(toolKind("mcp__fsbatch__read_ranges", {}), "other");
  assert.equal(toolKind("mcp__filesystem__read_file", {}), "other");
});

test("FLOW-33 three identical Grep inputs -> exactly one loop message", async () => {
  const r = await rig();
  for (let i = 0; i < 4; i++) r.complete("Grep", { type: "unknown", input: { pattern: "x" } });
  await tick();
  assert.equal(r.sends().filter((t) => t.includes("That is a loop")).length, 1);
  assert.ok(r.out.some((l) => /^log watchdog: lbl \S{8} loop: \{"tool":"Grep","count":3\}$/.test(l)));
});

test("FLOW-33 Read a, Write b, Read a, Read a -> no reread; three read_ranges of one path -> one reread", async () => {
  const r = await rig();
  const read = { type: "read", filePath: `${r.s.project.root}\\a.txt` };
  r.complete("Read", read);
  r.complete("Write", { type: "write", filePath: "b", content: "x" });
  r.complete("Read", read);
  r.complete("Read", { type: "read", filePath: "A.TXT" });
  await tick();
  assert.equal(r.sends().length, 0);
  const r2 = await rig();
  for (let i = 0; i < 3; i++) r2.complete("mcp__harness-files__read_ranges", { type: "unknown", input: { ranges: [{ path: "src/x.js", from: i + 1, to: i + 2 }] } });
  await tick();
  assert.deepEqual(r2.sends().filter((t) => t.includes("you read src/x.js 3 times")).length, 1);
});

test("FLOW-33 15 reads without a write -> one piecemeal", async () => {
  const r = await rig();
  for (let i = 0; i < 16; i++) r.complete("Grep", { type: "unknown", input: { pattern: `p${i}` } });
  await tick();
  assert.equal(r.sends().filter((t) => t.includes("reads or searches without writing anything")).length, 1);
});

test("FLOW-34 nudge 10 / stop 20: one nudge at +11 s, archive and stop reason at +21 s; nudge 0 sends none", async () => {
  const r = await rig({ agent_nudge_s: 10, agent_stop_s: 20 });
  await r.at(11 * S);
  await r.at(12 * S);
  assert.equal(r.sends().filter((t) => t.startsWith("Harness watchdog: you have used")).length, 1);
  assert.ok(r.out.some((l) => l.endsWith("nudged to finish")));
  await r.at(21 * S);
  await r.at(31 * S);
  assert.equal(r.s.fake.callsOf("archiveAgent").length, 1);
  assert.equal(r.st.stopReason, "watchdog stopped the agent after 20 s");
  const q = await rig({ agent_nudge_s: 0, agent_stop_s: 0 });
  await q.at(5000 * S);
  assert.equal(q.sends().length, 0);
});

test("FLOW-35 stuck tools: file tool interrupted at 181 s, second hang stops with the real reason; Bash 400 s untouched", async () => {
  const r = await rig({ agent_nudge_s: 0, agent_stop_s: 0 });
  r.call("Write", { type: "write", filePath: "a", content: "x" });
  await r.at(181 * S);
  await r.st.retry;
  assert.equal(r.s.fake.callsOf("cancelAgent").length, 1);
  assert.equal(r.sends().filter((t) => t.startsWith("Harness watchdog: your Write call did not return")).length, 1);
  r.call("mcp__harness-files__read_ranges", { type: "unknown", input: { ranges: [{ path: "a" }] } });
  await r.at(400 * S);
  assert.equal(r.st.stopReason, "watchdog stopped the agent: second hung mcp__harness-files__read_ranges call");
  assert.ok(r.out.some((l) => / one mcp__harness-files__read_ranges call ran \d+ min without returning, stopped$/.test(l)));
  const b = await rig({ agent_nudge_s: 0, agent_stop_s: 0 });
  b.complete("Read", { type: "read", filePath: "x" });
  b.complete("Read", { type: "read", filePath: "x" });
  b.call("Bash", { type: "shell", command: "build > build.log" }, "running", "sh");
  await b.at(400 * S);
  b.call("Bash", { type: "shell", command: "build > build.log" }, "completed", "sh");
  b.complete("Read", { type: "read", filePath: "x" });
  await tick();
  assert.equal(b.s.fake.callsOf("cancelAgent").length, 0);
  assert.equal(b.sends().length, 0, "the shell write reset the read counters");
});

test("FLOW-36 a 2000-char path with max_prompt_bytes 1000: failure logged, nothing sent, no throw", async () => {
  const r = await rig({ max_prompt_bytes: 1000 });
  const long = `${"d/".repeat(1000)}f.txt`;
  for (let i = 0; i < 3; i++) r.complete("Read", { type: "read", filePath: long });
  await tick();
  await tick();
  assert.equal(r.sends().filter((t) => t.includes(long)).length, 0);
  assert.ok(r.out.some((l) => /^log watchdog: message to \S{8} failed: prompt is \d+ bytes > max_prompt_bytes 1000/.test(l)));
});

test("FLOW-37 after a reset a reread fires again; a second hang after a reset still stops", async () => {
  const r = await rig({ agent_nudge_s: 0, agent_stop_s: 0 });
  for (let i = 0; i < 3; i++) r.complete("Read", { type: "read", filePath: "a" });
  r.st.reset();
  for (let i = 0; i < 3; i++) r.complete("Read", { type: "read", filePath: "a" });
  await tick();
  assert.equal(r.sends().filter((t) => t.includes("you read a 3 times")).length, 2);
  r.call("Read", { type: "read", filePath: "b" });
  await r.at(200 * S);
  r.st.reset();
  r.call("Read", { type: "read", filePath: "c" });
  await r.at(400 * S);
  assert.match(r.st.stopReason, /second hung Read call/);
});

test("FLOW-38 watchdog_enabled false arms nothing: no watchdog line and no cancel over 2000 s", async () => {
  const r = await rig({ watchdog_enabled: false });
  assert.equal(r.st, null);
  r.call("Write", { type: "write", filePath: "a", content: "x" });
  await r.clock.advance(2000 * S);
  assert.equal(r.out.length, 0);
  assert.equal(r.s.fake.callsOf("cancelAgent").length, 0);
});

test("FLOW-38 the watchdog reads its limits from the M3 config", async () => {
  const r = await rig({ agent_file_tool_stuck_s: 50 });
  r.call("Read", { type: "read", filePath: "x" });
  await r.at(51 * S);
  assert.equal(r.s.fake.callsOf("cancelAgent").length, 1);
});

test("FLOW-39 spawned teammates are never watched: no message or cancel for an agent the runner did not arm", async () => {
  const r = await rig({ agent_nudge_s: 1, agent_stop_s: 2, agent_tool_stuck_s: 1, agent_file_tool_stuck_s: 1 });
  const mate = r.s.fake.addAgent({ parent: CALLER, status: "running" });
  await r.session.observe([mate.id]);
  r.s.fake.emitToolCall(mate.id, { type: "tool_call", callId: "m", name: "Write", status: "running", detail: { type: "write", filePath: "a", content: "x" } });
  r.st.disarm();
  await r.at(5000 * S);
  assert.equal(r.s.fake.callsOf("cancelAgent").length + r.s.fake.callsOf("sendAgentMessage").length + r.s.fake.callsOf("archiveAgent").length, 0);
  // Only the workflow runner arms the watchdog: the ph runtime never imports it.
  const { readFileSync, readdirSync } = await import("node:fs");
  const dir = new URL("../../ship/.agents/harness/runtime/", import.meta.url);
  for (const f of readdirSync(dir)) assert.ok(!readFileSync(new URL(f, dir), "utf8").includes("workflow/watchdog"), f);
});

test("FLOW-38 a workflow run with the watchdog off logs no watchdog line", async () => {
  const s = setup({ overlay: { watchdog_enabled: false, agent_nudge_s: 1, agent_stop_s: 2 } });
  s.project.write("wf.js", `${meta()}return await agent("x");`);
  const r = await s.ph(["workflow", "--script", "wf.js"]);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(!r.out.some((l) => l.startsWith("log watchdog")));
});

test("FLOW-29 FLOW-35 an interrupted long shell call stays tool time: no stop of the retry turn", async () => {
  const r = await rig({ agent_nudge_s: 0, agent_stop_s: 1800, agent_tool_stuck_s: 900 });
  await r.at(950 * S);
  r.call("Bash", { type: "shell", command: "sleep 9999" }, "running", "sh");
  await r.at(1850 * S);
  await r.st.retry;
  assert.equal(r.s.fake.callsOf("cancelAgent").length, 1);
  await r.at(1860 * S);
  assert.equal(r.st.stopReason, null);
  assert.equal(r.s.fake.callsOf("archiveAgent").length, 0);
  assert.equal(modelMs(r.st, r.clock.now()), 960 * S);
  // A late terminal event of the interrupted call neither reopens nor double-counts it.
  r.call("Bash", { type: "shell", command: "sleep 9999" }, "completed", "sh");
  assert.equal(r.st.calls.size, 0);
  assert.equal(modelMs(r.st, r.clock.now()), 960 * S);
  r.hub.close();
});
