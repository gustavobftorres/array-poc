export interface Status {
  mode: 'mock' | 'sandbox'
  /** ARRAY_APP_KEY presente. */
  hasAppKey: boolean
  /** ARRAY_SERVER_TOKEN (ou o alias ARRAY_CLIENT_TOKEN) presente. */
  hasServerToken: boolean
  arrayEnv: 'sandbox' | 'production'
  baseUrl: string
  /** De onde saiu a base: override explícito ou derivada do ARRAY_ENV. */
  baseUrlSource: 'ARRAY_BASE_URL' | 'ARRAY_ENV'
  componentsCdn: string
  /** Trava do ARRAY_AUTH_MODE: em `browser` o client token nunca é anexado. */
  authMode: 'server' | 'browser'
  productCode: string
  poll: { intervalSeconds: number; timeoutSeconds: number; unit: string; unitInferred: boolean }
  identity: {
    slug: string | null
    label: string
    source: 'default' | 'persona' | 'json'
    confidence: 'verified' | 'unverified'
    note: string
    sandboxOnly: boolean
  }
  webhook: {
    listenerUrl: string | null
    localPath: string | null
    configured: boolean
    secretInPathInferred: boolean
    registrationIsManual: boolean
  }
  /** Nomes deprecados e valores inválidos encontrados no ambiente. */
  warnings: string[]
  appKey: string
  users: number
}

export interface Persona {
  slug: string
  label: string
  firstName: string
  lastName: string
  dob: string
  ssn: string | null
  ssnLast4: string
  address: { street: string; city: string; state: string; zip: string }
  confidence: 'verified' | 'unverified'
  note: string
}

export interface PersonasPage {
  personas: Persona[]
  active: Persona & { source: string }
  sandboxOnly: boolean
  arrayEnv: string
  warning: string
}

export interface WebhookEvent {
  id: string
  received_at: string
  event_type: string
  client_key: string | null
  report_key: string | null
  source: string
  payload: unknown
}

export interface WebhookConfig {
  listenerUrl: string | null
  configured: boolean
  localPath: string
  registrationIsManual: boolean
  registrationNote: string
  secretInPathInferred: boolean
  signatureFromArray: boolean
}

export interface ApiError {
  message: string
  kind?: string
  hint?: string
  error?: { value: string; message: string; param: string; location: string }[]
  upstream?: unknown
}

export class HttpError extends Error {
  constructor(readonly status: number, readonly payload: ApiError) {
    super(payload?.message || `HTTP ${status}`)
  }
}

/**
 * Concurrent identical GETs are collapsed into one network call. React's
 * StrictMode double-mounts every effect in dev, which otherwise doubled every
 * read and polluted the audit log.
 */
const inFlight = new Map<string, Promise<unknown>>()

/**
 * Paths whose answer is stable enough to be reused for a moment. StrictMode
 * double-mounts every effect in dev, and the two mounts are SEQUENTIAL, so the
 * in-flight dedupe above never collapsed them: every page load asked
 * `/status` twice (W-014 / V-008).
 */
const MICRO_CACHE_PATHS = new Set(['/status'])
const MICRO_CACHE_MS = 2000
const microCache = new Map<string, { at: number; value: unknown }>()

/** Drops the memo so an explicit "Recarregar status" always hits the worker. */
export function invalidateStatusCache(): void {
  microCache.delete('/status')
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase()
  if (method === 'GET') {
    if (MICRO_CACHE_PATHS.has(path)) {
      const memo = microCache.get(path)
      if (memo && Date.now() - memo.at < MICRO_CACHE_MS) return memo.value as T
    }
    const pending = inFlight.get(path) as Promise<T> | undefined
    if (pending) return pending
    const p = doRequest<T>(path, init)
      .then((value) => {
        if (MICRO_CACHE_PATHS.has(path)) microCache.set(path, { at: Date.now(), value })
        return value
      })
      .finally(() => inFlight.delete(path))
    inFlight.set(path, p)
    return p
  }
  return doRequest<T>(path, init)
}

async function doRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { message: text.slice(0, 500) || 'Resposta não-JSON' }
  }
  if (!res.ok) throw new HttpError(res.status, json as ApiError)
  return json as T
}

const qs = (params: Record<string, string | number | undefined>) => {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') sp.set(k, String(v))
  const s = sp.toString()
  return s ? `?${s}` : ''
}

