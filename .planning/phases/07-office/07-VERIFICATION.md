---
phase: 07-office
verified: 2026-10-21T13:59:00Z
status: human_needed
score: 8/11 must-haves verified
covered_files: [".planning/phases/07-office/07-01-PLAN.md",".planning/phases/07-office/07-01-SUMMARY.md",".planning/phases/07-office/07-02-PLAN.md",".planning/phases/07-office/07-02-SUMMARY.md",".planning/phases/07-office/07-03-PLAN.md",".planning/phases/07-office/07-03-SUMMARY.md",".planning/phases/07-office/07-04-PLAN.md",".planning/phases/07-office/07-04-SUMMARY.md",".planning/phases/07-office/07-05-PLAN.md",".planning/phases/07-office/07-05-SUMMARY.md",".planning/phases/07-office/07-06-PLAN.md",".planning/phases/07-office/07-06-SUMMARY.md",".planning/phases/07-office/07-07-PLAN.md",".planning/phases/07-office/07-07-SUMMARY.md",".planning/phases/07-office/07-08-PLAN.md",".planning/phases/07-office/07-08-SUMMARY.md",".planning/phases/07-office/07-09-PLAN.md",".planning/phases/07-office/07-09-SUMMARY.md",".planning/phases/07-office/07-10-PLAN.md",".planning/phases/07-office/07-10-SUMMARY.md",".planning/phases/07-office/07-11-PLAN.md",".planning/phases/07-office/07-11-SUMMARY.md",".planning/phases/07-office/07-12-PLAN.md",".planning/phases/07-office/07-12-SUMMARY.md",".planning/phases/07-office/07-13-PLAN.md",".planning/phases/07-office/07-14-PLAN.md",".planning/phases/07-office/07-15-PLAN.md"]
covered_digest: "gsdkit1:sha256:3c484cbb11376cdeb4c33eb7e6c6d4835679a3c824ab445520de7c696bb69de6"
behavior_unverified: 3
overrides_applied: 1
overrides:
  - must_have: "Wave 0 is a spike: measured values and a pass verdict in 07-SPIKE.md; without a recorded pass no later wave runs"
    reason: "Owner waived the D-12 measurement on 2026-10-21T08:13:00Z (SPIKE_WAIVER in 07-SPIKE.md; also recorded under Overrides in STATE.md); ZOOM_LEVELS [2,3] and TINT_LEVELS 2 stay provisional; measurement owed. Accepted as the disposition of this gate by the main session on the owner's explicit delegation ('Tu chot', 2026-10-21); the owner can still replace it by measuring."
    accepted_by: "owner"
    accepted_at: "2026-10-21T13:42:18Z"
re_verification:
  previous_status: gaps_found
  previous_score: 6/8
  gaps_closed:
    - "Gap 1 (spike gate): carried as PASSED (override); the measurement is still owed and stays a human item"
    - "Gap 2 (CHANGELOG entry): entry and OFFC-23 checker/test present in 997771c; the figures in its measured-check line do not match the committed tree (warning W1)"
    - "Gap 3 (scene resilience): camera.ts finished()/relayout/shouldRetrySprites, office-screen.tsx single director and bounded store.retry present and wired in 997771c; 16 new tests exist but have no current run (behavior-unverified)"
  gaps_remaining: []
  regressions: []
behavior_unverified_items:
  - truth: "R11-01: a closed agent whose status leaves closed during its departure walk is hidden at the end of the walk and an arrival by elevator is scheduled, never left hidden with no arrival due"
    test: "Run the named tests 'OFFC-13 life reopen: ...' (3) and 'OFFC-13 screen reopen: ...' in tests/ui/office-scene.test.mjs on commit 997771c"
    expected: "All pass; the screen test draws 2 characters after the reopen and 1 when the agent stays closed"
    why_human: "camera.ts finished() (lines 765-771) and the step() reopen branch are present and read correctly, and the tests assert the invariant, but no gate run covers 997771c (the last run, gsd-07-w5-5, is at a53b218), so no pass is evidenced and verification may not rerun tests"
  - truth: "R11-03: a sprite key whose office.sprites call failed (call_failed) is asked again on a slow beat, at most SCENE_SPRITE_RETRY_ROUNDS_MAX rounds per wanted set; a final failure is never retried; the counter restarts when the wanted set changes"
    test: "Run the six 'OFFC-08 retry rule' / 'OFFC-08 screen retry' tests on 997771c"
    expected: "All pass; a persistent failure stops after 3 rounds, a render_failed key is asked once, a zoom restores the rounds"
    why_human: "office-screen.tsx:381-395 and sprite-store.ts retry() (call_failed only) read correctly, but the bounded-retry behavior is a counter/ordering invariant with no evidenced run on this commit"
  - truth: "R11-02: one life director per mount; relayout(building) keeps hidden/arrival/sleep state, ends journeys of the old layout once and frees walker slots, shows hidden agents again when there is no elevator"
    test: "Run the five 'OFFC-13 life relayout' / 'OFFC-13 screen relayout' tests on 997771c"
    expected: "All pass; a departed agent stays hidden across a new project room"
    why_human: "camera.ts relayout (lines 780-801) and the useRef holder with the relayout effect (office-screen.tsx:184-190, 308-314) read correctly, but this is a cancellation/cleanup invariant with no evidenced run on this commit"
