import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { SCHEMA, TOP_LEVEL_KEYS } from "../../ship/.agents/harness/lib/config-schema.mjs";
import { KIT_DIR } from "../helpers/temp.mjs";

const doc = fs.readFileSync(path.join(KIT_DIR, "docs", "INTERFACES.md"), "utf8");

// The first-column keys of the key table under a heading, up to the next heading.
function tableKeys(heading) {
  const start = doc.indexOf(heading);
  assert.notEqual(start, -1, `no heading ${heading} in INTERFACES.md`);
  const body = doc.slice(start + heading.length).split(/^#{1,6} /m)[0];
  return [...body.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]);
}

test("G203 INTERFACES.md section 4 lists every top-level config key the schema accepts", () => {
  assert.deepEqual(tableKeys("## 4. Config keys").sort(), [...TOP_LEVEL_KEYS].sort());
});

test("G203 INTERFACES.md 4.1 lists every adapter key the schema accepts", () => {
  assert.deepEqual(tableKeys("### 4.1 ").sort(), Object.keys(SCHEMA.fields.adapter.fields).sort());
});

test("G203 INTERFACES.md 4.2 lists every gsd key the schema accepts", () => {
  assert.deepEqual(tableKeys("### 4.2 ").sort(), Object.keys(SCHEMA.fields.gsd.fields).sort());
});
