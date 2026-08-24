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

/**
 * The mock keeps its registry in memory; D1 outlives it. Rehydrate once per
 * isolate so a `clientKey`/`reportKey` saved in the browser keeps working after
 * a worker restart.
 */
let mockHydrated = false
async function hydrateMock(env: Env | undefined): Promise<void> {
  if (mockHydrated || !env?.DB || getConfig(env).mode !== 'mock') return
  mockHydrated = true
  const [users, reports] = await Promise.all([db.listUsers(env.DB, 200), db.allReportKeys(env.DB)])
  mockProvider.hydrate(
    users.map((u) => ({
      clientKey: String(u.client_key ?? ''),
      firstName: String(u.first_name ?? ''),
      lastName: String(u.last_name ?? ''),
      ssnLast4: String(u.ssn_last4 ?? ''),
    })),
    reports.map((r) => ({
      reportKey: String(r.report_key ?? ''),
      clientKey: String(r.client_key ?? ''),
      displayToken: String(r.display_token ?? ''),
      productCode: String(r.product_code ?? ''),
    })),
  )
}

function provider(env: Env | undefined): ArrayProvider {
  const cfg = getConfig(env)
  if (cfg.mode === 'mock') return mockProvider
  return new ArrayClient({ baseUrl: cfg.baseUrl, appKey: cfg.appKey, clientToken: cfg.clientToken })
}

// ---------------------------------------------------------------------------
// Audit middleware — records every API call into D1 (redacted)
// ---------------------------------------------------------------------------

/**
 * Routes that do not represent a call to Array: meta endpoints and the local D1
 * listings the frontend polls. Auditing them buried the real Array calls under
 * frontend noise (V-008).
 */
const AUDIT_SKIP =
  /^\/api\/(inspector|health|status|array\/users|array\/reports|array\/usertoken\/latest)$/

app.use('/api/*', async (c, next) => {
  const started = Date.now()
  await hydrateMock(c.env)
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
  street: z.string().min(3).max(120),
  city: z.string().min(2).max(80),
  state: z.string().length(2),
  zip: z.string().regex(/^\d{5}(-\d{4})?$/, 'zip must be 5 or 9 digits'),
})

// Calendar arithmetic lives in ./dates so the fixtures can use the very same
// rule (X-005). Re-exported here because the tests and older call sites import
// it from the entrypoint.
export { calendarAge, isFutureDate } from './dates'
import { calendarAge, isFutureDate } from './dates'

/**
 * A real calendar date in the past, with a plausible adult age.
 * The format regex alone used to accept `2024-13-45` and `2099-01-01`.
 */
export const dobSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'dob must be YYYY-MM-DD')
  .refine((v) => {
    const [y, m, d] = v.split('-').map(Number)
    if (m < 1 || m > 12 || d < 1 || d > 31) return false
    const dt = new Date(Date.UTC(y, m - 1, d))
    // Round-trip catches impossible days (2023-02-30) and month overflow.
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  }, 'dob must be a real calendar date')
  .refine((v) => !isFutureDate(v), 'dob cannot be in the future')
  .refine((v) => {
    const age = calendarAge(v)
    return age >= 18 && age <= 120
  }, 'consumer must be between 18 and 120 years old')

const createUserSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  dob: dobSchema,
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
    // A blocked egress or a timeout is an upstream condition, not a client
    // error — reporting 403/408 would paint infrastructure as "the caller's fault".
    const status =
      e.kind === 'blocked' ? 502 : e.kind === 'timeout' ? 504 : e.status >= 400 && e.status < 600 ? e.status : 502
    return {
      status,
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

/** Positive integer query param with a default and a hard ceiling (X-013). */
function intParam(raw: string | undefined, def: number, min: number, max: number): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n)) return def
  return Math.min(max, Math.max(min, n))
}

