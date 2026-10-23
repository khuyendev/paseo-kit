// G024: every GSD workflow runs its agents as the project agent type of their role (adapter.agents), and the generic
// GSD agent type only when the adapter maps no type for that role.
import assert from "node:assert/strict";
import test from "node:test";
import { NULL, runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR, planText } from "../gsd-flows/world.mjs";

const PROJECT_ROLES = ["debugger", "mapper", "research", "verifier", "project_researcher", "synthesizer", "roadmapper", "planner", "checker", "executor", "plan_finder", "plan_verifier", "plan_judge", "plan_editor"];
const MAPPED = Object.fromEntries(PROJECT_ROLES.map((role) => [role, `custom-${role.replaceAll("_", "-")}`]));
const GENERIC = { debugger: "gsd-debugger", mapper: "gsd-codebase-mapper", research: "gsd-phase-researcher", verifier: "gsd-verifier", project_researcher: "gsd-project-researcher", synthesizer: "gsd-research-synthesizer", roadmapper: "gsd-roadmapper", planner: "gsd-planner", checker: "gsd-plan-checker", executor: "gsd-executor", plan_editor: "gsd-planner" };
const UNMAPPED_BY_DEFAULT = ["plan_finder", "plan_verifier", "plan_judge"];

// One run of each workflow that starts GSD agents; every returned call carries its role.
async function everyWorkflow(overlay) {
  const runs = [];
  {
    const w = makeWorld({ overlay: { ...overlay, gsd: { debug: { max_turns: 3, minutes: 120 } } } });
    const s = { path: ".planning/debug/login-fails.md", frontmatter: { goal: "find_and_fix", owns: ["Path:src/login/"], budget_used: { turns: 0, minutes: 0 } } };
    w.gsd.on("debug status", () => ({ status: "investigating", path: s.path, frontmatter: s.frontmatter }));
    w.gsd.on("debug budget", () => ({ budget_used: s.frontmatter.budget_used }));
    w.gsd.on("debug checkpoint", () => ({ ok: true }));
    w.gsd.on("debug close", () => ({ closed: true }));
    runs.push(await runScript("gsd-debug", { root: w.root, gsd: w.gsd, args: { slug: "login-fails" }, agent: () => ({ status: "checkpoint", checkpoint: { id: "c1", type: "decision", question: "which?", options: ["a", "b"] } }) }));
  }
  {
    const w = makeWorld({ overlay: { ...overlay, gsd: { commit_policy: { docs: false, code: "per-wave" } } } });
    const body = Array.from({ length: 25 }, (_, i) => `line ${i}`).join("\n");
    runs.push(await runScript("gsd-map-codebase", { root: w.root, gsd: w.gsd, agent: (p, o) => { w.write(`.planning/codebase/${o.label}.md`, body); return { focus: o.label, written: [] }; } }));
  }
  {
    const w = makeWorld({ research: false, overlay });
    w.gsd.on("research prompt", () => ({ prompt: "<upstream research dispatch>", path: `${PHASE_DIR}/01-RESEARCH.md` }));
    runs.push(await runScript("gsd-research", { root: w.root, gsd: w.gsd, args: { phaseDir: PHASE_DIR }, agent: () => NULL("no report") }));
  }
  {
    const w = makeWorld({ overlay });
    runs.push(await runScript("gsd-verify", { root: w.root, gsd: w.gsd, args: { phaseDir: PHASE_DIR }, agent: () => ({ status: "passed" }) }));
  }
  {
    const w = makeWorld({ overlay, files: { ".planning/PROJECT.md": "# P\n" } });
    runs.push(await runScript("gsd-new-project", { root: w.root, gsd: w.gsd, args: { stage: "research" }, agent: (p, o) => (o.label === "synthesizer" ? "# Project Research Summary\n" : { written: [] }) }));
    runs.push(await runScript("gsd-new-project", { root: w.root, gsd: w.gsd, args: { stage: "roadmap" }, agent: () => ({ written: [] }) }));
  }
  {
    const w = makeWorld({ overlay, files: { ".planning/ROADMAP.md": "# R\n" } });
    const agent = (p, o) => {
      const plan = /Write ONE plan (\S+)/.exec(p)?.[1];
      if (plan) { w.write(plan, planText("q")); return { marker: "PLANNING COMPLETE" }; }
      if (o.label === "quick-exec") { w.write(/SUMMARY to exactly: (\S+)/.exec(p)[1], "done\n"); return { taskResults: [{ task: "1", status: "implemented" }] }; }
      return { issues: [] };
    };
    runs.push(await runScript("gsd-quick", { root: w.root, gsd: w.gsd, args: { description: "fix a | b", full: true }, agent }));
  }
  {
    const w = makeWorld({ overlay });
    w.write(`${PHASE_DIR}/01-01-PLAN.md`, planText("01-01"));
    let cycle = 0;
    runs.push(await runScript("gsd-plan-review", { root: w.root, gsd: w.gsd, args: { phaseDir: PHASE_DIR, plans: ["01-01"] }, agent: (p, o) => {
      if (o.label.startsWith("find-")) return cycle++ === 0 ? { issues: [{ plan: "01-01", severity: "high", actionable: true, description: "x", evidence: "y" }] } : { issues: [] };
      if (o.label.startsWith("verify-")) return { verdicts: [{ id: "C1-1-1", valid: true }] };
      if (o.label.startsWith("judge-")) return { decisions: [{ id: "C1-1-1", keep: true }] };
      if (o.label.startsWith("editor-")) return { marker: "REVISION COMPLETE" };
      return {};
    } }));
  }
  return runs.flatMap((r) => r.calls);
}

test("G024 with adapter.agents mapping every role, each GSD workflow runs the mapped agent type of its role", async () => {
  const calls = await everyWorkflow({ adapter: { agents: MAPPED } });
  const roles = new Set(calls.map((c) => c.opts.role));
  for (const role of PROJECT_ROLES) assert.ok(roles.has(role), `no agent call with role ${role}`);
  for (const c of calls) assert.equal(c.opts.agentType, MAPPED[c.opts.role], `${c.opts.label} (${c.opts.role}) runs ${c.opts.agentType}`);
});

test("G024 without adapter.agents, each GSD workflow keeps the generic agent type; plan review's finder, verifier and judge stay untyped", async () => {
  const calls = await everyWorkflow({});
  for (const c of calls) {
    if (UNMAPPED_BY_DEFAULT.includes(c.opts.role)) assert.equal(c.opts.agentType, undefined, `${c.opts.label} gets ${c.opts.agentType}`);
    else assert.equal(c.opts.agentType, GENERIC[c.opts.role], `${c.opts.label} (${c.opts.role})`);
  }
});
