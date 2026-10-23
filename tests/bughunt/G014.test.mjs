// G014: a duplicate plan id in the outline manifest is refused, and no entry's owns is hidden by a later duplicate.
import assert from "node:assert/strict";
import test from "node:test";
import { P1, gsd, project } from "../gsd-core/fixture.mjs";

const OUTLINE = "# Outline\n\n| Requirements | Plan ID | Wave | Objective | Depends on |\n|---|---|---|---|---|\n| CORE-01 | `01-01` | 1 | do | none |\n| CORE-02 | `01-02` | 1 | do | none |\n\n## OUTLINE COMPLETE\n";
const entry = (id, owns, reqs) => ({ id, owns: [owns], requirements: [reqs], produces: [], consumes: [], tracer: { is: false }, verify: [] });
// A shared-path hook: src/shared/ is the shared tree (the predicate answers the `shared` op with the paths under it).
const RESOLVER = `let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const r = JSON.parse(s);
  if (r.op === "shared") { console.log(JSON.stringify({ v: 1, shared: r.paths.filter((p) => p.startsWith("src/shared")) })); return; }
  console.log(JSON.stringify({ v: 1, results: r.targets.map((t) => ({ target: t, status: "ok" })) }));
});
`;
const SHARED = { adapter: { ownership: { owns_forms: [{ prefix: "Path:", maps_to: "<path>" }], shared: { globs: ["src/shared/**"], predicate: "hooks/resolve.mjs" }, source_roots: [] } } };

async function check(plans, overlay) {
  const files = { [`${P1}/01-PLAN-OUTLINE.md`]: OUTLINE, [`${P1}/01-PLAN-OUTLINE.manifest.json`]: JSON.stringify({ phase: "01", plans }) };
  const p = project({ files: overlay ? { ...files, "hooks/resolve.mjs": RESOLVER } : files, overlay });
  return (await gsd(p, ["outline", "check", "1", "--tracer", "false"])).json;
}

test("G014 outline check: a single manifest entry per plan id, and an overlap is caught whichever duplicate comes last", async () => {
  const first = entry("01-01", "Path:src/shared/", "CORE-01");
  const safe = entry("01-01", "Path:src/safe/", "CORE-01");
  const other = entry("01-02", "Path:src/shared/", "CORE-02");
  assert.ok((await check([first, other])).errors.some((e) => /overlapping owns/.test(e)), "control: the overlap is caught");

  const dupe = await check([first, safe, other]);
  assert.equal(dupe.passed, false);
  assert.ok(dupe.errors.includes("manifest has duplicate plan id 01-01"), dupe.errors.join("\n"));
  assert.ok(dupe.errors.some((e) => /overlapping owns/.test(e)), "the first entry's owns still take part in the overlap check");

  const swapped = await check([safe, first, other]);
  assert.equal(swapped.passed, false);
  assert.ok(swapped.errors.includes("manifest has duplicate plan id 01-01"));
  assert.ok(swapped.errors.some((e) => /overlapping owns/.test(e)));
});

test("G014 outline check: a shared path owned only by the first duplicate is still refused", async () => {
  const sharedOwner = entry("01-01", "Path:src/shared/", "CORE-01");
  const safe = entry("01-01", "Path:src/safe/", "CORE-01");
  const other = entry("01-02", "Path:src/other/", "CORE-02");
  assert.ok((await check([sharedOwner, other], SHARED)).errors.some((e) => e.includes("covers a shared path")), "control: the shared path is caught");

  const dupe = await check([sharedOwner, safe, other], SHARED);
  assert.equal(dupe.passed, false);
  assert.ok(dupe.errors.includes("manifest has duplicate plan id 01-01"), dupe.errors.join("\n"));
  assert.ok(dupe.errors.includes("01-01: owns src/shared covers a shared path"), dupe.errors.join("\n"));
});
