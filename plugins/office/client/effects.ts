// Port of habblaud client/src/world/render/particles.ts @ faa1a012b5fbf632c66dc6801c5383e53a542406 (MIT; notice in LICENSES/habblaud-MIT.txt, added by plan 07-05).
// Only the two colour tables are ported; the rest is written for transforms and a seeded generator.
import {
  EFFECT_FALL_PX,
  EFFECT_ID_MAX_CHARS,
  EFFECT_KINDS,
  EFFECT_MAX_ACTIVE,
  EFFECT_PARTICLES,
  EFFECT_PARTICLE_PX,
  EFFECT_PHASE_MAX_CHARS,
  EFFECT_PLANS_MAX,
  EFFECT_RISE_PX,
  EFFECT_SPARKLES,
  EFFECT_SPARKLE_PX,
  EFFECT_SPIN_DEG,
  EFFECT_SPREAD_PX,
  EFFECT_WAVE_MAX,
  type EffectKind,
} from "./limits-atmosphere.ts";

export const CONFETTI_COLORS: readonly string[] = ["#ff4d6d", "#ffb11f", "#ffe14d", "#3ddc84", "#3fa7ff", "#b06bff", "#ff7ad9"];
export const SPARKLE_COLORS: readonly string[] = ["#ffffff", "#fff3a6", "#ffd1f0", "#bfe9ff"];
export const RING_COLORS: Readonly<Record<EffectKind, string>> = { wave: CONFETTI_COLORS[4], phase: CONFETTI_COLORS[1] };

// Structural shape of a wave reading; the WaveLink of the wave RPC fits it and is not imported.
export interface WaveReading {
  phase: string;
  wave: number | null;
  plansDone: number | null;
  plansTotal: number | null;
  scope: string;
}

export interface EffectSpec {
  id: string;
  kind: EffectKind;
  phase: string;
  wave: number | null;
}

export interface EffectPlacement {
  id: string;
  kind: EffectKind;
  x: number;
  y: number;
}

export interface ParticleSpec {
  shape: "confetti" | "sparkle";
  dx: number;
  rise: number;
  fall: number;
  spin: number;
  color: string;
  size: number;
}

export interface EffectQueue {
  readonly active: readonly EffectPlacement[];
}

const COMPLETE_SCOPE = "complete";
const PHASE_PATTERN = /^[0-9]+(?:\.[0-9]+)*$/;
const ALL_WAVES = "all";
const SEED_SEPARATOR = "|";
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

// Confetti formulas: cone half-turn spread, reach, rise, fall and spin shares.
const CONE_SPREAD = 2.4;
const REACH_MIN = 0.4;
const REACH_VAR = 0.6;
const RISE_MIN = 0.5;
const RISE_VAR = 0.5;
const FALL_MIN = 0.6;
const FALL_VAR = 0.4;
const SPIN_FACTOR = 2;
const MIN_TRAVEL = 1;
// Sparkle formulas: ring jitter, radius and lift.
const SPARKLE_JITTER = 0.5;
const SPARKLE_RADIUS_MIN = 5;
const SPARKLE_RADIUS_VAR = 6;
const SPARKLE_UP_MIN = 8;
const SPARKLE_UP_VAR = 10;

interface Reading {
  phase: string;
  wave: number | null;
  plansDone: number;
  plansTotal: number;
}

// Reads each field once and accepts the value only when every field is valid; never throws.
function readReading(value: unknown): Reading | null {
  try {
    if (typeof value !== "object" || value === null) return null;
    const raw = value as Record<string, unknown>;
    const scope = raw.scope;
    const phase = raw.phase;
    const wave = raw.wave;
    const plansDone = raw.plansDone;
    const plansTotal = raw.plansTotal;
    if (scope !== COMPLETE_SCOPE) return null;
    if (typeof phase !== "string" || phase.length < 1 || phase.length > EFFECT_PHASE_MAX_CHARS || !PHASE_PATTERN.test(phase)) return null;
    if (wave !== null && (typeof wave !== "number" || !Number.isInteger(wave) || wave < 0 || wave > EFFECT_WAVE_MAX)) return null;
    if (typeof plansTotal !== "number" || !Number.isInteger(plansTotal) || plansTotal < 1 || plansTotal > EFFECT_PLANS_MAX) return null;
    if (typeof plansDone !== "number" || !Number.isInteger(plansDone) || plansDone < 0 || plansDone > plansTotal) return null;
    return { phase, wave, plansDone, plansTotal };
  } catch {
    return null;
  }
}

