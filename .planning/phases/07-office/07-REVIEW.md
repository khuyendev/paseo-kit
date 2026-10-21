# Phase 07 code review

Rendered from `review/*.json` (one record per wave and plan).

## gsd-07-w1-07-01

Scope: plugins/office/paseo-plugin.json, plugins/office/package.json, plugins/office/tsconfig.json, plugins/office/README.md, plugins/office/index.server.ts, plugins/office/index.client.tsx, plugins/office/client/register.ts, plugins/office/client/tracer-screen.tsx, plugins/office/shared/art-types.ts, plugins/office/shared/sprites-rpc.ts, plugins/office/server/limits.ts, plugins/office/server/png.ts, plugins/office/server/sprites.ts, plugins/office/server/sprite-registry.ts, plugins/office/server/art/core/pixbuf.ts, plugins/office/server/art/core/color.ts, plugins/office/server/art/core/sprite.ts, tests/ui/office-host.mjs, tests/ui/office-png.test.mjs, tests/ui/plugin-gates.test.mjs
Lenses: correctness

| id | severity | status | verdict | file | trigger |
| --- | --- | --- | --- | --- | --- |
| F-01 | medium | deferred | - | plugins/office/README.md:15 | An operator follows README step 1 (`node kit.mjs machine apply --enable-paseo-plugins`) on a machine that has not yet ru |
| F-02 | low | deferred | - | plugins/office/client/tracer-screen.tsx:29 | The `office.sprites` call returns `{ok:true, sprites:[{ok:false, code:"render_failed"}]}`, or `{ok:false, code:"internal |
| F-03 | low | deferred | - | tests/ui/office-host.mjs:557 | Any call to `host.dispose()` in a test, including when the disposer of plugins/office/index.server.ts is broken or never |
| F-04 | low | deferred | - | plugins/office/server/sprites.ts:105 | A renderer returns a zero-sized PixelBuf, or a buffer whose `data` length does not match `w*h*4`. `encodePng` throws a R |
| F-05 | low | deferred | - | plugins/office/shared/sprites-rpc.ts:30 | Code passes a plain string where a `SpriteKey` is expected, for example `const k: SpriteKey = "anything"`. I compiled th |
| F-06 | info | deferred | - | tests/ui/office-host.mjs:510 | A test's late `setState` on an already unmounted handle, followed by `flush()` on that handle. |

## gsd-07-w2-07-02

Scope: plugins/office/client/path/grid.ts, plugins/office/client/path/astar.ts, plugins/office/client/layout/constants.ts, plugins/office/client/layout/defs.ts, plugins/office/client/layout/types.ts, plugins/office/client/layout/rng.ts, plugins/office/client/layout/theme.ts, plugins/office/client/layout/geometry.ts, plugins/office/client/layout/builder.ts, plugins/office/client/layout/core.ts, plugins/office/client/layout/corridor.ts, plugins/office/client/layout/room.ts, plugins/office/client/layout/building.ts, tests/ui/office-layout.test.mjs
Lenses: correctness

| id | severity | status | verdict | file | trigger |
| --- | --- | --- | --- | --- | --- |
| F-01 | medium | deferred | - | plugins/office/client/layout/builder.ts:67 | Build two buildings with buildBuilding, then mutate a core wall style of the first, for example a.core[0].walls[0].style |
| F-02 | low | deferred | - | plugins/office/client/path/grid.ts:33 | Call any WalkGrid method with a non-integer tile, for example grid.get(1.5, 0), grid.walkable(1.5, 0) or grid.reachableF |

## gsd-07-w3-07-03

Scope: plugins/office/shared/tint.ts, plugins/office/shared/model-types.ts, plugins/office/client/limits.ts, plugins/office/client/spike-hud.ts, plugins/office/client/spike-screen.tsx, plugins/office/server/art/spike/palette.ts, plugins/office/server/art/spike/chars.ts, plugins/office/server/art/spike/rooms.ts, tests/ui/office-spike-gate.test.mjs, plugins/office/shared/art-types.ts, plugins/office/shared/sprites-rpc.ts, plugins/office/server/sprite-registry.ts, plugins/office/index.client.tsx
Lenses: correctness

| id | severity | status | verdict | file | trigger |
| --- | --- | --- | --- | --- | --- |
| F-01 | medium | deferred | - | plugins/office/client/spike-screen.tsx:77 | The screen mounts and starts ensure(sceneKeys(2,32)) from the zoom/count effect, which marks all 38 keys in-flight. The  |
| F-02 | medium | deferred | - | plugins/office/client/spike-screen.tsx:656 | Pick zoom 3 and press 'Cadence window'. The smoothness question and its yes/no buttons render while phase === 'cadence', |
| F-03 | medium | deferred | - | plugins/office/client/spike-screen.tsx:545 | Click 'Cadence window' while sprites are still loading, or after a character-sheet key failed. Alternatively, switch cou |
| F-04 | low | deferred | - | plugins/office/client/spike-screen.tsx:78 | One office.sprites call rejects, or returns `ok:false` with a transient code such as 'internal', for a scene or tint chu |
| F-05 | low | deferred | - | plugins/office/client/spike-hud.ts:291 | A seeded agent (returned by agents.list) later receives its first live upsert, for example idle to running. logSeed() on |
| F-06 | low | deferred | - | plugins/office/client/spike-screen.tsx:393 | The host renders the plugin screen under React StrictMode (effects mounted, cleaned up, mounted again). The `live` ref i |

## gsd-07-w4-07-04

Scope: plugins/office/server/art/hash.ts, plugins/office/server/art/icons.ts, plugins/office/server/art/character/parts.ts, plugins/office/server/art/character/types.ts, plugins/office/server/art/character/appearance.ts, plugins/office/server/art/character/hair.ts, plugins/office/server/art/character/render.ts, plugins/office/server/art/character/sheet.ts, tests/ui/office-art-character.test.mjs
Lenses: correctness

| id | severity | status | verdict | file | trigger |
| --- | --- | --- | --- | --- | --- |
| F-01 | low | deferred | - | plugins/office/server/art/character/render.ts:1519 | renderCharacterSheet with poses including cheer, play or rps for any seed. Examples: cheer/left frame 1 has fist skin pi |
| F-02 | low | deferred | - | plugins/office/server/art/character/render.ts:53 | A caller reuses one Appearance object, renders a frame, mutates a field such as hair or top, and renders again. |
| F-03 | info | deferred | - | plugins/office/server/art/icons.ts:400 | renderIcon('constructor'), renderIcon('__proto__'), or any non-icon string. |
| F-04 | info | deferred | - | plugins/office/server/art/character/render.ts:1464 | Reading itemPos for the held items 'controller' and 'lipstick'. |
| F-05 | info | deferred | - | tests/ui/office-art-character.test.mjs:119 | A future ported source file that contains a regex literal with a quote character, or a nested backtick inside a ${} expr |

## gsd-07-w4-07-05

Scope: NOTICE.md, LICENSES/habblaud-MIT.txt, plugins/office/server/art/furniture/common.ts, plugins/office/server/art/furniture/hash.ts, plugins/office/server/art/furniture/index.ts, plugins/office/server/art/furniture/kit.ts, plugins/office/server/art/furniture/office.ts, plugins/office/server/art/furniture/types.ts, plugins/office/server/art/furniture/wall.ts, plugins/office/server/art/pixelfont.ts, plugins/office/server/art/rooms.ts, plugins/office/server/art/seasonal.ts, plugins/office/server/art/surfaces/floor.ts, plugins/office/server/art/surfaces/rug.ts, plugins/office/server/art/surfaces/types.ts, plugins/office/server/art/surfaces/walls.ts, plugins/office/server/art/theme.ts, plugins/office/server/art/tint.ts, plugins/office/server/art/variants.ts, tests/ui/office-art-scene.test.mjs
Lenses: correctness

| id | severity | status | verdict | file | trigger |
| --- | --- | --- | --- | --- | --- |
| F1 | low | deferred | - | plugins/office/server/art/rooms.ts:521 | The 07-02 builder gives every furniture and wall placement an `order` draw-order key. The real reception layout puts arm |
| F2 | low | deferred | - | plugins/office/server/art/rooms.ts:306 | `renderRoomLayer` is called with a wall whose doorway has a fractional `x` or `w`, for example `{x: 48.5, w: 31.5}`. The |
| F3 | low | deferred | - | plugins/office/server/art/rooms.ts:556 | A corridor is cut into 16-tile crops, and a sign (42 px) or whiteboard sits across a crop boundary. |
| F4 | low | deferred | - | plugins/office/server/art/theme.ts:35 | `themeFor(NaN)` or `themeFor(Infinity)`. Both make `Math.floor(seed) % n` NaN, so `THEMES[NaN]` is undefined. |
| F5 | low | deferred | - | plugins/office/server/art/furniture/index.ts:24 | `renderFurniture('elevator', undefined, NaN, NaN)` returned `{variant: undefined, state: NaN, vseed: 0}` and a 34x30 spr |
| F6 | info | deferred | - | plugins/office/server/art/variants.ts:318 | Raising `SCREEN_FRAMES` to 10 or more, or changing the `s % 3` and `s % 2` seed reduction in `screenVariant`. |
| F7 | low | deferred | - | plugins/office/server/art/rooms.ts:277 | A rug `color` of 'banana', or `floorTint: 'red'` (any non-hex string). I ran both: the rug rendered magenta without erro |
| F8 | info | deferred | - | plugins/office/server/art/pixelfont.ts:41 | `pixelTextWidth('İ')` returns 3, but `pixelText` lower-cases it to two code points ('i' plus U+0307) and advances 8. Com |

## gsd-07-w4-07-06

Scope: plugins/office/client/limits.ts, tests/ui/fake-paseo.mjs, plugins/office/client/model.ts, plugins/office/client/poses.ts, plugins/office/client/sprite-store.ts, plugins/office/client/store.ts, tests/ui/office-model.test.mjs, tests/ui/office-poses.test.mjs
Lenses: correctness

| id | severity | status | verdict | file | trigger |
| --- | --- | --- | --- | --- | --- |
| F-01 | medium | deferred | - | plugins/office/client/store.ts:528 | An agent emits a timeline `error` item, then retries and recovers. The daemon's next agent upsert has `lastError: null`  |
| F-02 | medium | deferred | - | plugins/office/client/store.ts:807 | The agents list subscription is restored while the restored list spans more than one page (`pageInfo.hasMore` true). Dur |
| F-03 | low | deferred | - | plugins/office/client/store.ts:795 | A restore re-list fails, or `projects.list` throws after a successful start: `onRestore` calls `loadProjects(false)`, wh |
| F-04 | medium | deferred | - | plugins/office/client/sprite-store.ts:134 | A long-running office session with churn of agents or tints. Every distinct agent seed, pose group, zoom and tint adds a |
| F-05 | low | deferred | - | plugins/office/client/store.ts:889 | An agent whose timeline `ready` rejects persistently, for example a daemon that cannot subscribe that agent, while it is |
| F-06 | low | deferred | - | plugins/office/client/store.ts:1012 | The user selects agent A, which has no todo item in its history. Paging runs up to TIMELINE_TODO_PAGES_MAX pages and end |
| F-07 | low | deferred | - | plugins/office/client/store.ts:925 | A timeline subscription is open but its tail read is pending, so `entry.live` is false. Buffered events A and B arrive.  |
| F-08 | info | deferred | - | tests/ui/fake-paseo.mjs:66 | Reading tests/ui/fake-paseo.mjs: `timelineHandlers` is declared and pushed to, but never read. |

## gsd-07-w4-07-07

Scope: plugins/office/shared/wave-rpc.ts, plugins/office/server/frontmatter.ts, plugins/office/server/wave-link.ts, tests/ui/office-wave.test.mjs, tests/ui/office-server.test.mjs, plugins/office/index.server.ts
Lenses: correctness

| id | severity | status | verdict | file | trigger |
| --- | --- | --- | --- | --- | --- |
| F-01 | medium | deferred | - | tests/ui/office-server.test.mjs:56 | Delete linker.clear() from the disposer returned by contribute in index.server.ts:15-17. The test 'OFFC-03 server: contr |
| F-02 | low | deferred | - | plugins/office/server/wave-link.ts:151 | A PLAN has a missing, empty or odd wave value, for example wave set to a quoted empty string, to true, to [1], or no wav |
| F-03 | info | deferred | - | plugins/office/server/wave-link.ts:123 | Opening wave-link.ts line 123 in an editor or diff view that does not show the invisible byte-order-mark character U+FEF |
| F-04 | info | deferred | - | plugins/office/server/wave-link.ts:106 | A SUMMARY, PLAN, run.json or args.json is rewritten with the same mtimeMs (coarse timestamp resolution, or a copy tool t |

## gsd-07-w4-07-08

Scope: plugins/office/client/character.tsx, plugins/office/client/clocks.ts, plugins/office/client/life/bank.ts, plugins/office/client/life/frames.ts, plugins/office/client/life/journey.ts, plugins/office/client/life/ledger.ts, plugins/office/client/life/runner.ts, plugins/office/client/life/social.ts, plugins/office/client/life/walk.ts, plugins/office/client/life/wander.ts, plugins/office/client/limits-life.ts, tests/ui/office-life.test.mjs
Lenses: correctness

| id | severity | status | verdict | file | trigger |
| --- | --- | --- | --- | --- | --- |
| F1 | medium | deferred | - | plugins/office/client/life/runner.ts:90 | A character is mid-leg of a handoff journey, then the caller passes a new journey object (for example the parent changed |
| F2 | low | deferred | - | plugins/office/client/character.tsx:81 | `zoom` or `sheetZoom` changes (viewport refit) while a journey is running, for example during the 1200 ms `wait` at the  |
| F3 | low | deferred | - | plugins/office/client/character.tsx:70 | `sheets` holds a sheet whose `poses` is empty (or whose poses lack the wanted pose and `sheets[0]` has none). `sheetFor` |
| F4 | low | deferred | - | tests/ui/office-life.test.mjs:648 | The test `OFFC-09 shared clocks in the component` asserts that no clock value changes after both sprites unmount. `withH |
| F5 | info | deferred | - | plugins/office/client/life/journey.ts:94 | One reception elevator spot is on an unwalkable tile. `elevatorFronts` filters it out, so the array is shorter and the r |

