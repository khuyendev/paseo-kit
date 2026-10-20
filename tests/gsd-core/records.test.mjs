import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { FRAGMENT_FILE } from "../../ship/.agents/harness/gsd/artifacts.mjs";
import { P1, ROADMAP, gsd, plan, project, summary, writeVerification } from "./fixture.mjs";

test("GSDC-28 revisions: owner inputs and this phase's ROADMAP section invalidate; code-only commits are reported", async () => {
  const p = project({ files: { [`${P1}/01-CONTEXT.md`]: "<decisions></decisions>\n<canonical_refs>`docs/spec.md`</canonical_refs>", "docs/spec.md": "spec", "src/a.js": "1" } });
  assert.equal((await gsd(p, ["revisions", "check", "1", "freeze"])).code, 66);
  await gsd(p, ["revisions", "record", "1", "freeze"]);
  await gsd(p, ["revisions", "record", "1", "plans"]);
  const data = p.readJson(`${P1}/revisions.json`);
  assert.equal(data.keys.freeze.list, data.keys.plans.list, "equal lists are stored once");
  assert.equal(Object.keys(data.lists).length, 1);
  assert.ok(data.lists[data.keys.freeze.list].includes("docs/spec.md"), "canonical_refs hashed");
  p.write(".planning/ROADMAP.md", ROADMAP.replace("**Goal**: Api works", "**Goal**: Api works well"));
  assert.equal((await gsd(p, ["revisions", "check", "1", "freeze"])).code, 0, "another phase's section");
  p.write("src/a.js", "2");
  p.git("add", "-A");
  p.git("commit", "-q", "-m", "code");
  const code = await gsd(p, ["revisions", "check", "1", "freeze"]);
  assert.deepEqual([code.code, code.json.headChanged], [0, true]);
  p.write(".planning/ROADMAP.md", ROADMAP.replace("**Goal**: Core works", "**Goal**: Core works fast"));
  assert.equal((await gsd(p, ["revisions", "check", "1", "freeze"])).code, 1, "this phase's section");
  await gsd(p, ["revisions", "record", "1", "freeze"]);
  p.write(`${P1}/01-CONTEXT.md`, "<decisions>- **D-01:** new</decisions>\n<canonical_refs>`docs/spec.md`</canonical_refs>");
  const changed = await gsd(p, ["revisions", "check", "1", "freeze"]);
  assert.deepEqual([changed.code, changed.json.status], [1, "changed"]);
  await gsd(p, ["revisions", "record", "1", "freeze"]);
  p.write("docs/spec.md", "spec v2");
  assert.equal((await gsd(p, ["revisions", "check", "1", "freeze"])).code, 1, "a canonical ref changed");
});

test("GSDC-29 supersede moves plans outside the keep set, never deletes", async () => {
  const files = Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`${P1}/01-0${n}-PLAN.md`, plan({ id: `0${n}` })]));
  files[`${P1}/01-05-SUMMARY.md`] = summary("05");
  files[`${P1}/superseded/01-05-PLAN.md`] = "older";
  const p = project({ files });
  const r = await gsd(p, ["supersede", "1", "--keep", "01-01,01-02,01-03,01-04"]);
  assert.deepEqual(r.json.moved.map((m) => m.to), [`${P1}/superseded/01-05-PLAN.md.1`, `${P1}/superseded/01-05-SUMMARY.md`]);
  assert.deepEqual((await gsd(p, ["phase", "list-plans", "1"])).json.plans, ["01-01", "01-02", "01-03", "01-04"]);
  assert.equal(p.read(`${P1}/superseded/01-05-PLAN.md`), "older");
  assert.equal((await gsd(p, ["supersede", "1"])).code, 1);
});

