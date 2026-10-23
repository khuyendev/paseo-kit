// Kit feedback #67 F1 F2 F3 F5 and #76 F1 (P67): cross-plan contracts with one owner. The manifest's structured `produces` is the
// source; `ph gsd verify contracts` checks the plans against it, `contracts change` is the one writer after the outline, the
// freeze key ignores the signature parts, key_links `requires` need a provider in the same or an earlier wave, and the wave
// gate checks the produced symbols exist. Verb tests run the real verbs on a temp project.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { P1, gsd, plan, project } from "../gsd-core/fixture.mjs";
import { makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";
import { manifestFreezeText, squash } from "../../ship/.agents/harness/gsd/contracts.mjs";

const OUTLINE = `# Outline\n\n| Requirements | Plan ID | Wave | Objective | Depends on |\n|---|---|---|---|---|\n| CORE-01 | \`01-01\` | 1 | do | none |\n| CORE-02 | \`01-02\` | 2 | do | 01-01 |\n\n## OUTLINE COMPLETE\n`;
const SIG = "Future<void> pause()";
const produced = (over = {}) => ({ symbol: "DaemonClient.pause", kind: "method", file: "src/a.js", signature: SIG, ...over });
const entries = (over = {}) => [
  { id: "01-01", owns: ["Path:src/a.js"], requirements: ["CORE-01"], produces: [produced()], consumes: [], tracer: { is: false }, verify: [], ...over.first },
  { id: "01-02", owns: ["Path:src/b.js"], requirements: ["CORE-02"], produces: [], consumes: [{ plan: "01-01", symbol: "DaemonClient.pause" }], tracer: { is: false }, verify: [], ...over.second },
];
const ifaces = (text) => `\n<interfaces>\n${text}\n</interfaces>\n`;
const first = (text = SIG, extra = "") => plan({ extra }) + ifaces(text);
const second = (text = SIG, extra = "") => plan({ id: "02", wave: 2, depends: "[01-01]", reqs: "[CORE-02]", files: "[src/b.js]", owns: '["Path:src/b.js"]', extra }) + ifaces(text);
const world = ({ manifest = { phase: "01", plans: entries() }, plans = [first(), second()], overlay } = {}) => project({
  overlay,
  files: {
    [`${P1}/01-PLAN-OUTLINE.md`]: OUTLINE,
    [`${P1}/01-PLAN-OUTLINE.manifest.json`]: typeof manifest === "string" ? manifest : JSON.stringify(manifest),
    ...(plans[0] ? { [`${P1}/01-01-PLAN.md`]: plans[0] } : {}),
    ...(plans[1] ? { [`${P1}/01-02-PLAN.md`]: plans[1] } : {}),
  },
});
const verify = (p, ...more) => gsd(p, ["verify", "contracts", "1", ...more]);
const kinds = (r) => (r.json.errors ?? []).map((e) => `${e.kind}:${e.plan}`);

test("P67 F3 verify contracts: the producer writes the manifest signature and the consumer quotes it, else each is an issue naming its plans", async () => {
  assert.equal((await verify(world())).code, 0);
  const noProducer = await verify(world({ plans: [first("Future<void> pause(int ms)"), second()] }));
  assert.equal(noProducer.code, 1, JSON.stringify(noProducer.json));
  assert.deepEqual(kinds(noProducer), ["producer-signature:01-01"]);
  assert.match(noProducer.json.errors[0].message, /does not write the signature of DaemonClient\.pause/);
  assert.match(noProducer.json.errors[0].fix_hint, /CONTRACT_CHANGE/);
  const noConsumer = await verify(world({ plans: [first(), second("calls client.pause()")] }));
  assert.deepEqual(kinds(noConsumer), ["consumer-signature:01-02"]);
  assert.deepEqual(noConsumer.json.errors[0].plans, ["01-02", "01-01"]);
  // Whitespace, backticks and a trailing comma do not make a different signature.
  assert.equal((await verify(world({ plans: [first("`Future<void>   pause( )`"), second("Future<void>\n  pause()")] }))).code, 0);
  assert.equal(squash("f(a,\n  b,\n)"), squash("f(a, b)"));
});

test("P67 F3 every consumes edge resolves; a legacy free-text produces still parses and is never an error", async () => {
  const unknown = await verify(world({ manifest: { phase: "01", plans: entries({ second: { consumes: [{ plan: "01-01", symbol: "DaemonClient.resume" }] } }) } }));
  assert.deepEqual(kinds(unknown), ["edge-unresolved:01-02"]);
  assert.deepEqual(unknown.json.errors[0].plans, ["01-02", "01-01"]);
  const missingPlan = await verify(world({ manifest: { phase: "01", plans: entries({ second: { consumes: [{ plan: "01-09", symbol: "X" }] } }) } }));
  assert.deepEqual(kinds(missingPlan), ["edge-unresolved:01-02"]);
  const legacy = world({ manifest: { phase: "01", plans: entries({ first: { produces: ["HostsNotifier mutations (addProbedConnection, remove)"] }, second: { consumes: [{ plan: "01-01", symbol: "addProbedConnection" }, { plan: "01-01", symbol: "gone" }] } }) }, plans: [first("x"), second("y")] });
  const r = await verify(legacy);
  assert.equal(r.code, 0, JSON.stringify(r.json));
  assert.match(r.json.warnings.join("\n"), /01-02 consumes gone from 01-01, which does not produce it \(free-text produces\)/);
  assert.equal((await verify(world({ manifest: { phase: "01", plans: [{ id: "01-01", owns: ["Path:src/a.js"] }] } }))).code, 0);
});

test("P67 F3 a produced file the plan does not own, a missing plan under --complete and the --plans filter", async () => {
  const outside = await verify(world({ manifest: { phase: "01", plans: entries({ first: { produces: [produced({ file: "src/z.js" })] } }) } }));
  assert.deepEqual(kinds(outside), ["file-outside-owns:01-01"]);
  const partial = world({ plans: [first(), null] });
  assert.equal((await verify(partial)).code, 0, "a plan not written yet is skipped while planning");
  const complete = await verify(partial, "--complete");
  assert.deepEqual(kinds(complete), ["plan-missing:01-02"]);
  const bad = world({ plans: [first("nope"), second("nope")] });
  const consumerOnly = await verify(bad, "--plans", "01-02");
  assert.deepEqual(kinds(consumerOnly), ["consumer-signature:01-02"], "an error is kept when the filtered plan is one of the plans it names");
  const only = await verify(bad, "--plans", "01-01");
  assert.ok(kinds(only).includes("producer-signature:01-01"));
  assert.ok(kinds(only).includes("consumer-signature:01-02"), "the consumer error names the producer too");
});

test("P67 F2 contracts change: the one writer; old must match, a repeat is a no-op, and the freeze key does not move", async () => {
  const p = world();
  const before = (await gsd(p, ["revisions", "hash", "1", "freeze"])).json.hash;
  const shown = (await gsd(p, ["contracts", "show", "1", "--plan", "01-01"])).json;
  assert.deepEqual(shown.consumers, { "DaemonClient.pause": ["01-02"] });
  assert.equal(shown.produces[0].signature, SIG);
  const consumerView = (await gsd(p, ["contracts", "show", "1", "--plan", "01-02"])).json;
  assert.deepEqual(consumerView.consumes.map((c) => c.entry.signature), [SIG]);
  const wrong = await gsd(p, ["contracts", "change", "1"], { stdin: JSON.stringify({ plan: "01-01", symbol: "DaemonClient.pause", old: "Future<void> stop()", new: "Future<void> pause(int ms)", reason: "r" }) });
  assert.equal(wrong.code, 1);
  assert.match(wrong.json.error, /CONTRACT_CHANGE rejected: the manifest signature of DaemonClient\.pause is Future<void> pause\(\)/);
  const change = { plan: "01-01", symbol: "DaemonClient.pause", old: SIG, new: "Future<void> pause(Duration d)", reason: "pausing needs a timeout" };
  const ok = await gsd(p, ["contracts", "change", "1"], { stdin: JSON.stringify(change) });
  assert.equal(ok.code, 0, JSON.stringify(ok.json));
  assert.deepEqual([ok.json.changed, ok.json.consumers], [true, ["01-02"]]);
  const manifest = p.readJson(`${P1}/01-PLAN-OUTLINE.manifest.json`);
  assert.equal(manifest.plans[0].produces[0].signature, "Future<void> pause(Duration d)");
  assert.deepEqual(manifest.plans[0].produces[0].supersedes, [SIG]);
  assert.deepEqual(manifest.contract_changes, [{ plan: "01-01", symbol: "DaemonClient.pause", old: SIG, new: "Future<void> pause(Duration d)", reason: "pausing needs a timeout" }]);
  assert.equal((await gsd(p, ["revisions", "hash", "1", "freeze"])).json.hash, before, "the reviewed skeleton is not stale after a CONTRACT_CHANGE");
  const again = await gsd(p, ["contracts", "change", "1"], { stdin: JSON.stringify(change) });
  assert.deepEqual([again.code, again.json.changed, again.json.already], [0, false, true], "a replayed reply repeats the change without effect");
  // Both plans still hold the old signature: the producer lacks the new one, the superseded text is stale in both.
  const r = await verify(p);
  assert.deepEqual([...new Set(kinds(r))].sort(), ["consumer-signature:01-02", "producer-signature:01-01", "stale-signature:01-01", "stale-signature:01-02"]);
  fs.writeFileSync(p.path(`${P1}/01-01-PLAN.md`), first("Future<void> pause(Duration d)"));
  fs.writeFileSync(p.path(`${P1}/01-02-PLAN.md`), second("Future<void> pause(Duration d)"));
  assert.equal((await verify(p)).code, 0);
});

test("P67 F2 an outline edit of anything but the signature parts does change the freeze key; a manifest without signatures hashes as written", async () => {
  const p = world();
  const before = (await gsd(p, ["revisions", "hash", "1", "freeze"])).json.hash;
  const m = p.readJson(`${P1}/01-PLAN-OUTLINE.manifest.json`);
  m.plans[0].produces[0].file = "src/other.js";
  p.writeJson(`${P1}/01-PLAN-OUTLINE.manifest.json`, m);
  assert.notEqual((await gsd(p, ["revisions", "hash", "1", "freeze"])).json.hash, before);
  const legacy = JSON.stringify({ phase: "01", plans: [{ id: "01-01", produces: ["free text"] }] });
  assert.equal(manifestFreezeText(legacy), legacy);
  assert.equal(manifestFreezeText(null), null);
  assert.equal(manifestFreezeText("not json"), "not json");
});

test("P67 76 F1 key_links requires: provided by a plan of the same or an earlier wave, else a blocker naming both plans", async () => {
  const requires = "  key_links:\n    - requires: {kind: ancestor_widget, name: PaseoToastHost, by: 01-02}\n";
  const provides = "  key_links:\n    - provides: {kind: ancestor_widget, name: PaseoToastHost, at: lib/app.dart}\n";
  // 01-01 (wave 1) requires; 01-02 (wave 2) provides: a later wave.
  const later = await verify(world({ manifest: { phase: "01", plans: entries({ first: { produces: [] }, second: { consumes: [] } }) }, plans: [first(SIG, requires), second(SIG, provides)] }));
  assert.deepEqual(kinds(later), ["requires-later-wave:01-01"]);
  assert.deepEqual(later.json.errors[0].plans, ["01-01", "01-02"]);
  assert.match(later.json.errors[0].message, /01-01 \(wave 1\) requires ancestor widget PaseoToastHost, provided only by 01-02 \(wave 2\), a later wave/);
  const flat = { manifest: { phase: "01", plans: entries({ first: { produces: [] }, second: { consumes: [] } }) } };
  // The provider in an earlier wave, and in the same plan, are both fine.
  assert.equal((await verify(world({ ...flat, plans: [first(SIG, provides), second(SIG, requires)] }))).code, 0);
  assert.equal((await verify(world({ ...flat, plans: [first(SIG, requires + provides.split("\n")[1] + "\n"), second()] }))).code, 0);
  // Nobody provides it: a blocker naming the requirer and the plan it named.
  const none = await verify(world({ ...flat, plans: [first(SIG, requires), second()] }));
  assert.deepEqual(kinds(none), ["requires-unprovided:01-01"]);
  assert.deepEqual(none.json.errors[0].plans, ["01-01", "01-02"]);
  // An existing file satisfies it; so does nothing less. While plans are still being written, no provider is no verdict yet.
  const existing = "  key_links:\n    - requires: {kind: registration, name: boot, existing: lib/boot.dart}\n";
  assert.equal((await verify(world({ ...flat, plans: [first(SIG, existing), second()] }))).code, 1);
  const w = world({ ...flat, plans: [first(SIG, existing), second()] });
  fs.mkdirSync(w.path("lib"), { recursive: true });
  fs.writeFileSync(w.path("lib/boot.dart"), "x");
  assert.equal((await verify(w)).code, 0);
  assert.equal((await verify(world({ ...flat, plans: [first(SIG, requires), null] }))).code, 0, "plan 01-02 is not written yet");
  const badKind = await verify(world({ ...flat, plans: [first(SIG, "  key_links:\n    - requires: {kind: magic, name: X}\n"), second()] }));
  assert.deepEqual(kinds(badKind), ["requires-invalid:01-01"]);
  // verify key-links does not read a requires/provides entry as a source link.
  const links = await gsd(world({ ...flat, plans: [first(SIG, requires), second()] }), ["verify", "key-links", "1"]);
  assert.equal(links.code, 66, JSON.stringify(links.json));
});

test("P67 F1 outline check: structured produces are validated, a free-text entry is one warning, and gsd.contract_check false asks for none of it", async () => {
  const check = async (p) => (await gsd(p, ["outline", "check", "1", "--tracer", "false"])).json;
  const ok = await check(world());
  assert.deepEqual(ok.errors, [], JSON.stringify(ok));
  const half = await check(world({ manifest: { phase: "01", plans: entries({ first: { produces: [{ symbol: "A", kind: "method", file: "src/a.js" }] } }) } }));
  assert.ok(half.errors.includes("01-01: produces[0] is missing signature"), JSON.stringify(half.errors));
  const outside = await check(world({ manifest: { phase: "01", plans: entries({ first: { produces: [produced({ file: "src/z.js" })] } }) } }));
  assert.ok(outside.errors.includes("01-01: produces DaemonClient.pause at src/z.js, which is outside its owns"), JSON.stringify(outside.errors));
  const twice = await check(world({ manifest: { phase: "01", plans: entries({ first: { produces: [produced(), produced()] } }) } }));
  assert.ok(twice.errors.includes("01-01: produces DaemonClient.pause twice"));
  const legacy = await check(world({ manifest: { phase: "01", plans: entries({ first: { produces: ["a thing", "another"] } }) } }));
  assert.ok(legacy.warnings.some((w) => /01-01: produces holds 2 free-text entries/.test(w)), JSON.stringify(legacy.warnings));
  // The earlier object form (a symbol and a kind) is legacy: no error, only the free-text warning.
  const old = await check(world({ manifest: { phase: "01", plans: entries({ first: { produces: [{ symbol: "start", kind: "fn", header: "src/a.js" }] } }) } }));
  assert.deepEqual(old.errors, [], JSON.stringify(old.errors));
  const off = await check(world({ overlay: { gsd: { contract_check: false } }, manifest: { phase: "01", plans: entries({ first: { produces: [{ symbol: "A", kind: "method" }, "free"] } }) } }));
  assert.deepEqual(off.errors, [], "switch off: the earlier outline check");
  assert.ok(!off.warnings.some((w) => /free-text/.test(w)));
});

// --- F5: the wave gate ---

const { main } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
async function flow(root, argv, input = "") {
  let line = "";
  const code = await main(argv, { root, input: typeof input === "string" ? input : JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}
const NODE = process.execPath;
const GATE_DIR = ".planning/phases/01-core";
const gateProject = (files, overlay = {}) => makeTempProject({
  files: { [`${GATE_DIR}/01-PLAN-OUTLINE.manifest.json`]: JSON.stringify({ phase: "01", plans: [{ id: "01-01", owns: ["Path:src/"], produces: [produced({ file: "src/a.js" }), produced({ symbol: "Other", kind: "class", file: "src/b.js", signature: "class Other" })] }, { id: "01-02", owns: ["Path:lib/"], produces: [] }] }), ...files },
  overlay: { adapter: { commands: { build: [NODE, "-e", "process.exit(0)"], test: [NODE, "-e", "process.exit(0)"], build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} } }, ...overlay },
});
const gatePlans = [{ id: "01-01", owns: ["Path:src/"], verify: [] }, { id: "01-02", owns: ["Path:lib/"], verify: [] }];

test("P67 F5 the wave gate checks the produced symbols exist at the declared file; a missing one is a red step attributed to its plan", async () => {
  const p = gateProject({ "src/a.js": "class DaemonClient { Future<void> pause() async {} }\n", "src/b.js": "// nothing\n" });
  const r = await flow(p.root, ["gate", GATE_DIR], { waveId: "w1", plans: gatePlans });
  assert.equal(r.json.green, false, JSON.stringify(r.json));
  assert.deepEqual(r.json.failures.map((f) => [f.step, f.plan]), [["contract-01-01", "01-01"]]);
  assert.match(r.json.failures[0].excerpt, /Other: Other is not in src\/b\.js/);
  assert.deepEqual(Object.keys(r.json.byPlan), ["01-01"]);
  const steps = p.readJson(r.json.evidence).steps;
  assert.equal(steps.find((s) => s.name === "contract-01-01").outcome, "failed");
  assert.equal(steps.some((s) => s.name === "contract-01-02"), false, "a plan with no structured produces gets no step");
  // The symbol written, the gate is green and the step passed with a log (the evidence shape holds).
  p.write("src/b.js", "class Other {}\n");
  const g = await flow(p.root, ["gate", GATE_DIR], { waveId: "w2", plans: gatePlans });
  assert.equal(g.json.green, true, JSON.stringify(g.json));
  const step = p.readJson(g.json.evidence).steps.find((s) => s.name === "contract-01-01");
  assert.deepEqual([step.outcome, step.exitCode], ["passed", 0]);
  assert.ok(fs.existsSync(p.path(step.log)));
  assert.equal((await flow(p.root, ["evidence-check", g.json.evidence], { plans: gatePlans })).json.status, "current");
  // The declared file missing.
  fs.rmSync(p.path("src/a.js"));
  const gone = await flow(p.root, ["gate", GATE_DIR], { waveId: "w3", plans: gatePlans });
  assert.match(gone.json.failures[0].excerpt, /DaemonClient\.pause: declared file src\/a\.js does not exist/);
});

test("P67 F5 a signature that reads differently in code is a note, not a failure; only plans of the gate are checked; the switch turns it off", async () => {
  const files = { "src/a.js": "class DaemonClient { pause(timeout) {} }\n", "src/b.js": "class Other {}\n" };
  const p = gateProject(files);
  const r = await flow(p.root, ["gate", GATE_DIR], { waveId: "w1", plans: gatePlans });
  assert.equal(r.json.green, true, JSON.stringify(r.json));
  assert.ok(r.json.notes.some((n) => /contract 01-01: DaemonClient\.pause: src\/a\.js does not hold the manifest signature text/.test(n)), JSON.stringify(r.json.notes));
  const only = gateProject({ "src/a.js": "x\n" });
  const o = await flow(only.root, ["gate", GATE_DIR], { waveId: "w1", plans: [gatePlans[1]] });
  assert.equal(o.json.green, true, "01-01 is not in this gate");
  const off = gateProject({ "src/a.js": "x\n" }, { gsd: { contract_check: false } });
  const f = await flow(off.root, ["gate", GATE_DIR], { waveId: "w1", plans: gatePlans });
  assert.equal(f.json.green, true, "contract_check false: no contract step");
});
