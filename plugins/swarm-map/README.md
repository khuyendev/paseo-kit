# swarm-map

Paseo plugin: a live, read-only map of the agents `ph` spawns. Each brain (the agent that spawned subagents) is
drawn on the left, its swarms as hubs, their agents on rings around the hub, with live activity, files held, an
event feed and an inspector.

How agents are read (all of it is stamped by `ph` when it creates an agent):

- label `paseo.parent-agent-id`: links a subagent to its brain (written last, so a caller label cannot replace it);
  a subagent whose parent is archived or missing goes to the ORPHANS bucket;
- label `ph.swarm`: the swarm (hub) an agent belongs to; agents without it are grouped by their title;
- label `harness.run`: the workflow run; the hub ring then shows `.planning` wave progress from that run's
  `_workspace/_runs/<run>/args.json` (`phaseDir`, `wave`), else the hub is drawn `unlinked`;
- titles are shown shortened (the swarm prefix and paths cut); agents with neither parent nor subagents are counted,
  not drawn.

The context ring turns to the warning colour at the same threshold `ph context` uses for ROTATE, read from the
agent's project config (`context_guard.start_pct`).

## Operator steps

1. Enable Paseo plugins on this machine with the kit: `node kit.mjs machine apply --enable-paseo-plugins`. It sets
   `pluginsEnabled: true` in the Paseo config, registers this folder as a directory plugin and installs its
   dependencies (`npm ci`) when `node_modules` is missing. Without that flag the kit never touches Paseo plugin
   settings.
2. Dependencies by hand (only if you skipped step 1): `npm install --ignore-scripts` in this folder.
3. Typecheck: `node node_modules/typescript/bin/tsc --noEmit`.
4. Paseo: `paseo plugin install <this folder>` (once, if not registered by step 1), then
   `paseo plugin reload swarm-map` after a change, `paseo plugin ls` (shows `running`) and `paseo plugin logs swarm-map`.
5. After a Paseo upgrade: `node ../smoke.mjs` against the running daemon re-checks the SDK calls, fields and icon
   names the plugins use, then update `requirements.paseo` in `paseo-plugin.json` and the `@getpaseo/plugin` pin.

The plugin is read-only: it never sends prompts, spawns, archives, cancels or changes agents, never writes files
and runs no subprocess. The only actions are navigation and copying an id or a path.