app.get('/api/array/users', async (c) => {
  // The UI paginated but the route still shipped every row (X-013): with 34
  // users the payload carried 34. `limit`/`offset` make the page real.
  const limit = intParam(c.req.query('limit'), 50, 1, 200)
  const offset = intParam(c.req.query('offset'), 0, 0, 100_000)
  const users = c.env?.DB ? await db.listUsers(c.env.DB, limit, offset) : []
  const total = c.env?.DB ? await db.countUsers(c.env.DB) : 0
  return c.json({ users, total, limit, offset })
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

// ---------------------------------------------------------------------------
// KV cache for user tokens
//
// A userToken is valid for `ttlInMinutes`; minting a new one on every component
// mount burns an Array call for nothing. We cache the minted token in KV under
// the clientKey with the same TTL (minus a safety margin) so repeated requests
// inside the window are served locally. Cache misses always fall through.
// ---------------------------------------------------------------------------

const TOKEN_CACHE_PREFIX = 'usertoken:v2:'
/** Stop serving a cached token this many seconds before it actually expires. */
const TOKEN_CACHE_MARGIN_S = 60

/** Query values that count as "give me a brand new token" (W-009). */
const REFRESH_VALUES = new Set(['true', '1', 'yes', 'y', 'on'])
export function wantsRefresh(raw: string | undefined | null): boolean {
  return REFRESH_VALUES.has(String(raw ?? '').trim().toLowerCase())
}

/**
 * Everything that changes what a userToken MEANS. A token minted by the mock
 * provider must never be served while the worker runs against the real Array
 * (or vice-versa): that returned `200 {cached:true}` with a fixture token on
 * the exact step the user plugs their credentials in to validate (W-001).
 * The requested TTL is part of the identity too, so asking for 1440 minutes
 * never silently receives a 60-minute token back (W-007).
 */
export function tokenCacheScope(cfg: {
  mode: string
  appKey: string
  baseUrl: string
  clientToken?: string
}): string {
  return `${cfg.mode}|${cfg.appKey || 'no-appkey'}|${cfg.baseUrl}|ct${shortHash(cfg.clientToken ?? '')}`
}

/**
 * Non-reversible 32-bit fingerprint. Used to put the CLIENT TOKEN in the cache
 * scope without ever storing it: rotating/revoking the token used to keep
 * serving the userTokens minted with the old one (X-011).
 */
export function shortHash(value: string): string {
  let h = 5381
  for (let i = 0; i < value.length; i++) h = ((h * 33) ^ value.charCodeAt(i)) >>> 0
  return h.toString(16).padStart(8, '0')
}

export function tokenCacheKey(
  cfg: { mode: string; appKey: string; baseUrl: string; clientToken?: string },
  clientKey: string,
  ttlInMinutes: number,
): string {
  return `${TOKEN_CACHE_PREFIX}${tokenCacheScope(cfg)}|${ttlInMinutes}|${clientKey}`
}

type CachedToken = {
  userToken: string
  clientKey: string
  ttlInMinutes: number
  expiresAt?: string
  /** Scope this token was minted under — re-checked on read (W-001). */
  scope?: string
}

/** Seconds left before the token itself dies, or null when unknown. */
function secondsLeft(expiresAt: string | undefined): number | null {
  if (!expiresAt) return null
  const ms = Date.parse(expiresAt)
  if (Number.isNaN(ms)) return null
  return Math.floor((ms - Date.now()) / 1000)
}

async function cachedUserToken(
  env: Env | undefined,
  clientKey: string,
  ttlInMinutes: number,
): Promise<CachedToken | null> {
  if (!env?.CACHE?.get) return null
  const cfg = getConfig(env)
  try {
    const hit = await env.CACHE.get<CachedToken>(tokenCacheKey(cfg, clientKey, ttlInMinutes), 'json')
    if (!hit?.userToken) return null
    // Belt and braces: even if a key from an older build survives, the stored
    // scope has to match the scope we are running in right now.
    // A stored value WITHOUT a scope used to be accepted, so the W-001 defence
    // depended on what was written instead of on what is read (X-008).
    if (hit.scope !== tokenCacheScope(cfg)) return null
    if (hit.ttlInMinutes !== ttlInMinutes) return null
    const left = secondsLeft(hit.expiresAt)
    if (left !== null && left <= TOKEN_CACHE_MARGIN_S) return null
    return hit
  } catch {
    return null
  }
}

async function cacheUserToken(env: Env | undefined, value: CachedToken): Promise<void> {
  if (!env?.CACHE?.put) return
  const ttlSeconds = value.ttlInMinutes * 60
  // A cache window shorter than the safety margin buys nothing and can serve a
  // token that dies one second later (W-008).
  if (ttlSeconds <= TOKEN_CACHE_MARGIN_S) return
  const cfg = getConfig(env)
  try {
    await env.CACHE.put(
      tokenCacheKey(cfg, value.clientKey, value.ttlInMinutes),
      JSON.stringify({ ...value, scope: tokenCacheScope(cfg) }),
      { expirationTtl: Math.max(60, ttlSeconds - TOKEN_CACHE_MARGIN_S) },
    )
  } catch {
    /* KV unavailable (unit tests / local) — caching is best-effort */
  }
}

app.post('/api/array/usertoken', async (c) => {
  const v = parse(userTokenSchema, body(c), 'body')
  if (!v.ok) return c.json(v.response, 400)
  try {
    const hit = wantsRefresh(c.req.query('refresh'))
      ? null
      : await cachedUserToken(c.env, v.data.clientKey, v.data.ttlInMinutes)
    if (hit?.userToken) {
      const { scope: _scope, ...rest } = hit
      return c.json({ ...rest, cached: true })
    }

    const res = await provider(c.env).createUserToken(v.data)
    await cacheUserToken(c.env, {
      userToken: res.userToken,
      clientKey: res.clientKey,
      ttlInMinutes: res.ttlInMinutes,
      expiresAt: res.expiresAt,
    })
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

/**
 * Parse a stored `api_calls` column. A row written by an older/broken build
 * must never take down the whole Inspector: fall back to the raw text tagged
 * as unparseable instead of throwing.
 */
function safeJson(raw: string | null | undefined): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return { _unparseable: true, raw: raw.slice(0, 4000) }
  }
}

app.get('/api/inspector', async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50) || 50, 1), 200)
  const offset = Math.max(Number(c.req.query('offset') ?? 0) || 0, 0)
  if (!c.env?.DB) return c.json({ calls: [], total: 0, limit, offset })
  const { rows, total } = await db.listApiCalls(c.env.DB, limit, offset)
  return c.json({
    calls: rows.map((r) => ({
      ...r,
      request: safeJson(r.request),
      response: safeJson(r.response),
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
