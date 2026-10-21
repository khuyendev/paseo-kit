import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import test from "node:test";
import { testEnv } from "../helpers/env.mjs";
import { P1, ROADMAP, gsd, plan, project, summary, workerEnv, writeVerification } from "./fixture.mjs";

const executed = (extra = {}) => project({ files: { [`${P1}/01-01-PLAN.md`]: plan(), [`${P1}/01-01-SUMMARY.md`]: summary("01"), "src/a.js": "x\n", ...extra } });
const fm = (p) => /---\n([\s\S]*?)\n---/.exec(p.read(".planning/STATE.md"))[1];

test("GSDC-10 STATE frontmatter is derived from disk; decisions verbatim; session note replaces; concurrent writes land", async () => {
  const p = project({ files: { [`${P1}/01-01-PLAN.md`]: plan(), [`${P1}/01-02-PLAN.md`]: plan({ id: "02" }), [`${P1}/01-01-SUMMARY.md`]: summary("01"), "notes/d.txt": "Use plain files.\nSecond line \"quoted\"." } });
  assert.equal((await gsd(p, ["state", "init"])).code, 0);
  const head = fm(p);
  for (const k of ["gsd_state_version: 1", 'status: "Ready to plan"', "total_phases: 3", "total_plans: 2", "completed_plans: 1", "completed_phases: 0", "percent: 0", "state_head:"]) assert.ok(head.includes(k), `${k} in\n${head}`);
  const d = await gsd(p, ["state", "decision", "--text-file", "notes/d.txt"]);
  assert.deepEqual(d.json.updated, ["Decisions"]);
  assert.match(p.read(".planning/STATE.md"), /## Decisions\n\n- \d{4}-\d\d-\d\d \(owner\): Use plain files\.\n  Second line "quoted"\./);
  await gsd(p, ["state", "session-note", "--text", "first note"]);
  await gsd(p, ["state", "session-note", "--text", "second note"]);
  const text = p.read(".planning/STATE.md");
  assert.match(text, /second note/);
  assert.doesNotMatch(text, /first note/);
  const pos = await gsd(p, ["state", "position", "--phase", "1", "--status", "In progress"]);
  assert.ok(pos.json.updated.includes("status"));
  assert.equal((await gsd(p, ["state", "position", "--status", "done"])).code, 1);
  const ph = new URL("../../ship/.agents/harness/ph.mjs", import.meta.url);
  const env = { ...testEnv(), PASEO_HARNESS_ROOT: p.root };
  const run = (txt) => new Promise((resolve) => spawn(process.execPath, [ph.pathname.replace(/^\/([A-Za-z]:)/, "$1"), "gsd", "state", "decision", "--text", txt], { env, cwd: p.root }).on("close", resolve));
  const codes = await Promise.all([run("concurrent A"), run("concurrent B")]);
  assert.deepEqual(codes, [0, 0]);
  const final = p.read(".planning/STATE.md");
  assert.match(final, /concurrent A/);
  assert.match(final, /concurrent B/);
  assert.ok(!fs.existsSync(p.path(".planning/STATE.md.lock")));
});

test("GSDC-11 completing the last phase writes All phases complete; a foreign status fails health", async () => {
  const two = ROADMAP.replace(/### Phase 2[\s\S]*?(?=## Progress)/, "").replace(/- \[ \] \*\*Phase [23].*\n/g, "").replace(/\| [23]\. .*\n/g, "").replace("[CORE-01, CORE-02]", "CORE-01");
  const p = executed({ ".planning/ROADMAP.md": two, ".planning/phases/02-api/.keep": null, ".planning/phases/03-ui/.keep": null });
  fs.rmSync(p.path(".planning/phases/02-api"), { recursive: true, force: true });
  fs.rmSync(p.path(".planning/phases/03-ui"), { recursive: true, force: true });
  await gsd(p, ["state", "init"]);
  await writeVerification(p, "passed");
  const r = await gsd(p, ["phase", "complete", "1"]);
  assert.equal(r.code, 0, JSON.stringify(r.json));
  assert.equal(r.json.state, "All phases complete");
  assert.match(fm(p), /status: "All phases complete"/);
  p.write(".planning/STATE.md", p.read(".planning/STATE.md").replace('status: "All phases complete"', "status: done"));
  const h = await gsd(p, ["health"]);
  assert.equal(h.code, 1);
  assert.ok(h.json.diagnostics.some((d) => d.code === "state-invalid-status"));
});

test("GSDC-12 every mutator refuses a worker and leaves files byte-identical; write cannot reach shared files", async () => {
  const p = executed();
  await gsd(p, ["state", "init"]);
  await writeVerification(p, "passed");
  p.write(".planning/STATE.md", p.read(".planning/STATE.md").replace("total_plans: 1", "total_plans: 7"));
  const snap = () => ["STATE.md", "ROADMAP.md", "REQUIREMENTS.md", "PROJECT.md"].map((f) => p.read(`.planning/${f}`)).join("\0");
  const before = snap();
  const mutators = [
    ["state", "decision", "--text", "x"],
    ["state", "position", "--phase", "1"],
    ["state", "session-note", "--text", "x"],
    ["roadmap", "annotate-dependencies", "1"],
    ["requirements", "mark-complete", "CORE-01"],
    ["requirements", "revert", "1"],
    ["phase", "add", "New"],
    ["phase", "insert", "1", "Fix"],
    ["phase", "remove", "3"],
    ["phase", "complete", "1"],
    ["health", "--repair"],
    ["commit", "msg", "--files", "src/a.js"],
  ];
  for (const argv of mutators) {
    const r = await gsd(p, argv, { env: workerEnv() });
    assert.equal(r.code, 1, argv.join(" "));
    assert.match(r.json.error, /single writer: orchestrator only/, argv.join(" "));
  }
  assert.equal(snap(), before);
  for (const target of [".planning", ".planning/phases/../"]) {
    const w = await gsd(p, ["write", target, "STATE"], { stdin: "x" });
    assert.equal(w.code, 1);
  }
  assert.equal(snap(), before);
  for (const name of fs.readdirSync(new URL("../../ship/.agents/agents/", import.meta.url))) {
    // The pattern matches LF; a Windows checkout with core.autocrlf stores CRLF.
    const text = fs.readFileSync(new URL(`../../ship/.agents/agents/${name}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
    assert.match(text, /include:\n {2}- \.agents\/gsd\/overlays\/kit-core\.md/, name);
  }
  assert.match(fs.readFileSync(new URL("../../ship/.agents/gsd/overlays/kit-core.md", import.meta.url), "utf8"), /single writer/);
});

test("GSDC-15 phase insert, remove and complete", async () => {
  const p = executed();
  await gsd(p, ["state", "init"]);
  const ins = await gsd(p, ["phase", "insert", "2", "Hot", "fix"]);
  assert.equal(ins.json.phase, "2.1");
  assert.ok(fs.existsSync(p.path(".planning/phases/02.1-hot-fix")));
  assert.match(p.read(".planning/ROADMAP.md"), /### Phase 2\.1: Hot fix \(INSERTED\)/);
  assert.equal((await gsd(p, ["roadmap", "get-phase", "2.1"])).json.depends_on[0], "2");
  assert.equal((await gsd(p, ["phase", "remove", "1"])).code, 1, "phase with a PLAN");
  const add = await gsd(p, ["phase", "add", "Docs"]);
  assert.equal(add.json.phase, "4");
  const rm = await gsd(p, ["phase", "remove", "3"]);
  assert.equal(rm.code, 0, JSON.stringify(rm.json));
  assert.deepEqual(rm.json.renumbered, [{ from: "4", to: "3" }]);
  assert.match(p.read(".planning/ROADMAP.md"), /### Phase 3: Docs/);
  assert.ok(fs.existsSync(p.path(".planning/phases/03-docs")));
  await writeVerification(p, "gaps_found", { gaps: ["g"] });
  const files = () => [".planning/ROADMAP.md", ".planning/REQUIREMENTS.md", ".planning/STATE.md"].map((f) => p.read(f)).join("\0");
  const before = files();
  assert.equal((await gsd(p, ["phase", "complete", "1"])).code, 1);
  assert.equal(files(), before);
  p.write(`${P1}/01-01-SUMMARY.md`, summary("01").replace("[src/a.js]", "[src/a.js, src/ghost.js]"));
  await writeVerification(p, "passed");
  const ok = await gsd(p, ["phase", "complete", "1"]);
  assert.equal(ok.code, 0, JSON.stringify(ok.json));
  assert.ok(ok.json.warnings.some((w) => w.includes("src/ghost.js")));
  assert.match(p.read(".planning/ROADMAP.md"), /- \[x\] \*\*Phase 1: Core\*\* - the core \(completed \d{4}-\d\d-\d\d\)/);
  assert.match(p.read(".planning/ROADMAP.md"), /\| 1\. Core \| 1\/1 \| Complete \| \d{4}/);
  assert.match(p.read(".planning/REQUIREMENTS.md"), /- \[x\] \*\*CORE-01\*\*/);
  assert.match(p.read(".planning/STATE.md"), /active_phase: "2"/);
  assert.equal((await gsd(p, ["find-phase", "1"])).json.status, "COMPLETE");
});

test("GSDC-16 uat-passed names blocked tests", async () => {
  const uat = "---\nstatus: testing\n---\n## Tests\n\n### 1. A\nexpected: a\nresult: blocked\nblocked_by: server\n\n### 2. B\nexpected: b\nresult: blocked\nblocked_by: server\n\n### 3. C\nexpected: c\nresult: blocked\nblocked_by: third-party\n";
  const p = executed({ [`${P1}/01-UAT.md`]: uat });
  const r = await gsd(p, ["phase", "uat-passed", "1"]);
  assert.equal(r.code, 1);
  assert.deepEqual(r.json.blockers.map((b) => b.name), ["A", "B", "C"]);
  p.write(`${P1}/01-UAT.md`, uat.replace(/result: blocked/g, "result: pass"));
  assert.equal((await gsd(p, ["phase", "uat-passed", "1"])).code, 0);
  assert.equal((await gsd(p, ["phase", "uat-passed", "1", "--require-verification"])).code, 1);
});

test("GSDC-42 health codes; --repair rewrites only STATE frontmatter", async () => {
  const p = executed({ ".planning/phases/03-ui/.keep": null, ".planning/phases/07-stray/.keep": "", [`${P1}/01-05-SUMMARY.md`]: summary("05") });
  fs.rmSync(p.path(".planning/phases/03-ui"), { recursive: true, force: true });
  await gsd(p, ["state", "init"]);
  p.write(".planning/STATE.md", p.read(".planning/STATE.md").replace("total_plans: 1", "total_plans: 9"));
  const h = await gsd(p, ["health"]);
  const codes = h.json.diagnostics.map((d) => d.code);
  for (const c of ["roadmap-phase-without-directory", "directory-without-roadmap-entry", "orphan-summary", "state-disagrees-with-disk"]) assert.ok(codes.includes(c), c);
  const others = [".planning/ROADMAP.md", ".planning/REQUIREMENTS.md", `${P1}/01-01-PLAN.md`].map((f) => p.read(f)).join("\0");
  const r = await gsd(p, ["health", "--repair"]);
  assert.deepEqual(r.json.repaired, ["state-disagrees-with-disk"]);
  assert.match(p.read(".planning/STATE.md"), /total_plans: 1/);
  assert.equal([".planning/ROADMAP.md", ".planning/REQUIREMENTS.md", `${P1}/01-01-PLAN.md`].map((f) => p.read(f)).join("\0"), others);
});
