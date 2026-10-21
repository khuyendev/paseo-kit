// office.wave contract (OFFC-03, OFFC-18): the client names a workspace and a run by id; the server finds the directory itself.
// No path, directory or free text crosses this contract in either direction; every failure is a typed envelope.
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

// The label key `ph` stamps on a kit run's agents; defined here because the client cannot import server/.
export const RUN_LABEL = "harness.run";

export const WAVE_WORKSPACE_ID_MAX_CHARS = 200;
export const WAVE_RUN_ID_MAX_CHARS = 96;
// A letter or digit first, then letters, digits, dot, underscore or hyphen: no separator, no leading dot, no space.
export const WAVE_RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const WAVE_SCOPES = ["complete", "unreadable"] as const;
export const WAVE_ERROR_CODES = ["bad_input", "not_found", "failed"] as const;

export const waveLinkSchema = z.object({
  phase: z.string(),
  wave: z.number().nullable(),
  plansDone: z.number().nullable(),
  plansTotal: z.number().nullable(),
  scope: z.enum(WAVE_SCOPES),
});
export type WaveLink = z.infer<typeof waveLinkSchema>;

// The id length and character checks are done by the handler, not the schema, so a bad value gets an envelope.
export const waveRpc = defineRpc({
  name: "office.wave",
  input: z.object({ workspaceId: z.string(), runId: z.string() }),
  output: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), link: waveLinkSchema.nullable() }),
    z.object({ ok: z.literal(false), code: z.enum(WAVE_ERROR_CODES), message: z.string() }),
  ]),
});

export type WaveInput = z.infer<typeof waveRpc.input>;
export type WaveOutput = z.infer<typeof waveRpc.output>;
