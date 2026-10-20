import assert from "node:assert/strict";
import test from "node:test";
import { frontmatter, parseYaml } from "../../ship/.agents/harness/gsd/yaml.mjs";

test("GSDC-05 PLAN frontmatter with nested must_haves parses to exact JSON", () => {
  const text = `---
phase: 01-core
plan: 01
wave: 2
depends_on: [01-01]
owns: ["Path:src/a b", 'Path:src/c']
autonomous: false
must_haves:
  truths:
    - "It's observable"
    - plain it's text # a comment
  artifacts:
    - path: src/a.js
      provides: entry
      min_lines: 10
  key_links:
  - from: src/a.js
    to: src/b.js
    pattern: "import .* from"
ratio: 0.5
empty: ~
---
body`;
  const r = frontmatter(text);
  assert.equal(r.error, null);
  assert.deepEqual(r.fm, {
    phase: "01-core",
    plan: 1,
    wave: 2,
    depends_on: ["01-01"],
    owns: ["Path:src/a b", "Path:src/c"],
    autonomous: false,
    must_haves: {
      truths: ["It's observable", "plain it's text"],
      artifacts: [{ path: "src/a.js", provides: "entry", min_lines: 10 }],
      key_links: [{ from: "src/a.js", to: "src/b.js", pattern: "import .* from" }],
    },
    ratio: 0.5,
    empty: null,
  });
  assert.equal(r.body, "body");
});

test("GSDC-05 SUMMARY key-files, VERIFICATION gaps[], block scalars, multi-line flow, BOM and CRLF", () => {
  const text = "﻿---\r\nkey-files:\r\n  created: [src/a.js,\r\n    src/b.js]\r\n  modified: []\r\ngaps:\r\n  - truth: \"x\"\r\n    status: failed\r\n    missing:\r\n      - \"add y\"\r\nnote: |\r\n  line 1\r\n  line 2\r\nfold: >-\r\n  a\r\n  b\r\nmap: {a: 1, b: [true, null]}\r\n---\r\n";
  const r = frontmatter(text);
  assert.equal(r.error, null);
  assert.deepEqual(r.fm, {
    "key-files": { created: ["src/a.js", "src/b.js"], modified: [] },
    gaps: [{ truth: "x", status: "failed", missing: ["add y"] }],
    note: "line 1\nline 2\n",
    fold: "a b",
    map: { a: 1, b: [true, null] },
  });
});

test("GSDC-05 malformed cases return an error naming the line, never throw", () => {
  const cases = [
    ["a: 1\n  b: 2", 2],
    ["a: [1, 2", 1],
    ['a: "open', 1],
    ["a: 1\na: 2", 2],
    ["- x\nb: 1", 2],
  ];
  for (const [src, line] of cases) {
    const r = parseYaml(src);
    assert.ok(r.error, `expected an error for ${JSON.stringify(src)}`);
    assert.equal(r.line, line, `${JSON.stringify(src)}: ${r.error}`);
    assert.match(r.error, new RegExp(`^line ${line}:`));
  }
  const fm = frontmatter("---\nphase: 1\n  bad: x\n---\nbody");
  assert.match(fm.error, /^line 3: /);
  assert.equal(frontmatter("---\nx: 1\n").error, "line 1: unterminated frontmatter (no closing ---)");
});
