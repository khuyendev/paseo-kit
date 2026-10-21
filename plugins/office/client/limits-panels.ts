// Every cap and level of the three panels (sidebar, drawer, top bar) in one place (PANL-56 style); no number appears at a call site.
// Areas keep their limits next to their module (client/limits.ts and the layout folder).

// Rows the sidebar shows at most; the rest is counted into an exact hidden count.
export const SIDEBAR_MAX_ROWS = 400;
// Left padding per tree depth, in px.
export const SIDEBAR_INDENT_PX = 14;
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
