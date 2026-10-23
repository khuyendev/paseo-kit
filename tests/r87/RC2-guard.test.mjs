// Kit feedback 87 C2: the self-repair guard hook. Workflow agents may not edit .agents/, .claude/, AGENTS.md or CLAUDE.md
// of their tree; no other session may edit a composition script or the overlay while a run of the project is live.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { isProtectedRel, retierOnly, runSelfRepairGuard, runTagOf } from "../../ship/.claude/hooks/self_repair_guard.mjs";
import { hookEnv, hookProject, runHookSync } from "../hooks/helpers.mjs";
import { makeTempDir } from "../helpers/temp.mjs";
import { setup as phSetup } from "../ph/setup.mjs";

const RUN = "wf_20261023-120000_c2c2";
const READY = "This message only loads your role. Reply with the single word READY; your task comes in the next message.";
const BATCH = "mcp__fsbatch__write_multiple_files";

function world({ overlay } = {}) {
  const project = hookProject({ overlay, files: { "src/app.txt": "a\n", ".agents/workflows/gsd-execute.js": "// composition\n" } });
  const root = project.root;
  const call = (tool_name, tool_input, { env = {}, cwd = root, transcript, pidAlive } = {}) => {
    const input = { hook_event_name: "PreToolUse", tool_name, tool_input, cwd, session_id: "s1" };
    if (transcript) {
      const file = path.join(makeTempDir("rc2 transcript "), "t.jsonl");
      fs.writeFileSync(file, `${transcript.map((e) => JSON.stringify(e)).join("\n")}\n`, "utf8");
      input.transcript_path = file;
    }
    return runSelfRepairGuard(input, { env: { CLAUDE_PROJECT_DIR: root, ...env }, ...(pidAlive ? { pidAlive } : {}) });
  };
  const liveRun = (status = "running", pid = process.pid) => project.writeJson(`_workspace/_runs/${RUN}/run.json`, { runId: RUN, status, pid });
  return { project, root, call, liveRun };
}

const decision = (r) => r?.output?.hookSpecificOutput?.permissionDecision ?? null;
const reason = (r) => r?.output?.hookSpecificOutput?.permissionDecisionReason ?? "";
const agent = { env: { PASEO_HARNESS_RUN: RUN } };
const prompt = (text) => ({ type: "user", message: { role: "user", content: text } });

test("RC2 a workflow agent is denied every kit, harness and composition file of its tree, through every edit tool", async () => {
  const w = world();
  for (const [tool, input] of [
    ["Edit", { file_path: ".agents/workflows/gsd-execute.js", old_string: "a", new_string: "b" }],
    ["Write", { file_path: path.join(w.root, ".agents", "harness.config.json"), content: "{}" }],
    ["MultiEdit", { file_path: path.join(w.root, ".claude", "settings.json"), edits: [] }],
    ["Write", { file_path: "AGENTS.md", content: "x" }],
    ["Edit", { file_path: path.join(w.root, "CLAUDE.md"), old_string: "a", new_string: "b" }],
    ["NotebookEdit", { notebook_path: ".claude/n.ipynb", new_source: "" }],
    ["mcp__harness-files__edit_multiple_files", { files: [{ path: ".agents/gsd/x.md", edits: [] }] }],
  ]) {
    const r = await w.call(tool, input, agent);
    assert.equal(decision(r), "deny", `${tool} ${JSON.stringify(input)}`);
    assert.match(reason(r), new RegExp(`started by workflow run ${RUN}`));
    assert.match(reason(r), /harness-evolve/);
  }
  const batch = await w.call(BATCH, { files: [{ path: "src/b.txt", content: "b" }, { path: ".claude/skills/x/SKILL.md", content: "x" }] }, agent);
  assert.equal(decision(batch), "deny");
  assert.match(reason(batch), /: \.claude\/skills\/x\/SKILL\.md\. /);
  assert.doesNotMatch(reason(batch), /src\/b\.txt/);
});

test("RC2 a workflow agent may edit its product files, nested AGENTS.md and the files of its own worktree", async () => {
  const w = world();
  const wt = w.project.path(".claude/worktrees/wf-1");
  fs.mkdirSync(path.join(wt, "src"), { recursive: true });
  fs.writeFileSync(path.join(wt, ".git"), "gitdir: elsewhere\n");
  assert.equal(await w.call("Edit", { file_path: "src/app.txt", old_string: "a", new_string: "b" }, agent), null);
  assert.equal(await w.call("Write", { file_path: "docs/AGENTS.md", content: "x" }, agent), null);
  assert.equal(await w.call(BATCH, { files: [{ path: "src/x.txt", content: "x" }] }, { ...agent, cwd: wt }), null);
  assert.equal(await w.call("Write", { file_path: path.join(wt, "src", "y.txt"), content: "y" }, agent), null);
  const own = await w.call("Write", { file_path: ".agents/harness.config.json", content: "{}" }, { ...agent, cwd: wt });
  assert.equal(decision(own), "deny", "the worktree's own .agents is protected too");
  const loose = await w.call("Write", { file_path: path.join(w.root, ".claude", "worktrees", "note.txt"), content: "x" }, agent);
  assert.equal(decision(loose), "deny", "a file under .claude/ outside every worktree");
});

