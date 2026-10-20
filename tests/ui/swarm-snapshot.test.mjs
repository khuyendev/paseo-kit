import assert from "node:assert/strict";
import { test } from "node:test";
import contribute from "../../plugins/swarm-map/index.server.ts";
import { ActivityCache } from "../../plugins/swarm-map/server/activity.ts";
import { EventLog } from "../../plugins/swarm-map/server/events.ts";
import { FileLedger } from "../../plugins/swarm-map/server/files.ts";
import { RotateResolver } from "../../plugins/swarm-map/server/rotate.ts";
import { SnapshotBuilder } from "../../plugins/swarm-map/server/snapshot.ts";
import { WaveLinker } from "../../plugins/swarm-map/server/wave-link.ts";
import { agentDetailRpc, SWARM_RPCS, swarmSnapshotRpc } from "../../plugins/swarm-map/shared/swarm.ts";
import { loadKitConfig } from "../../ship/.agents/harness/config.mjs";
import { createFakeDaemon } from "../fakes/fake-daemon.mjs";
import { testEnv } from "../helpers/env.mjs";
import { connectFake } from "../helpers/run.mjs";
import { makeTempProject } from "../helpers/temp.mjs";
import { agentPayload, fakePaseo, fakeServer, iso, T_START, toolEntry } from "./fake-paseo.mjs";

const H = 3600_000;
const P = "paseo.parent-agent-id";

function setup(paseo, start = T_START) {
  const clock = { now: start };
  const files = new FileLedger();
  const events = new EventLog(() => clock.now, 7);
  const builder = new SnapshotBuilder({ activity: new ActivityCache(files), events, files, rotate: new RotateResolver(), waves: new WaveLinker(), now: () => clock.now });
  const snap = async (input = {}) => {
    const out = await builder.build(paseo, { recentHours: 0, afterSeq: -1, eventEpoch: null, ...input });
    swarmSnapshotRpc.output.parse(out);
    return out;
  };
  return { clock, builder, events, snap };
}

const kid = (id, parent, over = {}) => agentPayload(id, { labels: { [P]: parent }, ...over });
const allAgents = (s) => s.brains.flatMap((b) => [...(b.agent ? [b.agent] : []), ...b.groups.flatMap((g) => g.agents)]);

test("PANL-03 RPC names match the pattern and outputs parse with their schemas", async () => {
  for (const rpc of SWARM_RPCS) assert.match(rpc.name, /^[a-z][a-z0-9._-]*$/);
  assert.deepEqual(SWARM_RPCS.map((r) => r.name), ["swarm.snapshot", "swarm.agent-detail"]);
  const paseo = fakePaseo({ agents: [agentPayload("brain1"), kid("w1", "brain1")] });
  const { snap, builder } = setup(paseo);
  await snap();
  agentDetailRpc.output.parse(await builder.detail(paseo, "w1"));
});

test("PANL-02 server entry registers both handlers and its disposer leaves zero subscriptions", () => {
  const server = fakeServer();
  const dispose = contribute(server);
  assert.deepEqual([...server.handlers.keys()].sort(), ["swarm.agent-detail", "swarm.snapshot"]);
  assert.ok(server.subscriptions() >= 6);
  dispose();
  assert.equal(server.subscriptions(), 0);
});

test("PANL-04 swarm failures are typed envelopes, never throws", async () => {
  const paseo = fakePaseo({ agents: [agentPayload("b"), kid("w", "b")], timelines: { w: () => { throw new Error("timeline down"); } } });
  const { builder, snap } = setup(paseo);
  const broken = { agents: { list: () => { throw new TypeError("sdk exploded"); }, ref: () => { throw new TypeError("sdk exploded"); } }, workspaces: paseo.workspaces };
  const s = await builder.build(broken, { recentHours: 0, afterSeq: -1, eventEpoch: null });
  assert.equal(s.ok, true, "a listing failure is partial: PANL-43");
  const badBuilder = setup({ ...paseo, agents: { list: async () => ({ entries: null }) } }).builder;
  const fail = await badBuilder.build({ agents: { list: async () => ({ entries: null }) } }, { recentHours: 0, afterSeq: -1, eventEpoch: null });
  assert.equal(fail.ok, true);
  await snap();
  const d = await builder.detail(paseo, "w");
  assert.deepEqual([d.ok, d.code], [false, "failed"]);
  assert.match(d.message, /timeline down/);
  agentDetailRpc.output.parse(d);
  const nf = await builder.detail(paseo, "nobody");
  assert.deepEqual([nf.ok, nf.code], [false, "not_found"]);
  agentDetailRpc.output.parse(nf);
  const thrown = await new SnapshotBuilder({ activity: null, events: null, files: null, rotate: null, waves: null }).build(paseo, { recentHours: 0, afterSeq: -1, eventEpoch: null });
  assert.deepEqual([thrown.ok, thrown.code], [false, "failed"]);
  swarmSnapshotRpc.output.parse(thrown);
});

