import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { WORKFLOW_OPTIONS, workflowCommand } from "../../ship/.agents/harness/workflow/cmd-workflow.mjs";
import { loadJournalCache } from "../../ship/.agents/harness/workflow/journal.mjs";
import { makeTempDir } from "../helpers/temp.mjs";
import { makeCtx, meta, setup } from "../workflow/helpers.mjs";

test("G136 the source journal pruned after resume setup still feeds the cache: no agent reruns", async () => {
  const s = setup();
  s.project.write("wf.js", `${meta()}const a = await agent("one"); const b = await agent("two"); return [a, b];`);
  assert.equal((await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_src"])).code, 0);
  assert.equal(s.fake.callsOf("createAgent").length, 2);
  const { ctx, lines } = makeCtx({ project: s.project, fake: s.fake, clock: s.clock, env: s.env, argv: ["--resume", "wf_src", "--run-id", "wf_dst"], options: WORKFLOW_OPTIONS });
  const connect = ctx.paseo;
  // A prune of the source run lands after the resume checks, while the daemon is being reached.
  ctx.paseo = async () => {
    fs.rmSync(s.project.path("_workspace/_runs/wf_src/journal.jsonl"));
    return connect();
  };
  assert.equal(await workflowCommand(ctx), 0, lines.join("\n"));
  assert.equal(s.fake.callsOf("createAgent").length, 2);
  assert.match(lines.at(-1), /^workflow done wf_dst: .+ \(ok 0, null 0, cached 2, /);
});

test("G136 a missing source journal is a usage error, not an empty cache", () => {
  const dir = makeTempDir();
  assert.throws(() => loadJournalCache(`${dir}/gone.jsonl`), /cannot resume: .*gone\.jsonl not found/);
});
