// Spawn and archive effects (step B): the store's departing tombstones, the presence rules (fresh spawns, departure modes, room lights)
// and the life director's arrival waves and departures. Pure modules only; the screen behaviour is tested in office-scene.test.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBuilding } from "../../plugins/office/shared/layout/building.ts";
import * as CAM from "../../plugins/office/client/camera.ts";
import { poseFor } from "../../plugins/office/client/poses.ts";
import { ARCHIVE_BULK_MAX, SPAWN_FRESH_MS, departureModes, isFreshSpawn, roomLights, trackSpawns } from "../../plugins/office/client/presence.ts";
import { emptyState, normalizeAgent, reduce, snapshotOf } from "../../plugins/office/client/store.ts";
import { buildModel, visibleSnapshot } from "../../plugins/office/client/model.ts";
import { DEPARTING_MAX } from "../../plugins/office/client/limits.ts";
import { agentPayload, iso, projectPayload, workspacePayload } from "./fake-paseo.mjs";

const upsert = (agent) => ({ type: "agent.update", payload: { kind: "upsert", agent } });
const seed = (...agents) => ({ type: "agents.seed", entries: agents.map((agent) => ({ agent })) });
const base = () => {
  let s = reduce(emptyState(), { type: "workspaces.seed", entries: [workspacePayload("w1", { projectId: "p1" }), workspacePayload("w2", { projectId: "p2" })] });
  s = reduce(s, { type: "projects.seed", projects: [projectPayload("p1"), projectPayload("p2")] });
  return reduce(s, seed(agentPayload("a1", { workspaceId: "w1" }), agentPayload("a2", { workspaceId: "w1", title: "leaver" }), agentPayload("b1", { workspaceId: "w2" })));
};

// ---- store tombstones

test("B store: an archived agent leaves the agents and stays as a departing tombstone until the screen releases it", () => {
  const s = base();
  const archived = reduce(s, upsert(agentPayload("a2", { workspaceId: "w1", archivedAt: iso(5) })));
  assert.equal(archived.agents.has("a2"), false);
  assert.deepEqual([...archived.departing.keys()], ["a2"]);
  const snap = snapshotOf(archived);
  assert.deepEqual(snap.agents.map((a) => a.id), ["a1", "b1"]);
  assert.deepEqual(snap.departing.map((a) => [a.id, a.projectId, a.title]), [["a2", "p1", "leaver"]]);
  const released = reduce(archived, { type: "departed.release", ids: ["a2", "nope"] });
  assert.equal(released.departing.size, 0);
  assert.equal(reduce(released, { type: "departed.release", ids: ["a2"] }), released, "nothing to release: the same state");
  assert.equal(reduce(archived, { type: "departed.release", ids: "x" }), archived);
  // A remove leaves a tombstone too; an archive of an agent never seen leaves none.
  const removed = reduce(s, { type: "agent.update", payload: { kind: "remove", agentId: "a1" } });
  assert.deepEqual([...removed.departing.keys()], ["a1"]);
  assert.equal(reduce(s, upsert(agentPayload("ghost", { archivedAt: iso(1) }))).departing.size, 0);
  // Back from the archive: a live agent again, no tombstone.
  const back = reduce(archived, upsert(agentPayload("a2", { workspaceId: "w1" })));
  assert.deepEqual([back.agents.has("a2"), back.departing.has("a2")], [true, false]);
  // A re-seed that lists it again also clears the tombstone.
  assert.equal(reduce(archived, seed(agentPayload("a2", { workspaceId: "w1" }))).departing.has("a2"), false);
});

test("B store: the tombstones are bounded, the oldest goes first, and createdAt is kept as clipped text", () => {
  let s = reduce(emptyState(), seed(...Array.from({ length: DEPARTING_MAX + 5 }, (_, i) => agentPayload(`x${String(i).padStart(2, "0")}`))));
  for (let i = 0; i < DEPARTING_MAX + 5; i++) s = reduce(s, upsert(agentPayload(`x${String(i).padStart(2, "0")}`, { archivedAt: iso(i) })));
  assert.equal(s.departing.size, DEPARTING_MAX);
  assert.equal(s.departing.has("x00"), false);
  assert.equal(s.departing.has(`x${DEPARTING_MAX + 4}`), true);
  assert.equal(normalizeAgent(agentPayload("c", { createdAt: iso(7) })).createdAt, iso(7));
  assert.equal(normalizeAgent(agentPayload("c", { createdAt: 5 })).createdAt, null);
  assert.ok(normalizeAgent(agentPayload("c", { createdAt: "y".repeat(500) })).createdAt.length <= 40);
});

