import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { assertErrLine, assertExit, assertLastLine, assertLine, assertNoLine } from "../helpers/assert.mjs";
import { runPhProcess } from "../helpers/run.mjs";
import { makeTempProject } from "../helpers/temp.mjs";
import { CALLER, addSub, setup } from "./setup.mjs";

test("PHCL-01 help lists the runtime commands and hides the compact watcher", async () => {
  const p = makeTempProject({ git: false, runtime: true });
  const r = runPhProcess(p.root, []);
  assertExit(r, 0);
  for (const name of ["doctor", "spawn", "fanout", "send", "watch", "result", "team", "context", "compact-self", "stop", "archive", "task", "freeze", "worktrees"]) {
    assertLine(r, new RegExp(`^  ${name} `));
  }
  assertNoLine(r, /compact-run/);
  assertExit(runPhProcess(p.root, ["bogus"]), 1);
});

test("PHCL-02 options: a string option takes a value starting with --; unknown and missing values are usage errors", async () => {
  const s = setup();
  const a = addSub(s.fake, { title: "a" });
  assertExit(await s.ph(["send", "--prompt", "--x", "a"]), 0);
  assert.equal(s.fake.callsOf("sendAgentMessage")[0].args[1], "--x");
  assert.equal(s.fake.callsOf("sendAgentMessage")[0].args[0], a.id);
  assertErrLine(await s.ph(["team", "--bogus"]), "usage error: unknown option --bogus");
  assertErrLine(await s.ph(["spawn", "--name"]), "usage error: --name needs a value");
});

test("PHCL-11 send waits for a running turn, --now cancels first, oversize is refused before connecting", async () => {
  const s = setup();
  const a = addSub(s.fake, { title: "busy", status: "running" });
  const pending = s.ph(["send", "--prompt", "next", "busy"]);
  setTimeout(() => s.fake.finish(a.id, [{ reply: "done" }]), 5);
  const r = await pending;
  assertExit(r, 0);
  assertLine(r, "sent busy");
  assertLastLine(r, /^next: wait with Monitor running `.* watch busy`/);
  const methods = s.fake.calls.map((c) => c.method);
  assert.ok(methods.indexOf("waitForFinish") < methods.indexOf("sendAgentMessage"));
  const b = addSub(s.fake, { title: "busy2", status: "running" });
  assertExit(await s.ph(["send", "--now", "--prompt", "stop that", "busy2"]), 0);
  const m2 = s.fake.calls.map((c) => `${c.method}:${c.args[0]}`);
  assert.ok(m2.indexOf(`cancelAgent:${b.id}`) < m2.indexOf(`sendAgentMessage:${b.id}`));
  const before = s.fake.calls.length;
  const big = await s.ph(["send", "--prompt", "x".repeat(262145), "busy"]);
  assertExit(big, 1);
  assertErrLine(big, /^failed: prompt is 262145 bytes > max_prompt_bytes 262144/);
  assert.equal(s.fake.calls.length, before);
});

test("PHCL-12 watch prints one idle line per agent and a summary, without a usage tracker", async () => {
  const s = setup();
  const now = Date.UTC(2026, 9, 20);
  const iso = (ms) => new Date(ms).toISOString();
  addSub(s.fake, { title: "w1", lastUsage: { outputTokens: 7, contextWindowUsedTokens: 900 }, lastUserMessageAt: iso(now - 12000), updatedAt: iso(now) });
  addSub(s.fake, { title: "w2" });
  const r = await s.ph(["watch", "w1", "w2"]);
  assertExit(r, 0);
  assertLine(r, /^idle w1 [0-9a-f]{8} out_tokens=7 context_tokens=900 duration_s=12$/);
  assertLine(r, /^idle w2 [0-9a-f]{8} out_tokens=\? context_tokens=\? duration_s=\?$/);
  assertLastLine(r, "watch done: 2 idle, 0 failed");
  assert.equal(s.fake.callsOf("observeTimeline").length, 0);
  const e = addSub(s.fake, { title: "err", status: "error", lastError: "boom" });
  const f = await s.ph(["watch", e.id]);
  assertExit(f, 2);
  assertLine(f, /^failed err [0-9a-f]{8}: error: boom$/);
});

