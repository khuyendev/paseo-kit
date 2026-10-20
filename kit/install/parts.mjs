// One part (a file unit or a marked block) as seen in the project and moved between kit and project (INST-04, INST-12).
import fs from "node:fs";
import path from "node:path";
import { readText, writeTextAtomic } from "../../ship/.agents/harness/lib/io.mjs";
import { resolveInside } from "../../ship/.agents/harness/lib/paths.mjs";
import { fileDigest, textDigest } from "../../ship/.agents/harness/lib/hash.mjs";
import { blockFileOf, isBlockKey, kitDigest, shippedBlockBody } from "./units.mjs";
import { dropBlock, findBlock, putBlock } from "./text.mjs";

export const MALFORMED = "malformed";
export const malformedLine = (key) => `conflict ${key}: malformed kit block markers; fix by hand`;

const readIf = (file) => (fs.existsSync(file) ? readText(file) : null);
const projectRelOf = (key) => (isBlockKey(key) ? blockFileOf(key) : key);
const projectFileOf = (project, key) => resolveInside(project, projectRelOf(key));

// The first path of `rel` below `root` that is a symlink or junction, null when none (CR-INS-02, INV-01): a link may
// lead into owner configuration or another tree, so the kit never reads a part through one nor writes through it.
export function linkedPrefix(root, rel) {
  const segments = rel.split("/");
  for (let i = 1; i <= segments.length; i++) {
    const prefix = segments.slice(0, i).join("/");
    const st = fs.lstatSync(path.join(root, prefix), { throwIfNoEntry: false });
    if (!st) return null;
    if (st.isSymbolicLink()) return prefix;
  }
  return null;
}

export const linkProblem = (prefix) => `${prefix} is a link; the kit does not write through links (replace it with a real folder or file)`;

// The linked path in the way of a part, project side (and kit side for pull), null when none.
export function linkedPart(kit, project, key, { kitSide = false } = {}) {
  const inProject = linkedPrefix(project, projectRelOf(key));
  if (inProject || !kitSide || !kit.units.has(key)) return inProject;
  const kitRel = path.relative(kit.dir, kit.units.get(key).src).split(path.sep).join("/");
  const inKit = linkedPrefix(kit.dir, kitRel);
  return inKit && `kit ${inKit}`;
}

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
