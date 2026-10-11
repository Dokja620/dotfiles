import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { AgentRow, Facts, Live, ToolRow } from '../types'

// ───────────────────────── theme (catppuccin mocha, matches tmux) ─────────────────────────
const C = {
  rosewater: '#f5e0dc',
  flamingo: '#f2cdcd',
  pink: '#f5c2e7',
  mauve: '#cba6f7',
  red: '#f38ba8',
  maroon: '#eba0ac',
  peach: '#fab387',
  yellow: '#f9e2af',
  green: '#a6e3a1',
  teal: '#94e2d5',
  sky: '#89dceb',
  sapphire: '#74c7ec',
  blue: '#89b4fa',
  lavender: '#b4befe',
  text: '#cdd6f4',
  subtext: '#a6adc8',
  overlay: '#6c7086',
  surface: '#45475a',
  base: '#1e1e2e',
} as const

const PANE = 'axel-ui'
const TMUX_SCRIPT = '.tmux/claude-status-update.sh'
const MAX_TOOLS = 400
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

const initialLive: Live = {
  isWorking: false,
  isWaiting: false,
  waitMessage: '',
  turnStartedAt: 0,
  lastTurnMs: 0,
  turns: 0,
  tools: [],
  agents: [],
}
const initialFacts: Facts = {
  model: '',
  effort: '',
  caveman: null,
  branch: null,
  isDirty: false,
  ctxPercent: null,
  ctxTokens: null,
  ctxWindow: null,
  usd: null,
  rates: [],
  sessionStartedAt: 0,
}

const live = atom({ plugin: 'axel-ui', key: 'live' } as const, initialLive)
const facts = atom({ plugin: 'axel-ui', key: 'facts' } as const, initialFacts)
const isBandHidden = atom({ plugin: 'axel-ui', key: 'isBandHidden' } as const, false)

// ───────────────────────── helpers ─────────────────────────
function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function labelOf(e: { tool: string } & Record<string, unknown>): string {
  const t = String(e.tool)
  if (t === 'Bash') return str(e.description) || str(e.command).split('\n')[0]?.slice(0, 60) || ''
  if (t === 'Read' || t === 'Edit' || t === 'Write') return str(e.file_path).split('/').slice(-2).join('/')
  if (t === 'Agent') return str(e.description)
  if (t === 'Skill') return str(e.skill)
  if (t === 'Grep' || t === 'Glob') return str(e.pattern).slice(0, 40)
  if (t === 'WebFetch') return str(e.url).replace(/^https?:\/\//, '').slice(0, 50)
  if (t === 'WebSearch') return str(e.query).slice(0, 50)
  if (t.startsWith('mcp__')) return t.split('__').slice(1).join(' › ')
  return ''
}

function shortTool(t: string): string {
  if (t.startsWith('mcp__')) return 'MCP'
  return t
}

function secs(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

function bar(percent: number, width: number): string {
  const p = Math.max(0, Math.min(100, percent))
  const full = Math.round((p / 100) * width)
  return '▰'.repeat(full) + '▱'.repeat(Math.max(0, width - full))
}

function pctColor(p: number): string {
  if (p >= 85) return C.red
  if (p >= 65) return C.peach
  if (p >= 40) return C.yellow
  return C.green
}

function shortModel(m: string): string {
  return m
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '')
    .replace(/-(\d)-(\d)$/, ' $1.$2')
}

function toolColor(t: ToolRow): string {
  if (t.endedAt === undefined) return C.yellow
  return t.isError ? C.red : C.green
}

function toolIcon(t: ToolRow, frame: number): string {
  if (t.endedAt === undefined) return SPIN[frame] ?? '⠋'
  return t.isError ? '✗' : '✓'
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length)
}

function kTokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

function rateName(kind: string): string {
  if (kind === 'five_hour') return '5h'
  if (kind === 'seven_day') return '7d'
  if (kind === 'spend_limit') return 'spend'
  return kind.replace(/_/g, ' ')
}

