// G134: shell() keeps only the last tailChars of each stream while the command runs, so a command that prints without
// bound cannot grow the engine's buffers past V8's string limit (about 512 MiB, which used to end the process).
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { SHIP_DIR } from "../helpers/temp.mjs";

const { runShell } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/harness/workflow/shell.mjs")).href);
const NODE = process.execPath;
// 600 MiB of "x" on the given stream, then END: more than one V8 string can hold.
const flood = (stream) =>
  `let n=0;const c='x'.repeat(1048576);function w(){while(n<600){n++;if(process.${stream}.write(c)===false){process.${stream}.once('drain',w);return}}process.${stream}.write('END')}w()`;

test("G134 a string command that prints 600 MiB on stdout keeps only the last tailChars characters", async () => {
  const r = await runShell(`node -e "${flood("stdout")}"`, { cwd: process.cwd(), timeoutS: 120, tailChars: 16 });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, `${"x".repeat(13)}END`);
});

test("G134 an argv command that prints 600 MiB on stderr keeps only the last tailChars characters", async () => {
  const r = await runShell([NODE, "-e", flood("stderr")], { cwd: process.cwd(), timeoutS: 120, tailChars: 16 });
  assert.equal(r.code, 0);
  assert.equal(r.stderr, `${"x".repeat(13)}END`);
});

test("G134 output longer than tailChars is trimmed to exactly its last tailChars characters, as before", async () => {
  const script = "for(let i=0;i<5;i++){process.stdout.write(String(i).repeat(1000))}";
  const r = await runShell([NODE, "-e", script], { cwd: process.cwd(), timeoutS: 30, tailChars: 1500 });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, `${"3".repeat(500)}${"4".repeat(1000)}`);
});
