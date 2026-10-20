// `.planning/` fixtures and a fake workspace API for the planning panel tests.
import fs from "node:fs";
import path from "node:path";
import { makeTempDir } from "../helpers/temp.mjs";

export function write(root, rel, text) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, "utf8");
  return abs;
}

export function planText({ phase = "01-core", plan = "01", wave = 1, depends = [], extra = null, body = null } = {}) {
  return [
    "---",
    `phase: ${phase}`,
    `plan: ${plan}`,
    "type: execute",
    `wave: ${wave}`,
    `depends_on: [${depends.map((d) => `"${d}"`).join(", ")}]`,
    "files_modified: [src/a.ts]",
    "autonomous: true",
    "requirements: [REQ-01]",
    "must_haves:",
    "  truths:",
    '    - "User sees the thing"',
    "  artifacts:",
    "    - path: src/a.ts",
    '      provides: "the thing"',
    "  key_links: []",
    extra,
    "---",
    "",
    "<objective>",
    "Build the thing.",
    "",
    "Purpose: because.",
    "</objective>",
    "",
    "<tasks>",
    '<task type="auto">',
    "  <name>Task 1: write a</name>",
    "  <files>src/a.ts, src/b.ts</files>",
    "  <action>do</action>",
    "</task>",
    '<task type="checkpoint:decision" gate="blocking">',
    "  <decision>Pick a db</decision>",
    "</task>",
    "</tasks>",
    body,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

export function summaryText(status, created = ["src/a.ts"]) {
  return `---\nphase: 01-core\nplan: 01\n${status ? `status: ${status}\n` : ""}key-files:\n  created: [${created.join(", ")}]\n  modified: []\nnotes: |\n  multi\n  line\n---\n\n# Summary\n\nDone it.\n`;
}

export function makeWorkspace() {
  const dir = makeTempDir("ui planning ws ");
  return { dir, root: path.join(dir, ".planning") };
}

export function fakeWorkspaces(map) {
  return {
    workspaces: {
      ref: (id) => ({
        directory: null,
        current: () => (map[id] ? { workspaceDirectory: map[id] } : null),
        refresh: async () => null,
      }),
    },
  };
}

// A ladder for tests that only need some status per phase: plan/summary counts from the directory.
export const countingLadder = {
  async forWorkspace() {
    return (phaseDir) => {
      const names = fs.readdirSync(phaseDir);
      const plans = names.filter((n) => /-\d+-PLAN\.md$/.test(n)).length;
      const sums = names.filter((n) => /-\d+-SUMMARY\.md$/.test(n)).length;
      if (names.includes("complete.json")) return "COMPLETE";
      if (plans === 0) return "NOT_STARTED";
      if (sums === 0) return "PLANNED";
      return sums < plans ? "IN_PROGRESS" : "EXECUTED";
    };
  },
};
