#!/bin/sh
# Assembles .planning/REQUIREMENTS.md from the four group files (the group files are the source; rerun after edits)
P=/c/Users/fish/Desktop/paseo-kit/.planning
{
  echo "# Requirements: paseo-kit v1.0"
  echo
  echo "Generated from \`.planning/requirements/{platform,runtime,tools,method}.md\` by \`intel/runs/assemble-requirements.sh\`; edit the group files, not this file."
  echo "Requirement IDs: INST, MACH, CONF (platform), PCLI, PHCL, FLOW (runtime), FTOL, HOOK, PANL (tools), GSDC, GSDF, HARN, ADPT (method)."
  for g in platform runtime tools method; do echo; echo "---"; echo; sed '1s/^# /## /' "$P/requirements/$g.md" | sed '2,$s/^## /### /;2,$s/^### \([A-Z]\{4\}-\)/#### \1/'; done
} > "$P/REQUIREMENTS.md"
grep -c '^#### [A-Z]\{4\}-[0-9]' "$P/REQUIREMENTS.md"
