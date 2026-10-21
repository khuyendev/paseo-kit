# Notice

paseo-kit carries text from three third-party works. Everything else in this repository is written for the kit.

## Harness v2 (Apache License 2.0)

`ship/.claude/skills/harness/` and `ship/.claude/skills/harness-evolve/` are a modified English port of
**Harness v2** by revfactory (https://github.com/revfactory/harness, version 2.1.0, commit
`92d9f1b29e7af81acebf51a9fcd1832e739a1414`), licensed under the Apache License 2.0. The port is carried from
paseo-harness-kit tag `ref-final` (commit `4441a88e5083727a282a4a7efb5872b1d4dac777`) unchanged except for
inventoried adapter-layer regions (decision D-111, requirements HARN-01/02). Each skill folder ships the `LICENSE`
and a `NOTICE.md` listing the port's changes and every adapter region; the licence is also in
`LICENSES/harness-Apache-2.0.txt`. The kit test `tests/harness/method-text.test.mjs` checks the shipped text against
the source copy and the region inventory (`tests/harness/fixtures/PROVENANCE.json`).

`ship/.claude/skills/ai-orchestrator/` is kit-authored text carried from the same tag with one adapter edit (its
`NOTICE.md`); it is not derived from Harness v2.

## GSD core (MIT)

`ship/.agents/gsd/upstream/` is a trimmed, unmodified snapshot of **open-gsd/gsd-core** (branch `next`, commit
`274f8cae13d03ad80e18959b135b0e51b33329e8`, pinned with per-file hashes in
`ship/.agents/gsd/upstream/UPSTREAM.json`), licensed under the MIT License (`ship/.agents/gsd/upstream/LICENSE`,
also `LICENSES/gsd-core-MIT.txt`). The generated agents in `ship/.agents/agents/` and the texts in
`ship/.agents/gsd/generated/` are that text with three path rewrites; kit overlays are applied after it and never
edit it. `ship/.agents/gsd/NOTICE.md` lists the departures from upstream with the requirement that enforces each
(GSDC-49); `ph gsd upstream check` verifies the snapshot and the generated files.

## habblaud (MIT)

`plugins/office/server/art/`, `plugins/office/client/layout/` and `plugins/office/client/path/` are a modified TypeScript port of
**habblaud** by marmottajr (https://github.com/marmottajr/habblaud) at commit
`faa1a012b5fbf632c66dc6801c5383e53a542406`, licensed under the MIT License (`LICENSES/habblaud-MIT.txt`). The changes are
erasable-syntax TypeScript, English comments, and canvas drawing replaced by PixelBuf drawing with PNG encoding on the plugin
server. No bitmap asset, character editor, or social, terminal, Docker, Codex, World, dictation, delivery or timelapse module
is carried. The first line of each ported file names its upstream path.

## Pins

| work | pin | licence file |
| --- | --- | --- |
| revfactory/harness | 2.1.0, `92d9f1b29e7af81acebf51a9fcd1832e739a1414` (via paseo-harness-kit `ref-final`, `4441a88`) | `LICENSES/harness-Apache-2.0.txt` |
| open-gsd/gsd-core | `next` @ `274f8cae13d03ad80e18959b135b0e51b33329e8` | `LICENSES/gsd-core-MIT.txt` |
| marmottajr/habblaud | `faa1a012b5fbf632c66dc6801c5383e53a542406` | `LICENSES/habblaud-MIT.txt` |
| @getpaseo/plugin (plugin dev dependency, not shipped) | 0.11.2 (`TESTED_PASEO_CLI`) | npm package licence |
