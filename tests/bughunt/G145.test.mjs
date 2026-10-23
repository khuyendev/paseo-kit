// G145: the resume cache keys the effective read-only mode and the prompt notes, not the raw model spelling.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cacheKey, readJournal } from "../../ship/.agents/harness/workflow/journal.mjs";
import { SHIP_DIR } from "../helpers/temp.mjs";
import { TIERS, meta, setup } from "../workflow/helpers.mjs";

const ROLE = "---\nname: reviewer\ntools: Read, Grep\n---\nYou review things.\n";
const created = (fake) => fake.callsOf("createAgent").map((c) => c.args[0]);
const journal = (s, id) => readJournal(path.join(s.project.path(`_workspace/_runs/${id}`), "journal.jsonl"));
const cachedLines = (r) => r.out.filter((l) => l.startsWith("agent cached"));

test("G145 the key holds the effective read-only mode and the notes digest, not the raw model spelling", () => {
  const id = { roleHash: "h", model: "circle/mid", effort: null, readOnly: false, notesHash: "n1" };
  const k = cacheKey("x", { model: "pro" }, id);
  assert.equal(cacheKey("x", { model: "circle/mid" }, id), k);
  assert.equal(cacheKey("x", {}, id), k);
  assert.notEqual(cacheKey("x", {}, { ...id, readOnly: true }), k);
  assert.notEqual(cacheKey("x", {}, { ...id, notesHash: "n2" }), k);
  assert.notEqual(cacheKey("x", {}, { ...id, model: "circle-agent/big" }), k);
});

test("G145 an edited definition that changes the read-only mode reruns the call", async () => {
  const s = setup({ files: { ".agents/agents/rev.md": ROLE } });
  s.project.write("wf.js", `${meta()}return await agent("check x", { agentType: "rev" });`);
  assert.equal((await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_1"])).code, 0);
  s.project.write(".agents/agents/rev.md", ROLE.replace("Read, Grep", "Read, Grep, Edit, Write"));
  const r = await s.ph(["workflow", "--resume", "wf_1", "--run-id", "wf_2"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(cachedLines(r), []);
  const [first, second] = created(s.fake);
  assert.match(first.initialPrompt, /Read-only role/);
  assert.doesNotMatch(second.initialPrompt, /Read-only role/);
});

test("G145 a changed project prompt note reruns the call that would carry it", async () => {
  const s = setup();
  s.project.write("wf.js", `${meta()}return await agent("check x");`);
  assert.equal((await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_1"])).code, 0);
  s.project.writeJson(".agents/harness.config.json", { ...TIERS, project_prompt_note: "Report the file count first." });
  const r = await s.ph(["workflow", "--resume", "wf_1", "--run-id", "wf_2"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(cachedLines(r), []);
  assert.equal(s.fake.callsOf("createAgent").length, 2);
  assert.match(created(s.fake)[1].initialPrompt, /Report the file count first\./);
});

test("G145 the same resolved model under another spelling is a cache hit; a different resolved model misses", async () => {
  const s = setup();
  s.project.write("wf.js", `${meta()}return await agent("x", { model: "pro" });`);
  assert.equal((await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_1"])).code, 0);
  s.project.write("wf.js", `${meta()}return await agent("x", { model: "circle/mid" });`);
  const same = await s.ph(["workflow", "--resume", "wf_1", "--script", "wf.js", "--run-id", "wf_2"]);
  assert.equal(same.code, 0, same.stderr);
  assert.equal(s.fake.callsOf("createAgent").length, 1);
  assert.ok(journal(s, "wf_2").some((e) => e.status === "cached"));
  s.project.write("wf.js", `${meta()}return await agent("x", { model: "frontier" });`);
  const other = await s.ph(["workflow", "--resume", "wf_2", "--script", "wf.js", "--run-id", "wf_3"]);
  assert.equal(other.code, 0, other.stderr);
  assert.equal(s.fake.callsOf("createAgent").length, 2);
});

test("G145 the resume contract says a skill file is not keyed, so a skill edit needs a fresh run", () => {
  const contract = fs.readFileSync(path.join(SHIP_DIR, ".claude", "skills", "harness", "references", "paseo-runtime.md"), "utf8");
  assert.match(contract, /a skill file the prompt tells the agent to read, does not invalidate/);
});
