---
status: testing
phase: 07-office
source: [.planning/phases/07-office/07-VERIFICATION.md]
---

## Current Test

number: 1
awaiting: user response

## Tests

### 1. Gate run on 997771c: `tsc --noEmit -p plugins/office`, `node --test tests/ui/*.test.mjs tests/machine/*.test.mjs`, `node kit/release-check.mjs`
expected: tsc exit 0; 0 fail; the 16 new scene tests and the 2 new OFFC-23 tests pass; release check ok. Then reconcile the CHANGELOG measured-check line (it says 416 tests, 407 pass; the last recorded run had 414 tests and the commit adds 18 test() blocks, so a run of the committed tree should report about 432)
result: [pending]

### 2. Crispness at each offered zoom (2 and 3)
expected: No intermediate colours or smoothing on a character edge and a desk edge on the owner's display
result: [pending]

### 3. Cadence and smoothness with 32 characters, 6 walking, 30 s at the default zoom
expected: No visible stutter; median tick at most 125 ms
result: [pending]

### 4. Payload on the real host: first load and 60 s idle
expected: At most 2,000,000 bytes first load (offline count 1,687,624 at zoom 3) and at most 50,000 steady state
result: [pending]

### 5. Zoom and camera: zoom in and out while scrolled, select a sidebar node
expected: View stays centred on the same point (finding F3: offsets may clamp)
result: [pending]

### 6. Day, night and season
expected: Tint cross-fade and seasonal theme
result: [pending]

### 7. Live wave or phase effect from a kit GSD run whose agents carry harness.run
expected: One effect plays; an unlabeled agent plays none
result: [pending]

### 8. Close an agent and reopen it while it walks to the elevator; make one sprite call fail; add a project room while agents walk
expected: The agent is drawn again by the elevator; the blank layer heals within about 20 beats; hidden agents do not flash back to their seats
result: [pending]

## Summary

total: 8
passed: 0
issues: 0
