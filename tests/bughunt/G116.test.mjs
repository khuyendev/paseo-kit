// Regression test for G116: a formatting-only edit to a debug session's Symptoms must not invalidate the session.
import assert from "node:assert/strict";
import test from "node:test";
import { textDigest } from "../../ship/.agents/harness/lib/hash.mjs";
import { gsd, project } from "../gsd-core/fixture.mjs";

const file = ".planning/debug/login-fails.md";
const input = { signature: { kind: "test", key: "auth.login", label: "Login fails" }, symptoms: { expected: "200 with a token", actual: "500", errors: "TypeError: x is undefined while parsing the login token payload", reproduction: "npm test", started: "today" }, owns: ["Path:src/auth/"], goal: "find_and_fix" };
const status = (p) => gsd(p, ["debug", "status", "login-fails"]);

test("G116 debug symptoms: reflow, indent, trailing space, blank line and CRLF pass; a changed word still fails", async () => {
  const p = project();
  await gsd(p, ["debug", "create"], { stdin: JSON.stringify(input) });
  const original = p.read(file);
  const formatting = {
    reflow: (t) => t.replace("    TypeError: x is undefined while parsing the login token payload", "    TypeError: x is undefined\n    while parsing the login token payload"),
    indent: (t) => t.replace(/^    500$/m, "  500"),
    trailingSpace: (t) => t.replace(/^    500$/m, "    500   "),
    blankLineInside: (t) => t.replace(/^    TypeError/m, "\n    TypeError"),
    crlf: (t) => t.replace(/\n/g, "\r\n"),
  };
  for (const [name, edit] of Object.entries(formatting)) {
    p.write(file, edit(original));
    const st = await status(p);
    assert.equal(st.code, 0, `${name}: ${JSON.stringify(st.json?.problems)}`);
  }
  p.write(file, original.replace("TypeError: x is undefined", "TypeError: y is undefined"));
  const changed = await status(p);
  assert.equal(changed.code, 1);
  assert.match(changed.json.problems.join(), /Symptoms changed/);
});

test("G116 legacy sessions: a digest of the raw Symptoms section still passes while those bytes are unchanged", async () => {
  const p = project();
  await gsd(p, ["debug", "create"], { stdin: JSON.stringify(input) });
  const text = p.read(file);
  const raw = text.split("## Symptoms\n")[1].split(/\n## /)[0].trim();
  p.write(file, text.replace(/^symptoms_hash: .*$/m, `symptoms_hash: "${textDigest(raw)}"`));
  assert.equal((await status(p)).code, 0);
  p.write(file, text.replace("    500", "    501"));
  assert.match((await status(p)).json.problems.join(), /Symptoms changed/);
});
