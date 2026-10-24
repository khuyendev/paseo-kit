// THIN.md stage 2 for gsd-plan (TP, kit feedback 87): every agent prompt of gsd-plan is rendered by the flow verb `plan-prompt`
// from the kit templates `.agents/workflows/prompts/plan-*.md`. The text must be the one the script built inline before (thin/TI,
// fde400b), byte for byte: the journal keys an agent call by its prompt, so a run started before the change resumes with every
// finished call replayed. The reference builders below are that inline code, copied.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { main } from "../../ship/.agents/workflows/lib/gsd-flow.mjs";
import { dropEmpty, planPrompt, PROMPT_KINDS } from "../../ship/.agents/workflows/lib/flow-plan.mjs";
import { kitHelpers } from "../../ship/.agents/harness/workflow/script.mjs";
import { KIT_DIR, SHIP_DIR, makeTempDir } from "../helpers/temp.mjs";

const { PH, policyBlock, digestLine } = kitHelpers({ shell: null, agent: null });
const root = makeTempDir();

// ---- the inline prompt code of gsd-plan.js at fde400b ----
function reference(c) {
  const { N, phaseDir, nn } = c;
  const P = (name) => `${phaseDir}/${nn}-${name}`;
  const planPath = (id) => `${phaseDir}/${id}-PLAN.md`;
  const OUTLINE = P("PLAN-OUTLINE.md");
  const MANIFEST = P("PLAN-OUTLINE.manifest.json");
  const WIRING = P("WIRING.md");
  const POLICY = policyBlock(c.approvedResearch);
  const planningContext = (planMode) => [
    "<planning_context>",
    `Phase: ${N}${c.phaseName ? ` (${c.phaseName})` : ""}`,
    `Phase directory: ${phaseDir}`,
    `Mode: ${planMode}`,
    "Required reading (open these paths yourself):",
    "- .planning/STATE.md",
    "- .planning/ROADMAP.md",
    "- .planning/REQUIREMENTS.md",
    `- ${P("CONTEXT.md")} (user decisions: locked, do not revisit)`,
    c.approvedResearch ? `- ${c.approvedResearch} (approved research)` : "- research: NONE approved",
    `Phase requirement IDs: ${c.reqIds.length ? c.reqIds.join(", ") : "none declared"}`,
    `Project instruction files: ${(c.instructions ?? []).join(", ") || "none"}`,
    `Stack skill to follow: ${c.stackSkill ?? "none"}`,
    `TRACER_MODE: ${c.tracer}`,
    `REVERSIBILITY_GATES: ${c.reversibilityGates}`,
    "MVP_MODE: false",
    "WALKING_SKELETON: false",
    `Granularity: ${c.granularity}`,
    `Plan limits: ${c.planLimits.tasks_per_plan} tasks per plan, ${c.planLimits.plans_per_phase} plans per phase, ${c.planLimits.waves_per_phase} waves per phase`,
    ...(c.validationNote ? [c.validationNote] : []),
    "</planning_context>",
  ].join("\n");
  const SPECLESS = "<specless_edges>\nNo SPEC defines edge cases or prohibitions for this phase. List the edge cases you plan for in must_haves.truths and the must-not items in must_haves.prohibitions, or record `edges_skipped: <reason>` in the plan frontmatter. Never neither.\n</specless_edges>";
  const RETURN_NOTE = "Never ask the owner. Return JSON {marker, summary, question?, conflict?, plans?}: marker is one of OUTLINE COMPLETE, PLANNING COMPLETE, REVISION COMPLETE, or an owner marker (REVISION_CONFLICT, PHASE SPLIT RECOMMENDED, SOURCE AUDIT, CHECKPOINT REACHED, PLANNING INCONCLUSIVE) with the question or conflict. For PHASE SPLIT RECOMMENDED and SOURCE AUDIT, summary states the proposal and plans lists its options, one string each. An ownership-only SOURCE AUDIT also returns owns_changes [{path, from?, reason}] (from is the plan that owns the path now, and only when that plan is in another wave): the answer is ph gsd owns add or ph gsd owns handover, and only those plans are planned again. A new plan, wave, requirement or producer order has no owns_changes; it is an outline decision (ph gsd decide --outline). Do not commit; do not write STATE, ROADMAP or REQUIREMENTS.";
  const revisionContext = (plans, issues, contract = "") => ["<revision_context>", `Existing plans: ${plans.join(", ") || "none"}`, `Checker issues (JSON): ${JSON.stringify(issues)}`, "Instructions: revise in place only what the issues require. Answer every issue with one `changes` entry {issue, change}; when an issue contradicts a locked decision or another issue, return REVISION_CONFLICT with the conflict instead of guessing.", ...(contract ? [contract] : []), "</revision_context>"].join("\n");
  const CONTRACT_RULE = "The manifest owns every produced signature. Never change a produced signature in plan text, and keep every consumed signature quoted exactly as the manifest has it. When an issue can only be met by a different signature, leave the plan on the manifest signature and return marker CONTRACT_CHANGE with contract_changes: [{plan, symbol, old, new, reason}], one entry per symbol: the flow updates the manifest and has every consumer revised in this run. Return REVISION_CONFLICT when a consumer cannot follow. A symbol the manifest does not produce yet is an addition, not an outline change: the same list with old \"\" and file and kind set (file inside this plan's owns). ph gsd contracts change adds it and replans that plan and its consumers. A new plan, wave or requirement stays an outline decision (ph gsd decide --outline).";
  const contractBlock = (shows) => {
    if (!c.contractsOn) return "";
    const parts = [];
    for (const { id, show: s } of shows) {
      if (!s?.plan || !(s.produces?.some((p) => p.structured) || s.consumes?.some((x) => x.entry))) continue;
      const consumers = Object.fromEntries(Object.entries(s.consumers ?? {}).filter(([, list]) => list.length));
      parts.push(`${id} produces (manifest): ${JSON.stringify(s.produces.filter((p) => p.structured).map(({ symbol, kind, file, signature }) => ({ symbol, kind, file, signature })))}`, `${id} consumers per produced symbol: ${JSON.stringify(consumers)}`, `${id} consumes (producer manifest entries to quote): ${JSON.stringify(s.consumes.filter((x) => x.entry).map((x) => ({ plan: x.plan, ...x.entry })))}`);
    }
    return parts.length ? ["<contract_context>", ...parts, CONTRACT_RULE, "</contract_context>"].join("\n") : "";
  };
  const planner = (body, key, digest) => [body, POLICY, RETURN_NOTE, digestLine(key, digest)].join("\n\n");
  const threatOf = (id) => { const m = /^(\d+)-(\d+)$/.exec(String(id ?? "")); return m ? { range: `T-${m[1]}-${m[2]}xx`, example: `T-${m[1]}-${m[2]}01` } : null; };
  const threatPlan = (id) => { const t = threatOf(id); return t ? `Threat ids in this plan use only ${t.range} (for example ${t.example}). Any other T-<phase>-<number> id belongs to another plan.` : ""; };
  const threatList = (plans) => { const parts = (plans ?? []).map((p) => { const base = String(p).split("/").pop().replace(/-PLAN\.md$/, ""); const t = threatOf(base); return t ? `${base} ${t.range}` : null; }).filter(Boolean); return parts.length ? `Threat-id ranges (keep each plan inside its own; an id outside it belongs to another plan): ${parts.join(", ")}` : ""; };
  const threatCheck = (live) => { const parts = (live ?? []).map((id) => { const t = threatOf(id); return t ? `${id} ${t.range}` : null; }).filter(Boolean); return parts.length ? `Threat-id ranges (a threat id outside its plan's range is a blocker, dimension threat-id; the deterministic probe lists the ones it found, so do not repeat those): ${parts.join(", ")}` : ""; };
  const contractPlanText = (s) => {
    if (!c.contractsOn) return "";
    const mine = (s?.produces ?? []).filter((p) => p.structured).map(({ symbol, kind, file, signature }) => ({ symbol, kind, file, signature }));
    const used = (s?.consumes ?? []).filter((x) => x.entry).map((x) => ({ plan: x.plan, ...x.entry }));
    return [
      mine.length ? `Contract: this plan produces (write each signature verbatim in the plan and in <interfaces>; never re-describe or change it): ${JSON.stringify(mine)}` : "",
      used.length ? `Contract: this plan consumes (quote each signature verbatim in <interfaces>; call it only as written there): ${JSON.stringify(used)}` : "",
      "If this plan needs an ancestor widget, a provider override or a registration that another plan provides, list it in must_haves.key_links as `- requires: {kind: ancestor_widget|provider_override|registration, name: <name>, by: <plan id>}`; a plan that mounts or registers one lists `- provides: {kind: ..., name: ..., at: <file>}`. The provider is in the same or an earlier wave.",
      "A symbol this plan must produce that the manifest does not list is an addition, not an outline change: return REVISION_CONFLICT with contract_changes [{plan, symbol, old: \"\", new: the signature, file, kind, reason}] where file is inside owns.",
    ].filter(Boolean).join("\n");
  };
  return {
    outline: (d) => planner([planningContext("outline"), SPECLESS, `Write the phase outline ${OUTLINE} (table: Plan ID, Objective, Wave, Depends, Requirements; last line exactly \`## OUTLINE COMPLETE\`) and its manifest ${MANIFEST} ({phase, plans:[{id, owns, requirements, produces, consumes, tracer, verify}]}). Do not write PLAN files yet.`, "Each plan id NN-MM is assigned the threat-id range T-NN-MMxx (T-NN-MM plus exactly two digits). Do not write threat ids in the outline; the planner of that plan is told its range.", c.contractsOn ? "In the manifest `produces` lists every symbol another plan calls or builds on as {symbol, kind, file, signature}: file is inside the plan's owns, signature is the exact interface text the consumers will quote (a method, constructor, widget or provider as it will be written). `consumes` lists {plan, symbol} naming a symbol that plan produces. A precondition a plan needs from another (an ancestor widget, a provider override, a registration) is declared later in the plans as must_haves.key_links `requires`/`provides` entries." : "", `Before you return, run \`node ${PH} gsd ${d.checkArgs.join(" ")}\`, repair every error it reports in ${OUTLINE} and ${MANIFEST}, and run it again until it exits 0.`].filter(Boolean).join("\n\n"), "inputs", d.digest),
    "outline-fix": (d) => planner(`Fix ${OUTLINE} and ${MANIFEST} in place. outline check reported these errors (fix exactly these):\n${d.errors.map((e) => `- ${typeof e === "string" ? e : JSON.stringify(e)}`).join("\n")}`, "inputs", d.digest),
    revise: (d) => planner([planningContext("revision"), revisionContext(d.plans, d.issues, d.shows ? contractBlock(d.shows) : ""), threatList(d.plans)].filter(Boolean).join("\n\n"), d.key, d.digest),
    write: (d) => {
      const quotes = d.wiringText.split(/\r?\n/).filter((l) => l.includes(d.id)).slice(0, 40);
      return planner([planningContext("standard"), SPECLESS, `Write ${planPath(d.id)} for plan ${d.id} only.`, `Frozen manifest entry (${MANIFEST}): ${JSON.stringify(d.entry)}`, `owns (repeat exactly in the plan frontmatter): ${JSON.stringify(d.entry.owns ?? [])}`, d.wiringText ? `WIRING declarations for ${d.id} (verbatim from ${WIRING}):\n${quotes.map((l) => `> ${l}`).join("\n") || "> (none name this plan)"}` : "No WIRING contract for this phase.", d.carried.length ? `Open skeleton warnings for this plan:\n${d.carried.map((w) => `- ${w}`).join("\n")}` : "", contractPlanText(d.contract?.show), threatPlan(d.id)].filter(Boolean).join("\n\n"), "freeze", d.digest);
    },
    fix: (d) => planner([`Fix ${planPath(d.id)} in place. verify plan-structure reported exactly these errors:\n${d.errors.map((e) => `- ${typeof e === "string" ? e : JSON.stringify(e)}`).join("\n")}`, threatPlan(d.id)].filter(Boolean).join("\n\n"), "freeze", d.digest),
    realloc: (d) => planner([planningContext("revision"), revisionContext([OUTLINE, MANIFEST], d.sent.map(({ plan, probe, dimension, description }) => ({ plan, dimension: dimension || probe || "", severity: "blocker", description }))), `Reallocation ${d.round}: the plan checker sent ${d.named.join(", ")} back to the outline because ${d.named.length > 1 ? "their" : "its"} owned paths do not fit one plan${d.lines ? ` (plan size lines: warning at ${d.lines.warning}+, blocker at ${d.lines.blocker}+ files)` : ""}. Change only the allocation of ${d.named.join(", ")} in ${OUTLINE} and ${MANIFEST}: split a named plan into plans with their own ids (new ids after the last existing id, in a wave after the plans they depend on), or move owned paths to another plan that stays under the lines. Every other plan keeps its id, wave, owns, produces and consumes; keep requirement coverage, the tracer and the consumes edges valid, within ${c.planLimits.plans_per_phase} plans and ${c.planLimits.waves_per_phase} waves.`, `Before you return, run \`node ${PH} gsd ${d.checkArgs.join(" ")}\` and repair every error it reports until it exits 0.`].join("\n\n"), "inputs", d.digest),
    gaps: (d) => planner([planningContext("gap_closure"), "<gap_context>", `Verification report: ${P("VERIFICATION.md")} (status gaps_found). Gaps (JSON): ${JSON.stringify(d.gaps)}`, `Write one plan per gap group as ${phaseDir}/${nn}-<MM>-PLAN.md numbered from ${nn}-${String(d.nextNo).padStart(2, "0")}, each with frontmatter gap_closure: true and owns taken from the plans that own the gaps' files.`, "All gap plans form ONE execution wave: no dependencies between them.", d.kept.length ? `Gap plans already written by this attempt (keep them; write only the missing ones): ${d.kept.map(planPath).join(", ")}` : "", "</gap_context>"].filter(Boolean).join("\n"), "verification", d.digest),
    architect: (d) => [planningContext("wiring"), `Write only ${WIRING}: the wiring contract of the cross-plan edges of ${OUTLINE} (manifest ${MANIFEST}). ${d.why}`, "Return JSON {status: complete|conflict, sharedChanges[], outlineChanges[], conflicts[]}. outlineChanges are changes the outline must make; conflicts are contradictions only the owner can settle.", POLICY, digestLine("inputs", d.digest)].join("\n\n"),
    "skeleton-lane": (d) => [d.lens, `Review the skeleton of phase ${N}${c.goal ? ` (goal: ${c.goal})` : ""} read-only. Frozen snapshot: ${d.files.join(", ")}.`, `Requirement IDs: ${c.reqIds.join(", ") || "none"}. TRACER_MODE: ${c.tracer}.`, `Mechanical warnings: ${JSON.stringify(d.warnings)}. Cross-plan edges: ${JSON.stringify(d.edges)}.`, ...(d.focus ? [`Reallocation: the plan checker sent ${d.focus.named.join(", ")} back to the outline and the allocation of ${d.focus.changed.join(", ")} changed (owned paths split or moved). The rest of the skeleton passed review before: judge the changed plans and the edges to and from them.`] : []), "Return JSON {issues: [{plan, dimension, severity (blocker|warning|info), required_property, description, evidence, fix_hint, target (outline|wiring|both)}]}; an empty list when the skeleton holds under this lens.", POLICY, digestLine("freeze", d.digest)].join("\n\n"),
    "skeleton-resolve": (d) => [d.lens, `Resolution check, read-only, of your own open skeleton issues after a revision. Snapshot: ${d.files.join(", ")}.`, `Open issues (JSON): ${JSON.stringify(d.open.map(({ id, plan, required_property, description, fix_hint }) => ({ id, plan, required_property, description, fix_hint })))}`, "Return JSON {resolved: [{id, evidence}]} listing only the ids now resolved, each with evidence. Do not raise new issues; an id you do not list stays open.", POLICY, digestLine("freeze", d.digest)].join("\n\n"),
    checker: (d) => [
      `Check the plans of phase ${N} read-only: ${d.live.map(planPath).join(", ")}.`,
      planningContext(d.gapScoped ? "gap_closure" : "standard"),
      d.filesPerPlan ? `Files per plan: warning at ${d.filesPerPlan.warning}+, blocker at ${d.filesPerPlan.blocker}+ (use these for the Files/plan thresholds).` : "",
      d.filesPerPlan && d.tracerExtraFiles ? `Tracer files per plan (a plan with a type="tracer" task): warning at ${d.filesPerPlan.warning + d.tracerExtraFiles}+, blocker at ${d.filesPerPlan.blocker + d.tracerExtraFiles}+.` : "",
      d.sendBack ? `Files per plan is judged by a deterministic probe (${d.probeFile}): do not raise a Files/plan issue. Give an issue "outcome": "reallocate" only when its only fix is a different split of the owned paths between plans (the plan's owns, which a revision of the plan cannot change); every other issue has outcome "revise".` : "",
      `Deterministic probe results are in ${d.probeFile}: they are already counted; do not re-derive them, do not repeat them as issues.`,
      d.carried.length ? `Carried warnings:\n${d.carried.map((w) => `- ${w}`).join("\n")}` : "",
      d.earlier.length ? `Blockers from earlier checker iterations, still open? Judge each against the plans as they are now. Repeat it in issues (same plan, dimension and required_property) while it holds; list its id in resolved, with evidence, once it is fixed. An id you do not list stays open.\n${JSON.stringify(d.earlier.map(({ id, plan, dimension, required_property, description, fix_hint }) => ({ id, plan, dimension, required_property, description, fix_hint })))}` : "",
      threatCheck(d.live),
      "Return JSON {issues: [{plan (null for phase-level), dimension, severity (blocker|warning|info), required_property (the invariant that must hold), description (the evidence it does not), fix_hint}], resolved: [{id, evidence}] (only ids of the still-open blockers above)}.",
      POLICY, digestLine("freeze", d.freeze), digestLine("checked", d.checked),
    ].filter(Boolean).join("\n\n"),
    depcheck: (d) => [`Dependency check, read-only, of ${planPath(d.id)} after a revision of the plans it depends on: ${d.providers.map((p) => p.path).join(", ")}.`, `Their declared interface before and after the revision (JSON): ${JSON.stringify(d.providers)}`, "Read the providers as they are now. Return JSON {issues: [{plan, dimension, severity (blocker|warning|info), required_property, description, fix_hint}]}: one blocker for each place this plan still uses a name, signature, parameter, path or link the revision renamed, changed or removed; an empty list when it matches the providers as they are now.", POLICY, digestLine("freeze", d.freeze), digestLine(`plan:${d.id}`, d.planHash)].join("\n\n"),
    "join-resolve": (d) => [`Resolution check, read-only, of plan checker blockers after a revision of ${d.scope.map(planPath).join(", ")}.`, `Blockers (JSON): ${JSON.stringify(d.asked.map(({ id, plan, dimension, required_property, description, fix_hint }) => ({ id, plan, dimension, required_property, description, fix_hint })))}`, "Return JSON {resolved: [{id, evidence}]} listing only the ids the plans now resolve, each with evidence. Do not raise new issues; an id you do not list stays open.", POLICY, digestLine("freeze", d.freeze), digestLine(d.key, d.hash)].join("\n\n"),
  };
}

