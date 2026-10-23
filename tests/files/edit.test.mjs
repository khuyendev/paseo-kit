import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { editMultiple } from "../../ship/.agents/harness/files/edit.mjs";
import { createStore } from "../../ship/.agents/harness/files/store.mjs";
import { client, fixIds, scratch } from "./helpers.mjs";

const edit = (c, files, extra = {}) => c.call("edit_multiple_files", { files, ...extra });

test("FTOL-28 partial success: first and third written, PARTLY WRITTEN, summary not diff", () => {
  const s = scratch({ "f.txt": "alpha\nbeta\ngamma\n" });
  const c = client({ cwd: s.root });
  const r = edit(c, [{ path: "f.txt", edits: [{ oldText: "alpha", newText: "ALPHA" }, { oldText: "nothing here at all", newText: "x" }, { oldText: "gamma", newText: "GAMMA" }] }]);
  assert.match(r.text, /PARTLY WRITTEN: 2 edit\(s\) written, 1 failed and not written\./);
  assert.match(r.text, /edited .*f\.txt: 2 edit\(s\) \(1 failed\), \+0 chars/);
  assert.equal(s.read("f.txt"), "ALPHA\nbeta\nGAMMA\n");
});

test("FTOL-28 atomic aborts every file; dryRun writes nothing and says DRY RUN", () => {
  const s = scratch({ "a.txt": "one", "b.txt": "two" });
  const c = client({ cwd: s.root });
  const files = [{ path: "a.txt", edits: [{ oldText: "one", newText: "1" }] }, { path: "b.txt", edits: [{ oldText: "absent text", newText: "2" }] }];
  const atomic = edit(c, files, { atomic: true });
  assert.match(atomic.text, /nothing written \(atomic: true\): 1 edit\(s\) failed\./);
  assert.equal(s.read("a.txt"), "one");
  const dry = edit(c, files, { dryRun: true });
  assert.match(dry.text, /DRY RUN, nothing written: 1 edit\(s\) would be written, 1 would fail/);
  assert.match(dry.text, /would edit .*a\.txt: 1 edit\(s\), -2 chars/);
  assert.equal(s.read("a.txt"), "one");
  const ok = edit(c, [files[0]]);
  assert.match(ok.text, /^edited .*a\.txt: 1 edit\(s\), -2 chars$/);
  assert.match(edit(c, [{ path: "a.txt", edits: [{ oldText: "1", newText: "1" }] }]).text, /edited/);
  assert.equal(c.call("edit_multiple_files", {}).text.includes("nothing written: give files, fixes or both"), true);
});

test("FTOL-28 a successful edit of a file with long lines replies in under 300 chars", () => {
  const s = scratch({ "w.txt": `${"w".repeat(5000)}\nmark\n${"v".repeat(5000)}` });
  const r = edit(client({ cwd: s.root }), [{ path: "w.txt", edits: [{ oldText: "mark", newText: "MARK" }] }]);
  assert.ok(r.text.length < 300, r.text);
});

test("FTOL-29 CRLF file edited as LF stays CRLF; mixed endings refused byte-identical; missing file gets a fix ID", () => {
  const s = scratch({ "c.txt": "a\r\nb\r\nc\r\n", "m.txt": "a\r\nb\nc\r\n" });
  const c = client({ cwd: s.root });
  edit(c, [{ path: "c.txt", edits: [{ oldText: "a\nb", newText: "A\nB\nX" }] }]);
  assert.equal(s.read("c.txt"), "A\r\nB\r\nX\r\nc\r\n");
  const before = s.bytes("m.txt");
  const mixed = edit(c, [{ path: "m.txt", edits: [{ oldText: "b", newText: "B" }] }]);
  assert.match(mixed.text, /m\.txt: mixed line endings; use native Edit \(1 edit\(s\) not written\) → fix: \{"id":"[a-z]{2}\d+","path":"<corrected>"\}/);
  assert.deepEqual(s.bytes("m.txt"), before);
  const missing = edit(c, [{ path: "gone.txt", edits: [{ oldText: "x", newText: "y" }] }]);
  assert.match(missing.text, /[a-z]{2}\d+ gone\.txt: file not found \(1 edit\(s\) not written\)/);
  assert.equal(s.exists("gone.txt"), false);
});