test("GSDC-30 attempt records: resume keeps the attempt, a fresh run abandons it", async () => {
  const p = project();
  assert.equal((await gsd(p, ["attempt", "show", "1", "--kind", "verify"])).code, 66);
  const a = await gsd(p, ["attempt", "record", "1", "--kind", "verify", "--run-id", "run-a", "--input-digest", "d1", "--before", "sha-old"]);
  assert.equal(a.json.done, false);
  assert.equal(a.json.key.length, 64);
  const resumed = await gsd(p, ["attempt", "record", "1", "--kind", "verify", "--run-id", "run-a", "--input-digest", "d1", "--done", "true", "--result", '"sha-new"']);
  assert.deepEqual([resumed.json.key, resumed.json.done, resumed.json.result, resumed.json.before], [a.json.key, true, "sha-new", "sha-old"]);
  await gsd(p, ["attempt", "record", "1", "--kind", "gap", "--input-digest", "d1", "--run-id", "run-1"]);
  const fresh = await gsd(p, ["attempt", "record", "1", "--kind", "gap", "--input-digest", "d1", "--run-id", "run-2"], {});
  assert.notEqual(fresh.json.key, a.json.key);
  assert.equal(fresh.json.abandoned.length, 1);
  assert.equal(fresh.json.abandoned[0].runId, "run-1");
  const stdin = await gsd(p, ["attempt", "record", "1", "--kind", "research"], { stdin: JSON.stringify({ runId: "r", inputDigest: "x", before: null }) });
  assert.equal(stdin.json.runId, "r");
  assert.equal((await gsd(p, ["attempt", "record", "1", "--kind", "nope", "--run-id", "r", "--input-digest", "x"])).code, 1);
});

test("GSDC-31 write and hash", async () => {
  const p = project();
  const w = await gsd(p, ["write", P1, "OUTLINE-REVIEW"], { stdin: "# review\n" });
  assert.equal(w.code, 0);
  assert.equal(p.read(`${P1}/01-OUTLINE-REVIEW.md`), "# review\n");
  assert.equal((await gsd(p, ["write", P1, "foo"], { stdin: "x" })).code, 1);
  assert.equal((await gsd(p, ["write", `${P1}/../../`, "OUTLINE-REVIEW"], { stdin: "x" })).code, 1);
  assert.equal((await gsd(p, ["write", ".planning", "STATE"], { stdin: "x" })).code, 1);
  assert.ok(!fs.existsSync(p.path(".planning/STATE.md")));
  const crlf = await gsd(p, ["hash"], { stdin: "a\r\nb\r\n" });
  const lf = await gsd(p, ["hash"], { stdin: "a\nb\n" });
  assert.equal(crlf.json.hash, lf.json.hash);
  assert.match(lf.out.at(-1), /^\{"hash":"[0-9a-f]{64}"\}$/);
});

async function researchReport(p, { status = "complete", key = "a".repeat(64), body } = {}) {
  const digest = (await gsd(p, ["revisions", "hash", "1", "research"])).json.hash;
  const sections = ["Summary", "Standard Stack", "Architecture Patterns", "Don't Hand-Roll", "Common Pitfalls", "Sources"].map((s) => `## ${s}\n\nx [VERIFIED: docs]\n`).join("\n");
  const text = body ?? `---\nstatus: ${status}\ninput_digest: ${digest}\nattempt_key: ${key}\n---\n<user_constraints>none</user_constraints>\n<phase_requirements>CORE-01 CORE-02</phase_requirements>\n${status === "blocked" ? "<research_blockers>x</research_blockers>\n" : ""}${sections}\n<!-- gsd:research-complete ${key} -->\n`;
  p.write(`${P1}/01-RESEARCH.md`, text);
  return { text, digest };
}

