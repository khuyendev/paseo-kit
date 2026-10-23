// G205: a schema literal in the shipped harness reference docs must pass the workflow validator, so a copied example loads.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { checkSchema } from "../../ship/.agents/harness/workflow/schema.mjs";
import { SHIP_DIR } from "../helpers/temp.mjs";

// Object literal starting at `open`, strings skipped (test-side scanner, as in tests/workflow/schema.test.mjs).
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

test("G205 every root schema constant in the shipped reference docs passes checkSchema", () => {
  const dir = path.join(SHIP_DIR, ".claude", "skills", "harness", "references");
  let checked = 0;
  for (const f of fs.readdirSync(dir).filter((name) => name.endsWith(".md"))) {
    const source = fs.readFileSync(path.join(dir, f), "utf8");
    const context = vm.createContext({});
    for (const m of source.matchAll(/(?:const|let)\s+(\w+)\s*=\s*\{\s*type:\s*'object'/g)) {
      const literal = literalAt(source, m.index + m[0].indexOf("{"));
      const value = vm.runInContext(`(${literal})`, context);
      context[m[1]] = value;
      assert.doesNotThrow(() => checkSchema(value), `${f}: ${m[1]}`);
      checked++;
    }
  }
  assert.ok(checked >= 10, `only ${checked} schema constants found in the reference docs`);
});