test("PHCL-13 result: text, several headers, --json keys; tokens only when tracked from creation", async () => {
  const s = setup();
  const a = addSub(s.fake, { title: "r1", lastUsage: { outputTokens: 3, totalCostUsd: 0.5 } });
  addSub(s.fake, { title: "r2" });
  s.fake.emitToolCall(a.id, { type: "tool_call", name: "Skill", input: { skill: "gsd-plan" } });
  const one = await s.ph(["result", "r1"]);
  assertExit(one, 0);
  const many = await s.ph(["result", "r1", "r2"]);
  assertLine(many, "## r1");
  assertLine(many, "## r2");
  const j = await s.ph(["result", "--json", "r1"]);
  const obj = JSON.parse(j.out[0]);
  assert.deepEqual(Object.keys(obj), ["id", "name", "status", "model", "final", "usage", "tokens", "costUsd", "reportedCostUsd", "durationS", "lastTurnS", "skills", "skillsWarning"]);
  assert.equal(obj.tokens, null);
  assert.equal(obj.costUsd, null);
  assert.equal(obj.reportedCostUsd, 0.5);
  assert.deepEqual(obj.skills, ["gsd-plan"]);
  assert.equal(obj.model, "circle-agent/m");
});

test("PHCL-15 team lists live subagents in column order, or says there are none", async () => {
  const s = setup();
  assertLine(await s.ph(["team"]), "no live subagents");
  const a = addSub(s.fake, { title: "t1", status: "running", lastUsage: { contextWindowUsedTokens: 250, contextWindowMaxTokens: 1000 } });
  addSub(s.fake, { title: "t2" });
  const r = await s.ph(["team"]);
  assertExit(r, 0);
  assertLine(r, `${a.id.slice(0, 8)} running 25% circle-agent/m t1`);
  assertLine(r, /^[0-9a-f]{8} idle \?% circle-agent\/m t2$/);
  assert.equal(r.out.length, 2);
});

test("PHCL-16 context: sorted use, ROTATE from context_guard.start_pct, overlay and --rotate-pct", async () => {
  const s = setup();
  const use = (n) => ({ lastUsage: { contextWindowUsedTokens: n, contextWindowMaxTokens: 100 } });
  addSub(s.fake, { title: "p59", ...use(59) });
  addSub(s.fake, { title: "p61", ...use(61) });
  addSub(s.fake, { title: "p60", ...use(60) });
  addSub(s.fake, { title: "unknown" });
  const r = await s.ph(["context"]);
  assertExit(r, 0);
  assert.deepEqual(r.out.map((l) => l.split(" ").filter(Boolean).slice(-2).join(" ")), ["p61 ROTATE", "p60 ROTATE", "idle p59", "idle unknown"]);
  assertLine(r, /^[0-9a-f]{8}   61% 61\/100 idle p61  ROTATE$/);
  assertLine(r, /^[0-9a-f]{8}   n\/a \?\/\? idle unknown$/);
  assertLine(await s.ph(["context", "--rotate-pct", "61"]), /p61  ROTATE$/);
  assertExit(await s.ph(["context", "--rotate-pct", "abc"]), 1);
  assertExit(await s.ph(["context", "--rotate-pct", "150"]), 1);
  const o = setup({ overlay: { context_guard: { window_tokens: 1000000, start_pct: 45, step_pct: 5 } } });
  addSub(o.fake, { title: "half", ...use(50) });
  assertLine(await o.ph(["context"]), /half  ROTATE$/);
  o.fake.agents.get(CALLER).lastUsage = { contextWindowUsedTokens: 10, contextWindowMaxTokens: 100 };
  assertLine(await o.ph(["context", "--self"]), /^c0ffee00   10% 10\/100 idle leader$/);
  assertLine(await setup().ph(["context"]), "no live subagents");
});

test("PHCL-19 stop cancels the running turn", async () => {
  const s = setup();
  const a = addSub(s.fake, { title: "busy", status: "running" });
  const r = await s.ph(["stop", "busy"]);
  assertExit(r, 0);
  assertLine(r, "stopped busy");
  assert.deepEqual(s.fake.callsOf("cancelAgent").map((c) => c.args[0]), [a.id]);
  s.fake.failNext("cancelAgent", new Error("nope"));
  const f = await s.ph(["stop", "busy"]);
  assertExit(f, 2);
  assertLine(f, "failed stop busy: nope");
});

test("PHCL-20 archive by --idle, --name-prefix and names; nothing selected is a usage error", async () => {
  const s = setup();
  addSub(s.fake, { title: "rev-1" });
  addSub(s.fake, { title: "rev-2", status: "running" });
  addSub(s.fake, { title: "other" });
  assertErrLine(await s.ph(["archive"]), "usage error: name agents, or use --idle / --name-prefix");
  const r = await s.ph(["archive", "--idle", "--name-prefix", "rev"]);
  assertExit(r, 0);
  assertLine(r, "archived 1 of 1 agents");
  const n = await s.ph(["archive", "other"]);
  assertLine(n, "archived 1 of 1 agents");
  assertLine(await s.ph(["archive", "--name-prefix", "zzz"]), "archived 0 of 0 agents");
});

