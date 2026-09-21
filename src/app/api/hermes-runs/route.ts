import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

/**
 * GET /api/hermes-runs?run_id=<id>&events=0|1
 *
 * Read-only proxy to a Hermes gateway's /v1/runs endpoints. Lets the task
 * board show live Hermes execution state (status, output, event stream) for
 * runs recorded in task metadata (`hermes_run_id`) without exposing the
 * gateway API key to the browser.
 *
 * The gateway address and key come from the HERMES_RUNS_URL / HERMES_API_KEY
 * environment variables (server-only). When unset, returns 503 so the UI can
 * degrade to a plain "run id recorded" chip.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const base = process.env.HERMES_RUNS_URL?.trim()
  const apiKey = process.env.HERMES_API_KEY?.trim()
  if (!base || !apiKey) {
    return NextResponse.json(
      { error: 'Hermes runs bridge is not configured (set HERMES_RUNS_URL and HERMES_API_KEY)' },
      { status: 503 },
    )
  }

  const { searchParams } = new URL(request.url)
  const runId = searchParams.get('run_id') || ''
  const wantEvents = searchParams.get('events') === '1'
  if (!runId || !/^[A-Za-z0-9_-]{1,128}$/.test(runId)) {
    return NextResponse.json({ error: 'run_id is required' }, { status: 400 })
  }

  const resource = wantEvents ? `${base.replace(/\/$/, '')}/v1/runs/${runId}/events` : `${base.replace(/\/$/, '')}/v1/runs/${runId}`
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    const res = await fetch(resource, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    })
    clearTimeout(timeout)

    const text = await res.text()
    if (!res.ok) {
      // Pass through the gateway's error shape but never its auth failure body
      // verbatim (it can contain request-echo details).
      const status = res.status === 401 || res.status === 403 ? 502 : res.status
      return NextResponse.json({ error: `Hermes gateway returned ${res.status}` }, { status })
    }
    try {
      return NextResponse.json(JSON.parse(text))
    } catch {
      // SSE /events payloads arrive as text/event-stream; hand the raw text
      // through — the UI parses minimal `data:` lines client-side.
      return new NextResponse(text, { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
  } catch (err: any) {
    logger.warn({ err: err?.message, runId }, 'hermes-runs proxy error')
    return NextResponse.json({ error: 'Failed to reach Hermes gateway' }, { status: 504 })
  }
}
