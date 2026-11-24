import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { getBuiltinSkillsDirectory } from '@/lib/agent/skill-store/inject'

const scripts = join(getBuiltinSkillsDirectory(), 'mercury', 'scripts')

function run(args: string[], env: Record<string, string> = {}) {
  const child = Bun.spawnSync(args, {
    env: { PATH: process.env.PATH ?? '', ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  return { code: child.exitCode, out: child.stdout.toString(), err: child.stderr.toString() }
}

// Async, so the in-process fake Mercury server can answer while the script runs.
async function runAsync(args: string[], env: Record<string, string>) {
  const child = Bun.spawn(args, {
    env: { PATH: process.env.PATH ?? '', ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])

  return { code, out, err }
}

function charge(day: string, name: string, amount: number, extra: Record<string, unknown> = {}) {
  return {
    id: `${name}-${day}`,
    amount,
    status: 'sent',
    kind: 'debitCardTransaction',
    postedAt: `${day}T12:00:00Z`,
    counterpartyName: name,
    cardLastFour: '4242',
    ...extra,
  }
}

describe('save-token.sh', () => {
  test('writes a private env file with the secret-token prefix and never prints the token', () => {
    const home = mkdtempSync(join(tmpdir(), 'mercury-home-'))
    const answer = join(home, 'MERCURY_API_TOKEN')

    writeFileSync(answer, 'mercury_production_abc123\n')
    const result = run(['bash', join(scripts, 'save-token.sh'), answer], { HOME: home })
    const env = join(home, '.mercury', 'nuphos.env')

    expect(result.code).toBe(0)
    expect(result.out + result.err).not.toContain('abc123')
    expect(readFileSync(env, 'utf8')).toContain(
      "export MERCURY_API_TOKEN=secret-token:mercury_production_abc123\n",
    )
    expect(statSync(env).mode & 0o777).toBe(0o600)
  })
})

describe('setup-credentials.sh', () => {
  test('writes the bound token in the save-token.sh format and never prints it', async () => {
    const paths: string[] = []
    const backend = Bun.serve({
      port: 0,
      fetch(request) {
        paths.push(new URL(request.url).pathname)

        return Response.json({
          bindingId: 'b1',
          label: 'Ops',
          apiToken: 'mercury_production_xyz789',
          apiBaseUrl: 'https://api.mercury.com/api/v1',
        })
      },
    })
    const home = mkdtempSync(join(tmpdir(), 'mercury-setup-'))

    try {
      const result = await runAsync(['bash', join(scripts, 'setup-credentials.sh'), 't1', 'b1'], {
        HOME: home,
        NUPHOS_TOKEN: 'nuphos-token',
        NUPHOS_BACKEND_URL: `http://127.0.0.1:${backend.port}`,
      })
      const env = join(home, '.mercury', 'nuphos.env')

      expect(result.code).toBe(0)
      expect(paths).toEqual(['/teams/t1/mercury-integrations/b1/credentials'])
      expect(result.out + result.err).not.toContain('xyz789')
      expect(readFileSync(env, 'utf8')).toBe(
        'unset MERCURY_API_TOKEN\n' +
          'export MERCURY_API_TOKEN=secret-token:mercury_production_xyz789\n' +
          'export MERCURY_API_BASE_URL=https://api.mercury.com/api/v1\n' +
          'export MERCURY_BINDING_ID=b1\n',
      )
      expect(statSync(env).mode & 0o777).toBe(0o600)
    } finally {
      await backend.stop(true)
    }
  })
})

describe('mercury.py', () => {
  let server: ReturnType<typeof Bun.serve>
  const seen: Array<{ method: string; path: string; auth: string | null }> = []

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)

        seen.push({
          method: request.method,
          path: url.pathname + url.search,
          auth: request.headers.get('authorization'),
        })
        if (url.pathname === '/accounts') {
          return Response.json({
            accounts: [
              { id: 'acc-1', name: 'Ops', status: 'active', type: 'mercury', accountNumber: '9876543210' },
              { id: 'acc-2', name: 'Old', status: 'archived', type: 'mercury', accountNumber: '1111' },
            ],
            page: {},
          })
        }
        if (url.pathname === '/cards') {
          return Response.json({ cards: [{ id: 'card-1', lastFour: '4242' }], page: {} })
        }
        const offset = Number(url.searchParams.get('offset'))
        const transactions =
          offset === 0
            ? [{ id: 't1', amount: -10, status: 'sent', cardId: 'card-1', accountId: 'acc-1' }]
            : [{ id: 't2', amount: -5, status: 'failed', accountId: 'acc-1' }]

        return Response.json({ total: 2, transactions })
      },
    })
  })

  afterAll(() => server.stop(true))

  test('pages one account by offset, adds card last four, and only sends GET', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mercury-client-'))
    const out = join(home, 'tx.json')
    const result = await runAsync(
      ['python3', '-I', join(scripts, 'mercury.py'), 'transactions', '--days', '90', '--out', out],
      {
        HOME: home,
        MERCURY_API_TOKEN: 'tok',
        MERCURY_API_BASE_URL: `http://127.0.0.1:${server.port}`,
      },
    )
    const data = JSON.parse(readFileSync(out, 'utf8'))

    expect(result.code).toBe(0)
    expect(data.transactions.map((t: { id: string }) => t.id)).toEqual(['t1'])
    expect(data.transactions[0]).toMatchObject({ cardLastFour: '4242', accountLast4: '3210' })
    expect(seen.filter((r) => r.path.startsWith('/account/')).map((r) => r.path)).toHaveLength(2)
    expect(seen.some((r) => r.path.includes('acc-2'))).toBe(false)
    expect(new Set(seen.map((r) => r.method))).toEqual(new Set(['GET']))
    expect(new Set(seen.map((r) => r.auth))).toEqual(new Set(['Bearer secret-token:tok']))
    expect(result.out + result.err).not.toContain('secret-token:tok')
  })
})

