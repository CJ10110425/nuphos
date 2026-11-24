import { Hono } from 'hono'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { registerBindingAccessRoutes } from '@/lib/byos/access-routes'
import { bindingShareSchema, newBindingAccess } from '@/lib/byos/initial-access'
import { MercuryApiError, normalizeMercuryToken, verifyMercuryApiToken } from '@/lib/byos/mercury'
import { encryptMercurySecret } from '@/lib/byos/secrets'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import {
  disconnectBinding,
  requireCanDisconnect,
  requireMercuryIntegration,
  requireTeamRole,
} from '@/middleware/auth'
import { teamByosBindings } from '@/models'

import type { MercuryIntegrationVariables, TeamAuthVariables } from '@/middleware/auth'
import type { MercuryIntegrationBinding } from '@/models'

export const mercuryIntegrationsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

// Mercury binds with a static API token (Settings → API Tokens, ideally Read
// Only). No OAuth. The token is normalized to carry its `secret-token:` prefix,
// probed once with GET /accounts?limit=1, and stored encrypted.
const bindSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    apiToken: z.string().trim().min(1).max(500),
    share: bindingShareSchema.optional(),
  })
  .strict()

const invalidToken = () =>
  new AppError(
    400,
    'invalid_mercury_api_token',
    'The Mercury API token is invalid or has been revoked.',
  )

export function publicView(binding: MercuryIntegrationBinding) {
  return {
    id: binding.id.toHexString(),
    label: binding.label,
    createdAt: binding.createdAt,
  }
}

mercuryIntegrationsRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { mercuryIntegrations: 1 } },
  )

  return c.json({ integrations: (doc?.mercuryIntegrations ?? []).map(publicView) })
})

mercuryIntegrationsRoutes.post(
  '/',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', bindSchema),
  async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const { label, apiToken } = c.req.valid('json')
    const token = normalizeMercuryToken(apiToken)

    if (!token) throw invalidToken()
    await verifyMercuryApiToken(token).catch((err: unknown) => {
      if (err instanceof MercuryApiError && (err.status === 401 || err.status === 403)) {
        throw invalidToken()
      }
      const message = err instanceof Error ? err.message : 'unknown error'

      throw new AppError(
        502,
        'mercury_api_unavailable',
        `Could not reach the Mercury API: ${message}`,
      )
    })

    const now = new Date()
    const binding: MercuryIntegrationBinding = {
      id: new ObjectId(),
      label,
      encryptedApiToken: encryptMercurySecret(token),
      createdAt: now,
      access: await newBindingAccess(c, { now }),
    }

    await teamByosBindings().updateOne(
      { _id: teamId },
      {
        $push: { mercuryIntegrations: binding },
        $set: { updatedAt: now },
        $setOnInsert: {
          awsRoles: [],
          gcpServiceAccounts: [],
          grafanaInstances: [],
          githubInstallations: [],
          cloudflareAccounts: [],
          tailscaleClients: [],
          zeaburProviders: [],
        },
      },
      { upsert: true },
    )

    return c.json(publicView(binding), 201)
  },
)

const integrationScoped = new Hono<{ Variables: MercuryIntegrationVariables }>()

integrationScoped.use('*', requireMercuryIntegration())
registerBindingAccessRoutes(integrationScoped, 'mercuryIntegrations', (c) =>
  c.get('mercuryBinding'),
)

integrationScoped.get('/', (c) => {
  return c.json(publicView(c.get('mercuryBinding')))
})

integrationScoped.delete(
  '/',
  requireTeamRole('ADMINISTRATOR'),
  requireCanDisconnect('mercuryAccess'),
  async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const integrationId = new ObjectId(c.get('mercuryIntegrationId'))
    const result = await disconnectBinding(c, teamId, 'mercuryIntegrations', { id: integrationId })

    if (result.modifiedCount === 0) {
      throw new AppError(404, 'mercury_integration_not_bound', 'Mercury integration not found')
    }

    return c.body(null, 204)
  },
)

// Like Resend, there is deliberately NO team-scoped /credentials handout: the
// token reaches a sandbox only through the session-scoped route in
// agent-sessions/mercury.ts, gated by the conversation's selection.

mercuryIntegrationsRoutes.route('/:integrationId', integrationScoped)
