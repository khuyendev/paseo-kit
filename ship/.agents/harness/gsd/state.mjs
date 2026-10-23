// STATE.md (GSDC-10, GSDC-11) and the single writer of PROJECT/STATE/ROADMAP/REQUIREMENTS (GSDC-12, INV-38):
// every mutation takes STATE.md.lock and re-derives the STATE frontmatter from disk afterwards.
import fs from "node:fs";
import path from "node:path";
import { writeTextAtomic } from "../lib/io.mjs";
import { done, fail, lf, nowIso, readIf, today } from "./common.mjs";
import { headOf } from "./git.mjs";
import { findPhase, planIds, planningDir, sharedFile, summaryIds } from "./planning.mjs";
import { loadRoadmap, roadmapPhase } from "./roadmap.mjs";
import { phaseStatus } from "./status.mjs";
import { frontmatter } from "./yaml.mjs";

export const STATE_VERSION = 1;
export const STATUS_WORDS = ["Ready to plan", "Planning", "Ready to execute", "In progress", "Verifying", "Phase complete", "All phases complete"];
export const SECTIONS = ["Project Reference", "Current Position", "Decisions", "Models", "Owner rules", "Overrides", "Wave log", "Current state"];
const LOCK_STALE_MS = 10000;
const LOCK_WAIT_MS = 30000;

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Exclusive-create lock; a lock older than 10 s is stale and taken over.
export function withStateLock(root, fn) {
  fs.mkdirSync(planningDir(root), { recursive: true });
  const lock = `${sharedFile(root, "STATE.md")}.lock`;
  const start = Date.now();
  for (;;) {
    try {
      fs.writeFileSync(lock, `${process.pid}\n`, { flag: "wx" });
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) fs.rmSync(lock, { force: true });
      } catch {
        // removed by its holder meanwhile
      }
      if (Date.now() - start > LOCK_WAIT_MS) throw fail(`STATE.md.lock is held (${lock})`);
      pause(25 + Math.floor(Math.random() * 50));
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

export function guardWriter(env) {
  if (String(env.PASEO_HARNESS_ROLE ?? "").trim() === "worker") throw fail("single writer: orchestrator only");
}

// The one write path for shared planning files.
export function writeShared(g, mutate) {
  guardWriter(g.env);
  return withStateLock(g.codeRoot, () => {
    const result = mutate();
    const derived = fs.existsSync(sharedFile(g.codeRoot, "STATE.md")) ? rewriteState(g, (s) => s) : null;
    return { ...result, ...(derived && result?.updated === undefined ? { updated: derived.updated } : {}) };
  });
}

// --- parse and render ---

export function parseState(text) {
  const parsed = frontmatter(text ?? "");
  const sections = new Map();
  let title = "# Project State";
  let current = null;
  for (const line of lf(parsed.body).split("\n")) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      current = h[1];
      sections.set(current, []);
    } else if (current) sections.get(current).push(line);
    else if (/^#\s/.test(line)) title = line;
  }
  for (const [k, v] of sections) {
    while (v.length && v[0].trim() === "") v.shift();
    while (v.length && v[v.length - 1].trim() === "") v.pop();
    sections.set(k, v);
  }
  return { fm: parsed.fm, error: parsed.error, title, sections };
}

const yamlValue = (v) => (v === null || v === undefined ? "null" : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(String(v)));

export function renderState(state) {
  const fm = state.fm;
  const p = fm.progress ?? {};
  const out = [
    "---",
    `gsd_state_version: ${yamlValue(fm.gsd_state_version)}`,
    `status: ${yamlValue(fm.status)}`,
    `milestone: ${yamlValue(fm.milestone)}`,
    `active_phase: ${yamlValue(fm.active_phase)}`,
    "progress:",
    ...["total_phases", "completed_phases", "total_plans", "completed_plans", "percent"].map((k) => `  ${k}: ${yamlValue(p[k] ?? null)}`),
    `last_updated: ${yamlValue(fm.last_updated)}`,
    `state_head: ${yamlValue(fm.state_head)}`,
    "---",
    "",
    state.title,
    "",
  ];
  const names = [...SECTIONS, ...[...state.sections.keys()].filter((k) => !SECTIONS.includes(k))];
  for (const name of names) {
    out.push(`## ${name}`, "");
    const lines = state.sections.get(name) ?? [];
    if (lines.length) out.push(...lines, "");
  }
  return `${out.join("\n").trimEnd()}\n`;
}

