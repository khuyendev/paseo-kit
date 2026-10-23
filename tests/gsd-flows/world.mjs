// A fake `ph gsd` backed by a temp project: verbs read and write the project's files the way the real verbs
// would for the cases the flow tests need (contracts of GSDC-24..30 and GSDC-34, simplified).
import fs from "node:fs";
import path from "node:path";
import { makeTempProject } from "../helpers/temp.mjs";
import { FakeGsd } from "./host.mjs";

export const PHASE_DIR = ".planning/phases/01-core";

const digest = (text) => `d${[...String(text)].reduce((s, c) => (s * 33 + c.charCodeAt(0)) >>> 0, 5381).toString(16)}`;

export function outlineText(rows) {
  return ["| Plan ID | Objective | Wave | Depends | Requirements |", "| --- | --- | --- | --- | --- |",
    ...rows.map((r) => `| ${r.id} | ${r.objective ?? "do it"} | ${r.wave ?? 1} | ${(r.depends ?? []).join(",") || "-"} | ${(r.requirements ?? ["R-1"]).join(",")} |`),
    "", "## OUTLINE COMPLETE", ""].join("\n");
}

export function planText(id, { wave = 1, gap = false, depends = [] } = {}) {
  return `---\nphase: 1\nplan: ${id}\nwave: ${wave}\ndepends_on: [${depends.join(", ")}]\n${gap ? "gap_closure: true\n" : ""}---\n<tasks><task><name>t</name><automated>cmd: node -v</automated></task></tasks>\n`;
}

