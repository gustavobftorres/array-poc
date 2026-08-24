import { beforeEach, describe, expect, it } from 'vitest'
import app, { calendarAge, isFutureDate, tokenCacheKey, tokenCacheScope, wantsRefresh } from '../src/index'
import { fakeD1 } from './fakeD1'
import { MOCK_BASE_SCORE } from '../src/array/mock'
import { monthsAgoISO } from '../src/dates'

let db: ReturnType<typeof fakeD1>
let kv: Map<string, string>

/** Tiny KV stand-in: get/put with JSON support, TTL ignored. */
const fakeKv = () => ({
  get: async (key: string, type?: string) => {
    const raw = kv.get(key)
    if (raw === undefined) return null
    return type === 'json' ? JSON.parse(raw) : raw
  },
  put: async (key: string, value: string) => {
    kv.set(key, value)
  },
})

const env = () => ({ DB: db as unknown as D1Database, CACHE: fakeKv() as unknown as KVNamespace })

const call = (path: string, init?: RequestInit) =>
  app.fetch(new Request(`http://local${path}`, init), env() as never)

const post = (path: string, bodyObj: unknown) =>
  call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(bodyObj) })

const DEMO = {
  firstName: 'BANKER',
  lastName: 'COLDIRON',
  dob: '1974-04-18',
  ssn: '666230560',
  address: { street: '3627 CALIFORNIA ST', city: 'GRAND PRAIRIE', state: 'TX', zip: '75052' },
}

beforeEach(() => {
  db = fakeD1()
  kv = new Map()
})

describe('meta routes', () => {
  it('reports mock mode without credentials', async () => {
    const res = await call('/api/status')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({
      mode: 'mock',
      hasAppKey: false,
      hasServerToken: false,
      authMode: 'server',
      productCode: 'credmo3bReportScore',
      arrayEnv: 'sandbox',
      baseUrl: 'https://sandbox.array.io/api',
      componentsCdn: 'https://embed.sandbox.array.io/cms/',
    })
  })

  it('404s unknown api paths with an Array-shaped error', async () => {
    const res = await call('/api/nope')
    expect(res.status).toBe(404)
    expect((await res.json()).message).toBe('Not Found')
  })
})

describe('mock end-to-end flow', () => {
  it('runs enrollment -> kba -> usertoken -> report -> alerts', async () => {
    const created = await (await post('/api/array/user', DEMO)).json()
    expect(created.clientKey).toMatch(/^[0-9A-F-]{20,}$/)

    const questions = await (await call(`/api/array/authenticate?clientKey=${created.clientKey}`)).json()
    expect(questions.questions).toHaveLength(4)
    expect(questions.questions[0].answers).toHaveLength(4)
    expect(questions.authToken).toBeTruthy()

    const answers = Object.fromEntries(questions.questions.map((q: any) => [q.questionId, q.answers[0].answerId]))
    const auth = await (
      await post('/api/array/authenticate', { clientKey: created.clientKey, authToken: questions.authToken, answers })
    ).json()
    expect(auth.userToken).toBeTruthy()
    expect(auth.status).toBe('authenticated')

    const resolved = await (await call('/api/array/user', { headers: { 'x-credmo-user-token': auth.userToken } })).json()
    expect(resolved.clientKey).toBe(created.clientKey)

    const token = await (await post('/api/array/usertoken', { clientKey: created.clientKey, ttlInMinutes: 30 })).json()
    expect(token.ttlInMinutes).toBe(30)
    expect(token.userToken).toBeTruthy()

    const order = await (await post('/api/array/report', { clientKey: created.clientKey, productCode: 'credmo3bReportScore' })).json()
    expect(order.reportKey).toBeTruthy()
    expect(order.displayToken).toBeTruthy()

    const report = await (
      await call(`/api/array/report?reportKey=${order.reportKey}&displayToken=${order.displayToken}&clientKey=${created.clientKey}`)
    ).json()
    expect(report.score).toBe(MOCK_BASE_SCORE)
    expect(report.scoreHistory).toHaveLength(12)
    expect(report.scores).toHaveLength(3)
    expect(report.tradelines.length).toBeGreaterThanOrEqual(5)
    expect(report.factors.length).toBeGreaterThan(0)

    const alerts = await (await call(`/api/array/alerts?clientKey=${created.clientKey}`)).json()
    expect(alerts.alerts.length).toBeGreaterThan(0)
    expect(alerts.alerts[0].severity).toBeTruthy()

    const monitoring = await (await call(`/api/array/monitoring?clientKey=${created.clientKey}`)).json()
    expect(monitoring.enrollments).toHaveLength(3)
  })

  it('is deterministic: same identity -> same clientKey and report', async () => {
    const a = await (await post('/api/array/user', DEMO)).json()
    const b = await (await post('/api/array/user', DEMO)).json()
    expect(a.clientKey).toBe(b.clientKey)

    const o1 = await (await post('/api/array/report', { clientKey: a.clientKey, productCode: 'credmo3bReportScore' })).json()
    const o2 = await (await post('/api/array/report', { clientKey: a.clientKey, productCode: 'credmo3bReportScore' })).json()
    expect(o1.reportKey).toBe(o2.reportKey)
  })

  it('rejects KBA when too many answers are wrong', async () => {
    const created = await (await post('/api/array/user', DEMO)).json()
    const q = await (await call(`/api/array/authenticate?clientKey=${created.clientKey}`)).json()
    const answers = Object.fromEntries(q.questions.map((x: any) => [x.questionId, x.answers[3].answerId]))
    const res = await post('/api/array/authenticate', { clientKey: created.clientKey, authToken: q.authToken, answers })
    expect(res.status).toBe(400)
  })

  it('seeds a demo user', async () => {
    const res = await call('/api/seed', { method: 'POST' })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.seeded).toBe(true)
    expect(json.score).toBe(MOCK_BASE_SCORE)
    // The seed response must not echo a full SSN.
    expect(JSON.stringify(json)).not.toContain('666230560')
  })
})

