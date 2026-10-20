// Exact v1 coverage is checked both before approval and under the shared-file writer lock (GSDF-95).
import { parseRoadmap } from "./roadmap.mjs";
import { padPhase } from "./planning.mjs";

export function v1RequirementIds(text, idRegex) {
  const ids = [];
  let level = 0;
  for (const line of text.split(/\r?\n/)) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      if (!(level && heading[1].length > level)) level = /\bv1\b/i.test(heading[2]) ? heading[1].length : 0;
      continue;
    }
    if (!level) continue;
    const match = /^\s*-\s*\[[ xX]\]\s*\*\*([^*]+)\*\*/.exec(line) ?? /^\|\s*([^|\s][^|]*?)\s*\|/.exec(line);
    if (match && idRegex.test(match[1].trim())) ids.push(match[1].trim());
  }
  return [...new Set(ids)];
}

export function validateDraft(reqText, draft, trace, regex) {
  const problems = [];
  const unmapped = [];
  const v1 = v1RequirementIds(reqText, new RegExp(regex));
  const parsed = parseRoadmap(draft, regex);
  if (!v1.length) problems.push(".planning/REQUIREMENTS.md: no v1 requirement ids found under a v1 heading");
  if (parsed.scope !== "complete") problems.push(`draft ROADMAP is ${parsed.scope}`);
  const expected = new Set(v1);
  const phases = parsed.phases;
  for (const p of phases) {
    if (p.success_criteria.length < 2 || p.success_criteria.length > 5) problems.push(`phase ${p.number}: ${p.success_criteria.length} success criteria (needs 2-5)`);
    if (!p.goal || p.warnings.length) problems.push(`phase ${p.number}: missing goal or malformed requirement line`);
    const raw = /^\s*\*\*Requirements(?::\*\*|\*\*\s*:)\s*(.*)$/mi.exec(p.section)?.[1] ?? "";
    const tokens = raw.replace(/[`\[\]]/g, " ").split(/[,\s]+/).filter(Boolean);
    if (new Set(tokens).size !== tokens.length) problems.push(`phase ${p.number}: duplicate requirement in Requirements line`);
    for (const id of p.requirements) if (!expected.has(id)) problems.push(`unexpected requirement in draft: ${id}`);
  }
  for (const id of Object.keys(trace)) if (!expected.has(id)) problems.push(`unexpected traceability requirement: ${id}`);
  for (const id of v1) {
    const listed = phases.flatMap((p) => p.requirements.filter((r) => r === id).map(() => p.padded));
    if (!Object.hasOwn(trace, id) || listed.length === 0) unmapped.push(id);
    else if (listed.length !== 1) problems.push(`${id} is listed ${listed.length} times; needs exactly one`);
    else if (padPhase(String(trace[id]).replace(/^Phase\s+/i, "")) !== listed[0]) problems.push(`${id}: traceability says phase ${trace[id]}, ROADMAP lists it in phase ${listed[0]}`);
  }
  if (unmapped.length) problems.push(`v1 requirements mapped to no phase: ${unmapped.join(", ")}`);
  return { ok: !problems.length, problems, unmapped, v1: v1.length, phases: phases.map((p) => ({ id: p.number, name: p.phase_name, criteria: p.success_criteria.length })), code: problems.length ? 1 : 0 };
}
