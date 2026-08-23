import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { z } from 'zod'
import { getConfig, publicStatus } from './config'
import type { Env } from './types'
import { ArrayClient } from './array/client'
import { MockArrayProvider } from './array/mock'
import { ArrayApiError, type ArrayProvider } from './array/types'
import * as db from './db'
import { redact } from './redact'

type Vars = { requestBody?: unknown }
const app = new Hono<{ Bindings: Env; Variables: Vars }>()

app.use('*', cors())

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

const mockProvider = new MockArrayProvider()

function provider(env: Env | undefined): ArrayProvider {
  const cfg = getConfig(env)
  if (cfg.mode === 'mock') return mockProvider
  return new ArrayClient({ baseUrl: cfg.baseUrl, appKey: cfg.appKey, clientToken: cfg.clientToken })
}

// ---------------------------------------------------------------------------
// Audit middleware — records every API call into D1 (redacted)
// ---------------------------------------------------------------------------

const AUDIT_SKIP = /^\/api\/(inspector|health|status)$/

app.use('/api/*', async (c, next) => {
  const started = Date.now()
  let requestBody: unknown = undefined
  if (c.req.method !== 'GET' && c.req.method !== 'DELETE') {
    const raw = await c.req.text()
    if (raw) {
      try {
        requestBody = JSON.parse(raw)
      } catch {
        requestBody = { raw: raw.slice(0, 2000) }
      }
    }
    c.set('requestBody', requestBody)
  }

  await next()

  const path = new URL(c.req.url).pathname
  if (AUDIT_SKIP.test(path)) return

  const duration = Date.now() - started
  let responseBody: unknown = undefined
  try {
    if (c.res) {
      const clone = c.res.clone()
      const text = await clone.text()
      responseBody = text ? JSON.parse(text) : null
    }
  } catch {
    responseBody = { note: 'non-json response' }
  }

  const query = Object.fromEntries(new URL(c.req.url).searchParams.entries())
  if (c.env?.DB) {
    await db.insertApiCall(c.env.DB, {
      method: c.req.method,
      path,
      status: c.res?.status ?? 0,
      durationMs: duration,
      request: { query, body: requestBody ?? null },
      response: responseBody,
      mode: getConfig(c.env).mode,
    })
  }
})

/** Read the body captured by the audit middleware (it already consumed it). */
function body(c: { get: (k: 'requestBody') => unknown }): unknown {
  return c.get('requestBody') ?? {}
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const addressSchema = z.object({
  street: z.string().min(3),
  city: z.string().min(2),
  state: z.string().length(2),
  zip: z.string().regex(/^\d{5}(-\d{4})?$/, 'zip must be 5 or 9 digits'),
})

const createUserSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dob must be YYYY-MM-DD'),
  ssn: z.string().transform((s) => s.replace(/\D/g, '')).refine((s) => s.length === 9, 'ssn must have 9 digits'),
  address: addressSchema,
})

const kbaQuestionsSchema = z.object({ clientKey: z.string().min(1) })

const answerKbaSchema = z.object({
  clientKey: z.string().min(1),
  authToken: z.string().min(1),
  answers: z.record(z.string(), z.string()).refine((a) => Object.keys(a).length > 0, 'answers cannot be empty'),
})

const userTokenSchema = z.object({
  clientKey: z.string().min(1),
  ttlInMinutes: z.number().int().min(1).max(1440).default(60),
})

const orderReportSchema = z.object({
  clientKey: z.string().min(1),
  productCode: z.string().min(1).default('credmo3bReportScore'),
})

const getReportSchema = z.object({
  reportKey: z.string().min(1),
  displayToken: z.string().min(1),
  clientKey: z.string().optional(),
})

const refreshTokenSchema = z.object({ clientKey: z.string().min(1), reportKey: z.string().min(1) })

/** Turn a zod failure into a 400 with Array-style `error[]` details. */
function validationError(err: z.ZodError, location: 'body' | 'query') {
  return {
    message: 'Validation failed',
    error: err.issues.map((i) => ({
      value: '',
      message: i.message,
      param: i.path.join('.') || '(root)',
      location,
    })),
  }
}

