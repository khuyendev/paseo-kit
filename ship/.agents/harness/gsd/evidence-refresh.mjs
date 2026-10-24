// ph gsd evidence.refresh <phase> (kit feedback 111 F1): rerun the phase's batch gate on HEAD.
// The plans, obligations and suite come from handoff/w*.args.json (not the gap handoff). A live
// phase lease refuses the verb; nothing is written. The new evidence path is printed either way.
import fs from "node:fs";
import path from "node:path";
import { readJson } from "../lib/io.mjs";
import { toSlash } from "../lib/paths.mjs";
import { done, fail, rel } from "./common.mjs";
import { requirePhase } from "./planning.mjs";

const WAVE_FILE = /^w(\d+)\.args\.json$/;

// The phase handoff waves, in order. Gap waves (gap-w*) are a later closure, not this batch.
function handoffWaves(root, phase) {
  const dir = path.join(phase.dir, "handoff");
  const where = rel(root, dir);
  if (!fs.existsSync(dir)) throw fail(`evidence refresh: ${where} is missing; plan the phase first (handoff/w*.args.json)`);
  const files = fs.readdirSync(dir)
    .map((name) => { const m = WAVE_FILE.exec(name); return m ? { name, k: Number(m[1]) } : null; })
    .filter(Boolean)
    .sort((a, b) => a.k - b.k);
  if (!files.length) throw fail(`evidence refresh: ${where} has no w*.args.json (a gap-w* handoff is not the phase batch); plan the phase first`);
  const plans = [];
  for (const f of files) {
    const abs = path.join(dir, f.name);
    let h;
    try { h = readJson(abs); } catch (e) { throw fail(`${where}/${f.name} is not valid handoff JSON: ${e.message}`); }
    if (!h || !Array.isArray(h.tasks)) throw fail(`${where}/${f.name} has no tasks array`);
    for (const t of h.tasks) {
      if (!t || typeof t.plan !== "string" || !t.plan) throw fail(`${where}/${f.name} has a task without a plan id`);
      plans.push({ id: t.plan, owns: Array.isArray(t.owns) ? t.owns : [], verify: Array.isArray(t.verify) ? t.verify : [] });
    }
  }
  if (!plans.length) throw fail(`evidence refresh: ${where} names no plan`);
  return plans;
}

function obligationLine(plan, ob) {
  const kind = typeof ob?.kind === "string" && ob.kind ? ob.kind : "obligation";
  const cmd = typeof ob?.command === "string" ? ob.command : "";
  return `${plan.id} ${kind}${cmd ? ` ${cmd}` : ""}`;
}

export async function evidenceRefresh(g, phaseRef) {
  const phase = requirePhase(g.codeRoot, phaseRef);
  const { lockCheck } = await import("../../workflows/lib/flow-files.mjs");
  const held = lockCheck(g.codeRoot, `phase-${phase.padded}`);
  if (held.held) {
    const who = held.holderKind ? `a ${held.holderKind} run` : "a run";
    throw fail(`evidence refresh refused: ${who} of phase ${phase.number} is live (${held.holder}); wait for it to end, then rerun ph gsd evidence refresh ${phase.number}`);
  }
  const plans = handoffWaves(g.codeRoot, phase);
  const obligations = plans.flatMap((p) => p.verify.map((ob) => obligationLine(p, ob)));
  const phaseDir = toSlash(path.relative(g.codeRoot, phase.dir));
  const { gate } = await import("../../workflows/lib/flow-gate.mjs");
  const result = await gate(g.codeRoot, phaseDir, { waveId: "batch", plans });
  const cmds = g.cfg.adapter.commands;
  const suite = {
    gates: (cmds.gates ?? []).map((x) => x.name),
    build: cmds.build ?? null,
    test: result.testCommand ?? cmds.test ?? null,
  };
  const argv = (v) => (Array.isArray(v) ? v.join(" ") : "not configured");
  const lines = [
    `evidence refresh phase ${phase.number}: batch gate on HEAD`,
    `plans: ${plans.map((p) => p.id).join(", ")}`,
    `obligations: ${obligations.length ? obligations.join("; ") : "none"}`,
    `suite: gates ${suite.gates.length ? suite.gates.join(", ") : "none"}; build ${argv(suite.build)}; test ${argv(suite.test)}`,
    `evidence: ${result.evidence} (${result.green ? "green" : `red, ${result.failureCount} failure(s)`})`,
  ];
  g.write(`${lines.join("\n")}\n`);
  return done({
    refreshed: true,
    phase: phase.number,
    waveId: "batch",
    plans: plans.map((p) => p.id),
    obligations,
    suite,
    evidence: result.evidence,
    green: result.green,
    failureCount: result.failureCount,
  }, result.green ? 0 : 1);
}
