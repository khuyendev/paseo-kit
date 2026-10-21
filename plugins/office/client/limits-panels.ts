// Every cap and level of the three panels (sidebar, drawer, top bar) in one place (PANL-56 style); no number appears at a call site.
// Areas keep their limits next to their module (client/limits.ts and the layout folder).

// Rows the sidebar shows at most; the rest is counted into an exact hidden count.
export const SIDEBAR_MAX_ROWS = 400;
// Edge of a project checkbox, in px.
export const SIDEBAR_CHECK_PX = 16;
// Characters of a title, project name or workspace name shown on a row or header.
export const LABEL_MAX_CHARS = 80;
// Characters of the last error text in the drawer.
export const ERROR_MAX_CHARS = 400;
// Todos the drawer lists at most, and characters of one todo text.
export const TODO_MAX_ITEMS = 40;
export const TODO_TEXT_MAX_CHARS = 160;
// Child agents the drawer lists at most.
export const CHILDREN_MAX_ITEMS = 50;
// Context percentage at which the top bar warns. A presentation choice (research assumption A10), not read from any project setting (D-03); the owner may change it.
export const CONTEXT_WARN_PERCENT = 60;
// Minimum width of the empty provider usage slot in the top bar, in px (D-07).
export const USAGE_SLOT_MIN_WIDTH_PX = 120;
// Feed lines kept (newest first) and beats between two refreshes of their relative times while the feed is open.
export const FEED_MAX = 40;
export const FEED_REFRESH_BEATS = 10;
export const FEED_PANEL_WIDTH_PX = 260;
export const FEED_PANEL_MAX_HEIGHT_PX = 360;
// Agents the search lists at most, and characters of the query kept.
export const SEARCH_RESULTS_MAX = 8;
export const SEARCH_QUERY_MAX_CHARS = 60;
// Two presses on one character within this many beats follow it.
export const DOUBLE_PRESS_BEATS = 1;
// Width of the token bar in the drawer, in px.
export const TOKEN_BAR_WIDTH_PX = 120;
// Narrow layout (phones, client/narrow.ts), habblaud's small-screen numbers: the breakpoint, the gap around the floating panels,
// the room-list drawer cap, and the heights of the details sheet and the open feed as shares of the area under the top bar.
export const NARROW_MAX_WIDTH_PX = 600;
export const NARROW_GAP_PX = 8;
export const NARROW_SIDE_MAX_PX = 340;
export const NARROW_SHEET_HEIGHT_RATIO = 0.58;
export const NARROW_FEED_HEIGHT_RATIO = 0.44;
// Height of the collapsed Activity bar, and the opacity of the scrim (the theme's surface colour) over the office behind the
// open room list.
export const NARROW_FEED_BAR_PX = 40;
export const NARROW_SCRIM_OPACITY = 0.6;
