// Kit feedback #87, part A (RA): the workflow scripts kit.json lists under `composition` are the project's once it edits
// them. Install records the seeded digest and kit version; update takes a new kit default only for an unedited copy and
// keeps an edited one even with --force (no conflict exit); status names each part's state; pull still offers an edited
// one back. Item 86 addendum: --force without --enable-plugin says the file mod stays unselected.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileDigest } from "../../ship/.agents/harness/lib/hash.mjs";
import { listShipFiles, loadKit } from "../../kit/install/units.mjs";
import { defaultKitFiles, KIT_DIR, makeKit, makeProject, runKit } from "../install/helpers.mjs";

const PART = ".agents/workflows/gsd-demo.js";
const OTHER = ".agents/harness/runtime/a.mjs";
const SCRIPT = (body) => `const FLOW = ".agents/workflows/lib/gsd-flow.mjs";\nconst flow = (argv, input) => run([FLOW, ...argv], input);\n${body}\n`;

// A fixture kit whose kit.json lists PART as a composition part.
function compositionKit(version = "1.0.0") {
  const kit = makeKit({ files: { ...defaultKitFiles(), [PART]: SCRIPT('await flow(["read", "a"]);') }, version });
  kit.release = (v) => fs.writeFileSync(path.join(kit.dir, "kit.json"), `${JSON.stringify({ name: "paseo-kit", version: v, units: listShipFiles(kit.dir), composition: [PART] }, null, 2)}\n`);
  kit.release(version);
  return kit;
}

async function installed(kit = compositionKit()) {
  const p = makeProject();
  const r = await runKit(["install", p.root], { kit });
  assert.ok(r.code === 0 || r.code === 2, r.stdout + r.stderr);
  return p;
}

test("RA loadKit exposes the composition list and refuses an entry that is not a listed unit", () => {
  const kit = compositionKit();
  assert.deepEqual([...loadKit(kit.dir).composition], [PART]);
  fs.writeFileSync(path.join(kit.dir, "kit.json"), JSON.stringify({ name: "paseo-kit", version: "1.0.0", units: listShipFiles(kit.dir), composition: [".agents/workflows/gsd-none.js"] }));
  assert.throws(() => loadKit(kit.dir), /kit\.json composition names "\.agents\/workflows\/gsd-none\.js", which units does not list/);
});

test("RA the real kit.json lists every top-level gsd-*.js workflow as composition and nothing else", () => {
  const kit = loadKit(KIT_DIR);
  const scripts = listShipFiles(KIT_DIR).filter((rel) => /^\.agents\/workflows\/gsd-[^/]+\.js$/.test(rel));
  assert.ok(scripts.length >= 9);
  assert.deepEqual([...kit.composition].sort(), scripts.sort());
});

test("RA install records each composition part's seeded digest and kit version; a kit without composition parts adds no key", async () => {
  const kit = compositionKit();
  const p = await installed(kit);
  const m = p.manifest();
  assert.deepEqual(m.composition, { [PART]: { seeded: fileDigest(kit.ship(PART)), version: "1.0.0" } });
  assert.equal(m.files[PART], m.composition[PART].seeded);
  // A kit without composition parts writes the manifest key list of before.
  const q = makeProject();
  await runKit(["install", q.root], { kit: makeKit() });
  assert.deepEqual(Object.keys(q.manifest()), ["_notes", "version", "installedAt", "updatedAt", "files"]);
});

test("RA update: an unedited composition copy takes the new kit default and its entry moves to the new version", async () => {
  const kit = compositionKit();
  const p = await installed(kit);
  kit.write(PART, SCRIPT('await flow(["read", "b"]);'));
  kit.release("1.1.0");
  const u = await runKit(["update", p.root], { kit });
  assert.equal(u.code, 0, u.stdout);
  assert.ok(u.out.includes(`updated ${PART}`));
  assert.equal(p.read(PART), kit.read(PART));
  assert.deepEqual(p.manifest().composition[PART], { seeded: fileDigest(kit.ship(PART)), version: "1.1.0" });
});

