import { afterEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { TranscriptParser, type TranscriptParserDelegate } from './transcript-parser'
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

describe('TranscriptParser session title', () => {
  let tempDir: string | null = null

  afterEach(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true })
    tempDir = null
  })

  it('labels an existing session with its ai-title instead of the first user message', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-flow-parser-'))
    const filePath = path.join(tempDir, `${SESSION_ID}.jsonl`)
    fs.writeFileSync(filePath, `${userLine}\n${titleLine}\n`)
    const session = createSession()
    const { parser } = createParser(session)

    const entries = parser.prescanExistingContent(filePath, fs.statSync(filePath).size, session)
    parser.extractSessionLabel(entries, session)

    expect(session.label).toBe('Mejoras de experiencia de usuario')
  })

  it('relabels a live session when its ai-title arrives', () => {
    const session = createSession()
    const { parser, delegate } = createParser(session)

    parser.processTranscriptLine(userLine, 'orchestrator', session.pendingToolCalls, session.seenToolUseIds, SESSION_ID, session.seenMessageHashes)
    parser.processTranscriptLine(titleLine, 'orchestrator', session.pendingToolCalls, session.seenToolUseIds, SESSION_ID, session.seenMessageHashes)

    expect(delegate.fireSessionLifecycle).toHaveBeenLastCalledWith({ type: 'updated', sessionId: SESSION_ID, label: 'Mejoras de experiencia de usuario' })
  })
})
