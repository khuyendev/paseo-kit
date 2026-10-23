import assert from "node:assert/strict";
import test from "node:test";
import { client, scratch } from "../files/helpers.mjs";

const edit = (c, files, extra = {}) => c.call("edit_multiple_files", { files, ...extra });

test("G190 edit refuses a file that is not valid UTF-8 and leaves every byte as it was", () => {
  const bytes = Buffer.from([0x61, 0xff, 0x62, 0x0a, 0x63, 0x0a]);
  const s = scratch({ "latin.txt": bytes });
  const r = edit(client({ cwd: s.root }), [{ path: "latin.txt", edits: [{ oldText: "b", newText: "B" }] }]);
  assert.equal(r.isError, true);
  assert.match(r.text, /latin\.txt: not UTF-8 text/);
  assert.deepEqual(s.bytes("latin.txt"), bytes);
});

test("G190 edit refuses a truncated multi-byte sequence at the end of the file", () => {
  const bytes = Buffer.from([0x61, 0x62, 0xe2, 0x82]);
  const s = scratch({ "cut.txt": bytes });
  const r = edit(client({ cwd: s.root }), [{ path: "cut.txt", edits: [{ oldText: "a", newText: "A" }] }]);
  assert.equal(r.isError, true);
  assert.match(r.text, /cut\.txt: not UTF-8 text/);
  assert.deepEqual(s.bytes("cut.txt"), bytes);
});

test("G190 edit still changes a valid UTF-8 file that holds a U+FFFD and a BOM", () => {
  const s = scratch({ "ok.txt": Buffer.from(`﻿a � b\n`, "utf8") });
  const r = edit(client({ cwd: s.root }), [{ path: "ok.txt", edits: [{ oldText: "b", newText: "B" }] }]);
  assert.match(r.text, /^edited .*ok\.txt: 1 edit\(s\), \+0 chars$/);
  assert.deepEqual(s.bytes("ok.txt"), Buffer.from(`﻿a � B\n`, "utf8"));
});

test("G190 read_ranges refuses a file that is not valid UTF-8 instead of showing replacement characters", () => {
  const s = scratch({ "latin.txt": Buffer.from([0x61, 0xff, 0x62, 0x0a, 0x63]) });
  const r = client({ cwd: s.root }).call("read_ranges", { ranges: [{ path: "latin.txt" }] });
  assert.equal(r.isError, true);
  assert.match(r.text, /latin\.txt: not read: not UTF-8 text/);
  assert.doesNotMatch(r.text, /�/);
});

test("G190 read_ranges checks the whole file, so a bad byte after the requested lines is still refused", () => {
  const s = scratch({ "tail.txt": Buffer.from([0x61, 0x0a, 0x62, 0x0a, 0xc3]) });
  const r = client({ cwd: s.root }).call("read_ranges", { ranges: [{ path: "tail.txt", from: 1, to: 1 }] });
  assert.equal(r.isError, true);
  assert.match(r.text, /tail\.txt: not read: not UTF-8 text/);
});

test("G190 read_ranges still reads valid UTF-8 that holds a U+FFFD", () => {
  const s = scratch({ "ok.txt": Buffer.from("a � b\nc", "utf8") });
  const r = client({ cwd: s.root }).call("read_ranges", { ranges: [{ path: "ok.txt" }] });
  assert.match(r.text, /1\| a � b\n2\| c$/);
});