function parse<T extends z.ZodTypeAny>(schema: T, input: unknown, location: 'body' | 'query') {
  const res = schema.safeParse(input)
  if (!res.success) return { ok: false as const, response: validationError(res.error, location) }
  return { ok: true as const, data: res.data as z.infer<T> }
}

/** Map provider errors onto HTTP responses (never leaks the client token). */
function errorResponse(e: unknown) {
  if (e instanceof ArrayApiError) {
    const hint =
      e.kind === 'blocked'
        ? 'O host array.io está bloqueado pelo proxy de egresso deste ambiente. Rode em modo mock (esvazie as credenciais) para explorar a POC.'
        : e.kind === 'timeout'
          ? 'A Array não respondeu no tempo limite. Tente novamente.'
          : undefined
    return {
      status: e.status >= 400 && e.status < 600 ? e.status : 502,
      payload: { message: e.message, kind: e.kind, hint, upstream: redact(e.body) },
    }
  }
  return {
    status: 500,
    payload: { message: e instanceof Error ? e.message : 'Unexpected error', kind: 'internal' as const },
  }
}

// ---------------------------------------------------------------------------
// Meta routes
// ---------------------------------------------------------------------------

app.get('/api/health', (c) => c.json({ ok: true, mode: getConfig(c.env).mode }))

app.get('/api/status', async (c) => {
  const cfg = getConfig(c.env)
  const users = c.env?.DB ? await db.countUsers(c.env.DB) : 0
  return c.json({ ...publicStatus(cfg), users })
})

// ---------------------------------------------------------------------------
// Array routes
// ---------------------------------------------------------------------------

app.post('/api/array/user', async (c) => {
  const v = parse(createUserSchema, body(c), 'body')
  if (!v.ok) return c.json(v.response, 400)
  try {
    const res = await provider(c.env).createUser(v.data)
    if (c.env?.DB) {
      await db.insertUser(c.env.DB, { ...v.data, clientKey: res.clientKey, mode: getConfig(c.env).mode })
    }
    return c.json(res)
  } catch (e) {
    const { status, payload } = errorResponse(e)
    return c.json(payload, status as 400)
  }
})

app.get('/api/array/user', async (c) => {
  const userToken = c.req.header('x-credmo-user-token') || c.req.query('userToken') || ''
  if (!userToken) return c.json({ message: 'Validation failed', error: [{ value: '', message: 'userToken is required', param: 'userToken', location: 'query' }] }, 400)
  try {
    return c.json(await provider(c.env).getUserByToken(userToken))
  } catch (e) {
    const { status, payload } = errorResponse(e)
    return c.json(payload, status as 400)
  }
})

app.get('/api/array/users', async (c) => {
  const users = c.env?.DB ? await db.listUsers(c.env.DB) : []
  return c.json({ users })
})

app.get('/api/array/authenticate', async (c) => {
  const v = parse(kbaQuestionsSchema, { clientKey: c.req.query('clientKey') }, 'query')
  if (!v.ok) return c.json(v.response, 400)
  try {
    return c.json(await provider(c.env).getKbaQuestions(v.data))
  } catch (e) {
    const { status, payload } = errorResponse(e)
    return c.json(payload, status as 400)
  }
})

app.post('/api/array/authenticate', async (c) => {
  const v = parse(answerKbaSchema, body(c), 'body')
  if (!v.ok) return c.json(v.response, 400)
  try {
    const res = await provider(c.env).answerKba(v.data)
    if (c.env?.DB && res.userToken) {
      await db.insertUserToken(c.env.DB, {
        clientKey: res.clientKey,
        userToken: res.userToken,
        authToken: res.authToken,
        ttlInMinutes: res.ttlInMinutes,
        expiresAt: new Date(Date.now() + (res.ttlInMinutes ?? 60) * 60_000).toISOString(),
      })
    }
    return c.json(res)
  } catch (e) {
    const { status, payload } = errorResponse(e)
    return c.json(payload, status as 400)
  }
})

