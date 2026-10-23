// G118: an incremental map (`--paths`) accepts directory names with a space and still refuses dot-only segments.
import assert from "node:assert/strict";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld } from "../gsd-flows/world.mjs";

const body = (n) => Array.from({ length: n }, (_, i) => `line ${i}`).join("\n");
const FOCUS = { tech: ["STACK", "INTEGRATIONS"], arch: ["ARCHITECTURE", "STRUCTURE"], quality: ["CONVENTIONS", "TESTING"], concerns: ["CONCERNS"] };
const mapper = (w) => (p, o) => {
  const docs = FOCUS[o.label.replace("mapper-", "")];
  for (const d of docs) w.write(`.planning/codebase/${d}.md`, `# ${d}\n${body(25)}\n`);
  return { focus: o.label, written: docs };
};

test("G118 map-codebase: a --paths entry with a space maps the incremental remap; dot-only segments stay refused", async () => {
  const w = makeWorld({ overlay: { gsd: { commit_policy: { docs: false, code: "per-wave" } } } });
  const spaced = await runScript("gsd-map-codebase", { root: w.root, gsd: w.gsd, args: { paths: "src/legacy helpers" }, agent: mapper(w) });
  assert.deepEqual([spaced.result.status, spaced.calls.length], ["mapped", 4]);
  assert.deepEqual(spaced.result.paths, ["src/legacy helpers"]);
  assert.match(spaced.calls[0].prompt, /incremental remap\): src\/legacy helpers and/);
  const two = await runScript("gsd-map-codebase", { root: w.root, gsd: w.gsd, args: { paths: "src/legacy helpers,lib/b" }, agent: mapper(w) });
  assert.deepEqual([two.result.status, two.calls.length], ["mapped", 4]);
  for (const paths of ["src/ ..", "src/ .", "src/a/ . ./b"]) {
    const bad = await runScript("gsd-map-codebase", { root: w.root, gsd: w.gsd, args: { paths }, agent: mapper(w) });
    assert.deepEqual([bad.result.status, bad.calls.length], ["failed", 0], paths);
  }
  const dots = await runScript("gsd-map-codebase", { root: w.root, gsd: w.gsd, args: { paths: "../x;rm" }, agent: mapper(w) });
  assert.deepEqual([dots.result.status, dots.calls.length], ["failed", 0]);
});
