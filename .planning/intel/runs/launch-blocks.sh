#!/bin/sh
# usage: launch-blocks.sh <fanout-file> <model> <effort> <block-name>...  — starts the named blocks of one fanout file
F="$1"; M="$2"; E="$3"; shift 3
RUNS=/c/Users/fish/Desktop/paseo-kit/.planning/intel/runs
cd /c/Users/fish/Desktop/paseo-harness-kit/project || exit 1
for b in "$@"; do
  out="$RUNS/.launch-$b.txt"
  awk -v want="=== $b" 'BEGIN{pre=1} /^=== /{pre=0; keep=($0==want)} pre||keep' "$F" > "$out"
  node .agents/skills/harness/scripts/paseo_harness.mjs fanout --file "$out" --model "$M" --effort "$E" --read-only 2>&1 | grep -v '^next:'
done
