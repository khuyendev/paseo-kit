---
name: kit-init
description: "Sets up a project for paseo-kit: git repository, kit install with the harness-files mod, readiness checks, then the GSD codebase map and the harness adapter. Use when the owner asks to init, initialize, set up or bootstrap a project (\"init project này\", \"khởi tạo project\", \"thiết lập project\"), types /kit-init, or wants an existing project brought up to the kit. Not Claude Code's built-in /init, which only writes CLAUDE.md."
---

# kit-init: set up a project for paseo-kit

The target is the current working directory unless the owner names another folder. Do the steps in order, report
each result in one line, and end with a summary that lists every step as done, skipped (why) or needs-owner.

Kit root: run `node <this skill folder>/scripts/kit-root.mjs` and use only its output as `<kit>`. It prints the kit
folder holding `kit.mjs` and `kit.json`, or fails with `failed: no paseo-kit root above <path>`; on failure stop and
tell the owner the skill is not linked from a kit checkout (`node <kit>/kit.mjs machine apply --link-user-skills`).

Never add `--force` and never run `pull` without the owner's decision.

## 1. Git

- `git -C <project> rev-parse --show-toplevel`:
  - fails: not a repository. Ask the owner before `git init` (the folder may be meant as part of another repository),
    unless the owner asked for a new project in a new folder: that request covers `git init`.
    After `git init` do not commit unless asked.
  - prints a parent folder: the project sits inside another repository. Tell the owner and ask whether to continue
    there or create a separate repository.
- Uncommitted changes: announce them before installing, so kit changes can be told apart from the owner's.

## 2. Requirements (report only; install nothing globally)

- Node.js (`node --version`; the kit needs Node 20.17+ with `path.matchesGlob`, Node 24 recommended).
- Claude Code (`claude --version`; the harness-files mod needs 2.1.296+).
- Paseo CLI (`paseo --version`) and whether its daemon is running.
- Machine setup: `node <kit>/kit.mjs machine check`; report its `problem` lines and point to
  `node <kit>/kit.mjs machine apply` for the owner. Do not run `apply` without the owner.

## 3. Kit install with the mod

- When `<project>/.agents/harness-kit.json` exists run `update`, else `install`, always with `--enable-plugin`:
  `node <kit>/kit.mjs install <project> --enable-plugin` (or `update <project> --enable-plugin`).
- Run it under the intended Claude config folder (`CLAUDE_CONFIG_DIR`, the one the Paseo provider uses, for example
  `~/.claude-circle`): the mod's marketplace is registered in that user configuration.
- Exit code 2 means kit parts were kept, not applied (kit files changed in the project): report each `conflict` line
  (install) and each `kept` line (update), with the summary count, and stop for the owner.
  Never add `--force` and never run `node <kit>/kit.mjs pull` without the owner's decision.
- `failed: mod activation: marketplace paseo-harness-kit is already registered from <path>`: one Claude config folder
  holds one `paseo-harness-kit` marketplace, and another project (often one on the old kit) owns it. The files are
  copied but no manifest is written. Stop and give the owner, in plain message text before any question, what the mod
  is (the batch file tools `read_ranges`, `edit_multiple_files`, `write_multiple_files`; without it agents use plain
  Edit/Write), which projects use the registered one (`installed_plugins.json` in the config folder), and the choices:
  install without `--enable-plugin` (touches no other project; enable later with `update <project> --enable-plugin`),
  or `claude plugin marketplace remove paseo-harness-kit` and install again (those projects lose the mod until they
  are updated to this kit). Never remove the marketplace without the owner's decision.

## 4. Status and doctor

- `node <kit>/kit.mjs status <project>` and, from the project root, `node .agents/harness/ph.mjs doctor`; report every
  `problem` line.
- Say that the hooks and the harness-files mod take effect in a new Claude Code session.

## 5. Next: map the codebase, then generate the adapter

- Point the owner to `gsd-map-codebase` (writes the codebase map under `.planning/`), then to the `harness` skill's
  adapter generator, which writes the project's adapter (build and test commands, tiers, review lenses) into
  `.agents/harness.config.json`. When that generator writes the adapter it seeds `adapter.ownership.regenerated`
  with the stack's tool-output globs if the overlay has no such key (Flutter: the platform plugin registrants;
  the list is in the harness skill's `references/kit-adapter.md`) and keeps a list the project already set, including
  an empty one. Do not run them as part of this skill unless the owner asks.
- On a greenfield project (no code yet) the map is not made here: `phase complete` proposes `gsd-map-codebase` and
  `harness` (its `proposals`) once a phase that ships code completes; gsd-verify shows them to the owner.

## Summary

One line per step (git, requirements, install/update, status and doctor, next steps): done, skipped (why) or
needs-owner (what), then the kit version from `<kit>/kit.json` and anything waiting for the owner (new session,
the conflict or kept paths with the `N kept` count, missing tools, machine apply).
