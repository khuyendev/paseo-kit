// Read-only `.planning/` contracts (PANL-03, PANL-04, PANL-12..16): the daemon side reads the workspace's GSD
// files with node:fs, the panel draws them. Every RPC takes {workspaceId} and answers an ok:true payload or a
// typed failure envelope.
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const PLANNING_ERROR_CODES = ["no_planning", "unreadable", "parse_error", "not_found", "failed"] as const;
export type PlanningErrorCode = (typeof PLANNING_ERROR_CODES)[number];

export const failureSchema = z.object({
  ok: z.literal(false),
  code: z.enum(PLANNING_ERROR_CODES),
  message: z.string(),
  directory: z.string().nullable(),
});
export type PlanningFailure = z.infer<typeof failureSchema>;

export const scopeSchema = z.enum(["complete", "truncated", "unreadable"]);
export type Scope = z.infer<typeof scopeSchema>;

// GSD artifact kinds by filename (GSDC-06) plus the top-level files of the adopted tree (GSDC-01).
export const FILE_KINDS = [
  "plan",
  "summary",
  "context",
  "research",
  "verification",
  "uat",
  "plan-outline",
  "wiring",
  "outline-review",
  "project",
  "requirements",
  "roadmap",
  "state",
  "continue-here",
  "debug",
  "quick",
  "codebase",
  "other",
] as const;
export const fileKindSchema = z.enum(FILE_KINDS);
export type FileKind = z.infer<typeof fileKindSchema>;

// The GSDC-13 phase status ladder, in board column order.
export const PHASE_STATUSES = ["NOT_STARTED", "PLANNED", "IN_PROGRESS", "EXECUTED", "NEEDS_REVIEW", "COMPLETE"] as const;
export const phaseStatusSchema = z.enum(PHASE_STATUSES);
export type PhaseStatus = z.infer<typeof phaseStatusSchema>;

// Plan-level completion from its SUMMARY `status`: absent status counts as done; halted/failed do not (GSDC-13).
export function summaryDone(status: string | null): boolean {
  return status === null || !/^(halted|failed)$/i.test(status.trim());
}

export type Tone = "muted" | "accent" | "warning" | "danger" | "success";
export const STATUS_TONE: Record<PhaseStatus, Tone> = {
  NOT_STARTED: "muted",
  PLANNED: "accent",
  IN_PROGRESS: "accent",
  EXECUTED: "warning",
  NEEDS_REVIEW: "danger",
  COMPLETE: "success",
};
export const STATUS_LABEL: Record<PhaseStatus, string> = {
  NOT_STARTED: "Not started",
  PLANNED: "Planned",
  IN_PROGRESS: "In progress",
  EXECUTED: "Executed",
  NEEDS_REVIEW: "Needs review",
  COMPLETE: "Complete",
};

export const indexFileSchema = z.object({
  // Relative to `.planning/`, with `/`.
  path: z.string(),
  kind: fileKindSchema,
  mtimeMs: z.number(),
  title: z.string(),
  // Phase id from `phases/<NN>-<slug>/` ("01", "02.1"), plan id "<NN>-<MM>" for per-plan artifacts.
  phase: z.string().nullable(),
  planId: z.string().nullable(),
  wave: z.number().nullable(),
  dependsOn: z.array(z.string()),
  // PLAN `requirements` ids (links in rendered markdown, PANL-18).
  requirements: z.array(z.string()),
  // SUMMARY `status` (e.g. complete, halted); null when absent.
  status: z.string().nullable(),
  error: z.object({ message: z.string(), line: z.number() }).nullable(),
});
export type IndexFile = z.infer<typeof indexFileSchema>;

export const indexPhaseSchema = z.object({
  id: z.string(),
  dir: z.string(),
  name: z.string(),
  status: phaseStatusSchema.nullable(),
});
export type IndexPhase = z.infer<typeof indexPhaseSchema>;

const workspaceInput = z.object({ workspaceId: z.string() });

export const indexSchema = z.object({
  ok: z.literal(true),
  workspaceId: z.string(),
  directory: z.string(),
  scope: scopeSchema,
  // Files counted under `.planning/` (beyond the cap when truncated).
  total: z.number(),
  unreadable: z.string().nullable(),
  // Why phase statuses are missing (the GSD status module could not be loaded or failed), else null.
  statusError: z.string().nullable(),
  files: z.array(indexFileSchema),
  phases: z.array(indexPhaseSchema),
});
export type PlanningIndex = z.infer<typeof indexSchema>;

