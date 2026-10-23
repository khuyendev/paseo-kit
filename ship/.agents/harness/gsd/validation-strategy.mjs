// The phase validation strategy (Kit feedback 70): upstream plan-phase step 5.5 renders `<NN>-VALIDATION.md` from
// `templates/VALIDATION.md` and the Validation Architecture section of the phase research; the plan checker's check 8e
// blocks without it. Pure text helpers shared by the gsd-plan flow verb and the revisions keys.
import { textDigest } from "../lib/hash.mjs";

export const TEMPLATE = ".agents/gsd/upstream/gsd-core/templates/VALIDATION.md";
const MARKER = /^<!-- gsd:validation-source ([0-9a-f]{64}) -->$/m;
const SECTION_HEADING = /^##[ \t]+Validation Architecture[ \t]*$/m;

// The research's Validation Architecture section, heading included, up to the next level-2 heading; null when absent.
export function researchSection(research) {
  const text = String(research ?? "").replace(/\r\n/g, "\n");
  const m = SECTION_HEADING.exec(text);
  if (!m) return null;
  const rest = text.slice(m.index + m[0].length);
  const next = /^##[ \t]+\S/m.exec(rest);
  return text.slice(m.index, next ? m.index + m[0].length + next.index : text.length).trim();
}

export const sourceDigest = (section) => textDigest(section);
// The source digest a rendered file carries; null for a file the kit did not render (hand-written, validated by a person).
export const markerDigest = (text) => MARKER.exec(String(text ?? ""))?.[1] ?? null;
export const isDraft = (text) => /^status:[ \t]*"?draft"?[ \t]*$/m.test(/^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text ?? ""))?.[1] ?? "");

// The template with its frontmatter and title filled (the table rows keep their `{N}-01-01` placeholders, as upstream), the
// source marker, and the research section copied at the end.
export function render(template, { phaseNumber, slug, date, section }) {
  const fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(template);
  if (!fm) throw new Error("VALIDATION.md template has no frontmatter");
  const fill = (s) => s.replaceAll("{N}", phaseNumber).replaceAll("{phase-slug}", slug).replaceAll("{date}", date);
  const body = template.slice(fm[0].length).replace(/^# Phase \{N\}/m, (h) => fill(h));
  return `${fill(fm[0])}${`<!-- gsd:validation-source ${sourceDigest(section)} -->\n`}${body.replace(/\s*$/, "\n")}\n---\n\n## Research: Validation Architecture\n\n> Copied from the phase RESEARCH.md when this file was rendered; fill the sections above from it.\n\n${section}\n`;
}
