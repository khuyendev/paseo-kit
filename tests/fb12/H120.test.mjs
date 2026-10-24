// Kit feedback 120 (generated files out of code review) and 121 (codebase-map drift is an advisory, and a stop).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../../ship/.agents/harness/config.mjs";
import { resultTail } from "../../ship/.agents/harness/workflow/cmd-workflow.mjs";
import { createWatchdog } from "../../ship/.agents/harness/workflow/watchdog.mjs";
import { renderPrompt } from "../../ship/.agents/workflows/lib/flow-prompt.mjs";
import { changedLines, reviewScope } from "../../ship/.agents/workflows/lib/flow-review.mjs";
import { makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";
import { connectFake } from "../helpers/run.mjs";
import { createFakeClock } from "../fakes/fake-clock.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR } from "../gsd-flows/world.mjs";
import { CALLER, setup, tick } from "../workflow/helpers.mjs";

const { main } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
const PD = ".planning/phases/03-api";
const OWNS = { owns_forms: [{ prefix: "Path:", maps_to: "<path>" }], shared: { globs: [], predicate: null }, source_roots: [], ignore: [] };

async function flow(root, argv, input = "") {
  let line = "";
  const code = await main(argv, { root, input: typeof input === "string" ? input : JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}

function stamp(project, commit) {
  project.write(".planning/codebase/STACK.md", `---\nlast_mapped_commit: ${commit}\n---\n${"line\n".repeat(25)}`);
}

test("H120 F1 review scope and changed lines drop regenerated and adapter.generated files, and name the source", () => {
  const p = makeTempProject({
    files: { "lib/app.dart": "a\n", "lib/strings.g.dart": "gen\n", "gen/out.dart": "o\n", [`${PD}/03-01-SUMMARY.md`]: "---\nkey-files:\n  created: [lib/app.dart, lib/strings.g.dart, gen/out.dart]\n---\n" },
    overlay: { adapter: { generated: ["gen/**"], ownership: { ...OWNS, regenerated: [{ glob: "lib/*.g.dart", source: "lib/strings.json" }] } } },
  });
  const sc = reviewScope(p.root, PD, { plan: "03-01", summary: `${PD}/03-01-SUMMARY.md` });
  assert.deepEqual(sc.scope, ["lib/app.dart"]);
  assert.deepEqual(sc.generated, [{ path: "lib/strings.g.dart", source: "lib/strings.json" }, { path: "gen/out.dart" }]);
  assert.equal(sc.generatedText, "lib/strings.g.dart (generated from lib/strings.json), gen/out.dart");
  assert.ok(sc.excluded.some((e) => e.path === "lib/strings.g.dart" && e.reason === "generated" && e.source === "lib/strings.json"));
  assert.ok(sc.log.some((l) => l.includes("dropped lib/strings.g.dart: generated from lib/strings.json")));
  const lines = changedLines(p.root, PD, { plan: "03-01", files: ["lib/app.dart", "lib/strings.g.dart", "gen/out.dart"] });
  assert.deepEqual(Object.keys(lines.files), ["lib/app.dart"]);
  const explicit = reviewScope(p.root, PD, { plan: "03-01", files: ["lib/app.dart", "lib/strings.g.dart"] });
  assert.deepEqual(explicit.scope, ["lib/app.dart"]);
  assert.equal(explicit.generated[0].source, "lib/strings.json");
});

test("H120 F2 the code-review prompt names the source and the generator once, and only when a generated file was dropped", () => {
  const named = renderPrompt(SHIP_DIR, "code-review", { plan: "03-01", planPath: "p", depth: "standard", scope: "lib/app.dart", lines: "- lib/app.dart: 1", codeOnly: false, built: "green", lenses: "- correctness", stackSkill: "", generated: "lib/strings.g.dart (generated from lib/strings.json)", digest: "d" });
  const hits = named.text.split("Review the source and the generator command, not the output.").length - 1;
  assert.equal(hits, 1);
  assert.match(named.text, /Generated files were left out of this review: lib\/strings\.g\.dart \(generated from lib\/strings\.json\)/);
  const none = renderPrompt(SHIP_DIR, "code-review", { plan: "03-01", planPath: "p", depth: "standard", scope: "lib/app.dart", lines: "- lib/app.dart: 1", codeOnly: false, built: "green", lenses: "- correctness", stackSkill: "", generated: "", digest: "d" });
  assert.equal(none.text.includes("generator command"), false);
  const omitted = renderPrompt(SHIP_DIR, "code-review", { plan: "03-01", planPath: "p", depth: "standard", scope: "lib/app.dart", lines: "- lib/app.dart: 1", codeOnly: false, built: "green", lenses: "- correctness", stackSkill: "", digest: "d" });
  assert.equal(omitted.text.includes("generator command"), false);
});

test("H120 a regenerated entry is a glob or {glob, source}; a bare string and an unknown key are refused", () => {
  const ok = makeTempProject({ overlay: { adapter: { ownership: { ...OWNS, regenerated: ["gen/**", { glob: "lib/*.g.dart", source: "lib/strings.json" }] } } } });
  assert.deepEqual(loadConfig(ok.root).adapter.ownership.regenerated[1], { glob: "lib/*.g.dart", source: "lib/strings.json" });
  const bare = makeTempProject();
  bare.writeJson(".agents/harness.config.json", { adapter: { ownership: { ...OWNS, regenerated: "gen/**" } } });
  assert.throws(() => loadConfig(bare.root), /adapter\.ownership\.regenerated/);
  const via = makeTempProject();
  via.writeJson(".agents/harness.config.json", { adapter: { generated: [{ glob: "lib/*.g.dart", via: "slang" }] } });
  assert.throws(() => loadConfig(via.root), /adapter\.generated\[0\]\.via/);
});

function driftProject(n, { block } = {}) {
  const p = makeTempProject({ overlay: block === undefined ? {} : { gsd: { map_drift_block: block } } });
  const head = p.git("rev-parse", "HEAD").trim();
  stamp(p, head);
  for (let i = 0; i < n; i++) p.write(`n${i}/f.txt`, "x\n");
  return p;
}

test("H121 map-drift: advisory over the warn threshold, stop over the block, staleMapReason logged, paths named", async () => {
  const none = makeTempProject();
  const skipped = await flow(none.root, ["map-drift"], {});
  assert.equal(skipped.json.status, "skipped");
  assert.equal(skipped.json.advisory, null);
  assert.equal(skipped.json.stop, null);
  const warn = driftProject(4);
  const w = await flow(warn.root, ["map-drift"], {});
  assert.equal(w.json.status, "drift");
  assert.equal(w.json.count, 4);
  assert.equal(w.json.stop, null);
  assert.equal(w.json.advisory.lane, "map");
  assert.match(w.json.line, /codebase map drift: 4 changes since .+ \(threshold 3\); gsd-map-codebase --paths /);
  assert.ok(w.json.paths.includes("n0") && w.json.paths.includes("n3"));
  const block = driftProject(30);
  const b = await flow(block.root, ["map-drift"], {});
  assert.equal(b.json.stop.stage, "Preconditions");
  assert.equal(b.json.stop.answer.verb, "workflow");
  assert.match(b.json.stop.answer.command, /gsd-map-codebase --paths /);
  assert.match(b.json.stop.answer.command, /staleMapReason/);
  assert.ok(b.json.paths.length >= 30);
  const accepted = await flow(block.root, ["map-drift"], { reason: "phase 4 is already mapped in my notes" });
  assert.equal(accepted.json.stop, null);
  assert.equal(accepted.json.staleMapReason, "phase 4 is already mapped in my notes");
  assert.ok(accepted.json.logs.some((l) => l.includes("stale map accepted: phase 4 is already mapped in my notes")));
  const off = driftProject(30, { block: 0 });
  assert.equal((await flow(off.root, ["map-drift"], {})).json.stop, null);
});

test("H121 the run's final line names map drift only when the result carries it", () => {
  assert.equal(resultTail({ status: "planned" }), "");
  assert.equal(resultTail({ mapDrift: { line: "" } }), "");
  assert.equal(resultTail({ mapDrift: { line: "codebase map drift: 4 changes since abc (threshold 3); gsd-map-codebase --paths n0" } }), "; codebase map drift: 4 changes since abc (threshold 3); gsd-map-codebase --paths n0");
});

function manyDirs(w, n) {
  const head = w.project.git("rev-parse", "HEAD").trim();
  stamp(w, head);
  for (let i = 0; i < n; i++) w.write(`n${i}/f.txt`, "x\n");
}

test("H121 gsd-plan and gsd-research stop at Preconditions over the block, and carry the advisory under it", async () => {
  const stopped = makeWorld();
  manyDirs(stopped, 30);
  const planStop = await runScript("gsd-plan", { root: stopped.root, args: { phaseDir: PHASE_DIR }, gsd: stopped.gsd, agent: () => { throw new Error("no agent"); } });
  assert.equal(planStop.calls.length, 0);
  assert.deepEqual([planStop.result.status, planStop.result.stage], ["needs-owner", "Preconditions"]);
  assert.equal(planStop.result.answer.verb, "workflow");
  assert.ok(planStop.result.paths.includes("n0"));
  assert.equal(planStop.result.advisories.some((a) => a.lane === "map"), true);
  assert.match(planStop.result.mapDrift.line, /gsd-map-codebase --paths /);
  const researchStop = await runScript("gsd-research", { root: stopped.root, args: { phaseDir: PHASE_DIR }, gsd: stopped.gsd, agent: () => { throw new Error("no agent"); } });
  assert.equal(researchStop.calls.length, 0);
  assert.deepEqual([researchStop.result.status, researchStop.result.stage], ["needs-owner", "Preconditions"]);
  assert.equal(researchStop.result.answer.verb, "workflow");
  const view = await runScript("gsd-research", { root: stopped.root, args: { phaseDir: PHASE_DIR, view: true }, gsd: stopped.gsd });
  assert.notEqual(view.result.stage, "Preconditions");
  assert.equal(view.result.advisories.some((a) => a.lane === "map"), true);
  const go = makeWorld();
  manyDirs(go, 30);
  const accepted = await runScript("gsd-plan", { root: go.root, args: { phaseDir: PHASE_DIR, staleMapReason: "the map still covers the phase" }, gsd: go.gsd, agent: () => ({ marker: "## OUTLINE COMPLETE" }) });
  assert.ok(accepted.logs.some((l) => l.includes("stale map accepted: the map still covers the phase")), accepted.logs.join("\n"));
  assert.notEqual(accepted.result.stage, "Preconditions");
  const warn = makeWorld({ research: false });
  manyDirs(warn, 4);
  warn.write(`${PHASE_DIR}/01-RESEARCH.md`, "research\n");
  const reused = await runScript("gsd-research", { root: warn.root, args: { phaseDir: PHASE_DIR }, gsd: warn.gsd, agent: () => { throw new Error("no agent"); } });
  assert.equal(reused.result.status, "reused");
  assert.equal(reused.calls.length, 0);
  assert.match(reused.result.mapDrift.line, /codebase map drift: 4 changes/);
  assert.equal(reused.result.advisories[0].lane, "map");
});

test("H121 gsd-execute does not stop for drift and names the paths to remap", async () => {
  const w = makeWorld();
  manyDirs(w, 4);
  const r = await runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: () => { throw new Error("no agent"); } });
  assert.notEqual(r.result.status, "needs-owner");
  assert.ok(r.result.remap.includes("n0"), JSON.stringify(r.result.remap));
  assert.equal(r.result.advisories[0].lane, "map");
  assert.match(r.result.mapDrift.line, /gsd-map-codebase --paths /);
  assert.equal(r.calls.length, 0);
});

test("H120 F3 the watchdog reread report names a generated file apart from an authored one", async () => {
  const clock = createFakeClock({ auto: false });
  const s = setup({ clock, overlay: { watchdog_same_file_reads: 3, adapter: { generated: [{ glob: "lib/*.g.dart", source: "lib/strings.json" }] } } });
  const session = await connectFake(s.fake, { env: s.env, root: s.project.root, clock });
  const agent = s.fake.addAgent({ parent: CALLER, status: "running" });
  await session.observe([agent.id]);
  const out = [];
  const hub = createWatchdog({ session, cfg: loadConfig(s.project.root), clock, out: (l) => out.push(l), root: s.project.root });
  hub.arm(agent.id, "review-05-02");
  let seq = 0;
  const read = (file) => {
    const id = `c${++seq}`;
    const detail = { type: "read", filePath: file };
    s.fake.emitToolCall(agent.id, { type: "tool_call", callId: id, name: "Read", status: "running", detail });
    s.fake.emitToolCall(agent.id, { type: "tool_call", callId: id, name: "Read", status: "completed", detail });
  };
  for (let i = 0; i < 3; i++) read("lib/app.dart");
  for (let i = 0; i < 3; i++) read("lib/strings.g.dart");
  await tick();
  const sends = s.fake.callsOf("sendAgentMessage").map((c) => c.args[1]);
  assert.equal(sends.filter((t) => t.includes("you read lib/app.dart 3 times")).length, 1);
  assert.equal(sends.filter((t) => t.includes("generated file(s) read again: lib/strings.g.dart 3 times (generated from lib/strings.json)")).length, 1);
  assert.ok(out.some((l) => /reread-generated:/.test(l)));
  assert.equal(out.some((l) => /reread: \{"file":"lib\/strings\.g\.dart"/.test(l)), false);
  hub.close();
});
