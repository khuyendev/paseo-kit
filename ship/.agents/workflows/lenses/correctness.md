# Lens: correctness

The kit's default code-review lens, used when the adapter defines no review lens.

Look for defects that make the reviewed code do the wrong thing:
- Logic errors: wrong conditions, off-by-one, inverted checks, missing cases of an enum or union, unhandled empty or null input.
- Error handling: errors swallowed, reported as success, or leaving partial state behind; resources not released on failure.
- Contracts: the code does not do what its plan task and must_haves say, or breaks a caller visible in the repository.
- Concurrency and ordering: races, missing awaits, results used before they exist.
- Data safety: untrusted input reaching a shell, a path or a query without validation; secrets written to logs or files.

Every finding names the trigger (the concrete input or sequence that makes it fail), the likelihood (likely, possible, theoretical), a confidence 0-100, the impact, and file and line. Style and naming are not findings.
