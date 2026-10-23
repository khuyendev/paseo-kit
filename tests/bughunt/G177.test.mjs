// G177: a link change killed before its record commit still reads as the kit's link, a failed pending write changes no
// link, leftover old-link copies are swept, and a kit apply waits for the machine lock before it touches the config.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { tryLock, unlock } from "../../ship/.agents/harness/adapter/mutex.mjs";
import { MACHINE_LOCK } from "../../kit/machine/apply.mjs";
import { KIT_DIR, makeTempDir } from "../helpers/temp.mjs";
import { completeMachine, makeMachine, SECRETS, SHIPPED_TEMPLATE } from "../machine/helpers.mjs";

const LINK_TYPE = process.platform === "win32" ? "junction" : "dir";
const readLinkClean = (p) => fs.readlinkSync(p).replace(/^\\\\\?\\/, "").replace(/[\\/]+$/, "");
const readRecord = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

// Template: circle and circle-agent in dir A, one extra provider in dir D (no secrets, so apply can add it).
function linkTemplate() {
  const tpl = JSON.parse(fs.readFileSync(SHIPPED_TEMPLATE, "utf8"));
  tpl.providers.circle.env.CLAUDE_CONFIG_DIR = "{{HOME}}/A";
  tpl.providers["circle-agent"].env.CLAUDE_CONFIG_DIR = "{{HOME}}/A";
  tpl.providers.pD = { extends: "claude", env: { CLAUDE_CONFIG_DIR: "{{HOME}}/D" }, models: [] };
  return tpl;
}

// Dir A has no link; dir D holds an old kit link that the record names.
async function fixture() {
  const base = await completeMachine();
  const m = makeMachine({ live: base.readConfig(), template: linkTemplate() });
  const dest = (d) => path.join(m.home, d, "skills", "kit-init");
  const oldKit = path.join(makeTempDir("old kit "), "user", "skills", "kit-init");
  fs.mkdirSync(oldKit, { recursive: true });
  fs.mkdirSync(path.dirname(dest("D")), { recursive: true });
  fs.symlinkSync(oldKit, dest("D"), LINK_TYPE);
  const record = path.join(m.home, ".paseo-kit", "user-links.json");
  fs.mkdirSync(path.dirname(record), { recursive: true });
  fs.writeFileSync(record, JSON.stringify({ version: 1, links: [{ dest: dest("D"), target: oldKit }] }), "utf8");
  return { m, dest, oldKit, record };
}

// One apply in a child process that exits with 137 at the first record write after a link was made, so the run dies
// after its disk changes and before the record commit (a real kill: the caught-error undo never runs).
const CHILD = `
const fs = (await import("node:fs")).default;
const path = (await import("node:path")).default;
const { run } = await import(${JSON.stringify(pathToFileURL(path.join(KIT_DIR, "kit", "machine", "index.mjs")).href)});
const { argv, io, record } = JSON.parse(process.env.G177_RUN);
let linked = false;
const symlink = fs.symlinkSync;
const rename = fs.renameSync;
fs.symlinkSync = (...args) => {
  linked = true;
  return symlink(...args);
};
fs.renameSync = (from, to) => {
  if (linked && path.resolve(String(to)) === record) process.exit(137);
  return rename(from, to);
};
await run(argv, { ...io, out: () => {}, err: () => {} });
`;

function killedApply(m, argv, record) {
  const io = { env: m.env, kitDir: m.kitDir, lockDir: m.lockDir };
  const env = { ...process.env, G177_RUN: JSON.stringify({ argv, io, record }) };
  return spawnSync(process.execPath, ["--input-type=module", "-e", CHILD], { env, encoding: "utf8", windowsHide: true }).status;
}

