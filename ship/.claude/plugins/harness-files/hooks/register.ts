import type { Register, EngineInterface } from 'claude-code'

// harness-files mod (D-39, D-40): registers three tools and serves them through the project's trusted backend.
// Sandbox module: no Node imports and no target-file I/O here; request JSON never goes into a command line (FTOL-07).
const METHODS = ['read_ranges', 'edit_multiple_files', 'write_multiple_files']
const PREFIX = 'mcp__harness-files__'
const PROTOCOL = 1
const MAX_REQUEST = 16 * 1024 * 1024
const MAX_RESULT = 44000 // below Claude Code's ~50,000-char persistence threshold (FTOL-13)
const TRANSPORT_MS = 30000
const BASH_MS = 120000
const SENTINEL = 'harness-files ticket completed'
const EVENT_KEYS = ['tool', 'tool_use_id', 'agentId', 'consent', 'requestMeta']
const NATIVE_CHILD = 'Harness file backend is unavailable inside a native subagent: the public API cannot preserve its permission context. Use native Read/Edit/Write/Bash; these built-ins are unchanged.'

type Check = { tool: string; input: Record<string, unknown> }
type Found = { backend: string }

const fail = (text: string) => new Error(text)
const cut = (s: string, n = 1500) => String(s ?? '').slice(0, n)

// FTOL-05: discovery runs on every call and nothing is cached, so the install manifest and every trusted file are checked each time.
async function backend($: EngineInterface, cwd: string): Promise<string> {
  const root = (await $.env.get('PASEO_HARNESS_ROOT')) ?? ''
  const script = `${$.plugin.root}/scripts/discover.mjs`
  const out = await $.process.run(['node', script, root, cwd, $.plugin.root], { cwd, timeoutMs: TRANSPORT_MS })
  if (out.exitCode !== 0 || out.isStdoutTruncated || out.isStderrTruncated || !out.stdout) {
    throw fail(`Backend discovery failed: ${cut(out.stderr) || 'incomplete discovery output'}`)
  }
  const found = JSON.parse(out.stdout) as Found
  if (typeof found.backend !== 'string' || !found.backend) throw fail('Backend discovery failed: incomplete discovery output')
  return found.backend
}

// FTOL-06: one JSON object on stdin; anything but a complete protocol-1 reply fails closed.
async function transport($: EngineInterface, backendPath: string, input: Record<string, unknown>, cwd: string): Promise<any> {
  const stdin = JSON.stringify(input)
  if (stdin.length > MAX_REQUEST) throw fail('file request exceeds 16 MiB; split the call')
  const out = await $.process.run(['node', backendPath], { cwd, stdin, timeoutMs: TRANSPORT_MS })
  if (out.exitCode !== 0) throw fail(`File transport failed: ${cut(out.stderr) || `backend exit ${out.exitCode}`}`)
  if (out.isStdoutTruncated || out.isStderrTruncated || !out.stdout) throw fail('File transport failed: incomplete backend output')
  let parsed: any
  try { parsed = JSON.parse(out.stdout) } catch { throw fail('File transport failed: incomplete backend output') }
  if (parsed.protocol !== PROTOCOL) throw fail('Harness file mod/backend protocol mismatch: update the installed project assets and plugin together')
  return parsed
}

// FTOL-08: declarative check only; ask and deny are never promoted.
async function permission($: EngineInterface, check: Check) {
  const verdict = await $.tool.check({ tool: check.tool, input: check.input } as any)
  if (verdict.decision !== 'allow' || (verdict.ceiling && verdict.ceiling !== 'allow')) {
    throw fail(`${check.tool} permission ${verdict.decision}: ${verdict.reason ?? "use the native tool for this path; this adapter fails closed on ask/deny"}`)
  }
}

export function suppliedChecks(method: string, args: any): Check[] {
  const checks: Check[] = []
  if (args.continuation !== undefined || args.receipt !== undefined) return checks // private recovery, no target access
  const read = (file_path: unknown) => checks.push({ tool: 'Read', input: { file_path } })
  const edit = (file_path: unknown, old_string: unknown, new_string: unknown) => checks.push({ tool: 'Edit', input: { file_path, old_string: old_string ?? '', new_string: new_string ?? '' } })
  if (method === 'read_ranges') for (const r of args.ranges ?? []) read(r?.path)
  else if (method === 'write_multiple_files') for (const f of args.files ?? []) { read(f?.path); checks.push({ tool: 'Write', input: { file_path: f?.path, content: f?.content ?? '' } }) }
  else {
    for (const f of args.files ?? []) { read(f?.path); for (const e of f?.edits ?? []) edit(f?.path, e?.oldText, e?.newText) }
    for (const fx of args.fixes ?? []) if (fx?.path !== undefined) { read(fx.path); edit(fx.path, fx.oldText, fx.newText) }
  }
  return checks
}

