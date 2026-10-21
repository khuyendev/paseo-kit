// No upstream: written for plan 07-11.
// The layout and path modules it imports live in shared/ because the server bundle draws the room layers from them and Paseo's host bundler rejects client/ imports there (PANL-02).
// Pure scene logic of the office (D-03, D-04, D-06): zoom, seat placement, camera, culling, sprite keys and the life director.
// No React, no timer, no clock read and no random source: time is the beat number the caller passes in (OFFC-13).
import { TILE, ZOOM_LEVELS, type Dir, type ZoomCandidate } from "../shared/art-types.ts";
import type { AgentStatus, BuildingModel, ClusterModel, RoomModel } from "../shared/model-types.ts";
import {
  CORRIDOR_SEGMENT_TILES,
  spriteKey,
  roomSeed,
  type RoomLayerArea,
  type SeasonName,
  type SpriteKey,
} from "../shared/sprites-rpc.ts";
import { ROOM_ID_PREFIX, type BuildingLayout } from "../shared/layout/building.ts";
import { mulberry32 } from "../shared/layout/rng.ts";
import type { AreaLayout, SpotDef, TileRect } from "../shared/layout/types.ts";
import { ARCHIVE_FADE_MS, CLOCK_TICKS_PER_FRAME, CLOCK_TICK_MS, WANDER_STAY_MS_MAX, WANDER_STAY_MS_MIN } from "./limits-life.ts";
import { ElevatorSchedule, arrivalJourney, departureJourney, elevatorFronts, handoffJourney, roundTripJourney, type Journey } from "./life/journey.ts";
import { SHEET_POSE_GROUPS, groupOfPose } from "./life/frames.ts";
import { createSpotLedger, indexSpots, type SpotIndex, type SpotLedger } from "./life/ledger.ts";
import { pickHangout, reserveHangout } from "./life/social.ts";
import { idleSitMs, pickWander, wanderSeed } from "./life/wander.ts";
import { FREE, type TilePoint } from "../shared/path/grid.ts";
import { appearanceSeed, type PoseChoice } from "./poses.ts";
import type { CameraTarget } from "./sidebar-model.ts";

// ---------------------------------------------------------------- scene constants (the manifest gives this plan no limits file)

// Pixels around the viewport inside which a layer is still requested and mounted (OFFC-08).
export const SCENE_CULL_MARGIN_PX = 256;
// Viewport assumed before the first layout event.
export const SCENE_DEFAULT_VIEWPORT = { w: 1280, h: 800 } as const;
// Tiles of padding around the seats of a cluster and around a camera focus.
export const SCENE_FOCUS_PAD_TILES = 2;
// Z-order bands: seated characters by foot row above the bases, walkers above them, fronts, labels, effects.
export const SCENE_Z_SEATED_BASE = 100;
export const SCENE_Z_WALKER = 5000;
export const SCENE_Z_FRONT = 9000;
export const SCENE_Z_LABEL = 9500;
export const SCENE_Z_EFFECT = 9900;
// Label and control sizes in px.
export const SCENE_LABEL_FONT_PX = 11;
export const SCENE_SIGN_RISE_TILES = 3;
export const SCENE_SIGN_WIDTH_PX = 120;
export const SCENE_SIDEBAR_WIDTH_PX = 260;
export const SCENE_DRAWER_WIDTH_PX = 300;
export const SCENE_CONTROL_PX = 28;
// The life director and the day clock run on the beat of this tier of the shared clock bank.
export const SCENE_LIFE_BEAT_TIER = 3;
export const SCENE_BEAT_MS = CLOCK_TICKS_PER_FRAME[SCENE_LIFE_BEAT_TIER] * CLOCK_TICK_MS;
// Beats between two refreshes of the day position.
export const SCENE_DAY_REFRESH_BEATS = 75;
// Beats a closed agent sleeps before it leaves.
export const SCENE_SLEEP_BEATS = 5;
// Journeys at once (the walking count the spike measured).
export const SCENE_MAX_WALKERS = 6;
// Arrivals started in one beat at most; the rest wait for the next beats (waves of spawns).
export const SCENE_ARRIVAL_WAVE = 3;
// Beats a departing agent (a tombstone) may take to leave before the screen releases it anyway.
export const SCENE_DEPART_MAX_BEATS = 20;
// Beats before a failed excursion pick is tried again.
export const SCENE_WANDER_RETRY_BEATS = 4;
// Beats a resolved handoff waits for its move sheet and a free walker slot before it is dropped.
export const SCENE_HANDOFF_PENDING_BEATS = 12;
// Beats between two retries of the wanted sprite keys whose office.sprites call failed.
export const SCENE_SPRITE_RETRY_BEATS = 20;
// Retry rounds one wanted set may spend.
export const SCENE_SPRITE_RETRY_ROUNDS_MAX = 3;

// True on the beats a retry round may run: a positive multiple of SCENE_SPRITE_RETRY_BEATS while rounds are left (R11-03).
export function shouldRetrySprites(beat: number, roundsUsed: number): boolean {
  if (!Number.isInteger(beat) || !Number.isInteger(roundsUsed) || beat <= 0 || roundsUsed < 0) return false;
  return beat % SCENE_SPRITE_RETRY_BEATS === 0 && roundsUsed < SCENE_SPRITE_RETRY_ROUNDS_MAX;
}

