// Kit feedback 81: a stack skill prescribed `node tools/adapter/flutter.mjs format ...` but the Flutter-only wrapper rejected the
// subcommand. adapter.command_probes declares a harmless argv per prescribed wrapper command; `ph harness lint` runs each and fails
// on a rejection, and lint warns for a prescribed wrapper command that no adapter command or probe covers.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { SHIP_DIR, makeTempProject } from "../helpers/temp.mjs";
import { runPh } from "../helpers/run.mjs";
import { findingLine, lintProject } from "../../ship/.agents/harness/adapter/lint.mjs";
import { prescribedCommands } from "../../ship/.agents/harness/adapter/lint-probes.mjs";
import { validateAgainstSchema } from "../../ship/.agents/harness/lib/config-schema.mjs";

// A Flutter-only wrapper like the project's: everything goes to "flutter", which does not know `format`.
const WRAPPER = `const [sub] = process.argv.slice(2);
if (sub === "format") { console.error('Could not find a command named "format".'); process.exit(64); }
if (sub === "slow") setTimeout(() => {}, 10000);
else console.log("ok " + process.argv.slice(2).join(" "));
`;
const DART = 'console.log("dart ok");\n';
const SKILL = (body) => `---
name: flutter-dart
description: "How to write, build and test code in this Flutter app. Use when writing or changing code under lib/."
---

# Flutter

${body}
`;
const BODY = "Run `node tools/adapter/flutter.mjs test` and format with `node tools/adapter/flutter.mjs format --output=none lib/a.dart`.";
const commands = (extra = {}) => ({ build: null, test: ["node", "tools/adapter/flutter.mjs", "test"], build_timeout_s: 30, test_timeout_s: 60, gates: [], verify: {}, smoke_builds: [], ...extra });
const project = (adapter, body = BODY) => makeTempProject({
  git: false,
  files: { "tools/adapter/flutter.mjs": WRAPPER, "tools/adapter/dart.mjs": DART, ".claude/skills/flutter-dart/SKILL.md": SKILL(body) },
  overlay: { adapter: { stack_skill: "flutter-dart", commands: commands(), ...adapter } },
});
const probe = (name, argv, extra = {}) => ({ name, argv, ...extra });

test("Q81 command_probes defaults to nothing, takes {name, argv, timeout_s?} and a bad entry fails validation", () => {
  const { _notes, ...defaults } = JSON.parse(fs.readFileSync(path.join(SHIP_DIR, ".agents", "harness.defaults.json"), "utf8"));
  assert.deepEqual(defaults.adapter.command_probes, []);
  const check = (command_probes) => validateAgainstSchema({ ...defaults, adapter: { ...defaults.adapter, command_probes } });
  assert.doesNotThrow(() => check([probe("dart-format", ["node", "tools/adapter/dart.mjs", "format"], { timeout_s: 10 })]));
  for (const bad of [[{ name: "x" }], [{ name: "", argv: ["node", "a.mjs"] }], [{ name: "x", argv: [] }], "node a.mjs"]) {
    assert.throws(() => check(bad), /adapter\.command_probes/, JSON.stringify(bad));
  }
});

test("Q81 prescribedCommands reads node scripts and their subcommand from code spans and fenced blocks only", () => {
  const text = "Prose: node tools/a.mjs hidden.\n`node tools/adapter/flutter.mjs format --output=none lib/a.dart` and `node ./tools/adapter/flutter.mjs --version`\n```sh\nnode tools/adapter/dart.mjs analyze\n```\n";
  assert.deepEqual(prescribedCommands(text), [{ script: "tools/adapter/flutter.mjs", sub: "format" }, { script: "tools/adapter/flutter.mjs", sub: null }, { script: "tools/adapter/dart.mjs", sub: "analyze" }]);
});

