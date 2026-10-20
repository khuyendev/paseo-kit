import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { client, fixIds, scratch, tagOf } from "./helpers.mjs";

const nums = (n) => Array.from({ length: n }, (_, i) => `L${i + 1}`).join("\n") + "\n";
const read = (c, path, from, to) => tagOf(c.call("read_ranges", { ranges: [{ path, from, to }] }).text);
const edit = (c, path, tag, edits, extra = {}) => c.call("edit_multiple_files", { files: [{ path, tag, edits }], ...extra });
const fixesOf = (text) => fixIds(text.split("failed:\n")[1] ?? "");

test("FTOL-35 replace, top insert and delete in one entry", () => {
  const s = scratch({ "f.txt": nums(6) });
  const c = client({ cwd: s.root });
  const tag = read(c, "f.txt");
  const r = edit(c, "f.txt", tag, [{ from: 2, to: 3, newText: "X\nY\nZ" }, { after: 0, newText: "TOP\n" }, { from: 5, to: 5, newText: "" }]);
  assert.match(r.text, /^edited/);
  assert.equal(s.read("f.txt"), "TOP\nL1\nX\nY\nZ\nL4\nL6\n");
});

test("FTOL-35 a stale tag over an unchanged range applies in place; moved lines are found and reported", () => {
  const s = scratch({ "f.txt": nums(20) });
  const c = client({ cwd: s.root });
  const tag = read(c, "f.txt", 10, 14);
  s.write("f.txt", nums(20).replace("L19", "L19 changed"));
  assert.match(edit(c, "f.txt", tag, [{ from: 12, to: 12, newText: "twelve" }]).text, /^edited/);
  assert.match(s.read("f.txt"), /L11\ntwelve\nL13/);
  const tag2 = read(c, "f.txt", 15, 18);
  s.write("f.txt", `A\nB\n${s.read("f.txt")}`);
  const moved = edit(c, "f.txt", tag2, [{ from: 16, to: 16, newText: "sixteen" }]);
  assert.match(moved.text, /line edits whose lines had moved since their read:\n.*its lines had moved \+2; applied from line 18/);
  const lines = s.read("f.txt").split("\n");
  assert.equal(lines[17], "sixteen");
  assert.equal(lines.filter((l) => l === "sixteen").length, 1);
});

test("FTOL-35 a duplicated block writes nothing and returns {id, occurrence}; the chosen place alone changes", () => {
  const block = "p\nq\nr\ns\nt\n";
  const s = scratch({ "f.txt": block });
  const c = client({ cwd: s.root });
  const tag = read(c, "f.txt");
  s.write("f.txt", block + block);
  const before = s.read("f.txt");
  const r = edit(c, "f.txt", tag, [{ from: 3, to: 3, newText: "R" }]);
  assert.match(r.text, /now occur 2 times/);
  assert.equal(s.read("f.txt"), before);
  const [id] = fixesOf(r.text);
  assert.match(r.text, new RegExp(`\\{"id":"${id}","occurrence":<1-2>\\}`));
  c.call("edit_multiple_files", { fixes: [{ id, occurrence: 2 }] });
  assert.equal(s.read("f.txt"), "p\nq\nr\ns\nt\np\nq\nR\ns\nt\n");
});

test("FTOL-35 a changed target line stays untouched; the fix shows current lines with a new tag", () => {
  const s = scratch({ "f.txt": nums(5) });
  const c = client({ cwd: s.root });
  const tag = read(c, "f.txt");
  s.write("f.txt", nums(5).replace("L3", "L3 edited elsewhere"));
  const before = s.read("f.txt");
  const r = edit(c, "f.txt", tag, [{ from: 3, to: 3, newText: "three" }]);
  assert.equal(s.read("f.txt"), before);
  const m = /lines 1-5 now read \(tag (\w+)\):\n1\| L1\n2\| L2\n3\| L3 edited elsewhere/.exec(r.text);
  assert.ok(m, r.text);
  const [id] = fixesOf(r.text);
  assert.match(r.text, /with numbers as now shown/);
  c.call("edit_multiple_files", { fixes: [{ id, from: 3, to: 3 }] });
  assert.equal(s.read("f.txt"), "L1\nL2\nthree\nL4\nL5\n");
});

