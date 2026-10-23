// Bug-hunt G167: a gate failure that names a file by a path holding a space (a spaced project root, a spaced file name,
// a quoted path) is attributed to that file, and a sibling directory that only shares the root's text is not.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";

const { main } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
const PD = ".planning/phases/03-api";
const NODE = process.execPath;

async function flow(root, argv, input = "") {
  let line = "";
  const code = await main(argv, { root, input: typeof input === "string" ? input : JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}
const adapter = (commands) => ({ adapter: { commands: { build: [NODE, "-e", "process.exit(0)"], test: [NODE, "-e", "process.exit(0)"], build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {}, ...commands } } });

// Prints compiler-style lines naming files under the project root (cwd): an absolute path in backslash form, a quoted
// absolute path in slash form, a relative path with a space, and a sibling directory whose name starts with the root's.
const EMIT = [
  'import path from "node:path";',
  "const root = process.cwd();",
  'const abs = (rel) => path.join(root, rel);',
  'console.log(`${abs("src/a/x.js")}:3: error TS2322: bad`);',
  'console.log(`"${abs("src/c d/y.js").replace(/\\\\/g, "/")}":4: error TS2322: bad`);',
  'console.log("src/my file.ts:12: error TS2322: bad");',
  'console.log(`${path.join(root + "-sibling", "src/a/x.js")}:5: error TS2322: bad`);',
  "process.exitCode = 1;",
].join("\n");

test("G167 a failure path with spaces names its file, absolute, quoted or relative; a sibling of the root does not", async () => {
  const p = makeTempProject({
    files: { "src/a/x.js": "x\n", "src/c d/y.js": "y\n", "src/my file.ts": "z\n", "tools/emit.mjs": `${EMIT}\n` },
    overlay: adapter({ gates: [{ name: "tsc", argv: [NODE, "tools/emit.mjs"] }] }),
  });
  assert.match(p.root, / /);
  const siblingDir = path.join(`${p.root}-sibling`, "src", "a");
  fs.mkdirSync(siblingDir, { recursive: true });
  fs.writeFileSync(path.join(siblingDir, "x.js"), "s\n");
  try {
    const r = await flow(p.root, ["gate", PD], { waveId: "w1", plans: [{ id: "03-01", owns: ["Path:src/a/"], verify: [] }, { id: "03-02", owns: ["Path:src/c d/"], verify: [] }] });
    assert.equal(r.json.green, false);
    const failure = r.json.failures.find((f) => f.step === "gate-tsc");
    assert.deepEqual(failure.files.sort(), ["src/a/x.js", "src/c d/y.js", "src/my file.ts"]);
    assert.deepEqual(r.json.unplaced, []);
    assert.deepEqual(Object.keys(r.json.byPlan).sort(), ["03-01", "03-02"]);
  } finally {
    fs.rmSync(`${p.root}-sibling`, { recursive: true, force: true });
  }
});
