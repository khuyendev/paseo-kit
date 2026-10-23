export const meta = {
  name: "gsd-verify",
  description: "GSD phase verification: one fresh gsd-verifier (gsd.verify_mode per-criterion: one per ROADMAP success criterion plus one for the phase-wide checks, merged by ph gsd verification merge) reads plans, summaries and gate evidence and writes VERIFICATION.md; the file's status routes the phase",
  phases: [{ title: "Evidence" }, { title: "Verify" }, { title: "Route" }],
};

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
// Kit feedback 66: verify_mode per-criterion runs one verifier per ROADMAP success criterion and one for the phase-wide
// checks, at once (bounded as execute: gsd.parallelization, never above max_subagents); each writes its own part under
// verify/ and `verification merge` writes the report. Without criteria the phase falls back to the one verifier.
let mode = cfg.gsd.verify_mode ?? "phase";
let fallback = null;
const limit = cfg.gsd.parallelization.enabled ? Math.min(cfg.gsd.parallelization.max_concurrent ?? cfg.max_subagents, cfg.max_subagents) : 1;
let unitStates = null;
let dispatched = 0;
const tagged = (r) => ({ ...r, mode, ...(fallback ? { fallback } : {}), ...(unitStates ? { criteria: unitStates, dispatched } : {}) });

