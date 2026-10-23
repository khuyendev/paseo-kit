export const meta = {
  name: "gsd-research",
  description: "GSD phase research: view, reuse or refresh the phase RESEARCH.md through one gsd-phase-researcher",
  phases: [{ title: "Preconditions" }, { title: "Research" }, { title: "Readback" }],
};

// ---- shared GSD script helpers (scripts cannot import; keep identical across gsd-*.js) ----
const PH = ".agents/harness/ph.mjs";
const FLOW = ".agents/workflows/lib/gsd-flow.mjs";
const PHASE_DIR_RE = /^\.planning\/phases\/\d+(\.\d+)?-[a-z0-9-]+$/;
const lastJson = (text) => { try { return JSON.parse(String(text).trim().split(/\r?\n/).pop()); } catch { return null; } };
// A verb prints its JSON on one last line; shell() keeps only the last 20000 characters by default, which cut the line of
// `outline parse` for a 12-plan phase (23 KB) and made the outline look incomplete. Keep the whole output.
const VERB_TAIL_CHARS = 4000000;
// GSDF-03: the one verb helper; JSON goes on stdin, only validated values reach the argv.
async function run(argv, input) {
  const r = await shell(["node", ...argv], { tailChars: VERB_TAIL_CHARS, ...(input === undefined ? {} : { input: typeof input === "string" ? input : JSON.stringify(input) }) });
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
// The refusal of a held code-root lease names the holder's workflow and run (kit-feedback 1).
const leaseText = (r) => `${r?.holderKind ? `a ${r.holderKind} run` : "another run"} holds this code root (${r?.holder ?? r?.error ?? "unknown run"})`;
async function discussOpen(phaseDir, nn) {
  const ex = (await flow(["exists", `${phaseDir}/${nn}-DISCUSS-CHECKPOINT.json`, `${phaseDir}/${nn}-CONTEXT.md`])).json?.exists ?? {};
  if (ex[`${phaseDir}/${nn}-DISCUSS-CHECKPOINT.json`]) return "discussion interrupted (DISCUSS-CHECKPOINT present); finish it with gsd-discuss";
  if (!ex[`${phaseDir}/${nn}-CONTEXT.md`]) return "no CONTEXT.md; run gsd-discuss first";
  return null;
}
async function sha(text) { return (await gsd(["hash"], text ?? "")).json?.hash ?? null; }
async function fileSha(path) { const r = await flow(["read", path]); return r.json?.exists ? sha(r.json.text) : null; }
// ---- end shared helpers ----

const a = args ?? {};
const phaseDir = a.phaseDir;
if (typeof phaseDir !== "string" || !PHASE_DIR_RE.test(phaseDir)) return { status: "failed", reason: `phaseDir must match ${PHASE_DIR_RE.source}` };
const nn = phaseDir.split("/").pop().split("-")[0];
const report = `${phaseDir}/${nn}-RESEARCH.md`;
const cfg = await loadCfg();
const agentFor = (role, fallback) => cfg.adapter.agents?.[role] ?? fallback;

phase("Preconditions");
const status = await gsd(["research", "status", phaseDir]);
if (a.view) {
  if (status.code === 66) return { status: "failed", reason: `no research report at ${report}`, path: report };
  return { status: "view", report: status.json, valid: status.code === 0, path: report };
}
const open = await discussOpen(phaseDir, nn);
if (open) return needsOwner("Discuss", open);
if (status.code === 0 && !a.refresh) return { status: "reused", path: report, headChanged: Boolean(status.json?.headChanged) };
// GSDF-13 (CR-GSF-20): without refresh only a missing report is researched; an invalid, blocked, incomplete or stale
// one is reported with the refresh option, unless this run's own attempt is being resumed.
if (status.code !== 66 && !a.refresh) {
  const shown = await gsd(["attempt", "show", phaseDir, "--kind", "research"]);
  const currentDigest = (await gsd(["revisions", "hash", phaseDir, "research"])).json?.hash;
  if (!(shown.code === 0 && shown.json?.runId === runId && !shown.json?.done && shown.json?.inputDigest === currentDigest)) {
    const reportStatus = status.json?.status ?? "invalid";
    return needsOwner("Research", `research report ${report} is ${reportStatus}; rerun with refresh to research it again`, { path: report, reportStatus, problems: status.json?.problems ?? status.json?.blockers ?? [], options: ["refresh", "keep the report as it is"] });
  }
}

phase("Research");
const inputDigest = (await gsd(["revisions", "hash", phaseDir, "research"])).json?.hash;
if (!inputDigest) return { status: "failed", reason: "revisions hash research gave no hash" };
const before = await fileSha(report);
// GSDC-30: recorded before dispatch; a fresh run id never adopts another run's unfinished attempt.
const attempt = (await gsd(["attempt", "record", phaseDir, "--kind", "research"], { runId, inputDigest, before })).json;
if (!attempt?.key) return { status: "failed", reason: "attempt record research failed" };

async function readback() {
  const st = await gsd(["research", "status", phaseDir]);
  const mine = st.json?.attempt_key === attempt.key && st.json?.input_digest === inputDigest;
  return { st, mine };
}
async function accept() {
  const result = await fileSha(report);
  await gsd(["attempt", "record", phaseDir, "--kind", "research"], { runId, inputDigest, before, done: true, result });
  await gsd(["revisions", "record", phaseDir, "research"]);
  return { status: "researched", path: report, attemptKey: attempt.key };
}
async function decide() {
  const { st, mine } = await readback();
  if (st.json?.status === "blocked" && mine) {
    await gsd(["attempt", "record", phaseDir, "--kind", "research"], { runId, inputDigest, before, done: true, result: { status: "blocked" } });
    return needsOwner("Research", "researcher reported blockers", { path: report, issues: st.json?.blockers ?? [] });
  }
  if (st.code === 0 && mine) return accept();
  return null;
}

// --resume of the same run: the report of this attempt may already be on disk.
const already = await decide();
if (already) return already;

const rendered = (await gsd(["research", "prompt", phaseDir])).json;
if (!rendered?.prompt) return { status: "failed", reason: "research prompt could not be rendered" };
const prompt = [
  rendered.prompt,
  `<kit_research_contract>\nWrite only ${report}. Its frontmatter carries status (complete or blocked), input_digest: ${inputDigest} and attempt_key: ${attempt.key}; a complete report ends with the line <!-- gsd:research-complete ${attempt.key} -->; a blocked one has <research_blockers>.\n${a.refresh ? `Refresh: keep findings of the existing report that are still valid${a.focus ? `; focus on: ${a.focus}` : ""}.` : ""}\nDo not build, test, install or commit anything. Keep provenance tags on every claim. The package audit is not installed: never report it as OK.\nReturn JSON {"status": "complete" | "blocked", "path": "${report}"}.\n</kit_research_contract>`,
  digestLine("research", inputDigest),
].join("\n\n");
const schema = { type: "object", properties: { status: { type: "string", enum: ["complete", "blocked"] }, path: { type: "string" } }, required: ["status"] };
const { reason } = await call(prompt, { label: "researcher", role: "research", agentType: agentFor("research", "gsd-phase-researcher"), schema });

phase("Readback");
const decided = await decide();
if (decided) return decided;
const { st } = await readback();
if (fatal(reason)) return { status: "failed", reason: `researcher failed: ${reason}` };
if (st.code === 66) return { status: "failed", reason: `researcher wrote no report${reason ? ` (${reason})` : ""}` };
return { status: "failed", reason: `report ${report} is not this attempt's (status ${st.json?.status ?? st.code}; attempt key or input digest differs)` };