// The context of the old script and of the verb (the verb takes the Dimension 8 note as {skipped} or {path}).
const NOTE = {
  skipped: (why) => `Nyquist validation (checker Dimension 8): SKIPPED, ${why}. The checker reports "Dimension 8: SKIPPED (nyquist_validation disabled or not applicable)" and runs no check 8a-8e.`,
  path: (p) => `Nyquist validation (checker Dimension 8): applies; ${p} exists, so check 8e passes; run checks 8a-8d.`,
};
const BASE = { N: "1", nn: "01", phaseDir: ".planning/phases/01-core", phaseName: "Core", goal: "A working core", approvedResearch: ".planning/phases/01-core/01-RESEARCH.md", reqIds: ["R1", "R2"], instructions: ["CLAUDE.md"], stackSkill: ".claude/skills/stack/SKILL.md", tracer: true, reversibilityGates: true, granularity: "standard", planLimits: { tasks_per_plan: 3, plans_per_phase: 8, waves_per_phase: 4 }, contractsOn: true };
const CONTEXTS = [
  { ...BASE, validation: { path: ".planning/phases/01-core/01-VALIDATION.md" } },
  { ...BASE, phaseName: undefined, goal: undefined, approvedResearch: null, reqIds: [], instructions: [], stackSkill: null, tracer: false, reversibilityGates: false, contractsOn: false, validation: { skipped: "gsd.validation_strategy is off" } },
  { ...BASE, nn: "02.1", N: "2.1", phaseDir: ".planning/phases/02.1-hotfix", validation: { skipped: "no approved research in this run" } },
];
const asOld = (ctx) => ({ ...ctx, validationNote: ctx.validation?.skipped ? NOTE.skipped(ctx.validation.skipped) : ctx.validation?.path ? NOTE.path(ctx.validation.path) : null });

