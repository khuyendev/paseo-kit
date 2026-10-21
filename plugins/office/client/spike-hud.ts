// Pure measurement logic of the Wave 0 spike (07-03, D-12, OFFC-10): keys, interval statistics, byte meter, agent update log,
// read-surface log, verdict and report. No react, react-native or host import: the screen only wires it.
import { ZOOM_CANDIDATES, selectZoomLevels, type Pose, type ZoomCandidate } from "../shared/art-types.ts";
import { SPRITE_KEYS_PER_CALL_MAX, SPRITE_TINT_INDEX_MAX, spriteKey } from "../shared/sprites-rpc.ts";
import { selectTintLevels, type TintCandidate } from "../shared/tint.ts";
import { MAX_DRAWN_CHARACTERS } from "./limits.ts";

export const SPIKE_VIEW_PARAM = "spike";
export const SPIKE_TICK_MS = 100;
export const SPIKE_CADENCE_WINDOW_S = 30;
export const SPIKE_STEADY_WINDOW_S = 60;
export const SPIKE_WALKING_CHARACTERS = 6;
export const SPIKE_ROOM_ID = "spike-room";
export const SPIKE_ROOM_SEED = 7;
export const SPIKE_LOG_MAX_LINES = 200;
export const SPIKE_COUNT_STEPS = [3, 8, 16, MAX_DRAWN_CHARACTERS] as const;
// Milliseconds a walker needs per tile.
export const SPIKE_STEP_MS = 320;
// Bounded ring of tick intervals.
export const SPIKE_TICK_RING_MAX = 4096;
export const SPIKE_LINE_MAX_CHARS = 160;
export const SPIKE_MESSAGE_MAX_CHARS = 80;

export const SPIKE_LIMITS = {
  cadenceMedianMsMax: 125,
  cadenceP95MsMax: 250,
  firstLoadBytesMax: 2000000,
  steadyBytesMax: 50000,
} as const;
export type SpikeLimits = { [K in keyof typeof SPIKE_LIMITS]: number };

// The five measured layers, in drawing order; the seed names the area.
export const SPIKE_AREA_SEEDS = ["corridor", "room", "reception", "cafe", "lounge"] as const;
export type SpikeAreaSeed = (typeof SPIKE_AREA_SEEDS)[number];
// Area id of buildBuilding([{ id: SPIKE_ROOM_ID, slot: 0, seed: SPIKE_ROOM_SEED }]) per layer seed.
export const SPIKE_AREA_IDS: Readonly<Record<SpikeAreaSeed, string>> = {
  corridor: "core:corridor",
  room: `room:${SPIKE_ROOM_ID}`,
  reception: "core:reception",
  cafe: "core:cafe",
  lounge: "core:lounge",
};

export const WALKER_POSES: readonly Pose[] = ["walk", "stand"];
export const STATIONARY_POSES: readonly Pose[] = ["stand", "sit", "type", "read", "use", "wait"];
export const SPIKE_RULER_SEED = "spike-ruler";

export const SPIKE_TEST_IDS = {
  count: (n: number) => `spike-count-${n}`,
  zoom: (z: number) => `spike-zoom-${z}`,
  measure: "spike-measure",
  cadence: "spike-cadence",
  steady: "spike-steady",
  report: "spike-report",
  smoothYes: "spike-smooth-yes",
  smoothNo: "spike-smooth-no",
  layer: (seed: string) => `spike-layer-${seed}`,
  ruler: "spike-ruler",
  crispChar: "spike-crisp-char",
  char: (i: number) => `spike-char-${i}`,
  walker: (i: number) => `spike-walker-${i}`,
  log: "spike-log",
} as const;

