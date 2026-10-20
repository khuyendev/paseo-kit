// Output and exit assertions for the P8 contract; failures show the whole captured output.
import assert from "node:assert/strict";

const show = (res) => `\n--- stdout ---\n${res.stdout}\n--- stderr ---\n${res.stderr}`;
const matches = (line, pattern) => (pattern instanceof RegExp ? pattern.test(line) : line === pattern);

export function assertExit(res, code) {
  assert.equal(res.code, code, `exit ${res.code}, expected ${code}${show(res)}`);
}

export function assertLine(res, pattern) {
  assert.ok(res.out.some((line) => matches(line, pattern)), `no stdout line matches ${pattern}${show(res)}`);
}

export function assertNoLine(res, pattern) {
  assert.ok(!res.out.some((line) => matches(line, pattern)), `a stdout line matches ${pattern}${show(res)}`);
}

export function assertLastLine(res, pattern) {
  const last = res.out.at(-1) ?? "";
  assert.ok(matches(last, pattern), `last stdout line ${JSON.stringify(last)} does not match ${pattern}${show(res)}`);
}

export function assertErrLine(res, pattern) {
  assert.ok(res.err.some((line) => matches(line, pattern)), `no stderr line matches ${pattern}${show(res)}`);
}