describe('detect-recurring.py', () => {
  test('keeps periodic same-amount charges and leaves out bills, top-ups, one-offs and usage', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mercury-detect-'))
    const file = join(dir, 'tx.json')
    const transactions = [
      charge('2026-08-03', 'NOTION LABS', -20),
      charge('2026-09-03', 'NOTION LABS', -20),
      charge('2026-10-03', 'NOTION LABS', -21),
      charge('2026-09-15', 'FIGMA*AB12CD', -45),
      charge('2026-10-15', 'FIGMA*ZX98QW', -45),
      charge('2026-08-10', 'Mercury IO Card Payment', -800, { kind: 'outgoingPayment' }),
      charge('2026-09-10', 'Mercury IO Card Payment', -800, { kind: 'outgoingPayment' }),
      charge('2026-10-10', 'Mercury IO Card Payment', -800, { kind: 'outgoingPayment' }),
      charge('2026-08-20', 'OpenAI top up', -50),
      charge('2026-09-20', 'OpenAI top up', -50),
      charge('2026-08-05', 'AWS', -112.4),
      charge('2026-09-05', 'AWS', -260.9),
      charge('2026-10-05', 'AWS', -71.3),
      charge('2026-09-01', 'Blue Bottle', -6.5),
      charge('2026-09-12', 'NOTION LABS', 20, { kind: 'debitCardCredit' }),
    ]

    writeFileSync(file, JSON.stringify({ start: '2026-08-01', end: '2026-10-31', transactions }))
    const result = run(['python3', '-I', join(scripts, 'detect-recurring.py'), file, '--json'])
    const report = JSON.parse(result.out)

    expect(result.code).toBe(0)
    expect(report.recurring.map((r: { merchant: string; cadence: string; confidence: string }) => [
      r.merchant,
      r.cadence,
      r.confidence,
    ])).toEqual([
      ['FIGMA*AB12CD', 'monthly', 'medium'],
      ['NOTION LABS', 'monthly', 'high'],
    ])
    expect(report.recurring[1].cardLastFour).toEqual(['4242'])
    expect(report.usageBased.map((u: { merchant: string }) => u.merchant)).toEqual(['AWS'])
    expect(report.excluded).toEqual({
      'card-bill payment': 3,
      'top-up/prepaid': 2,
      'credit/refund': 1,
    })
    expect(report.oneOffCharges).toBe(1)
  })
})
