// Kit feedback 113 (P115). F1: `ph gsd hand-edit record --amend` replaces the note of a logged record and keeps the
// old note in `history`. F2: the usage line names the 300-character limit and a too-long note reports the length given.
import assert from "node:assert/strict";
import test from "node:test";
import { verbHandlers } from "../../ship/.agents/harness/gsd/verbs.mjs";
import { P1, gsd, plan, project } from "../gsd-core/fixture.mjs";

const PLAN1 = `${P1}/01-01-PLAN.md`;
const rec = (p, key, ...more) => gsd(p, ["revisions", "record", "1", key, ...more]);
const logEdit = (p, ref, category, note = "fixed by hand") => gsd(p, ["hand-edit", "record", "1", ref, "--category", category, "--note", note]);
const amend = (p, ref, note, category) => gsd(p, ["hand-edit", "record", "1", ref, ...(category ? ["--category", category] : []), "--note", note, "--amend"]);

test("P115 113 F2 the hand-edit record usage names 300 characters and the error prints the length given", async () => {
  assert.match(verbHandlers["hand-edit.record"].usage, /at most 300 characters/);
  assert.match(verbHandlers["hand-edit.record"].usage, /--amend/);
  const p = project({ files: { [PLAN1]: plan({ id: "01" }) } });
  await rec(p, "plan:01-01", "--settings", "S");
  p.write(PLAN1, `${plan({ id: "01" })}\nhand fix\n`);
  const scan = await gsd(p, ["hand-edit", "scan", "1"]);
  assert.match(scan.json.ask, /at most 300 characters/);
  const note = "x".repeat(301);
  const bad = await logEdit(p, "HE-1", "other", note);
  assert.equal(bad.code, 1);
  assert.match(bad.json?.error ?? bad.err.join(" "), /at most 300 characters \(got 301\)/);
  const multi = await logEdit(p, "HE-1", "other", "ab\ncd");
  assert.equal(multi.code, 1);
  assert.match(multi.json?.error ?? multi.err.join(" "), /got 5/);
});

test("P115 113 F1 --amend replaces a logged note and keeps the old notes in history", async () => {
  const p = project({ files: { [PLAN1]: plan({ id: "01" }) } });
  await rec(p, "plan:01-01", "--settings", "S");
  p.write(PLAN1, `${plan({ id: "01" })}\nhand fix\n`);
  await gsd(p, ["hand-edit", "scan", "1"]);
  const first = await logEdit(p, "HE-1", "other", "placeholder");
  assert.equal(first.code, 0);
  const again = await logEdit(p, "HE-1", "contract-drift", "the real reason");
  assert.equal(again.code, 1);
  assert.match(again.json?.error ?? "", /already logged/);
  const fixed = await amend(p, "HE-1", "the real reason");
  assert.equal(fixed.code, 0, fixed.err?.join?.(" ") ?? JSON.stringify(fixed.json));
  const second = await amend(p, "HE-1", "corrected again", "contract-drift");
  assert.equal(second.code, 0, JSON.stringify(second.json));
  const [edit] = p.readJson(`${P1}/hand-edits.json`).edits;
  assert.equal(edit.note, "corrected again");
  assert.equal(edit.category, "contract-drift");
  assert.deepEqual(edit.history.map((h) => [h.note, h.category]), [["placeholder", "other"], ["the real reason", "other"]]);
  assert.ok(edit.history.every((h) => typeof h.at === "string" && h.at));
  const same = await amend(p, "HE-1", "corrected again");
  assert.equal(same.code, 0);
  assert.equal(p.readJson(`${P1}/hand-edits.json`).edits[0].history.length, 2, "an unchanged note is not appended again");
  const pending = await amend(p, "HE-9", "no such record");
  assert.equal(pending.code, 1);
  assert.match(pending.json?.error ?? "", /not a logged hand edit/);
});
