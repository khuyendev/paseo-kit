// Regression test for G047: a requirement id that appears on more than one row is updated on every row, and listed as a duplicate.
import assert from "node:assert/strict";
import test from "node:test";
import { gsd, project } from "../gsd-core/fixture.mjs";

const BULLETS = `# Requirements: Fixture

## v1 Requirements

- [ ] **CORE-01**: Core starts
- [ ] **CORE-01**: Core starts (duplicate entry)
- [ ] **CORE-02**: Core stops

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CORE-01 | Phase 1 | Pending |
| CORE-02 | Phase 1 | Pending |
`;

const TABLE = `# Requirements: Fixture

## v1 Requirements

| ID | Spec | Rule | Phase | Status |
|---|---|---|---|---|
| CORE-01 |  | Core starts | Phase 1 | Pending |
| CORE-01 |  | Core starts (duplicate entry) | Phase 1 | Pending |
| CORE-02 |  | Core stops | Phase 1 | Pending |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CORE-01 | Phase 1 | Pending |
| CORE-01 | Phase 1 | Pending |
| CORE-02 | Phase 1 | Pending |
`;

test("G047 bullet duplicates: mark-complete and revert update every copy, and list reports the duplicate", async () => {
  const p = project({ requirements: BULLETS });
  assert.deepEqual((await gsd(p, ["requirements", "list"])).json.duplicates, ["CORE-01"]);
  const done = await gsd(p, ["requirements", "mark-complete", "CORE-01"]);
  assert.equal(done.code, 0, JSON.stringify(done.json));
  const after = p.read(".planning/REQUIREMENTS.md");
  assert.equal(after.match(/^- \[x\] \*\*CORE-01\*\*/gm)?.length, 2, after);
  assert.equal(after.match(/^\| CORE-01 \| Phase 1 \| Complete \|$/gm)?.length, 1, after);
  assert.match(after, /^- \[ \] \*\*CORE-02\*\*/m);
  await gsd(p, ["requirements", "revert", "1"]);
  const reverted = p.read(".planning/REQUIREMENTS.md");
  assert.equal(reverted.match(/^- \[ \] \*\*CORE-01\*\*/gm)?.length, 2, reverted);
  assert.equal(reverted.match(/^\| CORE-01 \| Phase 1 \| Pending \|$/gm)?.length, 1, reverted);
  assert.match(reverted, /^\| CORE-02 \| Phase 1 \| Pending \|$/m);
});

test("G047 table duplicates: ID rows and traceability rows are all updated, and list reports the duplicate", async () => {
  const p = project({ requirements: TABLE });
  assert.deepEqual((await gsd(p, ["requirements", "list"])).json.duplicates, ["CORE-01"]);
  assert.equal((await gsd(p, ["requirements", "mark-complete", "CORE-01"])).code, 0);
  const after = p.read(".planning/REQUIREMENTS.md");
  assert.equal(after.match(/^\| CORE-01 .*\| Complete \|$/gm)?.length, 4, after);
  assert.equal(after.match(/^\| CORE-01 .*\| Pending \|$/gm), null, after);
  assert.match(after, /^\| CORE-02 .*\| Pending \|$/m);
});

test("G047 a requirement that appears once is not reported as a duplicate", async () => {
  const p = project();
  assert.deepEqual((await gsd(p, ["requirements", "list"])).json.duplicates, []);
});