const SHOW = { plan: "01-01", produces: [{ symbol: "Repo", kind: "class", file: "lib/repo.dart", signature: "class Repo", structured: true }, { symbol: "x", structured: false }], consumes: [{ plan: "01-02", symbol: "Api", entry: { symbol: "Api", signature: "Api()" } }, { plan: "01-03", symbol: "y" }], consumers: { Repo: ["01-02"], Unused: [] } };
const ISSUE = { id: "open-1", plan: "01-01", dimension: "scope", required_property: "p", description: "d", fix_hint: "h", severity: "blocker", extra: 1 };
const CASES = {
  outline: [{ checkArgs: ["outline", "check", "1"], digest: "abc" }, { checkArgs: ["outline", "check", "1", "--tracer", "false"], digest: "none" }],
  "outline-fix": [{ errors: ["e1", { code: 2 }], digest: "abc" }, { errors: [], digest: "abc" }],
  revise: [
    { plans: [".planning/phases/01-core/01-01-PLAN.md"], issues: [ISSUE], shows: [{ id: "01-01", show: SHOW }], key: "freeze", digest: "f" },
    { plans: [], issues: [], shows: null, key: "inputs", digest: "i" },
    { plans: ["a", "b"], issues: [ISSUE], shows: [{ id: "01-02", show: { plan: "01-02", produces: [], consumes: [] } }, { id: "01-03", show: null }], key: "freeze", digest: "f" },
  ],
  write: [
    { id: "01-01", entry: { id: "01-01", owns: ["lib/a"] }, wiringText: "x 01-01 y\r\nother\n01-01 z", carried: ["skeleton L1-1 (01-01): w"], contract: { show: SHOW }, digest: "f" },
    { id: "01-02", entry: { id: "01-02" }, wiringText: "", carried: [], contract: null, digest: "f" },
    { id: "01-03", entry: { id: "01-03", owns: [] }, wiringText: "nothing here", carried: [], contract: { show: { produces: [], consumes: [] } }, digest: "none" },
  ],
  fix: [{ id: "01-01", errors: ["no <task>", { line: 3 }], digest: "f" }, { id: "01-01", errors: [], digest: "f" }],
  realloc: [
    { round: 1, named: ["01-02"], lines: { warning: 10, blocker: 15 }, sent: [{ plan: "01-02", probe: "files-per-plan", description: "too big" }], checkArgs: ["outline", "check", "1"], digest: "i" },
    { round: 2, named: ["01-02", "01-03"], lines: null, sent: [{ plan: "01-02", dimension: "scope", description: "d" }, { plan: "01-03", description: "e" }], checkArgs: ["outline", "check", "1"], digest: "i" },
  ],
  gaps: [{ gaps: [{ id: "G1" }], nextNo: 4, kept: ["01-04"], digest: "v" }, { gaps: [], nextNo: 12, kept: [], digest: "v" }],
  architect: [{ why: "Cover every consumes edge.", digest: "i" }],
  "skeleton-lane": [
    { lens: "Lens: fidelity. Follow the lens text in .agents/workflows/lenses/fidelity.md.", files: ["a", "b"], warnings: ["w"], edges: [{ plan: "01-02" }], focus: null, digest: "f" },
    { lens: "Lens: custom.\nline one\n\nline two", files: ["a"], warnings: [], edges: [], focus: { named: ["01-02"], changed: ["01-02", "01-04"] }, digest: "f" },
  ],
  "skeleton-resolve": [{ lens: "Lens: integration. x", files: ["a"], open: [ISSUE], digest: "f" }],
  checker: [
    { live: ["01-01", "01-02"], gapScoped: false, filesPerPlan: { warning: 8, blocker: 12 }, tracerExtraFiles: 2, sendBack: false, probeFile: "p.json", carried: ["w1", "w2"], earlier: [ISSUE], freeze: "f", checked: "c" },
    { live: [], gapScoped: true, filesPerPlan: null, tracerExtraFiles: 2, sendBack: true, probeFile: "p.json", carried: [], earlier: [], freeze: "f", checked: "none" },
    { live: ["01-01"], gapScoped: false, filesPerPlan: { warning: 8, blocker: 12 }, sendBack: false, probeFile: "p.json", carried: [], earlier: [], freeze: "f", checked: "c" },
  ],
  depcheck: [{ id: "01-02", providers: [{ plan: "01-01", path: ".planning/phases/01-core/01-01-PLAN.md", before: { a: 1 }, after: { a: 2 } }], freeze: "f", planHash: "p" }],
  "join-resolve": [{ scope: ["01-01"], asked: [ISSUE], freeze: "f", key: "plan:01-01", hash: "h" }, { scope: ["01-01", "01-02"], asked: [ISSUE], freeze: "f", key: "checked", hash: "none" }],
};

