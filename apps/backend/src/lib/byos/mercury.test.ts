import { afterEach, describe, expect, test } from 'bun:test'

import { MercuryApiError, normalizeMercuryToken, verifyMercuryApiToken } from './mercury'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

type Call = { url: string; method: string; authorization: string | null }

function stubFetch(status: number, body: unknown): Call[] {
  const calls: Call[] = []

  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: input instanceof Request ? input.url : String(input),
      method: init?.method ?? 'GET',
      authorization: new Headers(init?.headers).get('authorization'),
    })

    return Promise.resolve(Response.json(body, { status }))
  }) as unknown as typeof fetch

  return calls
}

describe('normalizeMercuryToken', () => {
  test('adds the secret-token: prefix when it is missing', () => {
    expect(normalizeMercuryToken('mercury_production_abc')).toBe(
      'secret-token:mercury_production_abc',
    )
  })

  test('keeps an existing prefix and trims surrounding whitespace', () => {
    expect(normalizeMercuryToken('  secret-token:abc\n')).toBe('secret-token:abc')
  })

  test('strips a leading Bearer, in any case', () => {
    expect(normalizeMercuryToken('Bearer secret-token:abc')).toBe('secret-token:abc')
    expect(normalizeMercuryToken('bearer abc')).toBe('secret-token:abc')
  })

  test('rejects empty values and values with inner whitespace', () => {
    expect(normalizeMercuryToken('')).toBeNull()
    expect(normalizeMercuryToken('   ')).toBeNull()
    expect(normalizeMercuryToken('Bearer ')).toBeNull()
    expect(normalizeMercuryToken('abc def')).toBeNull()
  })
})

describe('verifyMercuryApiToken', () => {
  test('makes exactly one GET /accounts?limit=1 with the normalized bearer token', async () => {
    const calls = stubFetch(200, { accounts: [{ id: 'acc-1' }], page: {} })

    await verifyMercuryApiToken('abc')

    expect(calls).toEqual([
      {
        url: 'https://api.mercury.com/api/v1/accounts?limit=1',
        method: 'GET',
        authorization: 'Bearer secret-token:abc',
      },
    ])
  })

  test('throws MercuryApiError 401 for a rejected token', async () => {
    stubFetch(401, { errors: { errorCode: 'unauthorized', message: 'Invalid token' } })
    const err = await verifyMercuryApiToken('secret-token:bad').catch((e: unknown) => e)

    expect(err).toBeInstanceOf(MercuryApiError)
    expect((err as MercuryApiError).status).toBe(401)
    expect((err as MercuryApiError).message).toContain('Invalid token')
  })

  test('surfaces other statuses as MercuryApiError with that status', async () => {
    stubFetch(500, { message: 'boom' })
    const err = await verifyMercuryApiToken('secret-token:abc').catch((e: unknown) => e)

    expect(err).toBeInstanceOf(MercuryApiError)
    expect((err as MercuryApiError).status).toBe(500)
  })

  test('never calls Mercury for a malformed token', async () => {
    const calls = stubFetch(200, { accounts: [] })
    const err = await verifyMercuryApiToken('two words').catch((e: unknown) => e)

    expect(err).toBeInstanceOf(MercuryApiError)
    expect(calls).toEqual([])
  })
})
