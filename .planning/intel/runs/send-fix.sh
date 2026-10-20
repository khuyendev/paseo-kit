#!/bin/sh
# usage: send-fix.sh <round> <area>...  — sends the review of that round to map-<area>
R="$1"; shift
I=/c/Users/fish/Desktop/paseo-kit/.planning/intel
cd /c/Users/fish/Desktop/paseo-harness-kit/project || exit 1
for a in "$@"; do
  p="$I/runs/.fix-$a-r$R.txt"
  sed -e "s#{REVIEW}#C:/Users/fish/Desktop/paseo-kit/.planning/intel/review/$a-r$R.md#" -e "s#{MAP}#C:/Users/fish/Desktop/paseo-kit/.planning/intel/map/$a.md#" -e "s#{ROUND}#r$R#" "$I/runs/fix-prompt.txt" > "$p"
  node .agents/skills/harness/scripts/paseo_harness.mjs send --prompt-file "$p" "map-$a" 2>&1 | grep -v '^next:'
done
