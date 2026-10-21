// No upstream: written for plan 07-11.
// The office screen (OFFC-05, OFFC-06, OFFC-11 to OFFC-14, OFFC-17, OFFC-18, OFFC-21; D-01, D-03, D-04, D-05, D-06, D-09): the one registered screen.
// It reads the read-only store of 07-06, asks office.sprites for keys (once per plugin lifetime) and office.wave with ids only, and composes the
// scene with the sidebar, drawer and top bar. State changes only at store pushes, sprite settlements, visible-set changes, journey boundaries,
// selection and zoom; the only clock is the beat of the shared Animated clock bank.
import { useRpc, usePaseo, type PluginScreenProps, type PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ScrollView, Pressable, Text, View } from "react-native";
import { ZOOM_LEVELS, TILE, type ZoomCandidate } from "../shared/art-types.ts";
import type { AgentView } from "../shared/model-types.ts";
import { spritesRpc } from "../shared/sprites-rpc.ts";
import { TINT_LEVELS } from "../shared/tint.ts";
import { waveRpc } from "../shared/wave-rpc.ts";
import {
  SCENE_BEAT_MS,
  SCENE_CONTROL_PX,
  SCENE_CULL_MARGIN_PX,
  SCENE_DAY_REFRESH_BEATS,
  SCENE_DEPART_MAX_BEATS,
  SCENE_DEFAULT_VIEWPORT,
  SCENE_DRAWER_WIDTH_PX,
  SCENE_HANDOFF_PENDING_BEATS,
  SCENE_LIFE_BEAT_TIER,
  SCENE_SIDEBAR_WIDTH_PX,
  cameraFor,
  characterSheetKey,
  createLifeDirector,
  defaultZoom,
  layerKey,
  placeScene,
  roomInputsOf,
  sceneSize,
  sheetZoomFor,
  shouldRetrySprites,
  tintIndices,
  visibleLayers,
  wantedGroups,
  type LifeChanges,
  type LifeCharacter,
  type LifeDirector,
  type ScenePlacement,
  type VisibleLayer,
  zoomStep,
} from "./camera.ts";
import { useClock } from "./clocks.ts";
import { dayPhase } from "./daylight.ts";
import { drawerModel } from "./drawer-model.ts";
import { Drawer } from "./drawer.tsx";
import { EMPTY_EFFECT_QUEUE, enqueueEffect, finishEffect, type EffectQueue } from "./effects.ts";
import { buildBuilding } from "../shared/layout/building.ts";
import { DOUBLE_PRESS_BEATS, FEED_REFRESH_BEATS, SEARCH_RESULTS_MAX, SIDEBAR_MAX_ROWS } from "./limits-panels.ts";
import { EMPTY_FEED, feedDrafts, feedRows, pushFeed, type FeedState } from "./feed.ts";
import { FeedPanel } from "./feed-panel.tsx";
import { agentTarget, journeyFootAt, nextRequest, searchAgents } from "./hud.ts";
import { SearchBox } from "./search.tsx";
import { footPx, SHEET_POSE_GROUPS, type CharacterSheet } from "./life/frames.ts";
import type { Journey } from "./life/journey.ts";
import { departureModes, roomLights, trackSpawns, type LeaveMode, type SpawnBook } from "./presence.ts";
import { ROOM_ID_PREFIX } from "../shared/layout/building.ts";
import { buildModel, resolveHandoff, visibleSnapshot, workspaceLight } from "./model.ts";
import { moodLook, moodSignature, stepMoods, type MoodEntry, type MoodLook } from "./moods.ts";
import { agentName, providerChip } from "./names.ts";
import { appearanceSeed, poseFor, type PoseChoice } from "./poses.ts";
import { SCREEN_ID } from "./register.ts";
import { Scene, type SceneCharacterData, type SceneLayerData } from "./scene.tsx";
import { seasonFor } from "./season.ts";
import { Sidebar } from "./sidebar.tsx";
import { hideAllProjects, projectList, showAllProjects, toggleProject, type CameraTarget, type ProjectRow } from "./sidebar-model.ts";
import { createSpriteStore, type SpriteStore, type SpritesCall } from "./sprite-store.ts";
import { asStorePaseo, createStore } from "./store.ts";
import { text } from "./strings.ts";
import { topbarModel } from "./topbar-model.ts";
import { TopBar } from "./topbar.tsx";
import { waveTrigger, type WaveRunInput } from "./wave-trigger.ts";

// ---------------------------------------------------------------- plugin-lifetime caches (OFFC-08)

// The latest office.sprites call, assigned in an effect so the module-level store always asks through a live hook.
let latestSpritesCall: SpritesCall | null = null;
let spriteStore: SpriteStore | null = null;
// The hidden project ids of the sidebar checkboxes, kept for the plugin lifetime so leaving and reopening the screen keeps the choice.
// Not persisted across a restart: the SDK's host settings would be a write through the plugin (D-09), so the set stays in memory.
let rememberedHidden: ReadonlySet<string> = new Set<string>();

function sprites(): SpriteStore {
  if (spriteStore === null) {
    spriteStore = createSpriteStore((input) => (latestSpritesCall ? latestSpritesCall(input) : Promise.reject(new Error("no call"))));
  }
  return spriteStore;
}

// The wall clock of the screen: the day phase and the age of a newly seen agent (createdAt); the scene itself runs on beats.
const wallNow = (): number => Date.now();

