// Every scale cap of the swarm map server in one place (PANL-56).

// Agent listing (PANL-26).
export const PAGE_LIMIT = 200;
export const MAX_PAGES = 5;
// Parents missing from the live list, refetched one by one (PANL-27).
export const PARENT_TTL_MS = 30_000;

// Timeline reads (PANL-31, PANL-32).
export const PARALLEL_READS = 8;
export const FIRST_TAIL_LIMIT = 8;
export const TAIL_LIMIT = 4;
export const RECENT_MAX = 8;
export const SEEN_IDS_MAX = 300;
export const LIVE_REFRESH_MS = 1000;
export const ERROR_RETRY_MS = 30_000;
// Idle agents updated within this window still get timeline reads.
export const IDLE_WINDOW_MS = 6 * 3600 * 1000;

// Activity text (PANL-35).
export const LABEL_MAX_CHARS = 48;
export const DETAIL_MAX_CHARS = 300;
export const MESSAGE_MAX_CHARS = 280;
export const FILES_PER_ACTIVITY = 24;
// Files of an agent's current activity sent in the snapshot (a node shows at most two file chips).
export const SNAPSHOT_ACTIVITY_FILES = 2;

// File ledger (PANL-37, PANL-38).
export const FILE_HOLD_MS = 5 * 60 * 1000;
export const HANDOFF_WINDOW_MS = 15 * 60 * 1000;
export const FORGET_MS = 30 * 60 * 1000;
export const HOLDS_PER_AGENT = 4;

// Event log (PANL-40, PANL-41).
export const EVENT_LOG_MAX = 500;
export const EVENT_HISTORY = 40;
export const EVENTS_PER_CALL_MAX = 200;
export const EVENT_TEXT_MAX_CHARS = 200;
export const PROMPT_LOOKBACK_ITEMS = 4;
export const PROMPT_FRESH_MS = 15_000;
export const PROMPT_RETRY_MS = 700;

// Config and run-link caches (PANL-55, PANL-61).
export const ROTATE_TTL_MS = 5000;