const FNV_OFFSET = 0x811c9dc5;
// Room variants stay below this: the room renderer bounds every floor seed (the variant plus a small offset) by one million.
export const SCENE_ROOM_VARIANTS = 999000;
const SEAT_FALLBACK_KINDS: ReadonlySet<string> = new Set(["nook", "stool", "stand"]);
const BFS_TILES_MAX = 4096;

// ---------------------------------------------------------------- zoom (OFFC-09)

function checkLevels(levels: readonly number[]): void {
  if (!Array.isArray(levels) || levels.length === 0) throw new RangeError("levels");
}

// The smallest offered level.
export function defaultZoom(levels: readonly ZoomCandidate[] = ZOOM_LEVELS): ZoomCandidate {
  checkLevels(levels);
  return [...levels].sort((a, b) => a - b)[0] as ZoomCandidate;
}

// The neighbour level in a direction (+1 larger, -1 smaller); an unknown current snaps to the nearest level first; the ends stay.
export function zoomStep(current: number, direction: 1 | -1, levels: readonly ZoomCandidate[] = ZOOM_LEVELS): ZoomCandidate {
  checkLevels(levels);
  const sorted = [...levels].sort((a, b) => a - b);
  let at = sorted.indexOf(current as ZoomCandidate);
  if (at < 0) {
    at = 0;
    let gap = Infinity;
    sorted.forEach((level, i) => {
      const d = Math.abs(level - (Number.isFinite(current) ? current : 0));
      if (d < gap) {
        gap = d;
        at = i;
      }
    });
  }
  const next = Math.min(sorted.length - 1, Math.max(0, at + (direction > 0 ? 1 : -1)));
  return sorted[next] as ZoomCandidate;
}

export function sceneSize(rect: TileRect, zoom: number): { w: number; h: number } {
  return { w: rect.w * TILE * zoom, h: rect.h * TILE * zoom };
}

// ---------------------------------------------------------------- rooms (D-04)

// 32-bit FNV-1a of the project id folded into SCENE_ROOM_VARIANTS: a project keeps its look when rooms reorder.
export function roomVariantOf(projectId: string): number {
  let hash = FNV_OFFSET;
  const text = String(projectId);
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % SCENE_ROOM_VARIANTS;
}

export interface RoomInputOf {
  id: string;
  slot: number;
  seed: number;
}

// Layout inputs of the model rooms, in model order.
export function roomInputsOf(model: BuildingModel): RoomInputOf[] {
  const seen = new Set<string>();
  const out: RoomInputOf[] = [];
  for (const room of model.rooms) {
    if (seen.has(room.projectId)) continue;
    seen.add(room.projectId);
    out.push({ id: room.projectId, slot: out.length, seed: roomVariantOf(room.projectId) });
  }
  return out;
}

// ---------------------------------------------------------------- placement (OFFC-06, OFFC-11)

export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Seat {
  agentId: string;
  roomId: string;
  workspaceId: string;
  tile: TilePoint;
  dir: Dir;
  spotId: string | null;
  isChild: boolean;
}

export interface ClusterAnchor {
  roomId: string;
  workspaceId: string;
  // Padded tile bounding box of the seats of the cluster, clipped to its room.
  rect: TileRect;
  // Top-left tile of the rect: where the sign hangs.
  sign: TilePoint;
}

export interface SurplusAnchor {
  scope: "cluster" | "room" | "building";
  roomId: string | null;
  workspaceId: string | null;
  count: number;
  tile: TilePoint;
}

export interface RoomLabelAnchor {
  roomId: string;
  tile: TilePoint;
}

export interface ScenePlacement {
  seats: Seat[];
  clusters: ClusterAnchor[];
  labels: RoomLabelAnchor[];
  surplus: SurplusAnchor[];
}

const tileKey = (x: number, y: number): string => `${x},${y}`;
const manhattan = (a: TilePoint, b: TilePoint): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const copyRect = (r: TileRect): TileRect => ({ x: r.x, y: r.y, w: r.w, h: r.h });

function intersectRect(a: TileRect, b: TileRect): TileRect | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

function padRect(r: TileRect, pad: number, clip: TileRect): TileRect {
  return intersectRect({ x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad }, clip) ?? copyRect(clip);
}

