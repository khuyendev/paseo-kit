// A process killed between two renames of a multi-file batch used to leave the first target new and the second old, with
// no record to roll it back. The batch journal now rolls it back at the next ticket, and the killed ticket reads so.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { client, scratch } from "../files/helpers.mjs";

const BACKEND = pathToFileURL(fileURLToPath(new URL("../../ship/.agents/harness/files/backend.mjs", import.meta.url))).href;
const temps = (dir) => fs.readdirSync(dir, { recursive: true }).filter((n) => String(n).endsWith(".tmp"));
const TWO_FILES = { files: [{ path: "a.txt", content: "new-a" }, { path: "b.txt", content: "new-b" }] };

// Runs --execute of a planned ticket in a child process that SIGKILLs itself when `dies(fn, args)` says so, at the fs call
// about to run: no catch or finally runs there, as with Esc on a native Bash call.
function executeKilled(c, stage, dies) {
  const code = `
    import fs from "node:fs";
    import path from "node:path";
    const { runTicket } = await import(${JSON.stringify(BACKEND)});
    const dies = ${dies.toString()};
    for (const fn of ["renameSync", "writeFileSync"]) {
      const original = fs[fn];
      fs[fn] = (...args) => {
        if (dies(fn, args)) process.kill(process.pid, "SIGKILL");
        return original(...args);
      };
    }
    runTicket("--execute", ${JSON.stringify(stage.session)}, ${JSON.stringify(stage.ticket)}, { stateRoot: ${JSON.stringify(c.stateRoot)} });
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8" });
  // the ticket was marked started before the batch ran, so the kill came inside the execution
  assert.ok(fs.existsSync(path.join(c.stateRoot, stage.session, `${stage.ticket}.started`)));
  return child;
}

test("a batch killed between two renames is rolled back by the next ticket, and its receipt says so", () => {
  const s = scratch({ "a.txt": "old-a", "b.txt": "old-b" });
  const c = client({ cwd: s.root });
  const stage = c.stage("write_multiple_files", TWO_FILES);
  c.plan(stage);
  const child = executeKilled(c, stage, (fn, args) => fn === "renameSync" && path.basename(args[1]) === "b.txt");
  assert.notEqual(child.status, 0);
  assert.equal(s.read("a.txt"), "new-a"); // the killed batch: the first target is new, the second old
  assert.equal(s.read("b.txt"), "old-b");
  assert.throws(() => c.stage("write_multiple_files", { receipt: stage.ticket }), /interrupted by a killed process; its batch is rolled back by the next file call/);
  c.call("write_multiple_files", { files: [{ path: "other.txt", content: "x" }] }); // this ticket's plan rolls the batch back
  assert.equal(s.read("a.txt"), "old-a");
  assert.equal(s.read("b.txt"), "old-b");
  assert.deepEqual(temps(s.root), []);
  const receipt = c.call("write_multiple_files", { receipt: stage.ticket });
  assert.equal(receipt.isError, true);
  assert.match(receipt.text, /interrupted by a killed process; rolled back: nothing written$/);
  c.execute(stage); // completed by the rollback: never executed again
  assert.equal(s.read("a.txt"), "old-a");
  assert.equal(s.read("other.txt"), "x");
});

test("a target changed after the kill is left as it is and reported by the rollback", () => {
  const s = scratch({ "a.txt": "old-a", "b.txt": "old-b" });
  const c = client({ cwd: s.root });
  const stage = c.stage("write_multiple_files", TWO_FILES);
  c.plan(stage);
  executeKilled(c, stage, (fn, args) => fn === "renameSync" && path.basename(args[1]) === "b.txt");
  s.write("a.txt", "user-a"); // someone edits a.txt after the kill, on top of the batch's new text
  c.call("write_multiple_files", { files: [{ path: "other.txt", content: "x" }] });
  assert.equal(s.read("a.txt"), "user-a");
  assert.equal(s.read("b.txt"), "old-b");
  const receipt = c.call("write_multiple_files", { receipt: stage.ticket });
  assert.match(receipt.text, /interrupted by a killed process; ROLLBACK INCOMPLETE, these files may hold the new text: .*a\.txt \(changed since the interruption, left as it is\)$/);
});

test("a batch killed while staging leaves no temp file behind after the next ticket", () => {
  const s = scratch({ "a.txt": "old-a", "b.txt": "old-b" });
  const c = client({ cwd: s.root });
  const stage = c.stage("write_multiple_files", TWO_FILES);
  c.plan(stage);
  const child = executeKilled(c, stage, (fn, args) => fn === "writeFileSync" && path.basename(args[0]).startsWith("b.txt."));
  assert.notEqual(child.status, 0);
  assert.equal(temps(s.root).length, 1); // the staged temp of a.txt is stranded
  assert.equal(s.read("a.txt"), "old-a");
  c.call("write_multiple_files", { files: [{ path: "other.txt", content: "x" }] });
  assert.deepEqual(temps(s.root), []);
  assert.equal(s.read("a.txt"), "old-a");
  assert.equal(s.read("b.txt"), "old-b");
});
