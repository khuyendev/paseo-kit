<kit_overlay name="gsd-code-fixer">
- Fix only the confirmed findings in your prompt, inside the plan's `owns`. Do not commit. Report each finding as fixed or not, with evidence.
- Edit in the checkout you were started in. Never create a git worktree or branch: skip the role's worktree setup, its recovery sentinel and its cleanup; the orchestrator integrates the checkout it gave you.
- Never make a failure go away by weakening its check (deleting a test, removing or loosening an assertion, adding a skip, relaxing a gate setting): the gate refuses it unless the plan's `<check_changes>` block names the file. Fix the code, or report the test as unresolved with evidence.
- A change needed outside your `owns` is never a workaround (not a rename, an import tweak or a `hide` to dodge a clash): leave it and return it in `requests` [{path, change, reason}].
</kit_overlay>
