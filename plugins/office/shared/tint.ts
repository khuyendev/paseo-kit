// Tint variant rules (OFFC-17, 07-03): how many tint variants of every room layer the first load may carry.
// Plain data and pure functions; TINT_LEVELS is written here only after the owner's recorded spike pass.

export const TINT_MIN_LEVELS = 2;
export const TINT_MAX_LEVELS = 5;
export const TINT_CANDIDATES = [2, 3, 4, 5] as const;
// PROVISIONAL: the owner waived the D-12 spike on 2026-10-21 (07-SPIKE.md, SPIKE_WAIVER); the first-load bytes of the tint
// variants were not measured, so the minimum is kept. Replace with the recorded count when the measurement is taken.
export const TINT_LEVELS: TintCandidate = 2;
export type TintCandidate = (typeof TINT_CANDIDATES)[number];

// First-load bytes with `levels` variants: the base plus the first levels-1 variant sizes (index 0 is the untinted layer).
export function firstLoadBytesWithTint(base: number, variantBytes: readonly number[], levels: number): number {
  if (!Number.isInteger(levels) || levels < 1 || levels > TINT_MAX_LEVELS) throw new RangeError("levels");
  if (variantBytes.length < levels - 1) throw new RangeError("variantBytes");
  let total = base;
  for (let i = 0; i < levels - 1; i++) total += variantBytes[i] ?? 0;
  return total;
}

// Largest N in TINT_CANDIDATES whose first load stays within maxBytes, or null when even N=2 does not fit.
export function selectTintLevels(base: number, variantBytes: readonly number[], maxBytes: number): TintCandidate | null {
  let best: TintCandidate | null = null;
  for (const n of TINT_CANDIDATES) {
    if (variantBytes.length < n - 1) break;
    if (firstLoadBytesWithTint(base, variantBytes, n) <= maxBytes) best = n;
  }
  return best;
}
