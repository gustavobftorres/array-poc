export interface Status {
  mode: 'mock' | 'sandbox'
  hasAuthId: boolean
  hasAuthToken: boolean
  arrayEnv: 'sandbox' | 'production'
  baseUrl: string
  componentsCdn: string
  appKey: string
  users: number
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
  users: () => request<{ users: Record<string, unknown>[] }>('/array/users'),
  resolveUser: (userToken: string) => request<{ userId: string; clientKey: string }>(`/array/user${qs({ userToken })}`),

  kbaQuestions: (clientKey: string) =>
    request<{ authToken: string; clientKey: string; questions: { questionId: string; question: string; answers: { answerId: string; answer: string }[] }[] }>(
      `/array/authenticate${qs({ clientKey })}`,
    ),
  answerKba: (body: { clientKey: string; authToken: string; answers: Record<string, string> }) =>
    request<{ userToken: string; status: string; ttlInMinutes?: number }>('/array/authenticate', { method: 'POST', body: JSON.stringify(body) }),
  userToken: (body: { clientKey: string; ttlInMinutes: number }) =>
    request<{ userToken: string; ttlInMinutes: number; expiresAt: string; appKey: string }>('/array/usertoken', { method: 'POST', body: JSON.stringify(body) }),

  orderReport: (body: { clientKey: string; productCode: string }) =>
    request<{ reportKey: string; displayToken: string; productCode: string }>('/array/report', { method: 'POST', body: JSON.stringify(body) }),
  getReport: (p: { reportKey: string; displayToken: string; clientKey?: string }) => request<CreditReport>(`/array/report${qs(p)}`),
  refreshDisplayToken: (body: { clientKey: string; reportKey: string }) =>
    request<{ reportKey: string; displayToken: string }>('/array/report', { method: 'PUT', body: JSON.stringify(body) }),
  reports: (clientKey?: string) => request<{ reports: Record<string, unknown>[] }>(`/array/reports${qs({ clientKey })}`),

  alerts: (clientKey: string, bureau?: string) => request<{ alerts: Alert[] }>(`/array/alerts${qs({ clientKey, bureau })}`),
  monitoring: (clientKey: string) => request<{ enrollments: Enrollment[] }>(`/array/monitoring${qs({ clientKey })}`),
  scoreTracker: (clientKey: string) => request<{ history: { month: string; score: number }[] }>(`/array/scoretracker${qs({ clientKey })}`),

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
