// No upstream: spike-grade drawing written for plan 07-03 (D-12); retired by plan 07-11.
// Hash and small colour tables of the spike renderers.

// 32-bit FNV-1a of the text.
export function spikeHash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export const SKIN = ["#f1c7a0", "#e0a878", "#c68642", "#8d5524", "#ffdbb4"] as const;
export const HAIR = ["#2b1d12", "#5a3825", "#a0522d", "#d8b45a", "#3b3b4f", "#b03a2e"] as const;
export const SHIRT = ["#3b7dd8", "#d8503b", "#3bb273", "#9b59b6", "#e6a817", "#17a2b8", "#e0e0e0", "#ff7f9e"] as const;
export const TROUSERS = ["#2c3e50", "#4a4a4a", "#6b4f2c", "#1f3a5f"] as const;

export interface AreaPalette {
  floorA: string;
  floorB: string;
  noise: string;
  wall: string;
  base: string;
  prop: string;
  prop2: string;
}

// Palette per spike layer seed.
export const AREA_PALETTES: Readonly<Record<string, AreaPalette>> = {
  corridor: { floorA: "#8a8f98", floorB: "#7d828b", noise: "#6c717a", wall: "#5b6270", base: "#3e4452", prop: "#a9724a", prop2: "#c49a6c" },
  room: { floorA: "#b99a6b", floorB: "#ad8f61", noise: "#8f7449", wall: "#6d7a8f", base: "#434d5e", prop: "#7a5230", prop2: "#4d6b8a" },
  reception: { floorA: "#c9c3b5", floorB: "#bdb7a8", noise: "#a29c8d", wall: "#7f8c8d", base: "#4b5557", prop: "#6b4a2e", prop2: "#b0b7bd" },
  cafe: { floorA: "#d1a778", floorB: "#c49a6c", noise: "#a47f52", wall: "#8e6b5a", base: "#5a4036", prop: "#5b3a29", prop2: "#e6d3b3" },
  lounge: { floorA: "#7fa38c", floorB: "#729680", noise: "#5c8069", wall: "#4f6d63", base: "#334a42", prop: "#8c4a4a", prop2: "#d9c27a" },
};
