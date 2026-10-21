// Pose table and appearance seed (OFFC-11, OFFC-08): pure functions of API values, no React, no SDK, no tool-name table (D-03).
import { POSE_NAMES, type Pose } from "../shared/art-types.ts";
import type { AgentView } from "../shared/model-types.ts";

export interface PoseChoice {
  pose: Pose;
  // Second pose the scene may alternate with, or null.
  alt: Pose | null;
  // The character wanders between spots while this choice holds.
  wanders: boolean;
  // The character leaves the room (closed agent).
  leaves: boolean;
  // The character arrives at its desk (initializing agent).
  arrives: boolean;
}

export type PoseInput = Pick<AgentView, "status" | "requiresAttention" | "attentionReason" | "pendingPermissions" | "lastTool" | "activity">;

// Pose of a running agent whose tool kind has no row of its own (assumption A9, the owner may change it).
export const DEFAULT_WORK_POSE: Pose = "type";

// Every pose poseFor can return, alternates included; the sheet a character needs is these plus walk.
export const POSES_RETURNED: readonly Pose[] = ["type", "read", "use", "wait", "raise_hand", "sulk", "sleep", "stand", "drink"];

function choice(pose: Pose, over: Partial<PoseChoice> = {}): PoseChoice {
  return { pose, alt: null, wanders: false, leaves: false, arrives: false, ...over };
}

// First match wins, in the OFFC-11 order: permission, error, closed, running by latest tool kind, idle, initializing.
export function poseFor(agent: PoseInput): PoseChoice {
  if (agent.pendingPermissions > 0 || (agent.requiresAttention && agent.attentionReason === "permission")) return choice("raise_hand");
  if (agent.status === "error") return choice("sulk");
  if (agent.status === "closed") return choice("sleep", { leaves: true });
  if (agent.status === "running") {
    if (agent.activity === "reasoning" || agent.lastTool === null) return choice("wait");
    switch (agent.lastTool) {
      case "edit":
      case "write":
        return choice("type");
      case "read":
        return choice("read");
      case "shell":
        return choice("use");
      default:
        return choice(DEFAULT_WORK_POSE);
    }
  }
  if (agent.status === "idle") return choice("stand", { alt: "drink", wanders: true });
  return choice("stand", { arrives: true });
}

// Nine characters whatever the id: the letter a and the 32-bit FNV-1a hash of the id in hex. A raw 36-character UUID would push a
// work-group sheet key to 97 characters, one over SPRITE_KEY_MAX_CHARS, so the id itself is never the seed (OFFC-08, OFFC-11).
export function appearanceSeed(agentId: string): string {
  const text = String(agentId);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `a${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

// The poses named here must be real sprite poses; a compile-time and start-up guard against a typo in the table.
for (const pose of POSES_RETURNED) {
  if (!(POSE_NAMES as readonly string[]).includes(pose)) throw new RangeError(`pose ${pose}`);
}
