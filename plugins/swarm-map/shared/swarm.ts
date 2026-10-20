// Read-only swarm snapshot contract (PANL-03, PANL-24, PANL-25): the daemon side builds it, the surface draws it.
// Agents, labels and titles are the ones `ph` stamps: `paseo.parent-agent-id` (brain link), `ph.swarm` (group),
// `harness.run` (workflow run, PANL-61).
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const agentStatusSchema = z.enum(["initializing", "idle", "running", "error", "closed"]);
export type AgentStatus = z.infer<typeof agentStatusSchema>;

export const ACTIVITY_KINDS = [
  "read",
  "edit",
  "write",
  "shell",
  "search",
  "fetch",
  "agent",
  "plan",
  "think",
  "command",
  "reply",
  "tool",
] as const;
export const activityKindSchema = z.enum(ACTIVITY_KINDS);
export type ActivityKind = z.infer<typeof activityKindSchema>;

export const activitySchema = z.object({
  // Tool callId, or "<item type>:<seqStart>" for messages (PANL-35).
  id: z.string(),
  kind: activityKindSchema,
  label: z.string(),
  detail: z.string(),
  status: z.enum(["running", "completed", "failed", "canceled"]),
  at: z.string(),
  files: z.array(z.string()),
});
export type Activity = z.infer<typeof activitySchema>;

export const fileOpSchema = z.enum(["read", "edit", "write"]);
export type FileOp = z.infer<typeof fileOpSchema>;

export const fileHoldSchema = z.object({
  path: z.string(),
  name: z.string(),
  op: fileOpSchema,
  agentId: z.string(),
  at: z.string(),
  prevAgentId: z.string().nullable(),
  prevOp: fileOpSchema.nullable(),
  writers: z.number(),
});
export type FileHold = z.infer<typeof fileHoldSchema>;

const messageSchema = z.object({ text: z.string(), at: z.string() });
export type AgentMessage = z.infer<typeof messageSchema>;

export const swarmAgentSchema = z.object({
  id: z.string(),
  title: z.string(),
  model: z.string(),
  thinking: z.string().nullable(),
  mode: z.string().nullable(),
  status: agentStatusSchema,
  contextPct: z.number().nullable(),
  usedTokens: z.number().nullable(),
  maxTokens: z.number().nullable(),
  // The `ph context` ROTATE threshold of the agent's project (PANL-55); null when no config could be read.
  rotatePct: z.number().nullable(),
  attention: z.enum(["finished", "error", "permission"]).nullable(),
  parentId: z.string().nullable(),
  // The `ph.swarm` label, null when the agent has none.
  swarm: z.string().nullable(),
  project: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  turnStartedAt: z.string().nullable(),
  activity: activitySchema.nullable(),
  heldFiles: z.number(),
});
export type SwarmAgent = z.infer<typeof swarmAgentSchema>;

export const waveLinkSchema = z.object({
  phase: z.string(),
  wave: z.number().nullable(),
  plansDone: z.number().nullable(),
  plansTotal: z.number().nullable(),
  scope: z.enum(["complete", "truncated", "unreadable"]),
});
export type WaveLink = z.infer<typeof waveLinkSchema>;

export const swarmGroupSchema = z.object({
  name: z.string(),
  agents: z.array(swarmAgentSchema),
  // `.planning` wave progress of the group's workflow run, null = unlinked (PANL-61).
  wave: waveLinkSchema.nullable(),
});
export type SwarmGroup = z.infer<typeof swarmGroupSchema>;

export const brainSchema = z.object({
  // null = orphan bucket: subagents whose parent is archived, missing or unreadable.
  agent: swarmAgentSchema.nullable(),
  groups: z.array(swarmGroupSchema),
});
export type Brain = z.infer<typeof brainSchema>;

export const SWARM_EVENT_KINDS = [
  "spawn",
  "archive",
  "command",
  "report",
  "failed",
  "canceled",
  "permission",
  "permission_resolved",
  "tool",
  "handoff",
] as const;
export const swarmEventKindSchema = z.enum(SWARM_EVENT_KINDS);
export type SwarmEventKind = z.infer<typeof swarmEventKindSchema>;

export const swarmEventSchema = z.object({
  seq: z.number(),
  at: z.string(),
  kind: swarmEventKindSchema,
  agentId: z.string(),
  parentId: z.string().nullable(),
  title: z.string(),
  text: z.string(),
  // Turn summary for report/failed/canceled ("12 read · 3 edit · 2 shell"), "" otherwise.
  stats: z.string(),
  activity: activitySchema.nullable(),
  // handoff only: first file, previous holder and its strongest op (PANL-39).
  path: z.string().nullable(),
  peerId: z.string().nullable(),
  peerOp: fileOpSchema.nullable(),
});
export type SwarmEvent = z.infer<typeof swarmEventSchema>;

// Typed failure envelope (PANL-04); swarm RPCs never resolve a directory.
export const SWARM_ERROR_CODES = ["not_found", "failed"] as const;
export const swarmFailureSchema = z.object({
  ok: z.literal(false),
  code: z.enum(SWARM_ERROR_CODES),
  message: z.string(),
  directory: z.null(),
});
export type SwarmFailure = z.infer<typeof swarmFailureSchema>;

export const snapshotSchema = z.object({
  ok: z.literal(true),
  generatedAt: z.string(),
  brains: z.array(brainSchema),
  standaloneCount: z.number(),
  eventEpoch: z.string(),
  files: z.array(fileHoldSchema),
  events: z.array(swarmEventSchema),
  lastSeq: z.number(),
  errors: z.array(z.string()),
});
export type SwarmSnapshot = z.infer<typeof snapshotSchema>;

export const snapshotInputSchema = z.object({
  recentHours: z.number().min(0),
  afterSeq: z.number().int(),
  eventEpoch: z.string().nullable(),
});
export type SnapshotInput = z.infer<typeof snapshotInputSchema>;

export const swarmSnapshotRpc = defineRpc({
  name: "swarm.snapshot",
  input: snapshotInputSchema,
  output: z.discriminatedUnion("ok", [snapshotSchema, swarmFailureSchema]),
});

export const agentDetailSchema = z.object({
  ok: z.literal(true),
  recent: z.array(activitySchema),
  lastCommand: messageSchema.nullable(),
  lastReply: messageSchema.nullable(),
});
export type AgentDetail = z.infer<typeof agentDetailSchema>;

export const agentDetailRpc = defineRpc({
  name: "swarm.agent-detail",
  input: z.object({ agentId: z.string() }),
  output: z.discriminatedUnion("ok", [agentDetailSchema, swarmFailureSchema]),
});

export const SWARM_RPCS = [swarmSnapshotRpc, agentDetailRpc] as const;
