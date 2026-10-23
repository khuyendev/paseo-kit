// G200: adapter paths and worktree_dir stay inside the project, and cleanup removes only links inside a worktree.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { ConfigError, loadConfig, loadKitConfig } from "../../ship/.agents/harness/config.mjs";
import { findingLine, lintProject } from "../../ship/.agents/harness/adapter/lint.mjs";
import { removeSetupLinks } from "../../ship/.agents/harness/runtime/worktree-setup.mjs";
import { createWorktree, runGit } from "../../ship/.agents/harness/runtime/worktrees.mjs";
import { makeTempDir, makeTempProject } from "../helpers/temp.mjs";

const JUNCTION = process.platform === "win32" ? "junction" : "dir";

// A project whose overlay sets the adapter section (entries replace whole) or worktree_dir.
const withOverlay = (overlay) => () => loadConfig(makeTempProject({ git: false, overlay }).root);

function failsOn(fn, key, message) {
  assert.throws(fn, (e) => {
    assert.ok(e instanceof ConfigError, `not a ConfigError: ${e}`);
    assert.equal(e.key, key);
    assert.match(e.message, message);
    return true;
  });
}

const verifyWith = (parser) => {
  const vocab = structuredClone(loadKitConfig().adapter.verify_vocabulary);
  vocab.build.parser = parser;
  return vocab;
};

test("G200 adapter instructions and scripts must be repo-relative: no absolute path, no drive, no .. escape", () => {
  failsOn(withOverlay({ adapter: { instructions: ["../outside/PROJECT-RULES.md"] } }), "adapter.instructions[0]", /expected a repo-relative path/);
  failsOn(withOverlay({ adapter: { instructions: ["docs/ok.md", "/etc/rules.md"] } }), "adapter.instructions[1]", /expected a repo-relative path/);
  failsOn(withOverlay({ adapter: { instructions: ["C:/rules.md"] } }), "adapter.instructions[0]", /expected a repo-relative path/);
  failsOn(withOverlay({ adapter: { verify_vocabulary: verifyWith("../outside/parse.mjs") } }), "adapter.verify_vocabulary.build.parser", /expected a repo-relative path/);
  failsOn(withOverlay({ adapter: { attribution: "..\\outside\\attr.mjs" } }), "adapter.attribution", /expected a repo-relative path/);
  failsOn(withOverlay({ adapter: { ownership: { owns_forms: [{ prefix: "Path:", maps_to: "<path>" }], shared: { globs: [], predicate: "/abs/pred.mjs" }, source_roots: [], ignore: [] } } }), "adapter.ownership.shared.predicate", /expected a repo-relative path/);
  // Repo paths that stay inside the repo still load, with or without ./ and inner ..
  const cfg = withOverlay({ adapter: { instructions: ["./CLAUDE.md", "docs/a/../rules.md"] } })();
  assert.deepEqual(cfg.adapter.instructions, ["./CLAUDE.md", "docs/a/../rules.md"]);
});

test("G200 worktree_dir must stay strictly inside the repo: no absolute path, no drive, no .. escape, not the repo itself", () => {
  for (const bad of ["../outside", "/outside", "C:/outside", "C:\\outside", "\\\\server\\share", ".", "wt/../../x"]) {
    failsOn(withOverlay({ worktree_dir: bad }), "worktree_dir", /expected a repo-relative path/);
  }
  assert.equal(withOverlay({ worktree_dir: ".claude/worktrees" })().worktree_dir, ".claude/worktrees");
  assert.equal(withOverlay({ worktree_dir: "wt/a/../b" })().worktree_dir, "wt/a/../b");
});

test("G200 lint fails an adapter script or instruction whose link leads outside the project", () => {
  const outside = makeTempDir("paseo kit outside ");
  fs.writeFileSync(path.join(outside, "PROJECT-RULES.md"), "rules");
  const p = makeTempProject({ git: false, overlay: { adapter: { instructions: ["linked/PROJECT-RULES.md"] } } });
  fs.symlinkSync(outside, path.join(p.root, "linked"), JUNCTION);
  const lines = lintProject(p.root).findings.map(findingLine);
  assert.ok(lines.includes("fail .agents/harness.config.json: adapter.instructions: linked/PROJECT-RULES.md resolves outside the project through a link"), lines.join("\n"));
});

test("G200 cleanup removes a recorded link only when it sits inside the worktree", async () => {
  const p = makeTempProject({ git: true, files: { "src/tracked.txt": "t" }, overlay: { adapter: { worktree_setup: { copy: [], link: [] } } } });
  const outside = makeTempDir("paseo kit outside ");
  fs.writeFileSync(path.join(outside, "keep.txt"), "keep");
  const wt = await createWorktree(p.root, loadConfig(p.root), "tamper");
  const record = path.join(runGit(wt.path, ["rev-parse", "--absolute-git-dir"]).stdout, "harness-setup.json");
  const outsideLink = path.join(outside, "link");
  fs.symlinkSync(outside, outsideLink, JUNCTION);
  fs.writeFileSync(record, JSON.stringify({ v: 1, links: [outsideLink] }));
  const skipped = removeSetupLinks(wt.path, runGit);
  assert.deepEqual(skipped, [outsideLink]);
  assert.equal(fs.lstatSync(outsideLink).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(path.join(outside, "keep.txt"), "utf8"), "keep");
});
