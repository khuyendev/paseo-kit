// G193: a missing-path guess names only files inside the session cwd, never folders outside it.
import assert from "node:assert/strict";
import test from "node:test";
import { guessPath } from "../../ship/.agents/harness/files/guess.mjs";
import { client, scratch } from "../files/helpers.mjs";

test("G193 a missing file in a folder outside the cwd is not guessed from that folder", () => {
  const s = scratch({ "outside/secret.md": "s", "outside/deep/nested/secret.md": "s", "project/specs/a.md": "a" });
  const root = s.path("project");
  assert.deepEqual(guessPath(s.path("outside/misspelled/secret.md"), root).candidates, []);
  assert.equal(guessPath(s.path("outside/misspelled/secret.md"), root).unique, undefined);
});

test("G193 look-alike names are listed only for names inside the cwd", () => {
  const s = scratch({ "outside/secret.md": "s", "outside/secrets.md": "s", "project/specs/a.md": "a" });
  const g = guessPath(s.path("outside/sekret.md"), s.path("project"));
  assert.deepEqual(g.candidates, []);
  assert.equal(g.unique, undefined);
});

test("G193 read_ranges reports not found without naming outside files", () => {
  const s = scratch({ "outside/secret.md": "s", "outside/deep/nested/secret.md": "s", "project/specs/a.md": "a" });
  const c = client({ cwd: s.path("project") });
  const r = c.call("read_ranges", { ranges: [{ path: s.path("outside/misspelled/secret.md") }] });
  assert.equal(r.isError, true);
  assert.match(r.text, /file not found/);
  assert.doesNotMatch(r.text, /did you mean/);
});

test("G193 an ancestor of the cwd still yields a unique in-cwd match; outside matches are ignored", () => {
  const s = scratch({ "project/specs/20-creature/X.md": "x", "outside/X.md": "o" });
  const root = s.path("project");
  assert.equal(guessPath(s.path("nonexist/X.md"), root).unique, s.path("project/specs/20-creature/X.md"));
  assert.equal(guessPath(s.path("nonexist/X.md"), root).candidates.length, 1);
});

test("G193 a missing file inside the cwd still finds an in-cwd match", () => {
  const s = scratch({ "project/specs/20-creature/X.md": "x", "outside/secret.md": "s" });
  const root = s.path("project");
  assert.equal(guessPath(s.path("project/specs/20-species/X.md"), root).unique, s.path("project/specs/20-creature/X.md"));
});
