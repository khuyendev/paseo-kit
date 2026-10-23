// Kit feedback #77 and #80 (Q77): a main-tree change that no plan owns stops the run only when it can be plan output. A path outside
// adapter.ownership.source_roots (an orchestrator's note) and a tracked file whose only change is line endings are reported in the
// result and left out of the wave commit; a path inside a source root still stops, and its stop offers "commit them separately" first.
import assert from "node:assert/strict";
import test from "node:test";
import { committedFiles, died, exec, shared, world } from "./q77-helpers.mjs";
import { executor } from "../gsd-flows/exec-world.mjs";

const OWNERSHIP = (source_roots) => ({ owns_forms: [{ prefix: "Path:", maps_to: "<path>" }], shared: { globs: [], predicate: null }, source_roots, ignore: [], regenerated: [] });
const ROOTED = OWNERSHIP(["src", "lib"]);

// The executor of 01-01 also writes `rel` in the main tree (a shared tree: the executor runs there).
const alsoWrites = (w, rel, text) => ({ "exec-01-01": async (...a) => { const v = await executor(w)(...a); w.write(rel, text); return v; } });
const status = (w) => w.git("status", "--porcelain", "-uall").stdout.split("\n").filter((l) => l && !l.slice(3).startsWith(".planning/"));

test("Q77 F77 a note outside every source root is reported and left out of the wave commit instead of stopping the run", async () => {
  const w = world({ ownership: ROOTED });
  const r = await exec(w, {}, { ...shared(w), ...alsoWrites(w, "docs/kit-feedback.md", "# note\n") });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  assert.deepEqual(r.result.outsideRoots, ["docs/kit-feedback.md"]);
  const committed = committedFiles(w, "feat(01-w1)");
  assert.ok(!committed.includes("docs/kit-feedback.md"), committed.join(","));
  assert.ok(committed.includes("config/app.json") && committed.includes("src/01-01/impl.js"), committed.join(","));
  assert.deepEqual(status(w), ["?? docs/kit-feedback.md"], "the note stays in the tree, uncommitted");
});

test("Q77 F77 the note written between two runs does not stop the resumed run (resume gate)", async () => {
  const w = world({ ownership: ROOTED });
  const first = await exec(w, {}, { ...shared(w), "review-": died("reviewer") });
  assert.equal(first.error?.message, "killed reviewer");
  w.write("docs/kit-feedback.md", "# note\n");
  const r = await exec(w, {}, shared(w));
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  assert.deepEqual(r.result.outsideRoots, ["docs/kit-feedback.md"]);
  assert.ok(!committedFiles(w, "feat(01-w1)").includes("docs/kit-feedback.md"));
});

test("Q77 F77 a path inside a source root still stops; the stop names committing it separately first, and the rerun after that commit finishes", async () => {
  const w = world({ ownership: ROOTED });
  const stop = await exec(w, {}, { ...shared(w), ...alsoWrites(w, "lib/stray.txt", "x\n") });
  assert.deepEqual([stop.result.status, stop.result.stage, stop.result.paths], ["needs-owner", "Execute", ["lib/stray.txt"]]);
  assert.match(stop.result.options[0], /^commit them separately/);
  assert.equal(stop.result.outsideRoots, undefined);
  w.git("add", "lib/stray.txt");
  w.git("commit", "-qm", "stray note, committed separately");
  const r = await exec(w, {}, shared(w));
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
});

test("Q77 F77 without source_roots (the default) or with gsd.unowned_outside_roots stop, every unowned path stops as before", async () => {
  for (const w of [world(), world({ ownership: ROOTED, gsd: { unowned_outside_roots: "stop" } })]) {
    const stop = await exec(w, {}, alsoWrites(w, "docs/kit-feedback.md", "# note\n"));
    assert.deepEqual([stop.result.status, stop.result.stage, stop.result.paths], ["needs-owner", "Execute", ["docs/kit-feedback.md"]]);
    assert.match(stop.result.options[0], /^commit them separately/);
  }
});

test("Q77 F77 an unowned path outside the roots at the commit (worktree) is reported too, and a path of a plan's owns is still its own", async () => {
  const w = world({ isolation: "worktree", ownership: ROOTED });
  w.write("docs/kit-feedback.md", "# before\n");
  w.git("add", "-A");
  w.git("commit", "-qm", "docs");
  const r = await exec(w, {}, {
    ...shared(w),
    "review-": () => { w.write("docs/kit-feedback.md", "# note appended during the run\n"); return { findings: [] }; },
  });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  assert.deepEqual(r.result.outsideRoots, ["docs/kit-feedback.md"]);
  assert.ok(committedFiles(w, "feat(01-w1)").includes("src/01-01/impl.js"));
});

// ---- kit feedback 80: line endings ----

const crlf = (w) => {
  w.git("config", "core.autocrlf", "false");
  w.write("fixtures/a.json", "{\r\n  \"a\": 1\r\n}\r\n");
  w.git("add", "-A");
  w.git("commit", "-qm", "fixtures");
};

test("Q77 F80 a tracked file rewritten with LF only is reported (eolOnly), never a stop, never committed", async () => {
  const w = world();
  crlf(w);
  const r = await exec(w, {}, { ...shared(w), ...alsoWrites(w, "fixtures/a.json", "{\n  \"a\": 1\n}\n") });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  assert.deepEqual(r.result.eolOnly, ["fixtures/a.json"]);
  assert.ok(!committedFiles(w, "feat(01-w1)").includes("fixtures/a.json"));
  assert.deepEqual(status(w), [" M fixtures/a.json"]);
});

test("Q77 F80 a line-ending rewrite between two runs does not stop the resume gate; a real content change of that file still does", async () => {
  const w = world();
  crlf(w);
  const first = await exec(w, {}, { ...shared(w), "review-": died("reviewer") });
  assert.equal(first.error?.message, "killed reviewer");
  w.write("fixtures/a.json", "{\n  \"a\": 1\n}\n");
  const stop = await exec(w, {}, shared(w));
  assert.equal(stop.result.status, "executed", JSON.stringify(stop.result));
  assert.deepEqual(stop.result.eolOnly, ["fixtures/a.json"]);

  const v = world();
  crlf(v);
  const f1 = await exec(v, {}, { ...shared(v), "review-": died("reviewer") });
  assert.equal(f1.error?.message, "killed reviewer");
  v.write("fixtures/a.json", "{\n  \"a\": 2\n}\n");
  const real = await exec(v, {}, shared(v));
  assert.equal(real.result.status, "needs-owner", JSON.stringify(real.result));
  assert.match(real.result.reason, /unauthorized path fixtures\/a\.json/);
});

test("Q77 F80 a real content change of an unowned tracked file stops; an owned file's line-ending rewrite is the plan's and is committed", async () => {
  const w = world();
  crlf(w);
  const real = await exec(w, {}, alsoWrites(w, "fixtures/a.json", "{\n  \"a\": 2\n}\n"));
  assert.deepEqual([real.result.status, real.result.paths], ["needs-owner", ["fixtures/a.json"]]);

  const o = world();
  o.git("config", "core.autocrlf", "false");
  o.write("src/01-01/own.txt", "a\r\nb\r\n");
  o.git("add", "-A");
  o.git("commit", "-qm", "own");
  const r = await exec(o, {}, { ...shared(o), ...alsoWrites(o, "src/01-01/own.txt", "a\nb\n") });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  assert.equal(r.result.eolOnly, undefined);
  assert.ok(committedFiles(o, "feat(01-w1)").includes("src/01-01/own.txt"));
});
