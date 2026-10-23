// F49 (kit feedback 49): with gsd.isolation worktree, doctor and harness lint warn about a git-ignored path the adapter uses
// (its commands, its instruction files, or a toolchain folder) that adapter.worktree_setup does not set up, so a new worktree lacks it.
import assert from "node:assert/strict";
import test from "node:test";
import { findingLine, lintProject } from "../../ship/.agents/harness/adapter/lint.mjs";
import { loadConfigLenient } from "../../ship/.agents/harness/config.mjs";
import { connect } from "../../ship/.agents/harness/paseo-client/index.mjs";
import { runDoctor } from "../../ship/.agents/harness/runtime/doctor.mjs";
import { setup } from "../ph/setup.mjs";

// A Flutter-like project: upstream/ is named by the conventions file, .dart_tool/ is read by the toolchain, both git-ignored and present.
const FILES = {
  ".gitignore": "/upstream/\n.dart_tool/\n",
  "docs/CONVENTIONS.md": "The spec is the upstream app at `upstream/paseo/`.\n",
  "upstream/paseo/index.ts": "spec",
  ".dart_tool/package_config.json": "{}",
  ".dart_tool/package_graph.json": "{}",
  "lib/main.dart": "void main() {}",
};

const ADAPTER = {
  instructions: ["docs/CONVENTIONS.md"],
  commands: {
    build: ["node", "tools/adapter/flutter.mjs", "analyze"], test: ["node", "tools/adapter/flutter.mjs", "test"],
    build_timeout_s: 300, test_timeout_s: 600, gates: [], verify: {},
  },
};

function project({ adapter = {}, gsd, git = true } = {}) {
  return setup({ git, files: FILES, overlay: { adapter: { ...ADAPTER, ...adapter }, ...(gsd ? { gsd } : {}) } });
}

const gap = (shown) => `adapter.worktree_setup: ${shown} is git-ignored and used by the adapter, but no entry sets it up in a new worktree (add it to copy or link)`;

async function doctor(s) {
  const { cfg, error } = loadConfigLenient(s.root);
  const out = [];
  let session;
  const ctx = {
    env: s.env, root: s.root, cfg, configError: error, clock: s.clock, out: (l) => out.push(l),
    paseo: () => (session ??= connect({ env: s.env, root: s.root, cfg, clock: s.clock, daemon: s.fake.daemon })),
  };
  await runDoctor(ctx, { freemem: () => 64 * 2 ** 30, claudeVersionText: () => "2.1.300 (Claude Code)" });
  return out;
}

test("F49 doctor notes each git-ignored path the adapter uses that worktree_setup does not set up", async () => {
  const lines = await doctor(project());
  assert.ok(lines.includes(`note ${gap("upstream/")}`), lines.join("\n"));
  assert.ok(lines.includes(`note ${gap(".dart_tool/")}`), lines.join("\n"));
});

test("F49 a worktree_setup entry that sets a path up (or part of it) closes its gap", async () => {
  const s = project({ adapter: { worktree_setup: { copy: [".dart_tool/package_config.json", ".dart_tool/package_graph.json"], link: ["upstream"] } } });
  const lines = await doctor(s);
  assert.equal(lines.some((l) => /is git-ignored and used by the adapter/.test(l)), false, lines.join("\n"));
  assert.ok(lines.includes("ok worktree setup: 2 copy, 1 link path(s) present and git-ignored"), lines.join("\n"));
  const findings = lintProject(s.root).findings.map(findingLine);
  assert.equal(findings.some((l) => /is git-ignored and used by the adapter/.test(l)), false, findings.join("\n"));
});

test("F49 harness lint warns about the same gaps in the overlay", () => {
  const findings = lintProject(project().root).findings.map(findingLine);
  assert.ok(findings.includes(`warn .agents/harness.config.json: ${gap("upstream/")}`), findings.join("\n"));
  assert.ok(findings.includes(`warn .agents/harness.config.json: ${gap(".dart_tool/")}`), findings.join("\n"));
});

test("F49 a shared gsd.isolation never warns: new worktrees are not made", async () => {
  const s = project({ gsd: { isolation: "shared" } });
  assert.equal((await doctor(s)).some((l) => /is git-ignored and used by the adapter/.test(l)), false);
  assert.equal(lintProject(s.root).findings.map(findingLine).some((l) => /is git-ignored and used by the adapter/.test(l)), false);
});

test("F49 a project that is not a git repository gets no gap lines and no failed check", async () => {
  const s = project({ git: false });
  const lines = await doctor(s);
  assert.equal(lines.some((l) => /is git-ignored and used by the adapter/.test(l)), false, lines.join("\n"));
  assert.equal(lines.some((l) => l.startsWith("problem adapter")), false, lines.join("\n"));
});