## gsd-07-w4-07-09

Scope: plugins/office/client/limits-atmosphere.ts, plugins/office/client/daylight.ts, plugins/office/client/season.ts, plugins/office/client/effects.ts, plugins/office/client/atmosphere.tsx, plugins/office/client/effects.tsx, tests/ui/office-atmosphere.test.mjs
Lenses: correctness

| id | severity | status | verdict | file | trigger |
| --- | --- | --- | --- | --- | --- |
| F-01 | low | deferred | - | plugins/office/client/effects.tsx:110 | A caller passes EffectLayer a raw list of more than EFFECT_MAX_ACTIVE (3) placements with distinct ids, instead of a que |
| F-02 | low | deferred | - | plugins/office/client/effects.ts:187 | Wave 07:1 completes (effect id 'wave:07:1' is queued). The link regresses (for example a plan is re-opened) and complete |
| F-03 | info | deferred | - | plugins/office/client/daylight.ts:156 | TINT_LEVELS > 2 with a middle variant missing (not loaded), for example available = [loaded, loaded, missing, loaded]. T |
| F-04 | info | deferred | - | tests/ui/office-atmosphere.test.mjs:436 | The test file runs the 'OFFC-18 effect component' test. The 'h' layer (1800 ms / 3200 ms real Animated.timing) and the ' |