test("GSDC-32 research status: truncated invalid, stale after CONTEXT edit, blocked by a newer attempt", async () => {
  const p = project({ files: { [`${P1}/01-CONTEXT.md`]: "<decisions></decisions>" } });
  assert.equal((await gsd(p, ["research", "status", "1"])).code, 66);
  const { text, digest } = await researchReport(p);
  assert.equal((await gsd(p, ["research", "status", "1"])).json.status, "complete");
  p.write(`${P1}/01-RESEARCH.md`, text.split("<!-- gsd:research-complete")[0]);
  const cut = await gsd(p, ["research", "status", "1"]);
  assert.deepEqual([cut.code, cut.json.status], [1, "invalid"]);
  await researchReport(p);
  await gsd(p, ["attempt", "record", "1", "--kind", "research", "--run-id", "r2", "--input-digest", digest, "--result", '{"status":"blocked"}']);
  assert.equal((await gsd(p, ["research", "status", "1"])).json.status, "blocked");
  fs.rmSync(p.path(`${P1}/research-attempt.json`));
  await gsd(p, ["attempt", "record", "1", "--kind", "research", "--run-id", "r3", "--input-digest", digest]);
  assert.equal((await gsd(p, ["research", "status", "1"])).json.status, "incomplete");
  fs.rmSync(p.path(`${P1}/research-attempt.json`));
  p.write(`${P1}/01-CONTEXT.md`, "<decisions>- **D-01:** changed</decisions>");
  const stale = await gsd(p, ["research", "status", "1"]);
  assert.deepEqual([stale.code, stale.json.status], [1, "stale"]);
  await researchReport(p, { body: "---\nstatus: complete\ninput_digest: short\nattempt_key: x\n---\n" });
  assert.match((await gsd(p, ["research", "status", "1"])).json.problems.join(), /input_digest is not 64 hex/);
});

test("GSDC-33 research prompt renders the vendored fragment with phase values only", async () => {
  const p = project();
  const r = (await gsd(p, ["research", "prompt", "1"])).json;
  assert.doesNotMatch(r.prompt, /context_path|USER DECISIONS/);
  assert.match(r.prompt, /Research how to implement Phase 1: Core/);
  assert.match(r.prompt, /\*\*Phase requirement IDs \(MUST address\):\*\* CORE-01, CORE-02/);
  assert.match(r.prompt, /Write to: \.planning\/phases\/01-core\/01-RESEARCH\.md/);
  assert.equal(r.inputDigest, (await gsd(p, ["revisions", "hash", "1", "research"])).json.hash);
  const fragment = fs.readFileSync(FRAGMENT_FILE, "utf8").replace(/\r\n/g, "\n");
  const literal = fragment.split("\n").filter((l) => !/\{[a-z_]+\}|\$\{AGENT_SKILLS_RESEARCHER\}/.test(l));
  const lines = r.prompt.split("\n");
  for (const l of literal) assert.ok(lines.includes(l), `fragment line kept: ${l}`);
});

test("GSDC-34 verification status: closed enum, list consistency, stale on a covered edit; fingerprint 69", async () => {
  const p = project({ files: { [`${P1}/01-01-PLAN.md`]: plan(), [`${P1}/01-01-SUMMARY.md`]: summary("01"), "src/a.js": "1" } });
  assert.equal((await gsd(p, ["verification", "status", "1"])).code, 66);
  await writeVerification(p, "passed", { gaps: ["g"] });
  assert.deepEqual([(await gsd(p, ["verification", "status", "1"])).code, (await gsd(p, ["verification", "status", "1"])).json.status], [1, "invalid"]);
  await writeVerification(p, "Passed");
  assert.equal((await gsd(p, ["verification", "status", "1"])).json.status, "invalid");
  await writeVerification(p, "gaps_found");
  assert.equal((await gsd(p, ["verification", "status", "1"])).json.status, "invalid");
  await writeVerification(p, "passed");
  const ok = await gsd(p, ["verification", "status", "1"]);
  assert.deepEqual([ok.code, ok.json.status, ok.json.stale], [0, "passed", false]);
  p.write("src/a.js", "2");
  const stale = await gsd(p, ["verification", "status", "1"]);
  assert.deepEqual([stale.code, stale.json.status, stale.json.written_status], [0, "stale", "passed"]);
  const fp = await gsd(p, ["verification", "fingerprint", "1", "src/missing.js"]);
  assert.equal(fp.code, 69);
  assert.match((await gsd(p, ["verification", "fingerprint", "1", "src/a.js"])).json.covered_digest, /^gsdkit1:sha256:[0-9a-f]{64}$/);
});

