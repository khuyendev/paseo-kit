# office

Paseo plugin: a read-only pixel-art office of the Paseo projects, workspaces and agents of this host. It draws from the
official Paseo API only. The art is ported from habblaud under the MIT licence (see Licence below).

## What it shows

Desktop only; mobile not tested; one host.

- One building. A room per Paseo project; in it a desk cluster per workspace with its sign and its status light.
- A sidebar with one checkbox per project, "All" and "None": an unchecked project leaves the scene and the counters (the
  filter runs where the building model is built). Pressing a project name moves the camera to its room. The choice lasts
  as long as the plugin is loaded; it is not saved across an app restart or a plugin reload.
- A search field (opened with the "Search" button) that filters the project list and finds agents by name or title;
  choosing an agent selects it and moves the camera.
- A character per agent with a generated name and a provider chip under it, and a pose and a bubble that follow its
  state: the tool it uses while working, a blinking alert for a permission request, a soft "!" when it waits for you,
  an hourglass while it waits on a shell command it started (it eats popcorn, crosses its arms and spins its chair after
  3 min, gathers a cobweb after 10 min, dozes after 25 min, and cheers with confetti when the command ends), and a doze
  after 10 min idle. Children walk to their parent when they finish.
- Arrivals and departures: an agent created less than 30 s ago comes up by elevator, in waves of three; agents already
  there when the office opens just sit. An archived agent walks to an elevator and leaves; more than three archived at
  once fade in place. A room with nobody in it goes dark; the last one out turns the lights off.
- Common areas, day and night, and seasons.
- An effect on a wave or phase completion, drawn from the wave link described below.
- The agent drawer: state, tool, todos, child agents, last error, and stats (tokens used of the context with a bar,
  model, provider, session name and kind, lines added and removed, tool calls by kind over the loaded timeline, cost
  when the provider reports it, age). Follow keeps the camera on the agent (also a double press on a character).
- Camera controls: zoom, Overview (the whole building at the smallest zoom) and Next request (the next agent that
  needs you).
- A toggleable activity feed of the visible projects (arrived, finished its turn, asks for permission, error, handed
  its result back, shell command finished, left), newest first, at most 40 lines.
- Counters for rooms, agents, sub-agents, states and shells running, and the context taken from the last usage of each
  agent.
- A "+N agents" group above the caps, so a large host stays readable.
- An empty slot for provider usage. Nothing fills it.

Two bounded heuristics on official data: a shell command text that names a common test runner shows the tests glyph
(`client/activity.ts`, `isTestCommand`; anything else shows the terminal glyph), and an idle agent whose latest shell
tool call in its timeline is still running counts as waiting on a shell (`client/moods.ts`; when the timeline carries no
readable status the state never shows).

Not shown: provider usage (5h and weekly), settings, a day summary, a timelapse, session history, sounds, notifications
and keyboard shortcuts (the plugin client gets no key events). Sub-agents do not leave right after a handoff; they leave
when they are closed or archived.

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