test("B model: departing agents keep their seat in the model and follow the hidden filter", () => {
  const snap = snapshotOf(reduce(base(), upsert(agentPayload("a2", { workspaceId: "w1", archivedAt: iso(5) }))));
  const ids = (m) => m.rooms.flatMap((r) => r.clusters.flatMap((c) => c.drawn.map((d) => d.agentId))).sort();
  assert.deepEqual(ids(buildModel(snap)), ["a1", "a2", "b1"]);
  assert.deepEqual(ids(buildModel(snap, {}, new Set(["p1"]))), ["b1"]);
  assert.deepEqual(visibleSnapshot(snap, new Set(["p1"])).departing, []);
  assert.doesNotThrow(() => buildModel({ projects: [], workspaces: [], agents: [], departing: "x" }));
});

// ---- presence rules

test("B fresh spawn: younger than SPAWN_FRESH_MS by createdAt; unreadable, old or far-future dates are not (safe default)", () => {
  const now = Date.parse("2026-10-21T10:00:00.000Z");
  const at = (ms) => new Date(now - ms).toISOString();
  assert.equal(isFreshSpawn(at(1000), now), true);
  assert.equal(isFreshSpawn(at(SPAWN_FRESH_MS - 1), now), true);
  assert.equal(isFreshSpawn(at(SPAWN_FRESH_MS + 1), now), false);
  assert.equal(isFreshSpawn(at(-2000), now), true, "a small clock skew still counts");
  assert.equal(isFreshSpawn(at(-SPAWN_FRESH_MS - 1), now), false);
  for (const bad of [null, undefined, "", "yesterday", 5, {}]) assert.equal(isFreshSpawn(bad, now), false);
  assert.equal(isFreshSpawn(at(1000), NaN), false);
});

test("B spawn book: the agents present at the first ready snapshot are the baseline and never arrive; later fresh ones do", () => {
  const now = Date.parse("2026-10-21T10:00:00.000Z");
  const fresh = new Date(now - 2000).toISOString();
  const old = new Date(now - 10 * SPAWN_FRESH_MS).toISOString();
  let book = trackSpawns(null, false, [{ id: "early", createdAt: fresh }], now);
  assert.equal(book.baseline, null, "nothing is decided before the store is ready");
  book = trackSpawns(book, true, [{ id: "a", createdAt: fresh }, { id: "b", createdAt: old }], now);
  assert.deepEqual([[...book.baseline].sort(), [...book.spawned]], [["a", "b"], []], "present at open: no elevator storm");
  book = trackSpawns(book, true, [{ id: "a", createdAt: fresh }, { id: "b", createdAt: old }, { id: "n1", createdAt: fresh }, { id: "n2", createdAt: old }, { id: "n3", createdAt: null }], now);
  assert.deepEqual([...book.spawned], ["n1"]);
  const same = trackSpawns(book, true, [{ id: "a", createdAt: fresh }, { id: "b", createdAt: old }, { id: "n1", createdAt: fresh }, { id: "n2", createdAt: old }, { id: "n3", createdAt: null }], now + 60_000);
  assert.deepEqual([...same.spawned], ["n1"], "decided once, kept while present");
  const gone = trackSpawns(same, true, [{ id: "a", createdAt: fresh }], now);
  assert.deepEqual([[...gone.baseline], [...gone.spawned]], [["a"], []], "agents that left are forgotten");
  assert.doesNotThrow(() => trackSpawns(gone, true, [null, 5, { id: 7 }], now));
});

test("B departure modes: a few archives walk out, a bulk archive above ARCHIVE_BULK_MAX fades; modes are kept until the tombstone goes", () => {
  let modes = departureModes(new Map(), ["d1"]);
  assert.deepEqual([...modes], [["d1", "walk"]]);
  const bulk = Array.from({ length: ARCHIVE_BULK_MAX + 1 }, (_, i) => `b${i}`);
  modes = departureModes(modes, ["d1", ...bulk]);
  assert.equal(modes.get("d1"), "walk");
  for (const id of bulk) assert.equal(modes.get(id), "fade", id);
  const few = Array.from({ length: ARCHIVE_BULK_MAX }, (_, i) => `f${i}`);
  modes = departureModes(new Map(), few);
  for (const id of few) assert.equal(modes.get(id), "walk", id);
  assert.deepEqual([...departureModes(modes, ["f0"])], [["f0", "walk"]]);
  assert.doesNotThrow(() => departureModes(null, [null, 3, "ok"]));
});

test("B room lights: a room is lit while one of its agents is present; an empty room is dark", () => {
  const seats = [{ agentId: "a", roomId: "p1" }, { agentId: "b", roomId: "p1" }, { agentId: "c", roomId: "p2" }];
  const lights = roomLights(["p1", "p2", "p3"], seats, (id) => id !== "c");
  assert.deepEqual([...lights], [["p1", true], ["p2", false], ["p3", false]]);
  assert.deepEqual([...roomLights(["p1"], seats, () => false)], [["p1", false]]);
  assert.doesNotThrow(() => roomLights(null, [null], () => true));
});

// ---- life director

