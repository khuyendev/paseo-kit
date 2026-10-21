# office

Paseo plugin: a read-only pixel-art office of the Paseo projects, workspaces and agents of this host. It draws from the
official Paseo API only. The art is ported from habblaud under the MIT licence (see Licence below).

## What it shows

Desktop only; mobile not tested; one host.

- One building. A room per Paseo project; in it a desk cluster per workspace with its sign and its status light.
- A character per agent, with a pose that follows the agent's state; children walk to their parent.
- Common areas, day and night, and seasons.
- An effect on a wave or phase completion, drawn from the wave link described below.
- The sidebar tree and the agent drawer, the counters, and the context taken from the last usage of each agent.
- A "+N agents" group above the caps, so a large host stays readable.
- An empty slot for provider usage. Nothing fills it.

The spike thresholds that decide the zoom levels and the tint levels were fixed in
`.planning/phases/07-office/07-SPIKE.md` before anything was measured.

## What it reads

- The official Paseo API, through subscriptions to agents, workspaces, projects and timelines.
- Sprite requests to its own server: an enumerated key, never a path or free text.
- The one wave link: when an agent carries the `harness.run` label, the plugin server reads the run record and the
  plan and summary files of that phase under the workspace directory. The read is contained to that directory and
  read-only; it is the only file read of the plugin.

## What it never does

It never sends prompts or messages, never answers a permission request, never opens a terminal, never spawns or
archives an agent, never writes a file, never runs a subprocess and never plays a sound. It does not call the provider
usage API of Paseo. The only actions are navigation.

## Operator steps

1. Enable Paseo plugins on this machine with the kit: `node kit.mjs machine apply --enable-paseo-plugins`. It sets
   `pluginsEnabled: true` in the Paseo config, registers the plugin folders and installs their dependencies (`npm ci`)
   when `node_modules` is missing. Without that flag the kit never touches Paseo plugin settings.
2. Dependencies by hand (only if you skipped step 1): `npm install --ignore-scripts` in this folder.
3. Typecheck: `node node_modules/typescript/bin/tsc --noEmit`.
4. Paseo: `paseo plugin install <this folder>` (once, if not registered by step 1), then
   `paseo plugin reload office` after a change, `paseo plugin ls` (shows `running`) and `paseo plugin logs office`.
5. After a Paseo upgrade: update `requirements.paseo` in `paseo-plugin.json` and the `@getpaseo/plugin` pin.

## Stale registration

If `paseo plugin ls` still lists the retired plugin swarm-map, registered by an earlier `machine apply --enable-paseo-plugins`, remove it with `paseo plugin remove swarm-map`; the kit no longer ships or registers it.

## Licence

The art under `server/art`, and the layout and path code of the client, are ported from habblaud by marmottajr under
the MIT License. The notice is in `NOTICE.md` and the licence text is in `LICENSES/habblaud-MIT.txt`.