test("TP every gsd-plan prompt kind renders the text the script built inline before, byte for byte", () => {
  assert.deepEqual([...PROMPT_KINDS].sort(), Object.keys(CASES).sort());
  let n = 0;
  for (const ctx of CONTEXTS) {
    const ref = reference(asOld(ctx));
    for (const [kind, list] of Object.entries(CASES)) {
      for (const given of list) {
        // As gsd-plan sends them: a plan's contract show and a reviser's shows only with gsd.contract_check on.
        const data = { ...given, ...(kind === "write" ? { contract: ctx.contractsOn ? given.contract ?? { show: null } : null } : {}), ...(kind === "revise" ? { shows: ctx.contractsOn ? given.shows : null } : {}) };
        const got = planPrompt(root, kind, JSON.parse(JSON.stringify({ ctx, ...data }))).text;
        assert.equal(got, ref[kind](data), `${kind} ${JSON.stringify(data).slice(0, 80)}`);
        n++;
      }
    }
  }
  assert.ok(n >= 3 * 24, `${n} prompts compared`);
});

test("TP plan templates leave out an empty optional paragraph or line, never the whole template", () => {
  assert.equal(dropEmpty("a\n\n{{x}}\n\nb", { x: "" }), "a\n\nb");
  assert.equal(dropEmpty("{{x}}\n\nb", { x: "" }), "b");
  assert.equal(dropEmpty("a\n\n{{x}}", { x: "" }), "a");
  assert.equal(dropEmpty("a\n\nTitle:\n{{x}}\n\nb", { x: "" }), "a\n\nb");
  assert.equal(dropEmpty("a\nline {{x}} and {{y}}\nb", { x: "", y: "" }), "a\nb");
  assert.equal(dropEmpty("a\nline {{x}} and {{y}}\nb", { x: "", y: "1" }), "a\nline {{x}} and {{y}}\nb");
  assert.equal(dropEmpty("one {{x}}\ntwo", { x: "" }), "two");
  assert.equal(dropEmpty("no vars\n\nat all", {}), "no vars\n\nat all");
});