// Frontmatter values derived from disk; percentages withheld unless the roadmap was read completely (GSDC-14).
export function deriveProgress(g) {
  const roadmap = loadRoadmap(g.codeRoot, g.cfg);
  let totalPlans = 0;
  let completedPlans = 0;
  let completedPhases = 0;
  for (const rp of roadmap.phases) {
    const phase = findPhase(g.codeRoot, rp.number);
    if (!phase) continue;
    const plans = planIds(phase);
    totalPlans += plans.length;
    completedPlans += summaryIds(phase).filter((id) => plans.includes(id)).length;
    if (phaseStatus(g.codeRoot, phase).status === "COMPLETE") completedPhases++;
  }
  const total = roadmap.phases.length;
  const percent = roadmap.scope === "complete" ? (total ? Math.round((100 * completedPhases) / total) : 0) : null;
  return { progress: { total_phases: total, completed_phases: completedPhases, total_plans: totalPlans, completed_plans: completedPlans, percent }, scope: roadmap.scope, roadmap };
}

const flat = (fm) => ({ ...fm, progress: undefined, ...Object.fromEntries(Object.entries(fm.progress ?? {}).map(([k, v]) => [`progress.${k}`, v])) });

// Apply `change` to the parsed STATE, re-derive the frontmatter and write; returns the changed field names.
export function rewriteState(g, change) {
  const file = sharedFile(g.codeRoot, "STATE.md");
  const text = readIf(file);
  if (text === null) throw fail("STATE.md does not exist (run state init)");
  const before = parseState(text);
  if (before.error) throw fail(`STATE.md frontmatter: ${before.error}`);
  const oldFlat = flat(before.fm);
  const oldSections = new Map([...before.sections].map(([k, v]) => [k, v.join("\n")]));
  const state = change(structuredClone({ ...before, sections: before.sections })) ?? before;
  const derived = deriveProgress(g);
  if (derived.scope !== "complete") g.err?.(`warning: progress percentage withheld (roadmap scope ${derived.scope})`);
  state.fm = { ...state.fm, gsd_state_version: STATE_VERSION, progress: derived.progress, last_updated: nowIso(), state_head: headOf(g.codeRoot) };
  const newFlat = flat(state.fm);
  const updated = Object.keys({ ...oldFlat, ...newFlat }).filter((k) => k !== "last_updated" && k !== "progress" && JSON.stringify(oldFlat[k] ?? null) !== JSON.stringify(newFlat[k] ?? null));
  for (const [k, v] of state.sections) if (oldSections.get(k) !== v.join("\n")) updated.push(k);
  writeTextAtomic(file, renderState(state));
  return { updated, progress: derived.progress, status: state.fm.status };
}

const checkStatus = (s) => {
  if (s !== undefined && !STATUS_WORDS.includes(s)) throw fail(`status must be one of: ${STATUS_WORDS.join(", ")}`);
  return s;
};

function setPosition(state, roadmap, { phase, plan, status, activity }) {
  if (phase !== undefined) state.fm.active_phase = String(phase);
  if (status !== undefined) state.fm.status = status;
  const rp = roadmapPhase(roadmap, state.fm.active_phase);
  const lines = [
    `Phase: ${state.fm.active_phase ?? "-"} of ${roadmap.phases.length}${rp ? ` (${rp.phase_name})` : ""}`,
    `Plan: ${plan ?? currentLine(state, "Plan") ?? "-"}`,
    `Status: ${state.fm.status ?? "-"}`,
    `Last activity: ${activity ? `${today()} - ${activity}` : (currentLine(state, "Last activity") ?? "-")}`,
  ];
  state.sections.set("Current Position", lines);
}

const currentLine = (state, name) => (state.sections.get("Current Position") ?? []).find((l) => l.startsWith(`${name}: `))?.slice(name.length + 2) ?? null;

const appendEntry = (state, section, text) => {
  const [first, ...rest] = lf(text).trimEnd().split("\n");
  const lines = (state.sections.get(section) ?? []).filter((l) => l.trim() !== "-");
  lines.push(`- ${first}`, ...rest.map((l) => `  ${l}`));
  state.sections.set(section, lines);
};

export function initState(g, opts) {
  return writeShared(g, () => initStateLocked(g, opts));
}

// Caller holds the shared-file writer lock.
export function initStateLocked(g, { milestone }) {
    const file = sharedFile(g.codeRoot, "STATE.md");
    if (fs.existsSync(file)) throw fail("STATE.md already exists");
    const roadmap = loadRoadmap(g.codeRoot, g.cfg);
    if (!roadmap.exists) throw fail("ROADMAP.md does not exist");
    const state = { fm: { status: "Ready to plan", milestone: milestone ?? "v1", active_phase: roadmap.phases[0]?.number ?? null }, title: "# Project State", sections: new Map() };
    state.sections.set("Project Reference", ["See: .planning/PROJECT.md (updated when the project changes)"]);
    setPosition(state, roadmap, { activity: "state initialised" });
    state.sections.set("Current state", ["-"]);
    writeTextAtomic(file, renderState(state));
    return { created: path.relative(g.codeRoot, file).replace(/\\/g, "/") };
}

const stdinRecord = (sub, input) => {
  let rec;
  try {
    rec = JSON.parse(input);
  } catch (e) {
    throw fail(`state ${sub}: stdin is not valid JSON (${e.message})`);
  }
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) throw fail(`state ${sub}: stdin must be a JSON object`);
  return rec;
};

