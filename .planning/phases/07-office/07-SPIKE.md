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
