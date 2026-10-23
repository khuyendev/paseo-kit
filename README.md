# paseo-kit

A vanilla kit that installs into any project and lets one owner run multi-agent software work through
[Paseo](https://github.com/getpaseo) and its `ph` CLI, with Claude Code as the only agent harness (main session and
workers). It ships the GSD core (discuss -> research -> plan -> execute in waves -> verify, the `.planning/` format,
generic role agents) and the harness method, which generates each project's adapter. The kit carries nothing
specific to one project, engine or game (D-110); a project supplies only its adapter.

## Requirements

- Runtime (what a project runs): Node 20.17+ with `path.matchesGlob` (the gate table `NODE_RUNTIME` in
  `.agents/harness/platform.mjs`; `ph doctor` and `kit.mjs machine` report it).
- Kit tests (`npm test`): Node 24.
- Claude Code >= 2.1.296 for the harness-files mod; Paseo CLI (tested with 0.11.2) with a running daemon; Git.

## Install and update a project

```
node kit.mjs install <project> [--force] [--enable-plugin]
node kit.mjs update  <project> [--force] [--enable-plugin]
node kit.mjs status  <project>
node kit.mjs pull    <project> [<part>...] [--force] [--kit DIR]
node kit.mjs help
```

- `install` copies `ship/` onto the project root, writes the marked block into `AGENTS.md`, adds `@AGENTS.md` to
  `CLAUDE.md`, adds the kit block to `.gitignore` (`/_workspace/`, `/.claude/worktrees/`), reconciles the kit hook
  registrations in `.claude/settings.json`, seeds `.agents/harness.config.json` and `.agents/harness-history.md`
  once, and records every kit part with its digest in `.agents/harness-kit.json`.
- `update` takes kit changes and keeps local edits (listed, exit 2) unless `--force`; after the copy it runs the gsd
  workflows' argument checks on the merged overlay (a refused value is `problem`, exit 2) and names the overlay keys
  the CHANGELOG mentions since the installed version (`warning`); `status` is read-only; `pull` copies locally edited
  parts back into the kit.
- Ownership: kit-owned parts are tracked by digest; the overlay, the history table and `.planning/` belong to the
  project and are never overwritten; install never edits Paseo settings. `--force` never overrides removed-local
  parts, seeds, project-owned files, foreign settings keys or hooks, `CLAUDE.md` lines, `.gitignore` lines outside
  the kit block, user-scope Claude config or version gates.
- `--enable-plugin` activates the harness-files mod with `claude plugin install --scope project`; the kit never
  toggles an owner's plugin selection otherwise.
- Exit codes: 0 done; 1 usage error or refusal before any write; 2 done with conflicts, kept parts or blocked hooks.
  A failure after the first copy (write error, mod activation, malformed hook) can leave kit files copied and
  `.claude/settings.json` edited, with no `.agents/harness-kit.json`; fix the cause and re-run the same install.
- Ownership hashes preserve raw bytes and normalize only CRLF. Installation refuses linked destination paths
  (including junctions); `--force` never writes through them. Unchanged retired hooks lose their registrations,
  while locally edited retired hooks and their registrations stay for the owner.
- A project of the old kit 0.1.0: move `.agents/harness-kit.json` aside, run `install`, resolve the listed conflicts,
  delete retired files by hand. Old MCP file servers, when ready: `claude mcp remove --scope user fsbatch` and
  `claude mcp remove --scope user filesystem`.

## Machine setup

```
node kit.mjs machine check
node kit.mjs machine apply [--no-reload] [--enable-paseo-plugins] [--link-user-skills] [--unlink-user-skills]
node kit.mjs machine export
```

`apply` patches the Paseo config additively from `paseo/providers.json` (backup, atomic write, `paseo reload`): it
adds missing providers and models (never removes one), gives the worker provider (`circle-agent`) the kit's deny
list and env, and the main provider (`circle`) the deny list `Agent`, `Workflow` (main sessions orchestrate through
`ph`, not native subagents). `--enable-paseo-plugins` installs the two kit Paseo plugins; `--link-user-skills` links
the `kit-init` user skill into each Claude config dir. `check` reports the same policy lines as `ph doctor`. A reload
that did not finish (the apply was cut short, or `paseo reload` failed) is retried by the next apply, and `check` reports
it as a problem until then; `--no-reload` drops it.

## Project flow

1. `kit-init` (user skill) or `node kit.mjs install <project>`; then `node .agents/harness/ph.mjs doctor`.
2. The shipped tiers `frontier`, `pro`, `standard` are unconfigured: `ph spawn` fails until the overlay maps them
   (`tiers.<name>.provider: "circle/<model>"`).
3. Map the codebase (`gsd-map-codebase`), then run the `harness` skill: it reads `.planning/codebase/` and writes
   the project adapter (sections `adapter`, `gsd`, tiers) into `.agents/harness.config.json`, plus any project stack
   skill and agents, with a row in `.agents/harness-history.md` (D-109). `ph harness lint` checks what it wrote.
