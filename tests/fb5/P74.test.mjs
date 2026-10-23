// Kit feedback #74 (P74): one owns grammar. An owns glob (`lib/i18n/strings*.g.dart`, a generator whose file set depends
// on its configuration) was read as a pattern by the plan checker and as literal text by the transfer, owned-changes,
// request routing, the gate and the resume gate; the checker also let a glob in files_modified "cover" itself.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";
import { PHASE_DIR } from "../gsd-flows/world.mjs";
import { P1, gsd, plan, project } from "../gsd-core/fixture.mjs";

const lib = (f) => pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib", f)).href;
const { main } = await import(lib("gsd-flow.mjs"));
const { ownsDepth, ownsScope, owned, specificOwners } = await import(lib("flow-owns.mjs"));
const PD = PHASE_DIR;
const P = ["Path:"];

async function flow(root, argv, input = "") {
  let line = "";
  const code = await main(argv, { root, input: typeof input === "string" ? input : JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}

const GLOB = "Path:lib/i18n/strings*.g.dart";

test("P74 one matcher: a glob owns the files it matches, nothing else, and keeps the nested-owns specificity", () => {
  assert.equal(owned("lib/i18n/strings.g.dart", [GLOB], P), true);
  assert.equal(owned("lib/i18n/strings_en.g.dart", [GLOB], P), true);
  assert.equal(owned("lib/i18n/other.dart", [GLOB], P), false);
  assert.equal(owned("lib/i18n/sub/strings_en.g.dart", [GLOB], P), false, "* stops at a slash");
  assert.equal(owned("lib/i18n/a/b.dart", ["Path:lib/i18n/**"], P), true);
  assert.equal(owned("lib/a.ts", ["Path:lib/{a,b}.ts"], P), true);
  // specificity: exact path > glob starting like it > glob under a directory > the directory
  const plans = [{ id: "dir", owns: ["Path:lib/i18n/"] }, { id: "glob", owns: [GLOB] }, { id: "file", owns: ["Path:lib/i18n/strings.g.dart"] }];
  assert.deepEqual(specificOwners("lib/i18n/strings.g.dart", plans, P).map((x) => x.id), ["file"]);
  assert.deepEqual(specificOwners("lib/i18n/strings_en.g.dart", plans, P).map((x) => x.id), ["glob"]);
  assert.deepEqual(specificOwners("lib/i18n/messages.dart", plans, P).map((x) => x.id), ["dir"]);
  assert.ok(ownsDepth("lib/i18n/x.dart", ["Path:**"], P) >= 0, "a ** glob with no literal prefix still owns");
  assert.equal(ownsDepth("lib/i18n/x.dart", ["Path:lib/other/"], P), -1);
});

test("P74 unrelated owns forms keep their depth order: a nested directory wins, a prefix of a name does not cover", () => {
  assert.deepEqual(specificOwners("src/api-v2/r.js", [{ id: "a", owns: ["Path:src/api"] }, { id: "b", owns: ["Path:src/api-v2"] }], P).map((x) => x.id), ["b"]);
  assert.equal(owned("src/apidocs/x.md", ["Path:src/api"], P), false);
  assert.equal(owned("./src/api/x.js", ["Path: ./src/api"], P), true);
});

test("P74 scope of a glob for a digest or a git pathspec is its literal directory", () => {
  assert.equal(ownsScope(GLOB, P), "lib/i18n");
  assert.equal(ownsScope("Path:lib/gen/", P), "lib/gen");
  assert.equal(ownsScope("Path:lib/{a,b}/x.dart", P), "lib");
  assert.equal(ownsScope("Path:**/x.dart", P), ".");
});

test("P74 transfer accepts the generated names an owns glob matches and still refuses a file it does not", async () => {
  const p = makeTempProject({ files: { "lib/i18n/keep.dart": "k\n", [`${PD}/03-01-PLAN.md`]: "p\n" } });
  await flow(p.root, ["baseline", PD]);
  p.git("worktree", "add", "-q", "-b", "harness/r-1", ".claude/worktrees/r-1");
  const wt = ".claude/worktrees/r-1";
  for (const f of ["lib/i18n/strings.g.dart", "lib/i18n/strings_en.g.dart"]) fs.writeFileSync(path.join(p.root, wt, f), `// ${f}\n`);
  fs.mkdirSync(path.join(p.root, wt, PD), { recursive: true });
  fs.writeFileSync(path.join(p.root, wt, `${PD}/03-01-SUMMARY.md`), "---\nkey-files:\n  created: [lib/i18n/strings.g.dart]\n---\n");
  const ok = await flow(p.root, ["transfer", PD], { plan: "03-01", worktree: wt, owns: [GLOB], summary: `${PD}/03-01-SUMMARY.md` });
  assert.equal(ok.code, 0, JSON.stringify(ok.json));
  assert.deepEqual(p.readJson(`${PD}/transfers/03-01.json`).files.map((f) => f.path).sort(), [`${PD}/03-01-SUMMARY.md`, "lib/i18n/strings.g.dart", "lib/i18n/strings_en.g.dart"]);
  assert.equal(p.read("lib/i18n/strings_en.g.dart"), "// lib/i18n/strings_en.g.dart\n");

  p.git("worktree", "add", "-q", "-b", "harness/r-2", ".claude/worktrees/r-2");
  fs.writeFileSync(path.join(p.root, ".claude/worktrees/r-2", "lib/i18n/strings_fr.g.dart"), "fr\n");
  fs.writeFileSync(path.join(p.root, ".claude/worktrees/r-2", "lib/i18n/intruder.dart"), "x\n");
  const bad = await flow(p.root, ["transfer", PD], { plan: "03-02", worktree: ".claude/worktrees/r-2", owns: [GLOB], summary: `${PD}/03-02-SUMMARY.md` });
  assert.equal(bad.code, 1);
  assert.deepEqual(bad.json.refused, [{ path: "lib/i18n/intruder.dart", reason: "outside owns" }]);
  assert.equal(fs.existsSync(p.path("lib/i18n/strings_fr.g.dart")), false, "a refused transfer writes nothing");
});

test("P74 owned-changes, owners and the resume gate attribute generated files to the plan whose glob matches", async () => {
  const p = makeTempProject({ files: { ".gitignore": "_workspace/\n", "lib/i18n/messages.dart": "m\n", [`${PD}/.keep`]: "" } });
  const plans = [{ id: "01-01", owns: [GLOB], summary: `${PD}/01-01-SUMMARY.md`, complete: true }, { id: "01-02", owns: ["Path:lib/i18n/"], summary: `${PD}/01-02-SUMMARY.md`, complete: true }];
  assert.equal((await flow(p.root, ["baseline", PD])).code, 0);
  p.write("lib/i18n/strings_en.g.dart", "g\n");
  p.write("lib/i18n/messages.dart", "m2\n");
  const oc = await flow(p.root, ["owned-changes", PD], { plans });
  assert.deepEqual(oc.json.files, { "01-01": ["lib/i18n/strings_en.g.dart"], "01-02": ["lib/i18n/messages.dart"] });
  const own = await flow(p.root, ["owners"], { paths: ["lib/i18n/strings_en.g.dart", "lib/i18n/messages.dart", "lib/other.dart"], plans });
  assert.deepEqual(own.json.owners, { "lib/i18n/strings_en.g.dart": ["01-01"], "lib/i18n/messages.dart": ["01-02"], "lib/other.dart": [] });
  const rg = await flow(p.root, ["resume-gate", PD], { plans });
  assert.deepEqual([rg.code, rg.json.problems], [0, []]);
});

test("P74 the gate and review digest follow files under an owned glob (a brace or ** glob is no git pathspec)", async () => {
  const p = makeTempProject({ files: { "lib/i18n/strings.g.dart": "1\n", "lib/i18n/messages.dart": "m\n", "lib/other/x.dart": "o\n", [`${PD}/.keep`]: "" } });
  const d0 = (await flow(p.root, ["digest"], { owns: ["Path:lib/i18n/{strings,x}.g.dart"] })).json.hash;
  p.write("lib/other/x.dart", "o2\n");
  assert.equal((await flow(p.root, ["digest"], { owns: ["Path:lib/i18n/{strings,x}.g.dart"] })).json.hash, d0, "an unrelated file leaves the digest");
  p.write("lib/i18n/strings.g.dart", "2\n");
  assert.notEqual((await flow(p.root, ["digest"], { owns: ["Path:lib/i18n/{strings,x}.g.dart"] })).json.hash, d0, "a matched file changes it");
});

const checkOwns = async (files, extra = {}) => {
  const r = await gsd(project({ files, ...extra }), ["check", "owns", "1"]);
  return { code: r.code, kinds: (r.json.problems ?? []).map((x) => `${x.kind}:${x.file ?? ""}`) };
};

test("P74 checker: a glob in files_modified is a blocker, the files it stood for are listed instead", async () => {
  const globFiles = await checkOwns({ [`${P1}/01-01-PLAN.md`]: plan({ files: "[lib/i18n/strings*.g.dart]", owns: '["Path:lib/i18n/strings*.g.dart"]' }) });
  assert.equal(globFiles.code, 1);
  assert.deepEqual(globFiles.kinds, ["glob-files-modified:lib/i18n/strings*.g.dart"]);
  const listed = await checkOwns({ [`${P1}/01-01-PLAN.md`]: plan({ files: "[lib/i18n/strings.g.dart, lib/i18n/strings_en.g.dart]", owns: '["Path:lib/i18n/strings*.g.dart"]' }) });
  assert.deepEqual([listed.code, listed.kinds], [0, []], "concrete files covered by the owns glob pass");
  const dir = await checkOwns({ [`${P1}/01-01-PLAN.md`]: plan({ files: "[lib/i18n/strings.g.dart]", owns: '["Path:lib/i18n/"]' }) });
  assert.deepEqual([dir.code, dir.kinds], [0, []], "owning the directory passes");
});

test("P74 checker: files_modified resolves through the matcher, not string equality", async () => {
  const outside = await checkOwns({ [`${P1}/01-01-PLAN.md`]: plan({ files: "[lib/i18n/strings.g.dart, lib/i18n/messages.dart]", owns: '["Path:lib/i18n/strings*.g.dart"]' }) });
  assert.deepEqual(outside.kinds, ["outside-owns:lib/i18n/messages.dart"]);
  const text = await checkOwns({ [`${P1}/01-01-PLAN.md`]: plan({ files: "[lib/i18n/strings?.g.dart]", owns: '["Path:lib/i18n/strings?.g.dart"]' }) });
  assert.deepEqual(text.kinds, ["glob-files-modified:lib/i18n/strings?.g.dart"]);
});

test("P74 checker: an owns glob with an unpaired bracket or brace is invalid, a paired one and a plain path are not", async () => {
  const bad = await checkOwns({ [`${P1}/01-01-PLAN.md`]: plan({ files: "[lib/a.dart]", owns: '["Path:lib/{a,b.dart"]' }) });
  assert.ok(bad.kinds.includes("invalid-owns-glob:lib/{a,b.dart"), bad.kinds.join());
  const good = await checkOwns({ [`${P1}/01-01-PLAN.md`]: plan({ files: "[lib/a.dart]", owns: '["Path:lib/{a,b}.dart"]' }) });
  assert.deepEqual([good.code, good.kinds], [0, []]);
});

test("P74 checker: two plans of one wave owning overlapping globs still collide", async () => {
  const r = await checkOwns({
    [`${P1}/01-01-PLAN.md`]: plan({ files: "[lib/i18n/strings.g.dart]", owns: '["Path:lib/i18n/strings*.g.dart"]' }),
    [`${P1}/01-02-PLAN.md`]: plan({ id: "02", files: "[lib/i18n/strings_x.g.dart]", owns: '["Path:lib/i18n/"]' }),
  });
  assert.equal(r.code, 1);
  assert.ok(r.kinds.some((k) => k.startsWith("overlapping-owns")), r.kinds.join());
});

test("P74 outline check: an owns glob with an unpaired brace in the manifest is an error", async () => {
  const outline = `# Outline\n\n| Requirements | Plan ID | Wave | Objective | Depends on |\n|---|---|---|---|---|\n| CORE-01 | \`01-01\` | 1 | do | none |\n\n<!-- OUTLINE COMPLETE -->\n`;
  const manifest = (owns) => JSON.stringify({ phase: "01", plans: [{ id: "01-01", owns, requirements: ["CORE-01"], produces: [], consumes: [], tracer: { is: false }, verify: [] }] });
  const run = async (owns) => (await gsd(project({ files: { [`${P1}/01-PLAN-OUTLINE.md`]: outline, [`${P1}/01-PLAN-OUTLINE.manifest.json`]: manifest(owns) } }), ["outline", "check", "1"])).json;
  const bad = await run(["Path:lib/{a,b.dart"]);
  assert.ok((bad.errors ?? []).some((e) => /unbalanced/.test(e)), JSON.stringify(bad));
  const good = await run(["Path:lib/i18n/strings*.g.dart"]);
  assert.ok(!(good.errors ?? []).some((e) => /owns/.test(e)), JSON.stringify(good));
});

test("P74 the planner overlay names how to own generator output", () => {
  const overlay = fs.readFileSync(path.join(SHIP_DIR, ".agents/gsd/overlays/gsd-planner.md"), "utf8");
  assert.match(overlay, /Owns is a path, a directory or a glob/);
  assert.match(overlay, /file set depends on its configuration/);
  assert.match(overlay, /never a glob/);
});
