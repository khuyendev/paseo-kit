// Spike screen (07-03, D-12, OFFC-10): the measured scene, its measurement panel and the read-only probes of every read surface.
// Characters are clipped sheet windows stepped by two shared clocks driven by one timer; walkers move by transform only.
import { usePaseo, useRpc, type PluginScreenProps, type PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Image, Platform, Pressable, Text, View } from "react-native";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import { CHAR_AX, CHAR_AY, CHAR_H, CHAR_W, POSE_FRAMES, ZOOM_CANDIDATES, canonicalPoses, sheetCell, sheetSize, type Dir, type Pose, type ZoomCandidate } from "../shared/art-types.ts";
import { SPRITE_KEYS_PER_CALL_MAX, spritesRpc, type SpriteResult, type SpritesInput, type SpritesOutput } from "../shared/sprites-rpc.ts";
import { buildBuilding, type BuildingLayout } from "./layout/building.ts";
import { FOOT_DX, FOOT_DY, TILE } from "./layout/constants.ts";
import type { AreaLayout } from "./layout/types.ts";
import { findPath } from "./path/astar.ts";
import { FREE, gridOf, type TilePoint } from "./path/grid.ts";
import { MAX_DRAWN_CHARACTERS } from "./limits.ts";
import { SCREEN_ID } from "./register.ts";
import {
  SPIKE_AREA_IDS,
  SPIKE_AREA_SEEDS,
  SPIKE_CADENCE_WINDOW_S,
  SPIKE_COUNT_STEPS,
  SPIKE_LABELS,
  SPIKE_ROOM_ID,
  SPIKE_ROOM_SEED,
  SPIKE_STEADY_WINDOW_S,
  SPIKE_STEP_MS,
  SPIKE_TEST_IDS,
  SPIKE_TICK_MS,
  SPIKE_TICK_RING_MAX,
  SPIKE_VIEW_PARAM,
  SPIKE_WALKING_CHARACTERS,
  STATIONARY_POSES,
  WALKER_POSES,
  buildReport,
  charKey,
  createByteMeter,
  chunkKeys,
  createSurfaceLog,
  createUpdateLog,
  intervalStats,
  layerKey,
  logAgentUpdate,
  logSeed,
  recordSurface,
  rulerKey,
  sceneKeys,
  surfaceItemType,
  tintKeys,
  type ByteMeter,
  type SpikeAreaSeed,
  type SpikeSurface,
  type SurfaceEntry,
} from "./spike-hud.ts";

const NATIVE_DRIVER = Platform.OS !== "web";

// ---------------------------------------------------------------- sprite cache

type Sprite = { ok: true; source: { uri: string }; w: number; h: number; bytes: number } | { ok: false; code: string };

// One result per key and one stable source object per key, kept across rerenders and remounts.
const sprites = new Map<string, Sprite>();
const inflight = new Set<string>();

type SpriteCall = (input: SpritesInput) => Promise<SpritesOutput>;

function store(key: string, result: SpriteResult, meter: ByteMeter): void {
  if (result.ok) {
    meter.add(result.uri.length);
    sprites.set(key, { ok: true, source: { uri: result.uri }, w: result.w, h: result.h, bytes: result.uri.length });
  } else {
    sprites.set(key, { ok: false, code: result.code });
  }
}

// Asks only for keys not cached or in flight, in chunks of at most SPRITE_KEYS_PER_CALL_MAX; resolves when every chunk settled.
async function ensure(keys: readonly string[], call: SpriteCall, meter: ByteMeter, onChunk: () => void): Promise<void> {
  const wanted = [...new Set(keys)].filter((k) => !sprites.has(k) && !inflight.has(k));
  for (const k of wanted) inflight.add(k);
  await Promise.all(
    chunkKeys(wanted, SPRITE_KEYS_PER_CALL_MAX).map(async (chunk) => {
      try {
        const out = await call({ keys: chunk });
        if (!out.ok) {
          for (const k of chunk) sprites.set(k, { ok: false, code: out.code });
        } else {
          chunk.forEach((k, i) => {
            const result = out.sprites[i];
            if (result) store(k, result, meter);
            else sprites.set(k, { ok: false, code: "internal" });
          });
        }
      } catch {
        for (const k of chunk) sprites.set(k, { ok: false, code: "internal" });
      } finally {
        for (const k of chunk) inflight.delete(k);
      }
      onChunk();
    }),
  );
}