## gsd-07-w4-07-10

Scope: plugins/office/client/drawer-model.ts, plugins/office/client/drawer.tsx, plugins/office/client/limits-panels.ts, plugins/office/client/sidebar-model.ts, plugins/office/client/sidebar.tsx, plugins/office/client/strings.ts, plugins/office/client/topbar-model.ts, plugins/office/client/topbar.tsx, tests/ui/office-client.test.mjs
Lenses: correctness

| id | severity | status | verdict | file | trigger |
| --- | --- | --- | --- | --- | --- |
| F-01 | low | deferred | - | plugins/office/client/strings.ts:108 | An agent, project or workspace title made only of zero-width or bidi format characters, such as "\u200b" or "\u202e", or |
| F-02 | low | deferred | - | plugins/office/client/strings.ts:110 | clipText("x".repeat(79) + "😀" + "tail", 80). The cut at index max-1 lands between the two halves of a surrogate pair. |
| F-03 | low | deferred | - | plugins/office/client/sidebar-model.ts:126 | Snapshot with two workspaces that share an id, or two agents that share an id, as in the plan's duplicate-id edge case.  |
| F-04 | info | deferred | - | plugins/office/client/drawer-model.ts:80 | A todo item with an empty or non-string text and a known status. The plan's own test feeds `null` and a weird status. |
| F-05 | info | deferred | - | tests/ui/office-client.test.mjs:501 | A future edit adds `text(row.expanded ? "sidebarCollapse" : "sidebarExpand")`-style calls with a misspelt key, or a new  |

