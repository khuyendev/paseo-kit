import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readJournal } from "../../ship/.agents/harness/workflow/journal.mjs";
import { meta, setup } from "../workflow/helpers.mjs";

const REASON = "agent stopped: permission Bash was not granted";

// G131: the runner archives a permission-blocked agent before the call returns, so the reason must say it was stopped.
test("G131 a permission-blocked agent is stopped and archived; the journal, the detail result and the done line say so", async () => {
  const s = setup({ responder: (a, text) => (text.includes("@perm@") ? [{ permission: { name: "Bash" } }] : [{ reply: "ok" }]) });
  s.project.write("wf.js", `${meta()}return await agent("@perm@", { detail: true, label: "blocked" });`);
  const r = await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_g"]);
  assert.equal(r.code, 0, r.stderr);
  const runDir = s.project.path("_workspace/_runs/wf_g");
  const [entry] = readJournal(path.join(runDir, "journal.jsonl")).filter((e) => e.status === "null");
  assert.equal(entry.reason, REASON);
  const detail = JSON.parse(fs.readFileSync(path.join(runDir, "result.json"), "utf8"));
  assert.equal(detail.reason, REASON);
  assert.equal(detail.agentId, entry.agentId);
  assert.ok(r.out.some((l) => l.startsWith(`agent done #1 blocked null (${REASON}) `)), r.out.join("\n"));
  assert.equal(s.fake.callsOf("archiveAgent").filter((c) => c.args[0] === entry.agentId).length, 1, "FLOW-25 one archive for the stopped agent");
});