test("G177 a run killed after its link changes, before the record commit, leaves links that still read as the kit's", async () => {
  const { m, dest, record } = await fixture();
  assert.equal(killedApply(m, ["apply", "--no-reload", "--link-user-skills"], record), 137);
  assert.equal(readLinkClean(dest("A")), m.skillDir);
  assert.equal(readLinkClean(dest("D")), m.skillDir);
  const check = await m.run(["check"]);
  assert.ok(check.out.includes(`ok ${dest("A")}: kit-init link from this kit`), check.stdout);
  assert.ok(check.out.includes(`ok ${dest("D")}: kit-init link from this kit`), check.stdout);
  const relink = await m.run(["apply", "--no-reload", "--link-user-skills"]);
  assert.equal(relink.code, 0, relink.stdout);
  assert.equal(relink.out.some((l) => l.includes("owner entry kept")), false, relink.stdout);
  const unlink = await m.run(["apply", "--no-reload", "--unlink-user-skills"]);
  assert.equal(unlink.code, 0, unlink.stdout);
  for (const d of ["A", "D"]) assert.equal(fs.existsSync(dest(d)), false);
});

test("G177 a pending entry whose link never changed is dropped by the next apply, and the link is made", async () => {
  const { m, dest, oldKit, record } = await fixture();
  fs.writeFileSync(record, JSON.stringify({ version: 1, links: [{ dest: dest("D"), target: oldKit }], pending: [{ dest: dest("A"), target: m.skillDir }] }), "utf8");
  const check = await m.run(["check"]);
  assert.ok(check.out.includes(`note ${dest("A")}: kit-init link missing (kit.mjs machine apply --link-user-skills)`), check.stdout);
  const r = await m.run(["apply", "--no-reload", "--link-user-skills"]);
  assert.equal(r.code, 0, r.stdout);
  assert.equal(readLinkClean(dest("A")), m.skillDir);
  const after = readRecord(record);
  assert.equal("pending" in after, false);
  assert.deepEqual(after.links.find((l) => l.dest === dest("A")), { dest: dest("A"), target: m.skillDir });
});

test("G177 a failed write of the pending entries changes no link", async (t) => {
  const { m, dest, oldKit, record } = await fixture();
  const recordBefore = fs.readFileSync(record, "utf8");
  const rename = fs.renameSync;
  t.after(() => (fs.renameSync = rename));
  fs.renameSync = (from, to) => {
    if (path.resolve(String(to)) === record) throw Object.assign(new Error("injected record failure"), { code: "EIO" });
    return rename(from, to);
  };
  const r = await m.run(["apply", "--no-reload", "--link-user-skills"]);
  fs.renameSync = rename;
  assert.equal(r.code, 2, r.stdout);
  assert.ok(r.out.some((l) => l.startsWith(`failed link record ${record}: injected record failure; no link was changed`)), r.stdout);
  assert.equal(fs.existsSync(dest("A")), false);
  assert.equal(readLinkClean(dest("D")), oldKit);
  assert.equal(fs.readFileSync(record, "utf8"), recordBefore);
});

test("G177 an old link copy a killed run left beside a dest is swept by the next apply", async () => {
  const { m, dest, oldKit } = await fixture();
  const aside = `${dest("D")}.kit-old-99999`;
  fs.symlinkSync(oldKit, aside, LINK_TYPE);
  const r = await m.run(["apply", "--no-reload", "--link-user-skills"]);
  assert.equal(r.code, 0, r.stdout);
  assert.ok(r.out.includes(`link: removed leftover ${aside}`), r.stdout);
  assert.equal(fs.existsSync(aside), false);
  assert.equal(readLinkClean(dest("D")), m.skillDir);
});

test("G177 a kit apply waits for the machine lock before it reads or writes the Paseo config", async () => {
  const m = makeMachine();
  const before = m.configBytes();
  const token = tryLock(MACHINE_LOCK, { tmp: m.lockDir });
  assert.ok(token, "the test holds the machine lock");
  const pending = m.run(["apply", "--no-reload"], SECRETS);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  assert.deepEqual(m.configBytes(), before, "the config is untouched while another run holds the lock");
  unlock(MACHINE_LOCK, token, { tmp: m.lockDir });
  const r = await pending;
  assert.equal(r.code, 0, r.stdout);
  assert.ok(r.out.includes(`waiting for mutex ${MACHINE_LOCK}`), r.stdout);
  assert.ok(m.readConfig().agents.providers.circle, "the apply wrote the config after the lock was released");
});