test("RC2 a link into .agents is judged by where it leads", async () => {
  const w = world();
  fs.symlinkSync(w.project.path(".agents/workflows"), w.project.path("src/flows"), process.platform === "win32" ? "junction" : "dir");
  assert.equal(decision(await w.call("Write", { file_path: "src/flows/gsd-execute.js", content: "x" }, agent)), "deny");
  const scoped = world({ overlay: { self_repair: { enabled: true, allow: [".claude/skills/product/**"] } } });
  fs.mkdirSync(scoped.project.path(".claude/skills/product"), { recursive: true });
  fs.symlinkSync(scoped.project.path(".agents/workflows"), scoped.project.path(".claude/skills/product/flows"), process.platform === "win32" ? "junction" : "dir");
  const through = await scoped.call("Write", { file_path: ".claude/skills/product/flows/gsd-execute.js", content: "x" }, agent);
  assert.equal(decision(through), "deny", "an allowed spelling does not open the file a link leads to");
});

test("RC2 the run tag in the transcript marks a workflow agent whose creation env is gone (daemon relaunch)", async () => {
  const w = world();
  const tagged = `Task text.\n\n---\nRuntime notes:\n- Your final message is the return value.\n- Run ${RUN} #4 (bookkeeping only; ignore).`;
  const write = ["Write", { file_path: ".agents/workflows/gsd-execute.js", content: "x" }];
  assert.equal(decision(await w.call(...write, { transcript: [{ type: "summary" }, prompt(tagged)] })), "deny");
  assert.equal(decision(await w.call(...write, { transcript: [prompt([{ type: "text", text: tagged }])] })), "deny");
  const primed = [prompt(`Your role ...\n\n---\n\n${READY}`), { type: "assistant", message: { content: [{ type: "text", text: "READY" }] } }, prompt(tagged)];
  assert.match(reason(await w.call(...write, { transcript: primed })), new RegExp(RUN));
  // The orchestrator: its first prompt is the owner's, and a tag inside a tool result or a later prompt is no marker.
  const orchestrator = [prompt("plan phase 3"), { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t", content: tagged }] } }, prompt(tagged)];
  assert.equal(await w.call(...write, { transcript: orchestrator }), null);
  assert.equal(runTagOf(`${JSON.stringify(prompt(`${tagged}\nmore text after the tag`))}\n`), null);
});

test("RC2 the orchestrator edits composition freely between runs and is denied while a run is live", async () => {
  const w = world();
  const edit = ["Edit", { file_path: ".agents/workflows/gsd-execute.js", old_string: "composition", new_string: "changed" }];
  assert.equal(await w.call(...edit), null, "no run");
  assert.equal(await w.call("Write", { file_path: ".agents/agents/x.md", content: "x" }), null, "other harness files are the orchestrator's");
  w.liveRun("done");
  assert.equal(await w.call(...edit), null, "an ended run");
  w.liveRun("running");
  assert.equal(await w.call(...edit, { pidAlive: () => false }), null, "a running record whose runner is gone");
  const live = await w.call(...edit);
  assert.equal(decision(live), "deny");
  assert.match(reason(live), new RegExp(`workflow run ${RUN} of this project is live \\(runner pid ${process.pid}\\)`));
  assert.match(reason(live), new RegExp(`watch-run ${RUN}\``));
  assert.match(reason(live), new RegExp(`archive --run ${RUN} --reason <text>`));
  assert.doesNotMatch(reason(live), /tier change/);
  assert.equal(decision(await w.call(BATCH, { files: [{ path: ".agents/workflows/my-flow.js", content: "x" }] })), "deny");
  assert.equal(await w.call("Write", { file_path: ".agents/workflows/lib/gsd-flow.mjs", content: "x" }), null, "kit verbs are not the composition");
  assert.equal(await w.call("Write", { file_path: "src/app.txt", content: "x" }), null);
});

test("RC2 a live run keeps live retier: an overlay edit of tiers or GSD roles alone passes, anything else is denied", async () => {
  const overlay = { tiers: { standard: { provider: "circle/a" } }, gsd: { roles: { executor: { model: "standard" } }, granularity: "standard" }, max_subagents: 5 };
  const w = world({ overlay });
  w.liveRun();
  const text = w.project.read(".agents/harness.config.json");
  const file = ".agents/harness.config.json";
  const tier = await w.call("Edit", { file_path: file, old_string: "circle/a", new_string: "circle/b" });
  assert.equal(tier, null);
  const roles = { ...overlay, gsd: { ...overlay.gsd, roles: { executor: { model: "pro" } } }, tier_aliases: { fast: "standard" } };
  assert.equal(await w.call("Write", { file_path: file, content: JSON.stringify(roles) }), null);
  const caps = await w.call("Edit", { file_path: file, old_string: "\"max_subagents\": 5", new_string: "\"max_subagents\": 9" });
  assert.equal(decision(caps), "deny");
  assert.match(reason(caps), /A tier change alone/);
  const gate = { ...overlay, gsd: { ...overlay.gsd, granularity: "coarse" } };
  assert.equal(decision(await w.call("Write", { file_path: file, content: JSON.stringify(gate) })), "deny");
  assert.equal(decision(await w.call(BATCH, { files: [{ path: file, content: text.replace("circle/a", "circle/b") }] })), "deny", "a batch writer is not replayed");
  assert.equal(decision(await w.call("Edit", { file_path: file, old_string: "not in the file", new_string: "x" })), "deny");
  assert.equal(retierOnly(null, JSON.stringify({ tiers: {} })), true);
  assert.equal(retierOnly("{}", "not json"), false);
});

test("RC2 the owner scopes the guard in the overlay: allow globs, or off", async () => {
  const scoped = world({ overlay: { self_repair: { allow: [".claude/skills/product/**"] } } });
  assert.equal(await scoped.call("Write", { file_path: ".claude/skills/product/SKILL.md", content: "x" }, agent), null);
  assert.equal(decision(await scoped.call("Write", { file_path: ".claude/skills/other/SKILL.md", content: "x" }, agent)), "deny");
  const off = world({ overlay: { self_repair: { enabled: false } } });
  off.liveRun();
  assert.equal(await off.call("Write", { file_path: ".agents/workflows/gsd-execute.js", content: "x" }, agent), null);
  assert.equal(await off.call("Write", { file_path: ".agents/workflows/gsd-execute.js", content: "x" }), null);
});

test("RC2 an overlay that does not load keeps the boundary closed and says so", async () => {
  const w = world({ overlay: { max_subagents: "many" } });
  const r = await w.call("Write", { file_path: ".agents/workflows/gsd-execute.js", content: "x" }, agent);
  assert.equal(decision(r), "deny");
  assert.match(r.warning, /invalid harness config max_subagents/);
});

test("RC2 the installed hook process denies with exit 0 and stays silent for a non-workflow session", () => {
  const w = world();
  const input = { hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: ".agents/workflows/gsd-execute.js", content: "x" }, cwd: w.root };
  const denied = runHookSync(w.root, "self_repair_guard.mjs", input, { env: hookEnv(w.root, { PASEO_HARNESS_RUN: RUN }) });
  assert.equal(denied.code, 0, denied.stderr);
  const out = JSON.parse(denied.stdout).hookSpecificOutput;
  assert.equal(out.hookEventName, "PreToolUse");
  assert.equal(out.permissionDecision, "deny");
  const free = runHookSync(w.root, "self_repair_guard.mjs", input, { env: hookEnv(w.root) });
  assert.deepEqual([free.code, free.stdout, free.stderr], [0, "", ""]);
});

test("RC2 protected paths: first segment .agents or .claude, or the root AGENTS.md / CLAUDE.md", () => {
  for (const rel of [".agents/x", ".claude/settings.json", "AGENTS.md", "CLAUDE.md"]) assert.equal(isProtectedRel(rel), true, rel);
  for (const rel of ["src/.agents.txt", "docs/AGENTS.md", "ship/.claude/hooks/x.mjs", "agents/x.md"]) assert.equal(isProtectedRel(rel), false, rel);
});

test("RC2 ph doctor names a guard the owner turned off or scoped", async () => {
  const off = phSetup({ overlay: { self_repair: { enabled: false } } });
  assert.match((await off.ph(["doctor"])).stdout, /note self_repair\.enabled is false in \.agents\/harness\.config\.json/);
  const scoped = phSetup({ overlay: { self_repair: { allow: [".claude/skills/p/**"] } } });
  assert.match((await scoped.ph(["doctor"])).stdout, /note self_repair\.allow lets workflow agents write \.claude\/skills\/p\/\*\*/);
  assert.doesNotMatch((await phSetup().ph(["doctor"])).stdout, /self_repair/);
});

test("RC2 harness-evolve and kit-adapter section 11 carry the composition-evolution procedure", () => {
  const skills = path.join(import.meta.dirname, "..", "..", "ship", ".claude", "skills");
  const evolve = fs.readFileSync(path.join(skills, "harness-evolve", "SKILL.md"), "utf8");
  assert.match(evolve, /^Kit overlay: .*workflow composition .*between workflow runs only|^Kit overlay: .*between workflow runs only, the project's workflow composition/m);
  const overlay = fs.readFileSync(path.join(skills, "harness", "references", "kit-adapter.md"), "utf8").replace(/\r\n/g, "\n");
  const section = overlay.slice(overlay.indexOf("### Composition evolution"));
  for (const s of ["Between runs only", "self-repair guard", "Proposal from run evidence", "read-only reviewer agent", "ph.mjs harness lint", "`composition:`", "kit pull candidate", "kit.mjs\n   status <project>"]) {
    assert.ok(section.includes(s), `section 11 names ${JSON.stringify(s)}`);
  }
});