describe('zod validation', () => {
  it('400s on a malformed enrollment with per-field details', async () => {
    const res = await post('/api/array/user', { firstName: '', lastName: 'X', dob: '18/04/1974', ssn: '123', address: { street: 'a', city: 'b', state: 'TEX', zip: 'abc' } })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.message).toBe('Validation failed')
    const params = json.error.map((e: any) => e.param)
    expect(params).toContain('firstName')
    expect(params).toContain('dob')
    expect(params).toContain('ssn')
    expect(params).toContain('address.zip')
    expect(json.error[0].location).toBe('body')
  })

  it('400s when clientKey is missing on a query route', async () => {
    const res = await call('/api/array/alerts')
    expect(res.status).toBe(400)
    expect((await res.json()).error[0].location).toBe('query')
  })

  it('400s on empty KBA answers', async () => {
    const res = await post('/api/array/authenticate', { clientKey: 'K', authToken: 'A', answers: {} })
    expect(res.status).toBe(400)
  })

  it('accepts a formatted SSN and normalizes it', async () => {
    const res = await post('/api/array/user', { ...DEMO, ssn: '666-23-0560' })
    expect(res.status).toBe(200)
  })

  it('defaults ttlInMinutes and productCode', async () => {
    const user = (await (await post('/api/array/user', DEMO)).json()) as { clientKey: string }
    const token = await (await post('/api/array/usertoken', { clientKey: user.clientKey })).json()
    expect(token.ttlInMinutes).toBe(60)
    const order = await (await post('/api/array/report', { clientKey: user.clientKey })).json()
    expect(order.productCode).toBe('credmo3bReportScore')
  })
})

describe('mock registry (unknown identifiers are rejected)', () => {
  it('400s an unknown clientKey instead of inventing data', async () => {
    expect((await call('/api/array/authenticate?clientKey=NAO-EXISTE')).status).toBe(400)
    expect((await post('/api/array/usertoken', { clientKey: 'NAO-EXISTE' })).status).toBe(400)
    expect((await post('/api/array/report', { clientKey: 'NAO-EXISTE' })).status).toBe(400)
    expect((await call('/api/array/alerts?clientKey=NAO-EXISTE')).status).toBe(400)
    expect((await call('/api/array/monitoring?clientKey=NAO-EXISTE')).status).toBe(400)
  })

  it('404s an unknown reportKey and 400s a mismatched displayToken', async () => {
    expect((await call('/api/array/report?reportKey=xxx&displayToken=yyy')).status).toBe(404)

    const user = (await (await post('/api/array/user', DEMO)).json()) as { clientKey: string }
    const order = (await (await post('/api/array/report', { clientKey: user.clientKey })).json()) as {
      reportKey: string
    }
    const res = await call(`/api/array/report?reportKey=${order.reportKey}&displayToken=WRONG`)
    expect(res.status).toBe(400)
  })

  it('rejects an authToken it never issued', async () => {
    const user = (await (await post('/api/array/user', DEMO)).json()) as { clientKey: string }
    const res = await post('/api/array/authenticate', {
      clientKey: user.clientKey,
      authToken: 'nao-emitido',
      answers: { Q1: 'Q1A1' },
    })
    expect(res.status).toBe(400)
  })
})

describe('oversized payloads (regression: inspector 500)', () => {
  it('rejects a huge enrollment and keeps GET /api/inspector at 200', async () => {
    // `firstName` is redacted to its shape (Z-005), so the bulk that exercises
    // the truncation envelope has to be a non-PII field.
    const big = await post('/api/array/user', {
      ...DEMO,
      firstName: 'A'.repeat(25_000),
      notes: 'B'.repeat(25_000),
    })
    expect(big.status).toBe(400)

    const res = await call('/api/inspector?limit=50')
    expect(res.status).toBe(200)
    const json = (await res.json()) as { calls: { request: unknown }[] }
    expect(json.calls.length).toBeGreaterThan(0)
    // The oversized row is stored as a valid JSON envelope, not broken text.
    const envelope = json.calls.map((c) => c.request).find((r) => r && (r as { _truncated?: boolean })._truncated)
    expect(envelope).toBeTruthy()
    // And the 25k-char name never reaches the row, not even inside the preview.
    expect(JSON.stringify(json)).not.toContain('AAAAAAAAAA')
  })

  it('does not break the inspector when a row holds invalid JSON', async () => {
    await post('/api/array/user', DEMO)
    const rows = await db.prepare('SELECT id FROM api_calls').all()
    const id = (rows.results?.[0] as { id: string }).id
    await db.prepare('UPDATE api_calls SET request = ? WHERE id = ?').bind('{"broken":', id).run()

    const res = await call('/api/inspector?limit=50')
    expect(res.status).toBe(200)
    const json = (await res.json()) as { calls: { request: { _unparseable?: boolean } }[] }
    expect(json.calls.some((c) => c.request?._unparseable)).toBe(true)
  })
})