test("PANL-43 a throwing agents.list degrades to an empty snapshot with the error", async () => {
  const { snap } = setup(fakePaseo({ listError: "daemon gone" }));
  const s = await snap();
  assert.deepEqual(s.errors, ["agents: daemon gone"]);
  assert.deepEqual(s.brains, []);
});

test("PANL-24 snapshot shape; afterSeq = lastSeq with the same epoch returns no events", async () => {
  const { snap, events } = setup(fakePaseo({ agents: [agentPayload("b"), kid("w", "b")] }));
  events.push({ kind: "spawn", agentId: "w", parentId: "b", title: "w", text: "", stats: "", activity: null, path: null, peerId: null, peerOp: null });
  const first = await snap();
  assert.equal(first.events.length, 1);
  for (const k of ["runs", "tempDir", "runMaxAgeHours"]) assert.equal(k in first, false);
  const next = await snap({ afterSeq: first.lastSeq, eventEpoch: first.eventEpoch });
  assert.deepEqual(next.events, []);
});

test("PANL-26 listing keeps live agents only; contextPct only with known usage", async () => {
  const agents = [
    agentPayload("b"),
    kid("w1", "b", { lastUsage: { contextWindowUsedTokens: 250, contextWindowMaxTokens: 1000 } }),
    kid("w2", "b"),
    kid("w3", "b", { archivedAt: iso(0) }),
  ];
  const { snap } = setup(fakePaseo({ agents }));
  const s = await snap();
  const ids = allAgents(s).map((a) => a.id).sort();
  assert.deepEqual(ids, ["b", "w1", "w2"]);
  const w1 = allAgents(s).find((a) => a.id === "w1");
  assert.equal(w1.contextPct, 25);
  assert.equal(w1.model, "circle-agent/gpt-6-luna-fast[1m]");
  assert.equal(allAgents(s).find((a) => a.id === "w2").contextPct, null);
  assert.equal(agentPayload("q", { title: null }).title, null);
});

test("PANL-27 orphans, sleeping closed brains, brains with running members first", async () => {
  const agents = [kid("o1", "gone"), kid("o2", "gone"), kid("s1", "closedBrain"), agentPayload("hot"), kid("h1", "hot", { status: "running" })];
  const paseo = fakePaseo({ agents, extra: { gone: agentPayload("gone", { archivedAt: iso(0) }), closedBrain: agentPayload("closedBrain", { status: "closed" }) } });
  const s = await setup(paseo).snap();
  assert.equal(s.brains[0].agent.id, "hot");
  assert.equal(s.brains.at(-1).agent, null);
  assert.deepEqual(s.brains.at(-1).groups.flatMap((g) => g.agents.map((a) => a.id)).sort(), ["o1", "o2"]);
  assert.equal(s.brains.find((b) => b.agent?.id === "closedBrain").agent.status, "closed");
});

test("PANL-28 groups follow the ph.swarm label, titles only as fallback", async () => {
  const agents = [
    agentPayload("b"),
    kid("p1", "b", { title: "Plan the API layer with long text that the sixty char cut truncates somewhere", labels: { [P]: "b", "ph.swarm": "planners" } }),
    kid("p2", "b", { title: "Something else entirely", labels: { [P]: "b", "ph.swarm": "planners" } }),
    kid("f1", "b", { title: "Fix A" }),
    kid("f2", "b", { title: "Fix B" }),
  ];
  const s = await setup(fakePaseo({ agents })).snap();
  const groups = Object.fromEntries(s.brains[0].groups.map((g) => [g.name, g.agents.map((a) => a.id)]));
  assert.deepEqual(groups, { planners: ["p1", "p2"], Fix: ["f1", "f2"] });
});

test("PANL-29 a lone agent is counted, not drawn", async () => {
  const s = await setup(fakePaseo({ agents: [agentPayload("lone"), agentPayload("b"), kid("w", "b")] })).snap();
  assert.equal(s.standaloneCount, 1);
  assert.ok(!allAgents(s).some((a) => a.id === "lone"));
});

test("PANL-30 recentHours drops a brain idle for 7 h and keeps it with 0", async () => {
  const agents = [agentPayload("b", { updatedAt: iso(0) }), kid("w", "b", { updatedAt: iso(0) })];
  const { snap } = setup(fakePaseo({ agents }), T_START + 7 * H);
  assert.equal((await snap({ recentHours: 6 })).brains.length, 0);
  assert.equal((await snap({ recentHours: 0 })).brains.length, 1);
});