## gsd-07-w5-07-11

Scope: plugins/office/client/camera.ts, plugins/office/client/wave-trigger.ts, plugins/office/client/room.tsx, plugins/office/client/scene.tsx, plugins/office/client/office-screen.tsx, tests/ui/office-scene.test.mjs, plugins/office/shared/sprites-rpc.ts, plugins/office/server/sprite-registry.ts, plugins/office/client/register.ts, plugins/office/index.client.tsx
Lenses: correctness

| id | severity | status | verdict | file | trigger |
| --- | --- | --- | --- | --- | --- |
| F1 | medium | deferred | - | plugins/office/client/office-screen.tsx:230 | The first office.sprites call rejects or returns ok:false, for example while the server side is still starting. sprite-s |
| F2 | medium | deferred | - | plugins/office/client/camera.ts:751 | A closed agent finishes its 5-beat sleep and starts a departure walk. Before the walk ends, the agent's status changes f |
| F3 | medium | deferred | - | plugins/office/client/office-screen.tsx:421 | The user presses zoom-in while scrolled away from the origin, for example centred on the right half of the building. |
| F4 | low | deferred | - | plugins/office/client/camera.ts:293 | A project has two or more workspaces with no drawn agents, or an empty workspace precedes a workspace with agents. For e |
| F5 | low | deferred | - | plugins/office/client/office-screen.tsx:184 | The building layout rebuilds because a project is added or removed, which changes roomsSignature. The `life` memo then c |
| F6 | low | deferred | - | plugins/office/client/camera.ts:647 | A character is initializing and its walk sheet (MOVE group) comes back failed, or the agent leaves the first-6 idle-cand |
| F7 | low | deferred | - | plugins/office/client/office-screen.tsx:136 | The screen runs under React StrictMode, or the effects are otherwise re-run (dev refresh or strict effects). The simulat |
| F8 | low | deferred | - | plugins/office/client/wave-trigger.ts:136 | The snapshot lists 8 or more distinct (workspaceId, runId) pairs, including old or finished runs. A new run then appears |
| F9 | info | deferred | - | plugins/office/client/office-screen.tsx:279 | A handoff is queued while the child's move sheet has not loaded yet. Meanwhile sprite settlements or pending-list change |

