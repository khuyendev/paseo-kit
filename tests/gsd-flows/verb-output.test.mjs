// A GSD verb prints its JSON on one last line; the workflow shell must keep a line far longer than its 20000-character default.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { SHIP_DIR } from "../helpers/temp.mjs";

const { runShell } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/harness/workflow/shell.mjs")).href);
const NODE = process.execPath;
const WORKFLOWS = path.join(SHIP_DIR, ".agents/workflows");
const BIG = "node -e \"console.log(JSON.stringify({complete:true,pad:'x'.repeat(30000)}))\"";

test("GSDF-03 the shell keeps only the last 20000 characters by default, so a 30000-character verb line is cut", async () => {
  const r = await runShell(BIG, { cwd: process.cwd(), timeoutS: 30 });
  assert.equal(r.code, 0);
  assert.throws(() => JSON.parse(r.stdout.trim().split(/\r?\n/).pop()));
});

test("GSDF-03 a larger tailChars keeps the whole verb line, as the gsd-* verb helper asks for", async () => {
  const r = await runShell(BIG, { cwd: process.cwd(), timeoutS: 30, tailChars: 4000000 });
  assert.equal(JSON.parse(r.stdout.trim().split(/\r?\n/).pop()).complete, true);
});

test("GSDF-03 every gsd-* workflow script passes a tailChars of at least 1,000,000 characters to its verb helper", () => {
  const scripts = fs.readdirSync(WORKFLOWS).filter((f) => /^gsd-.*\.js$/.test(f));
  assert.ok(scripts.length >= 9);
  for (const f of scripts) {
    const src = fs.readFileSync(path.join(WORKFLOWS, f), "utf8").replace(/\r\n/g, "\n");
    if (!src.includes("async function run(argv, input)")) continue;
    const limit = /const VERB_TAIL_CHARS = (\d[\d_]*);/.exec(src);
    assert.ok(limit && Number(limit[1].replace(/_/g, "")) >= 1000000, `${f}: VERB_TAIL_CHARS missing or too small`);
    assert.ok(/shell\(\["node", \.\.\.argv\], \{ tailChars: VERB_TAIL_CHARS,/.test(src), `${f}: the verb helper does not pass tailChars`);
  }
  assert.ok(NODE);
});
