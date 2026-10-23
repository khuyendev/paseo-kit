// The validation strategy step of gsd-plan (Kit feedback 70): `validation-strategy <phaseDir>` renders
// `<NN>-VALIDATION.md` from the template and the research's Validation Architecture section, once, and keeps a file that
// exists. The only writer of that file. Result status: written | refreshed | kept | no-research | no-section.
import fs from "node:fs";
import path from "node:path";
import { readText, writeTextAtomic } from "../../harness/lib/io.mjs";
import { resolveInside, toSlash } from "../../harness/lib/paths.mjs";
import { TEMPLATE, isDraft, markerDigest, render, researchSection, sourceDigest } from "../../harness/gsd/validation-strategy.mjs";

export function validationStrategy(root, phaseDir) {
  const dir = resolveInside(root, phaseDir);
  const m = /^(\d+(?:\.\d+)?)-([a-z0-9-]+)$/.exec(path.basename(dir));
  if (!m) return { ok: false, error: `${phaseDir} is not a phase directory`, code: 1 };
  const [, number, slug] = m;
  const rel = (name) => toSlash(path.join(phaseDir, name));
  const research = path.join(dir, `${number}-RESEARCH.md`);
  if (!fs.existsSync(research)) return { ok: true, status: "no-research" };
  const section = researchSection(readText(research));
  if (section === null) return { ok: true, status: "no-section" };
  const target = `${number}-VALIDATION.md`;
  const existing = fs.readdirSync(dir).filter((f) => /^[^/]*-VALIDATION\.md$/.test(f));
  const digest = sourceDigest(section);
  if (existing.length) {
    const text = readText(path.join(dir, existing.includes(target) ? target : existing[0]));
    const was = markerDigest(text);
    if (!existing.includes(target) || was === null || was === digest) return { ok: true, status: "kept", path: rel(existing.includes(target) ? target : existing[0]) };
    // The research moved on: a file still in draft is re-rendered; one a person or validate-phase has taken on is kept.
    if (!isDraft(text)) return { ok: true, status: "kept", path: rel(target), stale: true };
  }
  const templatePath = resolveInside(root, TEMPLATE);
  if (!fs.existsSync(templatePath)) return { ok: false, error: `validation template missing: ${TEMPLATE}`, code: 1 };
  writeTextAtomic(path.join(dir, target), render(readText(templatePath), { phaseNumber: number, slug, date: new Date().toISOString().slice(0, 10), section }));
  return { ok: true, status: existing.length ? "refreshed" : "written", path: rel(target) };
}
