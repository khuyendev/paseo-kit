// Backend discovery of the harness-files mod (FTOL-05, INV-02). The mod may run from Claude's plugin cache, so it
// finds the installed project's backend and checks it against the install manifest before anything runs it.
// Self-contained on purpose: nothing of the project is loaded before it is verified.
// argv: <PASEO_HARNESS_ROOT or ""> <session cwd> <plugin root> [<stamp of an earlier successful discovery>]
// stdout: {"backend": <abs>, "stamp": <hex>}
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

const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");
const textDigest = (file) => sha256(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
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

// size and mtime of every trusted file: an unchanged stamp lets a cached discovery skip the digests
function stampOf(root, rels) {
  const parts = rels.map((rel) => {
    const st = fs.statSync(path.join(root, rel));
    return `${rel}\0${st.size}\0${st.mtimeMs}`;
  });
  return sha256(`${root}\n${parts.join("\n")}`);
}

const same = (a, b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);

export function discover(root, cwd, plugin, cachedStamp = "") {
  const local = path.resolve(plugin, "../../..");
  for (const r of candidates(root, cwd, plugin)) {
    const backend = path.join(r, BACKEND_REL);
    if (!fs.existsSync(backend)) continue;
    const rels = trustedSet(r);
    const stamp = stampOf(r, rels);
    const manifestFile = path.join(r, MANIFEST_REL);
    if (fs.existsSync(manifestFile)) {
      if (stamp === cachedStamp) return { backend, stamp };
      let manifest;
      try {
        manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8").replace(/^﻿/, ""));
      } catch {
        manifest = null;
      }
      const files = manifest?.files;
      if (!manifest?.version || !files || typeof files !== "object" || Array.isArray(files)) throw new Error("harness install marker unreadable");
      for (const rel of rels) {
        if (typeof files[rel] !== "string") throw new Error(`harness backend file not in installed marker: ${rel}`);
        if (files[rel] !== textDigest(path.join(r, rel))) throw new Error(`harness backend differs from installed marker: ${rel}`);
      }
      return { backend, stamp };
    }
    // no manifest: trusted only as the plugin's own source project, never by a cwd lookup
    if (!same(path.resolve(r), local) || !fs.existsSync(path.join(plugin, ".claude-plugin", "plugin.json"))) {
      throw new Error("harness backend lacks trusted install marker");
    }
    return { backend, stamp };
  }
  throw new Error("harness-files backend not found: install project assets or set PASEO_HARNESS_ROOT");
}

const fold = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
if (process.argv[1] && fold(path.resolve(process.argv[1])) === fold(fileURLToPath(import.meta.url))) {
  try {
    const [root, cwd, plugin, stamp] = process.argv.slice(2);
    process.stdout.write(JSON.stringify(discover(root, cwd, plugin, stamp)));
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exitCode = 1;
  }
}