## gsd-07-w5-07-12

Scope: README.md, kit/machine/plugins.mjs, plugins/office/README.md, plugins/smoke.mjs, tests/machine/apply.test.mjs, tests/machine/check.test.mjs, tests/ui/plugin-gates.test.mjs, tests/ui/office-tree-gates.test.mjs
Lenses: correctness

| id | severity | status | verdict | file | trigger |
| --- | --- | --- | --- | --- | --- |
| F-01 | medium | deferred | - | tests/ui/office-tree-gates.test.mjs:103 | A pure runtime module that no office test imports is named by an import in a module that a test does import, even a type |
| F-02 | medium | deferred | - | tests/ui/office-tree-gates.test.mjs:128 | A test imports with a multi-line specifier list, such as `import {\n alpha,\n beta,\n} from "../../plugins/office/client |
| F-03 | medium | deferred | - | plugins/smoke.mjs:79 | Run plugins/smoke.mjs against a daemon or SDK build where the `paseo.projects` namespace is absent. The array literal at |
| F-04 | low | deferred | - | tests/ui/office-tree-gates.test.mjs:164 | A client .tsx contains `<Text>{open ? "Close" : "Open"}</Text>` or `<Text>{ok && "Done"}</Text>`. Neither is a JsxText n |
| F-05 | low | deferred | - | tests/ui/plugin-gates.test.mjs:165 | The installed Paseo CLI is 0.12.0, the version office is pinned to (PASEO_PIN.office), or any version other than 0.11.2. |
| F-06 | low | deferred | - | tests/ui/plugin-gates.test.mjs:379 | A server file puts code after a block-comment opener on one line, such as `/* x */ import fs from "node:fs";`, or starts |
