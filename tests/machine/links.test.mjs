import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { makeTempDir } from "../helpers/temp.mjs";
import { completeMachine, makeMachine, SHIPPED_TEMPLATE, snapshot } from "./helpers.mjs";

const LINK_TYPE = process.platform === "win32" ? "junction" : "dir";
const DIRS = ["A", "B", "C", "D", "E"];

// Template: circle and circle-agent in dir A, one extra provider per dir B..E (no secrets, so apply can add them).
function linkTemplate() {
  const tpl = JSON.parse(fs.readFileSync(SHIPPED_TEMPLATE, "utf8"));
  tpl.providers.circle.env.CLAUDE_CONFIG_DIR = "{{HOME}}/A";
  tpl.providers["circle-agent"].env.CLAUDE_CONFIG_DIR = "{{HOME}}/A";
  for (const d of DIRS.slice(1)) tpl.providers[`p${d}`] = { extends: "claude", env: { CLAUDE_CONFIG_DIR: `{{HOME}}/${d}` }, models: [] };
  return tpl;
}

const readLinkClean = (p) => fs.readlinkSync(p).replace(/^\\\\\?\\/, "").replace(/[\\/]+$/, "");

async function fixture() {
  const base = await completeMachine();
  const m = makeMachine({ live: base.readConfig(), template: linkTemplate() });
  const dest = (d) => path.join(m.home, d, "skills", "kit-init");
  const other = makeTempDir("other checkout ");
  const otherSkill = path.join(other, "user", "skills", "kit-init");
  const oldKit = path.join(makeTempDir("old kit "), "user", "skills", "kit-init");
  fs.mkdirSync(otherSkill, { recursive: true });
  fs.mkdirSync(oldKit, { recursive: true });
  for (const d of DIRS.slice(1)) fs.mkdirSync(path.dirname(dest(d)), { recursive: true });
  fs.symlinkSync(otherSkill, dest("B"), LINK_TYPE);
  fs.symlinkSync(otherSkill, dest("C"), LINK_TYPE);
  fs.symlinkSync(oldKit, dest("D"), LINK_TYPE);
  fs.mkdirSync(dest("E"));
  fs.writeFileSync(path.join(dest("E"), "SKILL.md"), "owner skill\n", "utf8");
  const record = path.join(m.home, ".paseo-kit", "user-links.json");
  fs.mkdirSync(path.dirname(record), { recursive: true });
  fs.writeFileSync(record, JSON.stringify({ version: 1, links: [{ dest: dest("C"), target: oldKit }, { dest: dest("D"), target: oldKit }] }), "utf8");
  return { m, dest, otherSkill, oldKit, record };
}

const readRecord = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

test("MACH-16 check reports each config dir: missing, owner entries, and the old kit link", async () => {
  const { m, dest, oldKit } = await fixture();
  const r = await m.run(["check"]);
  assert.ok(r.out.includes(`note ${dest("A")}: kit-init link missing (kit.mjs machine apply --link-user-skills)`), r.stdout);
  for (const d of ["B", "C", "E"]) assert.ok(r.out.includes(`note ${dest(d)}: owner entry kept`), d);
  assert.ok(r.out.includes(`note ${dest("D")}: kit-made kit-init link points at ${oldKit} (apply --link-user-skills re-points it)`), r.stdout);
});

test("MACH-16 --link-user-skills links A, re-points D and leaves B, C and E untouched", async () => {
  const { m, dest, otherSkill, record } = await fixture();
  const owner = snapshot([dest("B"), dest("C"), dest("E")]);
  const r = await m.run(["apply", "--no-reload", "--link-user-skills"]);
  assert.equal(r.code, 0, r.stdout);
  assert.equal(readLinkClean(dest("A")), m.skillDir);
  assert.equal(readLinkClean(dest("D")), m.skillDir);
  assert.ok(fs.existsSync(path.join(dest("A"), "SKILL.md")));
  assert.deepEqual(snapshot([dest("B"), dest("C"), dest("E")]), owner);
  assert.equal(readLinkClean(dest("C")), otherSkill);
  const links = readRecord(record).links;
  assert.deepEqual(links.find((l) => l.dest === dest("A")), { dest: dest("A"), target: m.skillDir });
  assert.deepEqual(links.find((l) => l.dest === dest("D")), { dest: dest("D"), target: m.skillDir });
  for (const d of ["B", "C", "E"]) assert.ok(r.out.includes(`note ${dest(d)}: owner entry kept`), d);
  assert.deepEqual(fs.readdirSync(path.dirname(dest("D"))), ["kit-init"]);
  const check = r.out.slice(r.out.indexOf("--- check"));
  assert.ok(check.includes(`ok ${dest("A")}: kit-init link from this kit`));
  assert.ok(check.includes(`ok ${dest("D")}: kit-init link from this kit`));
});