test("PHCL-20 archive --run: missing run, live runner killed, labelled agents archived, status rewritten", async () => {
  const s = setup();
  const missing = await s.ph(["archive", "--run", "wf_20261020-101010_abcd"]);
  assertExit(missing, 1);
  assertErrLine(missing, /^failed: no run wf_20261020-101010_abcd \(/);
  const runner = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore", windowsHide: true });
  try {
    const id = "wf_20261020-101010_abcd";
    s.project.writeJson(`alt runs/${id}/run.json`, { runId: id, status: "running", pid: runner.pid, adopted: [] });
    addSub(s.fake, { title: "w:a", labels: { "harness.run": id } });
    addSub(s.fake, { title: "w:b", labels: { "harness.run": id } });
    addSub(s.fake, { title: "unrelated" });
    const r = await s.ph(["archive", "--run", id, "--runs-dir", "alt runs"]);
    assertExit(r, 0);
    assertLine(r, `stopped runner pid ${runner.pid}`);
    assertLine(r, "archived 2 of 2 agents");
    const info = s.project.readJson(`alt runs/${id}/run.json`);
    assert.equal(info.status, "stopped");
    assert.ok(info.endedAt);
    const done = "wf_20261020-111111_beef";
    s.project.writeJson(`_workspace/_runs/${done}/run.json`, { runId: done, status: "done" });
    assertLine(await s.ph(["archive", "--run", done]), "archived 0 of 0 agents");
    assert.equal(s.project.readJson(`_workspace/_runs/${done}/run.json`).status, "done");
  } finally {
    runner.kill();
  }
  assert.ok(path.isAbsolute(s.root));
});

test("PHCL-11 a wait that times out refuses delivery, with and without --now (INV-55)", async () => {
  const s = setup();
  addSub(s.fake, { title: "slow", status: "running" });
  s.fake.client.waitForFinish = async () => ({ status: "timeout", final: null, error: null, lastMessage: null });
  const r = await s.ph(["send", "--prompt", "next", "slow"]);
  assertExit(r, 2);
  assertLine(r, /^failed send slow: turn still timeout after \d+ s; not sent$/);
  assert.ok(!r.out.some((l) => /watch/.test(l)), r.out.join("\n"));
  addSub(s.fake, { title: "slow2", status: "running" });
  s.fake.client.cancelAgent = async () => {};
  const now = await s.ph(["send", "--now", "--prompt", "stop", "slow2"]);
  assertExit(now, 2);
  assertLine(now, /^failed send slow2: turn still timeout after 60 s; not sent$/);
  assert.equal(s.fake.callsOf("sendAgentMessage").length, 0);
});

test("PHCL-20 archive --run --reason records the stop reason and puts the run in the metrics ledger at once", async () => {
  const s = setup();
  const runner = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore", windowsHide: true });
  try {
    const id = "wf_20261022-090000_feed";
    s.project.writeJson(`_workspace/_runs/${id}/run.json`, { runId: id, status: "running", pid: runner.pid, adopted: [], name: "code-wave", startedAt: "2026-10-22T09:00:00.000Z" });
    s.project.write(`_workspace/_runs/${id}/journal.jsonl`, `${JSON.stringify({ n: 1, label: "Code", agentType: "gsd-executor", status: "ok", agentId: "a1", tokens: 50, usage: { input: 1, cachedInput: 0, output: 50, costUsd: 0.01 }, duration_s: 9 })}\n`);
    assertExit(await s.ph(["archive", "--run", id, "--reason", "  build hung\n on the  shared mutex "]), 0);
    assert.equal(s.project.readJson(`_workspace/_runs/${id}/run.json`).stopReason, "build hung on the shared mutex");
    const ledger = s.project.read("_workspace/harness-metrics.jsonl").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(ledger.map((r) => [r.runId, r.workflow, r.status, r.stopReason, r.groups[0].agent]), [[id, "code-wave", "stopped", "build hung on the shared mutex", "gsd-executor"]]);
    assertExit(await s.ph(["archive", "--run", id, "--reason", "again"]), 0);
    assert.equal(s.project.read("_workspace/harness-metrics.jsonl").trim().split("\n").length, 1, "a stopped run is recorded once");
  } finally {
    runner.kill();
  }
  const misuse = await s.ph(["archive", "--idle", "--reason", "x"]);
  assertExit(misuse, 1);
  assertErrLine(misuse, /--reason goes with --run/);
});
