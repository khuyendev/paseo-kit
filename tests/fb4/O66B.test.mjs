// Kit-feedback 66 (3): gsd.map_mode per-focus runs each focus of gsd-map-codebase as its own stream (map, check, review, fix,
// stamp); a clean focus is stamped at once, a focus whose doc check fails reruns its mapper alone, and a failing focus stops alone.
// The default `whole` keeps today's barriers.
import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../../ship/.agents/harness/config.mjs";
import { makeTempProject } from "../helpers/temp.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld } from "../gsd-flows/world.mjs";

const FOCUS = { tech: ["STACK", "INTEGRATIONS"], arch: ["ARCHITECTURE", "STRUCTURE"], quality: ["CONVENTIONS", "TESTING"], concerns: ["CONCERNS"] };
const paths = (docs) => docs.map((d) => `.planning/codebase/${d}.md`);
const body = (n) => Array.from({ length: n }, (_, i) => `line ${i}`).join("\n");
const PER_FOCUS = { overlay: { gsd: { map_mode: "per-focus", commit_policy: { docs: true, code: "per-wave" } } } };
const WHOLE = { overlay: { gsd: { commit_policy: { docs: true, code: "per-wave" } } } };
const BAD_BUG = "\n## Known Bugs\n\n**Decoder drops frames:**\n- Files: `lib/a.dart`\n";
const GOOD_BUG = "\n## Known Bugs\n\n**Decoder drops frames:**\n- Status: suspected\n";
const finding = { doc: "STACK", claim: "Uses Dart 3.4", problem: "outdated", evidence: "pubspec.yaml: sdk ^3.6.0", fix_hint: "say Dart 3.6" };

// A mapper writes the docs of its focus; `concerns` writes CONCERNS with `bug[n]` on its n-th write (the last one repeating).
// A fix or check rerun rewrites only what it names. Reviewers answer from `review[focus]` per call, the last one repeating.
function responder(w, { bug = [""], review = {} } = {}) {
  const writes = new Map();
  const reviews = new Map();
  const next = (map, key, list) => { const n = map.get(key) ?? 0; map.set(key, n + 1); return list[Math.min(n, list.length - 1)]; };
  return (p, o) => {
    if (o.label.startsWith("review-")) return next(reviews, o.label, review[o.label.slice(7)] ?? [{ issues: [] }]);
    const focus = o.label.replace(/^mapper-(fix-|check-)?/, "");
    for (const d of FOCUS[focus]) {
      const extra = d === "CONCERNS" ? next(writes, d, bug) : "";
      w.write(`.planning/codebase/${d}.md`, `# ${d}\n${body(25)}\n${extra}`);
    }
    return { focus, written: paths(FOCUS[focus]) };
  };
}
const runMap = (w, agent, args) => runScript("gsd-map-codebase", { root: w.root, gsd: w.gsd, agent, ...(args ? { args } : {}) });
const stampedDoc = (w, d) => /^---\nlast_mapped_commit: [0-9a-f]{40}\n/.test(w.read(`.planning/codebase/${d}.md`));
const commits = (w) => w.events.filter((e) => e.startsWith("commit "));
const labels = (r) => r.calls.map((c) => c.opts.label);

test("O66B the shipped default is map_mode whole; an unknown mode is rejected", () => {
  assert.equal(loadConfig(makeTempProject({ git: false }).root).gsd.map_mode, "whole");
  assert.throws(() => loadConfig(makeTempProject({ git: false, overlay: { gsd: { map_mode: "streams" } } }).root), /gsd\.map_mode/);
});

