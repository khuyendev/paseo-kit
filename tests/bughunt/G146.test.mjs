import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { loadConfig } from "../../ship/.agents/harness/config.mjs";
import { readJournal } from "../../ship/.agents/harness/workflow/journal.mjs";
import { createWorktree, runGit } from "../../ship/.agents/harness/runtime/worktrees.mjs";
import { createFakeClock } from "../fakes/fake-clock.mjs";
import { CALLER, meta, setup, tick } from "../workflow/helpers.mjs";

// G146: timeoutS bounds agent creation and the worktree step too, not only the turns after them.

test("G146 a create that never answers ends the call at timeoutS; a late agent is archived and the worktree kept", async () => {
  const clock = createFakeClock({ auto: false });
  const s = setup({ clock, git: true });
  const realCreate = s.fake.client.createAgent;
  let answer = null;
  let creates = 0;
  s.fake.client.createAgent = (options) => {
    creates++;
    return new Promise((resolve) => (answer = () => resolve(realCreate(options))));
  };
  s.project.write("wf.js", `${meta()}return await agent("x", { timeoutS: 5, isolation: "worktree" });`);
  let res = null;
  const run = s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_g"]).then((r) => (res = r));
  for (let i = 0; i < 20 && !res; i++) {
    await clock.advance(1000);
    await tick();
  }
  assert.ok(res, "the call did not end at its timeoutS");
  await run;
  assert.equal(res.code, 0, res.stderr);
  const e = readJournal(s.project.path("_workspace/_runs/wf_g/journal.jsonl")).find((x) => x.status === "null");
  assert.equal(e?.reason, "no reply within 5 s");
  assert.equal(creates, 1);
  assert.equal(s.project.git("worktree", "list").trim().split("\n").length, 2, "the worktree stays while a late create may still start an agent in it");

  answer();
  for (let i = 0; i < 3; i++) await tick();
  const late = [...s.fake.agents.values()].find((a) => a.id !== CALLER);
  assert.ok(late?.archivedAt, "the agent created after the deadline is archived");
});

test("G146 the worktree step gets the call's remaining time as its git timeout", async () => {
  const s = setup({ git: true });
  const cfg = loadConfig(s.project.root);
  const seen = [];
  const git = (cwd, args, opts) => {
    seen.push({ sub: args.slice(0, 2).join(" "), timeoutMs: opts?.timeoutMs });
    return runGit(cwd, args, opts);
  };
  const wt = await createWorktree(s.project.root, cfg, "budget", { git, timeoutMs: 4000 });
  assert.equal(path.basename(wt.path), "budget");
  const add = seen.find((c) => c.sub === "worktree add").timeoutMs;
  assert.ok(add > 3000 && add <= 4000, `worktree add got ${add} ms`);
  assert.ok(seen.every((c) => c.timeoutMs > 0 && c.timeoutMs <= 4000), JSON.stringify(seen));
});
