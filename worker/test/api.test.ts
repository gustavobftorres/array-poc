import { beforeEach, describe, expect, it } from 'vitest'
import app from '../src/index'
import { fakeD1 } from './fakeD1'
import { MOCK_BASE_SCORE } from '../src/array/mock'

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
      hasAuthId: false,
      hasAuthToken: false,
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
    const big = await post('/api/array/user', { ...DEMO, firstName: 'A'.repeat(25_000) })
    expect(big.status).toBe(400)

    const res = await call('/api/inspector?limit=50')
    expect(res.status).toBe(200)
    const json = (await res.json()) as { calls: { request: unknown }[] }
    expect(json.calls.length).toBeGreaterThan(0)
    // The oversized row is stored as a valid JSON envelope, not broken text.
    const envelope = json.calls.map((c) => c.request).find((r) => r && (r as { _truncated?: boolean })._truncated)
    expect(envelope).toBeTruthy()
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
    if (r.collections.length === 0) expect(derogatory).toContain('Nenhum registro negativo')
    else expect(derogatory).toContain(`${r.collections.length} conta`)

    expect(r.summary.totalAccounts).toBe(r.tradelines.length)
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
      { DB: db as unknown as D1Database, CACHE: {} as KVNamespace, SMARTY_AUTH_ID: 'APP', SMARTY_AUTH_TOKEN: 'SECRET' } as never,
    )
    expect([400, 403, 405, 407, 502, 504]).toContain(res.status)
    const json = await res.json()
    expect(JSON.stringify(json)).not.toContain('SECRET')
    expect(json.message).toBeTruthy()
    expect(json.kind).toBeTruthy()
  }, 30_000)
})
