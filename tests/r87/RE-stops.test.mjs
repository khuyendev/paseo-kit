// Kit feedback #87 part B for planning (RE): every needs-owner stop of gsd-plan names its answer (`answer: {verb, command, args?}`):
// forceProceed or reviewGuidance args, a rerun with other args, a decision in CONTEXT, another workflow, or a fix and a rerun. The
// static test enumerates every stop of the script; the driven ones check an answer holds what the owner needs to give it.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { SHIP_DIR } from "../helpers/temp.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR, plannerResponder } from "../gsd-flows/world.mjs";

const SCRIPT = path.join(SHIP_DIR, ".agents/workflows/gsd-plan.js");
const VERBS = ["forceProceed", "reviewGuidance", "args", "context", "workflow", "fix-and-rerun", "rerun"];

// The text of the call whose "(" is at `open`: strings, template literals (with ${...}) and comments are skipped while counting.
function callText(src, open) {
  let depth = 0;
  const tpl = [];
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (tpl.length && tpl[tpl.length - 1] === "`") {
      if (ch === "\\") i++;
      else if (ch === "`") tpl.pop();
      else if (ch === "$" && src[i + 1] === "{") { tpl.push("{"); i++; }
      continue;
    }
    if (ch === "'" || ch === '"') {
      for (i++; i < src.length && src[i] !== ch; i++) if (src[i] === "\\") i++;
      continue;
    }
    if (ch === "`") { tpl.push("`"); continue; }
    if (ch === "/" && src[i + 1] === "/") { i = src.indexOf("\n", i); continue; }
    if (ch === "{" && tpl.length) { tpl.push("{"); continue; }
    if (ch === "}" && tpl.length && tpl[tpl.length - 1] === "{") { tpl.pop(); continue; }
    if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error(`unbalanced call at ${open}`);
}