export const planningIndexRpc = defineRpc({
  name: "planning.index",
  input: workspaceInput,
  output: z.discriminatedUnion("ok", [indexSchema, failureSchema]),
});

export const waveSchema = z.object({ wave: z.number().nullable(), total: z.number(), done: z.number(), pct: z.number().nullable() });

export const boardPhaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  dir: z.string(),
  status: phaseStatusSchema.nullable(),
  plans: z.number(),
  summaries: z.number(),
  done: z.number(),
  pct: z.number().nullable(),
  waves: z.array(waveSchema),
});
export type BoardPhase = z.infer<typeof boardPhaseSchema>;

export const boardSchema = z.object({
  ok: z.literal(true),
  workspaceId: z.string(),
  directory: z.string(),
  scope: scopeSchema,
  statusError: z.string().nullable(),
  columns: z.array(z.object({ status: phaseStatusSchema, phases: z.array(boardPhaseSchema) })),
  // Phases whose status is unknown (statusError set).
  unsorted: z.array(boardPhaseSchema),
});
export type Board = z.infer<typeof boardSchema>;

export const planningBoardRpc = defineRpc({
  name: "planning.board",
  input: workspaceInput,
  output: z.discriminatedUnion("ok", [boardSchema, failureSchema]),
});

const yamlValue: z.ZodType<unknown> = z.unknown();
const stringList = z
  .union([z.array(z.unknown()), z.string(), z.number()])
  .nullish()
  .transform((v) => (v === null || v === undefined ? [] : (Array.isArray(v) ? v : [v]).filter((x) => x !== null && x !== undefined).map(String)));

// PLAN frontmatter with tolerant defaults (PANL-14): missing optional keys never drop the plan.
export const planFrontmatterSchema = z
  .object({
    wave: z.union([z.number(), z.string()]).nullish().transform((v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v))),
    depends_on: stringList,
    files_modified: stringList,
    requirements: stringList,
    type: z.unknown().nullish().transform((v) => (v === null || v === undefined ? null : String(v))),
    autonomous: z.unknown().nullish().transform((v) => (typeof v === "boolean" ? v : null)),
    must_haves: yamlValue.nullish().transform((v) => v ?? null),
  })
  .passthrough();

export const propertySchema = z.object({ key: z.string(), value: z.string() });

export const taskSchema = z.object({ name: z.string(), type: z.string().nullable(), files: z.array(z.string()) });

export const planDetailSchema = z.object({
  ok: z.literal(true),
  workspaceId: z.string(),
  directory: z.string(),
  planId: z.string(),
  path: z.string(),
  phase: z.string(),
  goal: z.string().nullable(),
  wave: z.number().nullable(),
  dependsOn: z.array(z.string()),
  filesModified: z.array(z.string()),
  requirements: z.array(z.string()),
  mustHaves: yamlValue,
  tasks: z.array(taskSchema),
  properties: z.array(propertySchema),
  // Plan-level completion from its SUMMARY; per-task completion is not recorded by any artifact (PANL-16).
  summary: z
    .object({
      path: z.string(),
      status: z.string().nullable(),
      done: z.boolean(),
      text: z.string(),
      keyFiles: z.object({ created: z.array(z.string()), modified: z.array(z.string()) }),
    })
    .nullable(),
});
export type PlanDetail = z.infer<typeof planDetailSchema>;

export const planningPlanRpc = defineRpc({
  name: "planning.plan",
  input: z.object({ workspaceId: z.string(), planId: z.string() }),
  output: z.discriminatedUnion("ok", [planDetailSchema, failureSchema]),
});

export const fileDetailSchema = z.object({
  ok: z.literal(true),
  workspaceId: z.string(),
  directory: z.string(),
  path: z.string(),
  kind: fileKindSchema,
  mtimeMs: z.number(),
  frontmatter: yamlValue,
  properties: z.array(propertySchema),
  error: z.object({ message: z.string(), line: z.number() }).nullable(),
  body: z.string(),
  truncated: z.boolean(),
});
export type FileDetail = z.infer<typeof fileDetailSchema>;

export const planningFileRpc = defineRpc({
  name: "planning.file",
  input: z.object({ workspaceId: z.string(), path: z.string() }),
  output: z.discriminatedUnion("ok", [fileDetailSchema, failureSchema]),
});

export const PLANNING_RPCS = [planningIndexRpc, planningBoardRpc, planningPlanRpc, planningFileRpc] as const;
