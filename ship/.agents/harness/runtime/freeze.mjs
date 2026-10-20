// ph freeze: a sha256 record of a phase's input files, checked after read-only reviewers ran (PHCL-36, D-21).
import fs from "node:fs";
import path from "node:path";
import { UsageError } from "../lib/cli.mjs";
import { sha256 } from "../lib/hash.mjs";
import { readText, writeTextAtomic } from "../lib/io.mjs";

function phaseFiles(dir, phase) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.startsWith(`${phase}_`))
    .map((e) => e.name)
    .sort();
}

const digests = (dir, names) => new Map(names.map((n) => [n, sha256(fs.readFileSync(path.join(dir, n)))]));

// shasum-compatible lines: `<sha256>  <file>`.
function readRecord(file) {
  const map = new Map();
  for (const line of readText(file).split(/\r?\n/)) {
    const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
    if (m) map.set(m[2], m[1]);
  }
  return map;
}

function freeze(ctx) {
  const { ws, phase, check } = ctx.opts;
  if (!ws || !phase) throw new UsageError("--ws and --phase are required");
  if (!/^[A-Za-z0-9._-]+$/.test(phase)) throw new UsageError(`invalid phase '${phase}' (letters, digits, . _ - only)`);
  const dir = path.resolve(ctx.root, ws);
  const record = path.join(dir, `freeze_${phase}.sha256`);
  const now = digests(dir, phaseFiles(dir, phase));
  if (!check) {
    if (!now.size) throw new Error(`no ${phase}_* files in ${dir}`);
    writeTextAtomic(record, [...now].map(([n, h]) => `${h}  ${n}\n`).join(""));
    ctx.out(`frozen ${phase}: ${now.size} files -> ${record}`);
    return 0;
  }
  if (!fs.existsSync(record)) throw new Error(`no freeze record ${record}`);
  const was = readRecord(record);
  const modified = [...was].filter(([n, h]) => now.has(n) && now.get(n) !== h).map(([n]) => n);
  const missing = [...was.keys()].filter((n) => !now.has(n));
  const added = [...now.keys()].filter((n) => !was.has(n));
  if (!modified.length && !missing.length && !added.length) {
    ctx.out(`freeze ok ${phase}: ${was.size} files`);
    return 0;
  }
  const parts = [["modified", modified], ["missing", missing], ["new", added]].filter(([, l]) => l.length).map(([k, l]) => `${k} ${l.join(", ")}`);
  ctx.out(`freeze CHANGED ${phase}: ${parts.join("; ")}`);
  return 2;
}

export const freezeCommands = [
  {
    name: "freeze",
    summary: "record sha256 of <ws>/<phase>_* files; --check reports modified, missing and new files",
    usage: "ph freeze --ws D --phase P [--check]",
    options: { ws: "string", phase: "string", check: "bool" },
    config: "none",
    run: freeze,
  },
];
