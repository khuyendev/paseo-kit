// No upstream: written for the office's narrow (phone) layout; no code is ported.
// The rules follow habblaud's small-screen layout (its client/src/ui/styles.css max-width 600px and 900px rules and the README
// section "On your phone too"): the room list becomes an overlay drawer that closes when a room is picked, the agent
// details open as a bottom sheet that leaves a strip of the office visible, and the feed becomes an "Activity" bar at the bottom.
// Pure: sizes from the measured screen, so the screen and the tests share one source.
import { TILE, ZOOM_CANDIDATES, type ZoomCandidate } from "../shared/art-types.ts";
import { COL_W } from "../shared/layout/constants.ts";
import { NARROW_GAP_PX, NARROW_MAX_WIDTH_PX, NARROW_SIDE_MAX_PX, NARROW_FEED_HEIGHT_RATIO, NARROW_SHEET_HEIGHT_RATIO } from "./limits-panels.ts";

export type LayoutMode = "wide" | "narrow";

// Narrow at or below the breakpoint; an unmeasured screen (0 or not a number) stays wide, the layout of the first frame.
export function layoutMode(width: number): LayoutMode {
  return Number.isFinite(width) && width > 0 && width <= NARROW_MAX_WIDTH_PX ? "narrow" : "wide";
}

// Width of the room-list drawer: its cap, never wider than the screen less a gap on each side.
export function sidePanelWidth(screenWidth: number): number {
  return Math.max(0, Math.min(NARROW_SIDE_MAX_PX, Math.round(screenWidth) - NARROW_GAP_PX * 2));
}

// Height of the details sheet and of the open feed, as a share of the area under the top bar, less the gaps.
export function sheetHeight(areaHeight: number): number {
  return Math.max(0, Math.min(Math.round(areaHeight * NARROW_SHEET_HEIGHT_RATIO), Math.round(areaHeight) - NARROW_GAP_PX * 2));
}

// Fit of the narrow office (owner feedback 2026-10-22: sideways swiping through a room wider than the phone is unpleasant).
// One building column fills the width as far as whole device pixels allow: `devicePx` device pixels per world pixel (the most
// that fits, at most the largest sprite zoom), sprites loaded at `zoom` (the largest candidate not above devicePx, else the
// smallest) and the scene shown at `factor` of its laid-out size. When devicePx equals zoom a sprite pixel lands on exactly one
// device pixel, so the art stays as crisp as at an integer zoom on a 1x screen; only a screen too narrow for that downscales.
export type NarrowFit = { zoom: ZoomCandidate; devicePx: number; factor: number };

export function narrowFit(viewWidth: number, pixelRatio: number, candidates: readonly ZoomCandidate[] = ZOOM_CANDIDATES): NarrowFit {
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  const sorted = [...candidates].sort((a, b) => a - b);
  const fits = Math.floor((Math.max(0, numberOr0(viewWidth)) * ratio) / (COL_W * TILE));
  const zoom = ([...sorted].reverse().find((c) => c <= fits) ?? sorted[0]) as ZoomCandidate;
  const devicePx = Math.max(1, Math.min(fits, zoom));
  return { zoom, devicePx, factor: devicePx / (zoom * ratio) };
}

// Horizontal snap offsets (shown px) that centre each building column in the view, clamped to the scroll range.
export function columnSnaps(cols: number, zoom: number, factor: number, viewWidth: number): number[] {
  const col = COL_W * TILE * zoom * factor;
  const max = Math.max(0, cols * col - viewWidth);
  const out: number[] = [];
  for (let c = 0; c < cols; c++) {
    const at = Math.round(Math.min(max, Math.max(0, c * col - (viewWidth - col) / 2)));
    if (out[out.length - 1] !== at) out.push(at);
  }
  return out;
}

const numberOr0 = (x: number): number => (Number.isFinite(x) ? x : 0);

export function feedHeight(areaHeight: number): number {
  return Math.max(0, Math.min(Math.round(areaHeight * NARROW_FEED_HEIGHT_RATIO), Math.round(areaHeight) - NARROW_GAP_PX * 2));
}
