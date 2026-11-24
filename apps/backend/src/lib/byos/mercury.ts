import { decryptMercurySecret } from '@/lib/byos/secrets'

import type { MercuryIntegrationBinding } from '@/models'

// Mercury REST API. Auth is a static `Authorization: Bearer secret-token:…` API
// token pasted by an admin: no OAuth, no exchange, no expiry. The connector is
// read-only by design, so the only call made from here is the bind-time probe.
export const MERCURY_API_BASE_URL = 'https://api.mercury.com/api/v1'
const FETCH_TIMEOUT_MS = 30_000
const TOKEN_PREFIX = 'secret-token:'

export class MercuryApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'MercuryApiError'
  }
}

/**
 * The bearer value Mercury expects, from what an admin pasted: trimmed, without
 * a `Bearer ` prefix, and always carrying Mercury's `secret-token:` prefix.
 * Returns null for a value that cannot be a token (empty or containing spaces).
 */
export function normalizeMercuryToken(raw: string): string | null {
  let token = raw.trim()

  if (/^bearer(?:\s|$)/iu.test(token)) token = token.slice('bearer'.length).trim()
  if (!token || /\s/u.test(token)) return null

  return token.startsWith(TOKEN_PREFIX) ? token : `${TOKEN_PREFIX}${token}`
}

export function apiTokenFromBinding(binding: MercuryIntegrationBinding): string {
  return decryptMercurySecret(binding.encryptedApiToken)
}

async function mercuryGet(token: string, path: string): Promise<unknown> {
  let res: Response

  try {
    res = await fetch(`${MERCURY_API_BASE_URL}${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch (e) {
    const name = (e as { name?: string }).name

    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new MercuryApiError(
        504,
        `Mercury request timed out after ${String(FETCH_TIMEOUT_MS)}ms`,
      )
    }
    const message = e instanceof Error ? e.message : 'unknown transport error'

    throw new MercuryApiError(502, `Mercury request failed: ${message}`)
  }
  if (!res.ok) {
    let detail = `HTTP ${String(res.status)}`

    try {
      const body = (await res.json()) as { message?: unknown; errors?: { message?: unknown } }
      const message = body.errors?.message ?? body.message

      if (typeof message === 'string' && message) detail = message
    } catch {
      // non-JSON error body; keep the status-only detail
    }
    throw new MercuryApiError(res.status, `Mercury API error: ${detail}`)
  }

  return res.json()
}

/** Validates a token with one cheap read. Throws MercuryApiError on rejection. */
export async function verifyMercuryApiToken(token: string): Promise<void> {
  const normalized = normalizeMercuryToken(token)

  if (!normalized) throw new MercuryApiError(401, 'Mercury API token is empty or malformed')
  await mercuryGet(normalized, '/accounts?limit=1')
}