4. `gsd-new-project` (PROJECT, REQUIREMENTS, roadmap draft approved by the owner and installed by
   `ph gsd roadmap install-draft`), then per phase `gsd-discuss`, `gsd-research`, `gsd-plan`, `gsd-execute`,
   `gsd-verify`. `gsd-progress`, `gsd-pause`, `gsd-quick`, `gsd-undo`, `gsd-forensics` and `gsd-debug` cover the rest.
5. `harness-evolve` records lessons and updates the adapter, measured with `ph evolve-stats` (per agent version, per
   workflow with stop reasons and a suggested `--budget`, and the model's skill calls).

The main session works under the kit block of `AGENTS.md` (report to the owner under Blocked on me / Changed /
Found and mark what is unconfirmed; fix the product, not the fixture; clean up only what you created) and, when it
delegates, the `ai-orchestrator` skill: GSD skills for `.planning/` work, otherwise the execution modes, team patterns
and workflow recipes of the harness skill, and each agent's evidence checked before its result is accepted.

## ph

`node .agents/harness/ph.mjs <command>`; `ph help <command>` shows its usage. One line per item; exit 0 done,
1 usage/config/file error, 2 done with problems; `ph gsd` adds 66 (nothing in scope) and 69 (could not look).
Non-blocking commands end with a `next:` line naming the command to wait with.

- Agents: `spawn`, `fanout` (`--collect DIR` waits), `send`, `watch`, `result`, `team`, `context`, `stop`,
  `archive` (`--run RUNID [--reason TEXT]` stops a workflow run and records why), `compact-self`. Every agent is created as a subagent of the caller (`PASEO_AGENT_ID`) on the worker
  provider, with the kit prompt notes and a model resolved from tiers, aliases, roles and `allowed_models`.
- Coordination: `task` (shared task list), `freeze` (sha256 of phase files), `worktrees`.
- Workflows: `workflow --script F | --name N [--args JSON] [--resume RUNID] [--budget N] [--detach]`, `watch-run`,
  `run-stats`, `evolve-stats`, `review-stats`, `runs`. Scripts use `agent`, `parallel`, `pipeline`, `phase`, `log`, `budget`, `workflow`, `shell`
  and the `runId` global; runs live in `_workspace/_runs/<runId>/` with a journal for resume and a model-time
  watchdog (shipped: a nudge at 45 min and a stop at 90 min of model time, warnings for loops, rereads and long
  reading without a write, interruption of a hung tool call). Every ended run also appends one line to `_workspace/harness-metrics.jsonl` (kept when runs are pruned);
  `evolve-stats` prints it per agent version and per workflow for `harness-evolve`; `review-stats` measures the code
  review from each phase's review records and the fates recorded with `review-stats outcome`, and with `--stage
  skeleton|checker|plan|code` each review stage's fates, cost per confirmed finding and escapes. `ph run-stats`,
  `ph result --json` and `evolve-stats` price tokens with the shipped list-price table `.agents/model-prices.json`
  (the models of `paseo/providers.json`, each with its source page and check date). Running a workflow needs the
  owner's consent (ph skill).
- `config` (effective config with provenance), `doctor`, `gsd <verb>`, `harness lint [--all]`.

## GSD

`.agents/gsd/upstream/` is a pinned snapshot of open-gsd/gsd-core (`UPSTREAM.json`); `ph gsd upstream build`
generates the GSD agents (`.agents/agents/`) and method texts (`.agents/gsd/generated/`) from it with three path
rewrites, and `ph gsd upstream check` (also run by `ph doctor`) proves they are unchanged. Kit overlays
(`.agents/gsd/overlays/`, `.agents/workflows/overlays/`) are loaded after the upstream text and win on conflict; GSD
settings come only from the `gsd` section of the overlay (there is no config file under `.planning/`). The workflow
scripts in `.agents/workflows/gsd-*.js` orchestrate research, planning, execution and verification; every state
change of shared PROJECT/STATE/ROADMAP/REQUIREMENTS goes through `ph gsd` (single writer); agents write only
  their granted artifacts. Draft installation revalidates categorized v1 exact coverage under the writer lock.

Execution resumes incomplete gates/reviews/commits even when SUMMARY already exists. Worktree agents read
immutable planning inputs; later batch waves receive hash-checked accepted dependency output before dispatch.
Pre-existing owned dirty files are refused rather than overwritten. Missing review replies, failed required
commits and invalid/stale evidence stop execution.

Code review runs after the wave is green. Only critical and high findings with a trigger, confidence >= 80 and a
likelihood above theoretical block, and a `finding-verifier` confirms each one (a second verifier decides what the first left
uncertain). A finding outside the lines the plan changed that the change did not cause is recorded as pre-existing in
`deferred.md` and never blocks; one finding names its defect class and every instance, so one fix covers them. The
code fixer runs at effort `high` unless `gsd.roles.fixer.effort` is set. `gsd.code_review` is the owner's choice per
project: `max_concurrent` plans reviewed at once (default 1) and `reviewers`, extra independent reviewers of every plan
with their own model and effort (default none: one reviewer per `gsd.roles.reviewer`). Counts go to `_workspace/review-metrics.jsonl`. Default research offers refresh for an existing stale or blocked
report rather than silently replacing it. Doctor checks GSD integrity even with a broken project overlay.

## Adapter

The `adapter` section of `.agents/harness.config.json` is everything project-specific: `commands` (build, test,
gates, verify runners), `verify_vocabulary`, `ownership`, `review_lenses`, `syntax_checkers`, `instructions`,
`envelope`, `stack_skill`, `agents` (role -> project agent), `mutex`, `startup_globs`, `hook_timeout_s`,
`attribution`, `worktree_setup` (git-ignored paths such as `node_modules` copied or linked into each new harness
worktree, which `git worktree add` leaves out); the `gsd` section holds roles, granularity, plan limits, execution mode, isolation and the loop
bounds. Adapter scripts (parsers, resolvers, evidence parsers, attribution) speak one JSON request/response on
stdin/stdout (ADPT-15), with closed shapes and exactly one nonblank response line. The kit ships a neutral
adapter; `ph doctor` and `ph harness lint` check it. Null build/test commands are `not_configured`, never green.
Gate evidence validates all requested steps, logs, execution counts, current file scopes, HEAD and effective config.

### Change a tier's model, effort and Fast toggle

Keep these together in the project overlay, for example:

```json
{"tiers": {"pro": {"provider": "circle/<fast-capable model>", "thinking": "medium", "features": {"fast_mode": true}}}}
```

Use `false` for Fast off. Orchestrators normally select tier names (`--model pro` or `agent(..., {model: "pro"})`)
and patch only requested tier fields when the owner changes the mapping. A concrete model ID bypasses the tier's
features. Fast needs provider/model support, is independent of permission bypass, and applies to new agents rather
than changing running ones. No duplicate `pro-fast` tier or provider-config change is needed.

## File tools

The harness-files Claude Code mod (`.claude/plugins/harness-files/`, enabled per project with `--enable-plugin`)
gives agents three batch tools: `read_ranges`, `edit_multiple_files`, `write_multiple_files`. Every call is a
permission-gated ticket executed by the project backend `.agents/harness/files/`, which the mod verifies against the
install manifest before use; results are paged, edits commit atomically with receipts, fix IDs and line tags are
session-bound. `read_limits` in the config bounds reads.

## Hooks

Registered from `ship/templates/settings.hooks.json`; hooks never block a tool call.

- `context_guard.mjs`: reminds the main session to `ph compact-self` at `context_guard` bands.
- `io_guard.mjs`: reminders for unbatched lookups, edits and re-reads (`io_guard` thresholds).
- `syntax_check.mjs`: runs the adapter's `syntax_checkers` before and after edits and reports newly broken files.
- `bash_long_command.mjs`: rescues over-long Bash commands on Windows.
- `skill_usage.mjs`: logs each skill the model invokes to `_workspace/skill-usage.jsonl`; `ph evolve-stats` lists the
  counts, so a skill whose description never fires shows 0.

## UI

Two read-only Paseo plugins in `plugins/` (installed by `machine apply --enable-paseo-plugins`, never into
projects): `office` (a pixel-art building of the Paseo projects, workspaces and agents of this host, drawn from the
official Paseo API only, art ported from habblaud under MIT per `NOTICE.md`, needs Paseo 0.12.0; tested in the desktop
app, its narrow phone layout covered by offline tests only) and `planning-panel`
(a workspace's `.planning/` on the GSD status ladder). Their tests need `npm install --ignore-scripts` once in each
plugin folder.

If `paseo plugin ls` still lists the retired plugin swarm-map, registered by an earlier `machine apply --enable-paseo-plugins`, remove it with `paseo plugin remove swarm-map`; the kit no longer ships or registers it.

## Development

`npm test` runs every suite offline (fake daemon, fake clock, temp projects and homes); `tests/e2e/` installs the
kit into a temp project and drives the installed `ph`. `node kit/install/units.mjs --write` refreshes the shipped
units in `kit.json`; `node kit/release-check.mjs [<range>]` checks `CHANGELOG.md` against `kit.json` and prompt-text
commits (HARN-15). Third-party text: see `NOTICE.md`.

Offline regression success is not blanket live release qualification. Bounded Windows/Node 24 live checks now
cover two-stack adapter generation and fresh triggers, mod activation/read/edit/write/permission denials, Paseo
runtime/schema/resume, selected hook callbacks, and actual planning UI and the since-retired swarm map UI. See
`.planning/integration/live-acceptance.md` and `.planning/integration/requalify-adapters.md`. Full GSD lifecycle, all permission/hook modes,
scale/reconnect, POSIX, and qualification on the candidate minimum Node remain unverified.