human_verification:
  - test: "Gate run on 997771c: `tsc --noEmit -p plugins/office`, `node --test tests/ui/*.test.mjs tests/machine/*.test.mjs`, `node kit/release-check.mjs`"
    expected: "tsc exit 0; 0 fail; the 16 new scene tests and the 2 new OFFC-23 tests pass; release check ok. Then reconcile the CHANGELOG measured-check line (it says 416 tests, 407 pass; the last recorded run had 414 tests and the commit adds 18 test() blocks, so a run of the committed tree should report about 432)"
    why_human: "No current gate evidence exists; verification may not rerun builds or tests. Closes the three behavior_unverified_items and the suite-green clause of truth 2"
  - test: "Crispness at each offered zoom (2 and 3)"
    expected: "No intermediate colours or smoothing on a character edge and a desk edge on the owner's display"
    why_human: "Host image scaling cannot be observed offline; never measured (waiver). Closes OFFC-09"
  - test: "Cadence and smoothness with 32 characters, 6 walking, 30 s at the default zoom"
    expected: "No visible stutter; median tick at most 125 ms"
    why_human: "Needs the real host. Closes spike thresholds 1-2"
  - test: "Payload on the real host: first load and 60 s idle"
    expected: "At most 2,000,000 bytes first load (offline count 1,687,624 at zoom 3) and at most 50,000 steady state"
    why_human: "Needs host-side network counters"
  - test: "Zoom and camera: zoom in and out while scrolled, select a sidebar node"
    expected: "View stays centred on the same point (finding F3: offsets may clamp)"
    why_human: "ScrollView behaviour in the host"
  - test: "Day, night and season"
    expected: "Tint cross-fade and seasonal theme"
    why_human: "Visual (OFFC-17)"
  - test: "Live wave or phase effect from a kit GSD run whose agents carry harness.run"
    expected: "One effect plays; an unlabeled agent plays none"
    why_human: "Needs a real run and daemon"
  - test: "Close an agent and reopen it while it walks to the elevator; make one sprite call fail; add a project room while agents walk"
    expected: "The agent is drawn again by the elevator; the blank layer heals within about 20 beats; hidden agents do not flash back to their seats"
    why_human: "Host animation and the daemon's real status stream; the offline tests use a fake host"
---

# Phase 7: Office Verification Report

**Phase Goal:** The `swarm-map` plugin is replaced by a new read-only Paseo plugin `office` (`plugins/office/`): one building with a room per project, a desk cluster per workspace, a character per agent, pixel art ported from habblaud and delivered as PNG `Image` data URIs, data only from the official Paseo API, with agent drawer, counters, day/night and seasonal themes, wave/phase effects and an empty provider-usage slot.
**Verified:** 2026-10-21T13:59:00Z
**Status:** human_needed
**Re-verification:** Yes - after gap closure (commit 997771c, plans 07-13 to 07-15)