test("FTOL-35 preconditions: out-of-read range, another file's tag, missing tag write nothing; atomic decides siblings", () => {
  const s = scratch({ "f.txt": nums(10), "g.txt": nums(3) });
  const c = client({ cwd: s.root });
  const tag = read(c, "f.txt", 2, 4);
  const gtag = read(c, "g.txt");
  const before = s.read("f.txt");
  assert.match(edit(c, "f.txt", tag, [{ from: 8, to: 8, newText: "x" }]).text, /line 8 not inside read \w+ \(lines 2-4\)/);
  assert.match(edit(c, "f.txt", gtag, [{ from: 2, to: 2, newText: "x" }]).text, /is a read of .*g\.txt, not of this file/);
  assert.match(edit(c, "f.txt", undefined, [{ from: 2, to: 2, newText: "x" }]).text, /a line edit needs the tag/);
  assert.match(edit(c, "f.txt", tag, [{ oldText: "L2", from: 2, newText: "x" }]).text, /give oldText or line numbers/);
  assert.match(edit(c, "f.txt", tag, [{ after: 2, newText: "" }]).text, /newText is empty: nothing to insert/);
  assert.equal(s.read("f.txt"), before);
  const mixed = { files: [{ path: "f.txt", tag, edits: [{ from: 9, to: 9, newText: "x" }] }, { path: "g.txt", edits: [{ oldText: "L1", newText: "one" }] }] };
  c.call("edit_multiple_files", { ...mixed, atomic: true });
  assert.equal(s.read("g.txt"), nums(3));
  c.call("edit_multiple_files", mixed);
  assert.equal(s.read("g.txt"), nums(3).replace("L1", "one"));
});

test("FTOL-35 a CRLF file stays CRLF under line edits", () => {
  const s = scratch({ "w.txt": "a\r\nb\r\nc\r\n" });
  const c = client({ cwd: s.root });
  const tag = read(c, "w.txt");
  edit(c, "w.txt", tag, [{ from: 2, to: 2, newText: "B1\nB2" }]);
  assert.equal(s.read("w.txt"), "a\r\nB1\r\nB2\r\nc\r\n");
});

test("FTOL-36 several line edits: bottom-up, overlaps fail while the earlier edit is written", () => {
  const s = scratch({ "f.txt": nums(8) });
  const c = client({ cwd: s.root });
  const tag = read(c, "f.txt");
  const r = edit(c, "f.txt", tag, [{ from: 3, to: 5, newText: "M" }, { from: 5, to: 5, newText: "N" }, { after: 3, newText: "O" }]);
  assert.match(r.text, /PARTLY WRITTEN: 1 edit\(s\) written, 2 failed/);
  assert.equal((r.text.match(/overlaps edit 1 lines 3-5; give one edit for these lines/g) ?? []).length, 2);
  assert.equal(s.read("f.txt"), "L1\nL2\nM\nL6\nL7\nL8\n");
  const t = scratch({ "g.txt": nums(4) });
  const d = client({ cwd: t.root });
  const gt = read(d, "g.txt");
  edit(d, "g.txt", gt, [{ from: 4, to: 4, newText: "four" }, { after: 1, newText: "i1" }, { after: 1, newText: "i2" }, { from: 1, to: 1, newText: "one" }]);
  assert.equal(t.read("g.txt"), "one\ni1\ni2\nL2\nL3\nfour\n");
  const twice = edit(d, "g.txt", read(d, "g.txt"), [{ from: 2, to: 2, newText: "x" }, { from: 2, to: 2, newText: "x" }]);
  assert.match(twice.text, /already applied: the same edit is listed twice/);
});

test("FTOL-32 a resent after:0 insert is not doubled", () => {
  const s = scratch({ "f.txt": nums(3) });
  const c = client({ cwd: s.root });
  const tag = read(c, "f.txt");
  edit(c, "f.txt", tag, [{ after: 0, newText: "HEAD" }]);
  const again = edit(c, "f.txt", tag, [{ after: 0, newText: "HEAD" }]);
  assert.match(again.text, /already applied/);
  assert.equal(s.read("f.txt"), "HEAD\nL1\nL2\nL3\n");
});

test("FTOL-37 {id} applies a suggestion of a stale tag; {id, from, to} renumbers against shown lines", () => {
  const s = scratch({ "f.txt": "a\nb\nc\nd\ne\nf\ng\n" });
  const c = client({ cwd: s.root });
  const tag = read(c, "f.txt");
  s.write("f.txt", "a\nB\nc\nd\nE\nf\ng\nh\n");
  const r = edit(c, "f.txt", tag, [{ from: 4, to: 4, newText: "D" }]);
  assert.match(r.text, /SUGGESTED there/);
  const [id] = fixesOf(r.text);
  c.call("edit_multiple_files", { fixes: [{ id }] });
  assert.equal(s.read("f.txt"), "a\nB\nc\nD\nE\nf\ng\nh\n");
  const t = scratch({ "g.txt": "1\n2\n3\n" });
  const d = client({ cwd: t.root });
  const gt = read(d, "g.txt");
  t.write("g.txt", "1\nTWO\n3\n");
  const failed = edit(d, "g.txt", gt, [{ from: 2, to: 2, newText: "two" }]);
  const [gid] = fixesOf(failed.text);
  d.call("edit_multiple_files", { fixes: [{ id: gid, from: 2, to: 2, newText: "2b" }] });
  assert.equal(t.read("g.txt"), "1\n2b\n3\n");
  t.write("g.txt", "1\nTWO\n3\n");
  const vanish = edit(d, "g.txt", read(d, "g.txt"), [{ from: 9, to: 9, newText: "x" }]);
  const [vid] = fixesOf(vanish.text);
  fs.rmSync(t.path("g.txt"));
  assert.match(d.call("edit_multiple_files", { fixes: [{ id: vid }] }).text, /file not found any more/);
});

