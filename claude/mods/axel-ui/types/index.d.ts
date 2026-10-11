export type ToolRow = { id: string; tool: string; label: string; startedAt: number; endedAt?: number; isError?: boolean }
export type AgentRow = { id: string; description: string; type: string; status: string }
export type RateRow = { kind: string; percentUsed: number; resetsAt?: string }
export type Facts = {
  model: string
  effort: string
  caveman: string | null
  branch: string | null
  isDirty: boolean
  ctxPercent: number | null
  ctxTokens: number | null
  ctxWindow: number | null
  usd: number | null
  rates: RateRow[]
  sessionStartedAt: number
}
export type Live = {
  isWorking: boolean
  isWaiting: boolean
  waitMessage: string
  turnStartedAt: number
  lastTurnMs: number
  turns: number
  tools: ToolRow[]
  agents: AgentRow[]
}

declare module 'claude-code' {
  interface PluginState {
    'axel-ui': { live: Live; facts: Facts; isBandHidden: boolean }
  }
}
