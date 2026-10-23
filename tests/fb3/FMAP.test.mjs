// Kit-feedback 59, 60 and 61: the map check says where a refuted claim goes; a map fix round accepts a partial fix that
// names the docs it changed; map review round 2 is a resolution check of round 1, its new claims do not stop the stamp, and an
// incremental map reviews only its paths. Each case fails on the code before this change.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld } from "../gsd-flows/world.mjs";

const { main } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
async function flow(root, argv) {
  let line = "";
  const code = await main(argv, { root, input: "", out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}

const FOCUS = { tech: ["STACK", "INTEGRATIONS"], arch: ["ARCHITECTURE", "STRUCTURE"], quality: ["CONVENTIONS", "TESTING"], concerns: ["CONCERNS"] };
const DOCS = Object.values(FOCUS).flat();
const paths = (docs) => docs.map((d) => `.planning/codebase/${d}.md`);
const body = (n) => Array.from({ length: n }, (_, i) => `line ${i}`).join("\n");
const sevenDocs = (extra = {}) => Object.fromEntries(DOCS.map((d) => [`.planning/codebase/${d}.md`, extra[d] ?? `# ${d}\n${body(25)}\n`]));
const OPTS = { overlay: { gsd: { commit_policy: { docs: true, code: "per-wave" } } } };
const finding = { doc: "STACK", claim: "Uses Dart 3.4", problem: "outdated", evidence: "pubspec.yaml: sdk ^3.6.0", fix_hint: "say Dart 3.6" };
const integrationFinding = { doc: "INTEGRATIONS", claim: "Calls the sync endpoint", problem: "false", evidence: "no such route", fix_hint: "remove the call" };
const other = { doc: "TESTING", claim: "Lists the store_providers test", problem: "false", evidence: "no such file", fix_hint: "remove the entry" };

// A mapper writes the docs of its focus and confirms them. A fix round (`mapper-fix-<focus>`) rewrites `fix.docs` with `fix.text`
// and confirms `fix.written` (default: the docs it rewrote).
const mapper = (w, fix = {}) => (p, o) => {
  const focus = o.label.replace(/^mapper-(fix-)?/, "");
  const fixing = o.label.startsWith("mapper-fix-");
  const docs = fixing ? fix.docs ?? FOCUS[focus] : FOCUS[focus];
  for (const d of docs) w.write(`.planning/codebase/${d}.md`, `# ${d}\n${body(25)}\n${fixing ? fix.text ?? "revised" : ""}\n`);
  return { focus, written: fixing ? fix.written ?? paths(docs) : paths(docs) };
};
// A reviewer per focus: script[focus] lists the reply of each call in turn, the last one repeating.
const reviewer = (script) => {
  const calls = new Map();
  return (focus) => {
    const replies = script[focus] ?? [{ issues: [] }];
    const n = calls.get(focus) ?? 0;
    calls.set(focus, n + 1);
    return replies[Math.min(n, replies.length - 1)];
  };
};
const agentFor = (w, review, fix) => (p, o) => (o.label.startsWith("review-") ? review(o.label.slice("review-".length)) : mapper(w, fix)(p, o));
const runMap = (w, agent, args) => runScript("gsd-map-codebase", { root: w.root, gsd: w.gsd, agent, ...(args ? { args } : {}) });

test("FMAP-59 map check: a refuted Known Bug is told where it moves; the Checked, Not Bugs section passes", async () => {
  const concerns = (bugs, checked = "") => `# Concerns\n${body(22)}\n\n## Known Bugs\n\n${bugs}\n\n## Checked, Not Bugs\n\n${checked}\n## Security\n\nnone\n`;
  const refuted = ["**Decoder accepts jsonDecode output:**", "- Files: `lib/protocol/inbound.dart`"].join("\n");
  const check = (text) => flow(makeTempProject({ files: sevenDocs({ CONCERNS: text }) }).root, ["map-check"]);
  const underKnown = await check(concerns(refuted));
  const named = "Known Bug \"Decoder accepts jsonDecode output\" is neither verified (with its Evidence) nor suspected; a claim the code refutes moves to the \"## Checked, Not Bugs\" section after Known Bugs";
  assert.deepEqual([underKnown.code, underKnown.json.problems], [1, [`.planning/codebase/CONCERNS.md: ${named}`]]);
  const underChecked = await check(concerns("", refuted));
  assert.deepEqual([underChecked.code, underChecked.json.problems], [0, []]);
});

test("FMAP-59 the mapper overlay names the Checked, Not Bugs section for a refuted claim", () => {
  const overlay = fs.readFileSync(path.join(SHIP_DIR, ".agents", "gsd", "overlays", "gsd-codebase-mapper.md"), "utf8");
  assert.match(overlay, /refute[^\n]*## Checked, Not Bugs/);
});

test("FMAP-60 review fix: a fix round that names the doc with a finding is confirmed; naming a doc outside its focus, or not the doc with the finding, is not", async () => {
  const run = (fix) => {
    const w = makeWorld(OPTS);
    return runMap(w, agentFor(w, reviewer({ tech: [{ issues: [integrationFinding] }, { issues: [] }] }), fix));
  };
  const partial = await run({ docs: ["INTEGRATIONS"], written: paths(["INTEGRATIONS"]) });
  assert.equal(partial.result.status, "mapped");
  assert.equal(partial.calls.filter((c) => c.opts.label === "mapper-fix-tech").length, 1);
  const outside = await run({ docs: ["INTEGRATIONS"], written: paths(["INTEGRATIONS", "ARCHITECTURE"]) });
  assert.deepEqual([outside.result.status, outside.result.reason], ["failed", "mapper tech failed to fix its review findings: its confirmation does not name exactly its docs"]);
  const unnamed = await run({ docs: ["INTEGRATIONS"], written: paths(["STACK"]) });
  assert.equal(unnamed.result.status, "failed");
});

test("FMAP-61 review round 2 checks the round-1 findings; a new claim goes to the findings list and the map is still stamped", async () => {
  const w = makeWorld(OPTS);
  const r = await runMap(w, agentFor(w, reviewer({ tech: [{ issues: [finding] }, { issues: [], new_claims: [other] }] })));
  assert.equal(r.result.status, "mapped");
  assert.deepEqual(r.result.review, { checked: ["tech", "arch", "quality", "concerns"], fixed: ["tech"], findings: [{ focus: "tech", ...other }] });
  assert.equal(r.logs.includes("phase Stamp"), true);
  assert.match(w.read(".planning/codebase/STACK.md"), /^---\nlast_mapped_commit: [0-9a-f]{40}\n/);
  const round2 = r.calls.filter((c) => c.opts.label === "review-tech")[1];
  assert.match(round2.prompt, /Resolution check/);
  assert.match(round2.prompt, /Findings \(JSON\): .*Uses Dart 3\.4/);
});

test("FMAP-61 the round-2 prompt carries a digest of the docs, so a fix that changed them is reviewed again on resume", async () => {
  const round2Digest = async (text) => {
    const w = makeWorld(OPTS);
    const r = await runMap(w, agentFor(w, reviewer({ tech: [{ issues: [finding] }, { issues: [] }] }), { text }));
    const prompt = r.calls.filter((c) => c.opts.label === "review-tech")[1].prompt;
    return /Input digest \(docs\): (\S+)/.exec(prompt)?.[1] ?? null;
  };
  const first = await round2Digest("revised one");
  const second = await round2Digest("revised two");
  assert.ok(first && second);
  assert.notEqual(first, second);
});

test("FMAP-61 an incremental map asks every reviewer for its remapped paths only", async () => {
  const w = makeWorld(OPTS);
  const r = await runMap(w, agentFor(w, reviewer({})), { paths: "src/a,lib/b" });
  const reviews = r.calls.filter((c) => c.opts.label.startsWith("review-"));
  assert.equal(reviews.length, 4);
  for (const c of reviews) assert.match(c.prompt, /only the claims about these paths: src\/a, lib\/b/);
});

test("FMAP-60 the ph skill says a hotfixed script resumes with --resume <run> --name <workflow>", () => {
  const skill = fs.readFileSync(path.join(SHIP_DIR, ".claude", "skills", "ph", "SKILL.md"), "utf8");
  assert.match(skill, /--resume <runId> --name <name>/);
});
