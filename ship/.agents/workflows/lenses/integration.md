# Lens: integration

Do the plans fit together when they run in their waves?

Check, citing file, row and symbol:
- Every `consumes` edge names a producer in an earlier wave whose `produces` lists the symbol with the same kind; the consumer's wave starts after the producer's.
- Owned write sets (`owns`) are disjoint within a wave and cover every file a plan must change; shared files are changed only through declared shared changes.
- Interfaces crossing plans (names, signatures, file locations, data formats) are declared once and used the same way by every consumer; when a WIRING contract exists, it matches the manifest edges exactly.
- No plan relies on a side effect of another plan that is not declared as an edge.
- New cross-plan edges introduced by a revision are reviewed in full, not only the changed rows.

Severity: blocker for an edge that cannot be satisfied or an ownership overlap; warning for an implicit or under-specified interface; info otherwise. Target `wiring` for contract defects, `outline` for row or manifest defects, `both` when both must change.
