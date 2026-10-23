// Command-line conventions shared by ph and its command modules (P8, PHCL-02, S-20).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export class UsageError extends Error {}

export const EXIT = Object.freeze({ OK: 0, USAGE: 1, PROBLEMS: 2 });

export const errText = (e) => String(e?.message ?? e).split("\n")[0].slice(0, 300);

// Free text (a stop reason, an error) on one status line: whitespace collapsed, at most 300 characters.
export const oneLine = (text) => String(text).replace(/\s+/g, " ").trim().slice(0, 300);

export const failedLine = (what, err) => `failed ${what}: ${errText(err)}`;

export const quoteName = (name) => (/^[\w.-]+$/.test(name) ? name : `'${String(name).replace(/'/g, "'\\''")}'`);

export const PH_FILE = fileURLToPath(new URL("../ph.mjs", import.meta.url));

// The one renderer of the ph command line used in next: hints and teammate notes.
export const phCommand = () => `node "${PH_FILE.split(path.sep).join("/")}"`;

// True when the module at `moduleUrl` is the script node was started with (case and symlink tolerant on Windows).
export function isMain(moduleUrl) {
  if (!process.argv[1]) return false;
  const fold = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
  try {
    return fold(fs.realpathSync(process.argv[1])) === fold(fs.realpathSync(fileURLToPath(moduleUrl)));
  } catch {
    return false;
  }
}

// `--key value` options only; a string option takes the next token even when it starts with `--`.
export function parseArgs(argv, spec) {
  const opts = {};
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      args.push(token);
      continue;
    }
    const key = token.slice(2);
    if (!Object.hasOwn(spec, key)) throw new UsageError(`unknown option --${key}`);
    if (spec[key] === "bool") {
      opts[key] = true;
      continue;
    }
    if (i + 1 >= argv.length) throw new UsageError(`--${key} needs a value`);
    opts[key] = argv[++i];
  }
  return { opts, args };
}