// opts: {files, overlay, status, research (true = complete report), verification}
export function makeWorld(opts = {}) {
  const project = makeTempProject({
    files: { [`${PHASE_DIR}/01-CONTEXT.md`]: "<decisions>\n- **D-01:** keep it small\n</decisions>\n", ...(opts.research === false ? {} : { [`${PHASE_DIR}/01-RESEARCH.md`]: "research\n" }), ...(opts.files ?? {}) },
    // Kit feedback 72: the flow tests written for the fresh-review cycle keep it; the tests of the resolve check set `plan_review_check` themselves.
    overlay: { ...opts.overlay, gsd: { plan_review_check: "fresh", ...opts.overlay?.gsd } },
  });
  const P = (rel) => path.join(project.root, rel);
  const read = (rel) => (fs.existsSync(P(rel)) ? fs.readFileSync(P(rel), "utf8") : "");
  const write = (rel, text) => { fs.mkdirSync(path.dirname(P(rel)), { recursive: true }); fs.writeFileSync(P(rel), text, "utf8"); };
  const phaseFile = (name) => `${PHASE_DIR}/01-${name}`;
  const planIdsOnDisk = () => (fs.existsSync(P(PHASE_DIR)) ? fs.readdirSync(P(PHASE_DIR)).filter((f) => /^01-\d+-PLAN\.md$/.test(f)).map((f) => f.replace("-PLAN.md", "")).sort() : []);
  const manifest = () => { try { return JSON.parse(read(phaseFile("PLAN-OUTLINE.manifest.json"))); } catch { return null; } };
  const rows = () => read(phaseFile("PLAN-OUTLINE.md")).split("\n").filter((l) => /^\| 01-\d+/.test(l)).map((l) => {
    const c = l.split("|").map((s) => s.trim());
    return { id: c[1], objective: c[2], wave: Number(c[3]), depends: c[4] === "-" ? [] : c[4].split(",") };
  });
  const keyText = {
    research: () => read(phaseFile("CONTEXT.md")),
    inputs: () => read(phaseFile("CONTEXT.md")) + read(phaseFile("RESEARCH.md")),
    freeze: () => keyText.inputs() + read(phaseFile("PLAN-OUTLINE.md")) + read(phaseFile("PLAN-OUTLINE.manifest.json")) + read(phaseFile("WIRING.md")),
    skeleton: () => read(phaseFile("SKELETON-LANES.json")) + read(".agents/agents/gsd-skeleton-reviewer.md"),
    checked: () => planIdsOnDisk().map((id) => read(`${PHASE_DIR}/${id}-PLAN.md`)).join(""),
    handoff: () => keyText.checked(),
  };
  // As the real keyHash: the --settings digest of the verb is part of the key (G017).
  const hashOf = (key, settings = "") => digest(settings + (key.startsWith("plan:") ? read(`${PHASE_DIR}/${key.slice(5)}-PLAN.md`) : keyText[key]()));
  const settingsArg = (args) => (args.includes("--settings") ? args[args.indexOf("--settings") + 1] : undefined);
  const recorded = new Map();
  const attempts = {};
  const world = { project, root: project.root, read, write, recorded, attempts, events: [], probes: {}, coverage: { passed: true }, status: opts.status ?? "PLANNED", verification: opts.verification ?? null };
  const ev = (e) => world.events.push(e);
  world.gsd = new FakeGsd({
    "find-phase": () => ({ found: true, status: world.status, directory: PHASE_DIR }),
    "research status": () => (read(phaseFile("RESEARCH.md")) ? { code: 0, json: { status: "complete" } } : { code: 66, json: { status: "missing" } }),
    "roadmap get-phase": () => ({ found: true, phase_number: "1", phase_name: "Core", goal: "core works", requirements: ["R-1"] }),
    "revisions hash": (args) => ({ hash: hashOf(args[1], settingsArg(args)) }),
    "revisions check": (args) => {
      const key = args[1];
      const hash = hashOf(key, settingsArg(args));
      return !recorded.has(key) ? { code: 66, json: { status: "never" } } : recorded.get(key) === hash ? { code: 0, json: { same: true } } : { code: 1, json: { same: false } };
    },
    "revisions record": (args) => { recorded.set(args[1], hashOf(args[1], settingsArg(args))); ev(`record ${args[1]}`); return { recorded: args[1] }; },
    "outline parse": () => {
      const text = read(phaseFile("PLAN-OUTLINE.md"));
      if (!text) return { code: 66, json: { exists: false } };
      return { exists: true, complete: text.includes("## OUTLINE COMPLETE"), rows: rows(), manifest: manifest() };
    },
    "outline check": () => {
      const text = read(phaseFile("PLAN-OUTLINE.md"));
      const m = manifest();
      const errors = world.outlineErrors?.shift?.() ?? [];
      if (!text.includes("## OUTLINE COMPLETE")) errors.push("no outline or marker");
      const crossPlan = (m?.plans ?? []).flatMap((p) => (p.consumes ?? []).map((c) => ({ plan: p.id, from: c.plan, symbol: c.symbol })));
      return { code: errors.length ? 1 : 0, json: { passed: !errors.length, errors, warnings: [], crossPlan, needsWiring: crossPlan.length > 0, rows: rows() } };
    },
    supersede: () => ({ moved: [] }),
    "verify plan-structure": ([file]) => {
      const text = read(file);
      const errors = world.structureErrors?.[file]?.shift?.() ?? (text.includes("<task") ? [] : ["no <task>"]);
      return { code: errors.length ? 1 : 0, json: { valid: !errors.length, errors } };
    },
    "check verify-command-paths": () => world.probes.vcp ?? { probes: [] },
    "check verify-failure-directions": () => world.probes.vfd ?? { findings: [] },
    "check owns": () => world.probes.owns ?? { problems: [] },
    // Kit feedback 67: no manifest contracts in these worlds unless a test installs its own handlers.
    "verify contracts": () => ({ passed: true, errors: [], warnings: [] }),
    "contracts show": () => ({ code: 66, json: { status: "missing" } }),
    "check coverage": () => (world.coverage.passed ? { passed: true } : { code: 1, json: world.coverage }),
    handoff: (argv) => { ev(`handoff ${argv.slice(1).join(" ")}`.trim()); return world.handoff ?? { planRevision: "rev1", waves: [{ wave: 1, file: `${PHASE_DIR}/handoff/w1.args.json` }], sharedChanges: [] }; },
    "state planned-phase": (argv) => { ev(`state planned-phase ${argv.join(" ")}`); return { updated: ["status"] }; },
    "state override": (argv, input) => { ev(`state override ${input}`); return { updated: ["overrides"] }; },
    "roadmap annotate-dependencies": () => { ev("annotate"); return { changed: true }; },
    write: ([dir, name], input) => { write(`${dir}/01-${name}.md`, input); ev(`write ${name}`); return { written: `${dir}/01-${name}.md` }; },
    commit: (argv) => { ev(`commit ${argv.join(" ")}`); return { committed: true, hash: "abc" }; },
    "phase-plan-index": () => ({ plans: planIdsOnDisk().map((id) => {
      const t = read(`${PHASE_DIR}/${id}-PLAN.md`);
      return { id, wave: Number(/wave: (\d+)/.exec(t)?.[1] ?? 1), gap_closure: /gap_closure: true/.test(t), depends_on: (/depends_on: \[(.*)\]/.exec(t)?.[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean), has_summary: Boolean(read(`${PHASE_DIR}/${id}-SUMMARY.md`)) };
    }) }),
    "verification status": () => world.verification ?? { code: 66, json: { status: "missing" } },
    "attempt show": (argv) => { const k = argv[argv.indexOf("--kind") + 1]; return attempts[k] ? attempts[k] : { code: 66, json: { none: true } }; },
    "attempt record": (argv, input) => {
      const k = argv[argv.indexOf("--kind") + 1];
      const req = JSON.parse(input);
      const cur = attempts[k];
      // As the real verb: continuing the same attempt overwrites before, done and result when given.
      if (cur && cur.runId === req.runId && cur.inputDigest === req.inputDigest) Object.assign(cur, { abandonedNow: null }, req.before !== undefined ? { before: req.before } : {}, req.done ? { done: true, result: req.result } : {});
      else attempts[k] = { key: digest(`${k}|${req.inputDigest}|${req.runId}`), runId: req.runId, inputDigest: req.inputDigest, before: req.before, done: Boolean(req.done), result: req.result ?? null, abandoned: cur && !cur.done ? [...cur.abandoned, { key: cur.key }] : [], abandonedNow: cur && !cur.done ? cur.key : null };
      ev(`attempt ${k}${req.done ? " done" : ""}`);
      return attempts[k];
    },
  });
  return world;
}

// Default planner/reviewer/checker responder for a 2-plan, 2-wave phase; tests override per label.
export function plannerResponder(world, { rows = [{ id: "01-01", wave: 1 }, { id: "01-02", wave: 2, depends: ["01-01"] }], overrides = {} } = {}) {
  return async (prompt, o, n, calls) => {
    const label = o.label ?? "";
    for (const [prefix, fn] of Object.entries(overrides)) if (label.startsWith(prefix)) { const v = await fn(prompt, o, n, calls); if (v !== undefined) return v; }
    if (label === "outline" || label.startsWith("outline-")) {
      world.write(`${PHASE_DIR}/01-PLAN-OUTLINE.md`, outlineText(rows) + (label === "outline" ? "" : `\n<!-- ${label} -->\n`));
      world.write(`${PHASE_DIR}/01-PLAN-OUTLINE.manifest.json`, JSON.stringify({ phase: "1", plans: rows.map((r) => ({ id: r.id, owns: [`Path:src/${r.id}/`], requirements: ["R-1"], consumes: r.consumes ?? [] })) }));
      return { marker: "## OUTLINE COMPLETE" };
    }
    if (label.startsWith("plan-")) {
      const id = label.slice(5);
      const row = rows.find((r) => r.id === id) ?? {};
      world.write(`${PHASE_DIR}/${id}-PLAN.md`, planText(id, { wave: row.wave, depends: row.depends }));
      return { marker: "## PLANNING COMPLETE" };
    }
    if (label.startsWith("skeleton-") || label.startsWith("checker-")) return { issues: [] };
    if (label.startsWith("resolve-")) return { resolved: [] };
    return { marker: "## REVISION COMPLETE" };
  };
}
