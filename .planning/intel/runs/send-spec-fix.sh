#!/bin/sh
# usage: send-spec-fix.sh <group>...  — sends review/spec-<group>.md to writer spec-<group>, archives srev-<group>
I=/c/Users/fish/Desktop/paseo-kit/.planning/intel
cd /c/Users/fish/Desktop/paseo-harness-kit/project || exit 1
for g in "$@"; do
  node .agents/skills/harness/scripts/paseo_harness.mjs result "srev-$g"
  if [ "$g" = project ]; then spec="C:/Users/fish/Desktop/paseo-kit/.planning/PROJECT.md"; else spec="C:/Users/fish/Desktop/paseo-kit/.planning/requirements/$g.md"; fi
  sed -e "s#{REVIEW}#C:/Users/fish/Desktop/paseo-kit/.planning/intel/review/spec-$g.md#" -e "s#{SPEC}#$spec#" "$I/runs/spec-fix-prompt.txt" > "$I/runs/.spec-fix-$g.txt"
  node .agents/skills/harness/scripts/paseo_harness.mjs send --prompt-file "$I/runs/.spec-fix-$g.txt" "spec-$g" | grep -v '^next:'
  node .agents/skills/harness/scripts/paseo_harness.mjs archive "srev-$g"
done
