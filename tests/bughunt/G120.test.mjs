// Bug-hunt fix G120 (2026-10-23 hunt): the research stage of gsd-new-project writes fixed report paths, so two research
// runs of one project must not overlap; the second one is refused while the first holds the research lock.
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { SHIP_DIR } from "../helpers/temp.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld } from "../gsd-flows/world.mjs";

const { lock, unlock, lockCheck } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/flow-files.mjs")).href);
const doc = "# Project Research Summary\n## Executive Summary\na\n## Key Findings\nb\n## Implications for Roadmap\nc\n";

test("G120 a research run is refused while another research run holds the research lock, and holds it while it runs", async () => {
  const w = makeWorld({ files: { ".planning/PROJECT.md": "# P\n" } });
  const held = lock(w.root, "research", "wf_other", process.pid, "gsd-new-project");
  assert.equal(held.locked, true);
  const refused = await runScript("gsd-new-project", { root: w.root, gsd: w.gsd, args: { stage: "research" }, agent: (p, o) => (o.label === "synthesizer" ? doc : { written: [] }) });
  assert.deepEqual([refused.result.status, refused.calls.length], ["refused", 0]);
  assert.match(refused.result.reason, /another research run holds the research lock \(wf_other\)/);
  unlock(w.root, "research", held.token);
  let heldWhileRunning = null;
  const r = await runScript("gsd-new-project", { root: w.root, gsd: w.gsd, args: { stage: "research" }, agent: (p, o) => {
    heldWhileRunning = lockCheck(w.root, "research").held;
    return o.label === "synthesizer" ? doc : { written: [] };
  } });
  assert.equal(r.result.status, "researched");
  assert.equal(heldWhileRunning, true);
  assert.equal(lockCheck(w.root, "research").held, false);
});

test("G120 the research lock is released when the run fails, so the next run can start", async () => {
  const w = makeWorld({ files: { ".planning/PROJECT.md": "# P\n" } });
  const bare = await runScript("gsd-new-project", { root: w.root, gsd: w.gsd, args: { stage: "research" }, agent: (p, o) => (o.label === "synthesizer" ? "done" : { written: [] }) });
  assert.equal(bare.result.status, "failed");
  assert.equal(lockCheck(w.root, "research").held, false);
  const next = await runScript("gsd-new-project", { root: w.root, gsd: w.gsd, args: { stage: "research" }, agent: (p, o) => (o.label === "synthesizer" ? doc : { written: [] }) });
  assert.equal(next.result.status, "researched");
});
