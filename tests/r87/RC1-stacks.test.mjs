// Kit feedback #87 C1 (RC1): the stack defaults of the check-weakening verb. For Dart/Flutter, TypeScript, Python, Go, Rust and
// Java: added tests, refactors that keep the assertions (a rename, a renamed variable, a test moved to another file) and a new
// test file pass; a deleted test file, a removed or commented-out assertion and an added skip marker are caught. The kit's own
// tests are recognised too (every test file has declarations and assertions) and an ordinary new kit test passes.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { KIT_DIR, makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";

const { main } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
const checksMod = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/flow-checks.mjs")).href).catch(() => ({}));
const PD = ".planning/phases/03-api";

async function flow(root, argv, input = "") {
  let line = "";
  const code = await main(argv, { root, input: typeof input === "string" ? input : JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}

// Each sample: the test file at its base, and the edits of each scenario as [from, to] replacements (to null = delete the file).
const STACKS = {
  dart: {
    path: "test/parser_test.dart",
    base: `import 'package:test/test.dart';

void main() {
  group('parser', () {
    test('parses empty', () {
      expect(parse(''), isEmpty);
    });

    test('parses one', () {
      final r = parse('a');
      expect(r.length, 1);
      expect(r.first, 'a');
    });
  });
}
`,
    added: ["  });\n}\n", "\n    testWidgets('renders list', (tester) async {\n      await tester.pumpWidget(const App());\n      expect(find.text('a'), findsOneWidget);\n    });\n  });\n}\n"],
    refactor: [["test('parses one'", "test('parses a single item'"], ["final r = parse('a');\n      expect(r.length, 1);\n      expect(r.first, 'a');", "final result = parse('a');\n      expect(result.length, 1);\n      expect(result.first, 'a');"]],
    moved: { block: "\n    test('parses one', () {\n      final r = parse('a');\n      expect(r.length, 1);\n      expect(r.first, 'a');\n    });\n", to: "test/parser_one_test.dart", wrap: (b) => `import 'package:test/test.dart';\n\nvoid main() {${b}}\n` },
    removeAssert: ["      expect(r.first, 'a');\n", ""],
    commentAssert: ["      expect(r.first, 'a');", "      // expect(r.first, 'a');"],
    skip: ["test('parses one', () {", "test('parses one', skip: 'flaky on CI', () {"],
  },
  typescript: {
    path: "src/parser.test.ts",
    base: `import { describe, it, expect } from "vitest";
import { parse } from "./parser";

describe("parser", () => {
  it("parses empty", () => {
    expect(parse("")).toEqual([]);
  });

  it("parses one", () => {
    const r = parse("a");
    expect(r).toHaveLength(1);
    expect(r[0]).toBe("a");
  });
});
`,
    added: ["\n});\n", "\n\n  it.each([[\"a b\", 2]])(\"parses %s\", (text, n) => {\n    expect(parse(text)).toHaveLength(n);\n  });\n});\n"],
    refactor: [["it(\"parses one\"", "it(\"parses a single item\""], ["const r = parse(\"a\");\n    expect(r).toHaveLength(1);\n    expect(r[0]).toBe(\"a\");", "const result = parse(\"a\");\n    expect(result).toHaveLength(1);\n    expect(result[0]).toBe(\"a\");"]],
    moved: { block: "\n  it(\"parses one\", () => {\n    const r = parse(\"a\");\n    expect(r).toHaveLength(1);\n    expect(r[0]).toBe(\"a\");\n  });\n", to: "src/parser-one.spec.ts", wrap: (b) => `import { it, expect } from "vitest";\nimport { parse } from "./parser";\n${b}` },
    removeAssert: ["    expect(r[0]).toBe(\"a\");\n", ""],
    commentAssert: ["    expect(r[0]).toBe(\"a\");", "    // expect(r[0]).toBe(\"a\");"],
    skip: ["it(\"parses one\"", "it.skip(\"parses one\""],
  },
  python: {
    path: "tests/test_parser.py",
    base: `from parser import parse


def test_parses_empty():
    assert parse("") == []


def test_parses_one():
    r = parse("a")
    assert len(r) == 1
    assert r[0] == "a"
`,
    added: ["    assert r[0] == \"a\"\n", "    assert r[0] == \"a\"\n\n\ndef test_parses_two():\n    assert len(parse(\"a b\")) == 2\n"],
    refactor: [["def test_parses_one():", "def test_parses_single_item():"], ["r = parse(\"a\")\n    assert len(r) == 1\n    assert r[0] == \"a\"", "result = parse(\"a\")\n    assert len(result) == 1\n    assert result[0] == \"a\""]],
    moved: { block: "\n\ndef test_parses_one():\n    r = parse(\"a\")\n    assert len(r) == 1\n    assert r[0] == \"a\"\n", to: "tests/test_parser_one.py", wrap: (b) => `from parser import parse\n${b}` },
    removeAssert: ["    assert r[0] == \"a\"\n", ""],
    commentAssert: ["    assert r[0] == \"a\"", "    # assert r[0] == \"a\""],
    skip: ["def test_parses_one():", "@pytest.mark.skip(reason=\"flaky\")\ndef test_parses_one():"],
  },
  go: {
    path: "parser/parser_test.go",
    base: `package parser

import "testing"

func TestParseEmpty(t *testing.T) {
	if got := Parse(""); len(got) != 0 {
		t.Errorf("got %v", got)
	}
}

func TestParseOne(t *testing.T) {
	got := Parse("a")
	if len(got) != 1 {
		t.Fatalf("len %d", len(got))
	}
	if got[0] != "a" {
		t.Errorf("got %q", got[0])
	}
}
`,
    added: ["\t\tt.Errorf(\"got %q\", got[0])\n\t}\n}\n", "\t\tt.Errorf(\"got %q\", got[0])\n\t}\n}\n\nfunc TestParseTwo(t *testing.T) {\n\tif len(Parse(\"a b\")) != 2 {\n\t\tt.Error(\"want 2\")\n\t}\n}\n"],
    refactor: [["func TestParseOne(", "func TestParseSingle("], ["got := Parse(\"a\")\n\tif len(got) != 1 {\n\t\tt.Fatalf(\"len %d\", len(got))\n\t}\n\tif got[0] != \"a\" {\n\t\tt.Errorf(\"got %q\", got[0])", "items := Parse(\"a\")\n\tif len(items) != 1 {\n\t\tt.Fatalf(\"len %d\", len(items))\n\t}\n\tif items[0] != \"a\" {\n\t\tt.Errorf(\"got %q\", items[0])"]],
    moved: { block: "\nfunc TestParseOne(t *testing.T) {\n\tgot := Parse(\"a\")\n\tif len(got) != 1 {\n\t\tt.Fatalf(\"len %d\", len(got))\n\t}\n\tif got[0] != \"a\" {\n\t\tt.Errorf(\"got %q\", got[0])\n\t}\n}\n", to: "parser/one_test.go", wrap: (b) => `package parser\n\nimport "testing"\n${b}` },
    removeAssert: ["\tif got[0] != \"a\" {\n\t\tt.Errorf(\"got %q\", got[0])\n\t}\n", ""],
    commentAssert: ["\t\tt.Errorf(\"got %q\", got[0])", "\t\t// t.Errorf(\"got %q\", got[0])"],
    skip: ["func TestParseOne(t *testing.T) {\n", "func TestParseOne(t *testing.T) {\n\tt.Skip(\"flaky\")\n"],
  },
  rust: {
    path: "src/parser.rs",
    base: `pub fn parse(s: &str) -> Vec<String> {
    s.split_whitespace().map(String::from).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_empty() {
        assert!(parse("").is_empty());
    }

    #[test]
    fn parses_one() {
        let r = parse("a");
        assert_eq!(r.len(), 1);
        assert_eq!(r[0], "a");
    }
}
`,
    added: ["        assert_eq!(r[0], \"a\");\n    }\n", "        assert_eq!(r[0], \"a\");\n    }\n\n    #[test]\n    fn parses_two() {\n        assert_eq!(parse(\"a b\").len(), 2);\n    }\n"],
    refactor: [["s.split_whitespace().map(String::from).collect()", "s.split_whitespace()\n        .map(|w| w.to_string())\n        .collect()"], ["fn parses_one()", "fn parses_single_item()"], ["let r = parse(\"a\");\n        assert_eq!(r.len(), 1);\n        assert_eq!(r[0], \"a\");", "let items = parse(\"a\");\n        assert_eq!(items.len(), 1);\n        assert_eq!(items[0], \"a\");"]],
    moved: { block: "\n    #[test]\n    fn parses_one() {\n        let r = parse(\"a\");\n        assert_eq!(r.len(), 1);\n        assert_eq!(r[0], \"a\");\n    }\n", to: "tests/parser.rs", wrap: (b) => `use crate_name::parser::parse;\n${b}` },
    removeAssert: ["        assert_eq!(r[0], \"a\");\n", ""],
    commentAssert: ["        assert_eq!(r[0], \"a\");", "        // assert_eq!(r[0], \"a\");"],
    skip: ["    #[test]\n    fn parses_one()", "    #[test]\n    #[ignore]\n    fn parses_one()"],
  },
  java: {
    path: "src/test/java/com/x/ParserTest.java",
    base: `package com.x;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ParserTest {
    @Test
    void parsesEmpty() {
        assertTrue(Parser.parse("").isEmpty());
    }

    @Test
    void parsesOne() {
        var r = Parser.parse("a");
        assertEquals(1, r.size());
        assertEquals("a", r.get(0));
    }
}
`,
    added: ["        assertEquals(\"a\", r.get(0));\n    }\n", "        assertEquals(\"a\", r.get(0));\n    }\n\n    @Test\n    void parsesTwo() {\n        assertEquals(2, Parser.parse(\"a b\").size());\n    }\n"],
    refactor: [["void parsesOne()", "void parsesSingleItem()"], ["var r = Parser.parse(\"a\");\n        assertEquals(1, r.size());\n        assertEquals(\"a\", r.get(0));", "var items = Parser.parse(\"a\");\n        assertEquals(1, items.size());\n        assertEquals(\"a\", items.get(0));"]],
    moved: { block: "\n    @Test\n    void parsesOne() {\n        var r = Parser.parse(\"a\");\n        assertEquals(1, r.size());\n        assertEquals(\"a\", r.get(0));\n    }\n", to: "src/test/java/com/x/ParserOneTest.java", wrap: (b) => `package com.x;\n\nimport org.junit.jupiter.api.Test;\nimport static org.junit.jupiter.api.Assertions.*;\n\nclass ParserOneTest {${b}}\n` },
    removeAssert: ["        assertEquals(\"a\", r.get(0));\n", ""],
    commentAssert: ["        assertEquals(\"a\", r.get(0));", "        // assertEquals(\"a\", r.get(0));"],
    skip: ["    @Test\n    void parsesOne()", "    @Test\n    @Disabled(\"flaky\")\n    void parsesOne()"],
  },
};

function sampleProject(s) {
  return makeTempProject({ files: { [s.path]: s.base, "README.md": "x\n" }, overlay: {} });
}
const replaced = (text, [from, to]) => {
  assert.ok(text.includes(from), `sample edit does not apply: ${from}`);
  return text.replace(from, to);
};
const check = async (p, input = "") => (await flow(p.root, ["check-weakening", PD], input)).json;
const kinds = (r) => r.weakened.map((w) => `${w.path} ${w.kind}`);

for (const [name, s] of Object.entries(STACKS)) {
  test(`RC1 ${name}: added tests, refactors, a moved test and a new test file pass`, async () => {
    const added = sampleProject(s);
    added.write(s.path, replaced(s.base, s.added));
    const a = await check(added);
    assert.equal(a.status, "ok", JSON.stringify(a));
    assert.deepEqual(a.compared, [s.path]);

    const refactor = sampleProject(s);
    refactor.write(s.path, s.refactor.reduce(replaced, s.base));
    const r = await check(refactor);
    assert.equal(r.status, "ok", JSON.stringify(r));

    const moved = sampleProject(s);
    moved.write(s.path, replaced(s.base, [s.moved.block, "\n"]));
    moved.write(s.moved.to, s.moved.wrap(s.moved.block));
    const m = await check(moved);
    assert.equal(m.status, "ok", JSON.stringify(m));
    assert.deepEqual([...m.compared].sort(), [s.moved.to, s.path].sort());

    const fresh = sampleProject(s);
    fresh.write(s.moved.to, s.moved.wrap(s.moved.block));
    assert.equal((await check(fresh)).status, "ok");
  });

  test(`RC1 ${name}: a deleted test file, a removed or commented-out assertion and an added skip are caught`, async () => {
    const del = sampleProject(s);
    fs.rmSync(del.path(s.path));
    const d = await flow(del.root, ["check-weakening", PD]);
    assert.equal(d.code, 1);
    assert.deepEqual(kinds(d.json), [`${s.path} test-file-deleted`]);

    const removed = sampleProject(s);
    removed.write(s.path, replaced(s.base, s.removeAssert));
    assert.deepEqual(kinds(await check(removed)), [`${s.path} asserts-removed`]);

    const commented = sampleProject(s);
    commented.write(s.path, replaced(s.base, s.commentAssert));
    assert.deepEqual(kinds(await check(commented)), [`${s.path} asserts-removed`]);

    const skipped = sampleProject(s);
    skipped.write(s.path, replaced(s.base, s.skip));
    assert.deepEqual(kinds(await check(skipped)), [`${s.path} skips-added`]);
  });
}

test("RC1 a test removed in one file is caught although another file adds new tests (no cross-plan offset)", async () => {
  const s = STACKS.typescript;
  const p = sampleProject(s);
  p.write(s.path, replaced(s.base, [s.moved.block, "\n"]));
  p.write("src/other.test.ts", "import { it, expect } from \"vitest\";\nit(\"a\", () => { expect(1).toBe(1); });\nit(\"b\", () => { expect(2).toBe(2); });\nit(\"c\", () => { expect(3).toBe(3); });\n");
  const r = await check(p);
  assert.equal(r.status, "weakened");
  assert.deepEqual(r.weakened.map((w) => [w.path, w.kind]), [[s.path, "tests-removed"], [s.path, "asserts-removed"]]);
  assert.match(r.weakened[0].detail, /1 test\(s\) removed \(parses one\)/);
});

test("RC1 fixtures and source files are no check files by default; the files input narrows the comparison", async () => {
  const p = makeTempProject({ files: { "test/fixtures/data.json": "{\"a\":1}\n", "lib/parser.dart": "int parse() => 1;\n", "test/a_test.dart": "void main() { test('x', () { expect(1, 1); }); }\n" }, overlay: {} });
  fs.rmSync(p.path("test/fixtures/data.json"));
  p.write("lib/parser.dart", "int parse() => 2;\n");
  fs.rmSync(p.path("test/a_test.dart"));
  const all = await check(p);
  assert.deepEqual(all.compared, ["test/a_test.dart"]);
  assert.deepEqual(kinds(all), ["test/a_test.dart test-file-deleted"]);
  const narrowed = await check(p, { files: ["lib/parser.dart"] });
  assert.equal(narrowed.status, "ok");
  assert.deepEqual(narrowed.compared, []);
});

test("RC1 the kit's own tests: every test file has declarations and assertions; a new kit test passes, a deleted one is caught", async () => {
  const { analyze, STACKS: table } = checksMod;
  const js = table.find((x) => x.name === "js");
  const files = [];
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) walk(f); else if (e.name.endsWith(".test.mjs")) files.push(f); } };
  walk(path.join(KIT_DIR, "tests"));
  assert.ok(files.length > 50);
  const blind = files.filter((f) => { const a = analyze(fs.readFileSync(f, "utf8"), js); return !a.decls.length || !a.asserts; });
  assert.deepEqual(blind.map((f) => path.relative(KIT_DIR, f)), []);
  const source = fs.readFileSync(path.join(KIT_DIR, "tests/gsd-flows/flow-gate.test.mjs"), "utf8").replace(/\r\n/g, "\n");
  const p = makeTempProject({ files: { "tests/flow-gate.test.mjs": source }, overlay: {} });
  p.write("tests/flow-gate.test.mjs", `${source}\ntest("RC1 a new kit test", async () => {\n  assert.equal(1, 1);\n});\n`);
  p.write("tests/r87/new.test.mjs", "import test from \"node:test\";\nimport assert from \"node:assert/strict\";\ntest(\"x\", () => { assert.ok(true); });\n");
  assert.equal((await check(p)).status, "ok");
  const firstTest = /\ntest\("GSDF-44 green evidence[\s\S]*?\n\}\);\n/.exec(source)[0];
  p.write("tests/flow-gate.test.mjs", source.replace(firstTest, "\n"));
  assert.deepEqual(kinds(await check(p)), ["tests/flow-gate.test.mjs tests-removed", "tests/flow-gate.test.mjs asserts-removed"]);
});

test("RC1 project paths and regexes replace the stack defaults; a listed gate file of no stack is reported on any change", async () => {
  const overlay = { adapter: { checks: { paths: ["spec/**", "analysis_options.yaml"], test_decl: [String.raw`^\s*scenario\s+"([^"]+)"`], assert: [String.raw`\bcheck\b`], skip: null } } };
  const p = makeTempProject({ files: { "spec/a.feature.js": "scenario \"one\"\n  check 1\nscenario \"two\"\n  check 2\n", "analysis_options.yaml": "linter:\n  rules:\n    - avoid_print\n", "test/a_test.dart": "void main() { test('x', () { expect(1, 1); }); }\n" }, overlay });
  p.write("spec/a.feature.js", "scenario \"one\"\n  check 1\n");
  p.write("analysis_options.yaml", "linter:\n  rules: []\n");
  fs.rmSync(p.path("test/a_test.dart"));
  const r = await check(p);
  assert.deepEqual(kinds(r).sort(), ["analysis_options.yaml gate-file-changed", "spec/a.feature.js asserts-removed", "spec/a.feature.js tests-removed"]);
  assert.ok(!r.compared.includes("test/a_test.dart"), "the project's paths replace the stack paths");
});
