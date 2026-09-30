import { logger } from './logger'

export interface AgentTransportTarget {
  id?: number
  name: string
  runtime_type?: string | null
}

export interface AgentTransportUnavailable {
  error: 'AGENT_TRANSPORT_UNAVAILABLE'
  detail: string
  agent_runtime: string
}

/**
 * Returns a transport error unless this agent explicitly identifies as OpenClaw.
 *
 * `sessions_send` is an OpenClaw gateway command, so the runtime marker is a
 * required positive identity rather than a capability inferred from a session key.
 * This deliberately fails closed for missing, custom, and future runtime values.
 */
export function getOpenClawSessionTransportError(
  agent: AgentTransportTarget,
): AgentTransportUnavailable | null {
  const agent_runtime = typeof agent.runtime_type === 'string' && agent.runtime_type.length > 0
    ? agent.runtime_type
    : 'custom'

  if (agent_runtime === 'openclaw') return null

  logger.warn(
    { agent_id: agent.id, agent_name: agent.name, agent_runtime },
    'Agent transport unavailable: OpenClaw session transport requires runtime_type=openclaw',
  )

  return {
    error: 'AGENT_TRANSPORT_UNAVAILABLE',
    detail: `Agent "${agent.name}" cannot use OpenClaw session transport because runtime_type is "${agent_runtime}".`,
    agent_runtime,
  }
}
