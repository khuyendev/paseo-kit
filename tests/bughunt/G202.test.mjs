// Bug-hunt fix G202 (kit-feedback #8): a documented delegated discuss mode, where the main session answers the gray
// areas under the owner's recorded delegation, logs its rationale and marks each decision as delegated.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { SHIP_DIR } from "../helpers/temp.mjs";

const read = (p) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const discuss = read(path.join(SHIP_DIR, ".claude", "skills", "gsd-discuss", "SKILL.md"));
const overlay = read(path.join(SHIP_DIR, ".agents", "workflows", "gsd-overlay.md"));
const { parseDecisions } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents", "harness", "gsd", "plan-checks.mjs")).href);

test("G202 gsd-discuss documents a delegated mode: the owner's words are the recorded authority", () => {
  assert.match(discuss, /## Delegated discuss/);
  assert.match(discuss, /only when the owner's message for this phase delegates the answers in plain words/);
  assert.match(discuss, /never by a default, an empty reply or an earlier run/);
  assert.match(discuss, /`"delegated": \{"by": "owner", "authority": "<the owner's words, quoted>"\}`/);
  assert.match(discuss, /DISCUSS-CHECKPOINT\.json` before the first answer/);
});

test("G202 delegated answers are the main session's own, logged, tagged and shown to the owner", () => {
  assert.match(discuss, /the main session answers each gray area itself, within the quoted authority/);
  assert.match(discuss, /never asks the owner and never lets a worker answer/);
  assert.match(discuss, /- \*\*D-NN:\*\* \[delegated\] text/);
  assert.match(discuss, /`<NN>-DISCUSSION-LOG\.md`[^\n]*rationale/);
  assert.match(discuss, /list every `\[delegated\]` decision with its one-line reason in the reply/);
});

test("G202 delegation stops at what it does not cover and keeps the refused modes refused", () => {
  assert.match(discuss, /a gray area outside the quoted authority goes back to the owner as a numbered question/);
  assert.match(discuss, /`--auto` and `--chain` stay refused/);
  assert.match(discuss, /an empty reply is not approval/);
  assert.ok(discuss.includes("`--power`, `--auto`, `--chain`, advisor, `--ws`, `--batch`, `--analyze`"));
});

test("G202 the overlay names the delegated discuss as the one exception to owner-answered questions", () => {
  assert.match(overlay, /Questions are numbered plain text; wait for the answer; an empty reply is not approval; the one exception is a delegated discuss \(gsd-discuss\)/);
});

test("G202 a delegated decision stays trackable, so the plan coverage gate still covers it", () => {
  const { decisions, malformed } = parseDecisions("<decisions>\n- **D-07:** [delegated] keep the cache per phase\n</decisions>\n");
  assert.deepEqual(malformed, []);
  assert.equal(decisions[0].id, "D-07");
  assert.ok(decisions[0].tags.includes("delegated"));
  assert.equal(decisions[0].trackable, true);
});
