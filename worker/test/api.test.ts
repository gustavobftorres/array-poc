import { beforeEach, describe, expect, it } from 'vitest'
import app from '../src/index'
import { fakeD1 } from './fakeD1'
import { MOCK_BASE_SCORE } from '../src/array/mock'

let db: ReturnType<typeof fakeD1>
const env = () => ({ DB: db as unknown as D1Database, CACHE: {} as KVNamespace })

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
    const token = await (await post('/api/array/usertoken', { clientKey: 'K' })).json()
    expect(token.ttlInMinutes).toBe(60)
    const order = await (await post('/api/array/report', { clientKey: 'K' })).json()
    expect(order.productCode).toBe('credmo3bReportScore')
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
