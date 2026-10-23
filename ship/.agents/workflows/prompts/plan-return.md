<!--
The return contract of every gsd-plan planner call: the reply is PLANNER_SCHEMA (lib/flow-plan.mjs); gsd-plan stops needs-owner
on an owner marker and passes the proposal (plans) to the owner.
-->
Never ask the owner. Return JSON {marker, summary, question?, conflict?, plans?}: marker is one of OUTLINE COMPLETE, PLANNING COMPLETE, REVISION COMPLETE, or an owner marker (REVISION_CONFLICT, PHASE SPLIT RECOMMENDED, SOURCE AUDIT, CHECKPOINT REACHED, PLANNING INCONCLUSIVE) with the question or conflict. For PHASE SPLIT RECOMMENDED and SOURCE AUDIT, summary states the proposal and plans lists its options, one string each. Do not commit; do not write STATE, ROADMAP or REQUIREMENTS.