describe('dob validation', () => {
  it('rejects a future dob', async () => {
    const res = await post('/api/array/user', { ...DEMO, dob: '2099-01-01' })
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: { param: string }[] }
    expect(json.error.some((e) => e.param === 'dob')).toBe(true)
  })

  it('rejects impossible calendar dates', async () => {
    for (const dob of ['2024-13-45', '2023-02-30', '2000-00-10', '1990-04-31']) {
      const res = await post('/api/array/user', { ...DEMO, dob })
      expect(res.status, dob).toBe(400)
    }
  })

  it('rejects a minor and an implausible age', async () => {
    const thisYear = new Date().getUTCFullYear()
    expect((await post('/api/array/user', { ...DEMO, dob: `${thisYear - 5}-01-01` })).status).toBe(400)
    expect((await post('/api/array/user', { ...DEMO, dob: '1850-01-01' })).status).toBe(400)
  })

  it('accepts a valid adult dob', async () => {
    expect((await post('/api/array/user', DEMO)).status).toBe(200)
  })
})

describe('user token KV cache', () => {
  it('serves the second mint from KV and can be bypassed', async () => {
    const user = (await (await post('/api/array/user', DEMO)).json()) as { clientKey: string }

    const first = (await (await post('/api/array/usertoken', { clientKey: user.clientKey })).json()) as {
      userToken: string
      cached?: boolean
    }
    expect(first.cached).toBeUndefined()
    expect(kv.size).toBe(1)

    const second = (await (await post('/api/array/usertoken', { clientKey: user.clientKey })).json()) as {
      userToken: string
      cached?: boolean
    }
    expect(second.cached).toBe(true)
    expect(second.userToken).toBe(first.userToken)

    const forced = await post('/api/array/usertoken?refresh=true', { clientKey: user.clientKey })
    expect(((await forced.json()) as { cached?: boolean }).cached).toBeUndefined()
  })
})

describe('mock report coherence', () => {
  it('narrative text agrees with the derived aggregates', async () => {
    const user = (await (await post('/api/array/user', DEMO)).json()) as { clientKey: string }
    const order = (await (await post('/api/array/report', { clientKey: user.clientKey })).json()) as {
      reportKey: string
      displayToken: string
    }
    const res = await call(`/api/array/report?reportKey=${order.reportKey}&displayToken=${order.displayToken}`)
    const r = (await res.json()) as {
      summary: Record<string, number>
      factors: { code: string; description: string }[]
      collections: unknown[]
      inquiries: { type: string }[]
      tradelines: { creditLimit: number; balance: number; accountType: string }[]
    }

    const factor = (code: string) => r.factors.find((f) => f.code === code)!.description

    expect(factor('UTILIZATION')).toContain(`${r.summary.utilization}%`)
    expect(factor('INQUIRIES')).toMatch(new RegExp(`^${r.summary.inquiries6mo} consultas? hard`))
    expect(r.summary.inquiries6mo).toBe(r.inquiries.filter((i) => i.type === 'Hard').length)
    expect(factor('CREDIT_AGE')).toContain(`${r.summary.oldestAccountYears} anos`)

    const derogatory = factor('DEROGATORY')
    const late = r.tradelines.filter((t) => t.paymentHistory.some((p) => p !== 'OK')).length
    if (r.collections.length === 0 && late === 0) {
      expect(derogatory).toContain('Nenhum registro negativo')
    } else {
      // W-012: never claim a clean file next to delinquent accounts.
      expect(derogatory).not.toContain('Nenhum registro negativo')
      if (late > 0) expect(derogatory).toContain(`${late} conta`)
    }

    // W-012: the payment factor is negative whenever there are late marks.
    const payment = r.factors.find((f) => f.code === 'PAYMENT_HISTORY')!
    expect(payment.direction).toBe(late > 0 ? 'negative' : 'positive')
    expect(r.summary.delinquencies).toBe(late)

    expect(r.summary.totalAccounts).toBe(r.tradelines.length)
  })

  it('closes the utilization arithmetic with the pair it shows (W-004/W-005)', async () => {
    const user = (await (await post('/api/array/user', DEMO)).json()) as { clientKey: string }
    const order = (await (await post('/api/array/report', { clientKey: user.clientKey })).json()) as {
      reportKey: string
      displayToken: string
    }
    const r = (await (
      await call(`/api/array/report?reportKey=${order.reportKey}&displayToken=${order.displayToken}`)
    ).json()) as {
      summary: Record<string, number>
      tradelines: { creditLimit: number; balance: number; accountType: string }[]
    }

    const REVOLVING = ['Credit Card', 'Charge Card', 'Revolving']
    const rev = r.tradelines.filter((t) => REVOLVING.includes(t.accountType) && t.creditLimit > 0)

    // Only revolving accounts feed the revolving aggregates — a Student Loan or
    // a Mortgage must never inflate the "limite total (rotativo)" (W-005).
    expect(r.summary.revolvingLimit).toBe(rev.reduce((s, t) => s + t.creditLimit, 0))
    expect(r.summary.revolvingBalance).toBe(rev.reduce((s, t) => s + t.balance, 0))
    expect(r.summary.revolvingAccounts).toBe(rev.length)
    expect(r.summary).not.toHaveProperty('totalCreditLimit')

    // The displayed pair reproduces the displayed percentage (W-004).
    const derived = Math.round((r.summary.revolvingBalance / r.summary.revolvingLimit) * 1000) / 10
    expect(r.summary.utilization).toBe(derived)
    expect(r.summary.revolvingBalance).toBeLessThanOrEqual(r.summary.totalBalance)
    expect(r.summary.revolvingBalance + r.summary.installmentBalance).toBe(r.summary.totalBalance)
  })

  it('score history converges to the canonical score without a 30-point rebound (W-011)', async () => {
    const user = (await (await post('/api/array/user', DEMO)).json()) as { clientKey: string }
    const order = (await (await post('/api/array/report', { clientKey: user.clientKey })).json()) as {
      reportKey: string
      displayToken: string
    }
    const r = (await (
      await call(`/api/array/report?reportKey=${order.reportKey}&displayToken=${order.displayToken}`)
    ).json()) as { score: number; scoreHistory: { month: string; score: number }[] }

    expect(r.scoreHistory).toHaveLength(12)
    expect(r.scoreHistory[11].score).toBe(r.score)
    const steps = r.scoreHistory.slice(1).map((p, i) => Math.abs(p.score - r.scoreHistory[i].score))
    expect(Math.max(...steps)).toBeLessThanOrEqual(12)
    const spread = Math.max(...r.scoreHistory.map((p) => p.score)) - Math.min(...r.scoreHistory.map((p) => p.score))
    expect(spread).toBeLessThanOrEqual(30)
  })
})

