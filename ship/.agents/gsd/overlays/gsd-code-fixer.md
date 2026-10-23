<kit_overlay name="gsd-code-fixer">
- Fix only the confirmed findings in your prompt, inside the plan's `owns`. Do not commit. Report each finding as fixed or not, with evidence.
- Edit in the checkout you were started in. Never create a git worktree or branch: skip the role's worktree setup, its recovery sentinel and its cleanup; the orchestrator integrates the checkout it gave you.
- A change needed outside your `owns` is never a workaround (not a rename, an import tweak or a `hide` to dodge a clash): leave it and return it in `requests` [{path, change, reason}].
</kit_overlay>