const sizeOf = (key: string): number | null => {
  const s = sprites.get(key);
  return s && s.ok ? s.bytes : null;
};

function sumBytes(keys: readonly string[]): number | null {
  let total = 0;
  for (const k of keys) {
    const n = sizeOf(k);
    if (n === null) return null;
    total += n;
  }
  return total;
}

// ---------------------------------------------------------------- scene plan

let cachedBuilding: BuildingLayout | null = null;
function building(): BuildingLayout {
  if (!cachedBuilding) cachedBuilding = buildBuilding([{ id: SPIKE_ROOM_ID, slot: 0, seed: SPIKE_ROOM_SEED }]);
  return cachedBuilding;
}

function areaOf(seed: SpikeAreaSeed): AreaLayout {
  const area = building().areas.find((a) => a.id === SPIKE_AREA_IDS[seed]);
  if (!area) throw new RangeError("spike area");
  return area;
}

// Free tiles of the walkable rectangles of one area, in reading order.
function freeTiles(seed: SpikeAreaSeed): TilePoint[] {
  const grid = gridOf(building());
  const out: TilePoint[] = [];
  for (const r of areaOf(seed).walkable) {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (grid.get(x, y) === FREE) out.push({ x, y });
  }
  return out;
}

// Approach tile of the first spot of the area that is walkable, else its first free tile.
function approachTile(seed: SpikeAreaSeed): TilePoint {
  const grid = gridOf(building());
  const spot = areaOf(seed).spots.find((s) => grid.walkable(s.tx, s.ty));
  return spot ? { x: spot.tx, y: spot.ty } : freeTiles(seed)[0]!;
}

const ROUTES: readonly (readonly [SpikeAreaSeed, SpikeAreaSeed])[] = [
  ["room", "reception"],
  ["room", "cafe"],
  ["room", "lounge"],
  ["reception", "cafe"],
  ["cafe", "lounge"],
  ["lounge", "reception"],
];

interface Placement {
  index: number;
  tile: TilePoint;
  walker: { path: TilePoint[] | null } | null;
  pose: Pose;
}

function stationaryTile(index: number): TilePoint {
  const seed = SPIKE_AREA_SEEDS[index % SPIKE_AREA_SEEDS.length]!;
  const tiles = freeTiles(seed);
  return tiles[Math.floor(index / SPIKE_AREA_SEEDS.length) % tiles.length]!;
}

function plan(count: number): Placement[] {
  const grid = gridOf(building());
  const statPoses = canonicalPoses(STATIONARY_POSES);
  const out: Placement[] = [];
  for (let i = 0; i < count; i++) {
    if (i < SPIKE_WALKING_CHARACTERS) {
      const [from, to] = ROUTES[i % ROUTES.length]!;
      const start = approachTile(from);
      out.push({ index: i, tile: start, walker: { path: findPath(grid, start, approachTile(to)) }, pose: "walk" });
    } else {
      out.push({ index: i, tile: stationaryTile(i), walker: null, pose: statPoses[(i - SPIKE_WALKING_CHARACTERS) % statPoses.length]! });
    }
  }
  return out;
}

const dirOf = (a: TilePoint, b: TilePoint): Dir => (b.x > a.x ? "right" : b.x < a.x ? "left" : b.y > a.y ? "down" : "up");

// ---------------------------------------------------------------- animated pieces

interface Clocks {
  c2: Animated.Value;
  c4: Animated.Value;
}

interface WalkerState {
  index: number;
  pos: Animated.ValueXY;
  row: Animated.Value;
  path: TilePoint[] | null;
  start: TilePoint;
}

// Tile to the pixel position of a character window's top-left corner at this zoom.
const windowX = (tile: TilePoint, z: number): number => (tile.x * TILE + FOOT_DX - CHAR_AX) * z;
const windowY = (tile: TilePoint, z: number): number => (tile.y * TILE + FOOT_DY - CHAR_AY) * z;