// Every visible word of the spike screen; the screen has no text literal.
export const SPIKE_LABELS = {
  sidebar: "Office spike",
  zoom: "Zoom",
  count: "Characters",
  measure: "Measure payload",
  cadence: "Cadence window",
  steady: "Steady window",
  crispness: "Inspect the edges of the ruler and the character at each zoom for any intermediate colour.",
  smoothnessQuestion:
    "During the cadence window, with 32 characters and 6 walkers, did the characters move without visible stutter, freezing, skipped steps or flicker?",
  yes: "yes",
  no: "no",
  stillWalker: "A walker has no path and stays still.",
  running: "running",
  idle: "idle",
  seconds: "s",
  logTitle: "Agent updates",
  reportTitle: "Report",
  surfacesTitle: "Read surfaces",
  empty: "",
} as const;

// ---------------------------------------------------------------- keys

function charSeed(index: number): string {
  return `spikec${String(index).padStart(2, "0")}`;
}

export function charPoses(index: number): readonly Pose[] {
  return index < SPIKE_WALKING_CHARACTERS ? WALKER_POSES : STATIONARY_POSES;
}

export function rulerKey(zoom: ZoomCandidate): string {
  return spriteKey({ kind: "ruler", seed: SPIKE_RULER_SEED, poses: [], scale: zoom, tint: 0 });
}

export function layerKey(seed: SpikeAreaSeed, zoom: ZoomCandidate, tint: number): string {
  return spriteKey({ kind: "spike-room", seed, poses: [], scale: zoom, tint });
}

export function charKey(index: number, zoom: ZoomCandidate): string {
  return spriteKey({ kind: "spike-char", seed: charSeed(index), poses: charPoses(index), scale: zoom, tint: 0 });
}

// The ruler, the five layers and one sheet per character, deduplicated in order.
export function sceneKeys(zoom: ZoomCandidate, count: number): string[] {
  const keys = [rulerKey(zoom), ...SPIKE_AREA_SEEDS.map((seed) => layerKey(seed, zoom, 0))];
  const n = Math.max(0, Math.min(MAX_DRAWN_CHARACTERS, Math.floor(Number.isFinite(count) ? count : 0)));
  for (let i = 0; i < n; i++) keys.push(charKey(i, zoom));
  return [...new Set(keys)];
}

// The five layers at one tint variant; throws RangeError outside 1 to SPRITE_TINT_INDEX_MAX.
export function tintKeys(zoom: ZoomCandidate, index: number): string[] {
  if (!Number.isInteger(index) || index < 1 || index > SPRITE_TINT_INDEX_MAX) throw new RangeError("tint index");
  return SPIKE_AREA_SEEDS.map((seed) => layerKey(seed, zoom, index));
}

