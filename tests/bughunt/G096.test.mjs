import assert from "node:assert/strict";
import test from "node:test";
import { P1, gsd, plan, project } from "../gsd-core/fixture.mjs";

const artifact = (path, minLines) => `    - path: ${path}\n      min_lines: ${minLines}\n`;

test("G096 an empty artifact counts as zero lines and a trailing newline does not add one", async () => {
  const extra = `  artifacts:\n${artifact("src/empty.js", 1)}${artifact("src/blank.js", 1)}${artifact("src/one.js", 2)}${artifact("src/crlf.js", 2)}${artifact("src/bare.js", 2)}`;
  const files = {
    [`${P1}/01-01-PLAN.md`]: plan({ extra }),
    "src/empty.js": "",
    "src/blank.js": "\n",
    "src/one.js": "one\n",
    "src/crlf.js": "a\r\nb\r\n",
    "src/bare.js": "foo",
  };
  const p = project({ files });
  const a = (await gsd(p, ["verify", "artifacts", "1", "--plans", "01"])).json;
  assert.deepEqual(
    a.results.map((r) => [r.path, r.status, r.issues]),
    [
      ["src/empty.js", "failed", ["0 lines < min_lines 1"]],
      ["src/blank.js", "passed", []],
      ["src/one.js", "failed", ["1 lines < min_lines 2"]],
      ["src/crlf.js", "passed", []],
      ["src/bare.js", "failed", ["1 lines < min_lines 2"]],
    ],
  );
  assert.equal(a.all_passed, false);
});
