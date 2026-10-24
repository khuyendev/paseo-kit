// Kit feedback #103 (G103): a stricter adapter command is not a weakened check, and a JSON catalog contract is
// checked by key path. F1 an argv that keeps the old argv and only adds a strictness flag (--timeout, fail-fast,
// reporter/output, verbosity, or a flag the baseline's adapter.commands.non_weakening_flags already names) is a note;
// a dropped test path, an added skip/exclude, a narrowed path, a changed executable, and any verify_vocabulary or
// checks change still stop at Checks with ph gsd allow. F2 a .json file (or a file matching adapter.catalogs) whose
// signature is `a.b { c, d }` / `name({{token}})` is checked by key path; a missing key is a note naming the path.
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { loadConfigLenient } from "../../ship/.agents/harness/config.mjs";
import { producedCheck, signatureKeyPaths } from "../../ship/.agents/harness/gsd/contracts.mjs";
import { makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";
import { project } from "../gsd-core/fixture.mjs";
import { setup } from "../ph/setup.mjs";

const { main } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
const PD = ".planning/phases/01-core";
const NODE = process.execPath;
const OVERLAY = ".agents/harness.config.json";

async function flow(root, argv, input = "") {
  let line = "";
  const code = await main(argv, { root, input: typeof input === "string" ? input : JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}
const commands = (testArgv = [NODE, "-e", "process.exit(0)"], extra = {}) => ({
  build: [NODE, "-e", "process.exit(0)"], test: testArgv, build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {}, ...extra,
});
const overlay = (testArgv, extra) => ({ adapter: { commands: commands(testArgv, extra) } });
const fixture = (testArgv, extra) => project({ files: { "test/parser_test.dart": "void main() {}\n" }, overlay: overlay(testArgv, extra) });

async function afterBaseline(p, next) {
  assert.equal((await flow(p.root, ["baseline", PD])).code, 0);
  p.writeJson(OVERLAY, next);
  return flow(p.root, ["check-weakening", PD]);
}

test("G103 F1 adding --timeout 120s (and other strictness flags) after the baseline is a note, not a Checks stop", async () => {
  const p = fixture([NODE, "tools/flutter.mjs", "test"]);
  const r = await afterBaseline(p, overlay([NODE, "tools/flutter.mjs", "test", "--timeout", "120s", "--fail-fast", "--reporter", "json", "-v"]));
  assert.equal(r.json.status, "ok", JSON.stringify(r.json));
  assert.deepEqual(r.json.weakened, []);
  assert.ok(r.json.notes.some((n) => /adapter\.commands\.test keeps its argv and adds strictness \(--timeout 120s, --fail-fast, --reporter json, -v\); not a weakening/.test(n)), JSON.stringify(r.json.notes));
  // The same addition committed, and with the body removed so the previous argv is read from the baseline commit.
  p.git("add", "-A");
  p.git("commit", "-qm", "stricter timeout");
  const body = p.readJson(`${PD}/execute-baseline.json`);
  delete body.gateConfigBody;
  p.writeJson(`${PD}/execute-baseline.json`, body);
  const again = await flow(p.root, ["check-weakening", PD]);
  assert.equal(again.json.status, "ok", JSON.stringify(again.json));
  assert.ok(again.json.notes.some((n) => /adds strictness/.test(n)), JSON.stringify(again.json.notes));
});

test("G103 F1 --timeout=120s and a flag the baseline already lists are not weakenings; a flag listed only in the new overlay is", async () => {
  const listed = fixture([NODE, "tools/flutter.mjs", "test"], { non_weakening_flags: ["--coverage"] });
  const ok = await afterBaseline(listed, overlay([NODE, "tools/flutter.mjs", "test", "--timeout=120s", "--coverage", "lcov"], { non_weakening_flags: ["--coverage"] }));
  assert.equal(ok.json.status, "ok", JSON.stringify(ok.json));
  assert.ok(ok.json.notes.some((n) => /adds strictness \(--timeout=120s, --coverage lcov\)/.test(n)), JSON.stringify(ok.json.notes));

  const fresh = fixture([NODE, "tools/flutter.mjs", "test"]);
  const sneaked = await afterBaseline(fresh, overlay([NODE, "tools/flutter.mjs", "test", "--coverage"], { non_weakening_flags: ["--coverage"] }));
  assert.equal(sneaked.json.status, "weakened", JSON.stringify(sneaked.json));
  assert.match(sneaked.json.weakened[0].detail, /adapter\.commands\.test added an argument \(--coverage\)/);
  assert.match(sneaked.json.weakened[0].detail, /execute-baseline\.json/);
  assert.ok(sneaked.json.notes.some((n) => /non_weakening_flags changed/.test(n)), JSON.stringify(sneaked.json.notes));
});

test("G103 F1 a dropped test path, an added skip flag, a narrowed path and a changed executable still stop, and the answer is still ph gsd allow", async () => {
  const base = [NODE, "tools/flutter.mjs", "test", "test/foo_test.dart", "test/bar_test.dart"];
  const dropped = await afterBaseline(fixture(base), overlay([NODE, "tools/flutter.mjs", "test", "test/foo_test.dart"]));
  assert.equal(dropped.json.status, "weakened");
  assert.match(dropped.json.weakened[0].detail, /adapter\.commands\.test removed an argument \(test\/bar_test\.dart\)/);
  assert.equal(dropped.json.weakened[0].kind, "config-changed");

  const skipped = fixture([NODE, "tools/flutter.mjs", "test"]);
  const ex = await afterBaseline(skipped, overlay([NODE, "tools/flutter.mjs", "test", "--exclude", "slow"]));
  assert.equal(ex.json.status, "weakened", JSON.stringify(ex.json));
  assert.match(ex.json.weakened[0].detail, /added a skip\/exclude flag \(--exclude\)/);
  const red = await flow(skipped.root, ["gate", PD], { waveId: "w1", plans: [{ id: "01-01", owns: ["Path:test/"], verify: [] }] });
  assert.equal(red.json.green, false);
  const stop = red.json.failures.find((f) => f.step === "checks");
  assert.equal(stop.needsOwner.stage, "Checks");
  assert.equal(stop.needsOwner.options[0].startsWith("ph gsd allow 1 --path .agents/harness.config.json "), true);

  const narrow = await afterBaseline(fixture([NODE, "tools/flutter.mjs", "test", "test/"]), overlay([NODE, "tools/flutter.mjs", "test", "test/unit"]));
  assert.equal(narrow.json.status, "weakened");
  assert.match(narrow.json.weakened[0].detail, /narrowed a test path \(test\/ -> test\/unit\)/);

  const exe = await afterBaseline(fixture([NODE, "tools/flutter.mjs", "test"]), overlay(["dart", "tools/flutter.mjs", "test"]));
  assert.equal(exe.json.status, "weakened");
  assert.match(exe.json.weakened[0].detail, /changed the executable/);
});

test("G103 F1 verify_vocabulary and checks stay strict even when the test argv only gained a timeout", async () => {
  const p = fixture([NODE, "tools/flutter.mjs", "test"]);
  const next = overlay([NODE, "tools/flutter.mjs", "test", "--timeout", "120s"]);
  next.adapter.verify_vocabulary = { build: { prefix: "build", parser: null, resolver: null, runner: null, evidence_parser: null, exit_code_sufficient: false } };
  const r = await afterBaseline(p, next);
  assert.equal(r.json.status, "weakened", JSON.stringify(r.json));
  assert.match(r.json.weakened[0].detail, /adapter\.verify_vocabulary differs/);
  assert.ok(r.json.notes.some((n) => /adds strictness \(--timeout 120s\)/.test(n)), JSON.stringify(r.json.notes));

  const q = fixture([NODE, "-e", "process.exit(0)"]);
  const off = overlay();
  off.adapter.checks = { enabled: false };
  const c = await afterBaseline(q, off);
  assert.equal(c.json.status, "weakened");
  assert.match(c.json.weakened[0].detail, /adapter\.checks differs/);
});

test("G103 F1 the schema accepts the optional flag list and refuses a flag that does not start with -; catalogs is an optional glob list", () => {
  const s = setup();
  s.project.writeJson(OVERLAY, { adapter: { commands: { non_weakening_flags: ["--coverage"] } } });
  assert.match(String(loadConfigLenient(s.root).error?.message), /adapter\.commands\.(build|test)/, "a partial commands entry still names its missing keys");
  const full = commands([NODE, "-e", "0"], { non_weakening_flags: ["--coverage"] });
  s.project.writeJson(OVERLAY, { adapter: { commands: full } });
  assert.equal(loadConfigLenient(s.root).error, null);
  s.project.writeJson(OVERLAY, { adapter: { commands: commands([NODE, "-e", "0"], { non_weakening_flags: ["coverage"] }) } });
  assert.match(String(loadConfigLenient(s.root).error?.message), /adapter\.commands\.non_weakening_flags\[0\].*a flag starting with -/);
  s.project.writeJson(OVERLAY, { adapter: { catalogs: ["**/*.arb", "lib/i18n/*.i18n"] } });
  assert.equal(loadConfigLenient(s.root).error, null);
  s.project.writeJson(OVERLAY, { adapter: { catalogs: "lib/i18n/*.i18n" } });
  assert.match(String(loadConfigLenient(s.root).error?.message), /adapter\.catalogs/);
});

const ICON = "flutter.projectIcon { invalidUrl, insecureUrl, downloadFailed({{status}}), noSupportedIcon }";
const NESTED = "flutter.addProject { title {chooseHost, addProject}, pageLabel({{page}}), method { directorySearch {label, description({{host}})} } }";
const iconJson = JSON.stringify({ flutter: { projectIcon: { invalidUrl: "bad", insecureUrl: "http", downloadFailed: "failed ({{status}})", noSupportedIcon: "none" } } });
const nestedJson = JSON.stringify({ flutter: { addProject: { title: { chooseHost: "h", addProject: "a" }, pageLabel: "p {{page}}", method: { directorySearch: { label: "l", description: "on {{host}}" } } } } });

function catalogProject(file, text, signature, symbol, extra = {}) {
  const manifest = { phase: "01", plans: [{ id: "01-01", owns: ["Path:lib/"], produces: [{ symbol, kind: "catalog", file, signature }] }] };
  return makeTempProject({
    files: { [`${PD}/01-PLAN-OUTLINE.manifest.json`]: JSON.stringify(manifest), [file]: text },
    overlay: extra,
  });
}
const notesOf = (p, ...ids) => producedCheck(p.root, PD, ids.length ? ids : ["01-01"])[0];

test("G103 F2 a JSON catalog whose keys exist holds the signature: no substring note", () => {
  const icon = catalogProject("lib/i18n/strings_en.i18n.json", iconJson, ICON, "t.flutter.projectIcon");
  const a = notesOf(icon);
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.deepEqual(a.notes, [], JSON.stringify(a.notes));
  const nested = catalogProject("lib/i18n/strings_en.i18n.json", nestedJson, NESTED, "t.flutter.addProject");
  assert.deepEqual(notesOf(nested).notes, [], JSON.stringify(notesOf(nested).notes));
  const plain = catalogProject("lib/i18n/strings_en.i18n.json", iconJson, "flutter.projectIcon.invalidUrl", "t.flutter.projectIcon");
  assert.deepEqual(notesOf(plain).notes, [], JSON.stringify(notesOf(plain).notes));
});

const REAL = "flutter.addProject { title {chooseHost, addProject, directorySearch, githubSearch, githubLocation, newDirectoryParent, newDirectoryName}, placeholder {hosts, directories, github, parentDirectories, directoryName}, status {adding, noMatches, updateHost}, error {searchDirectories, searchGithub, githubUnavailable, hostUnavailable, addProject, cloneRepository, directoryNameRequired, createDirectory}, noHosts {title, subtitle}, back, pageLabel({{page}}), method { directorySearch {label, description({{host}})}, github {label, updateHost, search, manual}, newDirectory {label, description({{host}}), updateHost} }, github {cloneUrl, cloneShorthand({{protocol}})}, location {alreadyExists, parentDirectory({{parent}})} }";

test("G103 F2 the catalog signature a manifest writes (nested braces, name({{token}})) is held by its keys", () => {
  const paths = signatureKeyPaths(REAL);
  assert.equal(paths.length, 40);
  assert.ok(paths.includes("flutter.addProject.pageLabel"));
  assert.ok(paths.includes("flutter.addProject.method.directorySearch.description"));
  assert.ok(paths.includes("flutter.addProject.github.cloneShorthand"));
  assert.ok(paths.includes("flutter.addProject.location.parentDirectory"));
  const obj = {};
  for (const keyPath of paths) {
    const segs = keyPath.split(".");
    let cur = obj;
    for (const seg of segs.slice(0, -1)) cur = cur[seg] ??= {};
    cur[segs.at(-1)] = "x";
  }
  const file = "lib/i18n/strings_en.i18n.json";
  const held = catalogProject(file, JSON.stringify(obj), REAL, "t.flutter.addProject");
  assert.equal(notesOf(held).ok, true);
  assert.deepEqual(notesOf(held).notes, []);
  delete obj.flutter.addProject.location.parentDirectory;
  const gone = catalogProject(file, JSON.stringify(obj), REAL, "t.flutter.addProject");
  assert.deepEqual(notesOf(gone).notes, [`t.flutter.addProject: ${file} missing key path flutter.addProject.location.parentDirectory`]);
});

test("G103 F2 a missing catalog key is a note naming the key path, and a non-json catalog the adapter names is checked the same way", () => {
  const missing = catalogProject("lib/i18n/strings_en.i18n.json", JSON.stringify({ flutter: { projectIcon: { invalidUrl: "bad", insecureUrl: "http", downloadFailed: "x" } } }), ICON, "t.flutter.projectIcon");
  const m = notesOf(missing);
  assert.equal(m.ok, true, JSON.stringify(m));
  assert.deepEqual(m.notes, ["t.flutter.projectIcon: lib/i18n/strings_en.i18n.json missing key path flutter.projectIcon.noSupportedIcon"]);
  const named = catalogProject("lib/i18n/strings_en.i18n", iconJson, ICON, "t.flutter.projectIcon", { adapter: { catalogs: ["lib/i18n/*.i18n"] } });
  assert.deepEqual(notesOf(named).notes, [], JSON.stringify(notesOf(named)));
  const namedMissing = catalogProject("lib/i18n/strings_en.i18n", JSON.stringify({ flutter: { projectIcon: { invalidUrl: "bad" } } }), "flutter.projectIcon.invalidUrl", "t.other.projectIcon", { adapter: { catalogs: ["**/*.i18n"] } });
  assert.equal(notesOf(namedMissing).ok, true);
  assert.deepEqual(notesOf(namedMissing).notes, []);
  const absent = catalogProject("lib/i18n/strings_en.i18n", JSON.stringify({ flutter: { projectIcon: {} } }), "flutter.projectIcon.invalidUrl", "t.flutter.projectIcon", { adapter: { catalogs: ["**/*.i18n"] } });
  assert.deepEqual(notesOf(absent).notes, ["t.flutter.projectIcon: lib/i18n/strings_en.i18n missing key path flutter.projectIcon.invalidUrl"]);
});