app.post('/api/array/usertoken', async (c) => {
  const v = parse(userTokenSchema, body(c), 'body')
  if (!v.ok) return c.json(v.response, 400)
  try {
    const res = await provider(c.env).createUserToken(v.data)
    if (c.env?.DB) {
      await db.insertUserToken(c.env.DB, {
        clientKey: res.clientKey,
        userToken: res.userToken,
        ttlInMinutes: res.ttlInMinutes,
        expiresAt: res.expiresAt,
      })
    }
    return c.json(res)
  } catch (e) {
    const { status, payload } = errorResponse(e)
    return c.json(payload, status as 400)
  }
})

app.get('/api/array/usertoken/latest', async (c) => {
  const clientKey = c.req.query('clientKey') ?? ''
  if (!clientKey) return c.json({ message: 'Validation failed', error: [{ value: '', message: 'clientKey is required', param: 'clientKey', location: 'query' }] }, 400)
  const row = c.env?.DB ? await db.latestUserToken(c.env.DB, clientKey) : null
  return c.json({ token: row })
})

app.post('/api/array/report', async (c) => {
  const v = parse(orderReportSchema, body(c), 'body')
  if (!v.ok) return c.json(v.response, 400)
  try {
    const res = await provider(c.env).orderReport(v.data)
    if (c.env?.DB) await db.insertReport(c.env.DB, res)
    return c.json(res)
  } catch (e) {
    const { status, payload } = errorResponse(e)
    return c.json(payload, status as 400)
  }
})

app.get('/api/array/report', async (c) => {
  const v = parse(
    getReportSchema,
    { reportKey: c.req.query('reportKey'), displayToken: c.req.query('displayToken'), clientKey: c.req.query('clientKey') },
    'query',
  )
  if (!v.ok) return c.json(v.response, 400)
  try {
    const report = await provider(c.env).getReport(v.data)
    if (c.env?.DB) await db.saveReportPayload(c.env.DB, v.data.reportKey, report)
    return c.json(report)
  } catch (e) {
    const { status, payload } = errorResponse(e)
    return c.json(payload, status as 400)
  }
})

app.get('/api/array/reports', async (c) => {
  const reports = c.env?.DB ? await db.listReports(c.env.DB, c.req.query('clientKey') || undefined) : []
  return c.json({ reports })
})

app.put('/api/array/report', async (c) => {
  const v = parse(refreshTokenSchema, body(c), 'body')
  if (!v.ok) return c.json(v.response, 400)
  try {
    const res = await provider(c.env).refreshDisplayToken(v.data)
    if (c.env?.DB) {
      await db.insertReport(c.env.DB, { ...res, clientKey: v.data.clientKey, productCode: 'refresh' })
    }
    return c.json(res)
  } catch (e) {
    const { status, payload } = errorResponse(e)
    return c.json(payload, status as 400)
  }
})

app.get('/api/array/scoretracker', async (c) => {
  const v = parse(kbaQuestionsSchema, { clientKey: c.req.query('clientKey') }, 'query')
  if (!v.ok) return c.json(v.response, 400)
  try {
    return c.json(await provider(c.env).getScoreTracker(v.data))
  } catch (e) {
    const { status, payload } = errorResponse(e)
    return c.json(payload, status as 400)
  }
})

app.get('/api/array/alerts', async (c) => {
  const v = parse(kbaQuestionsSchema, { clientKey: c.req.query('clientKey') }, 'query')
  if (!v.ok) return c.json(v.response, 400)
  try {
    const res = await provider(c.env).getAlerts({ ...v.data, bureau: c.req.query('bureau') || undefined })
    if (c.env?.DB) await db.upsertAlerts(c.env.DB, res.alerts)
    return c.json(res)
  } catch (e) {
    const { status, payload } = errorResponse(e)
    return c.json(payload, status as 400)
  }
})