describe('audit trail', () => {
  it('writes a redacted api_calls row for each call', async () => {
    await post('/api/array/user', DEMO)
    const inserts = db.statements.filter((s) => /INSERT INTO api_calls/i.test(s.sql))
    expect(inserts).toHaveLength(1)
    const serialized = JSON.stringify(inserts[0].params)
    expect(serialized).not.toContain('666230560')
    expect(serialized).toContain('REDACTED')
    expect(serialized).toContain('/api/array/user')
  })

  it('does not audit /api/status or /api/inspector', async () => {
    await call('/api/status')
    await call('/api/inspector')
    expect(db.statements.filter((s) => /INSERT INTO api_calls/i.test(s.sql))).toHaveLength(0)
  })

  it('stores only the ssn last4 in users', async () => {
    await post('/api/array/user', DEMO)
    const userInsert = db.statements.find((s) => /INSERT INTO users/i.test(s.sql))
    expect(userInsert).toBeTruthy()
    expect(userInsert!.params).toContain('0560')
    expect(JSON.stringify(userInsert!.params)).not.toContain('666230560')
  })

  it('clears the inspector', async () => {
    const res = await call('/api/inspector', { method: 'DELETE' })
    expect((await res.json()).cleared).toBe(true)
    expect(db.statements.some((s) => /DELETE FROM api_calls/i.test(s.sql))).toBe(true)
  })
})

describe('sandbox mode failure handling', () => {
  it('returns a graceful error (not a crash) when array.io is unreachable', async () => {
    const res = await app.fetch(
      new Request('http://local/api/array/authenticate?clientKey=K'),
      { DB: db as unknown as D1Database, CACHE: {} as KVNamespace, ARRAY_APP_KEY: 'APP', ARRAY_SERVER_TOKEN: 'SECRET' } as never,
    )
    expect([400, 403, 405, 407, 502, 504]).toContain(res.status)
    const json = await res.json()
    expect(JSON.stringify(json)).not.toContain('SECRET')
    expect(json.message).toBeTruthy()
    expect(json.kind).toBeTruthy()
  }, 30_000)
})

// ---------------------------------------------------------------------------
// W-001 / W-007 / W-008 / W-009 — userToken cache
// ---------------------------------------------------------------------------

