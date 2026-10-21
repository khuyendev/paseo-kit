// Every client cap of the office plugin in one place (PANL-56 style); no number appears at a call site.
// 07-06 adds the agent, cluster, room and building caps below this line.

// Animated characters the screen draws at most; equals maxDrawnCharacters of the dated spike thresholds (a gate test keeps them equal).
export const MAX_DRAWN_CHARACTERS = 32;

// Longest agent, workspace, project and label id kept in the store; a longer one is unreadable.
export const ID_MAX_CHARS = 200;
// Longest workspace, project, provider, model and run label text kept.
export const NAME_MAX_CHARS = 80;
// Longest agent title kept.
export const TITLE_MAX_CHARS = 80;
// Longest error text kept per agent.
export const ERROR_MAX_CHARS = 200;
// Longest todo text kept.
export const TODO_TEXT_MAX_CHARS = 120;
// Todo entries kept per agent.
export const TODOS_PER_AGENT_MAX = 40;
// Pending permissions counted per agent.
export const PENDING_PERMISSIONS_MAX = 99;
// Entries kept per store collection (agents, workspaces, projects).
export const STORE_ENTRIES_MAX = 1000;
// Entries asked per list page.
export const LIST_PAGE_LIMIT = 100;
// List pages read per collection and load.
export const LIST_PAGES_MAX = 10;
// Timeline subscriptions open at once; the selected agent comes first.
export const TIMELINE_SUBSCRIPTIONS_MAX = 12;
// Timeline entries read as the tail of an agent.
export const TIMELINE_TAIL_LIMIT = 24;
// Entries per older page read for the selected agent's todos.
export const TIMELINE_TODO_PAGE_LIMIT = 100;
// Older pages at most, so 800 entries behind the tail; a todo item older than that is not shown and is counted in the store stats.
export const TIMELINE_TODO_PAGES_MAX = 8;
// Handoffs kept until the scene takes them; the oldest is dropped first.
export const HANDOFF_QUEUE_MAX = 32;

// The three building caps below are limited per level; MAX_DRAWN_CHARACTERS is the global bound measured by the spike and the
// product of the three caps is larger on purpose, so the global bound decides (D-04, D-12).
// Characters drawn per cluster.
export const AGENTS_PER_CLUSTER_MAX = 12;
// Clusters per room (the owner runs one or two sessions per project).
export const CLUSTERS_PER_ROOM_MAX = 2;
// Rooms per building.
export const ROOMS_PER_BUILDING_MAX = 6;

// Sprite calls open at once.
export const SPRITE_CALLS_IN_FLIGHT_MAX = 2;
// Sprite keys the sprite store remembers.
export const SPRITE_STORE_KEYS_MAX = 1024;