test("O66B per-focus: every focus clean is mapped, each call names its stage, one commit of the 7 docs", async () => {
  const w = makeWorld(PER_FOCUS);
  const r = await runMap(w, responder(w, { review: { tech: [{ issues: [finding] }, { issues: [] }] } }));
  assert.equal(r.result.status, "mapped");
  assert.equal(r.result.mode, "per-focus");
  assert.deepEqual(r.result.docs, paths(Object.values(FOCUS).flat()));
  assert.deepEqual(r.result.review, { checked: ["tech", "arch", "quality", "concerns"], fixed: ["tech"], findings: [] });
  assert.deepEqual(r.result.focuses.map((f) => [f.focus, f.status, f.fixed, f.rechecked]), [["tech", "stamped", true, false], ["arch", "stamped", false, false], ["quality", "stamped", false, false], ["concerns", "stamped", false, false]]);
  for (const d of Object.values(FOCUS).flat()) assert.ok(stampedDoc(w, d), d);
  assert.deepEqual(commits(w), [`commit docs: map codebase --files ${paths(Object.values(FOCUS).flat()).join(" ")}`]);
  const phaseOf = (label) => r.calls.find((c) => c.opts.label === label).opts.phase;
  assert.deepEqual([phaseOf("mapper-tech"), phaseOf("review-tech"), phaseOf("mapper-fix-tech")], ["Map", "Review", "Review"]);
  // The resolution check carries the digest of the focus's own docs only.
  assert.match(r.calls.filter((c) => c.opts.label === "review-tech")[1].prompt, /Input digest \(docs\): \S+/);
});

test("O66B per-focus: a doc check problem goes back to that focus's mapper once; the other focuses are not rerun", async () => {
  const w = makeWorld(PER_FOCUS);
  const r = await runMap(w, responder(w, { bug: [BAD_BUG, GOOD_BUG] }));
  assert.equal(r.result.status, "mapped");
  assert.deepEqual(labels(r).filter((l) => l.startsWith("mapper-")).sort(), ["mapper-arch", "mapper-check-concerns", "mapper-concerns", "mapper-quality", "mapper-tech"]);
  const rerun = r.calls.find((c) => c.opts.label === "mapper-check-concerns");
  assert.equal(rerun.opts.phase, "Check");
  assert.match(rerun.prompt, /Problems \(JSON\): .*Decoder drops frames/);
  assert.equal(r.result.focuses.find((f) => f.focus === "concerns").rechecked, true);
});

test("O66B per-focus: a focus still failing its check stops alone; the clean focuses are stamped and committed, the result is partial", async () => {
  const w = makeWorld(PER_FOCUS);
  const r = await runMap(w, responder(w, { bug: [BAD_BUG] }));
  assert.equal(r.result.status, "partial");
  assert.match(r.result.reason, /^concerns failed at Check: map incomplete: .*Decoder drops frames.*; stamped tech, arch, quality$/);
  const clean = ["STACK", "INTEGRATIONS", "ARCHITECTURE", "STRUCTURE", "CONVENTIONS", "TESTING"];
  assert.deepEqual(r.result.docs, paths(clean));
  assert.deepEqual(r.result.rerun, { docs: "CONCERNS" });
  assert.deepEqual(r.result.review.checked, ["tech", "arch", "quality"]);
  for (const d of clean) assert.ok(stampedDoc(w, d), d);
  assert.equal(stampedDoc(w, "CONCERNS"), false);
  assert.deepEqual(commits(w), [`commit docs: map codebase (tech, arch, quality) --files ${paths(clean).join(" ")}`]);
  assert.equal(labels(r).includes("review-concerns"), false);
});

test("O66B per-focus: open review claims in one focus need the owner for that focus only", async () => {
  const w = makeWorld(PER_FOCUS);
  const r = await runMap(w, responder(w, { review: { tech: [{ issues: [finding] }] } }));
  assert.equal(r.result.status, "partial");
  const tech = r.result.focuses.find((f) => f.focus === "tech");
  assert.deepEqual([tech.status, tech.stage, tech.findings], ["needs-owner", "Review", [finding]]);
  assert.deepEqual(r.result.findings, [{ focus: "tech", ...finding }]);
  assert.deepEqual(r.result.rerun, { docs: "STACK,INTEGRATIONS" });
  assert.equal(stampedDoc(w, "STACK"), false);
  assert.ok(stampedDoc(w, "CONCERNS"));
});

test("O66B per-focus: no focus stamped gives failed (or needs-owner), with the rerun args and the incremental paths", async () => {
  const w = makeWorld(PER_FOCUS);
  const r = await runMap(w, responder(w, { bug: [BAD_BUG] }), { docs: "CONCERNS", paths: "lib/a" });
  assert.equal(r.result.status, "failed");
  assert.deepEqual(r.result.rerun, { docs: "CONCERNS", paths: "lib/a" });
  assert.equal(r.result.commit, null);
  assert.deepEqual(commits(w), []);
  const w2 = makeWorld(PER_FOCUS);
  const r2 = await runMap(w2, responder(w2, { review: { tech: [{ issues: [finding] }] } }), { docs: "STACK,INTEGRATIONS" });
  assert.deepEqual([r2.result.status, r2.result.stage], ["needs-owner", "Review"]);
  assert.ok(r2.result.options.length > 0);
});

