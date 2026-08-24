/**
 * Real Array API client.
 *
 * Paths follow docs/ARRAY_API_RESEARCH.md. Endpoints whose HTTP path could not
 * be confirmed from a first-party source are marked `// UNVERIFIED path`.
 *
 * The client token (`x-credmo-client-token`) is NEVER logged or returned.
 */
import type {
  Alert,
  GetReportArgs,
  AnswerKbaResult,
  ArrayProvider,
  CreateUserInput,
  CreateUserResult,
  CreditReport,
  KbaQuestionsResult,
  MonitoringEnrollment,
  OrderReportResult,
  ScoreHistoryPoint,
  UserTokenResult,
} from './types'
import { ArrayApiError } from './types'
import { pollReport, type PollOptions } from './poll'

export interface ClientOptions {
  baseUrl: string
  appKey: string
  /** `x-credmo-client-token` — o segredo de servidor (ARRAY_SERVER_TOKEN). */
  clientToken: string
  /**
   * Trava explícita do ARRAY_AUTH_MODE. Em `browser` o client token NUNCA é
   * anexado: uma chamada sem `userToken` falha em vez de vazar o segredo.
   */
  authMode?: 'server' | 'browser'
  /** Defaults de polling do relatório (ARRAY_POLL_*). */
  pollIntervalMs?: number
  pollTimeoutMs?: number
  timeoutMs?: number
  attempts?: number
  fetchImpl?: typeof fetch
  /** Injetável nos testes do loop de polling. */
  sleepImpl?: (ms: number) => Promise<void>
}

const DEFAULT_TIMEOUT_MS = 12_000
const DEFAULT_ATTEMPTS = 3
const DEFAULT_POLL_INTERVAL_MS = 1_000
const DEFAULT_POLL_TIMEOUT_MS = 120_000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface RequestSpec {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  query?: Record<string, string | undefined>
  body?: unknown
  /** Use the consumer's user token instead of the server client token. */
  userToken?: string
  /** Skip client-token header entirely (public capability-token calls). */
  anonymous?: boolean
}

export class ArrayClient implements ArrayProvider {
  readonly mode = 'sandbox' as const
  readonly authMode: 'server' | 'browser'
  private readonly timeoutMs: number
  private readonly attempts: number
  private readonly fetchImpl: typeof fetch

  constructor(private readonly opts: ClientOptions) {
    this.authMode = opts.authMode ?? 'server'
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.attempts = opts.attempts ?? DEFAULT_ATTEMPTS
    // Must be bound: calling an unbound `fetch` as a method throws
    // "Illegal invocation" inside workerd.
    this.fetchImpl = (opts.fetchImpl ?? fetch).bind(globalThis)
  }

  // -- transport ------------------------------------------------------------

