// No upstream: written for the agent states of the office (the original states mapped onto the ported poses).
// The mood of each drawn agent on the scene beat: needs you (permission or attention), working, waiting on shell with its escalation
// and its celebration, idle and dozing. Pure and deterministic: the caller passes the beat; no React, no SDK, no timer, no clock read.
import { DIRS, type Dir, type Pose } from "../shared/art-types.ts";
import type { AttentionReason, AgentStatus, ShellView, ToolKind } from "../shared/model-types.ts";
import { activityGlyph } from "./activity.ts";
import { SCENE_BEAT_MS } from "./camera.ts";
import { CELEBRATE_MS, IDLE_DOZE_MS, SHELL_BORED_MS, SHELL_COBWEB_MS, SHELL_DOZE_MS, SPIN_EVERY_MS, SPIN_MS } from "./limits-life.ts";
import type { StringKey } from "./strings.ts";

const beatsOf = (ms: number): number => Math.max(1, Math.round(ms / SCENE_BEAT_MS));

export const SHELL_BORED_BEATS = beatsOf(SHELL_BORED_MS);
export const SHELL_COBWEB_BEATS = beatsOf(SHELL_COBWEB_MS);
export const SHELL_DOZE_BEATS = beatsOf(SHELL_DOZE_MS);
export const IDLE_DOZE_BEATS = beatsOf(IDLE_DOZE_MS);
export const CELEBRATE_BEATS = beatsOf(CELEBRATE_MS);
const SPIN_EVERY_BEATS = beatsOf(SPIN_EVERY_MS);
const SPIN_BEATS = Math.min(beatsOf(SPIN_MS), SPIN_EVERY_BEATS);

export type MoodKind = "none" | "idle" | "working" | "permission" | "attention" | "shell" | "celebrate" | "failed" | "doze";

export interface MoodInput {
  agentId: string;
  status: AgentStatus;
  pendingPermissions: number;
  requiresAttention: boolean;
  attentionReason: AttentionReason | null;
  shell: ShellView | null;
  lastTool: ToolKind | null;
  activity: "reasoning" | "tool" | "message" | null;
  // A journey is running (the agent walks), so it cannot doze now.
  moving: boolean;
}

export interface MoodEntry {
  kind: MoodKind;
  // Beat the kind started.
  since: number;
  // The waited-on shell call (kind shell, celebrate, failed).
  callId: string | null;
  // Last beat of a celebration or a failure.
  until: number | null;
  // Beat the agent became idle (kind idle).
  idleSince: number | null;
}

export type MoodBook = ReadonlyMap<string, MoodEntry>;

