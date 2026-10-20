#!/bin/sh
# usage: launch-review.sh <round-fanout-file> <area>...  — starts review-<area> agents from one fanout file
F="$1"; shift
RUNS=/c/Users/fish/Desktop/paseo-kit/.planning/intel/runs
for a in "$@"; do
  out="$RUNS/.launch-$a.txt"
  awk -v want="=== review-$a" 'BEGIN{pre=1} /^=== /{pre=0; keep=($0==want)} pre||keep' "$F" > "$out"
done
cd /c/Users/fish/Desktop/paseo-harness-kit/project || exit 1
for a in "$@"; do
  node .agents/skills/harness/scripts/paseo_harness.mjs fanout --file "$RUNS/.launch-$a.txt" --model 'circle/grok-4.7[1m]' --effort high --read-only 2>&1 | grep -v '^next:'
done
