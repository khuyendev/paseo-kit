// office.sprites contract (OFFC-03, OFFC-08): the client asks for sprites by enumerated key, the server answers PNG data URIs.
// The input is a closed key grammar, never a path or free text; every failure is a typed envelope.
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { POSE_NAMES, ZOOM_CANDIDATES, type Pose, type ZoomCandidate } from "./art-types.ts";

// Later plans only add entries here and to SPRITE_REGISTRY, never change the shape.
export const SPRITE_KINDS = ["ruler", "character-sheet", "room-layer", "room-front"] as const;
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

// ---------------------------------------------------------------- room seed grammar (OFFC-07, OFFC-17)
// A room-layer or room-front key carries the area it draws inside its seed field; the grammar is closed and numeric.
export const ROOM_LAYER_AREAS = ["room", "reception", "restroom", "cafe", "lounge", "corridor"] as const;
export type RoomLayerArea = (typeof ROOM_LAYER_AREAS)[number];

// Season of a layer: the code stands in the seed, the name is the theme the server draws.
export const SEASON_CODES = { none: "n", christmas: "c", halloween: "h" } as const;
export type SeasonName = keyof typeof SEASON_CODES;
export const SEASON_NAMES = Object.keys(SEASON_CODES) as readonly SeasonName[];

export const ROOM_SLOT_MAX = 31;
export const ROOM_COLS_MAX = 18;
export const ROOM_VARIANT_MAX = 4294967295;
// Width in tiles of one corridor segment image.
export const CORRIDOR_SEGMENT_TILES = 16;

export interface RoomSeedSpec {
  area: RoomLayerArea;
  // Set for a room only.
  slot: number | null;
  variant: number | null;
  // Set for a corridor segment only.
  cols: number | null;
  segment: number | null;
  season: SeasonName;
}

function boundedInt(value: unknown, max: number, min: number, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new RangeError(name);
  return value;
}

// Canonical seed text; throws RangeError naming the bad field.
export function roomSeed(spec: RoomSeedSpec): string {
  if (!(ROOM_LAYER_AREAS as readonly string[]).includes(spec.area)) throw new RangeError("area");
  if (!Object.hasOwn(SEASON_CODES, spec.season)) throw new RangeError("season");
  const code = SEASON_CODES[spec.season];
  if (spec.area === "room") {
    const slot = boundedInt(spec.slot, ROOM_SLOT_MAX, 0, "slot");
    const variant = boundedInt(spec.variant, ROOM_VARIANT_MAX, 0, "variant");
    return `room-s${slot}-q${variant}-${code}`;
  }
  if (spec.area === "corridor") {
    const cols = boundedInt(spec.cols, ROOM_COLS_MAX, 1, "cols");
    const segment = boundedInt(spec.segment, cols - 1, 0, "segment");
    return `corridor-c${cols}-g${segment}-${code}`;
  }
  return `${spec.area}-${code}`;
}

const NUM = "(0|[1-9][0-9]{0,9})";
const ROOM_SEED_RE = new RegExp(`^room-s${NUM}-q${NUM}-([nch])$`);
const CORRIDOR_SEED_RE = new RegExp(`^corridor-c${NUM}-g${NUM}-([nch])$`);
const CORE_SEED_RE = /^(reception|restroom|cafe|lounge)-([nch])$/;

function seasonOfCode(code: string): SeasonName {
  return SEASON_NAMES.find((name) => SEASON_CODES[name] === code) as SeasonName;
}

// Never throws: the spec, or null when the text is not exactly a canonical room seed.
export function parseRoomSeed(seed: string): RoomSeedSpec | null {
  if (typeof seed !== "string" || seed.length > SPRITE_SEED_MAX_CHARS) return null;
  let spec: RoomSeedSpec | null = null;
  let m = ROOM_SEED_RE.exec(seed);
  if (m) {
    spec = { area: "room", slot: Number(m[1]), variant: Number(m[2]), cols: null, segment: null, season: seasonOfCode(m[3] as string) };
  } else if ((m = CORRIDOR_SEED_RE.exec(seed))) {
    spec = { area: "corridor", slot: null, variant: null, cols: Number(m[1]), segment: Number(m[2]), season: seasonOfCode(m[3] as string) };
  } else if ((m = CORE_SEED_RE.exec(seed))) {
    spec = { area: m[1] as RoomLayerArea, slot: null, variant: null, cols: null, segment: null, season: seasonOfCode(m[2] as string) };
  }
  if (!spec) return null;
  try {
    return roomSeed(spec) === seed ? spec : null;
  } catch {
    return null;
  }
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
