// Fake syntax checker: node fake_checker.mjs --log F --tag T [--sleep MS] [--active DIR] <file>.
// File content decides: BROKEN -> diagnostic + exit 1, NODIAG -> exit 2 silently, HANG -> never ends, else exit 0.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const file = args.pop();
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};
const log = opt("log");
const active = opt("active");
let running = 0;
if (active) {
  fs.mkdirSync(active, { recursive: true });
  fs.writeFileSync(path.join(active, String(process.pid)), "");
  running = fs.readdirSync(active).length;
}
if (log) fs.appendFileSync(log, `${JSON.stringify({ tag: opt("tag"), file, cwd: process.cwd(), argc: process.argv.length, running })}\n`);
const text = fs.readFileSync(file, "utf8");
const finish = () => {
  if (active) fs.rmSync(path.join(active, String(process.pid)), { force: true });
  if (text.includes("BROKEN")) {
    process.stdout.write(`${file}:1:2: syntax error near BROKEN\n`);
    process.exitCode = 1;
  } else if (text.includes("NODIAG")) process.exitCode = 2;
};
if (text.includes("HANG")) setInterval(() => {}, 1000);
else setTimeout(finish, Number(opt("sleep") ?? 0));
