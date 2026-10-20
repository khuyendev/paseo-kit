import assert from "node:assert/strict";
import { test } from "node:test";
import { EventLog, recordLifecycle } from "../../plugins/swarm-map/server/events.ts";
import { FileLedger } from "../../plugins/swarm-map/server/files.ts";
import { swarmName } from "../../plugins/swarm-map/server/group.ts";
import { fakePaseo, fakeServer, flush, iso, messageEntry, T_START } from "./fake-paseo.mjs";

const MIN = 60_000;

test("PANL-37 ledger: handoff within the window, writers count, no holder move for an older touch", () => {
  let l = new FileLedger();
  assert.equal(l.record("X.md", { agentId: "A", op: "write", at: iso(0) }), null);
  const h = l.record("x.md", { agentId: "B", op: "write", at: iso(MIN) });
  assert.equal(h.prev.agentId, "A");
  assert.equal(l.writersOf("X.md", T_START + 2 * MIN), 2);
  assert.equal(l.record("x.md", { agentId: "B", op: "write", at: iso(MIN) }), null, "repeat is a no-op");

  l = new FileLedger();
  l.record("X.md", { agentId: "A", op: "write", at: iso(0) });
  assert.equal(l.record("X.md", { agentId: "B", op: "write", at: iso(20 * MIN) }), null);
  assert.equal(l.writersOf("X.md", T_START + 20 * MIN), 1);

  l = new FileLedger();
  l.record("X.md", { agentId: "A", op: "write", at: iso(5 * MIN) });
  assert.equal(l.record("X.md", { agentId: "B", op: "write", at: iso(0) }), null);
  assert.equal(l.writersOf("X.md", T_START + 6 * MIN), 2);
  const { holds } = l.holds(new Set(["A", "B"]), T_START + 6 * MIN);
  assert.equal(holds[0].agentId, "A");
});

test("PANL-38 holds: 4 per agent, conflicts always present, heldFiles counts all", () => {
  const l = new FileLedger();
  for (let i = 0; i < 10; i += 1) l.record(`/p/f${i}.md`, { agentId: "A", op: "read", at: iso(i * 1000) });
  l.record("/p/shared.md", { agentId: "B", op: "write", at: iso(0) });
  l.record("/p/shared.md", { agentId: "A", op: "write", at: iso(500) });
  const { holds, counts } = l.holds(new Set(["A", "B"]), T_START + 20_000);
  assert.equal(counts.get("A"), 11);
  assert.equal(holds.filter((h) => h.agentId === "A" && h.writers < 2).length, 4);
  const conflict = holds.find((h) => h.name === "shared.md");
  assert.equal(conflict.writers, 2);
  assert.equal(conflict.prevAgentId, "B");
});

test("PANL-40 event log keeps 500, history on first call or new epoch, delta after the cursor", () => {
  let now = T_START;
  const log = new EventLog(() => now, 42);
  const ev = (i) => ({ kind: "spawn", agentId: `a${i}`, parentId: null, title: "t", text: "x".repeat(300), stats: "", activity: null, path: null, peerId: null, peerOp: null });
  for (let i = 0; i < 600; i += 1) log.push(ev(i));
  assert.equal(log.size, 500);
  assert.equal(log.lastSeq, 600);
  assert.equal(log.since(-1, null).length, 40);
  assert.equal(log.since(590, log.epoch).length, 10);
  assert.equal(log.since(600, log.epoch).length, 0);
  assert.ok(log.since(0, log.epoch).length <= 200);
  assert.ok(log.since(-1, null)[0].text.length <= 200);
  now += 5000;
  const restarted = new EventLog(() => now, 42);
  assert.notEqual(restarted.epoch, log.epoch);
  restarted.push(ev(1));
  assert.equal(restarted.since(600, log.epoch).length, 1, "other epoch returns history");
});

test("PANL-41 lifecycle hooks record each event kind; prompt lookup retries once", async () => {
  const server = fakeServer();
  const log = new EventLog(() => T_START, 1);
  let timeline = [];
  const paseo = fakePaseo({ timelines: { a1: () => timeline } });
  const timing = { now: () => T_START, delay: async () => { timeline = [messageEntry("user_message", "fix the bug", iso(100), 1)]; } };
  const stop = recordLifecycle(server, log, timing);
  const agent = { id: "a1", parentAgentId: "brain", title: "worker", provider: "p", cwd: "/", workspaceId: null };
  server.emit("agent.created", { agent }, { paseo });
  server.emit("agent.archived", { agent, archivedAt: iso(0) }, { paseo });
  server.emit("agent.turn_started", { agent, turnId: null }, { paseo });
  const turn = [
    { type: "tool_call", callId: "1", name: "Read", status: "completed", error: null, detail: { type: "read", filePath: "/a" } },
    { type: "tool_call", callId: "2", name: "Read", status: "completed", error: null, detail: { type: "read", filePath: "/b" } },
    { type: "tool_call", callId: "3", name: "Bash", status: "completed", error: null, detail: { type: "shell", command: "ls" } },
    { type: "assistant_message", text: "all done" },
  ];
  server.emit("agent.turn_ended", { agent, turnId: null, outcome: { kind: "completed" }, timeline: turn }, { paseo });
  server.emit("agent.turn_ended", { agent, turnId: null, outcome: { kind: "failed", error: { message: "oops" } }, timeline: [] }, { paseo });
  server.emit("agent.turn_ended", { agent, turnId: null, outcome: { kind: "canceled", reason: "stop" }, timeline: [] }, { paseo });
  server.emit("agent.permission_requested", { agent, request: { name: "Bash", title: "Run ls" } }, { paseo });
  server.emit("agent.permission_resolved", { agent, requestId: "r", resolution: {} }, { paseo });
  for (let i = 0; i < 5; i += 1) await flush();
  const byKind = Object.fromEntries(log.since(-1, null).map((e) => [e.kind, e]));
  assert.equal(byKind.spawn.title, "worker");
  assert.ok(byKind.archive);
  assert.equal(byKind.command.text, "fix the bug");
  assert.equal(byKind.report.text, "all done");
  assert.equal(byKind.report.stats, "2 read · 1 shell");
  assert.equal(byKind.failed.text, "oops");
  assert.equal(byKind.canceled.text, "stop");
  assert.equal(byKind.permission.text, "Run ls");
  assert.ok(byKind.permission_resolved);
  stop();
  assert.equal(server.subscriptions(), 0);
});

test("PANL-28 swarm names: counter suffix, colon prefix, first word", () => {
  assert.equal(swarmName(""), "(untitled)");
  assert.equal(swarmName("review #3"), "review");
  assert.equal(swarmName("planner 2"), "planner");
  assert.equal(swarmName("Fix A"), "Fix");
  assert.equal(swarmName("Fix B"), "Fix");
  assert.equal(swarmName("Audit: the parser"), "Audit");
});
