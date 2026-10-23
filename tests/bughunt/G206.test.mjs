// G206: the verifier guidance names the artifact issues and statuses that `verify artifacts` actually returns.
import assert from "node:assert/strict";
import test from "node:test";
import { loadAgentDef } from "../../ship/.agents/harness/runtime/agents.mjs";
import { SHIP_DIR } from "../helpers/temp.mjs";
import { P1, gsd, plan, project } from "../gsd-core/fixture.mjs";

// The checker's numbers and names vary per artifact; the guidance names each message once with N, M or X.
const shape = (issue) => issue.replace(/^\d+ lines < min_lines \d+$/, "N lines < min_lines M").replace(/^(does not (?:contain|export)) .+$/, "$1 X");

test("G206 verifier guidance names every artifact issue and status the checker returns", async () => {
  const extra = `  artifacts:\n    - path: src/a.js\n      min_lines: 30\n    - path: src/a.js\n      contains: needle\n    - path: src/a.js\n      exports: Other\n    - path: src/missing.js\n    - path: src\n    - path: ../outside.js\n`;
  const p = project({ files: { [`${P1}/01-01-PLAN.md`]: plan({ extra }), "src/a.js": "const Thing = 1;\n" } });
  const r = await gsd(p, ["verify", "artifacts", "1", "--plans", "01"]);
  assert.equal(r.code, 1);
  const statuses = new Set(r.json.artifacts.map((a) => a.status));
  assert.deepEqual([...statuses].sort(), ["directory", "failed", "missing", "path_rejected"]);
  const issues = new Set(r.json.artifacts.flatMap((a) => a.issues.map(shape)));
  assert.equal(issues.size, 6, [...issues].join("; "));

  const def = loadAgentDef(SHIP_DIR, "gsd-verifier");
  const guidance = [def.body, ...def.includes.map((i) => i.text)].join("\n");
  for (const issue of issues) assert.ok(guidance.includes(issue), `verifier guidance does not name the issue: ${issue}`);
  for (const status of statuses) assert.ok(guidance.includes(`\`${status}\``), `verifier guidance does not name the status: ${status}`);
});
