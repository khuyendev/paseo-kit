// Every server cap of the office plugin in one place (PANL-56 style); no number appears at a call site.
// SPRITE_KEYS_PER_CALL_MAX stays in shared/sprites-rpc.ts because the client batches by it.

// LRU total for rendered sprites, counted as data-URI text length.
export const SPRITE_CACHE_MAX_BYTES = 24 * 1024 * 1024;
// One encoded PNG.
export const SPRITE_PNG_MAX_BYTES = 1_500_000;
// Scaled width or height of one PNG.
export const PNG_MAX_DIMENSION = 4096;
// Scaled width times height of one PNG.
export const PNG_MAX_PIXELS = 8_000_000;
