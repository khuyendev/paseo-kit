# GSD core in paseo-kit

The GSD method text under `.agents/gsd/upstream/` is a trimmed, unmodified snapshot of open-gsd/gsd-core (branch `next`, commit pinned in `.agents/gsd/upstream/UPSTREAM.json`, MIT licence: `.agents/gsd/upstream/LICENSE`, also `LICENSES/gsd-core-MIT.txt` in the kit). The generated agents in `.agents/agents/` and the texts in `.agents/gsd/generated/` are that text with only three path rewrites into the snapshot. The kit code (`ph gsd`, workflow scripts, overlays) is written by the kit; no upstream code is carried.

## Departures from upstream (adapter layer)

Each departure is applied by a kit overlay or by kit code, never by editing upstream text, and is enforced by the named requirement.

| departure | enforced by |
| --- | --- |
| Only the orchestrator commits; workers never commit, push or change branches | GSDC-38 |
| Owner questions become markers returned to the orchestrator instead of in-agent questions | GSDF-01 |
| Single writer of PROJECT, STATE, ROADMAP and REQUIREMENTS (the orchestrator, through `ph gsd`) | GSDC-12 |
| Plan verify obligations are run by the post-wave gate with the adapter's commands, not by executors | GSDC-19 |
| Gap closure is capped at one gap wave per phase | GSDC-30 |
| Plans of one wave declare disjoint `owns` when the adapter uses a shared tree | GSDC-23 |
| Research provider waterfall and cache, and the package legitimacy audit, are not installed | GSDC-33 |
| Upstream verbs and modes the kit does not serve answer "not ported" (exit 69) with a reason | GSDC-04 |
| Settings come from the project harness config (sections `adapter`, `gsd`), never from a config.json under .planning | GSDC-01 |
