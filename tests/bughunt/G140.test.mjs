import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSchema, parseReply, validate } from "../../ship/.agents/harness/workflow/schema.mjs";

const obj = (properties, extra = {}) => ({ type: "object", properties, ...extra });

test("G140 an object-valued enum matches a reply whose keys are in another order", () => {
  const schema = obj({ v: { enum: [{ a: 1, b: 2 }] } });
  checkSchema(schema);
  assert.deepEqual(validate({ v: { b: 2, a: 1 } }, schema), []);
  assert.deepEqual(parseReply('{"v": {"b": 2, "a": 1}}', schema), { value: { v: { b: 2, a: 1 } }, errors: [] });
  assert.match(validate({ v: { a: 1, b: 3 } }, schema)[0], /expected one of/);
});

test("G140 an object-valued const matches a reply whose keys are in another order, nested too", () => {
  const schema = obj({ v: { const: { x: 1, y: [1, 2] } }, o: { enum: [{ o: { p: 1, q: 2 } }] } });
  checkSchema(schema);
  assert.deepEqual(validate({ v: { y: [1, 2], x: 1 }, o: { o: { q: 2, p: 1 } } }, schema), []);
  assert.match(validate({ v: { x: 1, y: [2, 1] }, o: { o: { p: 1, q: 2 } } }, schema)[0], /\/v: expected \{"x":1,"y":\[1,2\]\}/);
  assert.match(validate({ v: { x: 1, y: [1, 2] }, o: { o: { q: 2, p: 3 } } }, schema)[0], /\/o: expected one of/);
});

test("G140 array order stays significant inside enum and const", () => {
  const schema = obj({ v: { const: [1, 2] }, w: { enum: [[1, 2]] } });
  assert.deepEqual(validate({ v: [1, 2], w: [1, 2] }, schema), []);
  assert.equal(validate({ v: [2, 1], w: [1, 2] }, schema).length, 1);
  assert.equal(validate({ v: [1, 2], w: [2, 1] }, schema).length, 1);
});
