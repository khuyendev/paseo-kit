export const meta = {
  name: "gsd-research",
  description: "GSD phase research: view, reuse or refresh the phase RESEARCH.md through one gsd-phase-researcher",
  phases: [{ title: "Preconditions" }, { title: "Research" }, { title: "Readback" }],
};

const a = args ?? {};
const phaseDir = a.phaseDir;
if (typeof phaseDir !== "string" || !PHASE_DIR_RE.test(phaseDir)) return { status: "failed", reason: `phaseDir must match ${PHASE_DIR_RE.source}` };
const nn = phaseDir.split("/").pop().split("-")[0];
const report = `${phaseDir}/${nn}-RESEARCH.md`;
const cfg = await loadCfg();
const agentFor = (role, fallback) => cfg.adapter.agents?.[role] ?? fallback;
// O66D (gsd.research_ahead): research may run while earlier phases execute; claims about the project's own code live in
// ## Code APIs, which `refresh: "code"` re-verifies alone once those phases are complete.
const ahead = cfg.gsd.research_ahead === true;
const codeRefresh = a.refresh === "code";
if (codeRefresh && !ahead) return { status: "failed", reason: `refresh "code" needs gsd.research_ahead; rerun with refresh true` };
const CODE_SECTION = /^##\s+Code APIs\b/m;
const MARKER = /^<!-- gsd:research-complete\b[^\r\n]*-->\s*$/;
// The report's sections outside ## Code APIs, keyed by heading ("" = before the first one), without frontmatter and marker.
function sectionsOutsideCode(text) {
  const body = String(text ?? "").replace(/\r\n/g, "\n").replace(/^---\n[\s\S]*?\n---\n/, "");
  const out = {};
  let head = "";
  for (const line of body.split("\n")) {
    if (/^##\s/.test(line)) head = line.trim();
    else if (!MARKER.test(line)) out[head] = `${out[head] ?? ""}${line.trimEnd()}\n`;
  }
  for (const h of Object.keys(out)) if (CODE_SECTION.test(h)) delete out[h];
  return out;
}
async function sectionDigests(text) {
  const out = {};
  for (const [h, body] of Object.entries(sectionsOutsideCode(text))) out[h] = await sha(body.trim());
  return out;
}
const phaseOrder = (x, y) => {
  const px = String(x).split(".").map(Number);
  const py = String(y).split(".").map(Number);
  for (let i = 0; i < Math.max(px.length, py.length); i++) {
    const d = (px[i] ?? -1) - (py[i] ?? -1);
    if (d) return d;
  }
  return 0;
};

phase("Preconditions");
if (a.view) {
  const status = await gsd(["research", "status", phaseDir]);
  if (status.code === 66) return { status: "failed", reason: `no research report at ${report}`, path: report };
  return { status: "view", report: status.json, valid: status.code === 0, path: report };
}
// G046 (per phase): one research run of a phase at a time, from its status check through readback. The lock is per phase,
// not the root writer lock: a research of one phase must not block plan or execute of the root. A second run would share
// this run's report and attempt file.
const lease = await flow(["lock", `research-${nn}`, runId, "gsd-research"]);
if (lease.code !== 0) return { status: "refused", reason: `another research run holds phase ${nn} (${lease.json?.holder ?? "unknown run"}); research it after that run ends` };
try {
// read again under the lock: a run that held it before may have written the report meanwhile
const status = await gsd(["research", "status", phaseDir]);
const open = await discussOpen(phaseDir, nn);
if (open) return needsOwner("Discuss", open);
if (status.code === 0 && !a.refresh) return { status: "reused", path: report, headChanged: Boolean(status.json?.headChanged) };
if (codeRefresh && status.code === 66) return needsOwner("Research", `no research report at ${report}; a code refresh needs one, research the phase first`, { path: report, reportStatus: "missing", options: ["research (without refresh)"] });
// GSDF-13 (CR-GSF-20): without refresh only a missing report is researched; an invalid, blocked, incomplete, stale or changed
// one is reported with the refresh option, unless this run's own attempt is being resumed. O66D: a code refresh likewise
// starts only on a report whose decision inputs are current.
if (status.code !== 66 && (!a.refresh || codeRefresh)) {
  const shown = await gsd(["attempt", "show", phaseDir, "--kind", "research"]);
  const currentDigest = (await gsd(["revisions", "hash", phaseDir, "research"])).json?.hash;
  if (!(shown.code === 0 && shown.json?.runId === runId && !shown.json?.done && shown.json?.inputDigest === currentDigest)) {
    const reportStatus = status.json?.status ?? "invalid";
    const problems = status.json?.problems ?? status.json?.blockers ?? [];
    const pendingPhases = status.json?.pending_phases ?? [];
    if (reportStatus === "provisional" && !a.refresh) return { status: "provisional", path: report, pendingPhases, reason: `research ${report} was written ahead of phase ${pendingPhases.join(", ")}, not complete yet; once complete, rerun with refresh "code"` };
    if (!a.refresh) return needsOwner("Research", `research report ${report} is ${reportStatus}; rerun with refresh${reportStatus === "code-stale" && ahead ? ` "code" to re-verify its ## Code APIs, or refresh` : ""} to research it again`, { path: report, reportStatus, problems, ...(status.json?.changed ? { changed: status.json.changed } : {}), options: reportStatus === "code-stale" && ahead ? ["refresh code", "refresh", "keep the report as it is"] : ["refresh", "keep the report as it is"] });
    if (reportStatus === "provisional") return needsOwner("Research", `research ${report} was written ahead of phase ${pendingPhases.join(", ")}, not complete yet; refresh its code part once complete`, { path: report, reportStatus, pendingPhases, options: ["wait for those phases, then refresh code", "refresh"] });
    if (!["code-stale", "complete"].includes(reportStatus)) return needsOwner("Research", `research report ${report} is ${reportStatus}; a code refresh keeps every other section, so it needs a report whose other inputs are current: rerun with refresh`, { path: report, reportStatus, problems, options: ["refresh", "keep the report as it is"] });
    if (!CODE_SECTION.test((await flow(["read", report])).json?.text ?? "")) return needsOwner("Research", `research report ${report} has no ## Code APIs section to refresh alone; rerun with refresh`, { path: report, reportStatus, options: ["refresh", "keep the report as it is"] });
  }
}

phase("Research");
const inputDigest = (await gsd(["revisions", "hash", phaseDir, "research"])).json?.hash;
if (!inputDigest) return { status: "failed", reason: "revisions hash research gave no hash" };
const before = await fileSha(report);
// O66D: an ahead run lists the earlier phases not COMPLETE yet; a code refresh keeps the digests of the sections it must
// not touch. A resumed attempt keeps what its first record asked (the record is not rewritten on continuation).
let asked = {};
if (ahead) {
  let pending = [];
  let base = null;
  if (codeRefresh) base = await sectionDigests((await flow(["read", report])).json?.text);
  else {
    const roadmap = await gsd(["roadmap", "analyze"]);
    if (roadmap.code !== 0 || !Array.isArray(roadmap.json?.phases)) return { status: "failed", reason: `roadmap analyze failed (exit ${roadmap.code}); research_ahead needs the phase list` };
    pending = roadmap.json.phases.filter((p) => phaseOrder(p.number, phaseNumber(phaseDir)) < 0 && p.status !== "COMPLETE").map((p) => String(p.number));
  }
  asked = { aheadOf: pending, part: codeRefresh ? "code" : "full", ...(base ? { base } : {}) };
}
// GSDC-30: recorded before dispatch; a fresh run id never adopts another run's unfinished attempt.
const attempt = (await gsd(["attempt", "record", phaseDir, "--kind", "research"], { runId, inputDigest, before, ...asked })).json;
if (!attempt?.key) return { status: "failed", reason: "attempt record research failed" };
const aheadOf = attempt.aheadOf ?? [];
const part = attempt.part ?? null;

async function readback() {
  const st = await gsd(["research", "status", phaseDir]);
  const mine = st.json?.attempt_key === attempt.key && st.json?.input_digest === inputDigest;
  return { st, mine };
}
// What a code refresh changed outside ## Code APIs, and the findings it says need a full refresh (reported, not refused:
// the report is a valid one for the current inputs).
async function codeRefreshReport() {
  const text = (await flow(["read", report])).json?.text ?? "";
  const now = await sectionDigests(text);
  const was = attempt.base ?? {};
  const outsideCode = [...new Set([...Object.keys(was), ...Object.keys(now)])].filter((h) => was[h] !== now[h]).map((h) => h || "(before the first section)");
  const needsFullRefresh = String(text).split(/\r?\n/).filter((l) => /^\s*(?:[-*]\s+)?Needs full refresh:/.test(l)).map((l) => l.trim().replace(/^[-*]\s+/, ""));
  if (outsideCode.length) log(`warning: code refresh changed sections outside ## Code APIs: ${outsideCode.join(", ")}`);
  return { outsideCode, needsFullRefresh };
}
async function accept(st) {
  const result = await fileSha(report);
  await gsd(["attempt", "record", phaseDir, "--kind", "research"], { runId, inputDigest, before, done: true, result });
  await gsd(["revisions", "record", phaseDir, "research"]);
  const out = { status: "researched", path: report, attemptKey: attempt.key };
  if (!ahead) return out;
  return { ...out, part, aheadOf, reportStatus: st.json?.status ?? null, ...(part === "code" ? await codeRefreshReport() : {}) };
}
async function decide() {
  const { st, mine } = await readback();
  if (st.json?.status === "blocked" && mine) {
    await gsd(["attempt", "record", phaseDir, "--kind", "research"], { runId, inputDigest, before, done: true, result: { status: "blocked" } });
    return needsOwner("Research", "researcher reported blockers", { path: report, issues: st.json?.blockers ?? [] });
  }
  // An ahead report reads provisional (or code-stale once its phases completed meanwhile): it is still this attempt's output.
  const aheadDone = aheadOf.length > 0 && ["provisional", "code-stale"].includes(st.json?.status);
  if ((st.code === 0 || aheadDone) && mine) return accept(st);
  return null;
}

// --resume of the same run: the report of this attempt may already be on disk.
const already = await decide();
if (already) return already;

function aheadContract() {
  if (part === "code") return `Code refresh: the decisions, libraries and upstream findings of ${report} stand. Edit only its section ## Code APIs: re-verify every claim against the current code ([VERIFIED: path:line]), drop the [PENDING: ...] tags, correct or add the claims the current code calls for${a.focus ? ` (focus on: ${a.focus})` : ""}. Leave every other section exactly as it is; a finding outside ## Code APIs that the current code contradicts goes into ## Code APIs as a line starting "Needs full refresh:". Update the frontmatter (input_digest, attempt_key; no ahead_of) and the final line.`;
  const code = "Write a section ## Code APIs holding every claim about this project's own code (its APIs, types, files and behaviour), so a later code refresh can re-verify it alone.";
  if (!aheadOf.length) return `${code} No ahead_of and no [PENDING: ...] tags.`;
  return `Research ahead: phase ${aheadOf.join(", ")} before this one is not complete; its code is still being written. Ground libraries, upstream UI and this phase's decisions as usual, and let no section but ## Code APIs rest on project code that phase ${aheadOf.join(", ")} builds or changes. ${code} Tag each claim resting on code those phases have not finished [PENDING: phase <n>]. The frontmatter also carries ahead_of: ${JSON.stringify(aheadOf)}. For this report the status check ends at provisional, not complete, while those phases run: provisional with no problems listed is done.`;
}
const rendered = (await gsd(["research", "prompt", phaseDir])).json;
if (!rendered?.prompt) return { status: "failed", reason: "research prompt could not be rendered" };
const prompt = [
  rendered.prompt,
  `<kit_research_contract>\nWrite only ${report}. Its frontmatter carries status (complete or blocked), input_digest: ${inputDigest} and attempt_key: ${attempt.key}; a complete report ends with the line <!-- gsd:research-complete ${attempt.key} -->; a blocked one has <research_blockers>.\nBefore your final reply, run \`node .agents/harness/ph.mjs gsd research status ${phaseDir}\` (read-only). It lists the \`problems\` of the report; fix every listed problem and run it again until the status is complete, or blocked with its blockers listed.\n${a.refresh && !codeRefresh ? `Refresh: keep findings of the existing report that are still valid${a.focus ? `; focus on: ${a.focus}` : ""}.` : ""}${ahead ? `\n${aheadContract()}` : ""}\nDo not build, test, install or commit anything. Keep provenance tags on every claim. The package audit is not installed: never report it as OK.\nReturn JSON {"status": "complete" | "blocked", "path": "${report}"}.\n</kit_research_contract>`,
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
// The researcher's reason and the report's problems (or blockers) are the only clue to what failed; keep both.
const problems = st.json?.problems ?? st.json?.blockers ?? [];
return { status: "failed", reason: `report ${report} is not this attempt's (status ${st.json?.status ?? st.code}; attempt key or input digest differs)${reason ? `; researcher: ${reason}` : ""}`, problems };
} finally {
  await flow(["unlock", `research-${nn}`, lease.json.token]);
}
