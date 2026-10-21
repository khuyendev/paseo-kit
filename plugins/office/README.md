# office

Paseo plugin: a read-only pixel-art office of Paseo projects, workspaces and agents. At this stage it holds the
tracer screen: one sprite drawn on the plugin server (a ruler), sent as a PNG data URI by the `office.sprites` request
and shown as an image at its natural pixel size. The spike thresholds that decide the zoom levels and the tint levels
are fixed in `.planning/phases/07-office/07-SPIKE.md` before anything is measured.

What it reads: only the official Paseo API and sprite requests (an enumerated key such as `ruler:tracer:-:2:0`, never
a path or free text); later, the one wave link of the office requirements. What it never does: it never sends prompts,
spawns, archives, cancels, answers or messages agents, opens a terminal, writes files or runs a subprocess. The only
actions are navigation.

## Operator steps

1. Enable Paseo plugins on this machine with the kit: `node kit.mjs machine apply --enable-paseo-plugins`. It sets
   `pluginsEnabled: true` in the Paseo config, registers the plugin folders and installs their dependencies (`npm ci`)
   when `node_modules` is missing. Without that flag the kit never touches Paseo plugin settings.
2. Dependencies by hand (only if you skipped step 1): `npm install --ignore-scripts` in this folder.
3. Typecheck: `node node_modules/typescript/bin/tsc --noEmit`.
4. Paseo: `paseo plugin install <this folder>` (once, if not registered by step 1), then
   `paseo plugin reload office` after a change, `paseo plugin ls` (shows `running`) and `paseo plugin logs office`.
5. After a Paseo upgrade: update `requirements.paseo` in `paseo-plugin.json` and the `@getpaseo/plugin` pin.
6. Stale registration: once swarm-map is retired (plan 07-12), run `paseo plugin ls` and remove a leftover swarm-map
   registration.
