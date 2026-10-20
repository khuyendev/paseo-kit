// Shared pieces of the `ph gsd` verbs: the exit contract (GSDC-02) and small path/text helpers.
import fs from "node:fs";
import path from "node:path";
import { toSlash } from "../lib/paths.mjs";

const EXIT_OK = 0;
const EXIT_NEGATIVE = 1;
const EXIT_NONE = 66;
const EXIT_UNAVAILABLE = 69;

// A verb failure with its exit code: 1 error, 66 nothing in scope, 69 could not look (INV-36).
export class GsdError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.exitCode = code;
    this.extra = extra;
  }
}

export const fail = (message, extra) => new GsdError(EXIT_NEGATIVE, message, extra);
export const none = (message, extra) => new GsdError(EXIT_NONE, message, { status: "missing", ...extra });
export const unavailable = (message, extra) => new GsdError(EXIT_UNAVAILABLE, message, { status: "unresolvable", ...extra });

// A verb result: the JSON document and its exit code (1 = negative verdict with the JSON on stdout).
export const done = (json, code = EXIT_OK) => ({ code, json });

export const rel = (root, abs) => toSlash(path.relative(root, abs));

export const lf = (text) => String(text).replace(/\r\n?/g, "\n");

export function readIf(file) {
  try {
    return fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  } catch (e) {
    if (e.code === "ENOENT" || e.code === "EISDIR") return null;
    throw e;
  }
}

export const isFile = (file) => {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};

export const isDir = (dir) => {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
};

export const today = () => new Date().toISOString().slice(0, 10);
export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

// Comma, space or [..] separated id list.
export const idList = (value) =>
  String(value ?? "")
    .replace(/[[\]]/g, " ")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

export const asArray = (v) => (v === null || v === undefined || v === "" ? [] : Array.isArray(v) ? v : [v]);

export const uniq = (items) => [...new Set(items)];

export const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Word-bounded occurrence of an id (REQ-1 never matches REQ-10).
export const mentions = (text, id) => new RegExp(`(^|[^A-Za-z0-9_-])${escapeRe(id)}(?![A-Za-z0-9_]|-\\d)`).test(String(text ?? ""));
