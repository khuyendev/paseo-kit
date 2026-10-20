#!/bin/sh
# usage: review-to-fix.sh <area>...  — prints the crev result, archives it, starts fix-<area> (Opus medium, writable, cwd paseo-kit)
R=/c/Users/fish/Desktop/paseo-kit/.planning/intel/runs
PH="node /c/Users/fish/Desktop/paseo-harness-kit/project/.agents/skills/harness/scripts/paseo_harness.mjs"
cd /c/Users/fish/Desktop/paseo-harness-kit/project || exit 1
for a in "$@"; do
  $PH result "crev-$a"
  $PH archive "crev-$a"
  RO="" CWD="C:/Users/fish/Desktop/paseo-kit" sh "$R/launch-blocks.sh" "$R/.code-fix-fanout.txt" 'circle/claude-opus-5-5[1m]' medium "fix-$a"
done