function boundsOf(tiles: readonly TilePoint[]): TileRect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const t of tiles) {
    x0 = Math.min(x0, t.x);
    y0 = Math.min(y0, t.y);
    x1 = Math.max(x1, t.x);
    y1 = Math.max(y1, t.y);
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

interface RoomState {
  area: AreaLayout;
  taken: Set<string>;
  spotTiles: Set<string>;
  desks: SpotDef[];
  others: SpotDef[];
  usedSpots: Set<string>;
}

function roomStateOf(area: AreaLayout): RoomState {
  const desks = area.spots.filter((s) => s.kind === "desk").sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  const others = area.spots.filter((s) => SEAT_FALLBACK_KINDS.has(s.kind));
  const spotTiles = new Set<string>();
  for (const s of area.spots) spotTiles.add(tileKey(s.tx, s.ty));
  return { area, taken: new Set(), spotTiles, desks, others, usedSpots: new Set() };
}

// The free non-desk spot nearest to a tile, else the nearest free walkable floor tile inside the room (bounded breadth-first search).
function nearestSeat(state: RoomState, building: BuildingLayout, from: TilePoint): { tile: TilePoint; dir: Dir; spotId: string | null } | null {
  let best: SpotDef | null = null;
  let bestDistance = Infinity;
  for (const spot of state.others) {
    if (state.usedSpots.has(spot.id) || state.taken.has(tileKey(spot.tx, spot.ty)) || !building.grid.walkable(spot.tx, spot.ty)) continue;
    const d = manhattan({ x: spot.tx, y: spot.ty }, from);
    if (d < bestDistance) {
      best = spot;
      bestDistance = d;
    }
  }
  if (best) return { tile: { x: best.tx, y: best.ty }, dir: best.dir, spotId: best.id };
  const rect = state.area.rect;
  const seen = new Set<string>([tileKey(from.x, from.y)]);
  const queue: TilePoint[] = [{ x: from.x, y: from.y }];
  for (let head = 0; head < queue.length && queue.length < BFS_TILES_MAX; head++) {
    const at = queue[head] as TilePoint;
    if (building.grid.get(at.x, at.y) === FREE && !state.taken.has(tileKey(at.x, at.y)) && !state.spotTiles.has(tileKey(at.x, at.y))) {
      return { tile: at, dir: "down", spotId: null };
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = at.x + dx;
      const ny = at.y + dy;
      const k = tileKey(nx, ny);
      if (seen.has(k) || nx < rect.x || ny < rect.y || nx >= rect.x + rect.w || ny >= rect.y + rect.h || !building.grid.walkable(nx, ny)) continue;
      seen.add(k);
      queue.push({ x: nx, y: ny });
    }
  }
  return null;
}

function claim(state: RoomState, seat: Seat): Seat {
  state.taken.add(tileKey(seat.tile.x, seat.tile.y));
  if (seat.spotId !== null) state.usedSpots.add(seat.spotId);
  return seat;
}

// One seat per drawn agent and the anchors of signs, labels and surplus groups (D-04). Pure: a fresh result on every call.
export function placeScene(building: BuildingLayout, model: BuildingModel): ScenePlacement {
  const out: ScenePlacement = { seats: [], clusters: [], labels: [], surplus: [] };
  const states = new Map<string, RoomState>();
  const roomAreas = new Map<string, AreaLayout>();
  for (const area of building.areas) {
    if (area.kind === "room" && area.id.startsWith(ROOM_ID_PREFIX) && !roomAreas.has(area.id.slice(ROOM_ID_PREFIX.length))) roomAreas.set(area.id.slice(ROOM_ID_PREFIX.length), area);
  }
  for (const room of model.rooms as readonly RoomModel[]) {
    const area = roomAreas.get(room.projectId);
    if (!area) continue;
    let state = states.get(room.projectId);
    if (!state) {
      state = roomStateOf(area);
      states.set(room.projectId, state);
    }
    out.labels.push({ roomId: room.projectId, tile: { x: area.rect.x, y: area.rect.y } });
    for (const cluster of room.clusters as readonly ClusterModel[]) {
      const own = new Map<string, Seat>();
      const seatsOfCluster: Seat[] = [];
      const make = (agentId: string, isChild: boolean, found: { tile: TilePoint; dir: Dir; spotId: string | null }): Seat =>
        claim(state, { agentId, roomId: room.projectId, workspaceId: cluster.workspaceId, tile: found.tile, dir: found.dir, spotId: found.spotId, isChild });
      // Main desk of the cluster: the next free desk spot, held for the cluster even when it has no brain.
      const mainDesk = state.desks.find((d) => !state.usedSpots.has(d.id) && !state.taken.has(tileKey(d.tx, d.ty))) ?? null;
      const mainTile: TilePoint | null = mainDesk ? { x: mainDesk.tx, y: mainDesk.ty } : null;
      const drawn = cluster.drawn.filter((d, i, all) => all.findIndex((o) => o.agentId === d.agentId) === i);
      for (const d of drawn.filter((a) => !a.isChild)) {
        const desk = state.desks.find((s) => !state.usedSpots.has(s.id) && !state.taken.has(tileKey(s.tx, s.ty)));
        const found = desk
          ? { tile: { x: desk.tx, y: desk.ty }, dir: desk.dir, spotId: desk.id }
          : nearestSeat(state, building, mainTile ?? { x: area.rect.x + 8, y: area.rect.y + 6 });
        if (!found) continue;
        const seat = make(d.agentId, false, found);
        own.set(d.agentId, seat);
        seatsOfCluster.push(seat);
      }
      const firstBrain = seatsOfCluster[0];
      const anchorTile: TilePoint = mainTile ?? (firstBrain ? firstBrain.tile : { x: area.rect.x + 8, y: area.rect.y + 6 });
      for (const d of drawn.filter((a) => a.isChild)) {
        const parent = d.parentId !== null ? (own.get(d.parentId) ?? out.seats.find((s) => s.agentId === d.parentId)) : undefined;
        const found = nearestSeat(state, building, parent ? parent.tile : anchorTile);
        if (!found) continue;
        const seat = make(d.agentId, true, found);
        own.set(d.agentId, seat);
        seatsOfCluster.push(seat);
      }
      out.seats.push(...seatsOfCluster);
      const tiles = seatsOfCluster.map((s) => s.tile);
      if (mainTile) tiles.push(mainTile);
      if (tiles.length === 0) tiles.push({ x: area.rect.x + 8, y: area.rect.y + 6 });
      const rect = padRect(boundsOf(tiles), SCENE_FOCUS_PAD_TILES, area.rect);
      out.clusters.push({ roomId: room.projectId, workspaceId: cluster.workspaceId, rect, sign: { x: rect.x, y: rect.y } });
      if (cluster.surplusAgents > 0) {
        out.surplus.push({ scope: "cluster", roomId: room.projectId, workspaceId: cluster.workspaceId, count: cluster.surplusAgents, tile: { x: rect.x, y: rect.y + rect.h - 1 } });
      }
    }
    if (room.surplusAgents > 0) {
      const door = area.door ?? { x: area.rect.x + 7, y: area.rect.y + 11, w: 2, h: 1 };
      out.surplus.push({ scope: "room", roomId: room.projectId, workspaceId: null, count: room.surplusAgents, tile: { x: door.x, y: door.y } });
    }
  }
  if (model.surplusAgents > 0) {
    const corridor = building.areas.find((a) => a.kind === "corridor");
    const rect = corridor ? corridor.rect : building.rect;
    out.surplus.push({ scope: "building", roomId: null, workspaceId: null, count: model.surplusAgents, tile: { x: rect.x + rect.w - 2, y: rect.y } });
  }
  return out;
}

// ---------------------------------------------------------------- camera (OFFC-14)

export interface CameraResult {
  // Integer scroll offsets in px.
  x: number;
  y: number;
  // The tile rect the camera centres, inside the building.
  focus: TileRect;
}

function focusOf(target: CameraTarget, building: BuildingLayout, placement: ScenePlacement): TileRect {
  const room = intersectRect(target.rect, building.rect);
  let focus: TileRect = room ?? copyRect(building.rect);
  if (target.scope === "cluster" || target.scope === "agent") {
    const cluster = placement.clusters.find((c) => c.roomId === target.roomId && c.workspaceId === target.workspaceId);
    if (target.scope === "agent") {
      const seat = placement.seats.find((s) => s.agentId === target.agentId);
      if (seat) {
        const clip = room ?? building.rect;
        focus = padRect({ x: seat.tile.x, y: seat.tile.y, w: 1, h: 1 }, SCENE_FOCUS_PAD_TILES, intersectRect(clip, building.rect) ?? building.rect);
      } else if (cluster) focus = copyRect(cluster.rect);
    } else if (cluster) focus = copyRect(cluster.rect);
  }
  return focus;
}

// Scroll offsets that centre a target in the view, clamped to the scene (OFFC-14, D-04).
export function cameraFor(
  target: CameraTarget,
  building: BuildingLayout,
  view: { w: number; h: number },
  zoom: number,
  placement: ScenePlacement,
): CameraResult {
  const focus = focusOf(target, building, placement);
  const scene = sceneSize(building.rect, zoom);
  const axis = (focusStart: number, focusLen: number, viewLen: number, sceneLen: number): number => {
    const max = Math.max(0, Math.floor(sceneLen - viewLen));
    const centred = (focusStart + focusLen / 2) * TILE * zoom - viewLen / 2;
    return Math.min(max, Math.max(0, Math.round(Number.isFinite(centred) ? centred : 0)));
  };
  return { x: axis(focus.x, focus.w, view.w, scene.w), y: axis(focus.y, focus.h, view.h, scene.h), focus };
}

// ---------------------------------------------------------------- culling and keys (OFFC-08, OFFC-17)

export interface VisibleLayer {
  area: RoomLayerArea;
  areaId: string;
  // The project id of a room layer, else null.
  roomId: string | null;
  // Segment index of a corridor layer, else null.
  segment: number | null;
  rect: TileRect;
}

// Layers whose pixel rect meets the viewport widened by the margin, in area order, a corridor cut into segments.
export function visibleLayers(
  building: BuildingLayout,
  zoom: number,
  viewport: { x: number; y: number; w: number; h: number },
  margin: number = SCENE_CULL_MARGIN_PX,
): VisibleLayer[] {
  const left = viewport.x - margin;
  const top = viewport.y - margin;
  const right = viewport.x + viewport.w + margin;
  const bottom = viewport.y + viewport.h + margin;
  const meets = (r: TileRect): boolean => {
    const px = r.x * TILE * zoom;
    const py = r.y * TILE * zoom;
    return px < right && px + r.w * TILE * zoom > left && py < bottom && py + r.h * TILE * zoom > top;
  };
  const out: VisibleLayer[] = [];
  for (const area of building.areas) {
    if (area.kind === "corridor") {
      const segments = Math.ceil(area.rect.w / CORRIDOR_SEGMENT_TILES);
      for (let g = 0; g < segments; g++) {
        const rect = { x: area.rect.x + g * CORRIDOR_SEGMENT_TILES, y: area.rect.y, w: Math.min(CORRIDOR_SEGMENT_TILES, area.rect.w - g * CORRIDOR_SEGMENT_TILES), h: area.rect.h };
        if (meets(rect)) out.push({ area: "corridor", areaId: area.id, roomId: null, segment: g, rect });
      }
      continue;
    }
    if (!meets(area.rect)) continue;
    const isRoom = area.kind === "room" && area.id.startsWith(ROOM_ID_PREFIX);
    out.push({ area: area.kind as RoomLayerArea, areaId: area.id, roomId: isRoom ? area.id.slice(ROOM_ID_PREFIX.length) : null, segment: null, rect: copyRect(area.rect) });
  }
  return out;
}

// Variant indices to show for a day position: one at an integral position, floor and ceil otherwise.
export function tintIndices(position: number, levels: number): number[] {
  if (!Number.isInteger(levels) || levels < 1) throw new RangeError("levels");
  const at = Number.isNaN(position) ? 0 : Math.min(levels - 1, Math.max(0, position));
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return lo === hi ? [lo] : [lo, hi];
}

export interface LayerKeyContext {
  zoom: ZoomCandidate;
  season: SeasonName;
  tint: number;
  // Column count of the building (a corridor seed names it).
  cols: number;
  rooms: readonly RoomInputOf[];
}

// Sprite key of one layer; throws RangeError for a layer the seed grammar cannot name.
export function layerKey(layer: VisibleLayer, kind: "room-layer" | "room-front", ctx: LayerKeyContext): SpriteKey {
  let seed: string;
  if (layer.area === "room") {
    const room = ctx.rooms.find((r) => r.id === layer.roomId);
    if (!room) throw new RangeError("room");
    seed = roomSeed({ area: "room", slot: room.slot, variant: room.seed, cols: null, segment: null, season: ctx.season });
  } else if (layer.area === "corridor") {
    seed = roomSeed({ area: "corridor", slot: null, variant: null, cols: ctx.cols, segment: layer.segment, season: ctx.season });
  } else {
    seed = roomSeed({ area: layer.area, slot: null, variant: null, cols: null, segment: null, season: ctx.season });
  }
  return spriteKey({ kind, seed, poses: [], scale: ctx.zoom, tint: ctx.tint });
}

// Sprite key of one pose group of one agent's sheet.
export function characterSheetKey(agentId: string, group: number, zoom: ZoomCandidate): SpriteKey {
  const poses = SHEET_POSE_GROUPS[group];
  if (!poses) throw new RangeError("group");
  return spriteKey({ kind: "character-sheet", seed: appearanceSeed(agentId), poses, scale: zoom, tint: 0 });
}

// A child uses the next smaller level when one exists (D-04); everyone else the zoom.
export function sheetZoomFor(isChild: boolean, zoom: ZoomCandidate, levels: readonly ZoomCandidate[] = ZOOM_LEVELS): ZoomCandidate {
  if (!isChild) return zoom;
  let best: ZoomCandidate | null = null;
  for (const level of levels) if (level < zoom && (best === null || level > best)) best = level;
  return best ?? zoom;
}

// Sheet group of the walk pose and of the hangout poses.
export const MOVE_GROUP = groupOfPose("walk");
export const SOCIAL_GROUP = groupOfPose("talk");

export interface WantedInput {
  agentId: string;
  status: AgentStatus;
  choice: PoseChoice;
  handoffPending: boolean;
  // A spawned or departing agent walks through the elevator.
  travels?: boolean;
}

// Sheet groups each agent needs: its resting pose, the move group for arrivals, departures, handoffs and the first idle candidates, social for those candidates.
export function wantedGroups(characters: readonly WantedInput[], maxCandidates: number = SCENE_MAX_WALKERS): Map<string, number[]> {
  const out = new Map<string, number[]>();
  let candidates = 0;
  for (const c of characters) {
    const groups = new Set<number>();
    const rest = groupOfPose(c.choice.pose);
    if (rest >= 0) groups.add(rest);
    if (c.choice.alt !== null) {
      const alt = groupOfPose(c.choice.alt);
      if (alt >= 0) groups.add(alt);
    }
    if (c.status === "initializing" || c.status === "closed" || c.handoffPending || c.travels === true) groups.add(MOVE_GROUP);
    if (c.status === "idle" && c.choice.wanders && candidates < maxCandidates) {
      candidates++;
      groups.add(MOVE_GROUP);
      groups.add(SOCIAL_GROUP);
    }
    out.set(c.agentId, [...groups].sort((a, b) => a - b));
  }
  return out;
}

// ---------------------------------------------------------------- life director (OFFC-11, OFFC-12, OFFC-13, D-06)

export type LifeKind = "arrival" | "departure" | "excursion" | "hangout" | "handoff";

export interface LifeCharacter {
  agentId: string;
  seat: { tile: TilePoint; dir: Dir };
  status: AgentStatus;
  choice: PoseChoice;
  // Sheet groups whose image is loaded.
  ready: ReadonlySet<number>;
  // A fresh spawn: comes up by elevator when first seen, even when it is already running.
  spawned?: boolean;
  // On screen when the office opened: sits at its seat at once, even when it is still initializing (no elevator storm).
  settled?: boolean;
  // An archived agent (a tombstone): walks to an elevator at once, or fades in place for a bulk archive. It never comes back.
  leave?: "walk" | "fade" | null;
}

export interface LifeStart {
  agentId: string;
  kind: LifeKind;
  journey: Journey;
  startBeat: number;
}

export interface LifeChanges {
  starts: LifeStart[];
  cancels: string[];
  gone: string[];
}

export interface LifeDirector {
  step(characters: readonly LifeCharacter[], beat: number): LifeChanges;
  handoff(request: { childId: string; parentId: string }, characters: readonly LifeCharacter[], beat: number): LifeChanges;
  finished(agentId: string, beat: number): LifeChanges;
  // Swaps the layout (R11-02): every agent keeps its hidden, arrival and sleep state; the journeys of the old layout end and are returned as cancels.
  relayout(building: BuildingLayout): LifeChanges;
  // True while the character is not on screen: after its departure and before its arrival starts.
  // An agent the director has not seen yet counts as gone only when its status is initializing or it is a fresh spawn.
  isGone(agentId: string, status?: AgentStatus, spawned?: boolean): boolean;
  journeyOf(agentId: string): LifeKind | null;
  reset(): void;
}

interface Entry {
  status: AgentStatus;
  hidden: boolean;
  arrivalDue: number | null;
  // Index of the elevator the arrival was scheduled on.
  arrivalFront: number;
  sleepFrom: number | null;
  journey: LifeKind | null;
  nextOuting: number;
  round: number;
  // Archived: leaves once and is never scheduled to arrive again.
  leaving: boolean;
}

const emptyChanges = (): LifeChanges => ({ starts: [], cancels: [], gone: [] });
const beatsOf = (ms: number): number => Math.max(1, Math.ceil(ms / SCENE_BEAT_MS));

export function createLifeDirector(initial: BuildingLayout): LifeDirector {
  // The current layout and what is derived from it; relayout replaces them together.
  let building = initial;
  let index: SpotIndex = indexSpots(building);
  let ledger: SpotLedger = createSpotLedger();
  let fronts = elevatorFronts(building);
  let schedule: ElevatorSchedule = ElevatorSchedule(Math.max(1, fronts.length));
  const entries = new Map<string, Entry>();
  let active = 0;

  const seedFor = (agentId: string, round: number, beat: number): (() => number) => mulberry32((wanderSeed(agentId, round) + Math.imul(beat, 0x85ebca6b)) >>> 0);

  function begin(entry: Entry, kind: LifeKind): void {
    entry.journey = kind;
    active++;
  }

  function end(entry: Entry): void {
    if (entry.journey !== null) active = Math.max(0, active - 1);
    entry.journey = null;
  }

  function entryOf(c: LifeCharacter, beat: number): Entry {
    let entry = entries.get(c.agentId);
    if (!entry) {
      entry = { status: c.status, hidden: false, arrivalDue: null, arrivalFront: 0, sleepFrom: null, journey: null, nextOuting: beat + beatsOf(idleSitMs(seedFor(c.agentId, 0, 0))), round: 0, leaving: false };
      if ((c.status === "initializing" || c.spawned === true) && c.settled !== true && (c.leave ?? null) === null && fronts.length > 0) {
        entry.hidden = true;
        scheduleArrival(entry, beat);
      }
      if (c.status === "closed") entry.sleepFrom = beat;
      entries.set(c.agentId, entry);
    }
    return entry;
  }

  // Staggers arrivals over the elevators: the due beat and the elevator come from the shared schedule.
  function scheduleArrival(entry: Entry, beat: number): void {
    const slot = schedule.reserve(beat * SCENE_BEAT_MS);
    entry.arrivalDue = Math.max(beat, Math.ceil(slot.at / SCENE_BEAT_MS));
    entry.arrivalFront = slot.index;
  }

  function frontFor(agentId: string): TilePoint {
    const at = fronts.length > 0 ? fronts[Math.abs(wanderSeed(agentId, 0)) % fronts.length] : null;
    return at as TilePoint;
  }

  function cancelOuting(id: string, entry: Entry, beat: number, changes: LifeChanges): void {
    if (entry.journey === "excursion" || entry.journey === "hangout") {
      end(entry);
      changes.cancels.push(id);
    }
    ledger.releaseAll(id);
    entry.round++;
    entry.nextOuting = beat + beatsOf(idleSitMs(seedFor(id, entry.round, beat)));
  }

  function step(characters: readonly LifeCharacter[], beat: number): LifeChanges {
    const changes = emptyChanges();
    const present = new Set<string>();
    for (const c of characters) present.add(c.agentId);
    for (const [id, entry] of [...entries]) {
      if (present.has(id)) continue;
      end(entry);
      ledger.releaseAll(id);
      entries.delete(id);
    }
    const byId = new Map<string, LifeCharacter>();
    for (const c of characters) if (!byId.has(c.agentId)) byId.set(c.agentId, c);
    // Status changes first, so a started worker cancels its outing before anything else is decided.
    for (const c of byId.values()) {
      const entry = entryOf(c, beat);
      if (entry.status !== c.status) {
        const was = entry.status;
        entry.status = c.status;
        if (c.status === "closed") entry.sleepFrom = beat;
        else if (was === "closed") {
          entry.sleepFrom = null;
          if (entry.hidden && entry.arrivalDue === null && fronts.length > 0) scheduleArrival(entry, beat);
        }
        if (c.status !== "idle") cancelOuting(c.agentId, entry, beat, changes);
      }
      // Archived: an outing ends now; one that never arrived is gone at once.
      if ((c.leave ?? null) !== null && !entry.leaving) {
        entry.leaving = true;
        cancelOuting(c.agentId, entry, beat, changes);
        if (entry.hidden) {
          entry.arrivalDue = null;
          changes.gone.push(c.agentId);
        }
      }
    }
    let arrivals = 0;
    for (const c of byId.values()) {
      const entry = entries.get(c.agentId) as Entry;
      const move = c.ready.has(MOVE_GROUP);
      if (entry.leaving) {
        if (entry.hidden || entry.journey !== null) continue;
        if (c.leave === "fade") {
          // A bulk archive fades in place: no walk, so no walker slot is needed.
          const steps: Journey["steps"] = [{ kind: "vanish", ms: ARCHIVE_FADE_MS }];
          const journey: Journey = { steps, startTile: { ...c.seat.tile }, startDir: c.seat.dir, endTile: { ...c.seat.tile }, endDir: c.seat.dir, totalMs: ARCHIVE_FADE_MS };
          begin(entry, "departure");
          changes.starts.push({ agentId: c.agentId, kind: "departure", journey, startBeat: beat });
        } else if (move && fronts.length > 0 && active < SCENE_MAX_WALKERS) {
          const journey = departureJourney(building, c.seat.tile, frontFor(c.agentId), { fromDir: c.seat.dir });
          if (journey === null) {
            entry.hidden = true;
            changes.gone.push(c.agentId);
          } else {
            begin(entry, "departure");
            changes.starts.push({ agentId: c.agentId, kind: "departure", journey, startBeat: beat });
          }
        } else if (fronts.length === 0) {
          entry.hidden = true;
          changes.gone.push(c.agentId);
        }
        continue;
      }
      if (entry.hidden && entry.arrivalDue !== null) {
        if (beat >= entry.arrivalDue && move && active < SCENE_MAX_WALKERS && arrivals < SCENE_ARRIVAL_WAVE && c.status !== "closed") {
          arrivals++;
          const journey = arrivalJourney(building, fronts[Math.min(entry.arrivalFront, fronts.length - 1)] as TilePoint, c.seat.tile, { destDir: c.seat.dir });
          if (journey === null) {
            entry.hidden = false;
            entry.arrivalDue = null;
          } else {
            entry.hidden = false;
            entry.arrivalDue = null;
            begin(entry, "arrival");
            changes.starts.push({ agentId: c.agentId, kind: "arrival", journey, startBeat: beat });
          }
        }
        continue;
      }
      if (entry.hidden) continue;
      if (c.status === "closed" && entry.journey === null && entry.sleepFrom !== null && beat - entry.sleepFrom >= SCENE_SLEEP_BEATS && move && fronts.length > 0 && active < SCENE_MAX_WALKERS) {
        const journey = departureJourney(building, c.seat.tile, frontFor(c.agentId), { fromDir: c.seat.dir });
        if (journey === null) {
          entry.hidden = true;
          changes.gone.push(c.agentId);
        } else {
          begin(entry, "departure");
          changes.starts.push({ agentId: c.agentId, kind: "departure", journey, startBeat: beat });
        }
      }
    }
    // Outings: hangouts first among the idle agents that are due, then single excursions, all under the walker cap.
    const due: LifeCharacter[] = [];
    for (const c of byId.values()) {
      const entry = entries.get(c.agentId) as Entry;
      if (c.status !== "idle" || !c.choice.wanders || entry.hidden || entry.journey !== null) continue;
      if (!c.ready.has(MOVE_GROUP) || beat < entry.nextOuting) continue;
      due.push(c);
    }
    if (due.length >= 2 && active < SCENE_MAX_WALKERS) {
      const social = due.filter((c) => c.ready.has(SOCIAL_GROUP));
      const lead = social[0];
      if (lead && social.length >= 2) {
        const rng = seedFor(lead.agentId, (entries.get(lead.agentId) as Entry).round, beat);
        const hangout = pickHangout({ index, ledger, idle: social.map((c) => ({ id: c.agentId, tile: c.seat.tile })), rng });
        if (hangout && active + hangout.members.length <= SCENE_MAX_WALKERS && reserveHangout(ledger, hangout)) {
          const stay = Math.floor(WANDER_STAY_MS_MIN + rng() * (WANDER_STAY_MS_MAX - WANDER_STAY_MS_MIN));
          const journeys = hangout.members.map((m) => {
            const c = byId.get(m.agentId) as LifeCharacter;
            return roundTripJourney(building, c.seat.tile, m.tile, { wait: { ms: stay, pose: m.pose, dir: m.dir }, homeDir: c.seat.dir });
          });
          if (journeys.every((j) => j !== null)) {
            hangout.members.forEach((m, i) => {
              const entry = entries.get(m.agentId) as Entry;
              begin(entry, "hangout");
              changes.starts.push({ agentId: m.agentId, kind: "hangout", journey: journeys[i] as Journey, startBeat: beat });
            });
          } else {
            for (const m of hangout.members) ledger.releaseAll(m.agentId);
          }
        }
      }
    }
    for (const c of due) {
      const entry = entries.get(c.agentId) as Entry;
      if (entry.journey !== null || beat < entry.nextOuting) continue;
      if (active >= SCENE_MAX_WALKERS) break;
      const rng = seedFor(c.agentId, entry.round, beat);
      const choice = pickWander({ index, ledger, rng, by: c.agentId, from: c.seat.tile });
      entry.round++;
      if (choice === null || !ledger.reserve(choice.spotId, c.agentId)) {
        entry.nextOuting = beat + SCENE_WANDER_RETRY_BEATS;
        continue;
      }
      const journey = roundTripJourney(building, c.seat.tile, choice.tile, { wait: { ms: choice.stayMs, pose: choice.pose, dir: choice.dir }, homeDir: c.seat.dir });
      if (journey === null) {
        ledger.releaseAll(c.agentId);
        entry.nextOuting = beat + SCENE_WANDER_RETRY_BEATS;
        continue;
      }
      begin(entry, "excursion");
      changes.starts.push({ agentId: c.agentId, kind: "excursion", journey, startBeat: beat });
    }
    return changes;
  }

  function handoff(request: { childId: string; parentId: string }, characters: readonly LifeCharacter[], beat: number): LifeChanges {
    const changes = emptyChanges();
    const child = characters.find((c) => c.agentId === request.childId);
    const parent = characters.find((c) => c.agentId === request.parentId);
    if (!child || !parent || request.childId === request.parentId) return changes;
    const entry = entryOf(child, beat);
    const parentEntry = entryOf(parent, beat);
    if (entry.hidden || entry.journey !== null || parentEntry.hidden) return changes;
    if (child.status === "closed" || !child.ready.has(MOVE_GROUP) || active >= SCENE_MAX_WALKERS) return changes;
    const journey = handoffJourney(building, child.seat.tile, parent.seat.tile, { homeDir: child.seat.dir });
    if (journey === null) return changes;
    begin(entry, "handoff");
    changes.starts.push({ agentId: child.agentId, kind: "handoff", journey, startBeat: beat });
    return changes;
  }

  function finished(agentId: string, beat: number): LifeChanges {
    const changes = emptyChanges();
    const entry = entries.get(agentId);
    if (!entry || entry.journey === null) return changes;
    const kind = entry.journey;
    end(entry);
    if (kind === "departure") {
      entry.hidden = true;
      changes.gone.push(agentId);
      // The status left closed during the walk: the agent comes back by elevator (R11-01); an archived agent never does.
      if (!entry.leaving && entry.status !== "closed" && entry.arrivalDue === null && fronts.length > 0) scheduleArrival(entry, beat);
      return changes;
    }
    if (kind === "excursion" || kind === "hangout") {
      ledger.releaseAll(agentId);
      entry.round++;
      entry.nextOuting = beat + beatsOf(idleSitMs(seedFor(agentId, entry.round, beat)));
    }
    return changes;
  }

  function relayout(next: BuildingLayout): LifeChanges {
    const changes = emptyChanges();
    if (next === building) return changes;
    building = next;
    index = indexSpots(building);
    fronts = elevatorFronts(building);
    schedule = ElevatorSchedule(Math.max(1, fronts.length));
    ledger = createSpotLedger();
    for (const [id, entry] of entries) {
      if (entry.journey !== null) {
        entry.journey = null;
        changes.cancels.push(id);
      }
      if (fronts.length === 0) {
        // Neither an arrival nor a departure can run without an elevator: every hidden agent is shown again.
        entry.hidden = false;
        entry.arrivalDue = null;
      } else if (entry.arrivalDue !== null) {
        entry.arrivalFront = Math.min(entry.arrivalFront, fronts.length - 1);
      }
    }
    active = 0;
    return changes;
  }

  return {
    step,
    handoff,
    finished,
    relayout,
    isGone(agentId, status, spawned) {
      const entry = entries.get(agentId);
      return entry ? entry.hidden : (status === "initializing" || spawned === true) && fronts.length > 0;
    },
    journeyOf: (agentId) => entries.get(agentId)?.journey ?? null,
    reset() {
      entries.clear();
      active = 0;
      ledger = createSpotLedger();
    },
  };
}

