import { afterEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { TranscriptParser, isClosedTranscript, type TranscriptParserDelegate } from './transcript-parser'
import type { WatchedSession } from './protocol'

const SESSION_ID = 'session-1'

function createSession(): WatchedSession {
  return {
    sessionId: SESSION_ID,
    label: 'Session session-',
    labelSet: false,
    model: null,
    pendingToolCalls: new Map(),
    seenToolUseIds: new Set(),
    seenMessageHashes: new Set(),
    spawnedSubagents: new Set(),
    contextBreakdown: { systemPrompt: 0, userMessages: 0, toolResults: 0, reasoning: 0, subagentResults: 0 },
  } as unknown as WatchedSession
}

function createParser(session: WatchedSession) {
  const delegate: TranscriptParserDelegate = {
    emit: vi.fn(),
    elapsed: () => 0,
    getSession: (sessionId) => sessionId === SESSION_ID ? session : undefined,
    fireSessionLifecycle: vi.fn(),
    emitContextUpdate: vi.fn(),
  }
  return { parser: new TranscriptParser(delegate), delegate }
}

const userLine = JSON.stringify({ type: 'user', sessionId: SESSION_ID, message: { role: 'user', content: 'Vamos a mejorar la app' } })
const titleLine = JSON.stringify({ type: 'ai-title', aiTitle: 'Mejoras de experiencia de usuario', sessionId: SESSION_ID })
const skillText = '<command-message>sync-repos</command-message>\n<command-name>/sync-repos</command-name>'
const skillLine = JSON.stringify({ type: 'user', sessionId: SESSION_ID, message: { role: 'user', content: skillText } })

describe('TranscriptParser session title', () => {
  let tempDir: string | null = null

  afterEach(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true })
    tempDir = null
  })

  it.each([userLine, skillLine])('labels an existing session with its ai-title instead of the first user message (initial entry: %#)', (initialLine) => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-flow-parser-'))
    const filePath = path.join(tempDir, `${SESSION_ID}.jsonl`)
    fs.writeFileSync(filePath, `${initialLine}\n${titleLine}\n`)
    const session = createSession()
    const { parser } = createParser(session)

    const entries = parser.prescanExistingContent(filePath, fs.statSync(filePath).size, session)
    parser.extractSessionLabel(entries, session)

    expect(session.label).toBe('Mejoras de experiencia de usuario')
  })

  it.each([userLine, skillLine])('relabels a live session when its ai-title arrives (initial entry: %#)', (initialLine) => {
    const session = createSession()
    const { parser, delegate } = createParser(session)

    parser.processTranscriptLine(initialLine, 'orchestrator', session.pendingToolCalls, session.seenToolUseIds, SESSION_ID, session.seenMessageHashes)
    parser.processTranscriptLine(titleLine, 'orchestrator', session.pendingToolCalls, session.seenToolUseIds, SESSION_ID, session.seenMessageHashes)
    parser.processTranscriptLine(userLine, 'orchestrator', session.pendingToolCalls, session.seenToolUseIds, SESSION_ID, session.seenMessageHashes)

    expect(delegate.fireSessionLifecycle).toHaveBeenLastCalledWith({ type: 'updated', sessionId: SESSION_ID, label: 'Mejoras de experiencia de usuario' })
  })

  it.each([
    { format: 'string', content: skillText },
    { format: 'text blocks', content: [{ type: 'text', text: skillText }] },
    { format: 'command name only', content: '<command-name>/sync-repos</command-name>\n<command-args>all</command-args>' },
  ])('uses a clean skill name for live and existing sessions with $format', ({ content }) => {
    const line = JSON.stringify({ type: 'user', sessionId: SESSION_ID, message: { role: 'user', content } })
    const liveSession = createSession()
    const { parser: liveParser, delegate } = createParser(liveSession)
    liveParser.processTranscriptLine(line, 'orchestrator', liveSession.pendingToolCalls, liveSession.seenToolUseIds, SESSION_ID, liveSession.seenMessageHashes)

    expect(liveSession.label).toBe('sync-repos')
    expect(delegate.fireSessionLifecycle).toHaveBeenLastCalledWith({ type: 'updated', sessionId: SESSION_ID, label: 'sync-repos' })

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-flow-parser-'))
    const filePath = path.join(tempDir, `${SESSION_ID}.jsonl`)
    fs.writeFileSync(filePath, `${line}\n`)
    const existingSession = createSession()
    const { parser: existingParser } = createParser(existingSession)
    const entries = existingParser.prescanExistingContent(filePath, fs.statSync(filePath).size, existingSession)
    existingParser.extractSessionLabel(entries, existingSession)

    expect(existingSession.label).toBe('sync-repos')
  })

  it('does not use injected skill instructions as the session title', () => {
    const metaLine = JSON.stringify({ type: 'user', sessionId: SESSION_ID, isMeta: true, message: { role: 'user', content: 'Base directory for this skill: /skills/sync-repos\nSkill instructions' } })
    const session = createSession()
    const { parser, delegate } = createParser(session)
    parser.processTranscriptLine(metaLine, 'orchestrator', session.pendingToolCalls, session.seenToolUseIds, SESSION_ID, session.seenMessageHashes)

    expect(session.labelSet).toBe(false)
    expect(delegate.fireSessionLifecycle).not.toHaveBeenCalled()

    parser.extractSessionLabel([JSON.parse(metaLine), JSON.parse(skillLine)], session)

    expect(session.label).toBe('sync-repos')
  })
})

describe('isClosedTranscript', () => {
  const costStateLine = JSON.stringify({ type: 'cost-state', sessionId: SESSION_ID, totalCostUSD: 0.01 })
  const assistantLine = JSON.stringify({ type: 'assistant', sessionId: SESSION_ID, message: { role: 'assistant', content: [{ type: 'text', text: 'Listo' }] } })
  let tempDir: string | null = null

  afterEach(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true })
    tempDir = null
  })

  function writeTranscript(lines: string[]): string {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-flow-closed-'))
    const filePath = path.join(tempDir, `${SESSION_ID}.jsonl`)
    fs.writeFileSync(filePath, `${lines.join('\n')}\n`)
    return filePath
  }

  it('treats metadata written after the exit cost-state as still closed', () => {
    const filePath = writeTranscript([userLine, assistantLine, costStateLine, titleLine])

    expect(isClosedTranscript(filePath)).toBe(true)
  })

  it('treats a transcript resumed after its cost-state as live', () => {
    const filePath = writeTranscript([userLine, assistantLine, costStateLine, userLine, assistantLine])

    expect(isClosedTranscript(filePath)).toBe(false)
  })
})
