// Every cap and tuning table of the atmosphere area in one place (PANL-56 style); call sites hold no number.
// The caps bound the Animated nodes: at most EFFECT_MAX_ACTIVE bursts of at most (EFFECT_PARTICLES + EFFECT_SPARKLES + 1) views each.

// The effect kinds; defined here so effects.ts and this file never import each other.
export const EFFECT_KINDS = ["wave", "phase"] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

// Caps on the effect queue and on the reading an effect id is built from (OFFC-14, OFFC-18).
export const EFFECT_MAX_ACTIVE = 3;
export const EFFECT_ID_MAX_CHARS = 40;
export const EFFECT_PHASE_MAX_CHARS = 16;
export const EFFECT_WAVE_MAX = 999;
export const EFFECT_PLANS_MAX = 999;

// Per-kind tables: a phase completion is a bigger burst than a wave completion.
export const EFFECT_PARTICLES: Readonly<Record<EffectKind, number>> = { wave: 14, phase: 28 };
export const EFFECT_SPARKLES: Readonly<Record<EffectKind, number>> = { wave: 4, phase: 10 };
export const EFFECT_DURATION_MS: Readonly<Record<EffectKind, number>> = { wave: 1800, phase: 3200 };
// Half width of the burst, rise to the top of the arc, fall after it and final ring radius, all in art pixels.
export const EFFECT_SPREAD_PX: Readonly<Record<EffectKind, number>> = { wave: 28, phase: 48 };
export const EFFECT_RISE_PX: Readonly<Record<EffectKind, number>> = { wave: 22, phase: 36 };
export const EFFECT_FALL_PX: Readonly<Record<EffectKind, number>> = { wave: 30, phase: 44 };
export const EFFECT_RING_PX: Readonly<Record<EffectKind, number>> = { wave: 18, phase: 30 };

// Shape numbers: piece sizes in art pixels (multiplied by the zoom when drawn) and the spin range in degrees.
export const EFFECT_PARTICLE_PX = 2;
export const EFFECT_SPARKLE_PX = 1;
export const EFFECT_SPIN_DEG = 360;
// Share of the burst at the top of the arc, share after which a piece fades out, ring scale when a burst starts.
export const EFFECT_RISE_AT = 0.4;
export const EFFECT_FADE_FROM = 0.7;
export const EFFECT_RING_START_SCALE = 0.2;
// Zoom used when the caller passes one that is not a finite number above 0.
export const EFFECT_ZOOM_FALLBACK = 1;

// Room lights: the shade over a room with nobody present, its opacity when dark and the fade between lit and dark.
export const ROOM_SHADE_COLOR = "#05070d";
export const ROOM_DARK_OPACITY = 0.55;
export const ROOM_LIGHT_FADE_MS = 900;

// Character overlays: the glyph bubble above the head, the name tag under the feet and the blink of an alert.
export const BUBBLE_FONT_PX = 10;
export const BUBBLE_PAD_PX = 2;
export const BUBBLE_RISE_PX = 16;
export const BUBBLE_BLINK_MS = 450;
export const BUBBLE_BLINK_MIN = 0.25;
export const NAME_FONT_PX = 9;
export const NAME_WIDTH_PX = 72;
export const CHIP_PX = 10;
