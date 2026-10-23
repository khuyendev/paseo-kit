export const meta = {
  name: "gsd-map-codebase",
  description: "GSD map-codebase: 4 parallel gsd-codebase-mapper workers write the 7 docs of .planning/codebase/; doc check, secrets scan, stamp",
  phases: [{ title: "Map" }, { title: "Check" }, { title: "Review" }, { title: "Stamp" }],
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
// agent option `detail: true` resolves {result, reason, agentId, worktree, durationS, model, effort};
// the global `runId` is the first run's id, kept by --resume (GSDC-30 attempt keys).
async function call(prompt, opts) {
  const d = await agent(prompt, { ...opts, detail: true });
  return { result: d?.result ?? null, reason: d?.reason ?? null, model: d?.model ?? null, effort: d?.effort ?? null };
}
const fatal = (reason) => Boolean(reason && NEVER_RETRY.test(reason));
const needsOwner = (stage, reason, extra = {}) => ({ status: "needs-owner", stage, reason, ...extra });
// The refusal of a held lease names the holder's workflow and run (kit-feedback 1); `what` says what it holds.
const leaseText = (r, what = "this code root") => `${r?.holderKind ? `a ${r.holderKind} run` : "another run"} holds ${what} (${r?.holder ?? r?.error ?? "unknown run"})`;
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
const SAFE_PATH = /^(?!\/)(?![A-Za-z]:)[A-Za-z0-9_][A-Za-z0-9_ ./-]*$/;
const CONFIRM_SCHEMA = { type: "object", properties: { focus: { type: "string" }, written: { type: "array", items: { type: "string" } } }, required: ["written"] };
// Kit-feedback 43: a reviewer returns the claims of its group the code does not support; an empty list when all hold.
const REVIEW_SCHEMA = { type: "object", properties: { focus: { type: "string" }, issues: { type: "array", items: { type: "object", properties: { doc: { type: "string" }, claim: { type: "string" }, problem: { type: "string", enum: ["false", "outdated", "misleading"] }, evidence: { type: "string" }, fix_hint: { type: "string" } }, required: ["doc", "claim", "problem", "evidence", "fix_hint"] } } }, required: ["issues"] };
// Kit-feedback 61: review round 2 returns the round-1 findings that still stand as issues, and any other claim it finds as new_claims.
const RECHECK_SCHEMA = { ...REVIEW_SCHEMA, properties: { ...REVIEW_SCHEMA.properties, new_claims: REVIEW_SCHEMA.properties.issues } };
// The doc a confirmation names: `.planning/codebase/STACK.md`, `STACK.md` or `STACK`.
const docName = (p) => String(p).split("/").pop().replace(/\.md$/i, "").toUpperCase();
// G117: a mapper counts only when its confirmation names exactly the docs of its focus; otherwise the map is not this run's.
const confirmed = (j, r) => { const names = (r?.result?.written ?? []).map(docName); return j.docs.every((d) => names.includes(d)) && names.every((n) => j.docs.includes(n)); };
// Kit-feedback 60: a fix round rewrites only the docs with findings, so its reply names every doc with a finding and nothing outside its focus.
const fixConfirmed = (j, issues, r) => {
  const names = (r?.result?.written ?? []).map(docName);
  return names.length > 0 && names.every((n) => j.docs.includes(n)) && issues.every((x) => names.includes(docName(x.doc)));
};
// Kit-feedback 43: a reviewer counts only when its reply carries an issue list.
const reviewed = (r) => Array.isArray(r?.result?.issues);

const a = args ?? {};
const paths = a.paths === undefined ? [] : String(a.paths).split(",").map((p) => p.trim()).filter(Boolean);
// GSDF-05: --paths reaches mapper prompts and git; refuse `..`, absolute paths and shell metacharacters. A segment of only dots and
// spaces (`..`, ` ..`, `. .`) is refused too, since the `..` check compares whole segments.
const bad = paths.filter((p) => !SAFE_PATH.test(p) || p.split("/").some((s) => /^[. ]+$/.test(s)));
if (bad.length) return { status: "failed", reason: `--paths rejected: ${bad.map((p) => JSON.stringify(p)).join(", ")} (relative paths only; letters, digits, spaces and _ . / -; no .. or dots-only segment, no leading /)` };
const docs = a.docs ? String(a.docs).split(",").map((d) => d.trim().toUpperCase()) : Object.values(FOCUS).flat();
const unknown = docs.filter((d) => !Object.values(FOCUS).flat().includes(d));
if (unknown.length) return { status: "failed", reason: `unknown map docs ${unknown.join(", ")}` };
const cfg = await loadCfg();
const agentFor = (role, fallback) => cfg.adapter.agents?.[role] ?? fallback;
// G117: a mapper that gives no confirmation naming its docs is retried once unless the reason is fatal. Kit-feedback 60: a fix
// round passes its own check, so a correct partial fix is not sent out again.
const mapperCall = async (j, prompt, label, ok = (r) => confirmed(j, r)) => {
  const opts = { label, agentType: agentFor("mapper", "gsd-codebase-mapper"), role: "mapper", schema: CONFIRM_SCHEMA };
  let r = await call(prompt, opts);
  if (!ok(r) && !fatal(r.reason)) r = await call(prompt, opts);
  return r;
};
// G119: a map holds its own root lease, not the debug one (plan and execute keep pipelining); two map runs never write
// or stamp the same documents at once.
const lease = await flow(["lock", "codebase-map", runId, "gsd-map-codebase"]);
if (lease.code !== 0) return { status: "refused", reason: `${leaseText(lease.json)}; map after it ends` };
try {
phase("Map");
// G119: the mappers read the tree at this HEAD; the stamp refuses when a commit (an execute wave) moved it during the map.
const dispatchHead = (await flow(["head"])).json?.commit ?? null;
const jobs = Object.entries(FOCUS).map(([focus, own]) => ({ focus, docs: own.filter((d) => docs.includes(d)) })).filter((j) => j.docs.length);
// G117: a mapper that gives no confirmation naming its docs is retried once unless fatal (as gsd-plan-review); a job still
// unconfirmed fails the run before the check and the stamp, so an old doc is never stamped as this run's map.
const replies = await parallel(jobs.map((j) => async () => {
  const prompt = [
    `Focus: ${j.focus}. Explore the codebase${paths.length ? ` limited to these paths (incremental remap): ${paths.join(", ")}` : ""} and write ${j.docs.map((d) => `.planning/codebase/${d}.md`).join(" and ")} directly.`,
    paths.length ? "Update only the sections the listed paths affect; keep the rest of each document." : "",
    "Do not write last_mapped_commit or last_mapped_at (the orchestrator stamps the map). Never copy secrets, keys or tokens into a document. Do not commit.",
    "Return only a confirmation JSON {focus, written: [paths]}, not the documents.",
  ].filter(Boolean).join("\n\n");
  return mapperCall(j, prompt, `mapper-${j.focus}`);
}));
const failedJob = jobs.findIndex((j, i) => !confirmed(j, replies[i]));
if (failedJob >= 0) {
  const r = replies[failedJob];
  return { status: "failed", reason: `mapper ${jobs[failedJob].focus} failed: ${r?.result ? "its confirmation does not name exactly its docs" : (r?.reason ?? "no reply")}` };
}

const docPaths = docs.map((d) => `.planning/codebase/${d}.md`);
// The mechanical checks of the written docs: the doc check, then the secrets scan. Returns the stop result, or null when both pass.
const checkDocs = async () => {
  const check = await flow(["map-check", ...docs]);
  if (check.code !== 0) return { status: "failed", reason: `map incomplete: ${(check.json?.problems ?? []).join("; ")}` };
  const scan = await flow(["secrets", ...docPaths]);
  if (scan.code !== 0) return { status: "needs-owner", stage: "Map", reason: "possible secrets in the codebase map; nothing committed", findings: scan.json?.findings ?? [], options: ["remove them and rerun the check", "confirm they are not secrets"] };
  return null;
};
phase("Check");
const checked = await checkDocs();
if (checked) return checked;

// Kit-feedback 43: one read-only reviewer per focus fact-checks its docs against the code (paths, symbols, behaviour, Known Bugs).
// Its findings go back to that focus's mapper once. Kit-feedback 61: the second review is a resolution check of those findings
// (its prompt carries the digest of the docs, so a resumed run asks again); a claim it adds goes to the findings list and does
// not stop the stamp. The findings that still stand are the owner's to decide, so nothing is stamped or committed.
phase("Review");
// Kit-feedback 61: an incremental map reviews only the claims about its remapped paths.
const scope = paths.length ? `Incremental map: review only the claims about these paths: ${paths.join(", ")}; skip the rest of each doc.` : "";
const reviewJob = async (j, prior, digest) => {
  const prompt = prior ? [
    `Focus: ${j.focus}. Resolution check of ${j.docs.map((d) => `.planning/codebase/${d}.md`).join(" and ")}: the mapper has corrected each finding below in its doc. Resolve each one in the code again; report it in issues only while the doc still states it wrongly.`,
    `Findings (JSON): ${JSON.stringify(prior)}`,
    "Report any other claim of these docs that the code does not support in new_claims, in the same shape; do not put it in issues.",
    scope,
    digestLine("docs", digest),
    "Return only JSON {focus, issues: [...], new_claims: [...]}; empty lists when every finding is resolved and no other claim fails.",
  ].filter(Boolean).join("\n\n") : [
    `Focus: ${j.focus}. Fact-check ${j.docs.map((d) => `.planning/codebase/${d}.md`).join(" and ")} against this repository.`,
    "Every concrete claim counts: file paths, symbols, commands, configuration keys, behaviour, counts, versions, and each Known Bug. Resolve each one in the code; do not trust the document's wording.",
    scope,
    "Return only JSON {focus, issues: [{doc, claim, problem (false|outdated|misleading), evidence, fix_hint}]}; an empty list when every claim holds.",
  ].filter(Boolean).join("\n\n");
  const opts = { label: `review-${j.focus}`, agentType: agentFor("map_reviewer", "gsd-map-reviewer"), role: "map_reviewer", readOnly: true, schema: prior ? RECHECK_SCHEMA : REVIEW_SCHEMA };
  let r = await call(prompt, opts);
  if (!reviewed(r) && !fatal(r.reason)) r = await call(prompt, opts);
  return r;
};
// A group whose reviewer gave no usable reply stops the run; the others report their open issues. `prior` maps a focus to its
// round-1 findings when the group is a resolution check.
const reviewGroups = async (list, prior, digest) => {
  const replies = await parallel(list.map((j) => () => reviewJob(j, prior?.[j.focus], digest)));
  const silent = list.findIndex((_, i) => !reviewed(replies[i]));
  if (silent >= 0) return { failed: `map review ${list[silent].focus} failed: ${replies[silent].reason ?? "no usable reply"}` };
  return {
    open: list.map((j, i) => ({ job: j, issues: replies[i].result.issues })).filter((g) => g.issues.length),
    newClaims: list.flatMap((j, i) => (replies[i].result.new_claims ?? []).map((c) => ({ focus: j.focus, ...c }))),
  };
};
// Kit-feedback 61: the digest of the docs as they stand; a fix round changes it, so the resolution check is asked again on resume.
const docsDigest = async () => sha((await Promise.all(docPaths.map((p) => fileSha(p)))).join("\n"));
let review = await reviewGroups(jobs);
if (review.failed) return { status: "failed", reason: review.failed };
const fixed = review.open.map((g) => g.job.focus);
if (review.open.length) {
  const fixes = await parallel(review.open.map(({ job, issues }) => () => mapperCall(job, [
    `Focus: ${job.focus}. The review found these problems in the docs you wrote (${job.docs.map((d) => `.planning/codebase/${d}.md`).join(" and ")}). Check each listed claim in the code again, correct it, and keep the rest of each document.`,
    `Findings (JSON): ${JSON.stringify(issues)}`,
    "Do not write last_mapped_commit or last_mapped_at. Never copy secrets, keys or tokens into a document. Do not commit.",
    "Return only a confirmation JSON {focus, written: [paths]}, not the documents.",
  ].join("\n\n"), `mapper-fix-${job.focus}`, (r) => fixConfirmed(job, issues, r))));
  const unfixed = review.open.findIndex(({ job, issues }, i) => !fixConfirmed(job, issues, fixes[i]));
  if (unfixed >= 0) {
    const r = fixes[unfixed];
    return { status: "failed", reason: `mapper ${review.open[unfixed].job.focus} failed to fix its review findings: ${r?.result ? "its confirmation does not name exactly its docs" : (r?.reason ?? "no reply")}` };
  }
  const rechecked = await checkDocs();
  if (rechecked) return rechecked;
  review = await reviewGroups(review.open.map((g) => g.job), Object.fromEntries(review.open.map((g) => [g.job.focus, g.issues])), await docsDigest());
  if (review.failed) return { status: "failed", reason: review.failed };
}
if (review.open.length) return needsOwner("Review", "the codebase map still has claims the code does not support after one fix round; nothing committed", { findings: review.open.flatMap(({ job, issues }) => issues.map((i) => ({ focus: job.focus, ...i }))), options: ["correct the listed claims by hand, then rerun the map", "rerun the map"] });

phase("Stamp");
const stampHead = (await flow(["head"])).json?.commit ?? null;
if (stampHead !== dispatchHead) return { status: "failed", reason: `HEAD moved during the map (${dispatchHead} -> ${stampHead}); the mappers read another tree; rerun the map` };
const stamp = await flow(["stamp", ...docs]);
if (stamp.code !== 0) return { status: "failed", reason: `stamp failed: ${stamp.json?.error}` };
if (cfg.gsd.commit_policy.docs) {
  const c = await gsd(["commit", "docs: map codebase", "--files", ...docPaths]);
  if (c.code !== 0) log(`warning: docs commit failed: ${c.json?.error ?? c.code}`);
}
return { status: "mapped", docs: docPaths, commit: stamp.json.commit, paths, review: { checked: jobs.map((j) => j.focus), fixed, findings: review.newClaims } };
} finally {
  await flow(["unlock", "codebase-map", lease.json.token]);
}
