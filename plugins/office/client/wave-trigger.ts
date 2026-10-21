// No upstream: written for plan 07-11.
// Wave trigger (OFFC-18, D-05): turns pushed changes of agents that carry the harness.run label into office.wave calls and the readings into effects.
// The caps live here because the manifest gives this plan no limits file (PANL-56 style); the only clock is the now() the screen passes in.
import { WAVE_RUN_ID_MAX_CHARS, WAVE_RUN_ID_PATTERN, WAVE_WORKSPACE_ID_MAX_CHARS, waveLinkSchema, type WaveInput } from "../shared/wave-rpc.ts";
import { effectFor, type EffectSpec } from "./effects.ts";

// Smallest gap between two calls for the same run.
export const WAVE_MIN_INTERVAL_MS = 3000;
// Calls open at once over all runs.
export const WAVE_CALLS_IN_FLIGHT_MAX = 2;
// Runs observed at once; later ones are ignored.
export const WAVE_RUNS_MAX = 8;

export interface WaveRunRef {
  workspaceId: string;
  runId: string;
}

export interface WaveRunInput extends WaveRunRef {
  // Changes whenever the pushed state of the run's agents changes.
  sig: string;
}

export interface WaveTriggerDeps {
  ask: (input: WaveInput) => Promise<unknown>;
  now: () => number;
  onEffect: (spec: EffectSpec, run: WaveRunRef) => void;
  limits?: Partial<{ minIntervalMs: number; callsInFlightMax: number; runsMax: number }>;
}

export interface WaveTriggerStats {
  asked: number;
  failed: number;
  effects: number;
  inFlight: number;
  runs: number;
}

export interface WaveTrigger {
  observe(runs: readonly WaveRunInput[]): void;
  // Asks the dirty runs that are due; the screen calls it on each beat (no timer here).
  pump(): void;
  dispose(): void;
  stats(): WaveTriggerStats;
}

interface RunState {
  ref: WaveRunRef;
  sig: string;
  askedSig: string | null;
  inFlight: boolean;
  lastAsk: number;
  prev: unknown;
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function validRef(run: unknown): run is WaveRunInput {
  if (typeof run !== "object" || run === null) return false;
  const { workspaceId, runId, sig } = run as Record<string, unknown>;
  if (typeof sig !== "string") return false;
  if (typeof workspaceId !== "string" || workspaceId.length < 1 || workspaceId.length > WAVE_WORKSPACE_ID_MAX_CHARS || CONTROL_CHARS.test(workspaceId)) return false;
  return typeof runId === "string" && runId.length >= 1 && runId.length <= WAVE_RUN_ID_MAX_CHARS && WAVE_RUN_ID_PATTERN.test(runId);
}

const keyOf = (ref: WaveRunRef): string => JSON.stringify([ref.workspaceId, ref.runId]);

export function waveTrigger(deps: WaveTriggerDeps): WaveTrigger {
  const minInterval = deps.limits?.minIntervalMs ?? WAVE_MIN_INTERVAL_MS;
  const inFlightMax = deps.limits?.callsInFlightMax ?? WAVE_CALLS_IN_FLIGHT_MAX;
  const runsMax = deps.limits?.runsMax ?? WAVE_RUNS_MAX;
  const runs = new Map<string, RunState>();
  const counts = { asked: 0, failed: 0, effects: 0 };
  let inFlight = 0;
  let disposed = false;

  function settle(state: RunState, response: unknown): void {
    const out = typeof response === "object" && response !== null ? (response as Record<string, unknown>) : null;
    const link = out !== null && out.ok === true ? waveLinkSchema.safeParse(out.link) : null;
    if (link === null || !link.success || link.data.scope !== "complete") {
      counts.failed++;
      return;
    }
    const spec = effectFor(state.prev, link.data);
    state.prev = link.data;
    if (spec === null) return;
    counts.effects++;
    try {
      deps.onEffect(spec, { workspaceId: state.ref.workspaceId, runId: state.ref.runId });
    } catch {
      // an effect sink that throws must not stop the trigger
    }
  }

  function ask(key: string, state: RunState): void {
    state.inFlight = true;
    state.askedSig = state.sig;
    state.lastAsk = deps.now();
    inFlight++;
    counts.asked++;
    const done = (response: unknown, failed: boolean): void => {
      inFlight = Math.max(0, inFlight - 1);
      state.inFlight = false;
      if (disposed || runs.get(key) !== state) return;
      if (failed) counts.failed++;
      else settle(state, response);
    };
    let pending: Promise<unknown>;
    try {
      pending = Promise.resolve(deps.ask({ workspaceId: state.ref.workspaceId, runId: state.ref.runId }));
    } catch {
      done(null, true);
      return;
    }
    pending.then(
      (response) => done(response, false),
      () => done(null, true),
    );
  }

  function pump(): void {
    if (disposed) return;
    const at = deps.now();
    for (const [key, state] of runs) {
      if (inFlight >= inFlightMax) return;
      if (state.inFlight || state.askedSig === state.sig || at - state.lastAsk < minInterval) continue;
      ask(key, state);
    }
  }

  return {
    observe(list) {
      if (disposed || !Array.isArray(list)) return;
      const keep = new Set<string>();
      for (const run of list) {
        if (keep.size >= runsMax) break;
        if (!validRef(run)) continue;
        const key = keyOf(run);
        if (keep.has(key)) continue;
        keep.add(key);
        const known = runs.get(key);
        if (known) known.sig = run.sig;
        else runs.set(key, { ref: { workspaceId: run.workspaceId, runId: run.runId }, sig: run.sig, askedSig: null, inFlight: false, lastAsk: Number.NEGATIVE_INFINITY, prev: null });
      }
      for (const key of [...runs.keys()]) if (!keep.has(key)) runs.delete(key);
      pump();
    },
    pump,
    dispose() {
      disposed = true;
      runs.clear();
    },
    stats: () => ({ ...counts, inFlight, runs: runs.size }),
  };
}