const shellQuote = (s: string) => `'${s.replaceAll('\\', '/').replaceAll("'", "'\\''")}'`
const ticketId = (s: unknown): string => {
  if (typeof s !== 'string' || !/^[a-f0-9]{64}$/.test(s)) throw fail('Invalid backend ticket')
  return s
}

// FTOL-07: the real native Bash call, so its hooks, permission rules and dialog stay intact; no payload in it.
export const ticketCommand = (backendPath: string, action: string, session: unknown, ticket: unknown) =>
  `node ${shellQuote(backendPath)} ${action} ${ticketId(session)} ${ticketId(ticket)}`

async function nativeTicket($: EngineInterface, backendPath: string, stage: any, action: '--plan' | '--execute') {
  const command = ticketCommand(backendPath, action, stage.session, stage.ticket)
  const description = action === '--plan' ? 'Harness file backend: plan the permission checks' : 'Harness file backend: run the checked file operation'
  const out: any = await $.tool.call({ tool: 'Bash', command, description, timeout: BASH_MS } as any)
  const text = out.text ?? (!out.deny && !out.isError ? out.result?.stdout : '')
  if (out.deny || out.isError || !String(text ?? '').includes(SENTINEL)) throw fail(cut(out.deny ?? out.text ?? 'native Bash did not complete the file ticket', 2000))
}

async function serve($: EngineInterface, method: string, e: any) {
  // FTOL-40: the public check/call APIs drop agentId, so a native child's restrictions cannot be kept.
  if (e.agentId) return { deny: NATIVE_CHILD }
  const cwd = await $.session.cwd()
  const session = await $.session.id()
  const args: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(e)) if (!EVENT_KEYS.includes(key)) args[key] = value
  let stage: any, backendPath = '', executeCalled = false
  try {
    for (const check of suppliedChecks(method, args)) await permission($, check)
    backendPath = await backend($, cwd)
    stage = await transport($, backendPath, { action: 'stage', session, cwd, method, args }, cwd)
    if (!stage.continuation) {
      await nativeTicket($, backendPath, stage, '--plan')
      const plan = await transport($, backendPath, { action: 'collect', phase: 'plan', session, ticket: stage.ticket }, cwd)
      for (const check of plan.checks as Check[]) await permission($, check)
      executeCalled = true // at most one native execute per tool call (FTOL-12)
      await nativeTicket($, backendPath, stage, '--execute')
    }
    const out = await transport($, backendPath, { action: 'collect', session, ticket: stage.ticket }, cwd)
    if (typeof out.text !== 'string' || out.text.length > MAX_RESULT) throw fail('Backend result is missing or exceeds the safe page size')
    return { result: out.text }
  } catch (error) {
    const cause = String(error instanceof Error ? error.message : error)
    if (!stage || stage.continuation) return { deny: cut(cause, 2000) }
    if (executeCalled) {
      // the result can be lost after a real mutation: recover it once, never re-execute
      try {
        const recovered = await transport($, backendPath, { action: 'collect', session, ticket: stage.ticket }, cwd)
        if (typeof recovered.text === 'string' && recovered.text.length <= MAX_RESULT - 100) return { result: `Recovered completed execution receipt; operation was not repeated.\n${recovered.text}` }
      } catch { /* unavailable or still running: ask whether execution ever began */ }
    }
    // withdrawn under the backend lock: an unstarted ticket can never execute later
    let started = true
    try { started = (await transport($, backendPath, { action: 'abandon', session, ticket: stage.ticket }, cwd)).started !== false } catch { /* unknown: it may have run */ }
    if (executeCalled && started) {
      return { result: `EXECUTION OUTCOME UNKNOWN: target files may already have changed. Do not repeat the mutation blindly. Recover its result on this same tool with {"receipt":"${stage.ticket}"}; recovery never re-executes the operation. If no completed receipt is available, inspect the affected paths with native tools. Cause: ${cut(cause)}` }
    }
    if (executeCalled) return { deny: cut(`Not executed; no target changed. ${cause}`, 2000) }
    return { deny: cut(cause, 2000) }
  }
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const cwd = await $.session.cwd()
    const { tools } = await transport($, await backend($, cwd), { action: 'describe' }, cwd)
    const names = Array.isArray(tools) ? tools.map((t: any) => t?.name) : []
    if (names.length !== METHODS.length || METHODS.some((m) => !names.includes(m))) throw fail('Unexpected file tool registry')
    for (const tool of tools) await $.tool.register({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, isDeferred: false })
    return next(e)
  })
  for (const method of METHODS) {
    on('tool.call', { tool: `${PREFIX}${method}` } as any, ($: EngineInterface, e: any) => serve($, method, e) as any)
      .catch(() => ({ deny: 'Harness file handler failed closed; use native tools. No permission override is installed.' }) as any)
  }
}