test("GSDC-43 debug sessions: slug, reuse, vague next_action, reopen with the earlier fix, data-fenced checkpoints", async () => {
  const p = project();
  const input = { signature: { kind: "test", key: "auth.login", label: "Login Fails S30!!" }, symptoms: { expected: "200", actual: "500", errors: "TypeError: x", reproduction: "npm test", started: "today" }, owns: ["Path:src/auth/"], goal: "find_and_fix" };
  const a = await gsd(p, ["debug", "create"], { stdin: JSON.stringify(input) });
  assert.deepEqual([a.json.slug, a.json.reused], ["login-fails-s30", false]);
  const file = `.planning/debug/login-fails-s30.md`;
  assert.match(p.read(file), / {4}DATA_START\n {4}500\n {4}DATA_END/);
  assert.equal((await gsd(p, ["debug", "status", "login-fails-s30"])).code, 0);
  const again = await gsd(p, ["debug", "create"], { stdin: JSON.stringify(input) });
  assert.deepEqual([again.json.slug, again.json.reused], ["login-fails-s30", true]);
  const other = await gsd(p, ["debug", "create"], { stdin: JSON.stringify({ ...input, signature: { kind: "test", key: "other", label: "Login fails s30" } }) });
  assert.equal(other.json.slug, "login-fails-s30-2");
  await gsd(p, ["debug", "checkpoint", "login-fails-s30"], { stdin: JSON.stringify({ question: "Which env?\n## X injected heading", answer: "staging" }) });
  const st = await gsd(p, ["debug", "status", "login-fails-s30"]);
  assert.equal(st.code, 0, JSON.stringify(st.json));
  assert.ok(st.json.sections.includes("Resolution") && st.json.sections.includes("Checkpoints") && !st.json.sections.includes("X injected heading"));
  p.write(file, p.read(file).replace(/^next_action: .*$/m, "next_action: continue investigating"));
  assert.equal((await gsd(p, ["debug", "status", "login-fails-s30"])).code, 1);
  p.write(file, p.read(file).replace("next_action: continue investigating", "next_action: log the token in src/auth/login.js").replace(/^root_cause:.*$/m, "root_cause: token parsed twice").replace(/^fix:.*$/m, "fix: parse once"));
  const close = await gsd(p, ["debug", "close", "login-fails-s30", "--outcome", "resolved", "--why", "no test for refresh"]);
  assert.equal(close.code, 0, JSON.stringify(close.json));
  assert.ok(fs.existsSync(p.path(".planning/debug/resolved/login-fails-s30.md")));
  const reopen = await gsd(p, ["debug", "create"], { stdin: JSON.stringify(input) });
  assert.deepEqual([reopen.json.reused, reopen.json.reopened], [true, true]);
  assert.match(p.read(file), /token parsed twice[\s\S]*parse once/);
  p.write(file, p.read(file).replace(/^fix:.*$/m, "fix: parse once, cache"));
  await gsd(p, ["debug", "close", "login-fails-s30", "--outcome", "resolved"]);
  const kb = p.read(".planning/debug/knowledge-base.md");
  assert.equal(kb.match(/^## login-fails-s30 — /gm).length, 2);
  assert.match(kb, /- Root cause: token parsed twice/);
  const list = await gsd(p, ["debug", "list"]);
  assert.deepEqual(list.json.sessions.map((s) => s.slug), ["login-fails-s30-2"]);
  const diag = await gsd(p, ["debug", "close", "login-fails-s30-2", "--outcome", "diagnosed"]);
  assert.equal(diag.json.moved, false);
  p.write(".planning/debug/login-fails-s30-2.md", p.read(".planning/debug/login-fails-s30-2.md").replace("    200", "    201"));
  assert.match((await gsd(p, ["debug", "status", "login-fails-s30-2"])).json.problems.join(), /Symptoms changed/);
});
