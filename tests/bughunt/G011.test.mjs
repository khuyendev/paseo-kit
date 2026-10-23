// Bug-hunt fix G011: a failed architect refresh of WIRING.md must not pass on the file an earlier run left behind.
import assert from "node:assert/strict";
import test from "node:test";
import { NULL, runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR, plannerResponder } from "../gsd-flows/world.mjs";

const WIRING = `${PHASE_DIR}/01-WIRING.md`;
const archAgent = { ".agents/agents/arch.md": "---\nname: arch\n---\nbody\n" };
const archOverlay = { adapter: { agents: { architect: "arch" } } };
const rowsOld = [{ id: "01-01", wave: 1 }, { id: "01-02", wave: 2, depends: ["01-01"], consumes: [{ plan: "01-01", symbol: "OldApi" }] }];
const rowsNew = [{ id: "01-01", wave: 1 }, { id: "01-02", objective: "consume NewApi", wave: 2, depends: ["01-01"], consumes: [{ plan: "01-01", symbol: "NewApi" }] }];
const plan = (w, overrides = {}, rows = rowsOld) => runScript("gsd-plan", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: plannerResponder(w, { overrides, rows }) });
const labels = (r) => r.calls.map((c) => c.opts.label);
const architectWrites = (w, text, status = "complete") => () => { w.write(WIRING, text); return { status, sharedChanges: [], outlineChanges: [] }; };
const editContext = (w, text) => w.write(`${PHASE_DIR}/01-CONTEXT.md`, `<decisions>\n- **D-01:** ${text}\n</decisions>\n`);

test("G011 an architect that returns nothing after an input change fails; the WIRING.md of an earlier run does not stand in for it", async () => {
  const w = makeWorld({ files: archAgent, overlay: archOverlay });
  assert.equal((await plan(w, { architect: architectWrites(w, "Api: 01-01 -> 01-02 OldApi (old contract)\n") })).result.status, "planned");
  const stale = w.read(WIRING);
  editContext(w, "consume NewApi");
  const r = await plan(w, { architect: () => NULL("finished without a reply") }, rowsNew);
  assert.equal(r.result.status, "failed");
  assert.match(r.result.reason, /architect/);
  assert.equal(labels(r).filter((l) => l === "architect").length, 2);
  assert.equal(w.read(WIRING), stale);
  assert.equal(labels(r).some((l) => l.startsWith("plan-")), false);
});

test("G011 a null architect reply is retried once; the retry that completes and writes WIRING.md passes", async () => {
  const w = makeWorld({ files: archAgent, overlay: archOverlay });
  let calls = 0;
  const r = await plan(w, { architect: (p, o) => { calls++; return calls === 1 ? NULL("agent error: timeout") : architectWrites(w, "Api: 01-01 -> 01-02 OldApi\n")(p, o); } });
  assert.equal(r.result.status, "planned");
  assert.equal(labels(r).filter((l) => l === "architect").length, 2);
});

test("G011 a complete architect reply passes when the regenerated WIRING.md is identical to the old one", async () => {
  const w = makeWorld({ files: archAgent, overlay: archOverlay });
  assert.equal((await plan(w, { architect: architectWrites(w, "Api: 01-01 -> 01-02 OldApi\n") })).result.status, "planned");
  editContext(w, "consume NewApi");
  const r = await plan(w, { architect: architectWrites(w, "Api: 01-01 -> 01-02 OldApi\n") }, rowsNew);
  assert.equal(r.result.status, "planned");
  assert.equal(labels(r).filter((l) => l === "architect").length, 1);
});
