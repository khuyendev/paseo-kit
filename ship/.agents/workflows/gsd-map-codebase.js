export const meta = {
  name: "gsd-map-codebase",
  description: "GSD map-codebase: 4 parallel gsd-codebase-mapper workers write the 7 docs of .planning/codebase/; doc check, secrets scan, stamp",
  phases: [{ title: "Map" }, { title: "Check" }, { title: "Stamp" }],
};

// ---- shared GSD script helpers (scripts cannot import; keep identical across gsd-*.js) ----
const PH = ".agents/harness/ph.mjs";
const FLOW = ".agents/workflows/lib/gsd-flow.mjs";
const PHASE_DIR_RE = /^\.planning\/phases\/\d+(\.\d+)?-[a-z0-9-]+$/;
const lastJson = (text) => { try { return JSON.parse(String(text).trim().split(/\r?\n/).pop()); } catch { return null; } };
// GSDF-03: the one verb helper; JSON goes on stdin, only validated values reach the argv.
async function run(argv, input) {
  const r = await shell(["node", ...argv], input === undefined ? {} : { input: typeof input === "string" ? input : JSON.stringify(input) });
  return { code: r.code, json: lastJson(r.stdout), stderr: r.stderr };
}
async function loadCfg() {
  const r = await shell(["node", PH, "config"]);
  if (r.code !== 0) throw new Error(`ph config failed: ${String(r.stderr).split(/\r?\n/)[0]}`);
  return JSON.parse(r.stdout);
}
const gsd = (argv, input) => run([PH, "gsd", ...argv], input);
const flow = (argv, input) => run([FLOW, ...argv], input);
const phaseNumber = (dir) => /phases\/(\d+(?:\.\d+)?)-/.exec(dir)[1];
const digestLine = (key, hash) => `Input digest (${key}): ${hash}`;
const policyBlock = (path) => `<research_input_policy>\n${path ? `Approved research: ${path}. Read and use only this report.` : "Approved research: NONE. Do not read or use any RESEARCH.md on disk."}\n</research_input_policy>`;
const NEVER_RETRY = /quota|credit|billing|auth|permission|usage limit|rate limit|\b429\b|too many requests|RESOURCE_EXHAUSTED/i;
// agent option `detail: true` resolves {result, reason, agentId, worktree, durationS};
// the global `runId` is the first run's id, kept by --resume (GSDC-30 attempt keys).
async function call(prompt, opts) {
  const d = await agent(prompt, { ...opts, detail: true });
  return { result: d?.result ?? null, reason: d?.reason ?? null };
}
const fatal = (reason) => Boolean(reason && NEVER_RETRY.test(reason));
const needsOwner = (stage, reason, extra = {}) => ({ status: "needs-owner", stage, reason, ...extra });
async function discussOpen(phaseDir, nn) {
  const ex = (await flow(["exists", `${phaseDir}/${nn}-DISCUSS-CHECKPOINT.json`, `${phaseDir}/${nn}-CONTEXT.md`])).json?.exists ?? {};
  if (ex[`${phaseDir}/${nn}-DISCUSS-CHECKPOINT.json`]) return "discussion interrupted (DISCUSS-CHECKPOINT present); finish it with gsd-discuss";
  if (!ex[`${phaseDir}/${nn}-CONTEXT.md`]) return "no CONTEXT.md; run gsd-discuss first";
  return null;
}
async function sha(text) { return (await gsd(["hash"], text ?? "")).json?.hash ?? null; }
async function fileSha(path) { const r = await flow(["read", path]); return r.json?.exists ? sha(r.json.text) : null; }
// ---- end shared helpers ----

const FOCUS = { tech: ["STACK", "INTEGRATIONS"], arch: ["ARCHITECTURE", "STRUCTURE"], quality: ["CONVENTIONS", "TESTING"], concerns: ["CONCERNS"] };
const SAFE_PATH = /^(?!\/)(?![A-Za-z]:)[A-Za-z0-9_][A-Za-z0-9_./-]*$/;
const CONFIRM_SCHEMA = { type: "object", properties: { focus: { type: "string" }, written: { type: "array", items: { type: "string" } } }, required: ["written"] };

const a = args ?? {};
const paths = a.paths === undefined ? [] : String(a.paths).split(",").map((p) => p.trim()).filter(Boolean);
// GSDF-05: --paths reaches mapper prompts and git; refuse `..`, absolute paths and shell metacharacters.
const bad = paths.filter((p) => !SAFE_PATH.test(p) || p.split("/").includes(".."));
if (bad.length) return { status: "failed", reason: `--paths rejected: ${bad.map((p) => JSON.stringify(p)).join(", ")} (relative paths only; no .., leading / or shell metacharacters)` };
const docs = a.docs ? String(a.docs).split(",").map((d) => d.trim().toUpperCase()) : Object.values(FOCUS).flat();
const unknown = docs.filter((d) => !Object.values(FOCUS).flat().includes(d));
if (unknown.length) return { status: "failed", reason: `unknown map docs ${unknown.join(", ")}` };
const cfg = await loadCfg();

phase("Map");
const jobs = Object.entries(FOCUS).map(([focus, own]) => ({ focus, docs: own.filter((d) => docs.includes(d)) })).filter((j) => j.docs.length);
const replies = await parallel(jobs.map((j) => () => call([
  `Focus: ${j.focus}. Explore the codebase${paths.length ? ` limited to these paths (incremental remap): ${paths.join(", ")}` : ""} and write ${j.docs.map((d) => `.planning/codebase/${d}.md`).join(" and ")} directly.`,
  paths.length ? "Update only the sections the listed paths affect; keep the rest of each document." : "",
  "Do not write last_mapped_commit or last_mapped_at (the orchestrator stamps the map). Never copy secrets, keys or tokens into a document. Do not commit.",
  "Return only a confirmation JSON {focus, written: [paths]}, not the documents.",
].filter(Boolean).join("\n\n"), { label: `mapper-${j.focus}`, agentType: "gsd-codebase-mapper", role: "mapper", schema: CONFIRM_SCHEMA })));
const failedJob = replies.findIndex((r) => r && !r.result && fatal(r.reason));
if (failedJob >= 0) return { status: "failed", reason: `mapper ${jobs[failedJob].focus} failed: ${replies[failedJob].reason}` };

phase("Check");
const check = await flow(["map-check", ...docs]);
if (check.code !== 0) return { status: "failed", reason: `map incomplete: ${(check.json?.problems ?? []).join("; ")}` };
const docPaths = docs.map((d) => `.planning/codebase/${d}.md`);
const scan = await flow(["secrets", ...docPaths]);
if (scan.code !== 0) return { status: "needs-owner", stage: "Map", reason: "possible secrets in the codebase map; nothing committed", findings: scan.json?.findings ?? [], options: ["remove them and rerun the check", "confirm they are not secrets"] };

phase("Stamp");
const stamp = await flow(["stamp", ...docs]);
if (stamp.code !== 0) return { status: "failed", reason: `stamp failed: ${stamp.json?.error}` };
if (cfg.gsd.commit_policy.docs) {
  const c = await gsd(["commit", "docs: map codebase", "--files", ...docPaths]);
  if (c.code !== 0) log(`warning: docs commit failed: ${c.json?.error ?? c.code}`);
}
return { status: "mapped", docs: docPaths, commit: stamp.json.commit, paths };
