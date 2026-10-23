// The argument checks the gsd workflows run before their first agent, on the merged config (F62). ph doctor and
// kit.mjs update report them, so an overlay value the kit refuses shows up after an update instead of at the first run.
// gsd-plan.js keeps its own copy of the lens rule (workflow scripts cannot import); tests/fb3/F62.test.mjs compares the lists.

// Skeleton kit lenses; correctness (code) and source-grounding (plan_review) are other stages' lenses (G029).
export const SKELETON_KIT_LENSES = Object.freeze(["fidelity", "integration"]);

// gsd-plan.js refuses a skeleton lane whose lens is neither a skeleton kit lens nor an adapter.review_lenses entry of stage skeleton.
export function workflowArgProblems(cfg) {
  const skeletonLenses = new Set((cfg.adapter.review_lenses ?? []).filter((l) => (l.stage ?? "code") === "skeleton").map((l) => l.name));
  return cfg.gsd.skeleton_lanes.flatMap((lane, i) => (SKELETON_KIT_LENSES.includes(lane.lens) || skeletonLenses.has(lane.lens)
    ? []
    : [`gsd.skeleton_lanes[${i}].lens: '${lane.lens}' is neither a skeleton kit lens (${SKELETON_KIT_LENSES.join(", ")}) nor an adapter.review_lenses entry of stage skeleton; gsd-plan stops before its first agent`]));
}
