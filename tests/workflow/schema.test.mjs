import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { checkSchema, parseReply, validate } from "../../ship/.agents/harness/workflow/schema.mjs";
import { runWorkflow } from "../../ship/.agents/harness/workflow/engine.mjs";
import { SHIP_DIR } from "../helpers/temp.mjs";
import { fakeHost, meta } from "./helpers.mjs";

const obj = (properties, extra = {}) => ({ type: "object", properties, ...extra });

test("FLOW-13 schema root must be {type:'object', properties} and required keys must be properties", () => {
  assert.throws(() => checkSchema({ type: "array" }), /type: 'object', properties/);
  assert.throws(() => checkSchema(obj({}, { required: ["x"] })), /required names 'x'/);
  assert.doesNotThrow(() => checkSchema(obj({ x: { type: "string" } }, { required: ["x"] })));
});

test("FLOW-13 agent() with an invalid schema throws at call time", async () => {
  const run = (schema) => runWorkflow({ source: `${meta()}return agent("x", { schema: ${JSON.stringify(schema)} });`, scriptPath: "wf.js", runId: "r", root: ".", env: {}, limits: { maxConcurrent: 1, maxAgents: 5, budgetTotal: null, shellTimeoutS: 1 }, out: () => {}, host: fakeHost() });
  await assert.rejects(run(obj({}, { required: ["x"] })), /required names 'x'/);
  await assert.rejects(run(obj({ a: { oneOf: [] } })), /unsupported keyword 'oneOf'/);
});

test("FLOW-46 every supported keyword: one valid and one invalid value", () => {
  const cases = [
    [{ type: "string" }, "a", 1, "expected string"],
    [{ type: ["string", "null"] }, null, 1, "expected string or null"],
    [{ type: "integer" }, 2, 2.5, "expected integer"],
    [{ type: "number" }, 2.5, "x", "expected number"],
    [{ type: "boolean" }, true, "true", "expected boolean"],
    [{ type: "null" }, null, 0, "expected null"],
    [{ type: "array" }, [], {}, "expected array"],
    [{ enum: ["a", "b"] }, "a", "c", "expected one of"],
    [{ enum: [{ a: 1, b: 2 }] }, { b: 2, a: 1 }, { a: 1, b: 3 }, "expected one of"],
    [{ const: 3 }, 3, 4, "expected 3"],
    [{ const: { x: 1, y: [1, 2] } }, { y: [1, 2], x: 1 }, { x: 1, y: [2, 1] }, 'expected {"x":1,"y":[1,2]}'],
    [{ minimum: 1 }, 1, 0, "must be >= 1"],
    [{ maximum: 1 }, 1, 2, "must be <= 1"],
    [{ minLength: 2 }, "ab", "a", "at least 2 characters"],
    [{ maxLength: 2 }, "ab", "abc", "at most 2 characters"],
    [{ minItems: 1 }, [1], [], "at least 1 items"],
    [{ maxItems: 1 }, [1], [1, 2], "at most 1 items"],
    [obj({ a: { type: "string" } }, { required: ["a"] }), { a: "x" }, {}, "/a: missing required property"],
    [obj({ a: { type: "string" } }, { additionalProperties: false }), { a: "x" }, { a: "x", b: 1 }, "/b: property not allowed"],
    [{ type: "array", items: { type: "integer" } }, [1, 2], [1, "2"], "/1: expected integer"],
    [{ type: "string", description: "d", title: "t", default: "x", examples: ["y"] }, "a", 1, "expected string"],
  ];
  for (const [schema, good, bad, message] of cases) {
    const root = obj({ v: schema });
    checkSchema(root);
    assert.deepEqual(validate({ v: good }, root), [], JSON.stringify(schema));
    const errors = validate({ v: bad }, root);
    assert.ok(errors.some((e) => e.includes(message)), `${JSON.stringify(schema)}: ${errors.join("; ")}`);
  }
});

test("FLOW-46 nested object-in-array errors carry the JSON path", () => {
  const schema = obj({ plans: { type: "array", items: obj({ id: { type: "string" } }, { required: ["id"] }) } });
  assert.deepEqual(validate({ plans: [{ id: "a" }, { id: "b" }, { id: 3 }] }, schema), ["/plans/2/id: expected string"]);
  assert.deepEqual(validate({ plans: [{}] }, schema), ["/plans/0/id: missing required property"]);
});

test("FLOW-46 unparsable JSON is a validation error; one code fence is tolerated", () => {
  const schema = obj({ a: { type: "integer" } });
  assert.match(parseReply("not json", schema).errors[0], /invalid JSON/);
  assert.deepEqual(parseReply('```json\n{"a": 1}\n```', schema), { value: { a: 1 }, errors: [] });
});

test("FLOW-46 keywords outside the subset are rejected, never ignored", () => {
  for (const kw of ["$ref", "oneOf", "anyOf", "allOf", "pattern", "format", "patternProperties"]) {
    assert.throws(() => checkSchema(obj({ a: { type: "string", [kw]: "x" } })), new RegExp(`unsupported keyword '\\${kw}'|unsupported keyword '${kw}'`), kw);
  }
});

// Object literal starting at `open`, strings skipped (test-side scanner for schema constants).
function literalAt(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++;
    } else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error("unbalanced literal");
}

test("FLOW-46 every schema in the shipped workflow scripts passes the subset check", () => {
  const dir = path.join(SHIP_DIR, ".agents", "workflows");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).filter((f) => /\.(m?js)$/.test(f)) : [];
  let checked = 0;
  for (const f of files) {
    const source = fs.readFileSync(path.join(dir, f), "utf8");
    const context = vm.createContext({});
    for (const m of source.matchAll(/(?:const|let)\s+(\w*(?:schema|SCHEMA)\w*)\s*=\s*\{/g)) {
      const literal = literalAt(source, m.index + m[0].length - 1);
      let value;
      try {
        value = vm.runInContext(`(${literal})`, context);
      } catch {
        continue; // built from values only known at run time
      }
      context[m[1]] = value;
      if (value?.type === "object") {
        assert.doesNotThrow(() => checkSchema(value), `${f}: ${m[1]}`);
        checked++;
      }
    }
  }
  assert.ok(files.length === 0 || checked > 0, "no schema constant found in the shipped scripts");
});
