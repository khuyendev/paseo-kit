// Backend discovery of the harness-files mod (FTOL-05, INV-02). The mod may run from Claude's plugin cache, so it
// finds the installed project's backend and checks it against the install manifest before anything runs it.
// Self-contained on purpose: nothing of the project is loaded before it is verified.
// argv: <PASEO_HARNESS_ROOT or ""> <session cwd> <plugin root>
// stdout: {"backend": <abs>}
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BACKEND_REL = ".agents/harness/files/backend.mjs";
const FILES_REL = ".agents/harness/files";
const MANIFEST_REL = ".agents/harness-kit.json";
// equal to TRUSTED_FIXED of the backend (a kit test checks it)
export const TRUSTED_FIXED = [
  ".agents/harness/config.mjs",
  ".agents/harness/lib/config-schema.mjs",
  ".agents/harness/lib/io.mjs",
  ".agents/harness.defaults.json",
];

const readText = (file) => fs.readFileSync(file, "utf8").replace(/^﻿/, ""); // BOM-aware, as lib/io.mjs readText (CONF-02)
const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");
const textDigest = (file) => {
  const bytes = fs.readFileSync(file);
  const normalized = Buffer.allocUnsafe(bytes.length);
  let length = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 13 && bytes[i + 1] === 10) continue;
    normalized[length++] = bytes[i];
  }
  return sha256(normalized.subarray(0, length));
};
const isTest = (name) => /\.test\.|\.spec\.|^test_/.test(name);

export function trustedSet(root) {
  const own = fs.readdirSync(path.join(root, FILES_REL)).filter((n) => n.endsWith(".mjs") && !isTest(n)).sort();
  return [...TRUSTED_FIXED, ...own.map((n) => `${FILES_REL}/${n}`)];
}

function candidates(root, cwd, plugin) {
  const out = [];
  if (root) out.push(path.resolve(root));
  for (let d = path.resolve(cwd); ; d = path.dirname(d)) {
    out.push(d);
    if (path.dirname(d) === d) break;
  }
  out.push(path.resolve(plugin, "../../.."));
  return out;
}

const same = (a, b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);

// nothing is cached: size and mtime can be restored after an edit, so every call reads the manifest and digests the set
export function discover(root, cwd, plugin) {
  const local = path.resolve(plugin, "../../..");
  for (const r of candidates(root, cwd, plugin)) {
    const backend = path.join(r, BACKEND_REL);
    if (!fs.existsSync(backend)) continue;
    const rels = trustedSet(r);
    const manifestFile = path.join(r, MANIFEST_REL);
    if (fs.existsSync(manifestFile)) {
      let manifest;
      try {
        manifest = JSON.parse(readText(manifestFile));
      } catch {
        manifest = null;
      }
      const files = manifest?.files;
      if (!manifest?.version || !files || typeof files !== "object" || Array.isArray(files)) throw new Error("harness install marker unreadable");
      for (const rel of rels) {
        if (typeof files[rel] !== "string") throw new Error(`harness backend file not in installed marker: ${rel}`);
        if (files[rel] !== textDigest(path.join(r, rel))) throw new Error(`harness backend differs from installed marker: ${rel}`);
      }
      return { backend };
    }
    // no manifest: trusted only as the plugin's own source project, never by a cwd lookup
    if (!same(path.resolve(r), local) || !fs.existsSync(path.join(plugin, ".claude-plugin", "plugin.json"))) {
      throw new Error("harness backend lacks trusted install marker");
    }
    return { backend };
  }
  throw new Error("harness-files backend not found: install project assets or set PASEO_HARNESS_ROOT");
}

const fold = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
if (process.argv[1] && fold(path.resolve(process.argv[1])) === fold(fileURLToPath(import.meta.url))) {
  try {
    const [root, cwd, plugin] = process.argv.slice(2);
    process.stdout.write(JSON.stringify(discover(root, cwd, plugin)));
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exitCode = 1;
  }
}
