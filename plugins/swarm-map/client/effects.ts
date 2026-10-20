// One-shot effects from live events (PANL-50): prompts fly brain -> agent, reports back, spawns spark,
// permissions fly toward the brain, tool calls pop (at most one per agent per TOOL_POP_GAP_MS), handed-off files
// arc from the previous holder.
import type { SwarmEvent } from "../shared/swarm.ts";
import { clip, firstLine } from "./format.ts";
import { AGENT_R, BRAIN_R, type Layout, type Point, arc, fileAnchor, pathToAgent } from "./geometry.ts";
import type { PacketSpec } from "./links.tsx";
import { ACTIVITY_ICON, type Colors, DECOR, FILE_OP_ICON, activityHue, isWriteConflict } from "./palette.ts";
import { TOOL_POP_GAP_MS } from "./state.ts";

export type Effect =
  | { id: string; type: "packet"; spec: PacketSpec; arrive?: { x: number; y: number; r: number; hue: string } }
  | { id: string; type: "burst"; x: number; y: number; r: number; hue: string }
  | { id: string; type: "sparks"; x: number; y: number; hue: string };

let seq = 0;
export const nextEffectId = () => `fx${(seq += 1)}`;

// Distance above a brain where prompts from the owner come from.
const OWNER_DY = 230;

function toolPath(kind: string, x: number, y: number): Point[] {
  if (kind === "edit" || kind === "write") return [{ x, y }, { x: x + 64, y: y - 54 }];
  if (kind === "shell") return [{ x, y }, { x, y: y - 74 }];
  if (kind === "agent") return [{ x, y }, { x: x - 64, y: y - 54 }];
  return [{ x: x + 64, y: y - 54 }, { x, y }];
}

export interface EffectContext {
  lastToolAt: Map<string, number>;
  // Last known positions of agents that left the map (a file can come from an archived agent).
  lastPos: ReadonlyMap<string, Point>;
}

export function effectsFor(e: SwarmEvent, layout: Layout, c: Colors, ctx: EffectContext, nowMs: number): Effect[] {
  const agent = layout.byAgent.get(e.agentId);
  const brain = layout.byBrain.get(e.agentId);
  const text = (fallback: string) => clip(firstLine(e.text) || fallback, 34);
  const packet = (spec: PacketSpec, arrive?: { x: number; y: number; r: number; hue: string }): Effect => ({ id: nextEffectId(), type: "packet", spec, arrive });
  switch (e.kind) {
    case "command": {
      const points = agent ? pathToAgent(layout, e.agentId) : brain ? [{ x: brain.x, y: brain.y - OWNER_DY }, { x: brain.x, y: brain.y }] : null;
      const at = agent ?? brain;
      if (!points || !at) return [];
      return [packet({ points, durationMs: 1800, hue: DECOR.prompt, icon: "Send", text: text("new prompt") }, { x: at.x, y: at.y, r: (agent ? AGENT_R : BRAIN_R) + 4, hue: DECOR.prompt })];
    }
    case "report":
    case "failed":
    case "canceled": {
      const ok = e.kind === "report";
      const hue = ok ? c.statusSuccess : c.statusDanger;
      const icon = ok ? "CircleCheck" : "CircleX";
      if (agent) {
        const points = pathToAgent(layout, e.agentId);
        if (!points) return [];
        return [
          { id: nextEffectId(), type: "burst", x: agent.x, y: agent.y, r: AGENT_R + 4, hue },
          packet({ points: [...points].reverse(), durationMs: 1800, hue, icon, text: text(ok ? "done" : e.kind) }, { x: points[0].x, y: points[0].y, r: BRAIN_R + 6, hue }),
        ];
      }
      return brain ? [packet({ points: [{ x: brain.x, y: brain.y }, { x: brain.x, y: brain.y - OWNER_DY }], durationMs: 1500, hue, icon, text: text(ok ? "done" : e.kind) })] : [];
    }
    case "spawn":
      if (!agent) return [];
      return [
        { id: nextEffectId(), type: "sparks", x: agent.x, y: agent.y, hue: DECOR.spawn },
        packet({ points: agent.edge, durationMs: 900, hue: DECOR.spawn, icon: "Rocket", text: "", small: true }, { x: agent.x, y: agent.y, r: AGENT_R + 2, hue: DECOR.spawn }),
      ];
    case "permission": {
      const place = agent ?? brain;
      if (!place) return [];
      const out: Effect[] = [{ id: nextEffectId(), type: "burst", x: place.x, y: place.y, r: (agent ? AGENT_R : BRAIN_R) + 6, hue: c.statusWarning }];
      const points = agent ? pathToAgent(layout, e.agentId) : null;
      if (points) out.push(packet({ points: [...points].reverse(), durationMs: 1600, hue: c.statusWarning, icon: "ShieldAlert", text: text("needs permission") }));
      return out;
    }
    case "tool": {
      const place = agent ?? brain;
      if (!place || !e.activity) return [];
      if (nowMs - (ctx.lastToolAt.get(e.agentId) ?? 0) < TOOL_POP_GAP_MS) return [];
      ctx.lastToolAt.set(e.agentId, nowMs);
      return [packet({ points: toolPath(e.activity.kind, place.x, place.y), durationMs: 950, hue: activityHue(c, e.activity.kind), icon: ACTIVITY_ICON[e.activity.kind], text: "", small: true })];
    }
    case "handoff": {
      const to = fileAnchor(layout, e.agentId);
      const from = e.peerId ? (fileAnchor(layout, e.peerId) ?? ctx.lastPos.get(e.peerId) ?? null) : null;
      if (!to || !from) return [];
      const kind = e.activity?.kind;
      const conflict = isWriteConflict(e.peerOp, kind);
      const hue = conflict ? c.statusDanger : activityHue(c, kind ?? "read");
      const icon = conflict ? "TriangleAlert" : /^\d+ files:/.test(e.text) ? "Files" : FILE_OP_ICON[kind === "edit" || kind === "write" ? kind : "read"];
      const dist = Math.hypot(to.x - from.x, to.y - from.y);
      const out: Effect[] = [packet({ points: arc(from, to), durationMs: Math.min(2000, Math.max(900, 700 + dist * 0.8)), hue, icon, text: clip(e.text, 30) }, { x: to.x, y: to.y, r: 14, hue })];
      if (conflict) out.push({ id: nextEffectId(), type: "burst", x: from.x, y: from.y, r: 16, hue: c.statusDanger });
      return out;
    }
    default:
      return [];
  }
}