const pt = (x, y) => ({ x, y });
const drawn = (agentId) => ({ agentId, parentId: null, isChild: false });
const agentView = (id, status) => ({ id, status, requiresAttention: false, attentionReason: null, pendingPermissions: 0, lastTool: null, activity: null });
function scene(statuses, extra = () => ({})) {
  const model = { rooms: [{ projectId: "p1", name: "p1", surplusAgents: 0, clusters: [{ workspaceId: "w1", name: "w1", status: "running", kind: null, diffAdditions: null, diffDeletions: null, surplusAgents: 0, drawn: Object.keys(statuses).map(drawn) }] }], surplusAgents: 0, totalAgents: 0, drawnAgents: 0 };
  const building = buildBuilding(CAM.roomInputsOf(model));
  const placement = CAM.placeScene(building, model);
  const characters = (over = {}) =>
    placement.seats.map((seat) => ({ agentId: seat.agentId, seat: { tile: seat.tile, dir: seat.dir }, status: statuses[seat.agentId], choice: poseFor(agentView(seat.agentId, statuses[seat.agentId])), ready: new Set([0, 1, 2]), ...extra(seat.agentId), ...(over[seat.agentId] ?? {}) }));
  return { building, characters };
}

test("B director: a spawned agent comes up the elevator even when it is already running; arrivals start in waves of SCENE_ARRIVAL_WAVE", () => {
  const ids = Array.from({ length: 7 }, (_, i) => `s${i}`);
  const { building, characters } = scene({ ...Object.fromEntries(ids.map((id) => [id, "running"])), old: "running" }, (id) => ({ spawned: id !== "old" }));
  const dir = CAM.createLifeDirector(building);
  assert.equal(dir.isGone("s0", "running", true), true, "an unseen spawned agent is not drawn before its arrival");
  assert.equal(dir.isGone("old", "running", false), false);
  const starts = [];
  for (let beat = 0; beat < 12; beat++) {
    const changes = dir.step(characters(), beat);
    const arrivals = changes.starts.filter((s) => s.kind === "arrival");
    assert.ok(arrivals.length <= CAM.SCENE_ARRIVAL_WAVE, `beat ${beat}: ${arrivals.length} arrivals`);
    for (const s of arrivals) {
      starts.push(s);
      assert.equal(s.journey.steps[0].kind, "appear");
      dir.finished(s.agentId, beat);
    }
  }
  assert.deepEqual(starts.map((s) => s.agentId).sort(), ids);
  assert.ok(new Set(starts.map((s) => s.startBeat)).size >= Math.ceil(ids.length / CAM.SCENE_ARRIVAL_WAVE), "the rest queue");
  assert.equal(dir.isGone("old"), false);
});

test("B director: an archived agent walks to an elevator at once (no sleep) and never comes back", () => {
  const { building, characters } = scene({ i1: "idle", r1: "running" });
  const dir = CAM.createLifeDirector(building);
  dir.step(characters(), 0);
  const leaving = { i1: { leave: "walk" } };
  const changes = dir.step(characters(leaving), 1);
  const dep = changes.starts.find((s) => s.agentId === "i1");
  assert.equal(dep.kind, "departure");
  assert.equal(dep.journey.steps.at(-1).kind, "vanish");
  assert.ok(dep.journey.steps.some((s) => s.kind === "walk"));
  assert.deepEqual(dir.finished("i1", 3).gone, ["i1"]);
  for (let beat = 4; beat < 40; beat++) assert.deepEqual(dir.step(characters(leaving), beat).starts.filter((s) => s.agentId === "i1"), []);
  assert.equal(dir.isGone("i1"), true);
});

test("B director: a bulk archive fades in place beyond the walker cap; a tombstone that never arrived is gone at once", () => {
  const ids = Array.from({ length: CAM.SCENE_MAX_WALKERS + 3 }, (_, i) => `f${i}`);
  const { building, characters } = scene({ ...Object.fromEntries(ids.map((id) => [id, "idle"])), late: "running" }, (id) => ({ spawned: id === "late", ready: new Set(id === "late" ? [1] : [0, 1, 2]) }));
  const dir = CAM.createLifeDirector(building);
  dir.step(characters(), 0);
  assert.equal(dir.isGone("late"), true, "no move sheet yet: still waiting for its arrival");
  const over = Object.fromEntries([...ids.map((id) => [id, { leave: "fade" }]), ["late", { leave: "walk" }]]);
  const changes = dir.step(characters(over), 1);
  const fades = changes.starts.filter((s) => s.kind === "departure");
  assert.deepEqual(fades.map((s) => s.agentId).sort(), [...ids].sort());
  for (const s of fades) assert.deepEqual(s.journey.steps.map((step) => step.kind), ["vanish"]);
  assert.ok(changes.gone.includes("late"));
  assert.equal(dir.isGone("late"), true);
});
