import { agentProvider, type AgentProvider } from './agent-provider'
import type { AgentEvent } from './protocol'

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** Tokenize shell command boundaries without treating quoted prompts as commands.
 * This only inspects text; it never executes or expands shell syntax. */
function shellCommands(command: string): string[][] {
  const commands: string[][] = []
  let words: string[] = [], word = '', quote = ''
  const endWord = () => { if (word) words.push(word); word = '' }
  for (let i = 0; i < command.length; i++) {
    const char = command[i]
    if (char === '\\' && quote !== "'") {
      if (command[i + 1] !== '\n') word += command[i + 1] ?? ''
      i++
    } else if (quote) {
      if (char === quote) quote = ''; else word += char
    } else if (char === '"' || char === "'" || char === '`') {
      quote = char
    } else if (char === '<' && command[i + 1] === '<') {
      // Heredoc bodies are data. Do not search them for executable names.
      break
    } else if (char === '#' && !word) {
      while (i < command.length && command[i] !== '\n') i++
      endWord(); commands.push(words); words = []
    } else if (';\n&|'.includes(char)) {
      endWord(); commands.push(words); words = []
    } else if (/\s/.test(char)) {
      endWord()
    } else {
      word += char
    }
  }
  endWord(); commands.push(words)
  return commands
}

interface Delegation {
  name: string
  parent: string
  task: string
  provider?: AgentProvider
  model?: string
  async: boolean
  complete: boolean
  summary?: string
}

function describe(tool: string, input: Record<string, unknown>, fallback: AgentProvider): Omit<Delegation, 'name' | 'parent' | 'complete'> & { title: string } | undefined {
  if (tool.endsWith('delegate_task') || tool.endsWith('spawn_agent')) {
    const target = record(input.target)
    const model = typeof target.model === 'string' ? target.model : typeof input.model === 'string' ? input.model : undefined
    const provider = agentProvider(model, target.providerInstanceId ?? target.provider ?? input.provider)
      ?? (tool.endsWith('spawn_agent') ? fallback : undefined)
    const title = String(input.title ?? input.task_name ?? input.name ?? 'Delegated agent')
    return { title, task: String(input.task ?? input.message ?? title), provider, model, async: true }
  }
  if (tool !== 'Bash' && !tool.endsWith('exec_command') && tool !== 'shell_command') return undefined
  const command = input.command ?? input.cmd
  if (typeof command !== 'string') return undefined
  for (const words of shellCommands(command)) {
    let index = 0
    while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index] ?? '') || ['env', 'command'].includes(words[index])) index++
    const executable = words[index]?.split('/').pop()
    const provider = executable === 'codex' && words[index + 1] === 'exec' ? 'codex'
      : executable === 'claude' && words.slice(index + 1).some(word => word === '-p' || word === '--print') ? 'claude' : undefined
    if (!provider) continue
    const args = words.slice(index + 1)
    const modelIndex = args.findIndex(word => word === '-m' || word === '--model')
    const model = modelIndex >= 0 ? args[modelIndex + 1] : args.find(word => word.startsWith('--model='))?.slice(8)
    const title = typeof input.description === 'string' ? input.description : provider === 'codex' ? 'GPT reviewer' : 'Claude reviewer'
    return { title, task: title, model, provider, async: input.run_in_background === true }
  }
  return undefined
}

/** Per-session cross-provider delegations, including ephemeral CLI reviewers.
 * Provider identity comes from the invocation/result, never from the skill name. */
export class DelegationTracker {
  private readonly children = new Map<string, Delegation>()
  private readonly aliases = new Map<string, string>()
  private muted = false

  constructor(private readonly delegate: { emit(event: AgentEvent): void; elapsed(): number }, private readonly fallback: AgentProvider) {}

  start(callId: string, tool: string, input: Record<string, unknown>, parent: string): void {
    if (this.children.has(callId)) return
    const info = describe(tool, input, this.fallback)
    if (!info) return
    const child: Delegation = { ...info, name: `${info.title.slice(0, 50)} · ${callId.slice(-8)}`, parent, complete: false }
    this.children.set(callId, child)
    for (const event of this.spawnEvents(child)) this.emit(event)
  }

