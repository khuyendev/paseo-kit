// Colours and icons of the swarm map (PANL-06, PANL-53). Text colours come only from theme.colors; the fixed
// hues below are decorative (dots, rings, glows, packet borders). statusWarning is reserved for permission and the
// context threshold, statusDanger for errors and write conflicts, statusSuccess for running work and reports.
// Icons are lucide names resolved by the host's Icon component (PANL-10 smoke script checks them).
import type { PluginTheme } from "@getpaseo/plugin";
import type { ActivityKind, FileOp, SwarmAgent, SwarmEventKind } from "../shared/swarm.ts";

export type Colors = PluginTheme["colors"];

export const DECOR = {
  prompt: "#7AA2F7",
  spawn: "#BB9AF7",
  read: "#7DCFFF",
  search: "#2AC3DE",
  edit: "#E0AF68",
  write: "#FF9E64",
  shell: "#73DACA",
  plan: "#D4B062",
} as const;

// Decorative hue of an activity kind (never used for text).
export function activityHue(c: Colors, kind: ActivityKind): string {
  switch (kind) {
    case "read":
    case "fetch":
      return DECOR.read;
    case "edit":
      return DECOR.edit;
    case "write":
      return DECOR.write;
    case "shell":
      return DECOR.shell;
    case "search":
      return DECOR.search;
    case "agent":
      return DECOR.spawn;
    case "plan":
      return DECOR.plan;
    case "command":
      return DECOR.prompt;
    case "reply":
      return c.statusSuccess;
    default:
      return c.foregroundMuted;
  }
}

export const ACTIVITY_ICON: Record<ActivityKind, string> = {
  read: "FileText",
  edit: "FilePen",
  write: "FilePlus2",
  shell: "SquareTerminal",
  search: "Search",
  fetch: "Globe",
  agent: "Bot",
  plan: "ListTodo",
  think: "Sparkles",
  command: "Send",
  reply: "MessageSquareText",
  tool: "Wrench",
};

// Present tense while running, past tense once finished.
export const ACTIVITY_VERB: Record<ActivityKind, [string, string]> = {
  read: ["reading", "read"],
  edit: ["editing", "edited"],
  write: ["writing", "wrote"],
  shell: ["running", "ran"],
  search: ["searching", "searched"],
  fetch: ["fetching", "fetched"],
  agent: ["delegating", "delegated"],
  plan: ["planning", "planned"],
  think: ["thinking", "thought"],
  command: ["got prompt", "got prompt"],
  reply: ["replying", "replied"],
  tool: ["using", "used"],
};

// PANL-47: what the map shows for an agent.
export type AgentState = "working" | "waiting" | "error" | "sleep";

export function agentState(a: Pick<SwarmAgent, "status" | "attention">): AgentState {
  if (a.attention === "permission") return "waiting";
  if (a.status === "error" || a.attention === "error") return "error";
  if (a.status === "running" || a.status === "initializing") return "working";
  return "sleep";
}

export const STATE_LABEL: Record<AgentState, string> = {
  working: "running",
  waiting: "waiting for permission",
  error: "error",
  sleep: "sleep",
};

export const STATE_ICON: Record<AgentState, string> = {
  working: "Activity",
  waiting: "ShieldAlert",
  error: "CircleX",
  sleep: "Moon",
};

export function stateColor(c: Colors, state: AgentState): string {
  switch (state) {
    case "waiting":
      return c.statusWarning;
    case "error":
      return c.statusDanger;
    case "working":
      return c.statusSuccess;
    default:
      return c.foregroundMuted;
  }
}

export const EVENT_ICON: Record<SwarmEventKind, string> = {
  spawn: "Rocket",
  archive: "Archive",
  command: "Send",
  report: "CircleCheck",
  failed: "CircleX",
  canceled: "CircleX",
  permission: "ShieldAlert",
  permission_resolved: "ShieldCheck",
  tool: "Wrench",
  handoff: "ArrowRightLeft",
};

