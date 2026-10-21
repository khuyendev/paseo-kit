import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_WORK_POSE, POSES_RETURNED, appearanceSeed, poseFor } from "../../plugins/office/client/poses.ts";
import { POSE_NAMES } from "../../plugins/office/shared/art-types.ts";
import { AGENT_STATUSES, ATTENTION_REASONS, TOOL_KINDS } from "../../plugins/office/shared/model-types.ts";
import { SPRITE_KEY_MAX_CHARS, SPRITE_TINT_INDEX_MAX, SPRITE_SEED_MAX_CHARS, parseSpriteKey, spriteKey } from "../../plugins/office/shared/sprites-rpc.ts";
import { ZOOM_CANDIDATES } from "../../plugins/office/shared/art-types.ts";

const base = { status: "idle", requiresAttention: false, attentionReason: null, pendingPermissions: 0, lastTool: null, activity: null };
const pose = (over) => poseFor({ ...base, ...over });

const UUID = "0955955c-043f-4638-9cc2-d8e28d51e7c1";
const IDS = [UUID, UUID.toUpperCase(), "x".repeat(64), "y".repeat(200), "z".repeat(10000), "a b", "a/b", "a:b", "café-✓", "", "__proto__", "constructor"];

test("OFFC-11 poses: pending permissions and permission attention win over every status", () => {
  for (const status of AGENT_STATUSES) {
    assert.equal(pose({ status, pendingPermissions: 2 }).pose, "raise_hand", status);
    assert.equal(pose({ status, requiresAttention: true, attentionReason: "permission" }).pose, "raise_hand", status);
  }
  assert.equal(pose({ status: "running", requiresAttention: true, attentionReason: "finished" }).pose, "wait");
});

test("OFFC-11 poses: error, closed, running by tool kind, idle and initializing", () => {
  assert.equal(pose({ status: "error" }).pose, "sulk");
  const closed = pose({ status: "closed" });
  assert.equal(closed.pose, "sleep");
  assert.equal(closed.leaves, true);
  for (const lastTool of ["edit", "write"]) assert.equal(pose({ status: "running", lastTool, activity: "tool" }).pose, "type");
  assert.equal(pose({ status: "running", lastTool: "read", activity: "tool" }).pose, "read");
  assert.equal(pose({ status: "running", lastTool: "shell", activity: "tool" }).pose, "use");
  assert.equal(pose({ status: "running", lastTool: "edit", activity: "reasoning" }).pose, "wait");
  assert.equal(pose({ status: "running", lastTool: null }).pose, "wait");
  for (const lastTool of ["search", "fetch", "plan", "sub_agent", "worktree_setup", "plain_text", "unknown"]) {
    assert.equal(pose({ status: "running", lastTool, activity: "tool" }).pose, DEFAULT_WORK_POSE, lastTool);
  }
  const idle = pose({ status: "idle" });
  assert.deepEqual([idle.pose, idle.alt, idle.wanders], ["stand", "drink", true]);
  const starting = pose({ status: "initializing" });
  assert.deepEqual([starting.pose, starting.arrives], ["stand", true]);
});

test("OFFC-11 poses: every input combination returns a pose of POSE_NAMES that POSES_RETURNED lists", () => {
  let count = 0;
  for (const status of AGENT_STATUSES) {
    for (const attentionReason of [null, ...ATTENTION_REASONS]) {
      for (const pendingPermissions of [0, 1]) {
        for (const lastTool of [null, ...TOOL_KINDS]) {
          for (const activity of [null, "reasoning", "tool", "message"]) {
            const c = poseFor({ status, requiresAttention: attentionReason !== null, attentionReason, pendingPermissions, lastTool, activity });
            assert.ok(POSE_NAMES.includes(c.pose), c.pose);
            assert.ok(POSES_RETURNED.includes(c.pose), c.pose);
            if (c.alt !== null) assert.ok(POSES_RETURNED.includes(c.alt), c.alt);
            count++;
          }
        }
      }
    }
  }
  assert.ok(count > 1000);
  assert.ok(POSES_RETURNED.every((p) => POSE_NAMES.includes(p)));
});

test("OFFC-11 appearance: the seed is a plus the FNV-1a hash in hex, nine characters, never the id", () => {
  assert.equal(appearanceSeed(""), "a811c9dc5");
  assert.equal(appearanceSeed("a"), "ae40c292c");
  assert.equal(appearanceSeed("foobar"), "abf9cf968");
  const seen = new Set();
  for (const id of IDS) {
    const seed = appearanceSeed(id);
    assert.match(seed, /^a[0-9a-f]{8}$/, id.slice(0, 20));
    assert.equal(seed.length, 9);
    assert.ok(seed.length <= SPRITE_SEED_MAX_CHARS);
    assert.equal(seed, appearanceSeed(id));
    assert.notEqual(seed, id);
    seen.add(seed);
    const key = spriteKey({ kind: "ruler", seed, poses: [], scale: 2, tint: 0 });
    assert.equal(parseSpriteKey(key)?.seed, seed);
  }
  assert.equal(seen.size, IDS.length);
});

test("OFFC-08 key length: a sheet key built from any agent id stays within SPRITE_KEY_MAX_CHARS", () => {
  const sheetPoses = POSE_NAMES.filter((p) => p === "walk" || POSES_RETURNED.includes(p));
  const joined = sheetPoses.join("+");
  assert.equal(joined.length, 57);
  for (const id of IDS) {
    const seed = appearanceSeed(id);
    for (const zoom of ZOOM_CANDIDATES) {
      for (let tint = 0; tint <= SPRITE_TINT_INDEX_MAX; tint++) {
        // The character-sheet kind is registered by 07-11, so its 15 characters come from the literal here.
        const text = ["character-sheet", seed, joined, String(zoom), String(tint)].join(":");
        assert.ok(text.length <= SPRITE_KEY_MAX_CHARS, `${text.length} for ${id.slice(0, 12)}`);
        const ruler = spriteKey({ kind: "ruler", seed, poses: sheetPoses, scale: zoom, tint });
        assert.equal(parseSpriteKey(ruler)?.seed, seed);
      }
    }
  }
  // Negative control: the raw UUID as seed with the seven work poses is over the cap, so a regression to the raw id fails here.
  const raw = ["character-sheet", UUID, "type+sleep+use+raise_hand+read+wait+sulk", "4", "0"].join(":");
  assert.equal(raw.length, 97);
  assert.ok(raw.length > SPRITE_KEY_MAX_CHARS);
  assert.equal(appearanceSeed(UUID).length, 9);
});