// Bounded pool, as gsd-execute: at most `n` verifiers at a time.
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await parallel(Array.from({ length: Math.min(n, items.length) }, () => async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

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
// A malformed handoff file fails the verify here, before any write, and names the file (G098).
for (const pre of ["", "gap-"]) for (let k = 1; ; k++) {
  const file = `${phaseDir}/handoff/${pre}w${k}.args.json`;
  const r = await flow(["read", file]);
  if (!r.json?.exists) break;
  let h;
  try { h = JSON.parse(r.json.text); } catch (e) { return { status: "failed", reason: `${file} is not valid handoff JSON: ${e.message}` }; }
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
let criteria = [];
if (mode === "per-criterion") {
  const rp = await gsd(["roadmap", "get-phase", N]);
  criteria = rp.code === 0 && Array.isArray(rp.json?.success_criteria) ? rp.json.success_criteria.map(String).filter((t) => t.trim()) : [];
  if (!criteria.length) {
    fallback = rp.code === 0 ? `ROADMAP phase ${N} has no success criteria` : `roadmap get-phase ${N} failed: ${rp.json?.error ?? rp.json?.reason ?? rp.code}`;
    mode = "phase";
    log(`verify_mode per-criterion: ${fallback}; one verifier for the phase`);
  }
}
// The default mode's digest is today's; per-criterion also covers the mode and the criteria it verifies.
const inputDigest = await sha(JSON.stringify({ checked: checkedHash, baseline: a.baseline ?? null, evidence: evidenceIdentities, code: judgedInputs.json.hash, ...(mode === "per-criterion" ? { mode, criteria } : {}) }));
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

// The units of per-criterion mode: SC-<k> per success criterion, then the phase-wide checks; one part file each.
const units = mode === "per-criterion" ? [...criteria.map((text, i) => ({ id: `SC-${i + 1}`, text })), { id: "phase", text: null }].map((u) => ({ ...u, path: `${phaseDir}/verify/${u.id}.md` })) : [];
const partsOf = (list) => ({ attemptKey: attempt.key, parts: list.map(({ id, path, text }) => ({ id, path, text })) });
const READ_LINE = "Read: the phase PLAN files and SUMMARY files (claims, not proof), .planning/ROADMAP.md, .planning/REQUIREMENTS.md, the phase CONTEXT and WIRING when present, the previous report when present, and the gate evidence below.";
const evidenceLines = () => [
  `Gate evidence (current; proof of what ran): ${current.length ? current.join(", ") : "none"}`,
  stale.length ? `Stale or invalid evidence (NOT proof; treat the claims it would back as unverified): ${stale.map((e) => `${e.path} (${e.status})`).join(", ")}` : "",
  "Do not rerun anything: no build, no tests, no commands with side effects.",
];
const unitPrompt = (u, fp, problems) => [
  u.id === "phase"
    ? `Verify the phase-wide checks of phase ${N}. Each ROADMAP success criterion has its own verifier: do not judge the criteria themselves. Scope: the PLAN must_haves truths that do not restate a success criterion, the artifacts and key links of every plan, requirement coverage, the anti-pattern and debt-marker scan, probes, and the plans' deferred <human-check> items.`
    : `Verify ONE ROADMAP success criterion of phase ${N}, ${u.id}: ${JSON.stringify(u.text)}. Scope: this criterion only: the truth it states, the artifacts, key links and tests that make it true, and the overrides and deferred items that name it. The other criteria and the phase-wide checks have their own verifiers.`,
  `Write ${u.path} (status passed|gaps_found|human_needed, the frontmatter of a VERIFICATION report) and nothing else: do not write ${REPORT} (the run merges the parts) and do not commit. Use human_needed only for what the code and the evidence cannot decide, each check under human_verification.`,
  READ_LINE,
  ...evidenceLines(),
  `Put these fields in the frontmatter verbatim: criterion: ${u.id}, attempt_key: "${attempt.key}", covered_files: ${JSON.stringify(fp.covered_files ?? [])}, covered_digest: ${fp.covered_digest ?? "unavailable"}`,
  problems ? `Your ${u.path} was rejected: ${problems.join("; ")}. Rewrite it.` : "",
  `Return JSON {status, path: "${u.path}"}.`,
  digestLine(`verify ${u.id}`, inputDigest),
].filter(Boolean).join("\n\n");

// Per-criterion verify: a part already valid for this attempt (a resumed run) is kept without an agent; the others run at
// once. A part left invalid by a verifier that replied gets one rewrite naming its problems (a resume would replay the
// same reply); a verifier that died leaves its unit to `--resume`. Returns a failure, or null once the report is merged.
async function verifyParts(fp) {
  const partState = async (list) => new Map(((await gsd(["verification", "parts", phaseDir], partsOf(list))).json?.parts ?? []).map((p) => [p.id, p]));
  const first = await partState(units);
  unitStates = units.map((u) => ({ id: u.id, text: u.text, status: first.get(u.id)?.valid ? first.get(u.id).status : "pending", reused: Boolean(first.get(u.id)?.valid) }));
  const todo = units.filter((u) => !first.get(u.id)?.valid);
  if (todo.length < units.length) log(`verify: kept the parts of this attempt for ${units.filter((u) => first.get(u.id)?.valid).map((u) => u.id).join(", ")}`);
  let fatalReason = null;
  await pool(todo, limit, async (u) => {
    const state = unitStates.find((s) => s.id === u.id);
    if (fatalReason) { state.status = "skipped"; state.problems = [fatalReason]; return; }
    const ask = (problems) => { dispatched++; return call(unitPrompt(u, fp, problems), { label: `verifier ${u.id}`, agentType: agentFor("verifier", "gsd-verifier"), role: "verifier", schema: VERIFIER_SCHEMA }); };
    let reply = await ask(null);
    let st = (await partState([u])).get(u.id);
    if (!st?.valid && reply.result) {
      log(`verify: ${u.path} rejected (${(st?.problems ?? ["no readback"]).join("; ")}); one rewrite`);
      reply = await ask(st?.problems ?? ["no readback"]);
      st = (await partState([u])).get(u.id);
    }
    if (!st?.valid && !reply.result && fatal(reply.reason)) fatalReason ??= `verifier ${u.id} failed: ${reply.reason}`;
    state.status = st?.valid ? st.status : st?.status ?? "invalid";
    if (!st?.valid) state.problems = st?.problems ?? [reply.reason ?? "no readback"];
  });
  if (fatalReason) return tagged({ status: "failed", reason: fatalReason });
  const left = unitStates.filter((s) => s.problems);
  if (left.length) return tagged({ status: "failed", reason: `no valid report from ${left.map((s) => `${s.id} (${s.problems[0]})`).join(", ")}; --resume reruns the verifiers that did not finish, a new run verifies every criterion again` });
  const merged = await gsd(["verification", "merge", phaseDir], partsOf(units));
  if (merged.code !== 0) return tagged({ status: "failed", reason: `verification merge refused: ${(merged.json?.parts ?? []).filter((p) => !p.valid).map((p) => `${p.id} (${(p.problems ?? []).join("; ")})`).join(", ") || merged.json?.error || merged.code}` });
  return null;
}

phase("Verify");
let verdict = null;
if (attempt.done) verdict = await readback(null);
else if (mode === "phase") {
  // --resume of the same run: a report this attempt already wrote is accepted without a second agent.
  const st = await gsd(["verification", "status", phaseDir]);
  if (attempt.runId === runId && st.code === 0 && st.json.sha !== before && !attempt.abandonedNow) verdict = await readback(null);
}
if (!verdict) {
  const fp = (await gsd(["verification", "fingerprint", phaseDir, ...current])).json ?? {};
  if (mode === "per-criterion") {
    const failedParts = await verifyParts(fp);
    if (failedParts) return failedParts;
    verdict = await readback(null);
  } else {
    const prompt = [
      `Verify phase ${N} against its goal. Write ${REPORT} (status passed|gaps_found|human_needed) and do not commit.`,
      READ_LINE,
      ...evidenceLines(),
      `Put these fingerprint fields in the report frontmatter verbatim: covered_files: ${JSON.stringify(fp.covered_files ?? [])}, covered_digest: ${fp.covered_digest ?? "unavailable"}`,
      `Return JSON {status, path: "${REPORT}"}.`,
      digestLine("verify", inputDigest),
    ].filter(Boolean).join("\n\n");
    const { result, reason } = await call(prompt, { label: "verifier", agentType: agentFor("verifier", "gsd-verifier"), role: "verifier", schema: VERIFIER_SCHEMA });
    if (!result && fatal(reason)) return tagged({ status: "failed", reason: `verifier failed: ${reason}` });
    verdict = await readback(result?.status ?? null);
  }
}
if (verdict.status === "failed") return tagged(verdict);

// ---- routing (GSDF-56) ----
phase("Route");
if (verdict.status === "passed") {
  const done = await gsd(["phase", "complete", N]);
  for (const w of done.json?.warnings ?? []) log(`phase complete warning: ${typeof w === "string" ? w : JSON.stringify(w)}`);
  for (const p of done.json?.proposals ?? []) log(`phase complete proposes ${p.skill}: ${p.reason}`);
  return tagged({ ...verdict, route: done.code === 0 ? "complete" : "complete-failed", completion: done.json });
}
if (verdict.status === "human_needed") {
  const items = verdict.humanVerification.length ? verdict.humanVerification : [{ test: "human verification", expected: "see the VERIFICATION report" }];
  // A per-criterion report tags each human item with its criterion; the test title names it.
  const title = (h, i) => { const t = typeof h === "string" ? h : h.test ?? h.name ?? `item ${i + 1}`; return h?.criterion ? `${h.criterion}: ${t}` : t; };
  const tests = items.map((h, i) => `### ${i + 1}. ${title(h, i)}\nexpected: ${typeof h === "string" ? h : h.expected ?? h.description ?? ""}\nresult: [pending]\n`).join("\n");
  const uat = await gsd(["write", phaseDir, "UAT"], `---\nstatus: testing\nphase: ${phaseDir.split("/").pop()}\nsource: [${REPORT}]\n---\n\n## Current Test\n\nnumber: 1\nawaiting: user response\n\n## Tests\n\n${tests}\n## Summary\n\ntotal: ${items.length}\npassed: 0\nissues: 0\n`);
  if (uat.code !== 0) return tagged({ status: "failed", reason: `UAT write failed: ${uat.json?.error ?? uat.code}` });
  return tagged({ ...verdict, route: "uat", uat: `${phaseDir}/${nn}-UAT.md` });
}
if (verdict.status === "gaps_found") {
  const reverted = await gsd(["requirements", "revert", N]);
  if (reverted.code !== 0) return tagged({ status: "failed", reason: `requirements revert failed: ${reverted.json?.error ?? reverted.code}` });
  return tagged({ ...verdict, route: "plan-gaps" });
}
return tagged({ ...verdict, route: "verify-after-evidence" });
} finally {
  await flow(["unlock", `verify-${nn}`, lease.json.token]);
}