test("Q81 lint warns for a wrapper command the stack skill prescribes that no adapter command or probe covers", () => {
  const { findings } = lintProject(project({}).root);
  const warns = findings.filter((f) => /prescribes/.test(f.msg));
  assert.equal(warns.length, 1, JSON.stringify(findings));
  assert.equal(warns[0].level, "warn");
  assert.match(warns[0].msg, /node tools\/adapter\/flutter\.mjs format/);
  assert.equal(warns[0].file, ".claude/skills/flutter-dart/SKILL.md");
});

test("Q81 a probe (or adapter command) with the same script and subcommand covers the prescribed command", () => {
  const p = project({ command_probes: [probe("format", ["node", "tools/adapter/flutter.mjs", "format", "--output=none", "lib/a.dart"])] });
  assert.deepEqual(lintProject(p.root).findings.filter((f) => /prescribes/.test(f.msg)), []);
  // a different subcommand does not
  const q = project({ command_probes: [probe("version", ["node", "tools/adapter/flutter.mjs", "--version"])] });
  assert.equal(lintProject(q.root).findings.filter((f) => /prescribes/.test(f.msg)).length, 1);
});

test("Q81 a probe script that does not exist fails like other adapter argv scripts", () => {
  const p = project({ command_probes: [probe("gone", ["node", "tools/adapter/gone.mjs", "format"])] });
  assert.ok(lintProject(p.root).findings.some((f) => f.level === "fail" && /adapter\.command_probes\.gone: script tools\/adapter\/gone\.mjs does not exist/.test(f.msg)));
});

test("Q81 ph harness lint fails with the wrapper's own message when a probe is rejected, and passes after the dispatch is fixed", async () => {
  const p = project({ command_probes: [probe("format", ["node", "tools/adapter/flutter.mjs", "format", "--output=none", "lib/a.dart"])] });
  const bad = await runPh(["harness", "lint"], { root: p.root });
  assert.equal(bad.code, 2, bad.stdout);
  assert.ok(bad.out.some((l) => /^fail .*adapter\.command_probes\.format: the wrapper rejects `node tools\/adapter\/flutter\.mjs format .*` \(exit 64: Could not find a command named "format"\./.test(l)), bad.stdout);
  // the owner's fix: format goes to a Dart invocation of the same wrapper family
  const fixed = project({ command_probes: [probe("format", ["node", "tools/adapter/dart.mjs", "format", "--output=none", "lib/a.dart"])] },
    "Run `node tools/adapter/flutter.mjs test` and format with `node tools/adapter/dart.mjs format --output=none lib/a.dart`.");
  const ok = await runPh(["harness", "lint"], { root: fixed.root });
  assert.equal(ok.code, 0, ok.stdout);
  assert.match(ok.out.at(-1), /^lint: 0 failed/);
});

test("Q81 a probe that times out fails, --no-probes skips running them, and no probes run when none is configured", async () => {
  const p = project({ command_probes: [probe("slow", ["node", "tools/adapter/flutter.mjs", "slow"], { timeout_s: 1 })] });
  const slow = await runPh(["harness", "lint"], { root: p.root });
  assert.equal(slow.code, 2);
  assert.ok(slow.out.some((l) => /adapter\.command_probes\.slow: .*timed out after 1s/.test(l)), slow.stdout);
  const skipped = await runPh(["harness", "lint", "--no-probes"], { root: p.root });
  assert.ok(!skipped.out.some((l) => /command_probes.slow/.test(l)), skipped.stdout);
  const none = await runPh(["harness", "lint"], { root: makeTempProject({ git: false, overlay: {} }).root });
  assert.equal(none.code, 0, none.stdout);
});

test("Q81 unrelated: a project with no stack skill or no wrapper commands gets no new finding", () => {
  const { findings } = lintProject(makeTempProject({ git: false, overlay: {} }).root);
  assert.deepEqual(findings.filter((f) => /prescribes|command_probes/.test(findingLine(f))), []);
  const p = project({}, "Run `npm test`. Never call node tools/adapter/flutter.mjs format in prose.");
  assert.deepEqual(lintProject(p.root).findings.filter((f) => /prescribes/.test(f.msg)), []);
});