app.get('/api/array/alerts/:alertId', async (c) => {
  try {
    return c.json(
      await provider(c.env).getAlertDetails({ alertId: c.req.param('alertId'), clientKey: c.req.query('clientKey') || undefined }),
    )
  } catch (e) {
    const { status, payload } = errorResponse(e)
    return c.json(payload, status as 400)
  }
})

app.get('/api/array/monitoring', async (c) => {
  const v = parse(kbaQuestionsSchema, { clientKey: c.req.query('clientKey') }, 'query')
  if (!v.ok) return c.json(v.response, 400)
  try {
    return c.json(await provider(c.env).getMonitoringEnrollments(v.data))
  } catch (e) {
    const { status, payload } = errorResponse(e)
    return c.json(payload, status as 400)
  }
})

// ---------------------------------------------------------------------------
// Seed + inspector
// ---------------------------------------------------------------------------

/** Sandbox identity from docs/ARRAY_API_RESEARCH.md §5. */
export const DEMO_USER = {
  firstName: 'BANKER',
  lastName: 'COLDIRON',
  dob: '1974-04-18',
  ssn: '666230560',
  address: { street: '3627 CALIFORNIA ST', city: 'GRAND PRAIRIE', state: 'TX', zip: '75052' },
}

app.post('/api/seed', async (c) => {
  const p = provider(c.env)
  const cfg = getConfig(c.env)
  try {
    const user = await p.createUser(DEMO_USER)
    if (c.env?.DB) await db.insertUser(c.env.DB, { ...DEMO_USER, clientKey: user.clientKey, mode: cfg.mode })

    const token = await p.createUserToken({ clientKey: user.clientKey, ttlInMinutes: 60 })
    if (c.env?.DB) {
      await db.insertUserToken(c.env.DB, {
        clientKey: user.clientKey,
        userToken: token.userToken,
        ttlInMinutes: token.ttlInMinutes,
        expiresAt: token.expiresAt,
      })
    }

    const order = await p.orderReport({ clientKey: user.clientKey, productCode: 'credmo3bReportScore' })
    if (c.env?.DB) await db.insertReport(c.env.DB, order)

    const report = await p.getReport({ ...order })
    if (c.env?.DB) await db.saveReportPayload(c.env.DB, order.reportKey, report)

    const alerts = await p.getAlerts({ clientKey: user.clientKey })
    if (c.env?.DB) await db.upsertAlerts(c.env.DB, alerts.alerts)

    return c.json({
      seeded: true,
      mode: cfg.mode,
      clientKey: user.clientKey,
      userToken: token.userToken,
      reportKey: order.reportKey,
      displayToken: order.displayToken,
      score: (report as { score?: number }).score ?? null,
      alerts: alerts.alerts.length,
      demoUser: { ...DEMO_USER, ssn: `***-**-${DEMO_USER.ssn.slice(-4)}` },
    })
  } catch (e) {
    const { status, payload } = errorResponse(e)
    return c.json({ seeded: false, ...payload }, status as 400)
  }
})

app.get('/api/inspector', async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50) || 50, 1), 200)
  const offset = Math.max(Number(c.req.query('offset') ?? 0) || 0, 0)
  if (!c.env?.DB) return c.json({ calls: [], total: 0, limit, offset })
  const { rows, total } = await db.listApiCalls(c.env.DB, limit, offset)
  return c.json({
    calls: rows.map((r) => ({
      ...r,
      request: r.request ? JSON.parse(r.request) : null,
      response: r.response ? JSON.parse(r.response) : null,
    })),
    total,
    limit,
    offset,
  })
})

app.delete('/api/inspector', async (c) => {
  if (c.env?.DB) await db.clearApiCalls(c.env.DB)
  return c.json({ cleared: true })
})

app.notFound((c) => c.json({ message: 'Not Found', path: new URL(c.req.url).pathname }, 404))

app.onError((err, c) => {
  const { status, payload } = errorResponse(err)
  return c.json(payload, status as 500)
})

export default app