test("RA update --force keeps an edited composition copy (kit default unchanged), exit 0, while it still replaces other local edits", async () => {
  const kit = compositionKit();
  const p = await installed(kit);
  const mine = SCRIPT('await flow(["read", "mine"]);');
  p.write(PART, mine);
  p.write(OTHER, "export const a = 2;\n");
  const u = await runKit(["update", p.root, "--force"], { kit });
  assert.equal(u.code, 0, u.stdout);
  assert.equal(p.read(PART), mine);
  assert.ok(u.out.includes(`composition kept: ${PART} (edited by the project)`), u.stdout);
  assert.ok(u.out.includes(`updated ${OTHER}`));
  assert.match(u.out.find((l) => l.startsWith("update: ")), /^update: 1 part\(s\) changed, 0 kept, 1 composition part\(s\) kept as edited; kit 1\.0\.0$/);
});

test("RA update with and without --force keeps an edited copy when the kit default changed too: names the version and the diff", async () => {
  const kit = compositionKit();
  const p = await installed(kit);
  const seeded = p.manifest().composition[PART];
  const mine = SCRIPT('await flow(["read", "mine"]);');
  p.write(PART, mine);
  kit.write(PART, SCRIPT('await flow(["read", "kit"]);'));
  kit.release("1.1.0");
  for (const args of [[], ["--force"]]) {
    const u = await runKit(["update", p.root, ...args], { kit });
    assert.equal(u.code, 0, u.stdout);
    assert.equal(p.read(PART), mine);
    const line = u.out.find((l) => l.startsWith(`composition kept: ${PART}`));
    assert.match(line, /\(edited by the project\); kit default changed since 1\.0\.0; see the diff: git diff --no-index -- ".*gsd-demo\.js" ".*gsd-demo\.js"; to take the kit default, delete the project copy and run update$/);
    assert.equal(u.out.some((l) => l.startsWith("kept ")), false);
    assert.deepEqual(p.manifest().composition[PART], seeded);
  }
  fs.rmSync(p.path(PART));
  const taken = await runKit(["update", p.root], { kit });
  assert.equal(taken.code, 0, taken.stdout);
  assert.equal(p.read(PART), kit.read(PART));
  assert.deepEqual(p.manifest().composition[PART], { seeded: fileDigest(kit.ship(PART)), version: "1.1.0" });
});

