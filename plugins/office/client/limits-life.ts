// Port of habblaud client/src/world/sim/elevator.ts @ faa1a012b5fbf632c66dc6801c5383e53a542406 (MIT; notice in LICENSES/habblaud-MIT.txt, added by plan 07-05).
// Ported: the door hold and the arrival stagger; the idle sit range and the nearest-three rule come from sim/behavior.ts and sim/spots.ts. Everything else here is written for plan 07-08.
// Every cap and timing of character motion and life in one place (PANL-56 style); no number appears at a call site elsewhere.

// Milliseconds between two ticks of the shared clock (the tick the 07-03 spike measured).
export const CLOCK_TICK_MS = 100;
// Shared clock values: one per frame-duration tier.
export const CLOCK_TIER_COUNT = 4;
// Ticks a tier needs to advance one frame, tier by tier.
export const CLOCK_TICKS_PER_FRAME = [1, 2, 4, 8] as const;
// Frame values a tier cycles through (the least common multiple of the 2 and 4 frame counts of the poses).
export const CLOCK_CYCLE = 4;

// Straight runs a walk plan may hold before the plan is refused.
export const WALK_PLAN_MAX_SEGMENTS = 64;
// Steps a journey may hold before the runner ends it at once.
export const JOURNEY_MAX_STEPS = 16;
// Pause of a child at its parent's tile (a design constant: the pinned sim has no hand-in pause).
export const HANDOFF_PAUSE_MS = 1200;

// Time the elevator door needs to open (the upstream door speed of 9 states per second over 4 states).
export const ELEVATOR_DOOR_MS = 450;
// Time the door stays open after the last use (literal from the pinned elevator code).
export const ELEVATOR_HOLD_MS = 650;
// Gap between two people appearing from the same elevator (literal from the pinned elevator code).
export const ELEVATOR_STAGGER_MS = 520;

// Normal range of the time an idle agent sits at its desk before the next outing (pinned idleSitMs).
export const WANDER_SIT_MS_MIN = 6000;
export const WANDER_SIT_MS_MAX = 20000;
// Bounds of the time an outing stays at its spot; the table of each activity is clamped inside them.
export const WANDER_STAY_MS_MIN = 4000;
export const WANDER_STAY_MS_MAX = 12000;
// Spots nearest to the walker that the spot choice picks among (pinned findFree).
export const WANDER_NEAREST_CHOICES = 3;
// Largest group any kept hangout kind takes.
export const HANGOUT_MAX_MEMBERS = 4;

// Spawn and archive effects (written for the office states, no upstream number).
// An agent first seen while its createdAt is younger than this comes up by elevator even when it is already running.
export const SPAWN_FRESH_MS = 30000;
// Archives arriving in one store change above this count fade in place instead of walking out.
export const ARCHIVE_BULK_MAX = 3;
// Fade of an archived agent that leaves in place.
export const ARCHIVE_FADE_MS = 700;

// Agent moods (habblaud states), in milliseconds of scene time; the mood machine turns them into beats.
// Waiting on shell: arms crossed and a spin now and then after 3 min, a cobweb after 10 min, a doze after 25 min.
export const SHELL_BORED_MS = 180000;
export const SHELL_COBWEB_MS = 600000;
export const SHELL_DOZE_MS = 1500000;
// An idle agent dozes off after 10 min idle, once it sits at its seat.
export const IDLE_DOZE_MS = 600000;
// Cheer (or sulk) after a waited-on shell call ends.
export const CELEBRATE_MS = 4000;
// While bored: a spin of SPIN_MS every SPIN_EVERY_MS.
export const SPIN_EVERY_MS = 9600;
export const SPIN_MS = 3200;