export function eventHue(c: Colors, kind: SwarmEventKind): string {
  switch (kind) {
    case "spawn":
      return DECOR.spawn;
    case "command":
      return DECOR.prompt;
    case "report":
      return c.statusSuccess;
    case "failed":
    case "canceled":
      return c.statusDanger;
    case "permission":
    case "permission_resolved":
      return c.statusWarning;
    default:
      return c.foregroundMuted;
  }
}

export const FILE_OP_ICON: Record<FileOp, string> = { read: "FileText", edit: "FilePen", write: "FilePlus2" };

// PANL-39: a previous edit/write followed by an edit/write is a write conflict.
export function isWriteConflict(prevOp: FileOp | null, op: FileOp | ActivityKind | null | undefined): boolean {
  return prevOp !== null && prevOp !== "read" && (op === "edit" || op === "write");
}

export interface LegendRow {
  icon: string;
  hue: (c: Colors) => string;
  text: string;
}

// Every icon the map draws, with its meaning (PANL-53).
export const LEGEND: readonly LegendRow[] = [
  { icon: "BrainCircuit", hue: (c) => c.foregroundMuted, text: "brain: the agent that spawned the swarms" },
  { icon: "Ghost", hue: (c) => c.foregroundMuted, text: "orphans (parent archived or missing), or an agent that is gone" },
  { icon: STATE_ICON.working, hue: (c) => c.statusSuccess, text: "running (halo, particles on its link)" },
  { icon: "LoaderCircle", hue: (c) => c.statusSuccess, text: "initializing" },
  { icon: STATE_ICON.sleep, hue: (c) => c.foregroundMuted, text: "sleep: not doing anything" },
  { icon: STATE_ICON.waiting, hue: (c) => c.statusWarning, text: "waiting for permission" },
  { icon: STATE_ICON.error, hue: (c) => c.statusDanger, text: "error" },
  { icon: EVENT_ICON.command, hue: () => DECOR.prompt, text: "prompt flying brain → agent" },
  { icon: EVENT_ICON.report, hue: (c) => c.statusSuccess, text: "report flying agent → brain" },
  { icon: EVENT_ICON.spawn, hue: () => DECOR.spawn, text: "spawned agent (sparks, NEW badge)" },
  { icon: EVENT_ICON.archive, hue: (c) => c.foregroundMuted, text: "archived agent fades out" },
  { icon: EVENT_ICON.permission_resolved, hue: (c) => c.statusWarning, text: "permission answered" },
  { icon: ACTIVITY_ICON.read, hue: () => DECOR.read, text: "file read" },
  { icon: ACTIVITY_ICON.edit, hue: () => DECOR.edit, text: "file edit" },
  { icon: ACTIVITY_ICON.write, hue: () => DECOR.write, text: "file write" },
  { icon: "Files", hue: () => DECOR.read, text: "several files in one call" },
  { icon: ACTIVITY_ICON.shell, hue: () => DECOR.shell, text: "command run" },
  { icon: ACTIVITY_ICON.search, hue: () => DECOR.search, text: "search" },
  { icon: ACTIVITY_ICON.fetch, hue: () => DECOR.read, text: "fetch a URL" },
  { icon: ACTIVITY_ICON.agent, hue: () => DECOR.spawn, text: "sub-agent" },
  { icon: ACTIVITY_ICON.plan, hue: () => DECOR.plan, text: "plan / todo update" },
  { icon: ACTIVITY_ICON.think, hue: (c) => c.foregroundMuted, text: "thinking or compacting" },
  { icon: ACTIVITY_ICON.reply, hue: (c) => c.statusSuccess, text: "reply written" },
  { icon: ACTIVITY_ICON.tool, hue: (c) => c.foregroundMuted, text: "other tool" },
  { icon: EVENT_ICON.handoff, hue: () => DECOR.read, text: "file flies to the agent that touches it next" },
  { icon: "TriangleAlert", hue: (c) => c.statusDanger, text: "red file: two agents edited or wrote it" },
  { icon: "Gauge", hue: (c) => c.statusWarning, text: "context at or above the project's ph context ROTATE threshold" },
];
