// Kind to renderer table: a new SpriteKind without a renderer here fails tsc.
import { buildBuilding, ROOM_ID_PREFIX } from "../shared/layout/building.ts";
import { layoutCorridor } from "../shared/layout/corridor.ts";
import type { AreaLayout } from "../shared/layout/types.ts";
import { TINT_LEVELS } from "../shared/tint.ts";
import {
  CORRIDOR_SEGMENT_TILES,
  parseRoomSeed,
  type SpriteFrame,
  type SpriteKind,
  type SpriteSpec,
} from "../shared/sprites-rpc.ts";
import { renderCharacterSheet } from "./art/character/sheet.ts";
import { PixelBuf } from "./art/core/pixbuf.ts";
import { renderRoomLayer, type RoomLayers } from "./art/rooms.ts";
import { hourForTint, tintBuf } from "./art/tint.ts";

// A drawn buffer plus its frame grid in unscaled pixels (null for a single image).
export type RenderedBuf = { buf: PixelBuf; frame: SpriteFrame | null };
export type SpriteRenderer = (spec: SpriteSpec) => RenderedBuf;

export const RULER_W = 32;
export const RULER_H = 8;
export const RULER_COLORS = ["#000000", "#ffffff", "#ff0000"] as const;

// Untinted layers kept so the base and the front of one area composite once; the cap lives here because server/limits.ts belongs to 07-01.
export const ROOM_LAYERS_MEMO_MAX = 8;

// Alternating one-pixel black and white columns with one red row at y 3: crispness probe for the spike.
const renderRuler: SpriteRenderer = () => {
  const buf = new PixelBuf(RULER_W, RULER_H);
  for (let x = 0; x < RULER_W; x++) {
    for (let y = 0; y < RULER_H; y++) buf.set(x, y, y === 3 ? RULER_COLORS[2] : RULER_COLORS[x % 2]);
  }
  return { buf, frame: null };
};

const layersMemo = new Map<string, RoomLayers>();

// Area of the layout a parsed room seed names; RangeError when the seed names nothing that exists.
function areaOfSeed(parsed: NonNullable<ReturnType<typeof parseRoomSeed>>): AreaLayout {
  if (parsed.area === "room") {
    const built = buildBuilding([{ id: "r", slot: parsed.slot as number, seed: parsed.variant as number }]);
    const found = built.areas.find((a) => a.id === `${ROOM_ID_PREFIX}r`);
    if (!found) throw new RangeError("room");
    return found;
  }
  if (parsed.area === "corridor") {
    const cols = parsed.cols as number;
    const corridor = layoutCorridor(cols);
    if ((parsed.segment as number) * CORRIDOR_SEGMENT_TILES >= corridor.rect.w) throw new RangeError("segment");
    return corridor;
  }
  const found = buildBuilding([]).areas.find((a) => a.kind === parsed.area);
  if (!found) throw new RangeError("area");
  return found;
}

function layersOf(spec: SpriteSpec): RoomLayers {
  const parsed = parseRoomSeed(spec.seed);
  if (parsed === null) throw new RangeError("seed");
  if (!Number.isInteger(spec.tint) || spec.tint < 0 || spec.tint >= TINT_LEVELS) throw new RangeError("tint");
  const memoKey = `${spec.seed}|${spec.tint}`;
  const hit = layersMemo.get(memoKey);
  if (hit) return hit;
  const area = areaOfSeed(parsed);
  let crop: { x: number; y: number; w: number; h: number } | undefined;
  if (parsed.area === "corridor") {
    const x = (parsed.segment as number) * CORRIDOR_SEGMENT_TILES;
    crop = { x, y: 0, w: Math.min(CORRIDOR_SEGMENT_TILES, area.rect.w - x), h: area.rect.h };
  }
  const layers = renderRoomLayer(area, { theme: parsed.season, hour: hourForTint(spec.tint, TINT_LEVELS), crop });
  if (layersMemo.size >= ROOM_LAYERS_MEMO_MAX) {
    const oldest = layersMemo.keys().next();
    if (!oldest.done) layersMemo.delete(oldest.value);
  }
  layersMemo.set(memoKey, layers);
  return layers;
}

// One layer of one area, tinted to the key's level (OFFC-17); a missing front is a transparent buffer of the base size.
export function renderRoomKey(spec: SpriteSpec, layer: "base" | "front"): RenderedBuf {
  const layers = layersOf(spec);
  const buffer = layer === "base" ? layers.base : (layers.front ?? new PixelBuf(layers.base.w, layers.base.h));
  return { buf: tintBuf(buffer, spec.tint, TINT_LEVELS), frame: null };
}

export const SPRITE_REGISTRY: Readonly<Record<SpriteKind, SpriteRenderer>> = {
  ruler: renderRuler,
  "character-sheet": renderCharacterSheet,
  "room-layer": (spec) => renderRoomKey(spec, "base"),
  "room-front": (spec) => renderRoomKey(spec, "front"),
};
