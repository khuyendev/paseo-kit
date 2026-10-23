export const meta = {
  name: "gsd-verify",
  description: "GSD phase verification: one fresh gsd-verifier reads plans, summaries and gate evidence and writes VERIFICATION.md; the file's status routes the phase",
  phases: [{ title: "Evidence" }, { title: "Verify" }, { title: "Route" }],
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

const VERIFIER_SCHEMA = { type: "object", properties: { status: { type: "string" }, path: { type: "string" } }, required: ["status"] };

const a = args ?? {};
const phaseDir = a.phaseDir;
if (typeof phaseDir !== "string" || !PHASE_DIR_RE.test(phaseDir)) return { status: "failed", reason: `phaseDir must match ${PHASE_DIR_RE.source}` };
const evidence = Array.isArray(a.evidence) ? a.evidence : [];
if (evidence.some((p) => typeof p !== "string" || !/^[\w./ -]+\.json$/.test(p) || p.includes(".."))) return { status: "failed", reason: "evidence must be relative paths of gate-evidence JSON files" };
const N = phaseNumber(phaseDir);
const nn = phaseDir.split("/").pop().split("-")[0];
const REPORT = `${phaseDir}/${nn}-VERIFICATION.md`;
const cfg = await loadCfg();
const agentFor = (role, fallback) => cfg.adapter.agents?.[role] ?? fallback;

// GSDF-64 (per phase): one verification of a phase at a time, from its attempt record through readback and routing. The
// lock is per phase, not the root writer lock: a verify of one phase must not block plan or execute of the root.
const lease = await flow(["lock", `verify-${nn}`, runId, "gsd-verify"]);
if (lease.code !== 0) return { status: "refused", reason: `${leaseText(lease.json)}; verify of phase ${nn} after it ends` };
try {

// ---- gate evidence (GSDF-55, ADPT-17): stale or invalid evidence is listed as stale, never as proof ----
phase("Evidence");
// The planned obligations of every handoff wave: the expected steps of each evidence file come from the plans, not
// from the evidence (CR-GSF-11).
const planned = [];
for (const pre of ["", "gap-"]) for (let k = 1; ; k++) {
  const r = await flow(["read", `${phaseDir}/handoff/${pre}w${k}.args.json`]);
  if (!r.json?.exists) break;
  const h = JSON.parse(r.json.text);
  for (const t of h.tasks ?? []) planned.push({ id: t.plan, owns: t.owns ?? [], verify: t.verify ?? [], waveId: h.waveId ?? `${pre}w${k}`, batch: `${pre}batch` });
}
const checkedEvidence = [];
for (const p of evidence) {
  const c = await flow(["evidence-check", p], { plans: planned });
  checkedEvidence.push({ path: p, status: c.json?.status ?? "invalid", reason: c.json?.reason ?? null });
  if (c.code !== 0) log(`evidence ${p} is ${c.json?.status ?? "invalid"}: ${c.json?.reason ?? ""}`);
}
const current = checkedEvidence.filter((e) => e.status === "current").map((e) => e.path);
const stale = checkedEvidence.filter((e) => e.status !== "current");
const checkedHash = (await gsd(["revisions", "hash", phaseDir, "checked"])).json?.hash ?? "none";
const evidenceIdentities = [];
for (const e of checkedEvidence) evidenceIdentities.push({ ...e, sha: await fileSha(e.path) });
const judgedInputs = await flow(["digest"], { owns: planned.flatMap((p) => p.owns).filter((p) => !String(p).includes("VERIFICATION.md")), files: [".planning/ROADMAP.md", ".planning/REQUIREMENTS.md", `${phaseDir}/${nn}-CONTEXT.md`, `${phaseDir}/${nn}-WIRING.md`] });
if (judgedInputs.code !== 0) return { status: "failed", reason: "verification input digest unavailable" };
const inputDigest = await sha(JSON.stringify({ checked: checkedHash, baseline: a.baseline ?? null, evidence: evidenceIdentities, code: judgedInputs.json.hash }));
// The previous report's identity as verification status reports it (the same sha the readback compares). A resumed
// attempt keeps the identity it recorded before its dispatch; the report on disk may already be its own (CR-GSF-12).
const shown = await gsd(["attempt", "show", phaseDir, "--kind", "verify"]);
const resumed = shown.code === 0 && shown.json?.runId === runId && shown.json?.inputDigest === inputDigest;
const before = resumed ? (shown.json.before ?? null) : ((await gsd(["verification", "status", phaseDir])).json?.sha ?? (await fileSha(REPORT)));
const attempt = (await gsd(["attempt", "record", phaseDir, "--kind", "verify"], { runId, inputDigest, before })).json;
if (!attempt?.key) return { status: "failed", reason: "attempt record verify failed" };

async function readback(returned) {
  const st = await gsd(["verification", "status", phaseDir]);
  if (st.code === 66) return { status: "failed", reason: `verifier wrote no ${REPORT}` };
  if (st.code !== 0) return { status: "failed", reason: `${REPORT} is invalid: ${st.json?.error ?? st.json?.reason ?? st.json?.status}` };
  if (before && st.json.sha === before) return { status: "failed", reason: `${REPORT} is unchanged from the previous report` };
  if (returned && returned !== st.json.status) log(`verifier returned ${returned} but ${REPORT} says ${st.json.status}; the file wins`);
  if (attempt.done && attempt.result !== st.json.sha) return { status: "failed", reason: `${REPORT} differs from this attempt's accepted report` };
  const accepted = await gsd(["attempt", "record", phaseDir, "--kind", "verify"], { runId, inputDigest, before, done: true, result: st.json.sha });
  if (accepted.code !== 0) return { status: "failed", reason: `verification attempt could not record report ${st.json.sha}` };
  return { status: st.json.status, path: REPORT, score: st.json.score ?? null, gaps: st.json.gaps ?? [], humanVerification: st.json.human_verification ?? [], sha: st.json.sha };
}

phase("Verify");
let verdict = null;
if (attempt.done) verdict = await readback(null);
else {
  // --resume of the same run: a report this attempt already wrote is accepted without a second agent.
  const st = await gsd(["verification", "status", phaseDir]);
  if (attempt.runId === runId && st.code === 0 && st.json.sha !== before && !attempt.abandonedNow) verdict = await readback(null);
}
if (!verdict) {
  const fp = (await gsd(["verification", "fingerprint", phaseDir, ...current])).json ?? {};
  const prompt = [
    `Verify phase ${N} against its goal. Write ${REPORT} (status passed|gaps_found|human_needed) and do not commit.`,
    "Read: the phase PLAN files and SUMMARY files (claims, not proof), .planning/ROADMAP.md, .planning/REQUIREMENTS.md, the phase CONTEXT and WIRING when present, the previous report when present, and the gate evidence below.",
    `Gate evidence (current; proof of what ran): ${current.length ? current.join(", ") : "none"}`,
    stale.length ? `Stale or invalid evidence (NOT proof; treat the claims it would back as unverified): ${stale.map((e) => `${e.path} (${e.status})`).join(", ")}` : "",
    "Do not rerun anything: no build, no tests, no commands with side effects.",
    `Put these fingerprint fields in the report frontmatter verbatim: covered_files: ${JSON.stringify(fp.covered_files ?? [])}, covered_digest: ${fp.covered_digest ?? "unavailable"}`,
    `Return JSON {status, path: "${REPORT}"}.`,
    digestLine("verify", inputDigest),
  ].filter(Boolean).join("\n\n");
  const { result, reason } = await call(prompt, { label: "verifier", agentType: agentFor("verifier", "gsd-verifier"), role: "verifier", schema: VERIFIER_SCHEMA });
  if (!result && fatal(reason)) return { status: "failed", reason: `verifier failed: ${reason}` };
  verdict = await readback(result?.status ?? null);
}
if (verdict.status === "failed") return verdict;

// ---- routing (GSDF-56) ----
phase("Route");
if (verdict.status === "passed") {
  const done = await gsd(["phase", "complete", N]);
  for (const w of done.json?.warnings ?? []) log(`phase complete warning: ${typeof w === "string" ? w : JSON.stringify(w)}`);
  return { ...verdict, route: done.code === 0 ? "complete" : "complete-failed", completion: done.json };
}
if (verdict.status === "human_needed") {
  const items = verdict.humanVerification.length ? verdict.humanVerification : [{ test: "human verification", expected: "see the VERIFICATION report" }];
  const tests = items.map((h, i) => `### ${i + 1}. ${typeof h === "string" ? h : h.test ?? h.name ?? `item ${i + 1}`}\nexpected: ${typeof h === "string" ? h : h.expected ?? h.description ?? ""}\nresult: [pending]\n`).join("\n");
  await gsd(["write", phaseDir, "UAT"], `---\nstatus: testing\nphase: ${phaseDir.split("/").pop()}\nsource: [${REPORT}]\n---\n\n## Current Test\n\nnumber: 1\nawaiting: user response\n\n## Tests\n\n${tests}\n## Summary\n\ntotal: ${items.length}\npassed: 0\nissues: 0\n`);
  return { ...verdict, route: "uat", uat: `${phaseDir}/${nn}-UAT.md` };
}
if (verdict.status === "gaps_found") {
  await gsd(["requirements", "revert", N]);
  return { ...verdict, route: "plan-gaps" };
}
return { ...verdict, route: "verify-after-evidence" };
} finally {
  await flow(["unlock", `verify-${nn}`, lease.json.token]);
}
