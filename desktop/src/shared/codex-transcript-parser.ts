import * as path from 'path'
import type { AgentEvent } from './protocol'
import { ARGS_MAX, MESSAGE_MAX, ORCHESTRATOR_NAME } from './constants'
import { summarizeResult } from './tool-summarizer'
import { DelegationTracker } from './delegation-tracker'

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function textContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value.map(block => {
    const text = record(block).text
    return typeof text === 'string' ? text : ''
  }).filter(Boolean).join('\n')
}

/** Reads Codex rollout records, using response_item as the canonical message/tool source.
 * event_msg mirrors those records, so only lifecycle and usage are read from it. */
export class CodexTranscriptParser {
  label = 'Codex session'
  model: string | undefined
  private labelSet = false
  private readonly pendingTools = new Map<string, string>()
  private readonly directInvocations = new Map<string, { tool: string; input: Record<string, unknown> }>()
  private readonly seenItems = new Set<string>()
  private readonly delegations: DelegationTracker

  constructor(private readonly delegate: {
    emit(event: AgentEvent): void
    elapsed(): number
    onLabel(label: string): void
    onTurnState(active: boolean): void
  }) {
    this.delegations = new DelegationTracker(delegate, 'codex')
  }

  processLine(line: string): void {
    let entry: Record<string, unknown>
    try { entry = record(JSON.parse(line)) } catch { return }
    const payload = record(entry.payload)

    if (entry.type === 'session_meta') {
      if (!this.labelSet && typeof payload.cwd === 'string') {
        this.label = path.basename(payload.cwd) || 'Codex session'
        this.delegate.onLabel(this.label)
      }
    } else if (entry.type === 'turn_context') {
      if (typeof payload.model === 'string' && payload.model !== this.model) {
        this.model = payload.model
        this.emit('model_detected', { agent: ORCHESTRATOR_NAME, model: this.model })
      }
    } else if (entry.type === 'response_item') {
      this.processItem(payload)
    } else if (entry.type === 'event_msg') {
      if (payload.type === 'item_started' || payload.type === 'item_completed') {
        this.processExecutionItem(record(payload.item), payload.type === 'item_completed')
      }
      switch (payload.type) {
        case 'task_started':
        case 'turn_started':
          this.delegate.onTurnState(true)
          break
        case 'task_complete':
        case 'turn_complete':
        case 'turn_aborted':
          this.pendingTools.clear()
          this.directInvocations.clear()
          this.delegate.onTurnState(false)
          break
        case 'token_count': {
          // The last request reflects current context; total usage accumulates across turns.
          const usage = record(record(payload.info).last_token_usage)
          if (typeof usage.total_tokens === 'number') {
            this.emit('context_update', { agent: ORCHESTRATOR_NAME, tokens: usage.total_tokens })
          }
          break
        }
      }
    }
  }

  private processItem(item: Record<string, unknown>): void {
    const type = item.type
    const id = typeof item.id === 'string' ? item.id : undefined
    const callId = typeof item.call_id === 'string' ? item.call_id : undefined
    const key = id ?? (callId ? `${type}:${callId}` : undefined)
    if (key && this.seenItems.has(key)) return
    if (key) this.seenItems.add(key)

    if (type === 'message' && (item.role === 'user' || item.role === 'assistant')) {
      const content = textContent(item.content).trim()
      if (!content) return
      this.delegations.observeText(content)
      // Codex records injected environment/repository instructions as user messages too.
      if (item.role === 'user' && /^(?:<environment_context>|<permissions instructions>|<collaboration_mode>|# AGENTS\.md instructions|<INSTRUCTIONS>)/.test(content)) return
      this.delegate.onTurnState(true)
      if (item.role === 'user') {
        if (!this.labelSet) {
          this.label = content.split('\n')[0].trim()
          this.labelSet = true
          this.delegate.onLabel(this.label)
        }
      }
      this.emit('message', { agent: ORCHESTRATOR_NAME, role: item.role, content: content.slice(0, MESSAGE_MAX) })
    } else if (type === 'reasoning') {
      const content = textContent(item.summary)
      if (content) {
        this.delegate.onTurnState(true)
        this.emit('message', { agent: ORCHESTRATOR_NAME, role: 'thinking', content: content.slice(0, MESSAGE_MAX) })
      }
    } else if ((type === 'function_call' || type === 'custom_tool_call') && callId && typeof item.name === 'string') {
      if (this.pendingTools.has(callId)) return
      this.delegate.onTurnState(true)
      this.pendingTools.set(callId, item.name)
      const rawInput = item.arguments ?? item.input
      let input: Record<string, unknown> = {}
      if (typeof rawInput === 'string') {
        try { input = record(JSON.parse(rawInput)) } catch { /* custom tools accept plain text */ }
      } else input = record(rawInput)
      this.directInvocations.set(callId, { tool: item.name, input })
      this.delegations.start(callId, item.name, input, ORCHESTRATOR_NAME)
      const args = typeof input.cmd === 'string' ? input.cmd
        : typeof input.command === 'string' ? input.command
        : typeof rawInput === 'string' ? rawInput : ''
      this.emit('tool_call_start', {
        agent: ORCHESTRATOR_NAME, tool: item.name, toolUseId: callId,
        args: args.slice(0, ARGS_MAX),
        inputData: { command: args.slice(0, MESSAGE_MAX) },
      })
    } else if ((type === 'function_call_output' || type === 'custom_tool_call_output') && callId) {
      this.delegations.result(callId, item.output)
      const tool = this.pendingTools.get(callId)
      if (!tool) return
      this.pendingTools.delete(callId)
      this.directInvocations.delete(callId)
      const result = summarizeResult(item.output)
      this.emit('tool_call_end', { agent: ORCHESTRATOR_NAME, tool, toolUseId: callId, result })
    }
  }

  private processExecutionItem(item: Record<string, unknown>, completed: boolean): void {
    if (typeof item.id !== 'string') return
    if (item.type === 'McpToolCall' && typeof item.tool === 'string') {
      if (Array.from(this.directInvocations.values()).some(invocation => invocation.tool.endsWith(String(item.tool))
        && JSON.stringify(invocation.input) === JSON.stringify(record(item.arguments)))) return
      // Code-mode tools also appear here with their actual arguments/results.
      this.delegations.start(item.id, item.tool, record(item.arguments), ORCHESTRATOR_NAME)
      if (completed) this.delegations.result(item.id, item.result, record(item.result).isError === true)
    } else if (item.type === 'CommandExecution') {
      const command = Array.isArray(item.command)
        ? /(?:ba|z|da)?sh$/.test(String(item.command[0])) ? item.command.at(-1)
          : item.command.map(word => JSON.stringify(word)).join(' ')
        : item.command
      if (Array.from(this.directInvocations.values()).some(invocation => (invocation.input.cmd ?? invocation.input.command) === command)) return
      this.delegations.start(item.id, 'exec_command', { command }, ORCHESTRATOR_NAME)
      if (completed) this.delegations.result(item.id, { status: item.status }, typeof item.exit_code === 'number' && item.exit_code !== 0)
    }
  }

  private emit(type: AgentEvent['type'], payload: AgentEvent['payload']): void {
    this.delegate.emit({ time: this.delegate.elapsed(), type, payload })
  }
}
