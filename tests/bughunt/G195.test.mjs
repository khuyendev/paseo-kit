import assert from "node:assert/strict";
import { test } from "node:test";
import * as model from "../../plugins/office/client/model.ts";
import { drawerModel } from "../../plugins/office/client/drawer-model.ts";
import { LIST_PAGES_MAX } from "../../plugins/office/client/limits.ts";
import { topbarModel } from "../../plugins/office/client/topbar-model.ts";
import { createStore } from "../../plugins/office/client/store.ts";
import { text } from "../../plugins/office/client/strings.ts";
import { agentPayload, agentUpsert, fakePaseo, flush, iso, projectPayload, workspacePayload } from "../ui/fake-paseo.mjs";

// Regression tests for G195: failed collections, capped pages, unreadable todos and restore races must not look like an empty, ready office.
const fixture = (extra = {}) =>
  fakePaseo({
    agents: [agentPayload("a1", { workspaceId: "w1" }), agentPayload("a2", { workspaceId: "w1" })],
    workspaceEntries: [workspacePayload("w1")],
    projectEntries: [projectPayload("p1")],
    ...extra,
  });
async function settleAll(rounds = 14) {
  for (let i = 0; i < rounds; i++) await flush();
}
const running = (id, over = {}) => agentPayload(id, { workspaceId: "w1", status: "running", ...over });
const agentOf = (store, id) => store.getSnapshot().agents.find((a) => a.id === id);
const toolEvent = (seq, kind) => ({ item: { type: "tool_call", detail: { type: kind } }, timestamp: iso(seq), seqStart: seq });
const todoEntry = (seq, ...texts) => ({ item: { type: "todo", items: texts.map((t) => ({ text: t, completed: false })) }, timestamp: iso(seq), seqStart: seq });
const busyEntries = Array.from({ length: 150 }, (_, i) => (i + 1 === 10 ? todoEntry(10, "ship it") : toolEvent(i + 1, "read")));
const NOW = Date.parse(iso(0));

test("G195 top bar: a pending permission counts as needing the owner, as the HUD and the drawer count it", () => {
  const snapshot = { projects: [], workspaces: [], agents: [{ id: "a", status: "running", requiresAttention: false, pendingPermissions: 1 }] };
  assert.equal(topbarModel(snapshot, null).counters.attention, 1);
});

test("G195 status: a failed workspaces read names the collection and its error, not the projects", async () => {
  const fake = fixture();
  fake.workspaces.list = async () => {
    throw new Error("workspaces down");
  };
  const store = createStore(fake);
  await store.start();
  await settleAll();
  const status = store.getStatus();
  assert.deepEqual([status.state, status.failed, status.error], ["failed", "workspaces", "workspaces down"]);
  assert.equal(model.screenStateText(status, 1), text("screenFailedWorkspaces", { error: "workspaces down" }));
  store.dispose();
});

test("G195 status: a failed agents read is named as agents, with its error", async () => {
  const store = createStore(fakePaseo({ listError: "daemon offline" }));
  await store.start();
  await settleAll();
  assert.equal(model.screenStateText(store.getStatus(), 0), text("screenFailedAgents", { error: "daemon offline" }));
  store.dispose();
});

test("G195 cap: a list stopped by the page cap is ready but reports the capped collection; an exact fit is not capped", async () => {
  const over = fixture({ agents: Array.from({ length: LIST_PAGES_MAX + 5 }, (_, i) => agentPayload(`m${i}`)), pageSize: 1 });
  const capped = createStore(over);
  await capped.start();
  await settleAll();
  assert.deepEqual([capped.getStatus().state, capped.getStatus().capped], ["ready", ["agents"]]);
  assert.equal(model.screenStateText(capped.getStatus(), 1), text("screenCappedAgents"));
  capped.dispose();

  const exact = fixture({ agents: Array.from({ length: LIST_PAGES_MAX }, (_, i) => agentPayload(`e${i}`)), pageSize: 1 });
  const fits = createStore(exact);
  await fits.start();
  await settleAll();
  assert.deepEqual([fits.getStatus().state, fits.getStatus().capped], ["ready", []]);
  fits.dispose();
});

test("G195 todos: a failed tail read is not shown as no todos, and selecting the agent reads it again", async () => {
  const fake = fixture({
    agents: [running("busy")],
    timelines: {
      busy: (opts, n) => {
        if (n === 1) throw new Error("read failed");
        return busyEntries;
      },
    },
  });
  const store = createStore(fake);
  await store.start();
  await settleAll();
  assert.equal(store.todoScan("busy"), "failed");
  assert.equal(drawerModel(store.getSnapshot(), "busy", NOW, store.todoScan("busy")).todoEmptyKey, "drawerTodosFailed");
  store.select("busy");
  await settleAll(30);
  assert.deepEqual([store.todoScan("busy"), agentOf(store, "busy").todos[0]?.text], ["ok", "ship it"]);
  store.dispose();
});

test("G195 todos: a failed older page is shown as unavailable, and a scan stopped at the page cap as capped", async () => {
  const long = Array.from({ length: 1000 }, (_, i) => toolEvent(i + 1, "read"));
  const capped = createStore(fixture({ agents: [running("busy")], timelines: { busy: long } }));
  capped.select("busy");
  await capped.start();
  await settleAll(40);
  assert.equal(capped.todoScan("busy"), "capped");
  assert.equal(drawerModel(capped.getSnapshot(), "busy", NOW, capped.todoScan("busy")).todoEmptyKey, "drawerTodosCapped");
  assert.equal(capped.stats().todoScanCapped, 1);
  capped.dispose();

  const older = createStore(fixture({ agents: [running("busy")], timelines: { busy: (opts) => { if (opts.direction === "before") throw new Error("x"); return busyEntries; } } }));
  older.select("busy");
  await older.start();
  await settleAll(20);
  assert.equal(older.todoScan("busy"), "failed");
  older.dispose();
});

test("G195 restore: an agent update that lands while the restore pages are read survives the replacement", async () => {
  const fake = fixture({ agents: [agentPayload("x1", { workspaceId: "w1" }), agentPayload("x2", { workspaceId: "w1" })], pageSize: 1 });
  const store = createStore(fake);
  await store.start();
  await settleAll();
  const list = fake.agents.list;
  fake.agents.list = (options) => {
    if (options?.page?.cursor === "1") fake.emitAgent(agentUpsert(agentPayload("x1", { workspaceId: "w1", status: "running" })));
    return list(options);
  };
  fake.restoreAgents([agentPayload("x1", { workspaceId: "w1", status: "idle" }), agentPayload("x2", { workspaceId: "w1" })]);
  await settleAll();
  assert.equal(agentOf(store, "x1").status, "running");
  assert.equal(agentOf(store, "x2").status, "idle");
  store.dispose();
});

test("G195 restore: a failed projects re-list after a restore is counted, and does not turn a working office into a failed one", async () => {
  const fake = fixture();
  const store = createStore(fake);
  await store.start();
  await settleAll();
  fake.projects.list = async () => {
    throw new Error("projects down");
  };
  fake.restoreAgents([agentPayload("a1", { workspaceId: "w1" })]);
  await settleAll();
  assert.equal(store.getStatus().state, "ready");
  assert.ok(store.stats().listErrors >= 1);
  store.dispose();
});
