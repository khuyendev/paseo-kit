// office.sprites contract (OFFC-03, OFFC-08): the client asks for sprites by enumerated key, the server answers PNG data URIs.
// The input is a closed key grammar, never a path or free text; every failure is a typed envelope.
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { POSE_NAMES, ZOOM_CANDIDATES, type Pose, type ZoomCandidate } from "./art-types.ts";

// Later plans only add entries here and to SPRITE_REGISTRY, never change the shape.
export const SPRITE_KINDS = ["ruler"] as const;
export type SpriteKind = (typeof SPRITE_KINDS)[number];

// Pose part of a key that carries no poses.
export const NO_POSES = "-";
export const SPRITE_SEED_MAX_CHARS = 64;
export const SPRITE_KEY_MAX_CHARS = 96;
// The client batches by this number, so it lives in the shared contract.
export const SPRITE_KEYS_PER_CALL_MAX = 16;
export const SPRITE_TINT_INDEX_MAX = 4;

export const SPRITE_ERROR_CODES = ["bad_key", "unknown_kind", "render_failed", "too_large"] as const;
export const CALL_ERROR_CODES = ["bad_input", "too_many_keys", "internal"] as const;

export interface SpriteSpec {
  kind: SpriteKind;
  seed: string;
  poses: readonly Pose[];
  scale: ZoomCandidate;
  tint: number;
}

export type SpriteKey = string & { readonly __spriteKey?: never };

const SEED_RE = /^[A-Za-z0-9_-]+$/;

function isKind(v: string): v is SpriteKind {
  return (SPRITE_KINDS as readonly string[]).includes(v);
}

function isZoom(v: number): v is ZoomCandidate {
  return (ZOOM_CANDIDATES as readonly number[]).includes(v);
}

// Canonical pose text: unique names in POSE_NAMES order joined by "+", or NO_POSES for an empty set.
function posesText(poses: readonly Pose[]): string {
  if (poses.length === 0) return NO_POSES;
  const wanted = new Set<string>(poses);
  return POSE_NAMES.filter((name) => wanted.has(name)).join("+");
}

// Builds the canonical key text kind:seed:poses:scale:tint; throws RangeError naming the bad field.
export function spriteKey(spec: SpriteSpec): SpriteKey {
  if (!isKind(spec.kind)) throw new RangeError("kind");
  if (typeof spec.seed !== "string" || spec.seed.length > SPRITE_SEED_MAX_CHARS || !SEED_RE.test(spec.seed)) throw new RangeError("seed");
  if (!Array.isArray(spec.poses) || spec.poses.some((p) => !(POSE_NAMES as readonly string[]).includes(p))) throw new RangeError("poses");
  if (!isZoom(spec.scale)) throw new RangeError("scale");
  if (!Number.isInteger(spec.tint) || spec.tint < 0 || spec.tint > SPRITE_TINT_INDEX_MAX) throw new RangeError("tint");
  const key = [spec.kind, spec.seed, posesText(spec.poses), String(spec.scale), String(spec.tint)].join(":");
  if (key.length > SPRITE_KEY_MAX_CHARS) throw new RangeError("key");
  return key as SpriteKey;
}

// Never throws: the spec, or null when the text is not exactly a canonical key.
export function parseSpriteKey(key: string): SpriteSpec | null {
  if (typeof key !== "string" || key.length > SPRITE_KEY_MAX_CHARS) return null;
  const parts = key.split(":");
  if (parts.length !== 5) return null;
  const [kind, seed, posesPart, scalePart, tintPart] = parts as [string, string, string, string, string];
  if (!isKind(kind)) return null;
  if (seed.length > SPRITE_SEED_MAX_CHARS || !SEED_RE.test(seed)) return null;
  let poses: Pose[] = [];
  if (posesPart !== NO_POSES) {
    const names = posesPart.split("+");
    if (names.some((n) => !(POSE_NAMES as readonly string[]).includes(n))) return null;
    poses = names as Pose[];
    if (posesText(poses) !== posesPart) return null;
  }
  if (!/^\d+$/.test(scalePart) || !/^\d+$/.test(tintPart)) return null;
  const scale = Number(scalePart);
  const tint = Number(tintPart);
  if (!isZoom(scale) || tint > SPRITE_TINT_INDEX_MAX) return null;
  const spec: SpriteSpec = { kind, seed, poses, scale, tint };
  return spriteKey(spec) === key ? spec : null;
}

const frameSchema = z.object({ w: z.number(), h: z.number(), cols: z.number(), rows: z.number() });
export type SpriteFrame = z.infer<typeof frameSchema>;

const spriteOkSchema = z.object({
  ok: z.literal(true),
  key: z.string(),
  w: z.number(),
  h: z.number(),
  scale: z.number(),
  frame: frameSchema.nullable(),
  uri: z.string(),
});
const spriteFailSchema = z.object({
  ok: z.literal(false),
  key: z.string(),
  code: z.enum(SPRITE_ERROR_CODES),
  message: z.string(),
});
const spriteResultSchema = z.discriminatedUnion("ok", [spriteOkSchema, spriteFailSchema]);
export type SpriteResult = z.infer<typeof spriteResultSchema>;

// The key list length is checked by the handler, not the schema, so an oversized list still gets an envelope.
export const spritesRpc = defineRpc({
  name: "office.sprites",
  input: z.object({ keys: z.array(z.string()) }),
  output: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), sprites: z.array(spriteResultSchema) }),
    z.object({ ok: z.literal(false), code: z.enum(CALL_ERROR_CODES), message: z.string() }),
  ]),
});

export type SpritesInput = z.infer<typeof spritesRpc.input>;
export type SpritesOutput = z.infer<typeof spritesRpc.output>;
