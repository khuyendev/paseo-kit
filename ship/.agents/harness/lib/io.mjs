// Text and JSON file helpers shared by every kit module (CONF-02): one BOM rule, one atomic write.
import fs from "node:fs";
import path from "node:path";

const BOM = "﻿";

export function readText(file) {
  const text = fs.readFileSync(file, "utf8");
  return text.startsWith(BOM) ? text.slice(1) : text;
}

export function readJson(file) {
  const text = readText(file);
  try {
    return JSON.parse(text);
  } catch (e) {
    const err = new Error(`${file}: invalid JSON (${e.message})`, { cause: e });
    err.code = "EJSON";
    throw err;
  }
}

export function readJsonIf(file, fallback = null) {
  try {
    return readJson(file);
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
}

export function readJsonLines(file) {
  const out = [];
  readText(file).split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    try {
      out.push(JSON.parse(line));
    } catch (e) {
      throw new Error(`${file}:${i + 1}: invalid JSON line (${e.message})`);
    }
  });
  return out;
}

const RETRY_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Windows refuses a rename while another process (indexer, antivirus, a reader) holds the target open; retry briefly.
export function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (e) {
      if (!RETRY_CODES.has(e.code) || attempt >= 9) throw e;
      pause(20 * (attempt + 1));
    }
  }
}

export function writeTextAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Math.random().toString(16).slice(2, 10)}.tmp`;
  try {
    fs.writeFileSync(tmp, text, "utf8");
    renameWithRetry(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

export function writeJsonAtomic(file, value) {
  writeTextAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeTextIfChanged(file, text) {
  let current = null;
  try {
    current = fs.readFileSync(file, "utf8");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (current === text) return false;
  writeTextAtomic(file, text);
  return true;
}
