import { Hono } from 'hono'

import { agentSubjectId } from '@/lib/agents/identity'
import { apiTokenFromBinding, MERCURY_API_BASE_URL } from '@/lib/byos/mercury'
import { AppError } from '@/lib/errors'
import { requireMercuryIntegration, requireMercuryMemberAccess } from '@/middleware/auth'
import { getAgentCredentialAccess } from '@/routes/agent-sessions/shared'

import type { AgentMercuryVars } from '@/routes/agent-sessions/shared'
import type { MiddlewareHandler } from 'hono'

// Like Resend, a Mercury token is handed out ONLY here, never from the
// team-scoped route: bank data is private, so a binding must also be selected
// for this specific conversation.
export const mercuryScoped = new Hono<{ Variables: AgentMercuryVars }>()

mercuryScoped.use('*', requireMercuryIntegration())
mercuryScoped.use('*', requireMercuryMemberAccess())
mercuryScoped.use('*', requireSelectedMercuryAgentCredential())

mercuryScoped.get('/credentials', (c) => {
  const agent = c.get('agent')
  const binding = c.get('mercuryBinding')
  const apiToken = apiTokenFromBinding(binding)

  c.header('X-Atlas-Agent', agentSubjectId(agent))
  // A reusable bearer token over GET must never be cached by intermediaries.
  c.header('Cache-Control', 'no-store, private')
  c.header('Pragma', 'no-cache')

  return c.json({
    bindingId: c.get('mercuryIntegrationId'),
    label: binding.label,
    apiToken,
    apiBaseUrl: MERCURY_API_BASE_URL,
  })
})

function requireSelectedMercuryAgentCredential(): MiddlewareHandler<{
  Variables: AgentMercuryVars
}> {
  return async (c, next) => {
    const agent = c.get('agent')
    const teamId = c.get('teamId')
    const credentialAccess = await getAgentCredentialAccess(agent, teamId)
    const selectedIntegrationIds = credentialAccess.mercuryIntegrationIds

    if (selectedIntegrationIds.length === 0) {
      throw new AppError(
        403,
        'mercury_integration_agent_access_denied',
        'This agent session has no selected Mercury integrations',
      )
    }
    if (!selectedIntegrationIds.includes(c.get('mercuryIntegrationId'))) {
      throw new AppError(
        403,
        'mercury_integration_agent_access_denied',
        'This Mercury integration is not enabled for this agent session',
      )
    }
    await next()
  }
}
