import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScript, runBody } from "../../ship/.agents/harness/workflow/script.mjs";
import { runWorkflow } from "../../ship/.agents/harness/workflow/engine.mjs";
import { fakeHost, meta } from "./helpers.mjs";

const run = (source, extra = {}) => {
  const out = [];
  const host = fakeHost();
  const p = runWorkflow({ source, scriptPath: "C:/x/wf.js", runId: "wf_t", root: process.cwd(), env: process.env, limits: { maxConcurrent: 2, maxAgents: 10, budgetTotal: null, shellTimeoutS: 30 }, out: (l) => out.push(l), host, ...extra });
  return { p, out, host };
};

test("FLOW-01 meta must be a pure literal: template string or call rejected", () => {
  assert.throws(() => parseScript("export const meta = { name: `x`, description: 'd' };"), /pure literal/);
  assert.throws(() => parseScript("export const meta = { name: String(1), description: 'd' };"), /pure literal/);
  assert.throws(() => parseScript("export const meta = { ...base, name: 'x', description: 'd' };"), /pure literal/);
  // Parentheses inside strings or comments are fine.
  const { meta: m } = parseScript("export const meta = { name: 'a (b)', /* (c) */ description: 'd ...' };\nreturn 1;");
  assert.equal(m.name, "a (b)");
});

test("FLOW-01 meta must be the first statement; a commented-out meta before code is rejected", () => {
  const src = "// export const meta = { name: 'x', description: 'd' };\nconst x = 1;\nexport const meta = { name: 'x', description: 'd' };";
  assert.throws(() => parseScript(src), /must begin with `export const meta/);
  assert.doesNotThrow(() => parseScript("/* header */\n// note\nexport const meta = { name: 'x', description: 'd' };"));
});

test("FLOW-01 name and description required, phases an array of {title}", () => {
  assert.throws(() => parseScript("export const meta = { name: 'x' };"), /meta.description/);
  assert.throws(() => parseScript("export const meta = { description: 'd' };"), /meta.name/);
  assert.throws(() => parseScript("export const meta = { name: 'x', description: 'd', phases: 'a' };"), /phases/);
  assert.deepEqual(parseScript("export const meta = { name: 'x', description: 'd', phases: [{ title: 'A' }] };").meta.phases, [{ title: "A" }]);
});

test("FLOW-01 a BOM-prefixed script parses and body errors report the file's line numbers", async () => {
  const src = `\uFEFF${meta()}${"\n".repeat(10)}throw new Error("boom");\n`;
  const { meta: m, body } = parseScript(src);
  assert.equal(m.name, "t");
  assert.equal(body.split("\n").length, src.slice(1).split("\n").length);
  const err = await runBody(body, "C:/p/wf.js", {}).catch((e) => e);
  assert.match(err.stack, /wf\.js:12/);
});

test("FLOW-01 top-level await and return work in the body", async () => {
  const { p } = run(`${meta()}const a = await Promise.resolve(2);\nreturn { a };`);
  assert.deepEqual((await p).result, { a: 2 });
});

test("FLOW-02 Math.random, Date(), new Date() and Date.now() fail the run with the args hint", async () => {
  for (const expr of ["Math.random()", "Date()", "new Date()", "Date.now()"]) {
    const { p } = run(`${meta()}return ${expr};`);
    await assert.rejects(p, (e) => /not available in workflow scripts/.test(e.message) && /(args|by index)/.test(e.message), expr);
  }
  const ok = await run(`${meta()}return [new Date(0).toISOString(), Date.UTC(2020, 0, 1), Date.parse("2020-01-01T00:00:00Z")];`).p;
  assert.deepEqual(ok.result, ["1970-01-01T00:00:00.000Z", 1577836800000, 1577836800000]);
});

test("FLOW-02 no require/process/import; console.log maps to log, console.table fails", async () => {
  const r = await run(`${meta()}console.log("a", 1); console.warn("w"); return [typeof require, typeof process, typeof fetch];`);
  const res = await r.p;
  assert.deepEqual(res.result, ["undefined", "undefined", "undefined"]);
  assert.deepEqual(r.out, ["log a 1", "log w"]);
  await assert.rejects(run(`${meta()}console.table([1]);`).p, /console.table is not available/);
  await assert.rejects(run(`${meta()}await import("node:fs");`).p);
});
