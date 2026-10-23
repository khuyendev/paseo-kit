// Kit feedback #96 (a) (V4): an empty adapter.commands.smoke_builds while the stack skill or the conventions name a build
// target is a `ph harness lint` warning; `kit.mjs update` lists the adapter and gsd keys the kit defaults gained since the
// project's adapter was last written that the overlay leaves at their default.
import assert from "node:assert/strict";
import test from "node:test";
import { findingLine, lintProject } from "../../ship/.agents/harness/adapter/lint.mjs";
import { makeTempProject } from "../helpers/temp.mjs";
import { defaultKitFiles, makeKit, makeProject, runKit } from "../install/helpers.mjs";

const SKILL = (body) => `---\nname: app-stack\ndescription: "How to build and test this app. Use when changing code under lib/."\n---\n\n# App stack\n\n${body}\n`;
const COMMANDS = { build: ["node", "-e", "0"], test: ["node", "-e", "0"], build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} };

function smokeWarnings(files, commands = COMMANDS) {
  const p = makeTempProject({ git: false, files, overlay: { adapter: { stack_skill: "app-stack", commands } } });
  return lintProject(p.root).findings.filter((f) => f.level === "warn" && /smoke_builds is empty/.test(f.msg)).map(findingLine);
}

test("V4 lint warns when the stack skill names build targets in commands and smoke_builds is empty", () => {
  const body = "| Task | Command |\n|---|---|\n| Debug APK | `node tools/adapter/flutter.mjs build apk --debug` |\n\n```sh\nflutter build windows --debug\n```";
  const w = smokeWarnings({ ".claude/skills/app-stack/SKILL.md": SKILL(body) });
  assert.equal(w.length, 1, w.join("\n"));
  assert.match(w[0], /^warn \.claude\/skills\/app-stack\/SKILL\.md:10: names the build target\(s\) build apk, build windows while adapter\.commands\.smoke_builds is empty: add one argv per target/);
});

test("V4 lint reads the codebase conventions too, and stays quiet for prose, other commands or declared smoke builds", () => {
  const conventions = { ".planning/codebase/CONVENTIONS.md": "# Conventions\n\nRelease builds use `xcodebuild -scheme App`.\n" };
  const skill = { ".claude/skills/app-stack/SKILL.md": SKILL("We build web apps. Run `npm run build` before a release.") };
  const w = smokeWarnings({ ...skill, ...conventions });
  assert.deepEqual(w.map((l) => l.split(": names")[0]), ["warn .planning/codebase/CONVENTIONS.md:3"]);
  assert.deepEqual(smokeWarnings(skill), []);
  assert.deepEqual(smokeWarnings({ ...skill, ...conventions }, { ...COMMANDS, smoke_builds: [["xcodebuild", "-scheme", "App"]] }), []);
});

const DEFAULTS = ".agents/harness.defaults.json";
const OVERLAY = ".agents/harness.config.json";
const V1 = { tiers: {}, adapter: { commands: { build: null, gates: [] } }, gsd: { review_depth: "standard" } };
const V2 = { tiers: { extra: {} }, adapter: { commands: { build: null, gates: [], smoke_builds: [] } }, gsd: { review_depth: "standard", new_policy: { mode: "a", limit: 2 } } };
const json = (o) => `${JSON.stringify(o, null, 2)}\n`;
const addedLines = (out) => out.filter((l) => l.startsWith("warning adapter key "));

test("V4 kit update lists adapter and gsd keys added since the adapter was last written and left at their default", async () => {
  const kit = makeKit({ files: { ...defaultKitFiles(), [DEFAULTS]: json(V1) } });
  const p = makeProject({ [OVERLAY]: json({ adapter: { commands: { build: ["make"], gates: [] } } }) });
  assert.equal((await runKit(["install", p.root], { kit })).code, 0);
  kit.write(DEFAULTS, json(V2));
  const u = await runKit(["update", p.root], { kit });
  assert.deepEqual(addedLines(u.out), [
    `warning adapter key adapter.commands.smoke_builds: added by the kit since the adapter was last written, and the project leaves it at the default []; set it in ${OVERLAY} (the default value too) once decided`,
    `warning adapter key gsd.new_policy: added by the kit since the adapter was last written, and the project leaves it at the default {"mode":"a","limit":2}; set it in ${OVERLAY} (the default value too) once decided`,
  ]);
  assert.deepEqual(p.manifest().adapter.keys, ["adapter.commands", "adapter.commands.build", "adapter.commands.gates", "gsd.review_depth"]);
  // Not decided yet (the overlay's adapter is unchanged): the next update lists them again.
  assert.equal(addedLines((await runKit(["update", p.root], { kit })).out).length, 2);
  // A key the project sets is not listed; an adapter written since (overlay changed) saw the current defaults.
  p.write(OVERLAY, json({ adapter: { commands: { build: ["make"], gates: [], smoke_builds: [["make", "apk"]] } } }));
  assert.deepEqual(addedLines((await runKit(["update", p.root], { kit })).out), []);
  // A kit without a defaults file records nothing and lists nothing.
  const bare = makeKit();
  const q = makeProject();
  await runKit(["install", q.root], { kit: bare });
  assert.deepEqual(addedLines((await runKit(["update", q.root], { kit: bare })).out), []);
  assert.equal(Object.hasOwn(q.manifest(), "adapter"), false);
});
