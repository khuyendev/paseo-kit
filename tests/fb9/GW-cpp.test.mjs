// WildEraV6 #2: the cpp stack of check-weakening (UE automation, gtest, Catch2), in the same shape as the RC1 stack tests.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { SHIP_DIR, makeTempProject } from "../helpers/temp.mjs";

const { main } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
const { STACKS, analyze, isTestFile } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/flow-checks.mjs")).href);
const PD = ".planning/phases/03-api";

async function flow(root, argv, input = "") {
  let line = "";
  const code = await main(argv, { root, input: typeof input === "string" ? input : JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}

const cpp = {
  path: "Source/ParseTest.cpp",
  base: `#include "Misc/AutomationTest.h"

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FParseEmpty, "Parse.Empty", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FParseEmpty::RunTest(const FString& Parameters)
{
    TestTrue(TEXT("empty"), Parse(TEXT("")).Num() == 0);
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FParseOne, "Parse.One", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FParseOne::RunTest(const FString& Parameters)
{
    auto r = Parse(TEXT("a"));
    TestEqual(TEXT("len"), r.Num(), 1);
    TestEqual(TEXT("first"), r[0], TEXT("a"));
    TestNearlyEqual(TEXT("near"), 1.0f, 1.0f, KINDA_SMALL_NUMBER);
    AddExpectedError(TEXT("missing asset"), EAutomationExpectedErrorFlags::Contains, 1);
    return true;
}
`,
  added: ["    return true;\n}\n", "    return true;\n}\n\nIMPLEMENT_SIMPLE_AUTOMATION_TEST(FParseTwo, \"Parse.Two\", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)\n\nbool FParseTwo::RunTest(const FString& Parameters)\n{\n    TestEqual(TEXT(\"two\"), Parse(TEXT(\"a b\")).Num(), 2);\n    return true;\n}\n"],
  refactor: [["IMPLEMENT_SIMPLE_AUTOMATION_TEST(FParseOne,", "IMPLEMENT_SIMPLE_AUTOMATION_TEST(FParseSingle,"], ["bool FParseOne::RunTest", "bool FParseSingle::RunTest"], ["auto r = Parse(TEXT(\"a\"));\n    TestEqual(TEXT(\"len\"), r.Num(), 1);\n    TestEqual(TEXT(\"first\"), r[0], TEXT(\"a\"));", "auto items = Parse(TEXT(\"a\"));\n    TestEqual(TEXT(\"len\"), items.Num(), 1);\n    TestEqual(TEXT(\"first\"), items[0], TEXT(\"a\"));"]],
  moved: {
    block: "\nIMPLEMENT_SIMPLE_AUTOMATION_TEST(FParseOne, \"Parse.One\", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)\n\nbool FParseOne::RunTest(const FString& Parameters)\n{\n    auto r = Parse(TEXT(\"a\"));\n    TestEqual(TEXT(\"len\"), r.Num(), 1);\n    TestEqual(TEXT(\"first\"), r[0], TEXT(\"a\"));\n    TestNearlyEqual(TEXT(\"near\"), 1.0f, 1.0f, KINDA_SMALL_NUMBER);\n    AddExpectedError(TEXT(\"missing asset\"), EAutomationExpectedErrorFlags::Contains, 1);\n    return true;\n}\n",
    to: "Source/ParseOneTest.cpp",
    wrap: (b) => `#include "Misc/AutomationTest.h"\n${b}`,
  },
  removeAssert: ["    TestEqual(TEXT(\"first\"), r[0], TEXT(\"a\"));\n", ""],
  commentAssert: ["    TestEqual(TEXT(\"first\"), r[0], TEXT(\"a\"));", "    // TestEqual(TEXT(\"first\"), r[0], TEXT(\"a\"));"],
  skip: ["IMPLEMENT_SIMPLE_AUTOMATION_TEST(FParseOne,", "IMPLEMENT_SIMPLE_AUTOMATION_TEST(DISABLED_FParseOne,"],
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

test("GW cpp: added tests, refactors, a moved test and a new test file pass", async () => {
  const s = cpp;
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

test("GW cpp: a deleted test file, a removed or commented-out assertion and an added skip are caught", async () => {
  const s = cpp;
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

test("GW cpp: removed AddExpectedError, narrowed flags, a wider tolerance and gtest/Catch2 are caught; a return early-out is not", async () => {
  const base = cpp.base;
  const dropped = sampleProject(cpp);
  dropped.write(cpp.path, base.replace("    AddExpectedError(TEXT(\"missing asset\"), EAutomationExpectedErrorFlags::Contains, 1);\n", ""));
  assert.deepEqual(kinds(await check(dropped)), [`${cpp.path} asserts-removed`]);

  const early = sampleProject(cpp);
  early.write(cpp.path, base.replace("{\n    auto r = Parse(TEXT(\"a\"));", "{\n    return true;\n    auto r = Parse(TEXT(\"a\"));"));
  assert.equal((await check(early)).status, "ok", "a return early-out is out of scope");

  const flags = sampleProject(cpp);
  flags.write(cpp.path, base.replace(
    "IMPLEMENT_COMPLEX_AUTOMATION_TEST",
    "IMPLEMENT_COMPLEX_AUTOMATION_TEST",
  ).replace(
    "IMPLEMENT_SIMPLE_AUTOMATION_TEST(FParseOne, \"Parse.One\", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)",
    "IMPLEMENT_SIMPLE_AUTOMATION_TEST(FParseOne, \"Parse.One\",\n    EAutomationTestFlags::EditorContext | EAutomationTestFlags::Disabled)",
  ));
  const f = await check(flags);
  assert.deepEqual(kinds(f), [`${cpp.path} flags-narrowed`]);
  assert.match(f.weakened[0].detail, /FParseOne/);
  assert.match(f.weakened[0].detail, /lost EngineFilter/);
  assert.match(f.weakened[0].detail, /gained Disabled/);

  const wider = sampleProject(cpp);
  wider.write(cpp.path, base.replace("TestNearlyEqual(TEXT(\"near\"), 1.0f, 1.0f, KINDA_SMALL_NUMBER);", "TestNearlyEqual(TEXT(\"near\"), 1.0f, 1.0f, 0.1f);"));
  const w = await check(wider);
  assert.deepEqual(kinds(w), [`${cpp.path} tolerance-widened`]);
  assert.match(w.weakened[0].detail, /0\.1f/);

  const tighter = sampleProject(cpp);
  tighter.write(cpp.path, base.replace("KINDA_SMALL_NUMBER);", "SMALL_NUMBER);"));
  assert.equal((await check(tighter)).status, "ok", "a tighter tolerance is not a weakening");

  const opened = sampleProject(cpp);
  opened.write(cpp.path, base.replace("EAutomationTestFlags::EngineFilter)", "EAutomationTestFlags::EngineFilter | EAutomationTestFlags::ClientContext)"));
  assert.equal((await check(opened)).status, "ok", "adding a context is not a weakening");

  const gtest = makeTempProject({ files: { "Source/Tests/ParseG.test.cpp": "TEST(Parse, One) {\n  EXPECT_EQ(1, 1);\n  ASSERT_TRUE(true);\n}\n", "README.md": "x\n" }, overlay: {} });
  gtest.write("Source/Tests/ParseG.test.cpp", "TEST(Parse, DISABLED_One) {\n  GTEST_SKIP();\n  EXPECT_EQ(1, 1);\n  ASSERT_TRUE(true);\n}\n");
  assert.deepEqual(kinds(await check(gtest)), ["Source/Tests/ParseG.test.cpp skips-added"]);

  const catch2 = makeTempProject({ files: { "Source/Parse.spec.cpp": "TEST_CASE(\"one\") {\n  CHECK(1 == 1);\n  REQUIRE(true);\n}\n", "README.md": "x\n" }, overlay: {} });
  catch2.write("Source/Parse.spec.cpp", "TEST_CASE(\"one\") {\n  REQUIRE(true);\n}\n");
  assert.deepEqual(kinds(await check(catch2)), ["Source/Parse.spec.cpp asserts-removed"]);
});

test("GW cpp: paths and extensions; a production .cpp is not a check file", async () => {
  const stack = STACKS.find((s) => s.name === "cpp");
  assert.ok(stack, "cpp stack");
  assert.equal(isTestFile("Source/ParseTest.cpp"), true);
  assert.equal(isTestFile("Source/Tests/Helper.h"), true);
  assert.equal(isTestFile("Source/Tests/Util.inl"), true);
  assert.equal(isTestFile("Source/Test/Wave.cc"), true);
  assert.equal(isTestFile("Source/ParseTest.h"), false);
  assert.equal(isTestFile("Source/Player.cpp"), false);
  const counted = analyze(cpp.base, stack);
  assert.ok(counted.decls.includes("FParseOne"), JSON.stringify(counted.decls));
  assert.ok(counted.asserts >= 4, `asserts ${counted.asserts}`);

  const prod = makeTempProject({ files: { "Source/Player.cpp": "int Player() { return 1; }\n", "README.md": "x\n" }, overlay: {} });
  prod.write("Source/Player.cpp", "int Player() { TestTrue(TEXT(\"x\"), false); return 0; }\n");
  const r = await check(prod);
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.deepEqual(r.compared, []);
});