export const api = {
  status: () => request<Status>('/status'),
  seed: () => request<Record<string, unknown>>('/seed', { method: 'POST' }),

  createUser: (body: unknown) => request<{ clientKey: string; userId?: string; appKey: string }>('/array/user', { method: 'POST', body: JSON.stringify(body) }),
  /**
   * The route pages since ciclo 7 (`limit` 1-200, default 50, plus `offset`)
   * and returns the real `total`. The UI MUST read `total`: deducing the count
   * from the page length made the Dashboard announce 50 users with 57 in the
   * D1 (Y-006).
   */
  users: (params: { limit?: number; offset?: number } = {}) =>
    request<{ users: Record<string, unknown>[]; total: number; limit: number; offset: number }>(
      `/array/users${qs({ limit: params.limit, offset: params.offset })}`,
    ),
  resolveUser: (userToken: string) => request<{ userId: string; clientKey: string }>(`/array/user${qs({ userToken })}`),

  kbaQuestions: (clientKey: string) =>
    request<{ authToken: string; clientKey: string; questions: { questionId: string; question: string; answers: { answerId: string; answer: string }[] }[] }>(
      `/array/authenticate${qs({ clientKey })}`,
    ),
  answerKba: (body: { clientKey: string; authToken: string; answers: Record<string, string> }) =>
    request<{ userToken: string; status: string; ttlInMinutes?: number }>('/array/authenticate', { method: 'POST', body: JSON.stringify(body) }),
  userToken: (body: { clientKey: string; ttlInMinutes: number }) =>
    request<{ userToken: string; ttlInMinutes: number; expiresAt: string; appKey: string }>('/array/usertoken', { method: 'POST', body: JSON.stringify(body) }),

  orderReport: (body: { clientKey: string; productCode?: string; simulate?: string }) =>
    request<{ reportKey: string; displayToken: string; productCode: string; simulate?: string }>('/array/report', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getReport: (p: { reportKey: string; displayToken: string; clientKey?: string }) => request<CreditReport>(`/array/report${qs(p)}`),
  refreshDisplayToken: (body: { clientKey: string; reportKey: string }) =>
    request<{ reportKey: string; displayToken: string }>('/array/report', { method: 'PUT', body: JSON.stringify(body) }),
  reports: (clientKey?: string) => request<{ reports: Record<string, unknown>[] }>(`/array/reports${qs({ clientKey })}`),

  alerts: (clientKey: string, bureau?: string) => request<{ alerts: Alert[] }>(`/array/alerts${qs({ clientKey, bureau })}`),
  monitoring: (clientKey: string) => request<{ enrollments: Enrollment[] }>(`/array/monitoring${qs({ clientKey })}`),
  scoreTracker: (clientKey: string) => request<{ history: { month: string; score: number }[] }>(`/array/scoretracker${qs({ clientKey })}`),

  personas: () => request<PersonasPage>('/personas'),

  webhookConfig: () => request<WebhookConfig>('/webhooks/config'),
  webhookEvents: (limit = 50) => request<{ events: WebhookEvent[]; total: number }>(`/webhooks/events${qs({ limit })}`),
  simulateWebhook: (body?: unknown) =>
    request<{ received: boolean; simulated: boolean; eventType: string }>('/webhooks/simulate', {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
  clearWebhookEvents: () => request<{ cleared: boolean }>('/webhooks/events', { method: 'DELETE' }),

  inspector: (limit = 50, offset = 0) => request<InspectorPage>(`/inspector${qs({ limit, offset })}`),
  clearInspector: () => request<{ cleared: boolean }>('/inspector', { method: 'DELETE' }),
}

export interface Tradeline {
  bureau: string
  creditorName: string
  accountType: string
  accountNumber: string
  opened: string
  balance: number
  creditLimit: number
  monthlyPayment: number
  status: string
  paymentHistory: string[]
}

export interface CreditReport {
  reportKey: string
  productCode: string
  clientKey: string
  generatedAt: string
  score: number
  scoreModel: string
  scores: { bureau: string; model: string; score: number; range: [number, number] }[]
  scoreHistory: { month: string; score: number }[]
  factors: { code: string; label: string; impact: string; direction: string; description: string }[]
  summary: Record<string, number>
  tradelines: Tradeline[]
  inquiries: { bureau: string; subscriberName: string; date: string; type: string }[]
  collections: { bureau: string; agency: string; originalCreditor: string; amount: number; status: string; reported: string }[]
  consumer?: { firstName: string; lastName: string; ssnLast4: string; address: Record<string, string> }
}

export interface Alert {
  alertId: string
  bureau: string
  type: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  title: string
  description: string
  createdAt: string
  read: boolean
}

export interface Enrollment {
  enrollmentId: string
  bureau: string
  product: string
  status: string
  enrolledAt: string
}

export interface ApiCall {
  id: string
  ts: string
  method: string
  path: string
  status: number
  duration_ms: number
  request: unknown
  response: unknown
  mode: string
}

export interface InspectorPage {
  calls: ApiCall[]
  total: number
  limit: number
  offset: number
}
