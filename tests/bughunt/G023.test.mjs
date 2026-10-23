// Regression test for G023: quoted watch flags and quoted runner names are normalized like bare ones.
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTestCommand } from "../../ship/.agents/harness/gsd/tools.mjs";

test("G023 quoted watch flags are rewritten to the one-shot form", () => {
  assert.equal(normalizeTestCommand(`jest "--watch"`), "jest");
  assert.equal(normalizeTestCommand(`jest '--watch'`), "jest");
  assert.equal(normalizeTestCommand(`jest "--watchAll"`), "jest");
  assert.equal(normalizeTestCommand(`jest "--watch=true"`), "jest");
  assert.equal(normalizeTestCommand(`jest "--watchAll" --runInBand`), "jest --runInBand");
  assert.equal(normalizeTestCommand(`npx vitest "watch"`), "npx vitest run");
  assert.equal(normalizeTestCommand(`ng test "--watch"`), "ng test --watch=false");
  assert.equal(normalizeTestCommand(`react-scripts test "--watchAll"`), "react-scripts test --watchAll=false");
});

test("G023 quoted runner names are matched", () => {
  assert.equal(normalizeTestCommand(`"jest" --watch`), `"jest"`);
  assert.equal(normalizeTestCommand(`"jest" "--watch"`), `"jest"`);
  assert.equal(normalizeTestCommand(`"npx" vitest "watch"`), `"npx" vitest run`);
});

test("G023 unchanged cases keep their text", () => {
  assert.equal(normalizeTestCommand(`jest "--watchAll=false"`), `jest "--watchAll=false"`);
  assert.equal(normalizeTestCommand(`node test.mjs "--watch"`), `node test.mjs "--watch"`);
  assert.equal(normalizeTestCommand(`npm test -- "--watch"`), `npm test -- "--watch"`);
  assert.equal(normalizeTestCommand(`pytest "tests/my  dir" -q`), `pytest "tests/my  dir" -q`);
  assert.equal(normalizeTestCommand(`npx vitest run "watch"`), `npx vitest run "watch"`);
});
