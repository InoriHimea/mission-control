import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRole = vi.fn()
const getDatabase = vi.fn()
const runOpenClaw = vi.fn()
const mutationLimiter = vi.fn(() => null)
const validateBody = vi.fn()
const scanForInjection = vi.fn(() => ({ safe: true, matches: [] }))
const scanForSecrets = vi.fn(() => [])
const createNotification = vi.fn()
const logActivity = vi.fn()
const updateAgentStatus = vi.fn()
const getTaskSubscribers = vi.fn()

vi.mock('@/lib/auth', () => ({ requireRole }))
vi.mock('@/lib/command', () => ({ runOpenClaw }))
vi.mock('@/lib/db', () => ({
  getDatabase,
  db_helpers: { createNotification, logActivity, updateAgentStatus, getTaskSubscribers },
}))
vi.mock('@/lib/rate-limit', () => ({ mutationLimiter }))
vi.mock('@/lib/validation', () => ({
  createMessageSchema: {},
  validateBody,
}))
vi.mock('@/lib/injection-guard', () => ({ scanForInjection }))
vi.mock('@/lib/secret-scanner', () => ({ scanForSecrets }))
vi.mock('@/lib/security-events', () => ({ logSecurityEvent: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

describe('OpenClaw session transport guard', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    requireRole.mockReturnValue({ user: { username: 'operator', display_name: 'Operator', workspace_id: 1 } })
    mutationLimiter.mockReturnValue(null)
    validateBody.mockResolvedValue({ data: { to: 'target', message: 'hello' } })
    scanForInjection.mockReturnValue({ safe: true, matches: [] })
    scanForSecrets.mockReturnValue([])
    runOpenClaw.mockResolvedValue({ stdout: 'sent\n', stderr: '' })
  })

  it.each(['hermes', 'claude', 'codex', 'opencode', 'custom', 'future-runtime', null, undefined])(
    'fails closed for runtime_type=%s',
    async (runtime_type) => {
      const { getOpenClawSessionTransportError } = await import('@/lib/agent-providers')

      expect(getOpenClawSessionTransportError({ id: 4, name: 'target', runtime_type })).toEqual({
        error: 'AGENT_TRANSPORT_UNAVAILABLE',
        detail: `Agent "target" cannot use OpenClaw session transport because runtime_type is "${runtime_type || 'custom'}".`,
        agent_runtime: runtime_type || 'custom',
      })
      expect(runOpenClaw).not.toHaveBeenCalled()
    },
  )

  it('accepts only an explicit openclaw runtime marker', async () => {
    const { getOpenClawSessionTransportError } = await import('@/lib/agent-providers')

    expect(getOpenClawSessionTransportError({ id: 4, name: 'target', runtime_type: 'openclaw' })).toBeNull()
  })

  it('rejects direct messages without calling sessions_send', async () => {
    const agent = { id: 4, name: 'target', runtime_type: 'hermes', session_key: 'session-1' }
    getDatabase.mockReturnValue({ prepare: vi.fn(() => ({ get: vi.fn(() => agent) })) })
    const { POST } = await import('@/app/api/agents/message/route')

    const response = await POST(new NextRequest('http://localhost/api/agents/message', { method: 'POST' }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'AGENT_TRANSPORT_UNAVAILABLE',
      detail: 'Agent "target" cannot use OpenClaw session transport because runtime_type is "hermes".',
      agent_runtime: 'hermes',
    })
    expect(runOpenClaw).not.toHaveBeenCalled()
    expect(createNotification).not.toHaveBeenCalled()
    expect(logActivity).not.toHaveBeenCalled()
  })

  it('keeps the direct-message transport and notification behavior for openclaw agents', async () => {
    const agent = { id: 4, name: 'target', runtime_type: 'openclaw', session_key: 'session-1' }
    getDatabase.mockReturnValue({ prepare: vi.fn(() => ({ get: vi.fn(() => agent) })) })
    const { POST } = await import('@/app/api/agents/message/route')

    const response = await POST(new NextRequest('http://localhost/api/agents/message', { method: 'POST' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true })
    expect(runOpenClaw).toHaveBeenCalledWith(
      ['gateway', 'sessions_send', '--session', 'session-1', '--message', 'Message from Operator: hello'],
      { timeoutMs: 10000 },
    )
    expect(createNotification).toHaveBeenCalledWith('target', 'message', 'Direct Message', 'Operator: hello', 'agent', 4, 1)
    expect(logActivity).toHaveBeenCalled()
  })

  it('rejects wake requests before calling sessions_send or changing status', async () => {
    const agent = { id: 4, name: 'target', runtime_type: 'codex', session_key: 'session-1' }
    getDatabase.mockReturnValue({ prepare: vi.fn(() => ({ get: vi.fn(() => agent) })) })
    const { POST } = await import('@/app/api/agents/[id]/wake/route')

    const response = await POST(
      new NextRequest('http://localhost/api/agents/4/wake', { method: 'POST' }),
      { params: Promise.resolve({ id: '4' }) },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: 'AGENT_TRANSPORT_UNAVAILABLE',
      agent_runtime: 'codex',
    })
    expect(runOpenClaw).not.toHaveBeenCalled()
    expect(updateAgentStatus).not.toHaveBeenCalled()
  })

  it('broadcasts only to explicit openclaw subscribers and preserves the aggregate response', async () => {
    const task = { id: 7, title: 'Guard task' }
    const agents = [
      { name: 'openclaw-agent', runtime_type: 'openclaw', session_key: 'openclaw-session' },
      { name: 'opencode-agent', runtime_type: 'opencode', session_key: 'opencode-session' },
      { name: 'unknown-agent', runtime_type: 'future-runtime', session_key: 'unknown-session' },
    ]
    getTaskSubscribers.mockReturnValue(['openclaw-agent', 'opencode-agent', 'unknown-agent'])
    getDatabase.mockReturnValue({
      prepare: vi.fn((sql: string) => {
        if (sql.startsWith('SELECT * FROM tasks')) return { get: vi.fn(() => task) }
        if (sql.startsWith('SELECT name, session_key, runtime_type FROM agents')) return { all: vi.fn(() => agents) }
        throw new Error(`Unexpected SQL: ${sql}`)
      }),
    })
    const { POST } = await import('@/app/api/tasks/[id]/broadcast/route')

    const response = await POST(
      new NextRequest('http://localhost/api/tasks/7/broadcast', {
        method: 'POST',
        body: JSON.stringify({ message: 'hello team' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: '7' }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ sent: 1, skipped: 2 })
    expect(runOpenClaw).toHaveBeenCalledTimes(1)
    expect(runOpenClaw).toHaveBeenCalledWith(
      ['gateway', 'sessions_send', '--session', 'openclaw-session', '--message', '[Task 7] Guard task\nFrom Operator: hello team'],
      { timeoutMs: 10000 },
    )
    expect(createNotification).toHaveBeenCalledTimes(1)
    expect(createNotification).toHaveBeenCalledWith(
      'openclaw-agent', 'message', 'Task Broadcast', 'Operator broadcasted a message on "Guard task": hello team', 'task', 7, 1,
    )
    expect(logActivity).toHaveBeenCalledWith(
      'task_broadcast', 'task', 7, 'Operator', 'Broadcasted message to 1 subscribers', { sent: 1, skipped: 2 }, 1,
    )
  })
})