// Releases what outlives a screen mount: the sprite store and its call.
export function disposeOfficeCaches(): void {
  spriteStore?.dispose();
  spriteStore = null;
  latestSpritesCall = null;
  rememberedHidden = new Set<string>();
}

export function OfficeSidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return <SidebarRow onPress={() => openScreen({ screenId: SCREEN_ID })} active={currentScreen?.screenId === SCREEN_ID} />;
}

// ---------------------------------------------------------------- helpers

interface Viewport {
  x: number;
  y: number;
  w: number;
  h: number;
}

const layerSignature = (layers: readonly VisibleLayer[]): string => layers.map((l) => `${l.areaId}#${l.segment ?? "-"}`).join("|");

interface ScrollHandle {
  scrollTo?: (options: { x?: number; y?: number; animated?: boolean }) => void;
}

function scrollTo(handle: ScrollHandle | null, options: { x?: number; y?: number }, animated = false): void {
  if (handle && typeof handle.scrollTo === "function") handle.scrollTo({ ...options, animated });
}

const numberOr = (value: unknown, fallback: number): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

// The pose choice of the status with the mood on top: its pose replaces the status pose, and a still mood stops the outings.
function moodChoice(agent: AgentView, look: MoodLook | undefined): PoseChoice {
  const base = poseFor(agent);
  if (look === undefined) return base;
  return { ...base, pose: look.pose ?? base.pose, wanders: base.wanders && !look.still };
}

// The mood input of one agent; moving is true while a journey runs.
function moodInputOf(agent: AgentView, moving: boolean) {
  return {
    agentId: agent.id,
    status: agent.status,
    pendingPermissions: agent.pendingPermissions,
    requiresAttention: agent.requiresAttention,
    attentionReason: agent.attentionReason,
    shell: agent.shell ?? null,
    lastTool: agent.lastTool,
    activity: agent.activity,
    moving,
  };
}

// The sheet groups of a seat that are wanted, as sprite keys at the scale of that character.
function sheetKeysOf(agentId: string, groups: readonly number[], scale: ZoomCandidate): string[] {
  return groups.map((g) => characterSheetKey(agentId, g, scale));
}

// ---------------------------------------------------------------- the screen

