// Kit-feedback 41 and 43: the codebase map states only verified Known Bugs, and a review stage fact-checks each doc group
// against the code before anything is stamped or committed. Each case fails on the code before this change.
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";
import { NULL, runScript } from "../gsd-flows/host.mjs";
import { makeWorld } from "../gsd-flows/world.mjs";

const { main } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
async function flow(root, argv) {
  let line = "";
  const code = await main(argv, { root, input: "", out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}

const FOCUS = { tech: ["STACK", "INTEGRATIONS"], arch: ["ARCHITECTURE", "STRUCTURE"], quality: ["CONVENTIONS", "TESTING"], concerns: ["CONCERNS"] };
const DOCS = Object.values(FOCUS).flat();
const body = (n) => Array.from({ length: n }, (_, i) => `line ${i}`).join("\n");
const sevenDocs = (extra = {}) => Object.fromEntries(DOCS.map((d) => [`.planning/codebase/${d}.md`, extra[d] ?? `# ${d}\n${body(25)}\n`]));
const concerns = (bugs) => `# Concerns\n${body(22)}\n\n## Known Bugs\n\n${bugs}\n\n## Security\n\nnone\n`;
const bug = (...lines) => ["**Decoder drops frames:**", "- Symptoms: frames are lost", "- Files: `lib/a.dart`", ...lines].join("\n");
const OPTS = { overlay: { gsd: { commit_policy: { docs: true, code: "per-wave" } } } };

test("F41 map check rejects a Known Bug that is neither verified with its Evidence nor suspected", async () => {
  const check = async (text) => flow(makeTempProject({ files: sevenDocs({ CONCERNS: concerns(text) }) }).root, ["map-check"]);
  const named = "Known Bug \"Decoder drops frames\" is neither verified (with its Evidence) nor suspected";
  const none = await check(bug());
  assert.deepEqual([none.code, none.json.problems], [1, [`.planning/codebase/CONCERNS.md: ${named}`]]);
  const bare = await check(bug("- Status: verified"));
  assert.deepEqual([bare.code, bare.json.problems], [1, [`.planning/codebase/CONCERNS.md: ${named}`]]);
  const proven = await check(bug("- Status: verified", "- Evidence: `dart test test/decoder_test.dart` -> 1 failed"));
  assert.deepEqual([proven.code, proven.json.problems], [0, []]);
  const guessed = await check(bug("- Status: suspected"));
  assert.deepEqual([guessed.code, guessed.json.problems], [0, []]);
  const none2 = await check("No known bugs.\n");
  assert.deepEqual([none2.code, none2.json.problems], [0, []]);
});

// The mapper writes and confirms the docs of its focus; a fix round (`mapper-fix-<focus>`) rewrites them the same way.
const mapper = (w) => (p, o) => {
  const focus = o.label.replace(/^mapper-(fix-)?/, "");
  for (const d of FOCUS[focus]) w.write(`.planning/codebase/${d}.md`, `# ${d}\n${body(25)}\nrevised\n`);
  return { focus, written: FOCUS[focus] };
};
// A reviewer per focus: script[focus] lists the reply of each call in turn, the last one repeating.
const reviewer = (script) => {
  const calls = new Map();
  return (label) => {
    const focus = label.slice("review-".length);
    const replies = script[focus] ?? [[]];
    const n = calls.get(focus) ?? 0;
    calls.set(focus, n + 1);
    return { issues: replies[Math.min(n, replies.length - 1)] };
  };
};
const agentFor = (w, review, extra = () => undefined) => (p, o) => extra(o.label) ?? (o.label.startsWith("review-") ? review(o.label) : mapper(w)(p, o));
const finding = { doc: "STACK", claim: "Uses Dart 3.4", problem: "outdated", evidence: "pubspec.yaml: sdk ^3.6.0", fix_hint: "say Dart 3.6" };

test("F41 review: a finding goes back to its focus's mapper once, the group is reviewed again, and the map is stamped", async () => {
  const w = makeWorld(OPTS);
  const r = await runScript("gsd-map-codebase", { root: w.root, gsd: w.gsd, agent: agentFor(w, reviewer({ tech: [[finding], []] })) });
  assert.equal(r.result.status, "mapped");
  assert.deepEqual(r.result.review, { checked: ["tech", "arch", "quality", "concerns"], fixed: ["tech"] });
  const labels = r.calls.map((c) => c.opts.label);
  assert.deepEqual(labels.filter((l) => l.startsWith("mapper-fix")), ["mapper-fix-tech"]);
  assert.equal(labels.filter((l) => l === "review-tech").length, 2);
  assert.match(r.calls.find((c) => c.opts.label === "mapper-fix-tech").prompt, /Uses Dart 3\.4/);
  const rv = r.calls.find((c) => c.opts.label === "review-arch");
  assert.deepEqual([rv.opts.readOnly, rv.opts.role, rv.opts.agentType], [true, "map_reviewer", "gsd-map-reviewer"]);
  assert.match(w.read(".planning/codebase/STACK.md"), /^---\nlast_mapped_commit: [0-9a-f]{40}\n/);
  assert.ok(w.events.some((e) => e.startsWith("commit docs: map codebase")));
});

test("F41 review: a finding that still stands after the fix round stops at stage Review; nothing is stamped or committed", async () => {
  const w = makeWorld(OPTS);
  const r = await runScript("gsd-map-codebase", { root: w.root, gsd: w.gsd, agent: agentFor(w, reviewer({ concerns: [[finding], [finding]] })) });
  assert.deepEqual([r.result.status, r.result.stage], ["needs-owner", "Review"]);
  assert.deepEqual(r.result.findings, [{ focus: "concerns", ...finding }]);
  assert.deepEqual([r.calls.filter((c) => c.opts.label === "mapper-fix-concerns").length, r.calls.filter((c) => c.opts.label === "review-concerns").length], [1, 2]);
  assert.equal(r.logs.includes("phase Stamp"), false);
  assert.doesNotMatch(w.read(".planning/codebase/CONCERNS.md"), /last_mapped_commit/);
  assert.equal(w.events.some((e) => e.startsWith("commit")), false);
});

test("F41 review: a reviewer with no usable reply is retried once, then the run fails before the stamp", async () => {
  const w = makeWorld(OPTS);
  const silentArch = (label) => (label === "review-arch" ? NULL("no reply within 3600 s") : undefined);
  const r = await runScript("gsd-map-codebase", { root: w.root, gsd: w.gsd, agent: agentFor(w, reviewer({}), silentArch) });
  assert.equal(r.result.status, "failed");
  assert.equal(r.result.reason, "map review arch failed: no reply within 3600 s");
  assert.equal(r.calls.filter((c) => c.opts.label === "review-arch").length, 2);
  assert.equal(r.logs.includes("phase Stamp"), false);
  assert.equal(w.events.some((e) => e.startsWith("commit")), false);
});