// Every stop of the script: owner(...), needsOwner(...), result("needs-owner", ...) and ownerStop(...), with its line.
function stops() {
  const src = fs.readFileSync(SCRIPT, "utf8");
  const out = [];
  for (const m of src.matchAll(/\b(owner|needsOwner|ownerStop)\(|\bresult\("needs-owner"/g)) {
    const open = m.index + m[0].indexOf("(");
    const text = callText(src, open);
    const line = src.slice(0, m.index).split("\n").length;
    const lineText = src.split("\n")[line - 1];
    // The generic helpers themselves: owner() builds the result, ownerStop is checked by its own definition below.
    if (/^const owner = \(stage, reason, extra = \{\}\) => result\("needs-owner"/.test(lineText) && m[0].startsWith("result")) continue;
    out.push({ kind: m[1] ?? "result", line, text, lineText });
  }
  return out;
}
const hasAnswer = (text) => /[{,]\s*answer\s*[:,}]/.test(text);

test("RE every needs-owner stop of gsd-plan names its answer", () => {
  const all = stops();
  assert.ok(all.length >= 35, `found ${all.length} stops; the scan lost some`);
  const missing = all.filter((s) => s.kind !== "ownerStop" && !hasAnswer(s.text)).map((s) => `${s.line}: ${s.lineText.trim().slice(0, 120)}`);
  assert.deepEqual(missing, [], "stops without an answer");
  const helper = all.find((s) => /^const ownerStop = /.test(s.lineText));
  assert.ok(helper && hasAnswer(helper.text), "ownerStop (a planner's owner marker) names its answer");
  const src = fs.readFileSync(SCRIPT, "utf8");
  for (const verb of VERBS) assert.ok(src.includes(`verb: "${verb}"`), `answer verb ${verb} is built by the answers helper`);
});

const plan = (w, args = {}, overrides = {}) => runScript("gsd-plan", { root: w.root, args: { phaseDir: PHASE_DIR, ...args }, gsd: w.gsd, agent: plannerResponder(w, { overrides }) });
const shape = (r) => {
  assert.equal(r.result.status, "needs-owner", JSON.stringify(r.result));
  const { answer } = r.result;
  assert.ok(answer && VERBS.includes(answer.verb) && typeof answer.command === "string" && answer.command.includes("gsd-plan"), JSON.stringify(answer));
  return answer;
};
const blocker = (plan, dimension) => ({ plan, dimension, severity: "blocker", required_property: dimension, description: `${plan} ${dimension} broken` });

test("RE a checker stop at the cap answers forceProceed with the stuck issues, and a new run with those args proceeds", async () => {
  const w = makeWorld();
  const stuck = { "checker-": () => ({ issues: [blocker("01-01", "scope_sanity"), blocker("01-02", "key_links")] }) };
  const r = await plan(w, { maxCheckIterations: 1 }, stuck);
  const answer = shape(r);
  assert.equal(answer.verb, "forceProceed");
  assert.deepEqual(answer.args.forceProceed.issues, [{ plan: "01-01", dimension: "scope_sanity" }, { plan: "01-02", dimension: "key_links" }]);
  // The answer: the owner's reason with the named issues. The plans are kept, so a new run may accept them (F40).
  const ok = await plan(w, { maxCheckIterations: 1, forceProceed: { ...answer.args.forceProceed, reason: "the owner accepts both" } }, stuck);
  assert.equal(ok.result.status, "planned", JSON.stringify(ok.result));
  assert.deepEqual(ok.result.override.accepted.map((x) => [x.plan, x.dimension]), [["01-01", "scope_sanity"], ["01-02", "key_links"]]);
});

test("RE forceProceed that does not cover a stuck issue answers with the named issues and the uncovered one", async () => {
  const w = makeWorld();
  const stuck = { "checker-": () => ({ issues: [blocker("01-01", "scope_sanity"), blocker("01-02", "key_links")] }) };
  const r = await plan(w, { maxCheckIterations: 1, forceProceed: { reason: "size only", issues: [{ plan: "01-01", dimension: "scope_sanity" }] } }, stuck);
  const answer = shape(r);
  assert.equal(answer.verb, "forceProceed");
  assert.deepEqual(answer.args.forceProceed.issues, [{ plan: "01-01", dimension: "scope_sanity" }, { plan: "01-02", dimension: "key_links" }]);
});

test("RE the stops before planning answer with the workflow or the args that let the run go on", async () => {
  const noResearch = makeWorld({ research: false });
  const research = shape(await plan(noResearch));
  assert.deepEqual([research.verb, /gsd-research 01/.test(research.command)], ["workflow", true]);
  const reason = shape(await plan(noResearch, { skipResearch: true, researchSkipReason: " " }));
  assert.deepEqual([reason.verb, Object.keys(reason.args)], ["args", ["researchSkipReason"]]);
  const discuss = shape(await plan(makeWorld({ files: { [`${PHASE_DIR}/01-DISCUSS-CHECKPOINT.json`]: "{}" } })));
  assert.deepEqual([discuss.verb, /gsd-discuss 01/.test(discuss.command)], ["workflow", true]);
});

test("RE an owner marker, a skeleton stall and a coverage failure name a CONTEXT decision or a replan", async () => {
  const marker = shape(await plan(makeWorld(), {}, { outline: () => ({ marker: "## PHASE SPLIT RECOMMENDED", question: "split?" }) }));
  assert.equal(marker.verb, "context");
  const stall = shape(await plan(makeWorld(), {}, { "skeleton-": () => ({ issues: [{ plan: "01-01", severity: "blocker", description: "no tracer", target: "outline" }] }) }));
  assert.equal(stall.verb, "context");
  const w = makeWorld();
  w.coverage = { passed: false, decisions: { uncovered: ["D-02"] } };
  const coverage = shape(await plan(w));
  assert.deepEqual([coverage.verb, coverage.args], ["args", { replan: true }]);
});