function resetIn(iso: string | undefined, now: number): string {
  if (!iso) return ''
  const ms = Date.parse(iso) - now
  if (!Number.isFinite(ms) || ms <= 0) return ''
  return secs(ms)
}

// ───────────────────────── side effects ─────────────────────────
let home = ''
let tmuxState = ''
let frame = 0

let tmuxDetail = ''

async function tmux($: EngineInterface, action: 'wait' | 'work' | 'done'): Promise<void> {
  const key = `${action} ${tmuxDetail}`
  if (key === tmuxState) return
  tmuxState = key
  if (!home) return
  try {
    await $.process.run(['bash', `${home}/${TMUX_SCRIPT}`, action, tmuxDetail], { timeoutMs: 5000 })
  } catch {
    /* no tmux */
  }
}

async function refreshFacts($: EngineInterface): Promise<void> {
  let caveman: string | null = null
  try {
    const flag = (await $.fs.read(`${home}/.claude/.caveman-active`)).trim()
    caveman = flag || 'full'
  } catch {
    caveman = null
  }
  const [model, settings, usage, repo] = await Promise.all([
    $.session.model(),
    $.settings.read(),
    $.session.usage(),
    $.session.repo(),
  ])
  let branch: string | null = null
  let isDirty = false
  if (repo) {
    try {
      const [b, d] = await Promise.all([
        $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 3000 }),
        $.process.run(['git', 'status', '--porcelain'], { timeoutMs: 5000 }),
      ])
      branch = b.stdout.trim() || null
      isDirty = d.stdout.trim().length > 0
    } catch {
      branch = null
    }
  }
  const next: Facts = {
    model: shortModel(model),
    effort: typeof settings.effortLevel === 'string' ? settings.effortLevel : '',
    caveman,
    branch,
    isDirty,
    ctxPercent: usage.context.percent ?? null,
    ctxTokens: usage.context.tokens ?? null,
    ctxWindow: usage.context.window,
    usd: usage.cost?.usd ?? null,
    rates: usage.rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt })),
    sessionStartedAt: usage.startedAt,
  }
  await update($, facts, () => next)
  tmuxDetail = next.ctxPercent !== null ? `${Math.round(next.ctxPercent)}%` : ''
  const current = tmuxState.split(' ')[0]
  if (current === 'wait' || current === 'work' || current === 'done') void tmux($, current)
}

async function refreshAgents($: EngineInterface): Promise<void> {
  try {
    const list = await $.agent.list()
    const agents: AgentRow[] = list.map(a => ({ id: a.id, description: a.description, type: a.type, status: a.status }))
    await update($, live, l => ({ ...l, agents }))
  } catch {
    /* none */
  }
}