// One effect when a link goes from some plans done to all plans done; a link without a wave number counts the whole phase.
export function effectFor(prev: unknown, next: unknown): EffectSpec | null {
  const before = readReading(prev);
  const after = readReading(next);
  if (!before || !after) return null;
  if (before.phase !== after.phase || before.wave !== after.wave) return null;
  if (before.plansDone >= before.plansTotal || after.plansDone !== after.plansTotal) return null;
  const kind: EffectKind = after.wave === null ? "phase" : "wave";
  const id = `${kind}:${after.phase}:${after.wave === null ? ALL_WAVES : after.wave}`;
  return { id, kind, phase: after.phase, wave: after.wave };
}

function fnv1a(text: string): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

// Mulberry32, same algorithm as client/layout/rng.ts (copied, not imported).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isKind(kind: unknown): kind is EffectKind {
  return typeof kind === "string" && (EFFECT_KINDS as readonly string[]).includes(kind);
}

// Deterministic confetti pieces followed by sparkles for one effect; empty for an unknown kind or a non-string id.
export function particlesFor(spec: { id: string; kind: EffectKind }): ParticleSpec[] {
  const kind = spec?.kind;
  const id = spec?.id;
  if (!isKind(kind) || typeof id !== "string") return [];
  const rand = mulberry32(fnv1a(kind + SEED_SEPARATOR + id));
  const out: ParticleSpec[] = [];
  for (let i = 0; i < EFFECT_PARTICLES[kind]; i++) {
    const angle = -Math.PI / 2 + (rand() - 0.5) * CONE_SPREAD;
    const reach = EFFECT_SPREAD_PX[kind] * (REACH_MIN + REACH_VAR * rand());
    const rise = Math.max(MIN_TRAVEL, Math.round(EFFECT_RISE_PX[kind] * (RISE_MIN + RISE_VAR * rand())));
    const fall = Math.max(MIN_TRAVEL, Math.round(EFFECT_FALL_PX[kind] * (FALL_MIN + FALL_VAR * rand())));
    const spin = Math.round((rand() - 0.5) * SPIN_FACTOR * EFFECT_SPIN_DEG);
    const color = CONFETTI_COLORS[Math.floor(rand() * CONFETTI_COLORS.length)];
    out.push({ shape: "confetti", dx: Math.round(Math.cos(angle) * reach), rise, fall, spin, color, size: EFFECT_PARTICLE_PX });
  }
  const sparkles = EFFECT_SPARKLES[kind];
  for (let j = 0; j < sparkles; j++) {
    const angle = (j / sparkles) * Math.PI * 2 + SPARKLE_JITTER * rand();
    const radius = SPARKLE_RADIUS_MIN + SPARKLE_RADIUS_VAR * rand();
    const up = Math.round(SPARKLE_UP_MIN + SPARKLE_UP_VAR * rand());
    const color = SPARKLE_COLORS[Math.floor(rand() * SPARKLE_COLORS.length)];
    out.push({ shape: "sparkle", dx: Math.round(Math.cos(angle) * radius), rise: up, fall: -up, spin: 0, color, size: EFFECT_SPARKLE_PX });
  }
  return out;
}

export const EMPTY_EFFECT_QUEUE: EffectQueue = Object.freeze({ active: Object.freeze([]) as readonly EffectPlacement[] });

// Adds a placement; the same queue object comes back for anything invalid or already active. Never mutates its input.
export function enqueueEffect(queue: EffectQueue, placement: EffectPlacement, maxActive: number = EFFECT_MAX_ACTIVE): EffectQueue {
  if (!Number.isInteger(maxActive) || maxActive < 1) throw new RangeError("maxActive");
  if (typeof placement !== "object" || placement === null) return queue;
  const { id, kind, x, y } = placement;
  if (!isKind(kind) || typeof id !== "string" || id.length < 1 || id.length > EFFECT_ID_MAX_CHARS) return queue;
  if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return queue;
  if (queue.active.some((p) => p.id === id)) return queue;
  const kept = queue.active.slice(Math.max(0, queue.active.length - (maxActive - 1)));
  return { active: [...kept, { id, kind, x, y }] };
}

export function finishEffect(queue: EffectQueue, id: string): EffectQueue {
  if (!queue.active.some((p) => p.id === id)) return queue;
  return { active: queue.active.filter((p) => p.id !== id) };
}