test("MACH-16 an injected link-creation failure on D keeps the old link", async (t) => {
  const { m, dest, oldKit } = await fixture();
  const symlink = fs.symlinkSync;
  t.after(() => (fs.symlinkSync = symlink));
  fs.symlinkSync = (target, at, type) => {
    if (path.resolve(String(at)) === dest("D")) throw Object.assign(new Error("injected link failure"), { code: "EPERM" });
    return symlink(target, at, type);
  };
  const r = await m.run(["apply", "--no-reload", "--link-user-skills"]);
  fs.symlinkSync = symlink;
  assert.equal(r.code, 2, r.stdout);
  assert.ok(r.out.includes(`failed link ${dest("D")}: injected link failure`), r.stdout);
  assert.equal(readLinkClean(dest("D")), oldKit);
  assert.equal(readLinkClean(dest("A")), m.skillDir);
});

test("MACH-16 --unlink-user-skills removes only the kit's links (A, D) and their records", async () => {
  const { m, dest, otherSkill, oldKit, record } = await fixture();
  assert.equal((await m.run(["apply", "--no-reload", "--link-user-skills"])).code, 0);
  const owner = snapshot([dest("B"), dest("C"), dest("E")]);
  const r = await m.run(["apply", "--no-reload", "--unlink-user-skills"]);
  assert.equal(r.code, 0, r.stdout);
  assert.ok(r.out.includes(`link: removed ${dest("A")}`));
  assert.ok(r.out.includes(`link: removed ${dest("D")}`));
  for (const d of ["A", "D"]) assert.equal(fs.existsSync(dest(d)), false);
  assert.deepEqual(snapshot([dest("B"), dest("C"), dest("E")]), owner);
  assert.equal(readLinkClean(dest("B")), otherSkill);
  assert.deepEqual(readRecord(record).links, [{ dest: dest("C"), target: oldKit }]);
  assert.ok(fs.existsSync(m.skillDir), "the kit skill itself is never removed");
});

// Fails the atomic rename onto the link record once `passes` record writes have gone through (a persistent Windows
// sharing error); other renames pass.
function failRecordWrite(t, record, passes = 0) {
  const rename = fs.renameSync;
  let seen = 0;
  t.after(() => (fs.renameSync = rename));
  fs.renameSync = (from, to) => {
    if (path.resolve(String(to)) === record && seen++ >= passes) throw Object.assign(new Error("injected record failure"), { code: "EIO" });
    return rename(from, to);
  };
  return () => (fs.renameSync = rename);
}

test("MACH-16 a failed link-record write undoes the created and re-pointed links; a retry then succeeds (CR-MAC-03)", async (t) => {
  const { m, dest, oldKit, record } = await fixture();
  const linksBefore = readRecord(record).links;
  // The first record write, the pending entries, passes; the commit after the disk changes fails.
  const restore = failRecordWrite(t, record, 1);
  const r = await m.run(["apply", "--no-reload", "--link-user-skills"]);
  restore();
  assert.equal(r.code, 2, r.stdout);
  assert.ok(r.out.some((l) => l.startsWith(`failed link record ${record}: injected record failure`)), r.stdout);
  assert.ok(r.out.includes(`link: undone ${dest("A")}`), r.stdout);
  assert.ok(r.out.includes(`link: undone ${dest("D")}`), r.stdout);
  assert.equal(fs.existsSync(dest("A")), false);
  assert.equal(readLinkClean(dest("D")), oldKit);
  assert.deepEqual(fs.readdirSync(path.dirname(dest("D"))), ["kit-init"]);
  // The pending entries of the undone run stay in the record until the next apply drops them.
  assert.deepEqual(readRecord(record).links, linksBefore);
  const retry = await m.run(["apply", "--no-reload", "--link-user-skills"]);
  assert.equal(retry.code, 0, retry.stdout);
  assert.equal(readLinkClean(dest("A")), m.skillDir);
  assert.equal(readLinkClean(dest("D")), m.skillDir);
  assert.deepEqual(fs.readdirSync(path.dirname(dest("D"))), ["kit-init"]);
});

test("MACH-16 a failed link-record write during unlink restores the removed links (CR-MAC-03)", async (t) => {
  const { m, dest, record } = await fixture();
  assert.equal((await m.run(["apply", "--no-reload", "--link-user-skills"])).code, 0);
  const recordBefore = fs.readFileSync(record, "utf8");
  const restore = failRecordWrite(t, record);
  const r = await m.run(["apply", "--no-reload", "--unlink-user-skills"]);
  restore();
  assert.equal(r.code, 2, r.stdout);
  for (const d of ["A", "D"]) assert.equal(readLinkClean(dest(d)), m.skillDir);
  assert.equal(fs.readFileSync(record, "utf8"), recordBefore);
  const retry = await m.run(["apply", "--no-reload", "--unlink-user-skills"]);
  assert.equal(retry.code, 0, retry.stdout);
  for (const d of ["A", "D"]) assert.equal(fs.existsSync(dest(d)), false);
});
