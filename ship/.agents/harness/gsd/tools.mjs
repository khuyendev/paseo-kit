// Command helpers and the .planning health check: run-with-timeout and normalize-test-command (GSDC-41), health (GSDC-42).
import { runArgv } from "../lib/proc.mjs";
import { done, fail, readIf } from "./common.mjs";
import { findPhase, listFiles, listPhaseDirs, planIds, readPlans, sharedFile, summaryIds } from "./planning.mjs";
import { loadRoadmap } from "./roadmap.mjs";
import { STATUS_WORDS, deriveProgress, guardWriter, parseState, rewriteState, writeShared } from "./state.mjs";
import { readVerification } from "./status.mjs";

export const TIMEOUT_EXIT = 124;

// Passes the child's output through, then prints its own JSON last line (the GSDC-02 exception).
export async function runWithTimeout(g, secs, argv) {
  const s = Number(secs);
  if (!Number.isFinite(s) || s <= 0) throw fail("run-with-timeout needs <secs> > 0");
  if (!argv.length) throw fail("run-with-timeout needs -- <argv...>");
  const start = Date.now();
  const r = await runArgv(argv, { cwd: g.codeRoot, env: g.env, timeoutMs: s * 1000 });
  if (r.stdout) g.write(r.stdout.endsWith("\n") ? r.stdout : `${r.stdout}\n`);
  if (r.stderr) g.errWrite(r.stderr.endsWith("\n") ? r.stderr : `${r.stderr}\n`);
  const durationS = Math.round((Date.now() - start) / 100) / 10;
  const code = r.timedOut ? TIMEOUT_EXIT : r.error ? 127 : (r.code ?? 1);
  return done({ code, timedOut: r.timedOut, durationS, ...(r.error ? { error: r.error.message } : {}) }, code);
}

// Known watch-mode runners rewritten to their one-shot form; any other command is returned byte-identical. Rewrites
// work on whole argument tokens, so quoted arguments and unrelated options are never touched (GSDC-41).
const LAUNCHERS = new Set(["npx", "bunx", "yarn", "pnpm", "exec", "dlx"]);
const WATCH_ON = /^--watch(?:All)?(?:=true)?$/;

const dropWatch = (args) => args.filter((t) => !WATCH_ON.test(t));
const ensure = (args, flag) => (args.includes(flag) ? args : [...args, flag]);

const RUNNERS = {
  vitest: (args) => {
    const rest = dropWatch(args);
    if (rest[0] === "run" || rest[0] === "bench") return rest;
    return ["run", ...(rest[0] === "watch" || rest[0] === "dev" ? rest.slice(1) : rest)];
  },
  jest: dropWatch,
  "react-scripts test": (args) => ensure(dropWatch(args), "--watchAll=false"),
  "ng test": (args) => ensure(dropWatch(args), "--watch=false"),
  "karma start": (args) => ensure(args, "--single-run"),
};

const splitTokens = (s) => s.match(/(?:[^\s"']+|"(?:\\.|[^"\\])*"|'[^']*')+/g) ?? [];

export function normalizeTestCommand(command) {
  const original = String(command ?? "");
  if (!original.trim()) throw fail("normalize-test-command needs a command");
  const tokens = splitTokens(original);
  let i = 0;
  while (i < tokens.length - 1 && LAUNCHERS.has(tokens[i])) i++;
  for (const [name, rewrite] of Object.entries(RUNNERS)) {
    const words = name.split(" ");
    if (words.some((w, k) => tokens[i + k] !== w)) continue;
    const head = tokens.slice(0, i + words.length);
    return [...head, ...rewrite(tokens.slice(i + words.length))].join(" ");
  }
  return original;
}

// --- health ---

const diag = (code, message, fix, repairable = false) => ({ code, message, fix, repairable });

export function healthDiagnostics(g) {
  const out = [];
  const roadmap = loadRoadmap(g.codeRoot, g.cfg);
  if (!roadmap.exists) out.push(diag("roadmap-missing", "ROADMAP.md does not exist", "run gsd-new-project"));
  const ints = roadmap.phases.filter((p) => !p.number.includes(".")).map((p) => Number(p.number)).sort((a, b) => a - b);
  for (let i = 1; i < ints.length; i++) if (ints[i] !== ints[i - 1] + 1) out.push(diag("phase-numbering-gap", `phase numbering jumps from ${ints[i - 1]} to ${ints[i]}`, "renumber the ROADMAP phases"));
  const dirs = listPhaseDirs(g.codeRoot);
  for (const rp of roadmap.phases) if (!dirs.some((d) => d.padded === rp.padded)) out.push(diag("roadmap-phase-without-directory", `ROADMAP phase ${rp.number} has no directory under .planning/phases`, `create .planning/phases/${rp.padded}-<slug>`));
  for (const d of dirs) {
    if (roadmap.exists && !roadmap.phases.some((p) => p.padded === d.padded)) out.push(diag("directory-without-roadmap-entry", `${d.name} has no ROADMAP phase`, "add the phase to ROADMAP.md or move the directory"));
    const plans = new Set(planIds(d));
    for (const s of summaryIds(d)) if (!plans.has(s)) out.push(diag("orphan-summary", `${d.name}/${s}-SUMMARY.md has no PLAN`, "restore the plan or move the summary to superseded/"));
    for (const p of readPlans(d)) if (!Object.hasOwn(p.fm, "wave")) out.push(diag("plan-without-wave", `${d.name}/${p.id}-PLAN.md has no wave`, "add wave: <n> to the plan frontmatter"));
    if (listFiles(d, "verification").length) {
      const v = readVerification(g.codeRoot, findPhase(g.codeRoot, d.number));
      if (!v.valid && v.problems?.some((x) => x.startsWith("status must be"))) out.push(diag("verification-invalid-status", `${d.name}: VERIFICATION status ${JSON.stringify(v.written_status)} is not passed, gaps_found or human_needed`, "re-run gsd verify"));
    }
  }
  const stateText = readIf(sharedFile(g.codeRoot, "STATE.md"));
  if (stateText !== null) {
    const st = parseState(stateText);
    if (st.error) out.push(diag("state-unparsable", `STATE.md frontmatter: ${st.error}`, "fix the frontmatter by hand"));
    else {
      if (!STATUS_WORDS.includes(st.fm.status)) out.push(diag("state-invalid-status", `STATE status ${JSON.stringify(st.fm.status ?? null)} is not a lifecycle word (${STATUS_WORDS.join(", ")})`, "ph gsd state position --status <word>"));
      const derived = deriveProgress(g).progress;
      const stored = st.fm.progress ?? {};
      const diff = Object.keys(derived).filter((k) => JSON.stringify(stored[k] ?? null) !== JSON.stringify(derived[k]));
      if (diff.length) out.push(diag("state-disagrees-with-disk", `STATE progress ${diff.join(", ")} differ from disk`, "ph gsd health --repair", true));
    }
  }
  return out;
}

export function health(g, repair) {
  if (repair) guardWriter(g.env);
  let diagnostics = healthDiagnostics(g);
  let repaired = [];
  if (repair && diagnostics.some((d) => d.repairable)) {
    writeShared(g, () => rewriteState(g, (s) => s));
    repaired = diagnostics.filter((d) => d.repairable).map((d) => d.code);
    diagnostics = healthDiagnostics(g);
  }
  return done({ status: diagnostics.length ? "issues" : "healthy", diagnostics, repaired }, diagnostics.length ? 1 : 0);
}