test("FTOL-29 oldText must occur exactly once", () => {
  const s = scratch({ "d.txt": "dup\nx\ndup\n" });
  const c = client({ cwd: s.root });
  const r = edit(c, [{ path: "d.txt", edits: [{ oldText: "dup", newText: "one" }] }]);
  assert.match(r.text, /([a-z]{2}\d+) d\.txt edit 1 "dup": found 2 times \(#1 line 1, #2 line 3\) → fix: \{"id":"\1","occurrence":<1-2>\}/);
  const id = fixIds(r.text.split("failed:\n")[1])[0];
  c.call("edit_multiple_files", { fixes: [{ id, occurrence: 2 }] });
  assert.equal(s.read("d.txt"), "dup\nx\none\n");
});

test("FTOL-30 whitespace, NBSP, short-stretch, earlier-edit and newText hints; {id} applies a suggestion", () => {
  const s = scratch({ "s.txt": "function   foo(a,  b) {\n  return a + b;\n}\nconst value = computeSomething(alpha, beta);\n" });
  const c = client({ cwd: s.root });
  const ws = edit(c, [{ path: "s.txt", edits: [{ oldText: "function foo(a, b) {", newText: "function foo(a, b, c) {" }] }]);
  assert.match(ws.text, /found 0 times; SUGGESTED at line 1, differing only in whitespace, letter case or look-alike characters/);
  const nb = edit(c, [{ path: "s.txt", edits: [{ oldText: "return a + b;", newText: "return a - b;" }] }]);
  assert.match(nb.text, /SUGGESTED at line 2, .*U\+00A0/);
  const stretch = edit(c, [{ path: "s.txt", edits: [{ oldText: "const value = computeSomethingElse(alpha, beta);", newText: "const value = 1;" }] }]);
  assert.match(stretch.text, /SUGGESTED at line 4, differing only in a short stretch/);
  const id = fixIds(stretch.text.split("failed:\n")[1])[0];
  assert.match(stretch.text, new RegExp(`fix: \\{"id":"${id}"\\}`));
  c.call("edit_multiple_files", { fixes: [{ id }] });
  assert.match(s.read("s.txt"), /const value = 1;/);
  const earlier = edit(c, [{ path: "s.txt", edits: [{ oldText: "const value = 1;", newText: "const value = 2;" }, { oldText: "const value = 1;", newText: "const value = 3;" }] }]);
  assert.match(earlier.text, /the file had it before this call \(line 4\), but an earlier edit of this call changed it/);
  const hint = edit(c, [{ path: "s.txt", edits: [{ oldText: "zzzzqqqqzzzzqqqq", newText: "const value = 2;" }] }]);
  assert.match(hint.text, /newText already occurs at line 4/);
  assert.match(hint.text, /"oldText":"<corrected>"/);
});

test("FTOL-31 fix IDs are single use; dryRun keeps them; 600 failures keep 500; huge failures are not retained", () => {
  const s = scratch({ "f.txt": "hello world\n" });
  const c = client({ cwd: s.root });
  const r = edit(c, [{ path: "f.txt", edits: [{ oldText: "hello  world", newText: "bye world" }] }]);
  const [id] = fixIds(r.text.split("failed:\n")[1]);
  assert.match(c.call("edit_multiple_files", { fixes: [{ id }], dryRun: true }).text, /would edit/);
  assert.match(c.call("edit_multiple_files", { fixes: [{ id }] }).text, /^edited/);
  assert.equal(s.read("f.txt"), "bye world\n");
  assert.match(c.call("edit_multiple_files", { fixes: [{ id }] }).text, new RegExp(`${id}: unknown fix id \\(or expired\\)`));
  const many = Array.from({ length: 600 }, (_, i) => ({ oldText: `missing ${i} zz`, newText: "x" }));
  const big = edit(c, [{ path: "f.txt", edits: many }]);
  const ids = fixIds(big.text.split("failed:\n")[1] ?? "");
  assert.ok(big.text.includes("CONTINUATION"), "paged");
  assert.ok(ids.length > 0);
  const [, run, n] = /^([a-z]{2})(\d+)$/.exec(ids[0]);
  const probe = (k) => c.call("edit_multiple_files", { fixes: [{ id: `${run}${Number(n) + k}` }], dryRun: true }).text;
  assert.match(probe(99), /unknown fix id/);
  assert.match(probe(100), /found 0 times/);
  assert.match(probe(599), /found 0 times/);
  const huge = edit(c, [{ path: "f.txt", edits: [{ oldText: "absent zz", newText: "n".repeat(9 * 1024 * 1024) }] }]);
  assert.match(huge.text, /not retained: this replacement exceeds the 8 MiB failure-state budget; resend a smaller edit/);
});

test("FTOL-32 resent edits are skipped, never doubled; dryRun and atomic aborts do not count", () => {
  const s = scratch({ "f.txt": "a\nkeep\n" });
  const c = client({ cwd: s.root });
  const files = [{ path: "f.txt", edits: [{ oldText: "a", newText: "a b" }] }];
  edit(c, files);
  const again = edit(c, files);
  assert.match(again.text, /already applied: newText already covers the only match \(line 1\)/);
  assert.equal(s.read("f.txt"), "a b\nkeep\n");
  const gone = [{ path: "f.txt", edits: [{ oldText: "keep", newText: "kept" }] }];
  edit(c, gone);
  assert.match(edit(c, gone).text, /already applied: this session wrote this edit before/);
  const other = client({ cwd: s.root, session: "other", stateRoot: c.stateRoot });
  assert.match(edit(other, gone).text, /found 0 times/);
  const t = scratch({ "g.txt": "x\n", "h.txt": "y\n" });
  const d = client({ cwd: t.root });
  const once = [{ path: "g.txt", edits: [{ oldText: "x", newText: "z" }] }];
  edit(d, once, { dryRun: true });
  edit(d, [...once, { path: "h.txt", edits: [{ oldText: "missing", newText: "q" }] }], { atomic: true });
  t.write("g.txt", "z\n");
  assert.match(edit(d, once).text, /found 0 times/);
});

test("FTOL-33 per-file independence; two entries for one file; {id, path} applies retained edits", () => {
  const s = scratch({ "a.txt": "a1", "b.txt": "b1", "real/c.txt": "c1" });
  const c = client({ cwd: s.root });
  const r = edit(c, [
    { path: "a.txt", edits: [{ oldText: "a1", newText: "a2" }] },
    { path: "nope1.txt", edits: [{ oldText: "q", newText: "w" }] },
    { path: "b.txt", edits: [{ oldText: "b1", newText: "b2" }] },
    { path: "wrong/c.txt", edits: [{ oldText: "c1", newText: "c2" }] },
    { path: "a.txt", edits: [{ oldText: "a2", newText: "a3" }] },
  ]);
  assert.equal(s.read("a.txt"), "a3");
  assert.equal(s.read("b.txt"), "b2");
  const ids = fixIds(r.text.split("failed:\n")[1]);
  assert.equal(ids.length, 2);
  assert.match(r.text, /wrong\/c\.txt: file not found; did you mean: .*real[\\/]c\.txt \(1 edit\(s\) not written\) → fix: \{"id":"\w+","path":".*c\.txt"\}/);
  assert.equal(s.read("real/c.txt"), "c1"); // mutation targets are never guessed
  c.call("edit_multiple_files", { fixes: [{ id: ids[1], path: "real/c.txt" }] });
  assert.equal(s.read("real/c.txt"), "c2");
  const folder = edit(c, [{ path: "real", edits: [{ oldText: "x", newText: "y" }] }]);
  assert.match(folder.text, /real: is a folder, not a file/);
});

test("FTOL-24 an edit of a binary file writes nothing and fails at file level", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1, 65, 66]);
  const s = scratch({ "i.png": png });
  const r = edit(client({ cwd: s.root }), [{ path: "i.png", edits: [{ oldText: "AB", newText: "CD" }] }]);
  assert.match(r.text, /i\.png: a binary file \(10 bytes\), not text.*→ fix:/);
  assert.deepEqual(s.bytes("i.png"), png);
});

