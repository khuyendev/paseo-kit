import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { SKILL_USAGE_REL, recordSkill } from "../../ship/.claude/hooks/skill_usage.mjs";
import { SKILL_USAGE_REL as RUNTIME_REL } from "../../ship/.agents/harness/workflow/metrics.mjs";
import { runNode } from "../helpers/run.mjs";
import { testEnv } from "../helpers/env.mjs";
import { makeTempDir } from "../helpers/temp.mjs";
import { HOOKS_DIR } from "./helpers.mjs";
import { setup } from "../workflow/helpers.mjs";

const lines = (root) => fs.readFileSync(path.join(root, SKILL_USAGE_REL), "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("SKIL-03 the hook appends one line per Skill call, ignores other tools and never answers", () => {
  const root = makeTempDir("skill usage ");
  const env = { CLAUDE_PROJECT_DIR: root, PASEO_AGENT_ID: "agent-1" };
  const now = () => new Date("2026-10-22T08:00:00.000Z");
  assert.equal(recordSkill({ tool_name: "Skill", tool_input: { skill: "gsd-execute", args: "x" }, session_id: "s1" }, { env, now }), null);
  assert.equal(recordSkill({ tool_name: "Read", tool_input: { file_path: "a" } }, { env, now }), null);
  assert.equal(recordSkill({ tool_name: "Skill", tool_input: { skill: "  " } }, { env, now }), null);
  recordSkill({ tool_name: "Skill", tool_input: { skill: "ph" } }, { env: { CLAUDE_PROJECT_DIR: root }, now });
  assert.deepEqual(lines(root), [
    { at: "2026-10-22T08:00:00.000Z", skill: "gsd-execute", agent: "agent-1", session: "s1" },
    { at: "2026-10-22T08:00:00.000Z", skill: "ph", agent: null, session: null },
  ]);
  assert.equal(SKILL_USAGE_REL, RUNTIME_REL, "the hook and the runtime read one file");
});

test("SKIL-03 run as a hook it exits 0 with no output, also when the log cannot be written", () => {
  const root = makeTempDir("skill usage run ");
  const input = JSON.stringify({ tool_name: "Skill", tool_input: { skill: "gsd-plan" }, cwd: root });
  const ok = runNode(path.join(HOOKS_DIR, "skill_usage.mjs"), [], { env: testEnv({ CLAUDE_PROJECT_DIR: root }), input });
  assert.deepEqual([ok.code, ok.stdout, ok.stderr], [0, "", ""]);
  assert.equal(lines(root)[0].skill, "gsd-plan");
  fs.writeFileSync(path.join(root, "blocked"), "x");
  const bad = runNode(path.join(HOOKS_DIR, "skill_usage.mjs"), [], { env: testEnv({ CLAUDE_PROJECT_DIR: path.join(root, "blocked") }), input });
  assert.deepEqual([bad.code, bad.stdout], [0, ""]);
});

test("SKIL-03 ph evolve-stats lists every project skill with the model's calls, a never-called one as 0", async () => {
  const s = setup();
  for (const name of ["gsd-execute", "gsd-research", "ph"]) s.project.write(`.claude/skills/${name}/SKILL.md`, `---\nname: ${name}\ndescription: d\n---\n`);
  const log = [["2026-10-20T09:00:00.000Z", "gsd-execute"], ["2026-10-21T09:00:00.000Z", "gsd-execute"], ["2026-10-21T10:00:00.000Z", "ph"], ["2026-10-19T10:00:00.000Z", "old-skill"]];
  s.project.write(SKILL_USAGE_REL, `${log.map(([at, skill]) => JSON.stringify({ at, skill })).join("\n")}\nnot json\n`);
  const r = await s.ph(["evolve-stats"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.out.filter((l) => l.startsWith("skill ")), [
    "skill gsd-execute: 2 calls by the model, last 2026-10-21",
    "skill old-skill: 1 calls by the model, last 2026-10-19",
    "skill ph: 1 calls by the model, last 2026-10-21",
    "skill gsd-research: 0 calls by the model",
  ]);
  const since = await s.ph(["evolve-stats", "--since", "2026-10-21"]);
  assert.deepEqual(since.out.filter((l) => l.startsWith("skill ")), ["skill gsd-execute: 1 calls by the model, last 2026-10-21", "skill ph: 1 calls by the model, last 2026-10-21", "skill gsd-research: 0 calls by the model"]);
  assert.equal((await s.ph(["evolve-stats", "--agent", "x"])).out.some((l) => l.startsWith("skill ")), false);
});
