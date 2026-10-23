import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { guessPath } from "../../ship/.agents/harness/files/guess.mjs";
import { readSpan } from "../../ship/.agents/harness/files/reader.mjs";
import { client, scratch, tagOf } from "./helpers.mjs";

const lines = (n, f = (i) => `line ${i}`) => Array.from({ length: n }, (_, i) => f(i + 1)).join("\n");

test("FTOL-21 read_ranges: good entry first, then one ERROR line per failed entry", () => {
  const s = scratch({ "a.txt": "1\n2\n3\n4", "dir/x.txt": "x", "four.txt": "a\nb\nc\nd" });
  const c = client({ cwd: s.root });
  const r = c.call("read_ranges", { ranges: [
    { path: "a.txt", from: 2, to: 9 }, { path: "nothing-like-it.bin" }, { path: "dir" }, { path: "four.txt", from: 9 }, { path: "four.txt", from: 3, to: 2 },
  ] });
  assert.ok(!r.isError);
  const [entry, errors] = r.text.split("\n\n");
  assert.match(entry, new RegExp(`^===== ${s.path("a.txt").replace(/\\/g, "\\\\")} lines 2-4 of 4, tag \\w+t\\d+\\n2\\| 2\\n3\\| 3\\n4\\| 4$`));
  const errs = errors.split("\n");
  assert.equal(errs.length, 4);
  assert.ok(errs.every((l) => l.startsWith("ERROR ")));
  assert.match(errs[0], /nothing-like-it\.bin: file not found/);
  assert.match(errs[1], /^ERROR dir: is a folder; it holds 1 entries: x\.txt$/);
  assert.equal(errs[2], "ERROR four.txt: line 9 is past the end (4 lines)");
  assert.match(errs[3], /four\.txt: to 2 is before from 3/);
});

test("FTOL-21 trailing newline counts as a line; CR stripped; all entries failing is an error", () => {
  const s = scratch({ "t.txt": "one\ntwo\nthree\n", "crlf.txt": "a\r\nb\r\n" });
  const c = client({ cwd: s.root });
  const r = c.call("read_ranges", { ranges: [{ path: "t.txt" }, { path: "crlf.txt" }] });
  assert.match(r.text, /lines 1-4 of 4/);
  assert.match(r.text, /1\| a\n2\| b\n3\| $/m);
  assert.ok(!r.text.includes("\r"));
  const bad = c.call("read_ranges", { ranges: [{ path: "missing-entirely.zzz" }] });
  assert.ok(bad.isError);
  assert.match(bad.text, /^ERROR \(details\/fix IDs are paginated, not discarded\)\nmissing-entirely\.zzz: file not found/);
});

test("FTOL-21 line numbers are padded to the last number's width", () => {
  const s = scratch({ "n.txt": lines(12) });
  const r = client({ cwd: s.root }).call("read_ranges", { ranges: [{ path: "n.txt", from: 8, to: 10 }] });
  assert.match(r.text, /\n 8\| line 8\n 9\| line 9\n10\| line 10$/);
});

test("FTOL-22 an oversized entry gives the lines that fit, and reading them succeeds", () => {
  const s = scratch({ "big.txt": lines(200, (i) => "x".repeat(50) + i) });
  const env = {};
  fs.mkdirSync(s.path(".agents"));
  fs.writeFileSync(s.path(".agents/harness.config.json"), JSON.stringify({ read_limits: { fileMaxChars: 1000, replyMaxChars: 2000 } }));
  const c = client({ cwd: s.root, env });
  const r = c.call("read_ranges", { ranges: [{ path: "big.txt" }] });
  const m = /big\.txt: lines 1-200 have ([\d,]+) characters, over the 1,000-character limit for one entry; lines 1-(\d+) fit/.exec(r.text);
  assert.ok(m, r.text);
  const ok = c.call("read_ranges", { ranges: [{ path: "big.txt", from: 1, to: Number(m[2]) }] });
  assert.ok(!ok.isError, ok.text);
  const over = c.call("read_ranges", { ranges: [{ path: "big.txt", from: 1, to: Number(m[2]) + 1 }] });
  assert.ok(over.isError);
});

test("FTOL-22 entries past the reply budget are deferred; later small entries still read; path errors cost nothing", () => {
  const files = {};
  for (let i = 0; i < 3; i++) files[`f${i}.txt`] = "y".repeat(700);
  files["small.txt"] = "s";
  const s = scratch(files);
  fs.mkdirSync(s.path(".agents"));
  fs.writeFileSync(s.path(".agents/harness.config.json"), JSON.stringify({ read_limits: { fileMaxChars: 1000, replyMaxChars: 2000 } }));
  const c = client({ cwd: s.root });
  const r = c.call("read_ranges", { ranges: [{ path: "nope-a.q" }, { path: "f0.txt" }, { path: "f1.txt" }, { path: "f2.txt" }, { path: "small.txt" }] });
  const deferred = r.text.split("\n").filter((l) => l.includes("not read in this call"));
  assert.equal(deferred.length, 1);
  assert.match(deferred[0], /^ERROR f2\.txt lines 1-1: not read in this call: with it the reply would pass 2,000 characters; read it in another call$/);
  assert.match(r.text, /small\.txt lines 1-1 of 1/);
});