test("G190 an edit of a file that is not valid UTF-8 writes nothing; the bytes stay as they were", () => {
  const bytes = Buffer.from([0x61, 0xff, 0x62, 0x0a]);
  const s = scratch({ "latin.txt": bytes });
  const r = edit(client({ cwd: s.root }), [{ path: "latin.txt", edits: [{ oldText: "b", newText: "B" }] }]);
  assert.match(r.text, /latin\.txt: not UTF-8 text.*→ fix:/);
  assert.deepEqual(s.bytes("latin.txt"), bytes);
});

test("FTOL-20 a wrong-folder edit leaves the real file untouched; the fix form carries the guess and applies", () => {
  const s = scratch({ "specs/20-creature/X.md": "old" });
  const c = client({ cwd: s.root });
  const r = edit(c, [{ path: "specs/20-species/X.md", edits: [{ oldText: "old", newText: "new" }] }]);
  const m = /→ fix: (\{"id":"(\w+)","path":(".*")\})/.exec(r.text);
  assert.ok(m, r.text);
  assert.equal(JSON.parse(m[3]), s.path("specs/20-creature/X.md"));
  assert.equal(s.read("specs/20-creature/X.md"), "old");
  c.call("edit_multiple_files", { fixes: [JSON.parse(m[1])] });
  assert.equal(s.read("specs/20-creature/X.md"), "new");
});

