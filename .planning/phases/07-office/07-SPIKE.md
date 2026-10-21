# Phase 7 spike thresholds

Dated: 2026-10-21T06:19:51Z

These thresholds were fixed before any measurement and are never edited. The first measurement is plan 07-03; it appends its own sections below.

## SPIKE_THRESHOLDS

| # | Threshold | Limit |
|---|-----------|-------|
| 1 | Cadence | Median interval of the shared animation tick at most 125 ms and 95th percentile at most 250 ms, over 30 s |
| 2 | Animated characters | MAX_DRAWN_CHARACTERS = 32 animated characters, six of them walking, with threshold 1 holding |
| 3 | First-load bytes | The summed base64 data-URI text length of every sprite sent to load the measured scene is at most 2,000,000 |
| 4 | Steady-state bytes | At most 50,000 over 60 s with no new sprite key |
| 5 | Crispness | No intermediate colour on the edges of the one-pixel ruler and of one character at each of ZOOM_CANDIDATES = 2, 3, 4 on the owner's display scale. |

Measured scene: hallway, one project room, lobby, kitchen and lounge layers, and the characters of threshold 2.

## Selection rules

- ZOOM_LEVELS is the subset of ZOOM_CANDIDATES that passed threshold 5.
- TINT_LEVELS is the largest N in 2..5 whose measured first-load bytes, with N tint variants of every measured room layer, stay within threshold 3.
- The verdict is pass only when thresholds 1 to 4 hold, ZOOM_LEVELS is not empty and TINT_LEVELS is at least 2, otherwise fail.

## Scope

Desktop only; mobile not tested; one host.

## Machine copy

```json
{
  "id": "SPIKE_THRESHOLDS_JSON",
  "version": 1,
  "writtenAt": "2026-10-21T06:19:51Z",
  "scene": "hallway, one project room, lobby, kitchen and lounge layers, with 32 animated characters of which 6 walk",
  "zoomCandidates": [
    2,
    3,
    4
  ],
  "maxDrawnCharacters": 32,
  "walkingCharacters": 6,
  "cadence": {
    "windowSeconds": 30,
    "medianMsMax": 125,
    "p95MsMax": 250
  },
  "firstLoadBytesMax": 2000000,
  "steadyState": {
    "windowSeconds": 60,
    "bytesMax": 50000
  },
  "crispness": "No intermediate colour on the edges of the one-pixel ruler and of one character at each of ZOOM_CANDIDATES = 2, 3, 4 on the owner's display scale.",
  "rules": {
    "zoomLevels": "ZOOM_LEVELS is the subset of ZOOM_CANDIDATES that passed threshold 5.",
    "tintLevels": "TINT_LEVELS is the largest N in 2..5 whose measured first-load bytes, with N tint variants of every measured room layer, stay within threshold 3.",
    "verdict": "The verdict is pass only when thresholds 1 to 4 hold, ZOOM_LEVELS is not empty and TINT_LEVELS is at least 2, otherwise fail."
  }
}
```

## SPIKE_SMOOTHNESS_RULE

Dated: 2026-10-21T07:03:33Z

Threshold 1 counts ticks of a JavaScript timer, not painted frames, so the gate also requires the owner's answer to one question, asked after the 30 second cadence window at the zoom used for cadence with 32 characters and 6 walkers: during the window, did the characters move without visible stutter, freezing, skipped steps or flicker. Only yes passes; no fails the gate; an unanswered question leaves the record incomplete. This section is never edited afterwards (D-12).

## SPIKE_WAIVER

Waived by: owner
Dated: 2026-10-21T08:13:00Z
Reason: The owner chose to skip the D-12 measurement ("Bỏ cổng") to start waves 3 and 4 at once, after the spike screen rendered in the owner's Paseo app; the owner gave no report. This is a waiver, not a pass.
No measurement recorded (the owner gave no report): crispness, payload, cadence, steady state, update log.
Smoothness: the owner said verbally that everything ran smoothly; no report and no numbers were provided
Scope: the owner uses the desktop app and the phone app; no measurement recorded for either
Update log: not captured
Surfaces: not probed
Provisional ZOOM_LEVELS: [2, 3]
Provisional TINT_LEVELS: 2
Measurement owed: yes

Provisional levels are the conservative ones (the two smallest zoom candidates, the minimum tint count). Waves 3 and 4 are built on them. If the measurement is taken later and fails, the fallback of D-12 (link-out to a separately running habblaud) or a smaller scene (fewer characters, no common areas) is decided then, and the work of waves 3 and 4 may be partly lost. When the measurement is recorded, replace this section by SPIKE_MEASUREMENTS as plan 07-03 Task 3 describes.

## SPIKE_VERDICT

Verdict: waived by owner, not measured
