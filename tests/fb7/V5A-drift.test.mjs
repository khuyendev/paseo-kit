// Kit feedback #98 F1 F2 (V5A): an outline revision that gives a symbol a new shape in the prose must change the manifest contract
// too. The drift check (verb plan-contract-drift) runs after each revision of the skeleton gate against the outline and manifest
// the gate began with; the outline writer gets one repair turn for it, and drift left after it stops before any planner.
import assert from "node:assert/strict";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, outlineText, PHASE_DIR as PD, plannerResponder } from "../gsd-flows/world.mjs";
import { contractDrift } from "../../ship/.agents/harness/gsd/contracts.mjs";

const OLD = "const SheetTab({required this.sheetId, required this.target})";
const NEW = "const SheetTab({required this.sheetId, required this.origin, required this.target})";
const manifest = (signature = OLD) => JSON.stringify({ phase: "1", plans: [
  { id: "01-01", owns: ["Path:src/01-01/"], requirements: ["R-1"], consumes: [], produces: [{ symbol: "SheetTab", kind: "class", file: "src/01-01/tab.dart", signature }, { symbol: "SheetTabStackNotifier.promote", kind: "method", file: "src/01-01/tab.dart", signature: "WorkspaceTabTarget? promote(String sheetId)" }] },
  { id: "01-02", owns: ["Path:src/01-02/"], requirements: ["R-1"], consumes: [{ plan: "01-01", symbol: "SheetTab" }] },
] });
const ROWS = [{ id: "01-01", wave: 1 }, { id: "01-02", wave: 2, depends: ["01-01"] }];
const outline = (prose) => outlineText(ROWS).replace("## OUTLINE COMPLETE", `${prose}\n\n## OUTLINE COMPLETE`);
const BEFORE = outline("01-01 writes `SheetTab(sheetId, target)` and `notifier.promote(sheetId)`.");
const RESHAPED = outline("01-01 writes `SheetTab {sheetId, origin: WorkspaceKey, target}` and `notifier.promote(sheetId)`.");