test("FTOL-22 a single line over the cap points at a script", () => {
  const s = scratch({ "one.txt": "z".repeat(40000) });
  const r = client({ cwd: s.root }).call("read_ranges", { ranges: [{ path: "one.txt" }] });
  assert.match(r.text, /line 1 alone has 40,000 characters, so a line range cannot cut it: extract the part you need with a script/);
});

test("FTOL-23 a read within the default limits is one page without a continuation", () => {
  const s = scratch({ "page.txt": lines(360, () => "p".repeat(93)) });
  const r = client({ cwd: s.root }).call("read_ranges", { ranges: [{ path: "page.txt" }] });
  assert.ok(!r.isError, r.text.slice(0, 300));
  assert.ok(r.text.length > 35000 && r.text.length <= 36200, String(r.text.length));
  assert.ok(!r.text.includes("CONTINUATION"));
});

test("FTOL-17 the project's read_limits apply per request; a bad overlay fails the call, describe still works", () => {
  const s = scratch({ "f.txt": "q".repeat(150) });
  fs.mkdirSync(s.path(".agents"));
  const overlay = s.path(".agents/harness.config.json");
  fs.writeFileSync(overlay, JSON.stringify({ read_limits: { fileMaxChars: 100, replyMaxChars: 200 } }));
  const c = client({ cwd: path.join(s.root) });
  assert.match(c.call("read_ranges", { ranges: [{ path: "f.txt" }] }).text, /over the 100-character limit/);
  fs.writeFileSync(overlay, JSON.stringify({ typo_key: 1 }));
  const bad = c.call("read_ranges", { ranges: [{ path: "f.txt" }] });
  assert.ok(bad.isError);
  assert.match(bad.text, /invalid harness config typo_key: unknown key/);
  assert.equal(c.t({ action: "describe" }).tools.length, 3);
  fs.writeFileSync(overlay, JSON.stringify({ read_limits: { fileMaxChars: 100, replyMaxChars: 40001 } }));
  assert.match(c.call("read_ranges", { ranges: [{ path: "f.txt" }] }).text, /invalid harness config read_limits\.replyMaxChars/);
  fs.writeFileSync(overlay, "{}");
  assert.ok(!c.call("read_ranges", { ranges: [{ path: "f.txt" }] }).isError);
});

test("FTOL-24 a binary entry is refused while a sibling text entry reads", () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.alloc(100, 7)]);
  const s = scratch({ "img.png": png, "t.txt": "text" });
  const r = client({ cwd: s.root }).call("read_ranges", { ranges: [{ path: "img.png" }, { path: "t.txt" }] });
  assert.match(r.text, /t\.txt lines 1-1 of 1/);
  assert.match(r.text, /ERROR img\.png: not read: a binary file \(112 bytes\), not text; open images and PDFs with the native Read tool; read other binary files with a script or a tool made for them/);
});

test("G190 a text entry that is not valid UTF-8 is refused, not shown with replacement characters", () => {
  const s = scratch({ "latin.txt": Buffer.from([0x61, 0xe9, 0x0a]), "t.txt": "text" });
  const r = client({ cwd: s.root }).call("read_ranges", { ranges: [{ path: "latin.txt" }, { path: "t.txt" }] });
  assert.match(r.text, /t\.txt lines 1-1 of 1/);
  assert.match(r.text, /ERROR latin\.txt: not read: not UTF-8 text/);
  assert.doesNotMatch(r.text, /�/);
});