  private buildUrl(path: string, query?: Record<string, string | undefined>): string {
    const url = new URL(this.opts.baseUrl.replace(/\/+$/, '') + path)
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== '') url.searchParams.set(k, v)
    }
    return url.toString()
  }

  /**
   * INVARIANTE do ARRAY_AUTH_MODE (não é convenção: é testado).
   *  - `server`  → `x-credmo-client-token`, salvo quando a chamada traz um
   *                userToken (aí ele manda) ou é anônima (capability token).
   *  - `browser` → SOMENTE `x-credmo-user-token`. O client token não pode ser
   *                anexado nem por engano; sem userToken a chamada FALHA.
   */
  headers(spec: RequestSpec): Record<string, string> {
    const h: Record<string, string> = {
      accept: 'application/json',
      'Content-Type': 'application/json',
    }
    if (spec.userToken) {
      h['x-credmo-user-token'] = spec.userToken
      return h
    }
    if (spec.anonymous) return h
    if (this.authMode === 'browser') {
      throw new ArrayApiError(
        `ARRAY_AUTH_MODE=browser: ${spec.method} ${spec.path} exige x-credmo-user-token e o client token NUNCA pode ser anexado neste modo. ` +
          'Emita um userToken (POST /authenticate/v2/usertoken) e repasse-o, ou volte para ARRAY_AUTH_MODE=server.',
        400,
        { authMode: this.authMode, path: spec.path },
        'auth_mode',
      )
    }
    h['x-credmo-client-token'] = this.opts.clientToken
    return h
  }

  /** Perform a request with timeout + exponential backoff on 5xx/network. */
  private async request<T>(spec: RequestSpec): Promise<T> {
    const url = this.buildUrl(spec.path, spec.query)
    let lastError: ArrayApiError | undefined

    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.timeoutMs)
      try {
        const res = await this.fetchImpl(url, {
          method: spec.method,
          headers: this.headers(spec),
          body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
          signal: controller.signal,
        })

        const text = await res.text()
        let parsed: unknown = undefined
        try {
          parsed = text ? JSON.parse(text) : undefined
        } catch {
          parsed = { raw: text.slice(0, 2000) }
        }

        if (res.ok) return parsed as T

        const message =
          (parsed && typeof parsed === 'object' && 'message' in parsed
            ? String((parsed as { message: unknown }).message)
            : undefined) ?? `Array API ${res.status}`

        // The egress proxy of a locked-down environment answers 403/407 itself;
        // that is a blocked host, not an Array-side rejection.
        const proxyBlocked =
          (res.status === 403 || res.status === 407 || res.status === 405) &&
          !(parsed && typeof parsed === 'object' && 'message' in parsed)
        const err = new ArrayApiError(
          proxyBlocked ? `Host ${new URL(url).host} bloqueado pelo proxy de egresso (HTTP ${res.status})` : message,
          res.status,
          parsed,
          proxyBlocked ? 'blocked' : 'http',
        )
        // Retry only on transient server-side failures.
        if (res.status >= 500 && attempt < this.attempts) {
          lastError = err
          await sleep(2 ** (attempt - 1) * 400)
          continue
        }
        throw err
      } catch (e) {
        if (e instanceof ArrayApiError) throw e
        const aborted = e instanceof Error && e.name === 'AbortError'
        const msg = e instanceof Error ? e.message : String(e)
        // This environment's egress proxy blocks array.io — surface it clearly.
        const blocked = /403|405|407|blocked|forbidden|proxy|ENOTFOUND|EAI_AGAIN|certificate/i.test(msg)
        const err = new ArrayApiError(
          aborted ? `Timeout after ${this.timeoutMs}ms calling ${spec.method} ${spec.path}` : `Network error calling ${spec.method} ${spec.path}: ${msg}`,
          aborted ? 504 : 502,
          { message: msg, url: this.buildUrl(spec.path) },
          aborted ? 'timeout' : blocked ? 'blocked' : 'network',
        )
        if (attempt < this.attempts) {
          lastError = err
          await sleep(2 ** (attempt - 1) * 400)
          continue
        }
        throw err
      } finally {
        clearTimeout(timer)
      }
    }
    throw lastError ?? new ArrayApiError('Unknown Array API failure', 502, undefined, 'network')
  }

  /**
   * Uma tentativa de leitura do relatório, SEM tratar 202/204 como erro — o
   * loop de polling decide (array/poll.ts). Erros de rede/timeout e 4xx/5xx
   * continuam virando ArrayApiError.
   */
  private async reportAttempt(reportKey: string, displayToken: string): Promise<{ status: number; body?: unknown }> {
    const url = this.buildUrl('/report/v2', { reportKey, displayToken })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await this.fetchImpl(url, {
        method: 'GET',
        // capability tokens na query SÃO a autenticação desta leitura
        headers: this.headers({ method: 'GET', path: '/report/v2', anonymous: true }),
        signal: controller.signal,
      })
      if (res.status === 202 || res.status === 204) return { status: res.status }
      const text = await res.text()
      let parsed: unknown = undefined
      try {
        parsed = text ? JSON.parse(text) : undefined
      } catch {
        parsed = { raw: text.slice(0, 2000) }
      }
      if (!res.ok) {
        const message =
          (parsed && typeof parsed === 'object' && 'message' in parsed
            ? String((parsed as { message: unknown }).message)
            : undefined) ?? `Array API ${res.status}`
        const proxyBlocked =
          (res.status === 403 || res.status === 407 || res.status === 405) &&
          !(parsed && typeof parsed === 'object' && 'message' in parsed)
        throw new ArrayApiError(
          proxyBlocked ? `Host ${new URL(url).host} bloqueado pelo proxy de egresso (HTTP ${res.status})` : message,
          res.status,
          parsed,
          proxyBlocked ? 'blocked' : 'http',
        )
      }
      return { status: 200, body: parsed }
    } catch (e) {
      if (e instanceof ArrayApiError) throw e
      const aborted = e instanceof Error && e.name === 'AbortError'
      const msg = e instanceof Error ? e.message : String(e)
      const blocked = /403|405|407|blocked|forbidden|proxy|ENOTFOUND|EAI_AGAIN|certificate/i.test(msg)
      throw new ArrayApiError(
        aborted ? `Timeout after ${this.timeoutMs}ms calling GET /report/v2` : `Network error calling GET /report/v2: ${msg}`,
        aborted ? 504 : 502,
        { message: msg },
        aborted ? 'timeout' : blocked ? 'blocked' : 'network',
      )
    } finally {
      clearTimeout(timer)
    }
  }

  // -- users ---------------------------------------------------------------

  /** POST /user/v2 — create a consumer. Returns `clientKey`. */
  async createUser(input: CreateUserInput): Promise<CreateUserResult> {
    const res = await this.request<Record<string, unknown>>({
      method: 'POST',
      path: '/user/v2',
      body: { appKey: this.opts.appKey, ...input },
    })
    const clientKey = String(res.clientKey ?? res.userId ?? '')
    if (!clientKey) throw new ArrayApiError('Array response missing clientKey', 502, res)
    return { clientKey, userId: res.userId ? String(res.userId) : clientKey, appKey: this.opts.appKey, status: 'created' }
  }

  /** GET /user/v2 — resolve the userId for a user token. */
  async getUserByToken(userToken: string) {
    const res = await this.request<Record<string, unknown>>({
      method: 'GET',
      path: '/user/v2',
      userToken,
    })
    return {
      userId: String(res.userId ?? res.id ?? ''),
      clientKey: String(res.clientKey ?? res.userId ?? ''),
    }
  }

  // -- authentication (KBA) -------------------------------------------------

  /** GET /authenticate/v2 — retrieve KBA questions (returns authToken). */
  async getKbaQuestions({ clientKey }: { clientKey: string }): Promise<KbaQuestionsResult> {
    const res = await this.request<Record<string, unknown>>({
      method: 'GET',
      path: '/authenticate/v2',
      query: { appKey: this.opts.appKey, clientKey },
    })
    return {
      authToken: String(res.authToken ?? ''),
      clientKey,
      questions: (res.questions as KbaQuestionsResult['questions']) ?? [],
    }
  }

  /** POST /authenticate/v2 — answer KBA questions, returns the userToken. */
  async answerKba(args: { clientKey: string; authToken: string; answers: Record<string, string> }): Promise<AnswerKbaResult> {
    const res = await this.request<Record<string, unknown>>({
      method: 'POST',
      path: '/authenticate/v2',
      body: { appKey: this.opts.appKey, ...args },
    })
    return {
      userToken: String(res.userToken ?? ''),
      clientKey: args.clientKey,
      authToken: args.authToken,
      status: String(res.status ?? 'authenticated'),
      ttlInMinutes: typeof res.ttlInMinutes === 'number' ? res.ttlInMinutes : undefined,
    }
  }

  /**
   * POST /authenticate/v2/usertoken — mint/renew a short-lived user token.
   * This is what feeds the `userToken` attribute of the web components.
   */
  async createUserToken({ clientKey, ttlInMinutes }: { clientKey: string; ttlInMinutes: number }): Promise<UserTokenResult> {
    const res = await this.request<Record<string, unknown>>({
      method: 'POST',
      path: '/authenticate/v2/usertoken',
      body: { appKey: this.opts.appKey, clientKey, ttlInMinutes },
    })
    const userToken = String(res.userToken ?? res.authToken ?? '')
    return {
      appKey: this.opts.appKey,
      clientKey,
      userToken,
      ttlInMinutes: typeof res.ttlInMinutes === 'number' ? res.ttlInMinutes : ttlInMinutes,
      expiresAt: new Date(Date.now() + ttlInMinutes * 60_000).toISOString(),
    }
  }

  // -- reports --------------------------------------------------------------

  /** POST /report/v2 — order a report. Returns reportKey + displayToken. */
  async orderReport({ clientKey, productCode }: { clientKey: string; productCode: string }): Promise<OrderReportResult> {
    const res = await this.request<Record<string, unknown>>({
      method: 'POST',
      path: '/report/v2',
      body: { appKey: this.opts.appKey, clientKey, productCode },
    })
    return {
      reportKey: String(res.reportKey ?? ''),
      displayToken: String(res.displayToken ?? ''),
      productCode,
      clientKey,
    }
  }

  /**
   * GET /report/v2?reportKey&displayToken — com o POLLING documentado:
   * 202 = ainda gerando (repetir), 200 = pronto, 204 = falha PERMANENTE
   * (aborta na hora). Ver array/poll.ts.
   *
   * Os tokens valem UMA recuperação bem-sucedida (VERIFICADO): eles seguem
   * válidos durante os 202, mas depois do 200 é preciso renovar com
   * `PUT /report/v2` para reler.
   */
  async getReport({ reportKey, displayToken, poll }: GetReportArgs): Promise<CreditReport> {
    const opts: PollOptions = {
      intervalMs: poll?.intervalMs ?? this.opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      timeoutMs: poll?.timeoutMs ?? this.opts.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS,
      sleep: this.opts.sleepImpl,
    }
    const { value } = await pollReport<Record<string, unknown>>(
      () => this.reportAttempt(reportKey, displayToken),
      opts,
    )
    // Array's report envelope is far richer than the POC's view model; the raw
    // payload is always returned alongside so nothing is silently dropped.
    return value as unknown as CreditReport
  }

  /** PUT /report/v2 — refresh an expired displayToken. */
  async refreshDisplayToken({ clientKey, reportKey }: { clientKey: string; reportKey: string }) {
    const res = await this.request<Record<string, unknown>>({
      method: 'PUT',
      path: '/report/v2',
      body: { clientKey, reportKey },
    })
    return { reportKey, displayToken: String(res.displayToken ?? '') }
  }

  /**
   * GET /report/v2/scoretracker — score history.
   * // UNVERIFIED path (derived from the /reference/get-report-scoretracker slug)
   */
  async getScoreTracker({ clientKey }: { clientKey: string }): Promise<{ clientKey: string; history: ScoreHistoryPoint[] }> {
    const res = await this.request<Record<string, unknown>>({
      method: 'GET',
      path: '/report/v2/scoretracker', // UNVERIFIED path
      query: { appKey: this.opts.appKey, clientKey },
    })
    return { clientKey, history: (res.history as ScoreHistoryPoint[]) ?? (res.scores as ScoreHistoryPoint[]) ?? [] }
  }

  // -- alerts / monitoring --------------------------------------------------

  /**
   * GET /alert/v2?clientKey&bureau — retrieve alert IDs.
   * // UNVERIFIED path (operation verified via /reference/retrieve-alerts, path inferred)
   */
  async getAlerts({ clientKey, bureau }: { clientKey: string; bureau?: string }): Promise<{ alerts: Alert[] }> {
    const res = await this.request<Record<string, unknown>>({
      method: 'GET',
      path: '/alert/v2', // UNVERIFIED path
      query: { appKey: this.opts.appKey, clientKey, bureau },
    })
    return { alerts: (res.alerts as Alert[]) ?? [] }
  }

  /**
   * GET /alert/v2/{alertId} — alert details.
   * // UNVERIFIED path (operation verified via /reference/retrieve-alert-details)
   */
  async getAlertDetails({ alertId, clientKey }: { alertId: string; clientKey?: string }): Promise<Alert> {
    const res = await this.request<Record<string, unknown>>({
      method: 'GET',
      path: `/alert/v2/${encodeURIComponent(alertId)}`, // UNVERIFIED path
      query: { appKey: this.opts.appKey, clientKey },
    })
    return res as unknown as Alert
  }

  /**
   * GET /monitoring/v2?clientKey — monitoring enrollments.
   * // UNVERIFIED path (operation verified via /reference/retrieve-monitoring-enrollments)
   */
  async getMonitoringEnrollments({ clientKey }: { clientKey: string }): Promise<{ enrollments: MonitoringEnrollment[] }> {
    const res = await this.request<Record<string, unknown>>({
      method: 'GET',
      path: '/monitoring/v2', // UNVERIFIED path
      query: { appKey: this.opts.appKey, clientKey },
    })
    return { enrollments: (res.enrollments as MonitoringEnrollment[]) ?? [] }
  }
}
