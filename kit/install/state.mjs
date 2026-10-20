// Six-state classification over the project (P), kit (K) and installed (I) digests (INST-06).
export const HELP = Object.freeze({
  missing: "update adds it",
  "kit-newer": "update takes it",
  local: "pull copies it into the kit; update --force replaces it with the kit version",
  both: "merge by hand, then pull --force or update --force",
  removed: "update deletes it",
  "removed-local": "delete or keep it by hand",
});

export function classify(P, K, I) {
  if (K == null) return P == null ? "gone" : P === I ? "removed" : "removed-local";
  if (P == null) return "missing";
  if (P === K) return "same";
  if (P === I) return "kit-newer";
  if (K === I) return "local";
  return "both";
}

export const reason = (state) => `${state}: ${HELP[state]}`;