// ───────────────────────── register ─────────────────────────
export const register: Register = on => {
  let factsTick: { cancel: () => void } | null = null
  let bandTick: { cancel: () => void } | null = null

  on('session.start', async ($, e, next) => {
    home = (await $.env.get('HOME')) ?? ''
    $.ui.status(undefined) // drop any pinned line left by an earlier version of this mod
    await $.command.register({ name: 'ui', description: 'Toggle the activity pane' })
    await $.command.register({ name: 'ui-bar', description: 'Toggle the status band above the prompt' })
    const started = await next(e)
    tmuxState = ''
    void tmux($, 'done')
    void refreshFacts($)
    factsTick?.cancel()
    factsTick = $.clock.every(20000, () => void refreshFacts($))
    return started
  })

  on('command.run', { command: 'ui' }, async $ => {
    const open = (await $.ui.panes()).some(p => p.id === PANE)
    if (open) {
      await $.ui.close({ id: PANE })
      return { text: 'Activity pane closed.' }
    }
    const r = await $.ui.open({ id: PANE, title: 'Activity' })
    return { text: r.isPlaced ? 'Activity pane opened.' : 'Pane waits for 110+ columns.' }
  })

  on('command.run', { command: 'ui-bar' }, async $ => {
    const hidden = await read($, isBandHidden)
    await update($, isBandHidden, () => !hidden)
    return { text: hidden ? 'Status band shown.' : 'Status band hidden.' }
  })

  on('prompt.submit', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, live, l => ({ ...l, isWorking: true, isWaiting: false, waitMessage: '', turnStartedAt: now, turns: l.turns + 1 }))
    void tmux($, 'work')
    bandTick?.cancel()
    bandTick = $.clock.every(1000, () => {
      frame = (frame + 1) % SPIN.length
      $.ui.invalidate('ui.render')
    })
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const startedAt = await $.clock.now()
    const row: ToolRow = {
      id: e.tool_use_id ?? `${startedAt}-${Math.random()}`,
      tool: String(e.tool),
      label: labelOf(e as { tool: string } & Record<string, unknown>),
      startedAt,
    }
    await update($, live, l => ({ ...l, isWorking: true, isWaiting: false, tools: [...l.tools, row].slice(-MAX_TOOLS) }))
    void tmux($, 'work')
    const ran = await next(e)
    const endedAt = await $.clock.now()
    const isError = ran.deny !== undefined || ran.isError === true
    await update($, live, l => ({ ...l, tools: l.tools.map(t => (t.id === row.id ? { ...t, endedAt, isError } : t)) }))
    if (String(e.tool) === 'Agent') void refreshAgents($)
    return ran
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    void refreshAgents($)
    return spawned
  })

  on('classic.Notification', async ($, e, next) => {
    const kind = e.notification_type ?? ''
    if (/permission|idle|elicitation|input/i.test(kind)) {
      await update($, live, l => ({ ...l, isWaiting: true, waitMessage: e.message ?? '' }))
      void tmux($, 'wait')
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) {
      void refreshAgents($)
      return result
    }
    bandTick?.cancel()
    bandTick = null
    const now = await $.clock.now()
    const l = await read($, live)
    const took = l.turnStartedAt ? now - l.turnStartedAt : 0
    await update($, live, x => ({ ...x, isWorking: false, isWaiting: false, waitMessage: '', lastTurnMs: took }))
    void tmux($, 'done')
    void refreshFacts($)
    void refreshAgents($)
    return result
  })

  on('session.end', async ($, e, next) => {
    factsTick?.cancel()
    bandTick?.cancel()
    return next(e)
  })

  // ───────────────────────── band above prompt ─────────────────────────
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isBandHidden))) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const l = await read($, live)
    const now = await $.clock.now()
    const working = l.isWorking || e.props.isWorking
    const running = l.tools.filter(t => t.endedAt === undefined)
    const liveAgents = l.agents.filter(a => a.status === 'running' || a.status === 'pending' || a.status === 'waiting')
    const turnTools = l.tools.filter(t => t.startedAt >= l.turnStartedAt)
    const done = turnTools.filter(t => t.endedAt !== undefined)
    const failed = done.filter(t => t.isError).length
    const current = running.at(-1)
    if (!l.isWaiting && !(working || running.length > 0 || liveAgents.length > 0)) return next(e)

    // ── row 2: activity (only while working / waiting) ──
    let activity: RenderElement | null = null
    if (l.isWaiting) {
      activity = (
        <Box gap={1}>
          <Text color={C.yellow} bold>
            ⚠ needs you
          </Text>
          <Text color={C.subtext} wrap="truncate-end">
            {l.waitMessage}
          </Text>
        </Box>
      )
    } else {
      activity = (
        <Box gap={1}>
          <Text color={C.peach}>{SPIN[frame]}</Text>
          <Text color={C.subtext}>{secs(now - l.turnStartedAt)}</Text>
          {current ? (
            <Text wrap="truncate-end">
              <Text bold color={C.text}>
                {shortTool(current.tool)}
              </Text>
              {current.label ? <Text color={C.subtext}> {current.label}</Text> : null}
              <Text color={C.overlay}> {secs(now - current.startedAt)}</Text>
            </Text>
          ) : (
            <Text color={C.overlay} italic>
              thinking
            </Text>
          )}
          {running.length > 1 ? <Text color={C.overlay}>+{running.length - 1}</Text> : null}
          <Text color={C.overlay}>│</Text>
          <Text color={C.green}>✓{done.length - failed}</Text>
          {failed ? <Text color={C.red}>✗{failed}</Text> : null}
          {liveAgents.length > 0 ? (
            <Text>
              <Text color={C.overlay}>│ </Text>
              <Text color={C.sky}>
                ◆ {liveAgents.length} agent{liveAgents.length > 1 ? 's' : ''}
              </Text>
            </Text>
          ) : null}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" marginTop={1}>
        {activity}
      </Box>
    )
  })


  // ───────────────────────── hint line under the prompt ─────────────────────────
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const [f, l] = await Promise.all([read($, facts), read($, live)])
    const parts: string[] = []
    if (f.model) parts.push(f.effort ? `${f.model} · ${f.effort}` : f.model)
    if (f.ctxPercent !== null) parts.push(`ctx ${bar(f.ctxPercent, 8)} ${Math.round(f.ctxPercent)}%`)
    if (f.branch) parts.push(` ${f.branch}${f.isDirty ? '*' : ''}`)
    for (const r of f.rates.slice(0, 2)) parts.push(`${rateName(r.kind)} ${Math.round(r.percentUsed)}%`)
    if (f.caveman) parts.push(`[CAVEMAN${f.caveman !== 'full' ? `:${f.caveman.toUpperCase()}` : ''}]`)
    if (!e.props.isWorking && l.lastTurnMs > 0) parts.push(`last ${secs(l.lastTurnMs)}`)
    if (parts.length === 0) return next(e)
    const text = parts.join('  │  ')
    const cols = e.viewport?.columns ?? 0
    // right-align: pad between the engine's hint and ours (row is cut at the edge, so keep 2 cells spare)
    const gap = cols > 0 ? cols - 2 - [...e.props.hint].length - [...text].length : 2
    return next({ ...e, props: { ...e.props, tail: ' '.repeat(Math.max(2, gap)) + text } })
  })

  // ───────────────────────── pane ─────────────────────────
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const [l, f] = await Promise.all([read($, live), read($, facts)])
    const now = await $.clock.now()
    const cols = Math.max(30, e.props.bodyColumns)
    const rows = Math.max(8, e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 24)
    const agentRows = l.agents.filter(a => a.status !== 'completed' && a.status !== 'killed')
    const headRows = 5 + (f.rates.length ? 1 : 0)
    const agentBlock = agentRows.length ? agentRows.length + 2 : 0
    const room = Math.max(3, rows - headRows - agentBlock - 2)
    const recent = l.tools.slice(-room)
    const total = l.tools.length
    const okCount = l.tools.filter(t => t.endedAt !== undefined && !t.isError).length
    const errCount = l.tools.filter(t => t.isError).length
    const uptime = f.sessionStartedAt ? secs(now - f.sessionStartedAt) : ''
    const toolW = 9
    const durW = 6
    const labelW = Math.max(8, cols - 2 - toolW - 1 - durW - 1)
    const ctx = f.ctxPercent

    return (
      <Box flexDirection="column">
        {/* header */}
        <Box gap={1}>
          <Text color={l.isWorking ? C.peach : l.isWaiting ? C.yellow : C.blue}>{l.isWorking ? SPIN[frame] : l.isWaiting ? '⚠' : '●'}</Text>
          <Text bold color={C.text}>
            {l.isWorking ? 'working' : l.isWaiting ? 'waiting' : 'idle'}
          </Text>
          <Text color={C.overlay}>
            {uptime ? `up ${uptime}` : ''} {l.turns ? `· ${l.turns} turns` : ''}
          </Text>
          <Box flexGrow={1} />
          <Button key="clear" plain dimColor label="clear" onPress={() => update($, live, x => ({ ...x, tools: [] }))} />
        </Box>

        {/* context */}
        <Box marginTop={1} flexDirection="column">
          <Box gap={1}>
            <Text color={C.overlay}>{pad('context', 8)}</Text>
            {ctx !== null ? (
              <Text>
                <Text color={pctColor(ctx)}>{bar(ctx, Math.max(8, cols - 24))}</Text>
                <Text color={C.subtext}> {Math.round(ctx)}%</Text>
                {f.ctxTokens !== null && f.ctxWindow ? (
                  <Text color={C.overlay}>
                    {' '}
                    {kTokens(f.ctxTokens)}/{kTokens(f.ctxWindow)}
                  </Text>
                ) : null}
              </Text>
            ) : (
              <Text color={C.overlay}>—</Text>
            )}
          </Box>
          <Box gap={1}>
            <Text color={C.overlay}>{pad('cost', 8)}</Text>
            <Text color={C.green}>{f.usd !== null ? `$${f.usd.toFixed(3)}` : '—'}</Text>
            <Text color={C.overlay}>·</Text>
            <Text color={C.lavender}>{f.model}</Text>
            {f.effort ? <Text color={C.overlay}>{f.effort}</Text> : null}
          </Box>
          {f.rates.length ? (
            <Box gap={1}>
              <Text color={C.overlay}>{pad('limits', 8)}</Text>
              <Text>
                {f.rates.map((r, i) => (
                  <Text key={r.kind}>
                    {i ? <Text color={C.overlay}> · </Text> : null}
                    <Text color={C.subtext}>{rateName(r.kind)} </Text>
                    <Text color={pctColor(r.percentUsed)}>{Math.round(r.percentUsed)}%</Text>
                    {resetIn(r.resetsAt, now) ? <Text color={C.overlay}> ↻{resetIn(r.resetsAt, now)}</Text> : null}
                  </Text>
                ))}
              </Text>
            </Box>
          ) : null}
        </Box>

        {/* agents */}
        {agentRows.length > 0 ? (
          <Box flexDirection="column" marginTop={1}>
            <Text color={C.sky} bold>
              ◆ agents <Text color={C.overlay}>{agentRows.length}</Text>
            </Text>
            {agentRows.map(a => (
              <Text key={a.id} wrap="truncate-end">
                <Text color={a.status === 'running' ? C.sky : a.status === 'failed' ? C.red : C.yellow}>
                  {a.status === 'running' ? SPIN[frame] : a.status === 'failed' ? '✗' : '○'}
                </Text>{' '}
                <Text color={C.text}>{pad(a.type, 12)}</Text>
                <Text color={C.subtext}>{a.description}</Text>
              </Text>
            ))}
          </Box>
        ) : null}

        {/* tools */}
        <Box marginTop={1} gap={1}>
          <Text color={C.mauve} bold>
            ▪ tools
          </Text>
          <Text color={C.overlay}>{total}</Text>
          <Text color={C.green}>✓{okCount}</Text>
          {errCount ? <Text color={C.red}>✗{errCount}</Text> : null}
          <Box flexGrow={1} />
          {total > recent.length ? <Text color={C.overlay}>last {recent.length}</Text> : null}
        </Box>
        <Box flexDirection="column">
          {recent.length === 0 ? (
            <Text color={C.overlay} italic>
              nothing yet
            </Text>
          ) : null}
          {recent.map(t => {
            const isRunning = t.endedAt === undefined
            const dur = secs((t.endedAt ?? now) - t.startedAt)
            return (
              <Box key={t.id} gap={1}>
                <Text color={toolColor(t)}>{toolIcon(t, frame)}</Text>
                <Text bold={isRunning} color={isRunning ? C.text : C.subtext}>
                  {pad(shortTool(t.tool), toolW)}
                </Text>
                <Box width={labelW}>
                  <Text color={isRunning ? C.text : C.overlay} wrap="truncate-end">
                    {t.label || ' '}
                  </Text>
                </Box>
                <Box width={durW} justifyContent="flex-end">
                  <Text color={isRunning ? C.yellow : C.overlay}>{dur}</Text>
                </Box>
              </Box>
            )
          })}
        </Box>
      </Box>
    )
  })
}