test("TP plan-prompt is a flow verb: an unknown kind or a missing ctx fails with exit 1", async () => {
  const run = async (argv, input) => {
    const lines = [];
    const code = await main(argv, { root, input: JSON.stringify(input), out: (l) => lines.push(l) });
    return { code, json: JSON.parse(lines.at(-1)) };
  };
  const ok = await run(["plan-prompt", "architect"], { ctx: CONTEXTS[0], why: "w", digest: "d" });
  assert.equal(ok.code, 0);
  assert.equal(ok.json.text, reference(asOld(CONTEXTS[0])).architect({ why: "w", digest: "d" }));
  const bad = await run(["plan-prompt", "sonnet"], { ctx: CONTEXTS[0] });
  assert.equal(bad.code, 1);
  assert.match(bad.json.error, /unknown plan prompt 'sonnet'; one of outline/);
  const noCtx = await run(["plan-prompt", "architect"], { why: "w" });
  assert.equal(noCtx.code, 1);
  assert.match(noCtx.json.error, /needs ctx/);
});

test("TP the plan templates are kit parts with a contract comment, and gsd-plan.js holds none of their texts", () => {
  const kit = JSON.parse(fs.readFileSync(path.join(KIT_DIR, "kit.json"), "utf8"));
  const units = JSON.stringify(kit);
  const dir = path.join(SHIP_DIR, ".agents", "workflows", "prompts");
  const plan = fs.readdirSync(dir).filter((f) => f.startsWith("plan-"));
  assert.ok(plan.length >= 20, plan.join(", "));
  assert.ok(units.includes('".agents/workflows/lib/flow-plan.mjs"'));
  const script = fs.readFileSync(path.join(SHIP_DIR, ".agents", "workflows", "gsd-plan.js"), "utf8");
  for (const f of plan) {
    assert.ok(units.includes(`".agents/workflows/prompts/${f}"`), `${f} is a kit.json unit`);
    const text = fs.readFileSync(path.join(dir, f), "utf8");
    assert.match(text, /^<!--[\s\S]*?-->/, `${f} starts with its contract comment`);
    // The longest literal run of each template (between variables) is not in the composition any more.
    const body = text.replace(/^<!--[\s\S]*?-->\r?\n/, "");
    const longest = body.split(/\{\{[A-Za-z_]\w*\}\}/).flatMap((s) => s.split(/\r?\n/)).sort((x, y) => y.length - x.length)[0];
    if (longest.length > 40) assert.equal(script.includes(longest), false, `${f}: "${longest.slice(0, 60)}" is still in gsd-plan.js`);
  }
});