function frameInterp(clock: Animated.Value, frames: number, z: number) {
  return clock.interpolate({ inputRange: [0, frames - 1], outputRange: [0, -(frames - 1) * CHAR_W * z] });
}

function Window({ index, sprite, z, translateX, translateY }: { index: number; sprite: Extract<Sprite, { ok: true }>; z: number; translateX: unknown; translateY: unknown }) {
  return (
    <View testID={SPIKE_TEST_IDS.char(index)} style={{ width: CHAR_W * z, height: CHAR_H * z, overflow: "hidden" }}>
      <Animated.Image
        source={sprite.source}
        style={{ position: "absolute", left: 0, top: 0, width: sprite.w, height: sprite.h, transform: [{ translateX }, { translateY }] } as never}
      />
    </View>
  );
}

function StaticChar({ placement, sprite, z, clocks }: { placement: Placement; sprite: Extract<Sprite, { ok: true }>; z: number; clocks: Clocks }) {
  const row = sheetCell(STATIONARY_POSES, placement.pose, "down", 0).row;
  const frames = POSE_FRAMES[placement.pose];
  const clock = frames === 4 ? clocks.c4 : clocks.c2;
  return (
    <View style={{ position: "absolute", left: windowX(placement.tile, z), top: windowY(placement.tile, z) }}>
      <Window index={placement.index} sprite={sprite} z={z} translateX={frameInterp(clock, frames, z)} translateY={-row * CHAR_H * z} />
    </View>
  );
}

function WalkerChar({ walker, sprite, z, clocks }: { walker: WalkerState; sprite: Extract<Sprite, { ok: true }>; z: number; clocks: Clocks }) {
  const rows = sheetSize(WALKER_POSES).rows;
  const rowShift = walker.row.interpolate({ inputRange: [0, rows - 1], outputRange: [0, -(rows - 1) * CHAR_H * z] });
  return (
    <Animated.View
      testID={SPIKE_TEST_IDS.walker(walker.index)}
      style={{ position: "absolute", left: 0, top: 0, transform: [{ translateX: walker.pos.x }, { translateY: walker.pos.y }] }}
    >
      <Window index={walker.index} sprite={sprite} z={z} translateX={frameInterp(clocks.c4, POSE_FRAMES.walk, z)} translateY={rowShift} />
    </Animated.View>
  );
}

function makeWalkers(placements: readonly Placement[], z: number): WalkerState[] {
  const rowOf = (dir: Dir) => sheetCell(WALKER_POSES, "walk", dir, 0).row;
  return placements
    .filter((p) => p.walker)
    .map((p) => ({
      index: p.index,
      pos: new Animated.ValueXY({ x: windowX(p.tile, z), y: windowY(p.tile, z) }),
      row: new Animated.Value(rowOf("down")),
      path: p.walker!.path,
      start: p.tile,
    }));
}

// Forth and back along the path: straight runs are one timing, each turn switches the direction row with a zero-duration timing.
function walkerLoop(w: WalkerState, z: number) {
  const path = w.path;
  if (!path || path.length === 0) return null;
  const rowOf = (dir: Dir) => sheetCell(WALKER_POSES, "walk", dir, 0).row;
  const points = [w.start, ...path];
  const legs = (pts: TilePoint[]) => {
    const steps: ReturnType<typeof Animated.timing>[] = [];
    let i = 0;
    while (i < pts.length - 1) {
      const dir = dirOf(pts[i]!, pts[i + 1]!);
      let j = i + 1;
      while (j < pts.length - 1 && dirOf(pts[j]!, pts[j + 1]!) === dir) j++;
      steps.push(Animated.timing(w.row, { toValue: rowOf(dir), duration: 0, easing: Easing.linear, useNativeDriver: NATIVE_DRIVER }));
      const end = pts[j]!;
      steps.push(Animated.timing(w.pos, { toValue: { x: windowX(end, z), y: windowY(end, z) }, duration: (j - i) * SPIKE_STEP_MS, easing: Easing.linear, useNativeDriver: NATIVE_DRIVER }));
      i = j;
    }
    return steps;
  };
  return Animated.loop(Animated.sequence([...legs(points), ...legs([...points].reverse())]));
}