export function OfficeScreen(props: PluginScreenProps) {
  const paseo = usePaseo();
  const callSprites = useRpc(spritesRpc);
  const callWave = useRpc(waveRpc);
  const colors = props.theme.colors;
  const clocks = useClock();
  const store = sprites();

  // The calls are kept in refs and a module variable, so a changed hook identity never restarts a request.
  useEffect(() => {
    latestSpritesCall = callSprites as unknown as SpritesCall;
  }, [callSprites]);
  const waveCall = useRef(callWave);
  waveCall.current = callWave;

  // ---- store (D-09: read-only), started in an effect and disposed in its cleanup
  const office = useMemo(() => createStore(asStorePaseo(paseo)), [paseo]);
  useEffect(() => {
    void office.start();
    return () => office.dispose();
  }, [office]);
  const version = useSyncExternalStore(office.subscribe, office.getVersion);
  const snapshot = useMemo(() => office.getSnapshot(), [office, version]);
  const status = office.getStatus();
  const spriteVersion = useSyncExternalStore(store.subscribe, store.getVersion);

  // ---- hidden projects (sidebar checkboxes): applied where the building model is built
  const [hidden, setHiddenState] = useState<ReadonlySet<string>>(() => rememberedHidden);
  const setHidden = useCallback((next: ReadonlySet<string>) => {
    rememberedHidden = next;
    setHiddenState(next);
  }, []);
  const visibleSnap = useMemo(() => visibleSnapshot(snapshot, hidden), [snapshot, hidden]);

  // ---- model, building and placement
  const model = useMemo(() => buildModel(snapshot, {}, hidden), [snapshot, hidden]);
  const rooms = useMemo(() => roomInputsOf(model), [model]);
  const roomsSignature = rooms.map((r) => `${r.slot}:${r.seed}:${r.id}`).join("\n");
  const building = useMemo(() => buildBuilding(rooms), [roomsSignature]);
  const placement: ScenePlacement = useMemo(() => placeScene(building, model), [building, model]);
  const agentsById = useMemo(() => {
    const map = new Map<string, AgentView>();
    for (const a of snapshot.agents) if (!map.has(a.id)) map.set(a.id, a);
    for (const a of snapshot.departing ?? []) if (!map.has(a.id)) map.set(a.id, a);
    return map;
  }, [snapshot]);

  // ---- spawns and departures: decided once per agent, at the store change that shows it
  const spawnBook = useRef<SpawnBook | null>(null);
  const spawned = useMemo(() => {
    spawnBook.current = trackSpawns(spawnBook.current, status.state === "ready", snapshot.agents, wallNow());
    return spawnBook.current.spawned;
  }, [snapshot, status.state]);
  const departingIds = (snapshot.departing ?? []).map((a) => a.id);
  const departingSignature = departingIds.join("\n");
  const leaveBook = useRef<Map<string, LeaveMode>>(new Map());
  const leaveModes = useMemo(() => {
    leaveBook.current = departureModes(leaveBook.current, departingIds);
    return leaveBook.current;
  }, [departingSignature]);
  // Agents present when the office opened (the first character set), so an initializing one does not ride the elevator.
  const openSet = useRef<Set<string> | null>(null);
  // Beat at which each tombstone was first seen, so a tombstone that cannot leave is released after SCENE_DEPART_MAX_BEATS.
  const departSince = useRef<Map<string, number>>(new Map());

  // ---- selection, sidebar, zoom, viewport
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedAgentId;
  const [zoom, setZoom] = useState<ZoomCandidate>(() => defaultZoom(ZOOM_LEVELS));
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, w: SCENE_DEFAULT_VIEWPORT.w, h: SCENE_DEFAULT_VIEWPORT.h });
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const onSearchOpen = useCallback((open: boolean) => {
    setSearchOpen(open);
    if (!open) setQuery("");
  }, []);
  const projects = useMemo(() => projectList(snapshot, hidden, building, SIDEBAR_MAX_ROWS, query), [snapshot, hidden, building, query]);
  const results = useMemo(() => searchAgents(snapshot, query, hidden, SEARCH_RESULTS_MAX), [snapshot, query, hidden]);
  // Follow: the camera stays on this agent on every beat until it is turned off or the agent has no seat.
  const [followId, setFollowIdState] = useState<string | null>(null);
  const followRef = useRef<string | null>(null);
  const setFollowId = useCallback((id: string | null) => {
    followRef.current = id;
    setFollowIdState(id);
  }, []);
  const lastPress = useRef<{ id: string; beat: number } | null>(null);
  useEffect(() => {
    office.select(selectedAgentId);
  }, [office, selectedAgentId]);

  // ---- day, season and the layers to show
  const [dayNow, setDayNow] = useState<Date>(() => new Date());
  const day = useMemo(() => dayPhase(dayNow, TINT_LEVELS), [dayNow]);
  const season = useMemo(() => seasonFor(dayNow), [dayNow]);
  const tints = useMemo(() => tintIndices(day.position, TINT_LEVELS), [day.position]);
  const visible = useMemo(() => visibleLayers(building, zoom, viewport, SCENE_CULL_MARGIN_PX), [building, zoom, viewport]);

  // ---- life: one director and its running journeys per mount; a new building reaches the director through relayout (R11-02)
  const lifeHolder = useRef<{ director: LifeDirector; journeys: Map<string, Journey> } | null>(null);
  if (lifeHolder.current === null) {
    const director = createLifeDirector(building);
    lifeHolder.current = { director, journeys: new Map<string, Journey>() };
  }
  const life = lifeHolder.current;
  const [, setLifeVersion] = useState(0);
  const [pendingVersion, setPendingVersion] = useState(0);
  const pending = useRef<{ childId: string; parentId: string; age: number }[]>([]);
  const beat = useRef(0);
  const alive = useRef(true);

  // ---- moods (step C): stepped on the beat and at store changes; the looks change only when the signature does
  const moodBook = useRef<Map<string, MoodEntry>>(new Map());
  const moodSig = useRef("");
  const [moodVersion, setMoodVersion] = useState(0);
  const looks = useMemo(() => {
    const out = new Map<string, MoodLook>();
    for (const seat of placement.seats) {
      const agent = agentsById.get(seat.agentId);
      if (agent) out.set(seat.agentId, moodLook(moodBook.current.get(seat.agentId), moodInputOf(agent, false), beat.current));
    }
    return out;
    // moodVersion stands for the mood book ref
  }, [placement, agentsById, moodVersion]);

  // The characters: one per seat whose agent is known, with the sheet groups it wants.
  const wanted = useMemo(() => {
    const inputs = placement.seats.flatMap((seat) => {
      const agent = agentsById.get(seat.agentId);
      if (!agent) return [];
      const travels = spawned.has(seat.agentId) || leaveModes.has(seat.agentId);
      return [{ agentId: seat.agentId, status: agent.status, choice: moodChoice(agent, looks.get(seat.agentId)), handoffPending: pending.current.some((p) => p.childId === seat.agentId), travels }];
    });
    return wantedGroups(inputs);
    // pendingVersion stands for the pending ref
  }, [placement, agentsById, pendingVersion, spawned, leaveModes, looks]);

  const characterKeys = useMemo(() => {
    const out = new Map<string, { groups: number[]; scale: ZoomCandidate; keys: string[] }>();
    for (const seat of placement.seats) {
      const groups = wanted.get(seat.agentId);
      if (!groups) continue;
      const scale = sheetZoomFor(seat.isChild, zoom, ZOOM_LEVELS);
      out.set(seat.agentId, { groups, scale, keys: sheetKeysOf(seat.agentId, groups, scale) });
    }
    return out;
  }, [placement, wanted, zoom]);

  const layerKeys = useMemo(() => {
    const keys: string[] = [];
    const ctx = { zoom, season, cols: building.cols, rooms };
    for (const layer of visible) {
      for (const tint of tints) {
        keys.push(layerKey(layer, "room-layer", { ...ctx, tint }), layerKey(layer, "room-front", { ...ctx, tint }));
      }
    }
    return keys;
  }, [visible, tints, zoom, season, building, rooms]);

  const wantedKeys = useMemo(() => {
    const keys = [...layerKeys];
    for (const entry of characterKeys.values()) keys.push(...entry.keys);
    return keys;
  }, [layerKeys, characterKeys]);
  const wantedSignature = wantedKeys.join("\n");
  // Retry rounds spent on the current wanted set; a new set starts again at zero (R11-03).
  const retryRounds = useRef(0);
  useEffect(() => {
    retryRounds.current = 0;
    store.request(wantedKeys);
  }, [store, wantedSignature]);

  // Characters as the life director sees them, with the sheet groups that are loaded.
  const lifeCharacters = useMemo((): LifeCharacter[] => {
    const out: LifeCharacter[] = [];
    for (const seat of placement.seats) {
      const agent = agentsById.get(seat.agentId);
      const keyed = characterKeys.get(seat.agentId);
      if (!agent || !keyed) continue;
      const ready = new Set<number>();
      SHEET_POSE_GROUPS.forEach((_, g) => {
        const entry = store.get(characterSheetKey(seat.agentId, g, keyed.scale));
        if (entry && entry.state === "ready") ready.add(g);
      });
      out.push({ agentId: seat.agentId, seat: { tile: seat.tile, dir: seat.dir }, status: agent.status, choice: moodChoice(agent, looks.get(seat.agentId)), ready, spawned: spawned.has(seat.agentId), leave: leaveModes.get(seat.agentId) ?? null, settled: false });
    }
    // The first characters the screen has are the ones present at open: they sit at once.
    if (openSet.current === null && out.length > 0) openSet.current = new Set(out.map((c) => c.agentId));
    for (const c of out) c.settled = openSet.current?.has(c.agentId) === true;
    return out;
  }, [placement, agentsById, characterKeys, store, spriteVersion, spawned, leaveModes, looks]);

  const latest = useRef({ life, lifeCharacters, placement, building, zoom, viewport, visible, model, snapshot, wantedKeys, leaveModes, agentsById });
  latest.current = { life, lifeCharacters, placement, building, zoom, viewport, visible, model, snapshot, wantedKeys, leaveModes, agentsById };

  // A tombstone is released once its character has left; one without a seat (hidden project, beyond the caps) has nothing to show.
  const releaseDeparted = useCallback((): void => {
    const { life: current, leaveModes: modes, placement: where } = latest.current;
    const seated = new Set(where.seats.map((seat) => seat.agentId));
    const done: string[] = [];
    for (const id of modes.keys()) {
      const since = departSince.current.get(id) ?? beat.current;
      departSince.current.set(id, since);
      if (!seated.has(id) || current.director.isGone(id) || beat.current - since > SCENE_DEPART_MAX_BEATS) done.push(id);
    }
    for (const id of [...departSince.current.keys()]) if (!modes.has(id)) departSince.current.delete(id);
    if (done.length > 0) office.release(done);
  }, [office]);

  // Beat at which each running journey started, for the Follow camera.
  const journeyStarts = useRef<Map<string, number>>(new Map());
  const applyChanges = useCallback((changes: LifeChanges): boolean => {
    const current = latest.current.life;
    let changed = false;
    for (const s of changes.starts) {
      current.journeys.set(s.agentId, s.journey);
      journeyStarts.current.set(s.agentId, s.startBeat);
      changed = true;
    }
    for (const id of [...changes.cancels, ...changes.gone]) if (current.journeys.delete(id)) changed = true;
    if (changes.gone.length > 0) changed = true;
    return changed;
  }, []);

  // Resolved handoffs wait for the move sheet and a free walker slot, then walk once (OFFC-12).
  const runPending = useCallback((): boolean => {
    const list = pending.current;
    if (list.length === 0) return false;
    let changed = false;
    const kept: typeof list = [];
    for (const request of list) {
      const { life: current, lifeCharacters: characters } = latest.current;
      const result = current.director.handoff(request, characters, beat.current);
      if (result.starts.length > 0) {
        if (applyChanges(result)) changed = true;
        continue;
      }
      if (request.age + 1 < SCENE_HANDOFF_PENDING_BEATS) kept.push({ ...request, age: request.age + 1 });
    }
    const dropped = kept.length !== list.length;
    pending.current = kept;
    if (dropped) setPendingVersion((v) => v + 1);
    return changed;
  }, [applyChanges]);

  const onJourneyEnd = useCallback(
    (agentId: string) => {
      if (!alive.current) return;
      const { life: current } = latest.current;
      const changes = current.director.finished(agentId, beat.current);
      current.journeys.delete(agentId);
      applyChanges(changes);
      if (latest.current.leaveModes.has(agentId)) releaseDeparted();
      setLifeVersion((v) => v + 1);
    },
    [applyChanges, releaseDeparted],
  );

  // A new building: the director swaps its layout and keeps each agent's state; journeys of the old layout are dropped.
  // Declared before the step effect so a building change is applied before the next step.
  useEffect(() => {
    const changes = life.director.relayout(building);
    const any = changes.starts.length + changes.cancels.length + changes.gone.length > 0;
    if (applyChanges(changes) || any) setLifeVersion((v) => v + 1);
  }, [life, building]);

  // New handoffs of the store, resolved against the model, and the first step of the director for a new character set.
  useEffect(() => {
    const taken = office.takeHandoffs();
    let queued = false;
    const delivered: { kind: "handoff"; agentId: string; projectId: string | null }[] = [];
    for (const handoff of taken) {
      const resolved = resolveHandoff(latest.current.model, handoff);
      if (resolved === null) continue;
      delivered.push({ kind: "handoff", agentId: resolved.childId, projectId: resolved.projectId });
      pending.current = [...pending.current, { childId: resolved.childId, parentId: resolved.parentId, age: 0 }];
      queued = true;
    }
    if (queued) setPendingVersion((v) => v + 1);
    if (delivered.length > 0) setFeed((state) => pushFeed(state, delivered, beat.current));
  }, [office, version]);

  // ---- feed (step D): events from consecutive store snapshots once the store is ready; none for the seeds
  const [feed, setFeed] = useState<FeedState>(EMPTY_FEED);
  const [feedOpen, setFeedOpen] = useState(false);
  const feedOpenRef = useRef(false);
  feedOpenRef.current = feedOpen;
  const [, setFeedTick] = useState(0);
  // The baseline is the snapshot at the moment the store reports ready (a status change alone bumps no version, so a listener sees it).
  const feedPrev = useRef<typeof snapshot | null>(null);
  useEffect(
    () =>
      office.subscribe(() => {
        if (feedPrev.current === null && office.getStatus().state === "ready") feedPrev.current = office.getSnapshot();
      }),
    [office],
  );
  useEffect(() => {
    const prev = feedPrev.current;
    if (prev === null || prev === snapshot) return;
    feedPrev.current = snapshot;
    const drafts = feedDrafts(prev, snapshot);
    if (drafts.length > 0) setFeed((state) => pushFeed(state, drafts, beat.current));
  }, [office, snapshot]);
  useEffect(() => {
    const changed = applyChanges(life.director.step(lifeCharacters, beat.current));
    const ran = runPending();
    if (leaveModes.size > 0) releaseDeparted();
    if (changed || ran) setLifeVersion((v) => v + 1);
  }, [life, lifeCharacters, pendingVersion]);

  // ---- wave trigger (OFFC-18): ids only, no timer
  const [effects, setEffects] = useState<EffectQueue>(EMPTY_EFFECT_QUEUE);
  const trigger = useMemo(
    () =>
      waveTrigger({
        ask: (input) => waveCall.current(input) as Promise<unknown>,
        now: () => beat.current * SCENE_BEAT_MS,
        onEffect: (spec, run) => {
          if (!alive.current) return;
          const { placement: where, zoom: z } = latest.current;
          const agent = latest.current.snapshot.agents.find((a) => a.runId === run.runId && a.workspaceId === run.workspaceId);
          const seat = agent ? where.seats.find((s) => s.agentId === agent.id) : undefined;
          const area = seat ? null : latest.current.building.areas.find((a) => a.kind === "reception") ?? latest.current.building.areas[0];
          const x = seat ? footPx(seat.tile).x * z : area ? (area.rect.x + area.rect.w / 2) * TILE * z : 0;
          const y = seat ? footPx(seat.tile).y * z : area ? (area.rect.y + area.rect.h / 2) * TILE * z : 0;
          setEffects((queue) => enqueueEffect(queue, { id: spec.id, kind: spec.kind, x, y }));
        },
      }),
    [],
  );
  const runs = useMemo((): WaveRunInput[] => {
    const grouped = new Map<string, { workspaceId: string; runId: string; parts: string[] }>();
    for (const a of snapshot.agents) {
      if (a.runId === null || a.workspaceId === null) continue;
      const key = JSON.stringify([a.workspaceId, a.runId]);
      const entry = grouped.get(key) ?? { workspaceId: a.workspaceId, runId: a.runId, parts: [] };
      entry.parts.push(`${a.id}:${a.status}:${a.updatedAt ?? ""}`);
      grouped.set(key, entry);
    }
    return [...grouped.values()].map((g) => ({ workspaceId: g.workspaceId, runId: g.runId, sig: g.parts.sort().join("|") }));
  }, [snapshot]);
  const runsSignature = JSON.stringify(runs);
  useEffect(() => {
    trigger.observe(runs);
  }, [trigger, runsSignature]);
  useEffect(
    () => () => {
      trigger.dispose();
    },
    [trigger],
  );

  // One mood step: a finished wait on a shell call throws confetti at the seat; a new signature re-renders.
  const runMoods = useCallback((): void => {
    if (!alive.current) return;
    const { placement: where, agentsById: byId, life: current, zoom: z } = latest.current;
    const inputs = where.seats.flatMap((seat) => {
      const agent = byId.get(seat.agentId);
      return agent ? [moodInputOf(agent, current.journeys.has(seat.agentId))] : [];
    });
    const out = stepMoods(moodBook.current, inputs, beat.current);
    moodBook.current = out.book;
    for (const c of out.celebrations) {
      const seat = where.seats.find((s) => s.agentId === c.agentId);
      if (!seat) continue;
      const foot = footPx(seat.tile);
      setEffects((queue) => enqueueEffect(queue, { id: `shell:${appearanceSeed(`${c.agentId}\n${c.callId}`)}`, kind: "wave", x: foot.x * z, y: foot.y * z }));
    }
    const shown = new Map<string, MoodLook>();
    for (const seat of where.seats) {
      const agent = byId.get(seat.agentId);
      if (agent) shown.set(seat.agentId, moodLook(out.book.get(seat.agentId), moodInputOf(agent, false), beat.current));
    }
    const signature = moodSignature(shown);
    if (signature !== moodSig.current) {
      moodSig.current = signature;
      setMoodVersion((v) => v + 1);
    }
  }, []);
  useEffect(() => {
    runMoods();
  }, [runMoods, snapshot, placement]);

  // ---- heartbeat: a listener on one tier of the shared clock bank; state changes only when something happened
  const onBeat = useRef<() => void>(() => undefined);
  onBeat.current = () => {
    beat.current += 1;
    const { life: current, lifeCharacters: characters } = latest.current;
    let changed = applyChanges(current.director.step(characters, beat.current));
    if (runPending()) changed = true;
    if (latest.current.leaveModes.size > 0) releaseDeparted();
    runMoods();
    followStep();
    if (feedOpenRef.current && beat.current % FEED_REFRESH_BEATS === 0) setFeedTick((v) => v + 1);
    trigger.pump();
    // A wanted key whose call failed is asked again on a slow beat, a bounded number of rounds; final failures stay failed.
    if (shouldRetrySprites(beat.current, retryRounds.current)) {
      const keys = latest.current.wantedKeys;
      const transient = keys.some((key) => {
        const entry = store.get(key);
        return entry !== null && entry.state === "failed" && entry.code === "call_failed";
      });
      if (transient) {
        retryRounds.current += 1;
        store.retry(keys);
      }
    }
    if (beat.current % SCENE_DAY_REFRESH_BEATS === 0) setDayNow(new Date());
    if (changed) setLifeVersion((v) => v + 1);
  };
  useEffect(() => {
    const value = clocks[SCENE_LIFE_BEAT_TIER];
    const id = value.addListener(() => onBeat.current());
    return () => {
      value.removeListener(id);
    };
  }, [clocks]);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  // ---- camera: explicit requests applied through the scroll handles
  const outer = useRef<ScrollHandle | null>(null);
  const inner = useRef<ScrollHandle | null>(null);
  const viewRef = useRef<Viewport>({ x: 0, y: 0, w: SCENE_DEFAULT_VIEWPORT.w, h: SCENE_DEFAULT_VIEWPORT.h });
  const pushViewport = useCallback(() => {
    const view = { ...viewRef.current };
    const current = latest.current;
    const next = layerSignature(visibleLayers(current.building, current.zoom, view, SCENE_CULL_MARGIN_PX));
    if (next !== layerSignature(current.visible)) setViewport(view);
  }, []);
  const moveCamera = useCallback(
    (target: CameraTarget, animated = false) => {
      const current = latest.current;
      const cam = cameraFor(target, current.building, viewRef.current, current.zoom, current.placement);
      scrollTo(outer.current, { y: cam.y }, animated);
      scrollTo(inner.current, { x: cam.x }, animated);
      viewRef.current = { ...viewRef.current, x: cam.x, y: cam.y };
      pushViewport();
    },
    [pushViewport],
  );
  const onFocusProject = useCallback((row: ProjectRow) => moveCamera(row.target), [moveCamera]);
  // Selects an agent and moves the camera to it (search results, feed lines, Next request).
  const focusAgent = useCallback(
    (agentId: string) => {
      const agent = latest.current.agentsById.get(agentId);
      if (!agent) return;
      setSelectedAgentId(agentId);
      moveCamera(agentTarget(agent, latest.current.building));
    },
    [moveCamera],
  );
  const onNextRequest = useCallback(() => {
    const id = nextRequest(visibleSnapshot(latest.current.snapshot, rememberedHidden), selectedRef.current);
    if (id !== null) focusAgent(id);
  }, [focusAgent]);
  const onOverview = useCallback(() => {
    const smallest = defaultZoom(ZOOM_LEVELS);
    latest.current = { ...latest.current, zoom: smallest };
    setZoom(smallest);
    const current = latest.current;
    const cam = cameraFor({ scope: "building", rect: current.building.rect, roomId: null, workspaceId: null, agentId: null }, current.building, viewRef.current, smallest, current.placement);
    scrollTo(outer.current, { y: cam.y });
    scrollTo(inner.current, { x: cam.x });
    viewRef.current = { ...viewRef.current, x: cam.x, y: cam.y };
    setViewport({ ...viewRef.current });
  }, []);
  const onFollow = useCallback(() => {
    const id = selectedRef.current;
    setFollowId(followRef.current !== null && followRef.current === id ? null : id);
  }, [setFollowId]);
  // A press selects; a second press on the same character within DOUBLE_PRESS_BEATS follows it.
  const onCharacterPress = useCallback(
    (agentId: string) => {
      const last = lastPress.current;
      if (last !== null && last.id === agentId && beat.current - last.beat <= DOUBLE_PRESS_BEATS) {
        lastPress.current = null;
        setFollowId(agentId);
      } else lastPress.current = { id: agentId, beat: beat.current };
      setSelectedAgentId(agentId);
    },
    [setFollowId],
  );
  // One Follow step on the beat: the foot of the character, along its journey when it walks, centred in the view.
  const followStep = (): void => {
    const id = followRef.current;
    if (id === null) return;
    const { placement: where, life: current } = latest.current;
    const seat = where.seats.find((s) => s.agentId === id);
    if (!seat) {
      setFollowId(null);
      return;
    }
    const journey = current.journeys.get(id) ?? null;
    const started = journeyStarts.current.get(id) ?? beat.current;
    const foot = (journey ? journeyFootAt(journey, (beat.current - started) * SCENE_BEAT_MS) : null) ?? footPx(seat.tile);
    const tile = { x: Math.floor(foot.x / TILE), y: Math.floor(foot.y / TILE), w: 1, h: 1 };
    moveCamera({ scope: "room", rect: tile, roomId: seat.roomId, workspaceId: seat.workspaceId, agentId: id }, true);
  };
  const onToggleProject = useCallback((projectId: string) => setHidden(toggleProject(rememberedHidden, projectId)), [setHidden]);
  const onShowAll = useCallback(() => setHidden(showAllProjects()), [setHidden]);
  const onHideAll = useCallback(() => setHidden(hideAllProjects(latest.current.snapshot)), [setHidden]);
  const changeZoom = useCallback(
    (direction: 1 | -1) => {
      const current = latest.current.zoom;
      const next = zoomStep(current, direction, ZOOM_LEVELS);
      if (next === current) return;
      const view = viewRef.current;
      const scale = next / current;
      const x = Math.max(0, Math.round((view.x + view.w / 2) * scale - view.w / 2));
      const y = Math.max(0, Math.round((view.y + view.h / 2) * scale - view.h / 2));
      latest.current = { ...latest.current, zoom: next };
      viewRef.current = { ...view, x, y };
      scrollTo(outer.current, { y });
      scrollTo(inner.current, { x });
      setZoom(next);
      setViewport({ ...viewRef.current });
    },
    [],
  );
  const onOuterScroll = useCallback(
    (event: { nativeEvent?: { contentOffset?: { y?: number }; layoutMeasurement?: { height?: number } } }) => {
      const e = event?.nativeEvent;
      viewRef.current = { ...viewRef.current, y: numberOr(e?.contentOffset?.y, viewRef.current.y), h: numberOr(e?.layoutMeasurement?.height, viewRef.current.h) };
      pushViewport();
    },
    [pushViewport],
  );
  const onInnerScroll = useCallback(
    (event: { nativeEvent?: { contentOffset?: { x?: number }; layoutMeasurement?: { width?: number } } }) => {
      const e = event?.nativeEvent;
      viewRef.current = { ...viewRef.current, x: numberOr(e?.contentOffset?.x, viewRef.current.x), w: numberOr(e?.layoutMeasurement?.width, viewRef.current.w) };
      pushViewport();
    },
    [pushViewport],
  );
  const onLayout = useCallback(
    (event: { nativeEvent?: { layout?: { width?: number; height?: number } } }) => {
      const layout = event?.nativeEvent?.layout;
      viewRef.current = { ...viewRef.current, w: numberOr(layout?.width, viewRef.current.w), h: numberOr(layout?.height, viewRef.current.h) };
      pushViewport();
    },
    [pushViewport],
  );

  // ---- scene props
  const layers: SceneLayerData[] = visible.map((layer) => {
    const ctx = { zoom, season, cols: building.cols, rooms };
    const pick = (kind: "room-layer" | "room-front") =>
      Array.from({ length: TINT_LEVELS }, (_, tint) => {
        if (!tints.includes(tint)) return null;
        const entry = store.get(layerKey(layer, kind, { ...ctx, tint }));
        return entry && entry.state === "ready" ? entry.source : null;
      });
    return { layer, base: pick("room-layer"), front: pick("room-front") };
  });

  const characters: SceneCharacterData[] = [];
  for (const seat of placement.seats) {
    const agent = agentsById.get(seat.agentId);
    const keyed = characterKeys.get(seat.agentId);
    // An agent present at open is drawn at once even before the director has seen it (it passes as idle, not initializing).
    if (!agent || !keyed || life.director.isGone(seat.agentId, openSet.current?.has(seat.agentId) === true ? "idle" : agent.status, spawned.has(seat.agentId))) continue;
    const sheets: CharacterSheet[] = [];
    keyed.groups.forEach((g, i) => {
      const entry = store.get(keyed.keys[i] as string);
      if (entry && entry.state === "ready") sheets.push({ key: keyed.keys[i] as never, source: entry.source, poses: SHEET_POSE_GROUPS[g] as never });
    });
    const look = looks.get(seat.agentId);
    const choice = moodChoice(agent, look);
    characters.push({
      key: seat.agentId,
      sheets,
      pose: choice.pose,
      dir: look?.spinDir ?? seat.dir,
      at: seat.tile,
      journey: life.journeys.get(seat.agentId) ?? null,
      sheetZoom: keyed.scale,
      isChild: seat.isChild,
      attention: agent.requiresAttention ? agent.attentionReason : null,
      glyphs: look?.glyphs ?? [],
      blink: look?.blink === true,
      soft: look?.soft === true,
      tag: agentName(seat.agentId),
      chip: providerChip(agent.provider),
      onJourneyEnd: () => onJourneyEnd(seat.agentId),
      onPress: () => onCharacterPress(seat.agentId),
    });
  }

  const clusterOf = new Map<string, (typeof model.rooms)[number]["clusters"][number]>();
  for (const room of model.rooms) for (const cluster of room.clusters) clusterOf.set(JSON.stringify([room.projectId, cluster.workspaceId]), cluster);
  const roomNames = new Map<string, string>();
  for (const room of model.rooms) if (!roomNames.has(room.projectId)) roomNames.set(room.projectId, room.name);
  const signs = placement.clusters.flatMap((anchor) => {
    const cluster = clusterOf.get(JSON.stringify([anchor.roomId, anchor.workspaceId]));
    if (!cluster) return [];
    return [{ tile: anchor.sign, name: cluster.name, kind: cluster.kind, light: workspaceLight(cluster.status), additions: cluster.diffAdditions, deletions: cluster.diffDeletions }];
  });
  const labels = placement.labels.map((l) => ({ tile: l.tile, name: roomNames.get(l.roomId) ?? null }));
  const surplus = placement.surplus.map((s) => ({ tile: s.tile, count: s.count }));
  // Room lights: lit while someone seated in the room is on screen.
  const lights = roomLights(
    model.rooms.map((r) => r.projectId),
    placement.seats,
    (id) => {
      const agent = agentsById.get(id);
      return agent !== undefined && !life.director.isGone(id, agent.status, spawned.has(id));
    },
  );
  const shades = building.areas.flatMap((area) => {
    if (area.kind !== "room" || !area.id.startsWith(ROOM_ID_PREFIX)) return [];
    const lit = lights.get(area.id.slice(ROOM_ID_PREFIX.length));
    return lit === undefined ? [] : [{ rect: area.rect, dark: !lit }];
  });

  const drawer = drawerModel(snapshot, selectedAgentId, dayNow.getTime());
  const bar = topbarModel(visibleSnap, selectedAgentId, model.rooms.length);
  const feedLines = feedOpen ? feedRows(feed, hidden, beat.current) : [];
  const size = sceneSize(building.rect, zoom);
  const stateText = status.state === "failed" ? text("screenFailed") : status.state === "ready" ? (snapshot.projects.length === 0 ? text("sidebarEmpty") : null) : text("screenLoading");

  return (
    <View style={{ flex: 1, flexDirection: "column", backgroundColor: colors.surface1 }}>
      <TopBar model={bar} colors={colors} />
      <View style={{ flex: 1, flexDirection: "row" }}>
        <View style={{ width: SCENE_SIDEBAR_WIDTH_PX, borderRightWidth: 1, borderColor: colors.border }}>
          <SearchBox open={searchOpen} query={query} results={results} colors={colors} onOpen={onSearchOpen} onQuery={setQuery} onPick={focusAgent} />
          <Sidebar list={projects} colors={colors} onToggle={onToggleProject} onShowAll={onShowAll} onHideAll={onHideAll} onFocus={onFocusProject} />
        </View>
        <View style={{ flex: 1 }} onLayout={onLayout}>
          <ScrollView ref={outer as never} onScroll={onOuterScroll} scrollEventThrottle={32}>
            <ScrollView ref={inner as never} horizontal onScroll={onInnerScroll} scrollEventThrottle={32}>
              <Scene
                size={size}
                zoom={zoom}
                position={day.position}
                layers={layers}
                characters={characters}
                signs={signs}
                labels={labels}
                surplus={surplus}
                shades={shades}
                effects={effects.active}
                colors={colors}
                onEffectDone={(id) => setEffects((queue) => finishEffect(queue, id))}
              />
            </ScrollView>
          </ScrollView>
          {stateText !== null ? (
            <View testID="office-state" style={{ position: "absolute", left: 12, top: 12 }}>
              <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{stateText}</Text>
            </View>
          ) : null}
          <View style={{ position: "absolute", right: 12, top: 12, alignItems: "flex-end", gap: 6 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Pressable testID="office-next-request" accessibilityRole="button" accessibilityLabel={text("cameraNextRequest")} onPress={onNextRequest} style={{ height: SCENE_CONTROL_PX, paddingHorizontal: 8, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: colors.surface2 }}>
              <Text style={{ color: colors.foreground, fontSize: 12 }}>{text("cameraNextRequest")}</Text>
            </Pressable>
            <Pressable testID="office-overview" accessibilityRole="button" accessibilityLabel={text("cameraOverview")} onPress={onOverview} style={{ height: SCENE_CONTROL_PX, paddingHorizontal: 8, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: colors.surface2 }}>
              <Text style={{ color: colors.foreground, fontSize: 12 }}>{text("cameraOverview")}</Text>
            </Pressable>
            <Pressable testID="office-feed-toggle" accessibilityRole="button" accessibilityLabel={text("feedToggle")} accessibilityState={{ selected: feedOpen }} onPress={() => setFeedOpen((open) => !open)} style={{ height: SCENE_CONTROL_PX, paddingHorizontal: 8, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: feedOpen ? colors.accent : colors.surface2 }}>
              <Text style={{ color: feedOpen ? colors.surface1 : colors.foreground, fontSize: 12 }}>{text("feedToggle")}</Text>
            </Pressable>
            <Pressable testID="office-zoom-out" accessibilityRole="button" accessibilityLabel={text("sceneZoomOut")} onPress={() => changeZoom(-1)} style={{ width: SCENE_CONTROL_PX, height: SCENE_CONTROL_PX, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: colors.surface2 }}>
              <Text style={{ color: colors.foreground, fontSize: 14 }}>{text("sidebarGlyphOpen")}</Text>
            </Pressable>
            <Text testID="office-zoom-level" style={{ color: colors.foreground, fontSize: 12 }}>
              {text("sceneZoomLevel", { zoom })}
            </Text>
            <Pressable testID="office-zoom-in" accessibilityRole="button" accessibilityLabel={text("sceneZoomIn")} onPress={() => changeZoom(1)} style={{ width: SCENE_CONTROL_PX, height: SCENE_CONTROL_PX, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: colors.surface2 }}>
              <Text style={{ color: colors.foreground, fontSize: 14 }}>{text("sidebarGlyphClosed")}</Text>
            </Pressable>
          </View>
          {feedOpen ? <FeedPanel rows={feedLines} colors={colors} onPick={focusAgent} /> : null}
          </View>
        </View>
        {drawer !== null ? (
          <View style={{ width: SCENE_DRAWER_WIDTH_PX, borderLeftWidth: 1, borderColor: colors.border }}>
            <Drawer model={drawer} colors={colors} onClose={() => setSelectedAgentId(null)} following={followId !== null && followId === drawer.agentId} onFollow={onFollow} />
          </View>
        ) : null}
      </View>
    </View>
  );
}