test("RA status lists each composition part: kit default, edited, update takes it, edited and kit default changed", async () => {
  const kit = compositionKit();
  const p = await installed(kit);
  const q = await installed(kit);
  const line = (r) => r.out.find((l) => l.startsWith(`composition ${PART}: `));
  const same = await runKit(["status", p.root], { kit });
  assert.equal(line(same), `composition ${PART}: kit default`);
  assert.equal(same.code, 0);
  p.write(PART, SCRIPT('await flow(["read", "mine"]);'));
  const local = await runKit(["status", p.root], { kit });
  assert.equal(line(local), `composition ${PART}: edited by project`);
  assert.equal(local.code, 0, local.stdout);
  assert.match(local.out.at(-1), /^status: every kit part is the same; 1 composition part\(s\) edited by the project; project on kit 1\.0\.0/);
  kit.write(PART, SCRIPT('await flow(["read", "kit"]);'));
  kit.release("1.1.0");
  const both = await runKit(["status", p.root], { kit });
  assert.match(line(both), /: edited by project; kit default changed since 1\.0\.0 \(see the diff: git diff --no-index -- /);
  assert.equal(both.code, 0, both.stdout);
  const newer = await runKit(["status", q.root], { kit });
  assert.equal(line(newer), `composition ${PART}: kit default; update takes the new kit default`);
  assert.equal(newer.code, 2);
});

test("RA pull offers an edited composition copy back to the kit and refreshes its entry", async () => {
  const kit = compositionKit();
  const p = await installed(kit);
  const mine = SCRIPT('await flow(["read", "mine"]);');
  p.write(PART, mine);
  const r = await runKit(["pull", p.root], { kit });
  assert.equal(r.code, 0, r.stdout);
  assert.ok(r.out.includes(`pulled ${PART}`));
  assert.equal(kit.read(PART), mine);
  assert.deepEqual(p.manifest().composition[PART], { seeded: fileDigest(p.path(PART)), version: "1.0.0" });
  const after = await runKit(["status", p.root], { kit });
  assert.ok(after.out.includes(`composition ${PART}: kit default`));
});

test("RA a composition part the kit stopped shipping: an edited copy stays as the project's file, an unedited one is deleted", async () => {
  const kit = compositionKit();
  const p = await installed(kit);
  const mine = SCRIPT('await flow(["read", "mine"]);');
  p.write(PART, mine);
  kit.remove(PART);
  fs.writeFileSync(path.join(kit.dir, "kit.json"), JSON.stringify({ name: "paseo-kit", version: "2.0.0", units: listShipFiles(kit.dir) }));
  const u = await runKit(["update", p.root], { kit });
  assert.equal(u.code, 0, u.stdout);
  assert.ok(u.out.includes(`composition kept: ${PART} (edited by the project); the kit no longer ships it, so it is now the project's own file`), u.stdout);
  assert.equal(p.read(PART), mine);
  assert.equal(Object.hasOwn(p.manifest().files, PART), false);
  assert.equal(p.manifest().composition, undefined);

  const kit2 = compositionKit();
  const q = await installed(kit2);
  kit2.remove(PART);
  fs.writeFileSync(path.join(kit2.dir, "kit.json"), JSON.stringify({ name: "paseo-kit", version: "2.0.0", units: listShipFiles(kit2.dir) }));
  const d = await runKit(["update", q.root], { kit: kit2 });
  assert.ok(d.out.includes(`deleted ${PART} (no longer in the kit)`), d.stdout);
  assert.equal(q.exists(PART), false);
});

test("RA an older manifest without composition entries gets them on update; an edited part's version is not invented", async () => {
  const kit = compositionKit();
  const p = await installed(kit);
  const m = p.manifest();
  delete m.composition;
  fs.writeFileSync(p.path(".agents/harness-kit.json"), JSON.stringify(m, null, 2));
  p.write(PART, SCRIPT('await flow(["read", "mine"]);'));
  kit.write(PART, SCRIPT('await flow(["read", "kit"]);'));
  kit.release("1.1.0");
  const u = await runKit(["update", p.root, "--force"], { kit });
  assert.equal(u.code, 0, u.stdout);
  assert.match(u.out.find((l) => l.startsWith("composition kept")), /kit default changed since the copy it was seeded from \(kit version not recorded\)/);
  assert.deepEqual(p.manifest().composition[PART], { seeded: m.files[PART], version: null });
});

test("RA a corrupted composition entry is refused like an older manifest", async () => {
  const kit = compositionKit();
  const p = await installed(kit);
  const m = p.manifest();
  m.composition[PART] = { seeded: "nope", version: 1 };
  fs.writeFileSync(p.path(".agents/harness-kit.json"), JSON.stringify(m));
  const r = await runKit(["status", p.root], { kit });
  assert.equal(r.code, 1);
  assert.match(r.err.join("\n"), /written by an older kit/);
});

test("RA 86 addendum: install/update --force without --enable-plugin say the file mod stays unselected; without --force they do not", async () => {
  const kit = compositionKit();
  const p = makeProject();
  const forced = await runKit(["install", p.root, "--force"], { kit });
  const line = (r) => r.out.find((l) => l.startsWith("harness-files mod: stays unselected"));
  assert.match(line(forced), /^harness-files mod: stays unselected: --force replaces kit files but never selects the mod; to select it: node ".*kit\.mjs" update ".*" --enable-plugin$/);
  const plain = await runKit(["update", p.root], { kit });
  assert.equal(line(plain), undefined);
  const update = await runKit(["update", p.root, "--force"], { kit });
  assert.ok(line(update), update.stdout);
});
