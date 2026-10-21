// No upstream: written for the office's narrow (phone) layout; no code is ported.
// The rules follow habblaud's small-screen layout (its client/src/ui/styles.css max-width 600px and 900px rules and the README
// section "On your phone too"): the room list becomes an overlay drawer that closes when a room is picked, the agent
// details open as a bottom sheet that leaves a strip of the office visible, and the feed becomes an "Activity" bar at the bottom.
// Pure: sizes from the measured screen, so the screen and the tests share one source.
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

export function feedHeight(areaHeight: number): number {
  return Math.max(0, Math.min(Math.round(areaHeight * NARROW_FEED_HEIGHT_RATIO), Math.round(areaHeight) - NARROW_GAP_PX * 2));
}