Method and limits. No gate evidence is current: the newest record (`evidence/gsd-07-w5-5.json`) was taken at head `a53b218` and the listed w1-w5 files are stale. Since `a53b218` only these files changed: `plugins/office/client/camera.ts`, `plugins/office/client/office-screen.tsx`, `tests/ui/office-host.mjs`, `tests/ui/office-scene.test.mjs`, `tests/ui/plugin-gates.test.mjs`, `CHANGELOG.md` (plus planning files), so that is the whole regression surface. I reran nothing. I read the diff of 997771c, the director (`camera.ts` 540-830), `sprite-store.ts` retry/get, the screen's beat handler, the new tests, CHANGELOG.md, STATE.md and the previous report. Plans 07-13, 07-14 and 07-15 have no SUMMARY files; they were not used as evidence.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Wave 0 spike: measured values and a pass verdict; no later wave without a recorded pass | PASSED (override) | Override: owner waived D-12 on 2026-10-21T08:13:00Z, accepted by the main session on the owner's delegation, 2026-10-21T13:42:18Z. `07-SPIKE.md` still reads `Verdict: waived by owner, not measured`; STATE.md line 56 records the waiver. Nothing was measured; crispness, cadence, payload and smoothness stay human items. The override is a delegated acceptance, not a measurement. |
| 2 | `plugins/office/` loads in the host; `swarm-map` gone; suite green | ✓ VERIFIED (structure) / suite green: see human item 1 | `plugins/` holds `office`, `planning-panel`, `smoke.mjs` only (listed now). The suite-green and tsc clauses rest on a run at `a53b218`; the six changed files have no run (item 1). |
| 3 | Read-only and API-only; no `listUsage`; single wave-link file read; disposers release subscriptions | ✓ VERIFIED | `grep listUsage plugins/office`: no match. The 997771c diff adds no daemon call, write member, timer, clock, random or file call to `camera.ts` (grep of the file for those names: none) and no daemon call to `office-screen.tsx`. |
| 4 | One building, room per project, cluster per workspace, character per agent with pose from state; children walk to parent; exact "+N agents" | ✓ VERIFIED (resilience: see truths 9-11) | Unchanged since the first report except the three resilience paths below; `buildBuilding` → `placeScene` → `Scene` chain still in `office-screen.tsx`. |
| 5 | Sidebar tree moves the camera; drawer; top bar with counters, `lastUsage` and an empty usage slot; one English strings table | ✓ VERIFIED | No change to these files since `a53b218`. |
| 6 | Art ported server-side, deterministic, PNG via `node:zlib`; sprites once per key | ✓ VERIFIED (crispness: human) | No change to server art since `a53b218`. Retry asks a key again only after a `call_failed`, so "once per key" holds for successes (sprite-store.ts:151-166). |
| 7 | Day/night, seasons, wave/phase effect, common areas with wandering | ✓ VERIFIED (visuals: human; gate precondition: truth 1) | No change to those modules since `a53b218`. |
| 8 | Habblaud MIT notice, supersession ledger, CHANGELOG entry with owner's approval and date | ✓ VERIFIED (with warnings W1, W2) | `CHANGELOG.md` first bullet under `[Unreleased]` reads `Owner-approved Office plugin, 2026-10-21:`; names the decision, the operator note, the ledger, the open waiver. `changelogProblems` and both OFFC-23 tests are in `plugin-gates.test.mjs` (only additions, no existing gate touched). Approval and date were delegated to the main session and the entry says so. Figures: W1. |
| 9 | R11-01: a reopened agent is drawn again after its departure walk | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `finished()` now schedules `scheduleArrival` when `entry.status !== "closed" && arrivalDue === null && fronts.length > 0` (camera.ts:765-771). A status flip between the last `step` and `finished` is covered by the existing step() branch (hidden, no arrival due). Tests assert one arrival from a front, a control for a stays-closed agent (1 vs 2 drawn) and the post-walk case. No run on this commit. |
| 10 | R11-03: failed sprite keys retried on a slow beat, bounded, final failures never | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `shouldRetrySprites` (beat multiple of 20, rounds under 3); the beat handler retries only when a wanted key is `failed` with `call_failed`; `retry()` itself skips other codes; `retryRounds` resets with the wanted signature. Six tests incl. a control with no failures and a render_failed key. No run on this commit. |
| 11 | R11-02: one director per mount, `relayout` keeps state and ends old journeys | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `useRef` holder created once; effect calls `director.relayout(building)` and `applyChanges`; `relayout` returns cancels for each journey, resets `active`, ledger, schedule, shows hidden agents when no elevator. Five tests incl. same-object no-op and no-elevator case. No run on this commit. |

**Score:** 8/11 truths verified (1 of them by override), 3 present and wired, behavior-unverified.

### Deferred Items

None. Phase 7 is the only phase of milestone v1.1.

### Advisory (New Scope, Unevidenced)

None.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `plugins/office/client/camera.ts` | `finished()` return path, `relayout`, `SCENE_SPRITE_RETRY_*`, `shouldRetrySprites` | ✓ VERIFIED | all present and exported; `ElevatorSchedule` is both a type and a factory in `life/journey.ts:128,134`, so the `let schedule: ElevatorSchedule` form type-checks by reading (tsc itself unrun) |
| `plugins/office/client/office-screen.tsx` | one director per mount; bounded `store.retry` | ✓ VERIFIED (wired) | `shouldRetrySprites` imported and called at the beat; `store` is the sprite store (`sprites()` at line 126) |
| `tests/ui/office-scene.test.mjs` | 16 new tests | ✓ EXISTS | 49 `test(` blocks now; the diff is additions only (444 insertions, 0 deletions) |
| `tests/ui/plugin-gates.test.mjs` | `changelogProblems` + 2 tests | ✓ EXISTS | additions only (84) |
| `tests/ui/office-host.mjs` | `rpcFail` option | ✓ EXISTS | 5 added lines |
| `CHANGELOG.md` office entry | dated, owner-approved | ✓ EXISTS | see W1 |
| `.planning/requirements/office.md` | OFFC ledger read by `OFFC-25 ledger` | ⚠️ UNTRACKED | `git ls-files .planning/requirements` lists method, platform, runtime, tools only; `plugin-gates.test.mjs` reads this file, so a clean checkout of HEAD fails that test (W2) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| journey end handler | `finished()` | arrival rescheduled after a departure | WIRED | camera.ts:765-771 |
| beat listener | `shouldRetrySprites` + `store.retry` | office-screen.tsx:381-395 | WIRED | uses `latest.current.wantedKeys` |
| building memo | `director.relayout` | effect `[life, building]` | WIRED | office-screen.tsx:308-314 |
| `relayout` cancels | journey/animation drop | `applyChanges` | WIRED | same handler as other cancels |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| retry round | `wantedKeys`, `store.get(key)` | sprite store entries set by real `office.sprites` results | Yes | ✓ FLOWING |
| arrival after reopen | `entry.status` | set in `step()` from `characters`, which come from the live store | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