  result(callId: string, output: unknown, isError = false): void {
    const child = this.children.get(callId)
    const data = this.resultData(output)
    if (child) {
      for (const id of [data.taskId, data.agent_id, data.id, data.session_id]) {
        if (typeof id === 'string') this.aliases.set(id, callId)
      }
      const text = typeof output === 'string' ? output : JSON.stringify(output) ?? ''
      const backgroundId = text.match(/(?:background.*?\bID|session ID|task[_ -]id)[:\s]+([\w-]+)/i)?.[1]
      if (backgroundId) { this.aliases.set(backgroundId, callId); child.async = true }
      const provider = agentProvider(data.model, data.providerInstanceId ?? data.provider)
      if (provider) child.provider = provider
      if (typeof data.model === 'string') child.model = data.model
      if (provider || typeof data.model === 'string') {
        this.emit({ time: this.delegate.elapsed(), type: 'model_detected', payload: { agent: child.name, provider: child.provider, model: child.model } })
      }
      if (isError || (!child.async && data.status !== 'running')) this.finish(callId, isError ? 'Failed' : 'Done')
    }
    const id = typeof data.taskId === 'string' ? data.taskId : typeof data.agent_id === 'string' ? data.agent_id : typeof data.id === 'string' ? data.id : undefined
    const targetId = child ? callId : id ? this.aliases.get(id) : undefined
    if (targetId && /^(?:completed|complete|succeeded|failed|cancelled|canceled|interrupted|error)$/.test(String(data.status))) {
      this.finish(targetId, String(data.summary ?? data.status))
    }
  }

  observeText(text: string): void {
    if (!text.startsWith('<task-notification>')) return
    const callId = text.match(/<tool-use-id>([^<]+)<\/tool-use-id>/)?.[1]
    const taskId = text.match(/<task-id>([^<]+)<\/task-id>/)?.[1]
    const id = callId && this.children.has(callId) ? callId : taskId ? this.aliases.get(taskId) : undefined
    const status = text.match(/<status>([^<]+)<\/status>/)?.[1]
    if (id && status && /completed|failed|killed|cancelled/.test(status)) this.finish(id, status)
  }

  silently(work: () => void): void {
    const previous = this.muted
    this.muted = true
    try { work() } finally { this.muted = previous }
  }

  replayEvents(): AgentEvent[] {
    return Array.from(this.children.values()).flatMap(child => [
      ...this.spawnEvents(child),
      ...(child.complete ? this.completionEvents(child) : []),
    ])
  }

  private resultData(output: unknown, depth = 0): Record<string, unknown> {
    if (depth > 4) return {}
    if (typeof output === 'string') {
      try { return this.resultData(JSON.parse(output), depth + 1) } catch { return {} }
    }
    if (Array.isArray(output)) {
      for (const block of output) {
        const data = this.resultData(record(block).text, depth + 1)
        if (Object.keys(data).length) return data
      }
      return {}
    }
    const data = record(output)
    if (data.structuredContent) return this.resultData(data.structuredContent, depth + 1)
    if (data.content) return this.resultData(data.content, depth + 1)
    return data
  }

  private finish(callId: string, summary: string): void {
    const child = this.children.get(callId)
    if (!child || child.complete) return
    child.complete = true
    child.summary = summary.slice(0, 200)
    for (const event of this.completionEvents(child)) this.emit(event)
  }

  private spawnEvents(child: Delegation): AgentEvent[] {
    const time = this.delegate.elapsed()
    return [
      { time, type: 'subagent_dispatch', payload: { parent: child.parent, child: child.name, task: child.task.slice(0, 2000) } },
      { time, type: 'agent_spawn', payload: { name: child.name, parent: child.parent, task: child.task.slice(0, 2000), provider: child.provider, model: child.model } },
    ]
  }

  private completionEvents(child: Delegation): AgentEvent[] {
    const time = this.delegate.elapsed()
    return [
      { time, type: 'subagent_return', payload: { parent: child.parent, child: child.name, summary: child.summary } },
      { time, type: 'agent_complete', payload: { name: child.name } },
    ]
  }

  private emit(event: AgentEvent): void {
    if (!this.muted) this.delegate.emit(event)
  }
}