test("FTOL-25 the reader keeps bounded memory on a 48 MiB line", () => {
  const s = scratch();
  const fd = fs.openSync(s.path("huge.txt"), "w");
  const chunk = Buffer.alloc(1 << 20, 0x61);
  for (let i = 0; i < 48; i++) fs.writeSync(fd, chunk);
  fs.writeSync(fd, "\nshort\n");
  fs.closeSync(fd);
  const reader = fileURLToPath(new URL("../../ship/.agents/harness/files/reader.mjs", import.meta.url));
  const script = `import { readSpan } from ${JSON.stringify(new URL(`file:///${reader.replace(/\\/g, "/")}`).href)};
const f = process.argv[1];
const two = readSpan(f, 2, 2, 36000); const one = readSpan(f, 1, 1, 36000);
console.log(JSON.stringify({ two: two.lines, one: one.lines, first: one.firstLength, fit: one.fit }));`;
  const r = spawnSync(process.execPath, ["--max-old-space-size=32", "--input-type=module", "-e", script, s.path("huge.txt")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.two, ["short"]);
  assert.equal(out.one, null);
  assert.equal(out.first, 50331648);
  const c = client({ cwd: s.root });
  assert.match(c.call("read_ranges", { ranges: [{ path: "huge.txt", from: 1, to: 1 }] }).text, /line 1 alone has 50,331,648 characters/);
});

test("FTOL-25 readSpan keeps multi-byte text intact across chunk boundaries", () => {
  const s = scratch({ "u.txt": `${"é".repeat(40000)}\nend` });
  const r = readSpan(s.path("u.txt"), 1, 2, 100000);
  assert.equal(r.lines[0], "é".repeat(40000));
  assert.equal(r.lines[1], "end");
});

test("FTOL-18 relative, Git Bash and ~ paths resolve; POSIX keeps case-distinct targets", (t) => {
  const s = scratch({ "sub/rel.txt": "rel" });
  const c = client({ cwd: s.root });
  assert.match(c.call("read_ranges", { ranges: [{ path: "sub/rel.txt" }] }).text, /1\| rel/);
  if (process.platform === "win32") {
    const abs = s.path("sub/rel.txt").replace(/\\/g, "/");
    const bash = `/${abs[0].toLowerCase()}${abs.slice(2)}`;
    assert.match(c.call("read_ranges", { ranges: [{ path: bash }] }).text, /1\| rel/);
  }
  const home = scratch({ "f": "home file" });
  const key = process.platform === "win32" ? "USERPROFILE" : "HOME";
  const saved = process.env[key];
  process.env[key] = home.root;
  t.after(() => { process.env[key] = saved; });
  const r = c.call("read_ranges", { ranges: [{ path: "~/f" }] });
  assert.match(r.text, /1\| home file/);
  assert.ok(r.checks.some((ch) => ch.input.file_path === home.path("f")));
  if (process.platform !== "win32") {
    const p = scratch({ "A.txt": "upper", "a.txt": "lower" });
    const pc = client({ cwd: p.root });
    assert.match(pc.call("read_ranges", { ranges: [{ path: "a.txt" }] }).text, /1\| lower/);
  }
});

test("FTOL-19 missing-path guesses: unique, several nearest first, look-alikes, case-insensitive", () => {
  const s = scratch({ "specs/20-creature/X.md": "x", "specs/10-a/Y.md": "1", "specs/10-a/deep/Y.md": "2", "specs/notes.md": "n", "node_modules/q/X.md": "skip" });
  assert.equal(guessPath(s.path("specs/20-species/X.md"), s.root).unique, s.path("specs/20-creature/X.md"));
  const two = guessPath(s.path("specs/10-a/zz/Y.md"), s.root);
  assert.equal(two.unique, undefined);
  assert.deepEqual(two.candidates, [s.path("specs/10-a/Y.md"), s.path("specs/10-a/deep/Y.md")]);
  assert.deepEqual(guessPath(s.path("specs/notse.md"), s.root).candidates, [s.path("specs/notes.md")]);
  assert.equal(guessPath(s.path("specs/20-species/x.MD"), s.root).unique, s.path("specs/20-creature/X.md"));
});

test("FTOL-20 a unique guess is read in place and announced; permission plan includes it", () => {
  const s = scratch({ "specs/20-creature/X.md": "real" });
  const r = client({ cwd: s.root }).call("read_ranges", { ranges: [{ path: "specs/20-species/X.md" }] });
  assert.match(r.text, /===== .*20-creature[\\/]X\.md lines 1-1 of 1, tag \w+ \(read in place of specs\/20-species\/X\.md, which does not exist: the only file of that name nearby\)/);
  assert.ok(r.checks.some((ch) => ch.tool === "Read" && ch.input.file_path === s.path("specs/20-creature/X.md")));
});

test("FTOL-34 a read registers a tag; a 65th read evicts the first; tags are session-bound", () => {
  const s = scratch({ "f.txt": "a\nb" });
  const c = client({ cwd: s.root });
  const first = tagOf(c.call("read_ranges", { ranges: [{ path: "f.txt" }] }).text);
  assert.match(first, /^[a-z]{2}t1$/);
  const edit = (cl, tag) => cl.call("edit_multiple_files", { files: [{ path: "f.txt", tag, edits: [{ from: 1, to: 1, newText: "A" }] }], dryRun: true });
  assert.match(edit(c, first).text, /would edit/);
  const other = client({ cwd: s.root, session: "session-b", stateRoot: c.stateRoot });
  assert.match(edit(other, first).text, /unknown tag/);
  for (let i = 0; i < 64; i++) c.call("read_ranges", { ranges: [{ path: "f.txt" }] });
  assert.match(edit(c, first).text, /unknown tag .*expired, or from an earlier server process\); read the lines again with read_ranges/);
});