// The engine's resume: a call with the same prompt and options as a finished call of the first run replays its reply (cache key and
// occurrence); only the others start an agent. Replayed mapper calls do not write.
function replaying(first, fresh) {
  const done = new Map();
  for (const c of first.calls) {
    const k = JSON.stringify([c.opts.label, c.prompt]);
    done.set(k, [...(done.get(k) ?? []), c.result]);
  }
  const seen = new Map();
  const started = [];
  const respond = (p, o, n, calls) => {
    const k = JSON.stringify([o.label, p]);
    const occ = seen.get(k) ?? 0;
    seen.set(k, occ + 1);
    const hit = done.get(k)?.[occ];
    if (hit !== undefined) return hit;
    started.push(o.label);
    return fresh(p, o, n, calls);
  };
  return { respond, started };
}

test("O66B per-focus resume: after the owner corrects the failed focus by hand, only that focus starts an agent and every focus is stamped", async () => {
  const w = makeWorld(PER_FOCUS);
  const first = await runMap(w, responder(w, { bug: [BAD_BUG] }));
  assert.equal(first.result.status, "partial");
  w.write(".planning/codebase/CONCERNS.md", `# CONCERNS\n${body(25)}\n${GOOD_BUG}`);
  const { respond, started } = replaying(first, responder(w));
  const second = await runMap(w, respond);
  assert.equal(second.result.status, "mapped");
  assert.deepEqual(started, ["review-concerns"]);
  for (const d of Object.values(FOCUS).flat()) assert.ok(stampedDoc(w, d), d);
});

test("O66B per-focus resume: a stamped focus with a fix round replays its resolution check (the digest leaves out the stamp)", async () => {
  const w = makeWorld(PER_FOCUS);
  const first = await runMap(w, responder(w, { bug: [BAD_BUG], review: { tech: [{ issues: [finding] }, { issues: [] }] } }));
  assert.equal(first.result.focuses.find((f) => f.focus === "tech").status, "stamped");
  w.write(".planning/codebase/CONCERNS.md", `# CONCERNS\n${body(25)}\n${GOOD_BUG}`);
  const { respond, started } = replaying(first, responder(w));
  const second = await runMap(w, respond);
  assert.equal(second.result.status, "mapped");
  assert.deepEqual(started, ["review-concerns"]);
});

test("O66B per-focus: the rerun args map only the open focus", async () => {
  const w = makeWorld(PER_FOCUS);
  const first = await runMap(w, responder(w, { bug: [BAD_BUG] }));
  const second = await runMap(w, responder(w, { bug: [GOOD_BUG] }), first.result.rerun);
  assert.equal(second.result.status, "mapped");
  assert.deepEqual(labels(second), ["mapper-concerns", "review-concerns"]);
  assert.deepEqual(second.result.docs, [".planning/codebase/CONCERNS.md"]);
});

test("O66B default whole: one focus's check problem fails the map before any review, nothing stamped or committed, no mode field", async () => {
  const w = makeWorld(WHOLE);
  const r = await runMap(w, responder(w, { bug: [BAD_BUG, GOOD_BUG] }));
  assert.equal(r.result.status, "failed");
  assert.match(r.result.reason, /^map incomplete: .*Decoder drops frames/);
  assert.equal(Object.hasOwn(r.result, "mode"), false);
  assert.deepEqual(labels(r).sort(), ["mapper-arch", "mapper-concerns", "mapper-quality", "mapper-tech"]);
  assert.equal(stampedDoc(w, "STACK"), false);
  assert.deepEqual(commits(w), []);
  for (const c of r.calls) assert.equal(Object.hasOwn(c.opts, "phase"), false);
});

test("O66B default whole: a clean map keeps today's result shape", async () => {
  const w = makeWorld(WHOLE);
  const r = await runMap(w, responder(w));
  assert.deepEqual(Object.keys(r.result).sort(), ["commit", "docs", "paths", "review", "status"]);
  assert.equal(r.result.status, "mapped");
});
