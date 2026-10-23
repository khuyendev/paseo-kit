// G135: a history Scope (or a --script reference) that leaves the project is reported and never walked or linted.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeTempDir, makeTempProject } from "../helpers/temp.mjs";
import { findingLine, lintProject } from "../../ship/.agents/harness/adapter/lint.mjs";
import { HISTORY_REL } from "../../ship/.agents/harness/adapter/records.mjs";

const OVERLAY = {
  adapter: {
    commands: { build: ["npm", "run", "build"], test: ["npm", "test"], build_timeout_s: 300, test_timeout_s: 600, gates: [], verify: {} },
    verify_vocabulary: { build: { prefix: "build", parser: null, resolver: null, runner: null, evidence_parser: null, exit_code_sufficient: true }, cmd: { prefix: "cmd:", parser: null, resolver: null, runner: null, evidence_parser: null, exit_code_sufficient: true } },
  },
  gsd: { roles: {} },
};

const history = (scope) => `# Harness history

| Date | Change | Scope | Reason | Supersedes |
|------|--------|-------|--------|------------|
| 2026-10-20 | Generate adapter | ${scope} | map-codebase done | |
`;

// Findings that name the outside folder, except the history row's own "leaves the repository" problem.
const leaks = (findings, name) => findings.filter((f) => `${f.file} ${f.msg}`.includes(name) && !/leaves the repository/.test(f.msg)).map(findingLine);

test("G135 a history scope that leaves the project is reported and the folder outside it is not linted", () => {
  const outside = makeTempDir("paseo kit outside ");
  const name = path.basename(outside);
  fs.writeFileSync(path.join(outside, "leak.md"), "Call TaskCreate({ subject: 'x' }) when done.\n");
  const p = makeTempProject({ git: false, overlay: OVERLAY, files: { [HISTORY_REL]: history(`docs/, ../${name}`), "docs/ok.md": "# ok\n" } });
  const { findings } = lintProject(p.root);
  assert.ok(findings.some((f) => f.file === HISTORY_REL && /scope path \.\.\/.* leaves the repository/.test(f.msg)));
  assert.deepEqual(leaks(findings, name), []);
});

test("G135 a --script reference that leaves the project is not read from outside it", () => {
  // --script operands take no spaces, so this folder has a plain name.
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "g135-outside-"));
  const name = path.basename(outside);
  try {
    fs.writeFileSync(path.join(outside, "run.js"), "const t = Date.now()\nreturn t\n");
    const skill = `---\nname: web-stack\ndescription: "Write code. Use when editing src/."\n---\n\nRun \`node .agents/harness/ph.mjs workflow --script ../${name}/run.js\`.\n`;
    const p = makeTempProject({ git: false, overlay: OVERLAY, files: { [HISTORY_REL]: history(".claude/skills/web-stack/"), ".claude/skills/web-stack/SKILL.md": skill } });
    const { findings } = lintProject(p.root);
    assert.ok(findings.some((f) => f.file === ".claude/skills/web-stack/SKILL.md"), "the in-project skill is still linted");
    assert.deepEqual(leaks(findings, name), []);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