describe('userToken cache namespacing (W-001)', () => {
  const MOCK_SCOPE = { mode: 'mock', appKey: '', baseUrl: 'https://sandbox.array.io/api' }
  const SANDBOX_SCOPE = { mode: 'sandbox', appKey: 'APP-KEY-1', baseUrl: 'https://sandbox.array.io/api' }

  it('keys the cache by mode, appKey and baseUrl', () => {
    expect(tokenCacheScope(MOCK_SCOPE)).not.toBe(tokenCacheScope(SANDBOX_SCOPE))
    expect(tokenCacheKey(MOCK_SCOPE, 'CK', 60)).not.toBe(tokenCacheKey(SANDBOX_SCOPE, 'CK', 60))
    // different appKey on the same mode/baseUrl is a different scope too
    expect(tokenCacheKey(SANDBOX_SCOPE, 'CK', 60)).not.toBe(
      tokenCacheKey({ ...SANDBOX_SCOPE, appKey: 'APP-KEY-2' }, 'CK', 60),
    )
    // production baseUrl is a different scope
    expect(tokenCacheKey(SANDBOX_SCOPE, 'CK', 60)).not.toBe(
      tokenCacheKey({ ...SANDBOX_SCOPE, baseUrl: 'https://array.io/api' }, 'CK', 60),
    )
  })

  it('includes the requested ttl in the key (W-007)', () => {
    expect(tokenCacheKey(MOCK_SCOPE, 'CK', 60)).not.toBe(tokenCacheKey(MOCK_SCOPE, 'CK', 1440))
  })

  it('never serves a token minted in mock mode while running in sandbox mode', async () => {
    const user = (await (await post('/api/array/user', DEMO)).json()) as { clientKey: string }
    const minted = (await (
      await post('/api/array/usertoken', { clientKey: user.clientKey, ttlInMinutes: 60 })
    ).json()) as { userToken: string }
    expect(minted.userToken).toBeTruthy()
    expect(kv.size).toBe(1)

    // Same KV, same clientKey, same ttl — but now with credentials, i.e. the
    // sandbox provider. The mock token must not come back with 200/cached.
    const res = await app.fetch(
      new Request('http://local/api/array/usertoken', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientKey: user.clientKey, ttlInMinutes: 60 }),
      }),
      {
        DB: db as unknown as D1Database,
        CACHE: fakeKv() as unknown as KVNamespace,
        ARRAY_APP_KEY: 'APP',
        ARRAY_SERVER_TOKEN: 'SECRET',
      } as never,
    )
    const text = await res.text()
    expect(res.status).not.toBe(200)
    expect(text).not.toContain(minted.userToken)
    expect(text).not.toContain('"cached":true')
  }, 30_000)

  it('rejects a cached entry whose stored scope does not match (defence in depth)', async () => {
    const user = (await (await post('/api/array/user', DEMO)).json()) as { clientKey: string }
    await post('/api/array/usertoken', { clientKey: user.clientKey, ttlInMinutes: 120 })
    const [key, raw] = [...kv.entries()][0]
    kv.set(key, JSON.stringify({ ...JSON.parse(raw), scope: 'sandbox|OTHER|https://array.io/api' }))

    const again = (await (
      await post('/api/array/usertoken', { clientKey: user.clientKey, ttlInMinutes: 120 })
    ).json()) as { cached?: boolean }
    expect(again.cached).toBeUndefined()
  })

  it('honours the requested ttl instead of replaying a shorter cached one (W-007)', async () => {
    const user = (await (await post('/api/array/user', DEMO)).json()) as { clientKey: string }
    const short = (await (
      await post('/api/array/usertoken', { clientKey: user.clientKey, ttlInMinutes: 60 })
    ).json()) as { userToken: string; ttlInMinutes: number }
    const long = (await (
      await post('/api/array/usertoken', { clientKey: user.clientKey, ttlInMinutes: 1440 })
    ).json()) as { userToken: string; ttlInMinutes: number; cached?: boolean }
    expect(long.ttlInMinutes).toBe(1440)
    expect(long.cached).toBeUndefined()
    expect(long.userToken).not.toBe(short.userToken)
  })

  it('does not cache a token whose lifetime is within the safety margin (W-008)', async () => {
    const user = (await (await post('/api/array/user', DEMO)).json()) as { clientKey: string }
    const res = (await (
      await post('/api/array/usertoken', { clientKey: user.clientKey, ttlInMinutes: 1 })
    ).json()) as { ttlInMinutes: number }
    expect(res.ttlInMinutes).toBe(1)
    expect(kv.size).toBe(0)
  })

  it('drops a cached token that is about to expire', async () => {
    const user = (await (await post('/api/array/user', DEMO)).json()) as { clientKey: string }
    await post('/api/array/usertoken', { clientKey: user.clientKey, ttlInMinutes: 120 })
    const [key, raw] = [...kv.entries()][0]
    kv.set(key, JSON.stringify({ ...JSON.parse(raw), expiresAt: new Date(Date.now() + 5_000).toISOString() }))
    const again = (await (
      await post('/api/array/usertoken', { clientKey: user.clientKey, ttlInMinutes: 120 })
    ).json()) as { cached?: boolean }
    expect(again.cached).toBeUndefined()
  })

  it('accepts the usual spellings of ?refresh and mints a new token (W-009)', async () => {
    expect(['true', 'TRUE', '1', 'yes', 'on'].map(wantsRefresh)).toEqual([true, true, true, true, true])
    expect([undefined, '', 'false', '0', 'no'].map(wantsRefresh)).toEqual([false, false, false, false, false])

    const user = (await (await post('/api/array/user', DEMO)).json()) as { clientKey: string }
    const a = (await (await post('/api/array/usertoken', { clientKey: user.clientKey })).json()) as { userToken: string }
    const b = (await (await post('/api/array/usertoken?refresh=1', { clientKey: user.clientKey })).json()) as {
      userToken: string
      cached?: boolean
    }
    expect(b.cached).toBeUndefined()
    expect(b.userToken).not.toBe(a.userToken)
  })
})

// ---------------------------------------------------------------------------
// W-006 — age by calendar, not by millisecond average
// ---------------------------------------------------------------------------

