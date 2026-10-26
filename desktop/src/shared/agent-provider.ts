export type AgentProvider = 'claude' | 'codex'

export function agentProvider(model: unknown, provider?: unknown): AgentProvider | undefined {
  if (typeof provider === 'string') {
    if (/claude|anthropic/i.test(provider)) return 'claude'
    if (/codex|openai|gpt/i.test(provider)) return 'codex'
  }
  if (typeof model !== 'string') return undefined
  if (/claude|^(?:sonnet|opus|haiku)(?:[-.]|$)/i.test(model)) return 'claude'
  if (/gpt|codex|^o\d/i.test(model)) return 'codex'
  return undefined
}