const listText = (v) => (Array.isArray(v) ? v.map(String).join(", ") : String(v ?? ""));

const STDIN_RECORDS = {
  wave: (r) => {
    if (!Array.isArray(r.plans) || !r.plans.length || r.verify === undefined) throw fail("state wave: stdin record needs plans[] and verify");
    return `plans ${listText(r.plans)}; verify ${r.verify}${r.evidence ? `; evidence ${listText(r.evidence)}` : ""}`;
  },
  override: (r) => {
    if (!String(r.reason ?? "").trim()) throw fail("state override: stdin record needs a reason");
    const issues = Array.isArray(r.issues) ? r.issues.map(String) : [];
    return [`owner override: ${r.reason}`, ...issues.map((i) => `accepted issue: ${i}`)].join("\n");
  },
};

// `state <sub>` writers; each returns {updated[]}.
export function stateVerb(g, sub, opts) {
  if (sub === "load") {
    const file = sharedFile(g.codeRoot, "STATE.md");
    const text = readIf(file);
    const parsed = text === null ? null : parseState(text);
    return done({ exists: text !== null, path: ".planning/STATE.md", frontmatter: parsed?.fm ?? null, error: parsed?.error ?? null, content: text });
  }
  if (sub === "init") return done(initState(g, { milestone: opts.milestone }));
  const text = () => {
    if (opts["text-file"]) return fs.readFileSync(path.resolve(g.harnessRoot, opts["text-file"]), "utf8").replace(/^\uFEFF/, "");
    if (opts.text !== undefined) return opts.text;
    // The GSD scripts send wave and override records as stdin JSON (GSDC-10, D-65).
    const render = STDIN_RECORDS[sub];
    const input = render ? String(g.stdin() ?? "").trim() : "";
    if (!input) throw fail(`state ${sub} needs --text, --text-file${render ? " or a stdin JSON record" : ""}`);
    return render(stdinRecord(sub, input));
  };
  const writers = {
    position: (s, r) => setPosition(s, r, { phase: opts.phase, plan: opts.plan, status: checkStatus(opts.status), activity: opts.activity }),
    "planned-phase": (s, r) => {
      if (!opts.phase || !opts.plans) throw fail("state planned-phase needs --phase and --plans");
      setPosition(s, r, { phase: opts.phase, plan: `${opts.plans} plans ready`, status: "Ready to execute", activity: `phase ${opts.phase} planned${opts.name ? ` (${opts.name})` : ""}` });
    },
    wave: (s) => {
      if (!opts.phase || !opts.wave) throw fail("state wave needs --phase and --wave");
      const body = text();
      // G092: a resumed run tracking the same wave and plans again replaces that line (newer verify and evidence);
      // a recovery that tracks other plans of the wave still adds its own line.
      const key = `phase ${opts.phase} wave ${opts.wave}: ${lf(body).split("\n")[0].split("; ")[0]}`;
      const lines = s.sections.get("Wave log") ?? [];
      const at = lines.findIndex((l) => /^- \d{4}-\d{2}-\d{2} /.test(l) && l.slice(13).split("; ")[0] === key);
      if (at >= 0 && !lf(body).trim().includes("\n")) lines[at] = `- ${today()} phase ${opts.phase} wave ${opts.wave}: ${body.trim()}`;
      else appendEntry(s, "Wave log", `${today()} phase ${opts.phase} wave ${opts.wave}: ${body}`);
    },
    decision: (s) => appendEntry(s, "Decisions", `${today()} (${opts.by ?? "owner"}): ${text()}`),
    override: (s) => appendEntry(s, "Overrides", `${today()}: ${text()}`),
    "session-note": (s) => s.sections.set("Current state", [`Updated: ${today()}`, ...lf(text()).trimEnd().split("\n")]),
    rederive: () => {},
  };
  const write = writers[sub];
  if (!write) throw fail(`unknown state verb ${sub}`);
  return done(
    writeShared(g, () =>
      rewriteState(g, (s) => {
        write(s, loadRoadmap(g.codeRoot, g.cfg));
        return s;
      }),
    ),
  );
}

// After `phase complete`: the next unfinished phase, or All phases complete (GSDC-11).
export function advanceState(g, completedNumber) {
  if (!fs.existsSync(sharedFile(g.codeRoot, "STATE.md"))) return null;
  return rewriteState(g, (s) => {
    const roadmap = loadRoadmap(g.codeRoot, g.cfg);
    const next = roadmap.phases.find((p) => phaseStatus(g.codeRoot, findPhase(g.codeRoot, p.number)).status !== "COMPLETE");
    setPosition(s, roadmap, { phase: next ? next.number : completedNumber, plan: "-", status: next ? "Ready to plan" : "All phases complete", activity: `phase ${completedNumber} complete` });
    return s;
  });
}