export function chunkKeys(keys: readonly string[], max: number = SPRITE_KEYS_PER_CALL_MAX): string[][] {
  const size = Math.max(1, Math.floor(max));
  const out: string[][] = [];
  for (let i = 0; i < keys.length; i += size) out.push(keys.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------- statistics and bytes

export interface IntervalStats {
  count: number;
  medianMs: number | null;
  p95Ms: number | null;
}

// Non-finite and negative samples are ignored; p95 is the nearest rank.
export function intervalStats(samples: readonly number[]): IntervalStats {
  const sorted = samples.filter((s) => typeof s === "number" && Number.isFinite(s) && s >= 0).sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return { count: 0, medianMs: null, p95Ms: null };
  const mid = n >> 1;
  const medianMs = n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  const rank = Math.ceil((n * 95) / 100);
  return { count: n, medianMs, p95Ms: sorted[Math.max(0, rank - 1)]! };
}

// No class syntax in client code: the phone app's Hermes cannot compile it (see test/host.test.mjs).
export interface ByteMeter {
  readonly bytes: number;
  add(n: number): void;
  total(): number;
  mark(now: number): { at: number; bytes: number };
  since(mark: { bytes: number }): number;
}

export function createByteMeter(): ByteMeter {
  let bytes = 0;
  return {
    get bytes() {
      return bytes;
    },
    add(n) {
      if (typeof n === "number" && Number.isFinite(n) && n > 0) bytes += n;
    },
    total: () => bytes,
    mark: (now) => ({ at: now, bytes }),
    since: (mark) => bytes - mark.bytes,
  };
}

// ---------------------------------------------------------------- sanitizing

// Removes control characters and backticks, then cuts; agent-provided text never leaves through another path.
export function cleanText(value: unknown, max: number): string {
  let text: string;
  if (typeof value === "string") text = value;
  else if (typeof value === "number" || typeof value === "boolean") text = String(value);
  else return "";
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f-\u009f`]/g, "").slice(0, max);
}

// ---------------------------------------------------------------- agent update log

const RUN_LABEL = "harness.run";
const PARENT_LABEL = "paseo.parent-agent-id";

interface AgentSnapshot {
  status: string;
  attention: string;
  permissions: number;
  run: string;
  parent: string;
}

export interface UpdateLog {
  readonly max: number;
  readonly lines: string[];
  readonly seen: Map<string, AgentSnapshot>;
  startMs: number;
  dropped: number;
  upserts: number;
  removes: number;
  quiet: number;
  malformed: number;
  seeded: number;
}

export function createUpdateLog(max: number = SPIKE_LOG_MAX_LINES, startMs = 0): UpdateLog {
  return { max: Math.max(1, Math.floor(max)), lines: [], seen: new Map(), startMs, dropped: 0, upserts: 0, removes: 0, quiet: 0, malformed: 0, seeded: 0 };
}

function pushLine(log: UpdateLog, line: string): void {
  log.lines.push(cleanText(line, SPIKE_LINE_MAX_CHARS));
  while (log.lines.length > log.max) {
    log.lines.shift();
    log.dropped++;
  }
}

function stamp(log: UpdateLog, nowMs: number): string {
  const secs = Number.isFinite(nowMs) ? Math.max(0, (nowMs - log.startMs) / 1000) : 0;
  return `+${secs.toFixed(1)}s`;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function snapshotOf(agent: Record<string, unknown>): AgentSnapshot {
  const labels = isRecord(agent.labels) ? agent.labels : {};
  const permissions = Array.isArray(agent.pendingPermissions) ? agent.pendingPermissions.length : 0;
  const attention = agent.requiresAttention === true ? cleanText(agent.attentionReason, 16) || "yes" : "none";
  return {
    status: cleanText(agent.status, 16) || "unknown",
    attention,
    permissions,
    run: cleanText(labels[RUN_LABEL], 16),
    parent: cleanText(labels[PARENT_LABEL], 16),
  };
}

// Records one agent_update payload (any shape) as at most one line; never throws.
export function logAgentUpdate(log: UpdateLog, update: unknown, nowMs: number): void {
  if (!isRecord(update)) {
    log.malformed++;
    return;
  }
  if (update.kind === "remove") {
    const id = typeof update.agentId === "string" ? update.agentId : "";
    if (id === "") {
      log.malformed++;
      return;
    }
    log.removes++;
    log.seen.delete(id);
    pushLine(log, `${stamp(log, nowMs)} ${cleanText(id, 8)} removed`);
    return;
  }
  if (update.kind !== "upsert" || !isRecord(update.agent) || typeof update.agent.id !== "string" || update.agent.id === "") {
    log.malformed++;
    return;
  }
  log.upserts++;
  const id = update.agent.id;
  const next = snapshotOf(update.agent);
  const prev = log.seen.get(id);
  log.seen.set(id, next);
  const parts: string[] = [];
  if (!prev) {
    parts.push(`new status ${next.status}`);
    if (next.attention !== "none") parts.push(`attention ${next.attention}`);
    if (next.run) parts.push(`run=${next.run}`);
    if (next.parent) parts.push(`parent=${next.parent}`);
  } else {
    if (prev.status !== next.status) parts.push(`status ${prev.status} to ${next.status}`);
    if (prev.attention !== next.attention) parts.push(`attention ${prev.attention} to ${next.attention}`);
    if (prev.permissions !== next.permissions) parts.push(`permissions ${prev.permissions} to ${next.permissions}`);
    if (prev.run !== next.run) parts.push(`run=${next.run || "none"}`);
    if (prev.parent !== next.parent) parts.push(`parent=${next.parent || "none"}`);
  }
  if (parts.length === 0) {
    log.quiet++;
    return;
  }
  pushLine(log, `${stamp(log, nowMs)} ${cleanText(id, 8)} ${parts.join(" ")}`);
}

// One line for the agents the list call returned.
export function logSeed(log: UpdateLog, count: number, nowMs: number): void {
  log.seeded = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  pushLine(log, `${stamp(log, nowMs)} seeded ${log.seeded} agents`);
}

// ---------------------------------------------------------------- read surfaces

export const SPIKE_SURFACES = ["agents", "workspaces", "projects", "events", "timeline"] as const;
export type SpikeSurface = (typeof SPIKE_SURFACES)[number];
export const SURFACE_ITEM_TYPES = ["todo", "tool_call", "reasoning", "assistant_message", "user_message", "error", "compaction", "other"] as const;
export type SurfaceItemType = (typeof SURFACE_ITEM_TYPES)[number];
export type SurfaceOutcome = "ok" | "error" | "pending" | "not_run";

export interface SurfaceRecord {
  seed: number | null;
  updates: number;
  types: Record<SurfaceItemType, number>;
  outcome: SurfaceOutcome;
  message: string;
}

export type SurfaceLog = Record<SpikeSurface, SurfaceRecord>;

function emptyTypes(): Record<SurfaceItemType, number> {
  return { todo: 0, tool_call: 0, reasoning: 0, assistant_message: 0, user_message: 0, error: 0, compaction: 0, other: 0 };
}

export function createSurfaceLog(): SurfaceLog {
  const log = {} as SurfaceLog;
  for (const surface of SPIKE_SURFACES) log[surface] = { seed: null, updates: 0, types: emptyTypes(), outcome: "not_run", message: "" };
  return log;
}

export interface SurfaceEntry {
  outcome?: SurfaceOutcome;
  seed?: number | null;
  updates?: number;
  types?: Partial<Record<string, number>>;
  message?: unknown;
}

const OUTCOMES: readonly string[] = ["ok", "error", "pending", "not_run"];

// Stores one observation: the last outcome wins, update and type counts add up; never throws.
export function recordSurface(log: SurfaceLog, surface: SpikeSurface, entry: SurfaceEntry): void {
  const rec = Object.hasOwn(log, surface) ? log[surface] : undefined;
  if (!rec || !isRecord(entry)) return;
  if (typeof entry.outcome === "string" && OUTCOMES.includes(entry.outcome)) rec.outcome = entry.outcome as SurfaceOutcome;
  if (typeof entry.seed === "number" && Number.isFinite(entry.seed) && entry.seed >= 0) rec.seed = Math.floor(entry.seed);
  if (typeof entry.updates === "number" && Number.isFinite(entry.updates) && entry.updates > 0) rec.updates += Math.floor(entry.updates);
  if (isRecord(entry.types)) {
    for (const type of SURFACE_ITEM_TYPES) {
      const n = entry.types[type];
      if (typeof n === "number" && Number.isFinite(n) && n > 0) rec.types[type] += Math.floor(n);
    }
  }
  if ("message" in entry) rec.message = cleanText(entry.message, SPIKE_MESSAGE_MAX_CHARS);
}

// The surfaces object of the report block.
export function summarizeSurfaces(log: SurfaceLog): Record<SpikeSurface, SurfaceRecord> {
  const out = {} as Record<SpikeSurface, SurfaceRecord>;
  for (const surface of SPIKE_SURFACES) out[surface] = { ...log[surface], types: { ...log[surface].types } };
  return out;
}

// Counts the item type of a timeline entry; an unknown type counts as other.
export function surfaceItemType(item: unknown): SurfaceItemType {
  const type = isRecord(item) ? item.type : undefined;
  return typeof type === "string" && (SURFACE_ITEM_TYPES as readonly string[]).includes(type) ? (type as SurfaceItemType) : "other";
}

// ---------------------------------------------------------------- verdict and report

export interface Measurements {
  animatedCharacters: number;
  walkingCharacters: number;
  zoomMeasured: number;
  cadence: { windowSeconds: number; ticks: number; medianMs: number | null; p95Ms: number | null };
  firstLoadBytes: Readonly<Record<string, number>>;
  tintBytes: Readonly<Record<string, readonly number[]>>;
  steadyState: { windowSeconds: number; bytes: number | null };
  crispness: Readonly<Record<string, boolean | null>>;
  surfaces: Readonly<Record<string, Pick<SurfaceRecord, "outcome" | "seed">>>;
  smoothness: { zoom: number; answer: "yes" | "no" } | null;
}

export interface SpikeCheck {
  ok: boolean;
  value: number | string | null;
  limit: number | string;
}

export interface SpikeEvaluation {
  zoomLevels: ZoomCandidate[];
  tintLevels: TintCandidate | null;
  checks: Record<string, SpikeCheck>;
  complete: boolean;
  pass: boolean;
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function evaluateSpike(limits: SpikeLimits, m: Measurements): SpikeEvaluation {
  const crisp: Partial<Record<number, boolean>> = {};
  for (const z of ZOOM_CANDIDATES) crisp[z] = m.crispness[String(z)] === true;
  const zoomLevels = selectZoomLevels(crisp);
  const bytesZoom = zoomLevels.length > 0 ? zoomLevels[zoomLevels.length - 1]! : null;
  const firstLoad = bytesZoom === null ? undefined : m.firstLoadBytes[String(bytesZoom)];
  const variants = bytesZoom === null ? undefined : m.tintBytes[String(bytesZoom)];
  const tintLevels = num(firstLoad) && variants ? selectTintLevels(firstLoad, variants, limits.firstLoadBytesMax) : null;

  let complete = true;
  const checks: Record<string, SpikeCheck> = {};
  const within = (name: string, value: number | null, max: number): void => {
    if (!num(value)) complete = false;
    checks[name] = { ok: num(value) && value <= max, value, limit: max };
  };
  within("cadenceMedian", m.cadence.medianMs, limits.cadenceMedianMsMax);
  within("cadenceP95", m.cadence.p95Ms, limits.cadenceP95MsMax);
  checks.animated = { ok: m.animatedCharacters >= MAX_DRAWN_CHARACTERS, value: m.animatedCharacters, limit: MAX_DRAWN_CHARACTERS };
  checks.walking = { ok: m.walkingCharacters >= SPIKE_WALKING_CHARACTERS, value: m.walkingCharacters, limit: SPIKE_WALKING_CHARACTERS };
  checks.zoomLevels = { ok: zoomLevels.length > 0, value: zoomLevels.join(","), limit: ">=1" };
  checks.firstLoad = {
    ok: num(firstLoad) && firstLoad <= limits.firstLoadBytesMax,
    value: num(firstLoad) ? firstLoad : null,
    limit: limits.firstLoadBytesMax,
  };
  within("steadyState", m.steadyState.bytes, limits.steadyBytesMax);
  checks.tintLevels = { ok: tintLevels !== null && tintLevels >= 2, value: tintLevels, limit: ">=2" };

  const ran = (name: SpikeSurface): SurfaceOutcome => (m.surfaces[name]?.outcome ?? "not_run");
  for (const name of SPIKE_SURFACES) if (ran(name) === "not_run" || ran(name) === "pending") complete = false;
  const seeded = (name: SpikeSurface): boolean => ran(name) === "ok" && num(m.surfaces[name]?.seed);
  const readOk =
    seeded("agents") && seeded("workspaces") && seeded("projects") && ["ok", "error"].includes(ran("events")) && ["ok", "error"].includes(ran("timeline"));
  checks.readSurfaces = { ok: readOk, value: SPIKE_SURFACES.map((s) => `${s}=${ran(s)}`).join(" "), limit: "agents, workspaces, projects ok; events, timeline ok or error" };

  if (m.smoothness === null) complete = false;
  checks.smoothness = { ok: m.smoothness?.answer === "yes" && m.smoothness.zoom === m.zoomMeasured, value: m.smoothness ? `${m.smoothness.answer}@${m.smoothness.zoom}` : null, limit: "yes" };
  if (ZOOM_CANDIDATES.some((z) => m.crispness[String(z)] === null || m.crispness[String(z)] === undefined)) complete = false;

  const pass = complete && Object.values(checks).every((c) => c.ok);
  return { zoomLevels, tintLevels, checks, complete, pass };
}

export interface ReportState {
  measuredAt: string;
  animatedCharacters: number;
  walkingCharacters: number;
  zoomMeasured: number;
  cadence: { windowSeconds: number; ticks: number; medianMs: number | null; p95Ms: number | null };
  firstLoadBytes: Record<string, number>;
  tintBytes: Record<string, number[]>;
  steadyState: { windowSeconds: number; bytes: number | null };
  crispness: Record<string, boolean | null>;
  surfaces: SurfaceLog;
  smoothness: { zoom: number; answer: "yes" | "no" } | null;
  log: UpdateLog;
}

export interface SpikeReportJson {
  id: "SPIKE_MEASUREMENTS";
  version: 1;
  measuredAt: string;
  host: string;
  displayScale: string;
  scene: { animatedCharacters: number; walkingCharacters: number; zoomMeasured: number };
  cadence: ReportState["cadence"];
  firstLoadBytes: Record<string, number>;
  tintBytes: Record<string, number[]>;
  steadyState: ReportState["steadyState"];
  crispness: Record<string, boolean | null>;
  surfaces: Record<SpikeSurface, SurfaceRecord>;
  smoothness: ReportState["smoothness"];
  zoomLevels: number[];
  tintLevels: number | null;
  verdict: "pass" | "fail" | "incomplete";
}

export function buildReport(state: ReportState): { json: SpikeReportJson; text: string } {
  const surfaces = summarizeSurfaces(state.surfaces);
  const evaluation = evaluateSpike(SPIKE_LIMITS, {
    animatedCharacters: state.animatedCharacters,
    walkingCharacters: state.walkingCharacters,
    zoomMeasured: state.zoomMeasured,
    cadence: state.cadence,
    firstLoadBytes: state.firstLoadBytes,
    tintBytes: state.tintBytes,
    steadyState: state.steadyState,
    crispness: state.crispness,
    surfaces,
    smoothness: state.smoothness,
  });
  const json: SpikeReportJson = {
    id: "SPIKE_MEASUREMENTS",
    version: 1,
    measuredAt: state.measuredAt,
    host: "",
    displayScale: "",
    scene: { animatedCharacters: state.animatedCharacters, walkingCharacters: state.walkingCharacters, zoomMeasured: state.zoomMeasured },
    cadence: state.cadence,
    firstLoadBytes: state.firstLoadBytes,
    tintBytes: state.tintBytes,
    steadyState: state.steadyState,
    crispness: state.crispness,
    surfaces,
    smoothness: state.smoothness,
    zoomLevels: evaluation.zoomLevels,
    tintLevels: evaluation.tintLevels,
    verdict: evaluation.complete ? (evaluation.pass ? "pass" : "fail") : "incomplete",
  };
  const log = state.log;
  const counters = `upserts=${log.upserts} removes=${log.removes} quiet=${log.quiet} malformed=${log.malformed} dropped=${log.dropped} seeded=${log.seeded}`;
  const surfaceLines = SPIKE_SURFACES.map((s) => {
    const r = surfaces[s];
    const types = SURFACE_ITEM_TYPES.filter((t) => r.types[t] > 0).map((t) => `${t}:${r.types[t]}`).join(",") || "none";
    return `Surface ${s}: ${r.outcome} seeded=${r.seed ?? "none"} updates=${r.updates} types=${types}${r.message ? ` message=${r.message}` : ""}`;
  });
  const text = [JSON.stringify(json, null, 2), counters, ...surfaceLines, ...log.lines].join("\n");
  return { json, text };
}