// ---------------------------------------------------------------- measurement state

interface Measured {
  cadence: { windowSeconds: number; ticks: number; medianMs: number | null; p95Ms: number | null };
  steady: { windowSeconds: number; bytes: number | null };
  firstLoadBytes: Record<string, number>;
  tintBytes: Record<string, number[]>;
  zoomMeasured: number;
  animated: number;
  walking: number;
}

const EMPTY_MEASURED: Measured = {
  cadence: { windowSeconds: SPIKE_CADENCE_WINDOW_S, ticks: 0, medianMs: null, p95Ms: null },
  steady: { windowSeconds: SPIKE_STEADY_WINDOW_S, bytes: null },
  firstLoadBytes: {},
  tintBytes: {},
  zoomMeasured: ZOOM_CANDIDATES[0],
  animated: 0,
  walking: 0,
};

const arrayLength = (value: unknown, ...keys: string[]): number => {
  if (typeof value !== "object" || value === null) return 0;
  for (const key of keys) {
    const list = (value as Record<string, unknown>)[key];
    if (Array.isArray(list)) return list.length;
  }
  return 0;
};

const errorText = (error: unknown): string => (error instanceof Error ? error.message : typeof error === "string" ? error : "error");

function firstRunningAgent(entries: unknown): string | null {
  if (!Array.isArray(entries)) return null;
  for (const entry of entries) {
    const agent = (entry as { agent?: { id?: unknown; status?: unknown } } | null)?.agent;
    if (agent && agent.status === "running" && typeof agent.id === "string") return agent.id;
  }
  return null;
}

// ---------------------------------------------------------------- screen