Skipped by instruction (no reruns). See human item 1.

### Probe Execution

No probes declared. Not applicable.

### Requirements Coverage

OFFC-01..25 are all claimed by at least one plan (07-13: OFFC-08..10, 13, 24; 07-14: OFFC-23, 25; 07-15: OFFC-08, 11, 12, 13); no orphans.

| Requirement | Status | Evidence |
|-------------|--------|----------|
| OFFC-08, 11, 12, 13 | ✓ SATISFIED in code / behavior unverified on this commit | truths 9-11 |
| OFFC-09 | ? NEEDS HUMAN | crispness never measured |
| OFFC-10 | PASSED (override) | owner waiver, measurement owed |
| OFFC-23 | ✓ SATISFIED (warning W1) | entry and checker present |
| OFFC-24 | ✓ SATISFIED | scope text unchanged: desktop only, one host |
| OFFC-25 | ✓ SATISFIED on this worktree / W2 | ledger file untracked |
| all others | unchanged since the first report | no file of theirs changed |

### Test Quality Audit

| Test File | Linked Req | Active | Skipped | Circular | Verdict |
|-----------|-----------|--------|---------|----------|---------|
| `office-scene.test.mjs` (new) | OFFC-08, 11, 13 | 16 | 0 | no | value-level and behavioral assertions with controls; red-first claim in the commit message is not checkable here |
| `plugin-gates.test.mjs` (new) | OFFC-23 | 2 | 0 | no | checker exercised on fixtures, then on the real file |

Disabled tests: the nine retired spike tests from the first report remain skipped. Circular patterns: none in the added tests.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `CHANGELOG.md` | 20-22 | measured check says 416 tests, 407 pass; last recorded run was 414/405 at `a53b218`, the commit adds 16 + 2 `test(` blocks, so a run of the committed tree should be about 432. 416 = 414 + 2, which matches a tree without the 16 scene tests | ⚠️ Warning (W1) | The entry's figures do not describe what shipped; plan 07-14 forbids claiming an unrun check. Correct after the gate run |
| `.planning/requirements/office.md` | - | untracked file read by a gate test | ⚠️ Warning (W2) | clean checkout fails `OFFC-25 ledger` |
| `CHANGELOG.md` | 23 | approval and date delegated by the owner to the main session; plan 07-14 asked for the owner's own `approved YYYY-MM-DD` | ℹ️ Info | disclosed in the entry; owner may confirm |
| `plugins/office/client/camera.ts` | 780-801 | `relayout` resets `schedule`, so pending arrivals keep their old due beats while the new schedule is empty | ℹ️ Info | arrivals may bunch on one elevator after a building change; no hidden agent is lost |
| `plugins/office/client/office-screen.tsx` | 421 | `scrollTo` before re-render at the new zoom (carried) | ℹ️ Warning | human item 5 |
| `TBD`/`FIXME`/`XXX`/`TODO`/`HACK` | - | none in `camera.ts`, `office-screen.tsx` | none | none |

### Human Verification Required

See the frontmatter list; item 1 (a gate run on `997771c`) is a command for the orchestrator rather than a judgment and closes truths 9-11. Items 2-8 need the owner's Paseo desktop app (desktop only; mobile not tested; one host, OFFC-24).

### Gaps Summary

No truth failed. All three gaps of the first report are addressed in the code and tests committed in `997771c`: gap 1 by the override (the measurement is still owed), gap 2 by the entry and its checker, gap 3 by the director, retry and relayout changes. The status is `human_needed` and not `passed` because no gate run covers the current commit: the three resilience truths are state-transition and cleanup invariants that I read as correct but may not prove by running, and the CHANGELOG measured-check figures disagree with the tree. Before release: run the gate on `997771c`, correct the CHANGELOG figures to the real run, and commit `.planning/requirements/office.md`.

---

_Verified: 2026-10-21T13:59:00Z_
_Verifier: Claude (gsd-verifier)_