export interface MoodLook {
  kind: MoodKind;
  // Pose that replaces the pose of the status, or null.
  pose: Pose | null;
  glyphs: StringKey[];
  // The alert blinks (a permission request).
  blink: boolean;
  // A softer bubble: waiting for the owner without a permission request.
  soft: boolean;
  // Stays at its seat: no outing starts while the mood holds.
  still: boolean;
  // Direction of a chair spin on this beat, or null.
  spinDir: Dir | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function readInput(raw: unknown): MoodInput | null {
  if (!isRecord(raw) || typeof raw.agentId !== "string") return null;
  const shell = isRecord(raw.shell) && typeof raw.shell.callId === "string" ? (raw.shell as unknown as ShellView) : null;
  return {
    agentId: raw.agentId,
    status: raw.status as AgentStatus,
    pendingPermissions: typeof raw.pendingPermissions === "number" && Number.isFinite(raw.pendingPermissions) ? raw.pendingPermissions : 0,
    requiresAttention: raw.requiresAttention === true,
    attentionReason: (raw.attentionReason ?? null) as AttentionReason | null,
    shell,
    lastTool: (raw.lastTool ?? null) as ToolKind | null,
    activity: (raw.activity ?? null) as MoodInput["activity"],
    moving: raw.moving === true,
  };
}

// The kind the official values ask for, before any memory: permission, then waiting on shell, then attention, working, idle.
function baseKind(input: MoodInput): MoodKind {
  if (input.pendingPermissions > 0 || (input.requiresAttention && input.attentionReason === "permission")) return "permission";
  if (input.status === "idle" && input.shell !== null && input.shell.status === "running") return "shell";
  if (input.requiresAttention) return "attention";
  if (input.status === "running") return "working";
  if (input.status === "idle") return "idle";
  return "none";
}

const entry = (kind: MoodKind, since: number, over: Partial<MoodEntry> = {}): MoodEntry => ({ kind, since, callId: null, until: null, idleSince: null, ...over });

function nextEntry(prev: MoodEntry | undefined, input: MoodInput, beat: number, celebrations: { agentId: string; callId: string }[]): MoodEntry {
  const target = baseKind(input);
  if (target === "permission") return prev?.kind === "permission" ? prev : entry("permission", beat);
  if (target === "shell") {
    const callId = (input.shell as ShellView).callId;
    return prev?.kind === "shell" && prev.callId === callId ? prev : entry("shell", beat, { callId });
  }
  // The waited-on call ended: a cheer with confetti when it completed, a sulk when it failed or was cancelled.
  if (prev?.kind === "shell" && prev.callId !== null && input.shell !== null && input.shell.callId === prev.callId && input.shell.status !== null && input.shell.status !== "running") {
    if (input.shell.status === "completed") {
      celebrations.push({ agentId: input.agentId, callId: prev.callId });
      return entry("celebrate", beat, { callId: prev.callId, until: beat + CELEBRATE_BEATS });
    }
    return entry("failed", beat, { callId: prev.callId, until: beat + CELEBRATE_BEATS });
  }
  if ((prev?.kind === "celebrate" || prev?.kind === "failed") && prev.until !== null && beat <= prev.until) return prev;
  if (target === "idle") {
    if (prev?.kind === "doze") return prev;
    const idleSince = prev?.kind === "idle" && prev.idleSince !== null ? prev.idleSince : beat;
    if (!input.moving && beat - idleSince >= IDLE_DOZE_BEATS) return entry("doze", beat);
    return prev?.kind === "idle" ? prev : entry("idle", beat, { idleSince });
  }
  return prev?.kind === target ? prev : entry(target, beat);
}

// One beat of every agent's mood; agents absent from the inputs are dropped, so the book stays bounded by the drawn characters.
export function stepMoods(book: MoodBook | null, inputs: readonly unknown[], beat: number): { book: Map<string, MoodEntry>; celebrations: { agentId: string; callId: string }[] } {
  const prev = book instanceof Map ? book : new Map<string, MoodEntry>();
  const out = new Map<string, MoodEntry>();
  const celebrations: { agentId: string; callId: string }[] = [];
  const at = Number.isFinite(beat) ? beat : 0;
  for (const raw of Array.isArray(inputs) ? inputs : []) {
    const input = readInput(raw);
    if (input === null || out.has(input.agentId)) continue;
    out.set(input.agentId, nextEntry(prev.get(input.agentId), input, at, celebrations));
  }
  return { book: out, celebrations };
}

const look = (kind: MoodKind, over: Partial<MoodLook> = {}): MoodLook => ({ kind, pose: null, glyphs: [], blink: false, soft: false, still: false, spinDir: null, ...over });

// What the mood draws on a beat: a pose override, the glyphs above the head, the blink and the chair spin.
export function moodLook(current: MoodEntry | undefined, raw: unknown, beat: number): MoodLook {
  const input = readInput(raw);
  const at = Number.isFinite(beat) ? beat : 0;
  const kind = current?.kind ?? (input === null ? "none" : baseKind(input));
  const since = current?.since ?? at;
  switch (kind) {
    case "permission":
      return look(kind, { pose: "raise_hand", glyphs: ["glyphAlert"], blink: true });
    case "attention":
      return look(kind, { glyphs: ["glyphNotice"], soft: true });
    case "working": {
      const glyph = activityGlyph(input);
      return look(kind, { glyphs: glyph === null ? [] : [glyph] });
    }
    case "shell": {
      const waited = at - since;
      if (waited < SHELL_BORED_BEATS) return look(kind, { pose: "wait", glyphs: ["glyphHourglass", "glyphPopcorn"], still: true });
      if (waited < SHELL_COBWEB_BEATS) {
        const spinning = (waited - SHELL_BORED_BEATS) % SPIN_EVERY_BEATS < SPIN_BEATS;
        return look(kind, { pose: "wait", glyphs: ["glyphHourglass"], still: true, spinDir: spinning ? DIRS[((at % DIRS.length) + DIRS.length) % DIRS.length] : null });
      }
      if (waited < SHELL_DOZE_BEATS) return look(kind, { pose: "wait", glyphs: ["glyphHourglass", "glyphCobweb"], still: true });
      return look(kind, { pose: "sleep", glyphs: ["glyphHourglass", "glyphZzz"], still: true });
    }
    case "celebrate":
      return look(kind, { pose: "cheer", glyphs: ["glyphParty"], still: true });
    case "failed":
      return look(kind, { pose: "sulk", glyphs: ["glyphStorm"], still: true });
    case "doze":
      return look(kind, { pose: "sleep", glyphs: ["glyphZzz"], still: true });
    default:
      return look(kind);
  }
}

// A text that changes exactly when something drawn changes, so the screen re-renders only then.
export function moodSignature(looks: ReadonlyMap<string, MoodLook>): string {
  const parts: string[] = [];
  for (const [id, l] of looks) parts.push(`${id}:${l.kind}:${l.pose ?? "-"}:${l.glyphs.join(",")}:${l.spinDir ?? "-"}`);
  return parts.join("|");
}