export function SpikeScreen(_props: PluginScreenProps) {
  const paseo = usePaseo();
  const call = useRpc(spritesRpc);
  const [zoom, setZoom] = useState<ZoomCandidate>(ZOOM_CANDIDATES[0]);
  const [count, setCount] = useState<number>(MAX_DRAWN_CHARACTERS);
  const [, setVersion] = useState(0);
  const [phase, setPhase] = useState<"idle" | "measure" | "cadence" | "steady">("idle");
  const [smoothness, setSmoothness] = useState<{ zoom: number; answer: "yes" | "no" } | null>(null);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const clocks = useRef<Clocks | null>(null);
  if (!clocks.current) clocks.current = { c2: new Animated.Value(0), c4: new Animated.Value(0) };
  const meter = useRef<ByteMeter | null>(null);
  if (!meter.current) meter.current = createByteMeter();
  const surfaces = useRef(createSurfaceLog());
  const updates = useRef(createUpdateLog(undefined, Date.now()));
  const measured = useRef<Measured>(EMPTY_MEASURED);
  const measuredAt = useRef(new Date().toISOString());
  const ring = useRef({ buf: new Float64Array(SPIKE_TICK_RING_MAX), seq: 0, last: 0 });
  const timeouts = useRef(new Set<ReturnType<typeof setTimeout>>());
  const live = useRef(true);

  const record = useCallback(
    (surface: SpikeSurface, entry: SurfaceEntry) => {
      recordSurface(surfaces.current, surface, entry);
      bump();
    },
    [bump],
  );

  const placements = useMemo(() => plan(count), [count]);
  const walkers = useMemo(() => makeWalkers(placements, zoom), [placements, zoom]);

  // The one timer: steps both clocks and records the interval since the previous tick; no state is set per tick.
  useEffect(() => {
    const state = ring.current;
    state.last = Date.now();
    let n = 0;
    const timer = setInterval(() => {
      n += 1;
      clocks.current!.c2.setValue(n % 2);
      clocks.current!.c4.setValue(n % 4);
      const now = Date.now();
      state.buf[state.seq % SPIKE_TICK_RING_MAX] = now - state.last;
      state.seq += 1;
      state.last = now;
    }, SPIKE_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // Walkers: forth and back by transform, stopped when the set changes or the screen unmounts.
  useEffect(() => {
    const loops = walkers.map((w) => walkerLoop(w, zoom)).filter((l): l is NonNullable<typeof l> => l !== null);
    for (const loop of loops) loop.start();
    return () => {
      for (const loop of loops) loop.stop();
    };
  }, [walkers, zoom]);

  // Sprites of the scene at the selected zoom and count.
  useEffect(() => {
    void ensure(sceneKeys(zoom, count), call, meter.current!, bump);
  }, [zoom, count]);

  // Agents: seed and live updates, through the SDK only.
  useEffect(() => {
    live.current = true;
    const releases: (() => unknown)[] = [];
    let timelineStarted = false;

    const probeTimeline = (agentId: string) => {
      if (timelineStarted || !live.current) return;
      timelineStarted = true;
      record("timeline", { outcome: "pending" });
      void (async () => {
        try {
          const handle = paseo.agents.ref(agentId).timeline;
          const sub = handle.subscribe((event) => {
            const item = (event as { event?: { item?: unknown } } | null)?.event?.item;
            record("timeline", { updates: 1, types: { [surfaceItemType(item)]: 1 } });
          });
          releases.push(() => sub.release());
          await sub.ready;
          const page = await handle.refetch({ limit: 1 });
          const types: Record<string, number> = {};
          const entries = (page as { entries?: unknown } | null)?.entries;
          const list = Array.isArray(entries) ? entries : [];
          for (const entry of list) {
            const t = surfaceItemType((entry as { item?: unknown } | null)?.item);
            types[t] = (types[t] ?? 0) + 1;
          }
          record("timeline", { outcome: "ok", seed: list.length, types, message: "" });
        } catch (error) {
          record("timeline", { outcome: "error", message: errorText(error) });
        }
      })();
    };

    void (async () => {
      record("agents", { outcome: "pending" });
      try {
        const res = await paseo.agents.list({ subscribe: {} });
        if (!live.current) {
          void res.subscription?.release();
          return;
        }
        releases.push(() => res.subscription?.release());
        logSeed(updates.current, res.entries.length, Date.now());
        record("agents", { outcome: "ok", seed: res.entries.length, message: "" });
        const running = firstRunningAgent(res.entries);
        if (running) probeTimeline(running);
      } catch (error) {
        record("agents", { outcome: "error", message: errorText(error) });
      }
      if (!live.current) return;
      releases.push(
        paseo.agents.subscribe((update) => {
          logAgentUpdate(updates.current, update, Date.now());
          recordSurface(surfaces.current, "agents", { updates: 1 });
          const agent = (update as { kind?: unknown; agent?: { id?: unknown; status?: unknown } } | null)?.agent;
          if ((update as { kind?: unknown } | null)?.kind === "upsert" && agent?.status === "running" && typeof agent.id === "string") probeTimeline(agent.id);
          bump();
        }),
      );
    })();

    // Every other read surface is probed once, each independent of the others, none with a timer.
    void (async () => {
      record("workspaces", { outcome: "pending" });
      try {
        const res = await paseo.workspaces.list({ subscribe: {} });
        if (!live.current) {
          void res.subscription?.release();
          return;
        }
        releases.push(() => res.subscription?.release());
        releases.push(paseo.workspaces.subscribe(() => record("workspaces", { updates: 1 })));
        record("workspaces", { outcome: "ok", seed: arrayLength(res, "entries"), message: "" });
      } catch (error) {
        record("workspaces", { outcome: "error", message: errorText(error) });
      }
    })();
    void (async () => {
      record("projects", { outcome: "pending" });
      try {
        const res = await paseo.projects.list();
        if (!live.current) return;
        releases.push(
          paseo.projects.subscribe(() => {
            recordSurface(surfaces.current, "events", { updates: 1 });
            record("projects", { updates: 1 });
          }),
        );
        record("projects", { outcome: "ok", seed: arrayLength(res, "projects", "entries"), message: "" });
      } catch (error) {
        record("projects", { outcome: "error", message: errorText(error) });
      }
    })();
    void (async () => {
      record("events", { outcome: "pending" });
      try {
        const sub = paseo.observeEvents(["project.update"]);
        releases.push(() => sub.release());
        await sub.ready;
        record("events", { outcome: "ok", message: "" });
      } catch (error) {
        record("events", { outcome: "error", message: errorText(error) });
      }
    })();

    return () => {
      live.current = false;
      for (const release of releases) {
        try {
          const result = release();
          if (result && typeof (result as Promise<unknown>).catch === "function") void (result as Promise<unknown>).catch(() => {});
        } catch {
          // A release that throws must not block the others.
        }
      }
      for (const t of timeouts.current) clearTimeout(t);
      timeouts.current.clear();
    };
  }, []);

  const later = useCallback((ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timeouts.current.delete(t);
      if (live.current) fn();
    }, ms);
    timeouts.current.add(t);
  }, []);

  const touch = () => {
    measuredAt.current = new Date().toISOString();
    bump();
  };

  const measurePayload = () => {
    setPhase("measure");
    void (async () => {
      const first: Record<string, number> = { ...measured.current.firstLoadBytes };
      const tint: Record<string, number[]> = { ...measured.current.tintBytes };
      for (const z of ZOOM_CANDIDATES) {
        const keys = [...sceneKeys(z, MAX_DRAWN_CHARACTERS), ...[1, 2, 3, 4].flatMap((i) => tintKeys(z, i))];
        await ensure(keys, call, meter.current!, bump);
        const base = sumBytes(sceneKeys(z, MAX_DRAWN_CHARACTERS));
        const variants = [1, 2, 3, 4].map((i) => sumBytes(tintKeys(z, i)));
        if (base !== null) first[String(z)] = base;
        if (variants.every((v): v is number => v !== null)) tint[String(z)] = variants;
      }
      measured.current = { ...measured.current, firstLoadBytes: first, tintBytes: tint };
      if (!live.current) return;
      setPhase("idle");
      touch();
    })();
  };

  const cadenceWindow = () => {
    const start = ring.current.seq;
    setPhase("cadence");
    setSmoothness(null);
    later(SPIKE_CADENCE_WINDOW_S * 1000, () => {
      const r = ring.current;
      const from = Math.max(start, r.seq - SPIKE_TICK_RING_MAX);
      const samples: number[] = [];
      for (let i = from; i < r.seq; i++) samples.push(r.buf[i % SPIKE_TICK_RING_MAX]!);
      const stats = intervalStats(samples);
      measured.current = {
        ...measured.current,
        cadence: { windowSeconds: SPIKE_CADENCE_WINDOW_S, ticks: stats.count, medianMs: stats.medianMs, p95Ms: stats.p95Ms },
        zoomMeasured: zoom,
        animated: count,
        walking: Math.min(count, SPIKE_WALKING_CHARACTERS),
      };
      setPhase("idle");
      touch();
    });
  };

  const steadyWindow = () => {
    const mark = meter.current!.mark(Date.now());
    setPhase("steady");
    later(SPIKE_STEADY_WINDOW_S * 1000, () => {
      measured.current = { ...measured.current, steady: { windowSeconds: SPIKE_STEADY_WINDOW_S, bytes: meter.current!.since(mark) } };
      setPhase("idle");
      touch();
    });
  };

  const report = buildReport({
    measuredAt: measuredAt.current,
    animatedCharacters: measured.current.animated,
    walkingCharacters: measured.current.walking,
    zoomMeasured: measured.current.zoomMeasured,
    cadence: measured.current.cadence,
    firstLoadBytes: measured.current.firstLoadBytes,
    tintBytes: measured.current.tintBytes,
    steadyState: measured.current.steady,
    crispness: { "2": null, "3": null, "4": null },
    surfaces: surfaces.current,
    smoothness,
    log: updates.current,
  });

  const clocksNow = clocks.current;
  const sheetOf = (key: string): Extract<Sprite, { ok: true }> | null => {
    const s = sprites.get(key);
    return s && s.ok ? s : null;
  };
  const ruler = sheetOf(rulerKey(zoom));
  const crispChar = sheetOf(charKey(0, zoom));
  const sceneWidth = 48 * TILE * zoom;
  const sceneHeight = 29 * TILE * zoom;
  const button = (id: string, label: string, onPress: () => void, active = false) => (
    <Pressable key={id} testID={id} onPress={onPress} style={{ paddingHorizontal: 10, paddingVertical: 6, margin: 2, borderWidth: 1, opacity: active ? 1 : 0.7 }}>
      <Text>{label}</Text>
    </Pressable>
  );

  return (
    <ScrollView>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center" }}>
        <Text>{SPIKE_LABELS.zoom}</Text>
        {ZOOM_CANDIDATES.map((z) => button(SPIKE_TEST_IDS.zoom(z), String(z), () => setZoom(z), z === zoom))}
        <Text>{SPIKE_LABELS.count}</Text>
        {SPIKE_COUNT_STEPS.map((n) => button(SPIKE_TEST_IDS.count(n), String(n), () => setCount(n), n === count))}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {button(SPIKE_TEST_IDS.measure, SPIKE_LABELS.measure, measurePayload, phase === "measure")}
        {button(SPIKE_TEST_IDS.cadence, SPIKE_LABELS.cadence, cadenceWindow, phase === "cadence")}
        {button(SPIKE_TEST_IDS.steady, SPIKE_LABELS.steady, steadyWindow, phase === "steady")}
      </View>
      <ScrollView horizontal>
        <ScrollView>
          <View style={{ width: sceneWidth, height: sceneHeight }}>
            {SPIKE_AREA_SEEDS.map((seed) => {
              const sprite = sheetOf(layerKey(seed, zoom, 0));
              const rect = areaOf(seed).rect;
              if (!sprite) return null;
              return (
                <Image
                  key={seed}
                  testID={SPIKE_TEST_IDS.layer(seed)}
                  source={sprite.source}
                  style={{ position: "absolute", left: rect.x * TILE * zoom, top: rect.y * TILE * zoom, width: sprite.w, height: sprite.h }}
                />
              );
            })}
            {placements.map((p) => {
              const sprite = sheetOf(charKey(p.index, zoom));
              if (!sprite) return null;
              const walker = p.walker ? walkers.find((w) => w.index === p.index) : undefined;
              if (walker) return <WalkerChar key={p.index} walker={walker} sprite={sprite} z={zoom} clocks={clocksNow} />;
              return <StaticChar key={p.index} placement={p} sprite={sprite} z={zoom} clocks={clocksNow} />;
            })}
          </View>
        </ScrollView>
      </ScrollView>
      {walkers.some((w) => w.path === null) ? <Text>{SPIKE_LABELS.stillWalker}</Text> : null}
      <View style={{ backgroundColor: "#ffffff", padding: 8, flexDirection: "row" }}>
        {ruler ? <Image testID={SPIKE_TEST_IDS.ruler} source={ruler.source} style={{ width: ruler.w, height: ruler.h }} /> : null}
        {crispChar ? (
          <View testID={SPIKE_TEST_IDS.crispChar} style={{ width: CHAR_W * zoom, height: CHAR_H * zoom, overflow: "hidden", marginLeft: 8 }}>
            <Image source={crispChar.source} style={{ width: crispChar.w, height: crispChar.h }} />
          </View>
        ) : null}
      </View>
      <Text>{SPIKE_LABELS.crispness}</Text>
      {phase === "cadence" || measured.current.cadence.ticks > 0 ? (
        <View>
          <Text>{SPIKE_LABELS.smoothnessQuestion}</Text>
          <View style={{ flexDirection: "row" }}>
            {button(SPIKE_TEST_IDS.smoothYes, SPIKE_LABELS.yes, () => setSmoothness({ zoom: measured.current.zoomMeasured, answer: "yes" }))}
            {button(SPIKE_TEST_IDS.smoothNo, SPIKE_LABELS.no, () => setSmoothness({ zoom: measured.current.zoomMeasured, answer: "no" }))}
          </View>
        </View>
      ) : null}
      <Text>{SPIKE_LABELS.reportTitle}</Text>
      <Text testID={SPIKE_TEST_IDS.report} selectable>
        {report.text}
      </Text>
    </ScrollView>
  );
}

export function SpikeSidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      label={SPIKE_LABELS.sidebar}
      onPress={() => openScreen({ screenId: SCREEN_ID, params: { view: SPIKE_VIEW_PARAM } })}
      active={currentScreen?.screenId === SCREEN_ID}
    />
  );
}
