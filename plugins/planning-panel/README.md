# planning-panel

Paseo plugin: a read-only view of a workspace's `.planning/` folder as the GSD flows of the kit write it: phases
on the GSD status ladder (the same function `ph gsd roadmap analyze` uses), plans per wave, plan details (goal,
tasks, must-haves, completion from the SUMMARY), a file tree with a Markdown reader, and stats.

Surfaces: a sidebar surface with a project picker (main checkout first, worktrees in a switcher), a workspace panel,
and the command-center item `Open Planning`. `.planning/` is read with `node:fs` only, so the panel works under a
daemon whose PATH has no node or npm. Agents, labels and titles are not shown here; the swarm map shows the agents
`ph` spawns.

## Operator steps

1. Enable Paseo plugins on this machine with the kit: `node kit.mjs machine apply --enable-paseo-plugins`. It sets
   `pluginsEnabled: true` in the Paseo config, registers this folder as a directory plugin and installs its
   dependencies (`npm ci`) when `node_modules` is missing. Without that flag the kit never touches Paseo plugin
   settings.
2. Dependencies by hand (only if you skipped step 1): `npm install --ignore-scripts` in this folder.
3. Typecheck: `node node_modules/typescript/bin/tsc --noEmit`.
4. Paseo: `paseo plugin install <this folder>` (once, if not registered by step 1), then
   `paseo plugin reload planning-panel` after a change, `paseo plugin ls` (shows `running`) and `paseo plugin logs planning-panel`.
5. After a Paseo upgrade: `node ../smoke.mjs` against the running daemon re-checks the SDK calls, fields and icon
   names the plugins use, then update `requirements.paseo` in `paseo-plugin.json` and the `@getpaseo/plugin` pin.

The plugin is read-only: it never sends prompts, spawns, archives, cancels or changes agents, never writes files
and runs no subprocess. The only actions are navigation and copying an id or a path.
