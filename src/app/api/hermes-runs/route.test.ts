import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { fetchMock, requireRoleMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  requireRoleMock: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireRole: requireRoleMock }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }))

const realFetch = global.fetch
const originalRunsUrl = process.env.HERMES_RUNS_URL
const originalApiKey = process.env.HERMES_API_KEY
const viewer = { user: { id: 7, username: 'viewer', role: 'viewer' } }

function request(query: string) {
  return new NextRequest(`http://localhost/api/hermes-runs?${query}`)
}

describe('Hermes runs route transport', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.HERMES_RUNS_URL = 'https://hermes.example'
    process.env.HERMES_API_KEY = 'test-key'
    requireRoleMock.mockReturnValue(viewer)
    global.fetch = fetchMock
  })

  afterEach(() => {
    global.fetch = realFetch
    if (originalRunsUrl === undefined) delete process.env.HERMES_RUNS_URL
    else process.env.HERMES_RUNS_URL = originalRunsUrl
    if (originalApiKey === undefined) delete process.env.HERMES_API_KEY
    else process.env.HERMES_API_KEY = originalApiKey
  })

  it('requests an event stream from the Hermes events endpoint', async () => {
    fetchMock.mockResolvedValue(new Response('data: {"status":"running"}\n\n', { status: 200 }))
    const { GET } = await import('@/app/api/hermes-runs/route')

    await GET(request('run_id=run_123&events=1'))

    expect(fetchMock).toHaveBeenCalledWith(
      'https://hermes.example/v1/runs/run_123/events',
      expect.objectContaining({ headers: expect.objectContaining({ Accept: 'text/event-stream' }) }),
    )
  })

  it('requests JSON from the Hermes run endpoint by default', async () => {
    fetchMock.mockResolvedValue(new Response('{"status":"completed"}', { status: 200 }))
    const { GET } = await import('@/app/api/hermes-runs/route')

    await GET(request('run_id=run_123'))

    expect(fetchMock).toHaveBeenCalledWith(
      'https://hermes.example/v1/runs/run_123',
      expect.objectContaining({ headers: expect.objectContaining({ Accept: 'application/json' }) }),
    )
  })

  it('returns successful JSON payloads as JSON', async () => {
    fetchMock.mockResolvedValue(new Response('{"status":"completed"}', { status: 200 }))
    const { GET } = await import('@/app/api/hermes-runs/route')

    const response = await GET(request('run_id=run_123'))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    await expect(response.json()).resolves.toEqual({ status: 'completed' })
  })

  it('returns successful non-JSON event payloads as SSE text', async () => {
    const payload = 'data: {"status":"running"}\n\n'
    fetchMock.mockResolvedValue(new Response(payload, { status: 200 }))
    const { GET } = await import('@/app/api/hermes-runs/route')

    const response = await GET(request('run_id=run_123&events=1'))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream;charset=utf-8')
    await expect(response.text()).resolves.toBe(payload)
  })

  it('maps an upstream 401 to 502 without reflecting its sensitive body', async () => {
    const sensitiveBody = 'SENSITIVE_GATEWAY_RESPONSE'
    fetchMock.mockResolvedValue(new Response(sensitiveBody, { status: 401 }))
    const { GET } = await import('@/app/api/hermes-runs/route')

    const response = await GET(request('run_id=run_123'))
    const body = await response.text()

    expect(response.status).toBe(502)
    expect(body).not.toContain(sensitiveBody)
    expect(body).toContain('Hermes gateway returned 401')
  })

  it.each(['', 'run_id=bad%20id', 'run_id=bad%2Fid'])(
    'rejects missing or invalid run_id %j without contacting Hermes',
    async (query) => {
      const { GET } = await import('@/app/api/hermes-runs/route')

      const response = await GET(request(query))

      expect(response.status).toBe(400)
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )
})
