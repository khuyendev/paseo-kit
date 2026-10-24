// Bug-hunt fix G133: the caller-wide agent cap is shared by every process of the caller (spawn, fanout, collect and each
// workflow run), so a concurrent process cannot count the same free slot.
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { tryLock, unlock } from "../../ship/.agents/harness/adapter/mutex.mjs";
import { createCapacity } from "../../ship/.agents/harness/workflow/admission.mjs";
import { createFakeClock } from "../fakes/fake-clock.mjs";
import { makeTempProject } from "../helpers/temp.mjs";
import { CALLER, addSub, creates, setup, settle } from "../ph/setup.mjs";

// Another process of the caller holds the caller's cap lock (the lock name and folder of the cap lock).
function holdCapLock(root) {
  const name = `agent-cap-${CALLER}`;
  const tmp = path.join(root, "_workspace", "locks");
  const token = tryLock(name, { tmp });
  assert.ok(token, "the cap lock is free");
  return () => unlock(name, token, { tmp });
}

test("G133 two workflow runs share the caller's running cap: the second waits for the first call's agent", async () => {
  const project = makeTempProject({ git: false });
  const agents = [];
  const session = { requireCaller: () => CALLER, listAgents: async () => agents.map((a) => ({ ...a })) };
  const cfg = { max_subagents: 1, max_live_subagents: 40, wait_timeout_s: 3600 };
  const clock = createFakeClock();
  const run = () => createCapacity({ session, cfg, clock, out: () => {}, root: project.root });
  const first = await run().admit({ needsNew: true });
  let second = null;
  run().admit({ needsNew: true }).then((r) => (second = r));
  await settle();
  assert.equal(second, null, "second run admitted before the first run's agent exists");
  agents.push({ id: "a1", status: "running", title: "first" });
  first.started("a1");
  await settle();
  // Each run has its own capacity (its own process), so the second run recounts on its timer, not on the first run's release.
  await clock.advance(5000);
  await settle();
  assert.equal(second, null, "second run admitted while the first run's agent is running");
  agents[0].status = "idle";
  first.release();
  await clock.advance(5000);
  await settle();
  assert.equal(typeof second?.release, "function", "second run admitted once the slot is free");
  second.release();
});

test("G133 spawn waits for the caller's cap lock held by another process, then checks and creates under it", async () => {
  const s = setup();
  const release = holdCapLock(s.root);
  const pending = s.ph(["spawn", "--name", "a", "--prompt", "w"]);
  await settle(20);
  assert.equal(creates(s.fake).length, 0, "spawn created an agent while another process held the cap lock");
  release();
  assert.equal((await pending).code, 0);
  assert.equal(creates(s.fake).length, 1);
});

test("G133 fanout --collect: a block's create re-reads the agents under the cap lock and does not take a slot another process filled", async () => {
  const s = setup({ overlay: { max_subagents: 1, wait_timeout_s: 1 } });
  s.project.write("f.txt", "=== a\nA\n");
  const release = holdCapLock(s.root);
  const pending = s.ph(["fanout", "--file", "f.txt", "--collect", "out"]);
  await settle(20);
  addSub(s.fake, { status: "running", title: "other" });
  release();
  const r = await pending;
  assert.equal(r.code, 2);
  assert.equal(creates(s.fake).length, 0, "collect created an agent past the running cap");
  assert.ok(r.out.some((l) => l === "waiting for a free running slot (1 running of 1); a slot another agent of this caller frees is used"), JSON.stringify(r.out));
  assert.ok(r.out.some((l) => l === "failed a: timed out after 1 s waiting for a free running slot (1 running of 1)"), JSON.stringify(r.out));
});