test("PANL-31 old idle brains cost no reads; running agents read about once per second; one read in flight", async () => {
  const agents = [];
  for (let i = 0; i < 25; i += 1) agents.push(agentPayload(`b${i}`, { updatedAt: iso(0) }), kid(`w${i}`, `b${i}`, { updatedAt: iso(0) }));
  agents.push(agentPayload("hb"), kid("run", "hb", { status: "running" }));
  const paseo = fakePaseo({ agents });
  const { snap, clock } = setup(paseo, T_START + 7 * H);
  await snap();
  const afterFirst = [...paseo.reads.values()].reduce((a, b) => a + b, 0);
  assert.equal(afterFirst, 1, "only the running agent is read; idle 7 h brains are not");
  clock.now += 400;
  await snap();
  assert.equal(paseo.reads.get("run"), 1);
  clock.now += 700;
  await Promise.all([snap(), snap()]);
  assert.equal(paseo.reads.get("run"), 2);
  assert.equal(paseo.maxInflight(), 1);
  assert.equal(paseo.reads.get("w3") ?? 0, 0);
});

test("PANL-32 a timeline failing on 5 polls reports its error once and keeps cached activity", async () => {
  let fail = false;
  const tl = (opts, n) => {
    if (fail) throw new Error("tail broke");
    return [toolEntry(`c${n}`, "Read", { file_path: "/p/a.md" }, iso(n))];
  };
  const agents = [agentPayload("b"), kid("w", "b", { status: "running" })];
  const { snap, clock } = setup(fakePaseo({ agents, timelines: { w: tl } }));
  await snap();
  fail = true;
  const errs = [];
  for (let i = 0; i < 5; i += 1) {
    clock.now += 31_000;
    const s = await snap();
    errs.push(...s.errors.filter((e) => e.startsWith("timeline")));
    assert.equal(allAgents(s).find((a) => a.id === "w").activity.label, "a.md");
  }
  assert.deepEqual(errs, ["timeline w: tail broke"]);
});

test("PANL-42 first read emits no tool events; a later new call emits exactly one", async () => {
  let entries = [toolEntry("c1", "Read", { file_path: "/p/a.md" }, iso(1)), toolEntry("c2", "Bash", { command: "ls" }, iso(2))];
  const agents = [agentPayload("b"), kid("w", "b", { status: "running" })];
  const { snap, clock } = setup(fakePaseo({ agents, timelines: { w: () => entries } }));
  const s1 = await snap();
  assert.equal(s1.events.filter((e) => e.kind === "tool").length, 0);
  entries = [...entries, toolEntry("c3", "Grep", { pattern: "x" }, iso(3))];
  clock.now += 1500;
  const s2 = await snap({ afterSeq: s1.lastSeq, eventEpoch: s1.eventEpoch });
  assert.deepEqual(s2.events.map((e) => [e.kind, e.text]), [["tool", "x"]]);
});

test("PANL-39 one batch read of 7 files previously held by one agent yields one handoff event", async () => {
  const seven = Array.from({ length: 7 }, (_, i) => `/p/f${i}.md`);
  let bEntries = [];
  const agents = [agentPayload("b"), kid("a1", "b", { status: "running" }), kid("a2", "b", { status: "running" })];
  const timelines = {
    a1: () => [toolEntry("w1", "mcp__harness-files__write_multiple_files", { files: seven.map((path) => ({ path, content: "" })) }, iso(1000))],
    a2: () => bEntries,
  };
  const { snap, clock } = setup(fakePaseo({ agents, timelines }));
  const s1 = await snap();
  bEntries = [toolEntry("r1", "mcp__harness-files__read_ranges", { ranges: seven.map((path) => ({ path })) }, iso(2000))];
  clock.now += 1500;
  const s2 = await snap({ afterSeq: s1.lastSeq, eventEpoch: s1.eventEpoch });
  const handoffs = s2.events.filter((e) => e.kind === "handoff");
  assert.equal(handoffs.length, 1);
  assert.match(handoffs[0].text, /^7 files: f0\.md, f1\.md, f2\.md, \.\.\.$/);
  assert.deepEqual([handoffs[0].peerId, handoffs[0].peerOp, handoffs[0].path], ["a1", "write", "/p/f0.md"]);
});

