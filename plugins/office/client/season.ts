// Port of habblaud client/src/world/api.ts @ faa1a012b5fbf632c66dc6801c5383e53a542406 (MIT; notice in LICENSES/habblaud-MIT.txt, added by plan 07-05).
// Kept: the automatic branch of seasonalThemeFor; dropped: the theme setting, which the plugin does not have.

export const SEASONS = ["none", "christmas", "halloween"] as const;
export type Season = (typeof SEASONS)[number];

const OCTOBER = 9;
const NOVEMBER = 10;
const DECEMBER = 11;
const CHRISTMAS_LAST_DAY = 26;

// Season of a local calendar date: halloween in October, christmas from November 1 to December 26, else none.
export function seasonFor(date: Date): Season {
  const month = date.getMonth();
  if (month === OCTOBER) return "halloween";
  if (month === NOVEMBER || (month === DECEMBER && date.getDate() <= CHRISTMAS_LAST_DAY)) return "christmas";
  return "none";
}