test("V5A 98 F1 contractDrift: a reshaped span with a name the unchanged signature lacks is drift; a changed signature or a reworded span is not", () => {
  const d = contractDrift({ outline: BEFORE, manifest: manifest() }, { outline: RESHAPED, manifest: manifest() });
  assert.deepEqual(d.drift, [{ plan: "01-01", symbol: "SheetTab", signature: OLD, spans: ["SheetTab {sheetId, origin: WorkspaceKey, target}"] }]);
  assert.match(d.errors[0], /contract drift: the outline now shapes SheetTab as `SheetTab \{sheetId, origin: WorkspaceKey, target\}`, but the manifest still freezes it \(01-01 produces\) as `const SheetTab/);
  assert.deepEqual(contractDrift({ outline: BEFORE, manifest: manifest() }, { outline: RESHAPED, manifest: manifest(NEW) }).drift, [], "the manifest changed with the prose");
  const reworded = outline("01-01 writes `SheetTab({sheetId, target})` and `notifier.promote(sheetId)`.");
  assert.deepEqual(contractDrift({ outline: BEFORE, manifest: manifest() }, { outline: reworded, manifest: manifest() }).drift, [], "only the signature's names");
  // A qualified symbol is matched by its last segment of 5+ letters too; a fenced code line is a span.
  const promote = outline("```dart\n({WorkspaceKey origin, WorkspaceTabTarget target})? promote(String sheetId)\n```");
  assert.deepEqual(contractDrift({ outline: BEFORE, manifest: manifest() }, { outline: promote, manifest: manifest() }).drift.map((x) => x.symbol), ["SheetTabStackNotifier.promote"]);
  assert.match(contractDrift({ outline: BEFORE, manifest: "{" }, { outline: RESHAPED, manifest: manifest() }).warnings[0], /not checked: the manifest before the revision is not valid JSON/);
});

const lane = { "skeleton-L1": () => ({ issues: [{ plan: "01-01", severity: "blocker", target: "outline", required_property: "sheets keep their origin", description: "app-wide sheets lose their originating workspace" }] }), "resolve-L1": () => ({ resolved: [{ id: "L1-1", evidence: "origin added" }] }) };
const world = () => makeWorld();
const run = (w, overrides) => runScript("gsd-plan", { root: w.root, gsd: w.gsd, args: { phaseDir: PD, planReview: false }, agent: plannerResponder(w, { rows: ROWS, overrides: {
  // The responder matches label prefixes: this one answers the first outline only, not outline-revise-<n> or outline-fix.
  outline: (_p, o) => (o.label === "outline" ? (w.write(`${PD}/01-PLAN-OUTLINE.md`, BEFORE), w.write(`${PD}/01-PLAN-OUTLINE.manifest.json`, manifest()), { marker: "## OUTLINE COMPLETE" }) : undefined),
  "outline-revise": () => { w.write(`${PD}/01-PLAN-OUTLINE.md`, RESHAPED); return { marker: "## REVISION COMPLETE" }; },
  ...lane, ...overrides,
} }) });
const labels = (r) => r.calls.map((c) => c.opts.label);

test("V5A 98 F1 F2 an outline revision that reshaped a symbol gets a repair turn with the drift; with the manifest fixed the phase is planned; no reshape, no turn", async () => {
  const w = world();
  const r = await run(w, { "outline-fix": () => { w.write(`${PD}/01-PLAN-OUTLINE.manifest.json`, manifest(NEW)); return { marker: "## REVISION COMPLETE" }; } });
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  const fix = r.calls.find((c) => c.opts.label === "outline-fix");
  assert.ok(fix, labels(r).join(", "));
  assert.match(fix.prompt, /contract drift: the outline now shapes SheetTab/);
  assert.ok(labels(r).indexOf("outline-revise-2") < labels(r).indexOf("outline-fix"));
  assert.ok(labels(r).indexOf("outline-fix") < labels(r).indexOf("plan-01-01"));
  // A revision that leaves every shape alone gets no repair turn; gsd.contract_check false checks no drift.
  const w2 = world();
  const same = await run(w2, { "outline-revise": () => { w2.write(`${PD}/01-PLAN-OUTLINE.md`, outline("01-01 writes `SheetTab(sheetId, target)` and `notifier.promote(sheetId)`. Revised.")); return { marker: "## REVISION COMPLETE" }; } });
  assert.equal(same.result.status, "planned", JSON.stringify(same.result));
  assert.equal(labels(same).includes("outline-fix"), false);
  const off = makeWorld({ overlay: { gsd: { contract_check: false } } });
  const o = await runScript("gsd-plan", { root: off.root, gsd: off.gsd, args: { phaseDir: PD, planReview: false }, agent: plannerResponder(off, { rows: ROWS, overrides: {
    outline: (_p, opt) => (opt.label === "outline" ? (off.write(`${PD}/01-PLAN-OUTLINE.md`, BEFORE), off.write(`${PD}/01-PLAN-OUTLINE.manifest.json`, manifest()), { marker: "## OUTLINE COMPLETE" }) : undefined),
    "outline-revise": () => { off.write(`${PD}/01-PLAN-OUTLINE.md`, RESHAPED); return { marker: "## REVISION COMPLETE" }; }, ...lane,
  } }) });
  assert.equal(o.result.status, "planned", JSON.stringify(o.result));
  assert.equal(labels(o).includes("outline-fix"), false);
});

test("V5A 98 F1 F2 drift left after the repair turn stops needs-owner at Skeleton review before any planner, with the drift and a fix answer", async () => {
  const w = world();
  const r = await run(w, { "outline-fix": () => ({ marker: "## REVISION COMPLETE" }) });
  assert.deepEqual([r.result.status, r.result.stage], ["needs-owner", "Skeleton review"], JSON.stringify(r.result));
  assert.match(r.result.reason, /reshaped SheetTab in the prose but not in the manifest contract/);
  assert.equal(r.result.drift[0].symbol, "SheetTab");
  assert.equal(r.result.answer.verb, "fix-and-rerun");
  assert.match(r.result.answer.command, /PLAN-OUTLINE\.manifest\.json produces signature/);
  assert.equal(labels(r).filter((l) => l.startsWith("plan-")).length, 0, "no planner ran on the contradiction");
});