describe('dob age boundaries (W-006)', () => {
  it('turns 18 at midnight of the birthday, not at some hour of the day', () => {
    const morning = new Date('2026-08-23T00:00:00Z')
    const evening = new Date('2026-08-23T23:59:59Z')
    expect(calendarAge('2008-08-23', morning)).toBe(18)
    expect(calendarAge('2008-08-23', evening)).toBe(18)
    expect(calendarAge('2008-08-24', morning)).toBe(17)
    expect(calendarAge('2008-08-24', evening)).toBe(17)
  })

  it('treats an exact 120th birthday as 120 (still allowed)', () => {
    expect(calendarAge('1906-08-23', new Date('2026-08-23T12:00:00Z'))).toBe(120)
    expect(calendarAge('1906-08-22', new Date('2026-08-23T12:00:00Z'))).toBe(120)
    expect(calendarAge('1905-08-23', new Date('2026-08-23T12:00:00Z'))).toBe(121)
  })

  it('handles a Feb 29 birthday in a non-leap year', () => {
    expect(calendarAge('2004-02-29', new Date('2026-02-28T12:00:00Z'))).toBe(21)
    expect(calendarAge('2004-02-29', new Date('2026-03-01T12:00:00Z'))).toBe(22)
  })

  it('only calls a date future when it is past today on the calendar', () => {
    const now = new Date('2026-08-23T00:30:00Z')
    expect(isFutureDate('2026-08-23', now)).toBe(false)
    expect(isFutureDate('2026-08-24', now)).toBe(true)
    expect(isFutureDate('2026-08-22', now)).toBe(false)
  })

  it('accepts a consumer who turns 18 today and rejects one who turns 18 tomorrow', async () => {
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    const now = new Date()
    const today18 = new Date(Date.UTC(now.getUTCFullYear() - 18, now.getUTCMonth(), now.getUTCDate()))
    const tomorrow18 = new Date(Date.UTC(now.getUTCFullYear() - 18, now.getUTCMonth(), now.getUTCDate() + 1))
    expect((await post('/api/array/user', { ...DEMO, dob: iso(today18) })).status).toBe(200)
    expect((await post('/api/array/user', { ...DEMO, dob: iso(tomorrow18) })).status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// W-010 — the mock registry applies to GET /report too
// ---------------------------------------------------------------------------

describe('mock registry coherence on GET /report (W-010)', () => {
  it('rejects an unknown clientKey with 400', async () => {
    const user = (await (await post('/api/array/user', DEMO)).json()) as { clientKey: string }
    const order = (await (await post('/api/array/report', { clientKey: user.clientKey })).json()) as {
      reportKey: string
      displayToken: string
    }
    const ok = await call(`/api/array/report?reportKey=${order.reportKey}&displayToken=${order.displayToken}&clientKey=${user.clientKey}`)
    expect(ok.status).toBe(200)

    const bad = await call(`/api/array/report?reportKey=${order.reportKey}&displayToken=${order.displayToken}&clientKey=NAO-EXISTE`)
    expect(bad.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// Ciclo 6 — X-004, X-005, X-008, X-011, X-013
// ---------------------------------------------------------------------------

describe('report aggregates stay consistent with their labels', () => {
  const clientKeys: string[] = []

  it('counts only hard inquiries inside the 6-month window (X-004)', async () => {
    const cutoff = monthsAgoISO(6)
    for (let i = 0; i < 14; i++) {
      const u = (await (
        await post('/api/array/user', { ...DEMO, firstName: `T${i}` })
      ).json()) as { clientKey: string }
      clientKeys.push(u.clientKey)
      const o = (await (
        await post('/api/array/report', { clientKey: u.clientKey, productCode: 'credmo3bReportScore' })
      ).json()) as { reportKey: string; displayToken: string }
      const r = (await (
        await call(`/api/array/report?reportKey=${o.reportKey}&displayToken=${o.displayToken}`)
      ).json()) as {
        inquiries: { type: string; date: string }[]
        summary: { inquiries6mo: number; oldestAccountYears: number }
        tradelines: { opened: string }[]
      }
      const expected = r.inquiries.filter((q) => q.type === 'Hard' && q.date >= cutoff).length
      expect(r.summary.inquiries6mo).toBe(expected)
      // nothing older than the window may be counted
      expect(r.inquiries.filter((q) => q.type === 'Hard' && q.date < cutoff).length + expected).toBeGreaterThanOrEqual(
        r.summary.inquiries6mo,
      )
      // X-005: oldest account age by calendar, never a bare year subtraction
      const oldest = [...r.tradelines.map((t) => t.opened)].sort()[0]
      expect(r.summary.oldestAccountYears).toBe(Math.max(1, calendarAge(oldest)))
    }
  })
})

describe('userToken cache scope is read strictly (X-008/X-011)', () => {
  it('treats a stored value without scope as a miss', async () => {
    const u = (await (await post('/api/array/user', DEMO)).json()) as { clientKey: string }
    const key = tokenCacheKey({ mode: 'mock', appKey: '', baseUrl: 'https://sandbox.array.io/api' }, u.clientKey, 60)
    kv.set(
      key,
      JSON.stringify({
        userToken: 'POISONED-B',
        clientKey: u.clientKey,
        ttlInMinutes: 60,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    )
    const res = (await (
      await post('/api/array/usertoken', { clientKey: u.clientKey, ttlInMinutes: 60 })
    ).json()) as { userToken: string; cached?: boolean }
    expect(res.userToken).not.toBe('POISONED-B')
    expect(res.cached).toBeFalsy()
  })

  it('includes a hash of the client token in the scope (X-011)', () => {
    const base = { mode: 'sandbox', appKey: 'APP', baseUrl: 'https://sandbox.array.io/api' }
    expect(tokenCacheScope({ ...base, clientToken: 'OLD' })).not.toBe(
      tokenCacheScope({ ...base, clientToken: 'NEW' }),
    )
    // and the token itself never lands in the key
    expect(tokenCacheKey({ ...base, clientToken: 'SUPERSECRETTOKEN123' }, 'CK', 60)).not.toContain(
      'SUPERSECRETTOKEN123',
    )
  })
})

describe('GET /api/array/users pagination (X-013)', () => {
  it('honours limit/offset and reports the total', async () => {
    for (let i = 0; i < 5; i++) await post('/api/array/user', { ...DEMO, firstName: `P${i}` })
    const page = (await (await call('/api/array/users?limit=2&offset=1')).json()) as {
      users: unknown[]
      total: number
      limit: number
      offset: number
    }
    expect(page.limit).toBe(2)
    expect(page.offset).toBe(1)
    expect(page.users.length).toBeLessThanOrEqual(2)
    expect(typeof page.total).toBe('number')
    const q = db.statements.filter((st) => /FROM users ORDER BY created_at DESC LIMIT \? OFFSET \?/i.test(st.sql))
    expect(q.length).toBeGreaterThan(0)
    expect(q[q.length - 1].params).toEqual([2, 1])
    const bad = (await (await call('/api/array/users?limit=abc&offset=-5')).json()) as {
      limit: number
      offset: number
    }
    expect(bad.limit).toBe(50)
    expect(bad.offset).toBe(0)
  })
})

describe('parameter and date borders (Y-007)', () => {
  it('treats an empty or blank ?limit= as absent, not as zero', async () => {
    for (const q of ['?limit=', '?limit=%20', '?limit=&offset=', '?limit=+']) {
      const r = (await (await call(`/api/array/users${q}`)).json()) as { limit: number; offset: number }
      expect(r.limit, q).toBe(50)
      expect(r.offset, q).toBe(0)
    }
  })

  it('monthsAgoISO clamps the day instead of rolling into the next month', () => {
    // 2026-08-31 minus 6 months has no 31st: February 2026 ends on the 28th.
    expect(monthsAgoISO(6, new Date('2026-08-31T12:00:00Z'))).toBe('2026-02-28')
    expect(monthsAgoISO(1, new Date('2026-03-31T12:00:00Z'))).toBe('2026-02-28')
    expect(monthsAgoISO(1, new Date('2024-03-31T12:00:00Z'))).toBe('2024-02-29')
    expect(monthsAgoISO(1, new Date('2026-05-31T12:00:00Z'))).toBe('2026-04-30')
    // Unaffected days keep the same calendar day, including across a year edge.
    expect(monthsAgoISO(6, new Date('2026-08-24T12:00:00Z'))).toBe('2026-02-24')
    expect(monthsAgoISO(6, new Date('2026-01-15T12:00:00Z'))).toBe('2025-07-15')
    // The window is never SHORTER than the number of months it announces.
    for (const day of [1, 15, 28, 29, 30, 31]) {
      const now = new Date(Date.UTC(2026, 7, Math.min(day, 31), 12))
      const cut = monthsAgoISO(6, now)
      expect(cut <= now.toISOString().slice(0, 10)).toBe(true)
      expect(Number(cut.slice(5, 7))).toBe(2)
    }
  })

  it('every hard inquiry in the fixture sits inside the announced window (Y-005)', async () => {
    const cutoff = monthsAgoISO(6)
    for (let i = 0; i < 6; i++) {
      const u = (await (await post('/api/array/user', { ...DEMO, firstName: `Inq${i}` })).json()) as {
        clientKey: string
      }
      const ord = (await (await post('/api/array/report', { clientKey: u.clientKey, productCode: 'credmo3bReportScore' })).json()) as {
        reportKey: string
        displayToken: string
      }
      const r = (await (await call(`/api/array/report?reportKey=${ord.reportKey}&displayToken=${ord.displayToken}`)).json()) as {
        inquiries: { type: string; date: string }[]
        summary: { inquiries6mo: number }
      }
      const hard = r.inquiries.filter((q) => q.type === 'Hard')
      expect(hard.every((q) => q.date >= cutoff), JSON.stringify(hard)).toBe(true)
      expect(r.summary.inquiries6mo).toBe(hard.length)
    }
  })
})

// ---------------------------------------------------------------------------
// Ciclo 13 — polling do relatório no mock e persona de ARRAY_IDENTITY
// ---------------------------------------------------------------------------

describe('simulação de 202/200/204 no mock', () => {
  const fast = { ARRAY_POLL_INTERVAL: '0.001', ARRAY_POLL_TIMEOUT: '5' }
  const callWith = (path: string, init?: RequestInit, extra: Record<string, unknown> = fast) =>
    app.fetch(new Request(`http://local${path}`, init), {
      DB: db as unknown as D1Database,
      CACHE: fakeKv() as unknown as KVNamespace,
      ...extra,
    } as never)
  const postWith = (path: string, bodyObj: unknown, extra: Record<string, unknown> = fast) =>
    callWith(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(bodyObj) }, extra)

  const order = async (simulate?: string) => {
    const user = (await (await postWith('/api/array/user', DEMO)).json()) as { clientKey: string }
    return (await (
      await postWith('/api/array/report', { clientKey: user.clientKey, ...(simulate ? { simulate } : {}) })
    ).json()) as { reportKey: string; displayToken: string; productCode: string; simulate?: string }
  }

  it('sem simulação o relatório vem na primeira leitura', async () => {
    const o = await order()
    const res = await callWith(`/api/array/report?reportKey=${o.reportKey}&displayToken=${o.displayToken}`)
    expect(res.status).toBe(200)
    expect((await res.json()).score).toBeGreaterThan(0)
  })

  it('202 -> 200: o loop espera e devolve o relatório', async () => {
    const o = await order('pending-then-ready')
    expect(o.simulate).toBe('pending-then-ready')
    const res = await callWith(`/api/array/report?reportKey=${o.reportKey}&displayToken=${o.displayToken}`)
    expect(res.status).toBe(200)
    expect((await res.json()).reportKey).toBe(o.reportKey)
  })

  it('202 -> 204: falha PERMANENTE, com erro claro e sem esperar o timeout', async () => {
    const o = await order('pending-then-failure')
    const started = Date.now()
    const res = await callWith(`/api/array/report?reportKey=${o.reportKey}&displayToken=${o.displayToken}`)
    expect(res.status).toBe(502)
    const json = await res.json()
    expect(json.kind).toBe('report_failed')
    expect(json.message).toMatch(/PERMANENTE/)
    expect(json.hint).toMatch(/204/)
    // 5s de ARRAY_POLL_TIMEOUT: se girasse até o fim isso não passaria.
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('o timeout do polling é reportado como 504 e cita a variável', async () => {
    // Intervalo grande e timeout minúsculo: o 202 da simulação estoura a janela.
    const o = await order('pending-then-ready')
    const res = await callWith(
      `/api/array/report?reportKey=${o.reportKey}&displayToken=${o.displayToken}`,
      undefined,
      { ARRAY_POLL_INTERVAL: '0.05', ARRAY_POLL_TIMEOUT: '0.01' },
    )
    expect(res.status).toBe(504)
    const json = await res.json()
    expect(json.kind).toBe('timeout')
    expect(json.message).toMatch(/ARRAY_POLL_TIMEOUT/)
  })

  it('a simulação é do MOCK e é anunciada como tal', async () => {
    const o = await order('pending-then-ready')
    expect(o.simulate).toBe('pending-then-ready')
  })
})

describe('ARRAY_IDENTITY no seed e em /api/personas', () => {
  const withEnv = (extra: Record<string, unknown>) => ({
    DB: db as unknown as D1Database,
    CACHE: fakeKv() as unknown as KVNamespace,
    ...extra,
  }) as never

  it('lista as personas conhecidas com selo e só os 4 últimos do SSN', async () => {
    const res = await app.fetch(new Request('http://local/api/personas'), withEnv({}))
    const json = await res.json()
    expect(json.personas.map((p: { slug: string }) => p.slug)).toEqual([
      'banker-coldiron',
      'dalton-lot',
      'denise-hennessy',
      'donald-blair',
    ])
    expect(json.sandboxOnly).toBe(true)
    expect(json.active.slug).toBe('banker-coldiron')
    // Em SANDBOX o SSN da persona de teste sai inteiro (é o que pré-preenche o
    // Enrollment); é dado fictício da faixa 666, publicado pela Array.
    expect(json.personas[0].ssn).toBe('666230560')
    expect(json.personas[0].ssnLast4).toBe('0560')
  })

  it('em produção a persona não vem com SSN', async () => {
    const res = await app.fetch(new Request('http://local/api/personas'), withEnv({ ARRAY_ENV: 'production' }))
    const json = await res.json()
    expect(json.arrayEnv).toBe('production')
    expect(json.personas.every((p: { ssn: string | null }) => p.ssn === null)).toBe(true)
    expect(JSON.stringify(json)).not.toContain('666230560')
  })

  it('o seed usa a persona de ARRAY_IDENTITY', async () => {
    const res = await app.fetch(
      new Request('http://local/api/seed', { method: 'POST' }),
      withEnv({ ARRAY_IDENTITY: 'denise-hennessy' }),
    )
    const json = await res.json()
    expect(json.seeded).toBe(true)
    expect(json.identity).toMatchObject({ slug: 'denise-hennessy', source: 'persona' })
    expect(json.demoUser).toMatchObject({ firstName: 'DENISE', lastName: 'HENNESSY' })
    expect(json.demoUser.ssn).toMatch(/^\*\*\*-\*\*-\d{4}$/)
    expect(json.productCode).toBe('credmo3bReportScore')
  })

  // -------------------------------------------------------------------------
  // W2-002 — em produção o seed é RECUSADO e nenhuma PII sai do worker.
  // Antes: 200 com o SSN da persona (ou o digitado na variável) no corpo do
  // POST /user/v2 para o host de produção.
  // -------------------------------------------------------------------------
  it('W2-002: POST /api/seed é recusado em produção, com motivo', async () => {
    const res = await app.fetch(
      new Request('http://local/api/seed', { method: 'POST' }),
      withEnv({ ARRAY_ENV: 'production', ARRAY_IDENTITY: 'banker-coldiron' }),
    )
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.seeded).toBe(false)
    expect(json.kind).toBe('identity_discarded')
    expect(JSON.stringify(json)).not.toContain('666230560')
    expect(json.details.arrayEnv).toBe('production')
  })

  it('W2-002: seed recusado também quando só ARRAY_BASE_URL aponta para produção', async () => {
    const res = await app.fetch(
      new Request('http://local/api/seed', { method: 'POST' }),
      withEnv({
        ARRAY_BASE_URL: 'https://array.io',
        ARRAY_ENV: 'sandbox',
        ARRAY_IDENTITY: '{"firstName":"MARIA","lastName":"SILVA","ssn":"123456789"}',
      }),
    )
    expect(res.status).toBe(409)
    const text = JSON.stringify(await res.json())
    expect(text).not.toContain('123456789')
    expect(text).not.toContain('MARIA')
  })

  it('W2-001: /api/status nunca afirma um ambiente diferente do host chamado', async () => {
    const res = await app.fetch(
      new Request('http://local/api/status'),
      withEnv({ ARRAY_BASE_URL: 'https://array.io', ARRAY_ENV: 'sandbox' }),
    )
    const json = await res.json()
    expect(json.arrayEnv).toBe('production')
    expect(json.baseUrl).toBe('https://array.io/api')
    expect(json.componentsCdn).toBe('https://embed.array.io/cms/')
    expect(json.arrayEnvSource).toBe('ARRAY_BASE_URL')
    expect(json.envMismatch).toMatchObject({ declared: 'sandbox', effective: 'production' })
    expect(json.warnings.join(' ')).toMatch(/contradiz o host/)
    // E a identidade não vem com PII.
    expect(JSON.stringify(json)).not.toContain('666230560')
  })

  it('W2-002: /api/personas em produção não devolve identidade ativa nenhuma', async () => {
    const res = await app.fetch(new Request('http://local/api/personas'), withEnv({ ARRAY_ENV: 'production' }))
    const json = await res.json()
    expect(json.active.source).toBe('discarded')
    expect(json.active.ssn).toBeNull()
    expect(json.active.firstName).toBe('')
    expect(JSON.stringify(json)).not.toContain('666230560')
  })

  it('o seed respeita o ARRAY_PRODUCT_CODE', async () => {
    const res = await app.fetch(
      new Request('http://local/api/seed', { method: 'POST' }),
      withEnv({ ARRAY_PRODUCT_CODE: 'tui1bReportScore' }),
    )
    expect((await res.json()).productCode).toBe('tui1bReportScore')
  })
})