test("PANL-60 ledger ingestion on every read: paths seen later count, first read seeds holds silently", async () => {
  let bEntries = [toolEntry("x0", "Bash", { command: "ls" }, iso(500))];
  const agents = [agentPayload("b"), kid("A", "b", { status: "running" }), kid("B", "b", { status: "running" })];
  const timelines = {
    A: () => [1, 2, 3].map((i) => toolEntry(`aw${i}`, "Write", { file_path: `/p/a${i}.md` }, iso(i * 100))),
    B: () => bEntries,
  };
  const { snap, clock } = setup(fakePaseo({ agents, timelines }));
  const s1 = await snap();
  assert.deepEqual(s1.events, []);
  assert.equal(s1.files.filter((f) => f.agentId === "A").length, 3);
  assert.equal(allAgents(s1).find((a) => a.id === "A").heldFiles, 3);
  const all = [];
  bEntries = [...bEntries, toolEntry("e1", "mcp__harness-files__edit_multiple_files", { fixes: [{ id: "f" }] }, iso(1000), { status: "running" })];
  clock.now += 1500;
  const s2 = await snap({ afterSeq: s1.lastSeq, eventEpoch: s1.eventEpoch });
  all.push(...s2.events);
  bEntries = [bEntries[0], toolEntry("e1", "mcp__harness-files__edit_multiple_files", { files: [{ path: "/p/a1.md" }, { path: "/p/new.md" }] }, iso(1000))];
  clock.now += 1500;
  const s3 = await snap({ afterSeq: s2.lastSeq, eventEpoch: s2.eventEpoch });
  all.push(...s3.events);
  assert.equal(all.filter((e) => e.kind === "tool").length, 1);
  const a1 = s3.files.find((f) => f.name === "a1.md");
  assert.deepEqual([a1.agentId, a1.writers], ["B", 2]);
  assert.ok(s3.files.some((f) => f.name === "new.md" && f.agentId === "B"));
});

test("PANL-25 agent detail: one timeline read for a never-read agent, newest first, no reasoning", async () => {
  const entries = [
    { item: { type: "user_message", text: "please work" }, timestamp: iso(1), seqStart: 1 },
    { item: { type: "reasoning", text: "thinking" }, timestamp: iso(2), seqStart: 2 },
    toolEntry("c1", "Read", { file_path: "/p/a.md" }, iso(3)),
    { item: { type: "assistant_message", text: "done" }, timestamp: iso(4), seqStart: 4 },
  ];
  const paseo = fakePaseo({ agents: [agentPayload("idle1", { updatedAt: iso(-30 * H) })], timelines: { idle1: entries } });
  const { builder } = setup(paseo);
  const d = await builder.detail(paseo, "idle1");
  assert.equal(paseo.reads.get("idle1"), 1);
  assert.deepEqual(d.recent.map((a) => a.kind), ["reply", "read", "command"]);
  assert.equal(d.lastCommand.text, "please work");
  assert.equal(d.lastReply.text, "done");
});

test("PANL-56 100 fake agents stay within the caps and under 150 KB", async () => {
  const agents = [agentPayload("b")];
  const timelines = {};
  for (let i = 0; i < 100; i += 1) {
    agents.push(kid(`w${i}`, "b", { status: "running", title: `worker ${i}`, labels: { [P]: "b", "ph.swarm": `s${i % 5}` } }));
    timelines[`w${i}`] = Array.from({ length: 30 }, (_, j) =>
      toolEntry(`w${i}-c${j}`, "mcp__harness-files__read_ranges", { ranges: Array.from({ length: 40 }, (_, k) => ({ path: `/p/w${i}/f${j}-${k}.md` })) }, iso(j)),
    );
  }
  const paseo = fakePaseo({ agents, timelines });
  const { snap } = setup(paseo);
  const s = await snap();
  assert.equal(allAgents(s).length, 101);
  for (const a of allAgents(s)) {
    if (a.activity) assert.ok(a.activity.files.length <= 2);
    assert.ok(s.files.filter((f) => f.agentId === a.id).length <= 4);
  }
  assert.ok(paseo.maxInflight() <= 1);
  assert.ok(Buffer.byteLength(JSON.stringify(s)) < 150 * 1024, `${Buffer.byteLength(JSON.stringify(s))} bytes`);
});

test("PANL-27 a caller label paseo.parent-agent-id on a ph-created agent does not decide its brain", async () => {
  const fake = createFakeDaemon();
  const project = makeTempProject({ git: false });
  const session = await connectFake(fake, { env: testEnv({ PASEO_AGENT_ID: "brain-real-0001" }), root: project.root ?? project, cfg: loadKitConfig() });
  const created = await session.createAgent({ sel: { provider: "circle-agent", model: "m" }, prompt: "hi", title: "w", name: "w", swarm: "planners", labels: { [P]: "x" } });
  await session.close();
  const agents = [agentPayload("brain-real-0001"), agentPayload("x"), agentPayload(created.id, { labels: created.labels })];
  const s = await setup(fakePaseo({ agents })).snap();
  const brain = s.brains.find((b) => b.groups.some((g) => g.agents.some((a) => a.id === created.id)));
  assert.equal(brain.agent.id, "brain-real-0001");
  assert.deepEqual(brain.groups.map((g) => g.name), ["planners"]);
});
