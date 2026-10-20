// One part (a file unit or a marked block) as seen in the project and moved between kit and project (INST-04, INST-12).
import fs from "node:fs";
import path from "node:path";
import { readText, writeTextAtomic } from "../../ship/.agents/harness/lib/io.mjs";
import { fileDigest, textDigest } from "../../ship/.agents/harness/lib/hash.mjs";
import { blockFileOf, isBlockKey, kitDigest, shippedBlockBody } from "./units.mjs";
import { dropBlock, findBlock, putBlock } from "./text.mjs";

export const MALFORMED = "malformed";
export const malformedLine = (key) => `conflict ${key}: malformed kit block markers; fix by hand`;

const readIf = (file) => (fs.existsSync(file) ? readText(file) : null);
const projectFileOf = (project, key) => path.join(project, isBlockKey(key) ? blockFileOf(key) : key);

// The project's block body, null when absent, MALFORMED when the markers are broken.
export function projectBlockBody(project, key) {
  const text = readIf(projectFileOf(project, key));
  if (text == null) return null;
  const block = findBlock(text);
  return block.status === "ok" ? block.body.trim() : block.status === "none" ? null : MALFORMED;
}

export function projectDigest(project, key) {
  if (!isBlockKey(key)) {
    const file = projectFileOf(project, key);
    return fs.statSync(file, { throwIfNoEntry: false })?.isFile() ? fileDigest(file) : null;
  }
  const body = projectBlockBody(project, key);
  return body == null || body === MALFORMED ? body : textDigest(body);
}

// {P, K} of a key; K is null for a part the kit no longer ships.
export function digests(kit, project, key) {
  const unit = kit.units.get(key);
  return { P: projectDigest(project, key), K: unit ? kitDigest(unit) : null };
}

// Bytes rewritten rather than copied, so the restored file gets a fresh mtime (INV-54).
function copyBytes(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, fs.readFileSync(from));
}

export function copyToProject(kit, project, key) {
  const unit = kit.units.get(key);
  const file = projectFileOf(project, key);
  if (unit.kind === "file") return copyBytes(unit.src, file);
  const next = putBlock(readIf(file), shippedBlockBody(unit));
  if (next == null) throw new Error(`${key}: malformed kit block markers`);
  writeTextAtomic(file, next);
}

export function copyToKit(kit, project, key) {
  const unit = kit.units.get(key);
  if (unit.kind === "file") return copyBytes(projectFileOf(project, key), unit.src);
  writeTextAtomic(unit.src, `${projectBlockBody(project, key).replace(/\r\n/g, "\n")}\n`);
}

// Deletes a retired part proven kit-owned by its recorded digest (INST-07, INV-03).
export function deleteFromProject(project, key) {
  const file = projectFileOf(project, key);
  if (!isBlockKey(key)) return fs.rmSync(file, { force: true });
  writeTextAtomic(file, dropBlock(readText(file)));
}
