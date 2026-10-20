# QA Agent Design Guide

`ph` = `node .agents/skills/harness/scripts/paseo_harness.mjs`, run from the project root (see `paseo-runtime.md`).

Use this guide when including a QA agent in a build harness. It explains how to find defects that QA agents can easily miss, based on bugs found in real projects and their causes.

---

## Contents

1. [Patterns of defects QA agents miss](#1-patterns-of-defects-qa-agents-miss)
2. [Integration coherence verification](#2-integration-coherence-verification)
3. [QA agent design principles](#3-qa-agent-design-principles)
4. [Workflow-based QA (v2)](#4-workflow-based-qa-v2)
5. [Verification checklist template](#5-verification-checklist-template)
6. [QA agent definition template](#6-qa-agent-definition-template)

---

## 1. Patterns of defects QA agents miss

### 1-1. Contract mismatch at component boundaries (Boundary Mismatch)

This is the most common defect. Each of two components may be implemented correctly when viewed separately, but they follow different contracts at the point where they connect.

| Connection point | Mismatch example | Why it is missed |
|--------|-----------|-----------|
| API response → frontend hook | The API returns `{ projects: [...] }`, but the hook expects `Project[]`. | Each component is checked separately and they are not compared with each other. |
| API response field name → type definition | The API uses `thumbnailUrl` (camelCase), but the type uses `thumbnail_url` (snake_case). | A generic type assertion prevents the compiler from detecting the mismatch. |
| File path → link `href` | The page is at `/dashboard/create`, but the link points to `/create`. | The file structure and `href` are not compared with each other. |
| State transition map → actual `status` update | The map defines a transition, but the code omits the operation that changes the status. | The reviewer checks only that the map exists and does not trace the actual update code. |
| API endpoint → frontend hook | The API exists, but there is no hook that calls it. | The API list and hook list are not compared one to one. |
| Immediate response → asynchronous processing result | The API immediately returns `{ status }`, but the frontend accesses a final-result field. | The immediate response and final response are not distinguished; only the type is checked. |

### 1-2. Why static code review alone has difficulty finding these defects

- **Limits of generic types**: `fetchJson<Project[]>()` can compile even when the actual response is `{ projects: [...] }`.
- **Why a successful build does not guarantee correct behavior**: Code using type assertions, `any`, or generics can build successfully but fail at runtime.
- **API existence and response contract are different verification targets**: Checking “Does the API exist?” and checking “Does the API response match what its caller expects?” are entirely different tasks.

<a id="2-integration-coherence-verification"></a>

## 2. Integration coherence verification

Always include **cross-component comparison checks** in the QA agent's work. The examples below use Next.js, but the principle applies to any technology stack. Open producer and consumer code together and compare the contracts on both sides.

### 2-1. Compare API responses with frontend hook types

```
1. Extract the response structure from the response serialization point in the API route (for example, NextResponse.json()).
2. Check the type expected by the corresponding hook or client (for example, T in fetchJson<T>).
3. Compare the response structure with T. If the API returns { data: [...] }, also check whether the hook reads .data.
```

In particular, check for paginated responses incorrectly received as arrays, missing conversion between snake_case and camelCase, and different structures for the immediate response (202) and final response.

### 2-2. Compare file paths with link and router paths

```
1. Extract URL patterns from the routing file structure. Remove (group) and treat [param] as a dynamic segment.
2. Collect every href=, router.push(, and redirect( value in the code.
3. Check that each link matches an existing route.
```

### 2-3. Trace whether every state transition is implemented

```
1. Extract the list of allowed transitions from the state transition map.
2. Search for all code that updates status.
3. Check that every transition in the code is defined in the map. There must be no disallowed transitions.
4. Find transitions in the map that are not executed in code. There must be no unused transitions.
5. In particular, check that the transition from an intermediate state to a final state is not missing.
```

### 2-4. Compare API endpoints and frontend hooks one to one

```
1. Extract the list of endpoints by HTTP method.
2. Extract the list of client fetch-call URLs.
3. For any endpoint that is not called, determine whether it is an administrative API that the client does not call directly or whether its call code is missing.
```

## 3. QA agent design principles

### 3-1. Choose an agent type that can use all tools

An `Explore` type can only read files. To perform QA properly, the agent must be able to find patterns with search, run scripts to compare results automatically, and modify code when necessary. Choose the general-purpose agent (omit `--type`) or a custom type with all tools. Define the QA agent as an editable role: do not use `--read-only`, and, if its definition has a `tools:` field, include Bash, Edit, and Write. Paseo agents always have the filesystem MCP batch tools; `tools:` lists and read-only roles are advisory, not enforced permissions. State a “verify → report → request fixes” procedure in the agent definition.

### 3-2. Put comparison results in the checklist, not just existence

| Simple checklist | Comparison-focused checklist |
|---------------|---------------|
| Does the API endpoint exist? | Does the API response structure match the corresponding hook's type? |
| Is the state transition map defined? | Does every code path that updates `status` match the transition map? |
| Does the page file exist? | Does every link in the code point to a page that actually exists? |
| Is strict mode used? | Is any type safety bypassed with a generic type assertion? |

### 3-3. Read both connected sides of the code together

Do not read only one side when looking for bugs at a connection point. Read the API route and corresponding hook, the state transition map and actual update code, and the file structure and link paths together. State this principle clearly in the agent definition.

### 3-4. Run QA as each module is completed, not after all modules are built

If QA runs only after the whole implementation is complete, bugs accumulate, the cost of fixing them increases, and early contract mismatches can spread to later modules. Prefer **incremental QA**: compare an API and its corresponding hook as soon as each API endpoint is completed.

<a id="4-workflow-based-qa-v2"></a>

## 4. Workflow-based QA (v2)

If you can list the connection points to verify, you can also build the QA process as a workflow.

```javascript
export const meta = {
  name: 'qa-coherence',
  description: 'Inspect and independently verify component-boundary contracts',
  phases: [{ title: 'Inspection' }, { title: 'Re-verification' }],
}
// Divide connection points into checks -> re-verify each finding from the opposing perspective
const FINDINGS = { type: 'object', required: ['findings'], properties: {
  findings: { type: 'array', items: { type: 'object',
    required: ['title', 'file', 'evidence'], properties: {
      title: { type: 'string' }, file: { type: 'string' }, evidence: { type: 'string' } } } } } }
const VERDICT = { type: 'object', required: ['status', 'reason'], properties: {
  status: { type: 'string', enum: ['confirmed', 'refuted', 'uncertain'] },
  reason: { type: 'string' } } }
const boundaries = args.boundaries  // Extracted during preliminary research: [{api: '...', consumer: '...'}, ...]
const found = await pipeline(
  boundaries,
  b => agent(`Read both sides together and find contract mismatches: ${b.api} ↔ ${b.consumer}`,
    { agentType: 'qa-inspector', phase: 'Inspection', schema: FINDINGS }),
  r => parallel((r?.findings ?? []).map(f => () =>
    agent(`Verify from the opposing perspective whether this mismatch causes an actual runtime error: ${JSON.stringify(f)}`,
      { phase: 'Re-verification', schema: VERDICT }).then(verdict => ({ ...f, verdict }))))
)
const confirmed = found.flat().filter(Boolean)
  .filter(f => f.verdict?.status === 'confirmed')
return { confirmed }
```

Save this as `.agents/workflows/qa-coherence.js`. Run it from the project root with:

```sh
node .agents/skills/harness/scripts/paseo_harness.mjs workflow --script .agents/workflows/qa-coherence.js --args '{"boundaries":[{"api":"...","consumer":"..."}]}'
```

The `qa-inspector` type must be defined in `.agents/agents/qa-inspector.md`.

Re-verify each finding from the opposing perspective and keep only findings with a `confirmed` verdict. This filters out claims that sound plausible but are not actual problems, making the findings in the final QA report more trustworthy.

## 5. Verification checklist template

Include the following integration coherence checklist in the definition of any QA agent that checks a web application.

```markdown
### Integration coherence verification (web app)

#### API and frontend connections
- [ ] Check that the response structure of every API route matches the generic type of its corresponding hook.
- [ ] Check that the hook extracts the actual data value from an object-wrapped response ({ items: [...] }).
- [ ] Check that conversion between snake_case and camelCase is applied consistently.
- [ ] Check that the frontend distinguishes the immediate response (202) from the final response structure.
- [ ] Check that every API endpoint has a corresponding frontend hook and that the hook is actually called.

#### Routing coherence
- [ ] Check that every href/router.push value in the code matches an actual page file path.
- [ ] Check routes with the understanding that (group) in a route group is omitted from the URL.
- [ ] Check that dynamic segments ([id]) receive the correct parameter values.

#### State machine coherence
- [ ] Check that every defined state transition is executed in code (there must be no unused transitions).
- [ ] Check that every `status` update in code is defined in the transition map (there must be no disallowed transitions).
- [ ] Check that no transition from an intermediate state to a final state is missing.
- [ ] Check that X in frontend status branches (if status === "X") is a state that can actually be reached.

#### Data flow coherence
- [ ] Check that the mapping between DB schema field names and API response field names is consistent.
- [ ] Check that field names in frontend type definitions match API response field names.
- [ ] Check that both sides handle null/undefined values for optional fields consistently.
```

## 6. QA agent definition template

```markdown
---
name: qa-inspector
description: "A QA agent that verifies specification compliance, integration coherence, and design quality."
---

# QA Agent

## Primary role
Check that implementation follows the specification and verify **integration coherence between modules**.

## Verification priorities
1. **Integration coherence** (highest priority) — contract mismatches at connection points are a major cause of runtime errors.
2. **Functional specification compliance** — check APIs, state machines, and data models.
3. **Design quality** — check colors, fonts, and responsive behavior.
4. **Code quality** — check unused code and naming conventions.

## Verification method: read both sides of connected code together
| Verification target | Producer | Consumer |
|----------|-------|-------|
| API response structure | Response serialization point | Type expected by the client |
| Routing | Routing file structure | `href`, `router.push` values |
| State transitions | Transition map | `status` update code |
| DB → API → UI | Column names in DB tables | API response fields → type definitions |

## Reporting and fix-request procedure
- When you find a problem, promptly send the responsible agent a specific fix request (file:line number + how to fix it). For a persistent teammate, send it with `node .agents/skills/harness/scripts/paseo_harness.mjs send --prompt "..." <agent-name>`; in a workflow, return findings to the orchestrator so it can route the request.
- If a connection point has a problem, notify both agents responsible for its sides.
- Send the leader a verification report that separates passed, failed, and unverified items.
```

Place this definition in `.agents/agents/qa-inspector.md`. Do not give it a `tools:` list or launch it with `--read-only`: it runs scripts and requests or makes fixes, and in Paseo every agent already has all tools (a `tools:` list is advisory and would only narrow its hints).

---

## Real cases: bugs found and their causes

| Bug | Connection point | Cause |
|------|----------|------|
| `projects?.filter is not a function` | API → hook | The API returns `{projects:[]}`, but the hook expects an array. |
| Every dashboard link returns 404 | File path → `href` | The `/dashboard/` prefix is missing. |
| Thumbnail image is not displayed | API → UI component | `thumbnailUrl` and `thumbnail_url` do not match. |
| Selected value is not saved | API → hook | The API exists, but there is no corresponding hook. |
| Creation page remains in a waiting state | State transition → code | The code that changes to the final state is missing. |
| Crash when accessing `data.failedIndices` | Immediate response → frontend | The frontend accesses background processing results from the immediate response. |
| Opening the detail page after completion returns 404 | File path → `href` | The route prefixes do not match. |

