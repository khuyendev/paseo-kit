// WildEraV6 items 4, 5, 6 (W45): config JSON longer than the shell's default tail, one-shot agents
// journaled before they are archived, and the stack skill named in the review prompts.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadConfigLenient } from "../../ship/.agents/harness/config.mjs";
import { connect } from "../../ship/.agents/harness/paseo-client/index.mjs";
import { runDoctor } from "../../ship/.agents/harness/runtime/doctor.mjs";
import { kitHelpers } from "../../ship/.agents/harness/workflow/script.mjs";
import { readJournal } from "../../ship/.agents/harness/workflow/journal.mjs";
import { renderPrompt } from "../../ship/.agents/workflows/lib/flow-prompt.mjs";
import { makeTempDir, SHIP_DIR } from "../helpers/temp.mjs";
import { setup as phSetup } from "../ph/setup.mjs";
import { meta, setup } from "../workflow/helpers.mjs";

const SKILL = ".claude/skills/ue-code/SKILL.md";

test("W45 loadCfg keeps a ph config JSON longer than the 20000-character shell default", async () => {
  const big = JSON.stringify({ ok: true, note: "n".repeat(25000) });
  assert.ok(big.length > 20000);
  let tail = null;
  const shell = async (_cmd, opts) => {
    tail = opts?.tailChars ?? 20000;
    const stdout = big.length > tail ? big.slice(-tail) : big;
    return { code: 0, stdout, stderr: "" };
  };
  const cfg = await kitHelpers({ shell, agent: async () => null, parallel: async () => [] }).loadCfg();
  assert.equal(cfg.ok, true);
  assert.ok(tail >= 1000000, `tailChars ${tail}`);
});

test("W45 a one-shot reply is journaled before archive; a session agent stays live for a later turn", async () => {
  const s = setup();
  const id = "wf_w45";
  const journal = () => readJournal(path.join(s.project.path(`_workspace/_runs/${id}`), "journal.jsonl"));
  const atArchive = [];
  const origArchive = s.fake.client.archiveAgent.bind(s.fake.client);
  s.fake.client.archiveAgent = async (agentId) => {
    const hit = journal().find((e) => e.agentId === agentId && (e.status === "ok" || e.status === "null"));
    atArchive.push({ agentId, journaled: Boolean(hit), result: hit?.result ?? null });
    return origArchive(agentId);
  };
  const origSend = s.fake.client.sendAgentMessage.bind(s.fake.client);
  s.fake.client.sendAgentMessage = async (agentId, text) => {
    assert.equal(s.fake.agents.get(agentId).archivedAt, null, "a session agent was archived before its follow-up turn");
    return origSend(agentId, text);
  };
  s.project.write("wf.js", `${meta()}const one = await agent("once", { detail: true }); const a = await agent("turn", { session: "planner:p", detail: true }); const b = await agent("again", { session: "planner:p", detail: true }); return { one: one.agentId, session: a.agentId, same: a.agentId === b.agentId };`);
  const r = await s.ph(["workflow", "--script", "wf.js", "--run-id", id]);
  assert.equal(r.code, 0, r.stderr);
  const got = JSON.parse(fs.readFileSync(path.join(s.project.path(`_workspace/_runs/${id}`), "result.json"), "utf8"));
  assert.equal(got.same, true);
  const one = atArchive.find((x) => x.agentId === got.one);
  assert.ok(one, "the one-shot agent was not archived");
  assert.equal(one.journaled, true, "the one-shot agent was archived before its reply was journaled");
  assert.equal(one.result, "ok");
  assert.equal(s.fake.agents.get(got.one).archivedAt == null, false);
  const sessionArchives = atArchive.filter((x) => x.agentId === got.session);
  assert.equal(sessionArchives.length, 1, "a session agent is archived once, at run end");
  assert.equal(sessionArchives[0].journaled, true);
});

test("W45 doctor sizes a live cap from free RAM at 700 MB per agent, and the notes say 700", async () => {
  const s = phSetup();
  const { cfg, error } = loadConfigLenient(s.root);
  const out = [];
  let session;
  const ctx = {
    env: s.env, root: s.root, cfg, configError: error, clock: s.clock, out: (l) => out.push(l),
    paseo: () => (session ??= connect({ env: s.env, root: s.root, cfg, clock: s.clock, daemon: s.fake.daemon })),
  };
  await runDoctor(ctx, { freemem: () => 2048 * 2 ** 20, claudeVersionText: () => null });
  assert.ok(out.includes("note free RAM 2048 MB is below max_subagents 20 x 700 MB = 14000 MB; lower max_subagents or free memory"), out.join("\n"));
  assert.ok(out.includes("note suggested max_live_subagents 2 (free RAM 2048 MB / 700 MB per agent)"), out.join("\n"));
  const notes = [
    fs.readFileSync(path.join(SHIP_DIR, ".agents/harness.defaults.json"), "utf8"),
    fs.readFileSync(path.join(SHIP_DIR, ".claude/skills/ph/SKILL.md"), "utf8"),
    fs.readFileSync(path.join(SHIP_DIR, ".claude/skills/harness/references/paseo-runtime.md"), "utf8"),
  ];
  for (const text of notes) {
    assert.match(text, /700 MB/);
    assert.doesNotMatch(text, /350 MB/);
  }
});

test("W45 code-review, fixer and finding-verifier name the stack skill, and omit the line when there is none", () => {
  const root = makeTempDir("w45 prompt ");
  const skillLine = `Stack skill to follow: ${SKILL}`;
  const review = { plan: "01-01", planPath: ".planning/phases/01-core/01-01-PLAN.md", depth: "standard", scope: "a.js", lines: "- a.js: 1", codeOnly: true, built: "built", lenses: "- correctness: x", digest: "D" };
  const fixer = { owns: "[]", generated: "", verifies: false, build: "[]", tests: "null", attempts: "3", minutes: "20", metrics: false, findings: "", failures: "", requests: "", digest: "D" };
  const verifier = { plan: "01-01", findings: "[]", metrics: false, digest: "D" };
  const steps = fs.readFileSync(path.join(SHIP_DIR, ".agents/harness/workflow/steps.mjs"), "utf8");
  for (const [name, vars] of [["code-review", review], ["fixer", fixer], ["finding-verifier", verifier]]) {
    const withSkill = renderPrompt(root, name, { ...vars, stackSkill: SKILL }).text;
    assert.ok(withSkill.includes(skillLine), `${name} has no stack skill line`);
    const none = renderPrompt(root, name, { ...vars, stackSkill: "" }).text;
    assert.equal(none.includes("Stack skill"), false, `${name} names a stack skill when there is none`);
    assert.match(steps, new RegExp(`renderPrompt\\("${name}", \\{[^}]*stackSkill:`));
  }
});