test("FTOL-33 two spellings of one file through a junction share one state; both edits survive (CR-FIL-02)", () => {
  const s = scratch({ "real/f.txt": "alpha\nbeta\n" });
  fs.symlinkSync(s.path("real"), s.path("alias"), "junction");
  const r = edit(client({ cwd: s.root }), [
    { path: "real/f.txt", edits: [{ oldText: "alpha", newText: "ALPHA" }] },
    { path: "alias/f.txt", edits: [{ oldText: "beta", newText: "BETA" }] },
  ]);
  assert.match(r.text, /^edited .*f\.txt: 2 edit\(s\), \+0 chars$/);
  assert.equal(s.read("real/f.txt"), "ALPHA\nBETA\n");
});

test("FTOL-31 a fix ID listed twice in one call applies once (CR-FIL-03)", () => {
  const s = scratch({ "d.txt": "dup\ndup" });
  const c = client({ cwd: s.root });
  const [id] = fixIds(edit(c, [{ path: "d.txt", edits: [{ oldText: "dup", newText: "dup!" }] }]).text.split("failed:\n")[1]);
  const r = c.call("edit_multiple_files", { fixes: [{ id, occurrence: 1 }, { id, occurrence: 1 }] });
  assert.match(r.text, /^edited .*d\.txt: 1 edit\(s\)/);
  assert.match(r.text, new RegExp(`${id}: this fix ID is listed again in this call; it was handled once`));
  assert.equal(s.read("d.txt"), "dup!\ndup");
});

test("FTOL-31 a retained empty oldText retried by ID fails with a diagnosis instead of looping (CR-FIL-04)", () => {
  const s = scratch({ "f.txt": "text\ntext\n" });
  const abs = s.path("f.txt");
  const store = createStore({ run: "ab", nextFix: 3, fixes: [["ab1", { abs, oldText: "", newText: "x" }], ["ab2", { abs, oldText: "", newText: "x", occurrences: 2 }]] });
  const ctx = { cwd: s.root, guard: () => {}, store };
  const r = editMultiple({ fixes: [{ id: "ab1" }, { id: "ab2", occurrence: 1 }] }, ctx);
  assert.equal(r.isError, true);
  assert.match(r.text, /ab1 .*: oldText is empty/);
  assert.match(r.text, /ab2 .*: oldText is empty/);
  assert.equal(s.read("f.txt"), "text\ntext\n");
});

test("FTOL-31 an atomic abort keeps a fix ID skipped as already applied (CR-FIL-05)", () => {
  const s = scratch({ "f.txt": "hello world\n" });
  const c = client({ cwd: s.root });
  const [id] = fixIds(edit(c, [{ path: "f.txt", edits: [{ oldText: "hello  world", newText: "hello world!" }] }]).text.split("failed:\n")[1]);
  s.write("f.txt", "hello world!\n");
  const before = s.bytes("f.txt");
  const r = c.call("edit_multiple_files", { fixes: [{ id }, { id: "zz999" }], atomic: true });
  assert.match(r.text, /^nothing written: 1 edit\(s\) failed/m);
  assert.match(r.text, /skipped, already in the file/);
  assert.deepEqual(s.bytes("f.txt"), before);
  assert.doesNotMatch(c.call("edit_multiple_files", { fixes: [{ id }], dryRun: true }).text, /unknown fix id/);
});
