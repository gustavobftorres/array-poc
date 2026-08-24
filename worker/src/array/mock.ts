/**
 * Deterministic mock provider. Everything is derived from the clientKey so the
 * same consumer always sees the same report, alerts and score history.
 * Shapes mirror docs/ARRAY_API_RESEARCH.md; values are fictitious.
 */
import type {
  Alert,
  AnswerKbaResult,
  ArrayProvider,
  CreateUserInput,
  CreateUserResult,
  CreditReport,
  KbaQuestionsResult,
  MonitoringEnrollment,
  OrderReportResult,
  ScoreFactor,
  ScoreHistoryPoint,
  Tradeline,
  UserTokenResult,
} from './types'
import { ArrayApiError } from './types'
import { ssnLast4 } from '../redact'
import { calendarAge, monthsAgoISO } from '../dates'

/**
 * Placeholder appKey for mock mode. Array's embed loader validates
 * `appKey.length === 36`, so this has to be exactly UUID-shaped (8-4-4-4-12)
 * or every snippet copied out of the Playground would fail silently.
 */
export const MOCK_APP_KEY = 'MOCK0000-0000-4000-8000-MOCKAPPKEY00'
export const MOCK_BASE_SCORE = 712

/** Stable 32-bit hash — deterministic across runs (no Math.random anywhere). */
function hash(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Deterministic pseudo-random in [0,1) from a seed + salt. */
function rand(seed: string, salt: string): number {
  return hash(`${seed}::${salt}`) / 0xffffffff
}

function pick<T>(seed: string, salt: string, items: readonly T[]): T {
  return items[Math.floor(rand(seed, salt) * items.length) % items.length]
}

function int(seed: string, salt: string, min: number, max: number): number {
  return min + Math.floor(rand(seed, salt) * (max - min + 1))
}

/** Deterministic UUID-shaped key derived from a seed. */
export function mockUuid(seed: string): string {
  const hex = (s: string, n: number) =>
    hash(`${seed}:${s}`).toString(16).padStart(8, '0').repeat(2).slice(0, n)
  return [hex('a', 8), hex('b', 4), hex('c', 4), hex('d', 4), hex('e', 12)].join('-').toUpperCase()
}

/** Window used by the "consultas hard (6 meses)" tile and the INQUIRIES factor. */
export const INQUIRY_WINDOW_MONTHS = 6

/** Fixed "now" anchor keeps fixtures stable inside a single month. */
function monthsBack(n: number, from = new Date()): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - n, 1))
  return d.toISOString().slice(0, 7)
}

const CREDITORS = [
  { name: 'CAPITAL ONE', type: 'Credit Card' },
  { name: 'CHASE CARD SERVICES', type: 'Credit Card' },
  { name: 'AMEX', type: 'Charge Card' },
  { name: 'TOYOTA FINANCIAL SVC', type: 'Auto Loan' },
  { name: 'WELLS FARGO HOME MTG', type: 'Mortgage' },
  { name: 'DISCOVER BANK', type: 'Credit Card' },
  { name: 'NAVIENT', type: 'Student Loan' },
  { name: 'SYNCHRONY BANK', type: 'Revolving' },
] as const

const BUREAUS = ['TransUnion', 'Experian', 'Equifax'] as const

/**
 * Only these account types carry a revolving credit limit, so only they may
 * enter the "limite total (rotativo)" and the utilization ratio. A student
 * loan is amortized debt with a disbursed amount, not a revolving line (W-005).
 */
export const REVOLVING_TYPES = ['Credit Card', 'Charge Card', 'Revolving'] as const
export function isRevolvingType(accountType: string): boolean {
  return (REVOLVING_TYPES as readonly string[]).includes(accountType)
}

/** How long ago the (optional) collection account was reported. */
const COLLECTION_MONTHS_AGO = 19

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

/**
 * 12 monthly points that END at the canonical score. The drift is damped by
 * how far back the month is, so the series converges instead of being yanked
 * to `MOCK_BASE_SCORE` in the last month — which produced the implausible
 * "712 -> 681 -> 712" shape with nothing in the report to explain it (W-011).
 */
export function mockScoreHistory(clientKey: string): ScoreHistoryPoint[] {
  const out: ScoreHistoryPoint[] = []
  for (let i = 11; i >= 0; i--) {
    const damp = i / 11 // 1 at the oldest month, 0 at the current one
    const trend = i * 1.6 // older months sit below today's score
    const drift = (rand(clientKey, `hist${i}`) - 0.5) * 9 * damp
    const score = Math.round(MOCK_BASE_SCORE - trend + drift)
    out.push({ month: monthsBack(i), score: Math.max(300, Math.min(850, score)) })
  }
  return out
}

/** Aggregates the report and its narrative must agree on. */
export interface ReportStats {
  utilization: number
  hardInquiries6mo: number
  collections: number
  oldestAccountYears: number
  collectionsMonthsAgo: number
  onTimePct: number
  /** Tradelines carrying at least one 30/60 mark. */
  delinquentAccounts: number
  /** Total 30/60 marks across every payment history. */
  lateMarks: number
  /** Worst mark seen ('60' | '30' | none). */
  worstLateMark: '30' | '60' | null
}

/**
 * Score factors are written FROM the aggregates, never by hand — otherwise the
 * narrative ("utilização de 41%") contradicts the tiles ("UTILIZATION 75.1")
 * on the very same screen.
 */
export function mockFactors(stats: ReportStats): ScoreFactor[] {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  const all: ScoreFactor[] = [
    {
      // Direction/text come from the delinquency marks too: saying "positivo"
      // next to a tile reading "Contas com atraso 2" was a contradiction on
      // the same screen (W-012).
      code: 'PAYMENT_HISTORY',
      label: 'Histórico de pagamentos',
      impact: 'high',
      direction: stats.lateMarks > 0 ? 'negative' : 'positive',
      description:
        stats.lateMarks > 0
          ? `${stats.onTimePct}% dos pagamentos em dia nos últimos 24 meses, mas ` +
            `${plural(stats.lateMarks, 'marca de atraso', 'marcas de atraso')} em ` +
            `${plural(stats.delinquentAccounts, 'conta', 'contas')}` +
            `${stats.worstLateMark === '60' ? ' (pior marca: 60 dias)' : ''}.`
          : `${stats.onTimePct}% dos pagamentos em dia nos últimos 24 meses, sem nenhuma marca de atraso.`,
    },
    {
      code: 'UTILIZATION',
      label: 'Utilização de crédito rotativo',
      impact: 'high',
      direction: stats.utilization > 30 ? 'negative' : 'positive',
      description:
        stats.utilization > 30
          ? `Utilização de ${stats.utilization}% — acima dos 30% recomendados.`
          : `Utilização de ${stats.utilization}% — dentro dos 30% recomendados.`,
    },
    {
      code: 'CREDIT_AGE',
      label: 'Idade média das contas',
      impact: 'medium',
      direction: 'positive',
      description: `Conta mais antiga com ${stats.oldestAccountYears} anos.`,
    },
    {
      code: 'INQUIRIES',
      label: 'Consultas recentes',
      impact: 'low',
      // Zero hard inquiries inside the window is not a negative factor — saying
      // "negativo: 0 consultas" would be the X-004 contradiction turned inside out.
      direction: stats.hardInquiries6mo > 0 ? 'negative' : 'positive',
      description: `${plural(stats.hardInquiries6mo, 'consulta hard', 'consultas hard')} nos últimos 6 meses.`,
    },
    {
      // "Nenhum registro negativo" may only be said when there is neither a
      // collection NOR a delinquent tradeline (W-012).
      code: 'DEROGATORY',
      label: 'Registros negativos',
      impact: stats.collections > 0 ? 'medium' : stats.delinquentAccounts > 0 ? 'medium' : 'low',
      direction: stats.collections > 0 || stats.delinquentAccounts > 0 ? 'negative' : 'positive',
      description: [
        stats.collections > 0
          ? `${plural(stats.collections, 'conta em cobrança', 'contas em cobrança')} reportada há ${stats.collectionsMonthsAgo} meses.`
          : '',
        stats.delinquentAccounts > 0
          ? `${plural(stats.delinquentAccounts, 'conta com atraso', 'contas com atraso')} no histórico de 24 meses.`
          : '',
      ]
        .filter(Boolean)
        .join(' ') || 'Nenhum registro negativo: nenhuma cobrança e nenhuma marca de atraso.',
    },
    {
      code: 'MIX',
      label: 'Diversidade de crédito',
      impact: 'low',
      direction: 'positive',
      description: 'Mix saudável entre rotativo e parcelado.',
    },
  ]
  return all
}

function paymentHistory(clientKey: string, salt: string): string[] {
  return Array.from({ length: 24 }, (_, i) => {
    const r = rand(clientKey, `${salt}ph${i}`)
    if (r > 0.97) return '60'
    if (r > 0.93) return '30'
    return 'OK'
  })
}

export function mockTradelines(clientKey: string): Tradeline[] {
  const count = int(clientKey, 'tlcount', 5, 7)
  const out: Tradeline[] = []
  for (let i = 0; i < count; i++) {
    const creditor = CREDITORS[(hash(`${clientKey}:tl${i}`) + i) % CREDITORS.length]
    const isRevolving = isRevolvingType(creditor.type)
    const limit = isRevolving ? int(clientKey, `lim${i}`, 1500, 25000) : int(clientKey, `lim${i}`, 12000, 320000)
    const balance = Math.round(limit * (isRevolving ? rand(clientKey, `bal${i}`) * 0.7 : 0.3 + rand(clientKey, `bal${i}`) * 0.5))
    out.push({
      bureau: BUREAUS[i % BUREAUS.length],
      creditorName: creditor.name,
      accountType: creditor.type,
      accountNumber: `****${int(clientKey, `acct${i}`, 1000, 9999)}`,
      opened: `${int(clientKey, `open${i}`, 2012, 2023)}-${String(int(clientKey, `openm${i}`, 1, 12)).padStart(2, '0')}-01`,
      balance,
      creditLimit: limit,
      monthlyPayment: isRevolving ? Math.max(25, Math.round(balance * 0.02)) : int(clientKey, `pay${i}`, 180, 2400),
      status: pick(clientKey, `st${i}`, ['Open / Never late', 'Open / Pays as agreed', 'Open / 30 days late once', 'Closed / Paid'] as const),
      paymentHistory: paymentHistory(clientKey, `tl${i}`),
    })
  }
  return out
}

export function mockReport(clientKey: string, productCode: string, reportKey: string, consumer?: { firstName: string; lastName: string; ssnLast4: string }): CreditReport {
  const tradelines = mockTradelines(clientKey)
  // Every revolving aggregate comes from exactly this set, so the tiles and the
  // utilization ratio can always be reconstructed from the numbers on screen
  // (W-004/W-005).
  const revolving = tradelines.filter((t) => isRevolvingType(t.accountType) && t.creditLimit > 0)
  const installment = tradelines.filter((t) => !isRevolvingType(t.accountType) || t.creditLimit <= 0)
  const totalBalance = tradelines.reduce((s, t) => s + t.balance, 0)
  const revLimit = revolving.reduce((s, t) => s + t.creditLimit, 0)
  const revBalance = revolving.reduce((s, t) => s + t.balance, 0)
  const installmentBalance = installment.reduce((s, t) => s + t.balance, 0)
  const totalLimit = revLimit || 1
  const history = mockScoreHistory(clientKey)

  const inquiries = Array.from({ length: int(clientKey, 'inqc', 2, 4) }, (_, i) => ({
    bureau: BUREAUS[i % BUREAUS.length],
    subscriberName: pick(clientKey, `inqn${i}`, ['ROCKET MORTGAGE', 'AMEX', 'CARVANA', 'SOFI LENDING', 'LENDINGCLUB'] as const),
    date: `${monthsBack(int(clientKey, `inqd${i}`, 1, 6))}-1${i}`,
    type: i === 0 ? 'Hard' : pick(clientKey, `inqt${i}`, ['Hard', 'Soft'] as const),
  }))

  const collections = int(clientKey, 'colc', 0, 1) === 1
    ? [
        {
          bureau: 'Equifax',
          agency: 'MIDLAND CREDIT MGMT',
          originalCreditor: 'VERIZON WIRELESS',
          amount: int(clientKey, 'colamt', 220, 1450),
          status: 'Unpaid',
          reported: `${monthsBack(COLLECTION_MONTHS_AGO)}-05`,
        },
      ]
    : []

  const utilization = revLimit > 0 ? Math.round((revBalance / revLimit) * 1000) / 10 : 0
  // The tile is labelled "6 meses": count only what is INSIDE that window.
  // Counting every hard inquiry put a "2" next to a table showing dates 6 months
  // and 13 days old — the same tile-vs-table contradiction as W-004 (X-004).
  const sixMonthsAgo = monthsAgoISO(INQUIRY_WINDOW_MONTHS)
  const hardInquiries6mo = inquiries.filter((i) => i.type === 'Hard' && i.date >= sixMonthsAgo).length
  // Whole years by CALENDAR, exactly like the DOB rule: subtracting years alone
  // turned an account opened 2012-12-01 into "14 anos" on 2026-08-23 (X-005).
  const oldestOpened = tradelines
    .map((t) => t.opened)
    .sort()[0]
  const oldestAccountYears = Math.max(1, calendarAge(oldestOpened))
  const onTimeSlots = tradelines.flatMap((t) => t.paymentHistory)
  const onTimePct = onTimeSlots.length
    ? Math.round((onTimeSlots.filter((p) => p === 'OK').length / onTimeSlots.length) * 100)
    : 100
  const lateMarks = onTimeSlots.filter((p) => p !== 'OK').length
  const delinquentAccounts = tradelines.filter((t) => t.paymentHistory.some((p) => p !== 'OK')).length
  const worstLateMark = onTimeSlots.includes('60') ? '60' : onTimeSlots.includes('30') ? '30' : null
  const stats: ReportStats = {
    utilization,
    hardInquiries6mo,
    collections: collections.length,
    oldestAccountYears,
    collectionsMonthsAgo: COLLECTION_MONTHS_AGO,
    onTimePct,
    delinquentAccounts,
    lateMarks,
    worstLateMark,
  }

  return {
    reportKey,
    productCode,
    clientKey,
    generatedAt: new Date().toISOString(),
    consumer: {
      firstName: consumer?.firstName ?? 'BANKER',
      lastName: consumer?.lastName ?? 'COLDIRON',
      ssnLast4: consumer?.ssnLast4 ?? '0560',
      address: { street: '3627 CALIFORNIA ST', city: 'GRAND PRAIRIE', state: 'TX', zip: '75052' },
    },
    score: MOCK_BASE_SCORE,
    scoreModel: 'VantageScore 3.0',
    scores: [
      { bureau: 'TransUnion', model: 'VantageScore 3.0', score: MOCK_BASE_SCORE, range: [300, 850] },
      { bureau: 'Experian', model: 'VantageScore 3.0', score: MOCK_BASE_SCORE + int(clientKey, 'expd', -14, 12), range: [300, 850] },
      { bureau: 'Equifax', model: 'VantageScore 3.0', score: MOCK_BASE_SCORE + int(clientKey, 'efxd', -18, 9), range: [300, 850] },
    ],
    scoreHistory: history,
    factors: mockFactors(stats),
    summary: {
      totalAccounts: tradelines.length,
      openAccounts: tradelines.filter((t) => t.status.startsWith('Open')).length,
      totalBalance,
      // The utilization pair, side by side, so `revolvingBalance /
      // revolvingLimit` reproduces `utilization` exactly (W-004).
      revolvingBalance: revBalance,
      revolvingLimit: revLimit,
      utilization,
      installmentBalance,
      revolvingAccounts: revolving.length,
      delinquencies: delinquentAccounts,
      inquiries6mo: hardInquiries6mo,
      oldestAccountYears,
    },
    tradelines,
    inquiries,
    collections,
  }
}

export function mockKbaQuestions(clientKey: string): KbaQuestionsResult {
  return {
    authToken: mockUuid(`auth:${clientKey}`),
    clientKey,
    questions: [
      {
        questionId: 'Q1',
        question: 'Em qual das ruas abaixo você já morou?',
        answers: [
          { answerId: 'Q1A1', answer: 'CALIFORNIA ST' },
          { answerId: 'Q1A2', answer: 'MAPLE AVE' },
          { answerId: 'Q1A3', answer: 'BROOKHAVEN DR' },
          { answerId: 'Q1A4', answer: 'Nenhuma das anteriores' },
        ],
      },
      {
        questionId: 'Q2',
        question: 'Qual destas instituições concedeu seu financiamento de veículo?',
        answers: [
          { answerId: 'Q2A1', answer: 'TOYOTA FINANCIAL SERVICES' },
          { answerId: 'Q2A2', answer: 'ALLY FINANCIAL' },
          { answerId: 'Q2A3', answer: 'CARMAX AUTO FINANCE' },
          { answerId: 'Q2A4', answer: 'Nunca tive financiamento de veículo' },
        ],
      },
      {
        questionId: 'Q3',
        question: 'Qual é a faixa da sua prestação mensal de hipoteca?',
        answers: [
          { answerId: 'Q3A1', answer: 'US$ 500 - US$ 999' },
          { answerId: 'Q3A2', answer: 'US$ 1.000 - US$ 1.499' },
          { answerId: 'Q3A3', answer: 'US$ 1.500 - US$ 1.999' },
          { answerId: 'Q3A4', answer: 'Não tenho hipoteca' },
        ],
      },
      {
        questionId: 'Q4',
        question: 'Em qual cidade você abriu sua conta corrente mais antiga?',
        answers: [
          { answerId: 'Q4A1', answer: 'GRAND PRAIRIE, TX' },
          { answerId: 'Q4A2', answer: 'AUSTIN, TX' },
          { answerId: 'Q4A3', answer: 'PHOENIX, AZ' },
          { answerId: 'Q4A4', answer: 'Nenhuma das anteriores' },
        ],
      },
    ],
  }
}

/** In mock mode the correct answer is always option 1 of each question. */
export const MOCK_CORRECT_ANSWERS: Record<string, string> = {
  Q1: 'Q1A1',
  Q2: 'Q2A1',
  Q3: 'Q3A2',
  Q4: 'Q4A1',
}

export function mockAlerts(clientKey: string): Alert[] {
  const catalog: Omit<Alert, 'alertId' | 'clientKey' | 'createdAt' | 'read'>[] = [
    {
      bureau: 'TransUnion',
      type: 'NEW_INQUIRY',
      severity: 'medium',
      title: 'Nova consulta de crédito',
      description: 'Uma consulta hard foi registrada por ROCKET MORTGAGE.',
    },
    {
      bureau: 'Experian',
      type: 'NEW_ACCOUNT',
      severity: 'high',
      title: 'Nova conta aberta',
      description: 'Um novo cartão de crédito foi aberto em seu nome (SYNCHRONY BANK).',
    },
    {
      bureau: 'Equifax',
      type: 'ADDRESS_CHANGE',
      severity: 'critical',
      title: 'Mudança de endereço detectada',
      description: 'Um novo endereço foi associado ao seu arquivo de crédito.',
    },
    {
      bureau: 'TransUnion',
      type: 'BALANCE_INCREASE',
      severity: 'low',
      title: 'Aumento de saldo',
      description: 'O saldo de um cartão rotativo aumentou mais de 30% no último ciclo.',
    },
    {
      bureau: 'IdentityProtect',
      type: 'DARK_WEB',
      severity: 'high',
      title: 'Dados encontrados na dark web',
      description: 'Seu e-mail apareceu em um vazamento de credenciais monitorado.',
    },
    {
      bureau: 'Experian',
      type: 'SCORE_CHANGE',
      severity: 'info',
      title: 'Alteração de score',
      description: 'Seu score variou 8 pontos desde o último mês.',
    },
  ]
  return catalog.map((a, i) => ({
    ...a,
    alertId: mockUuid(`alert:${clientKey}:${i}`),
    clientKey,
    createdAt: new Date(Date.now() - (i + 1) * 36e5 * 11).toISOString(),
    read: rand(clientKey, `read${i}`) > 0.6,
  }))
}

export function mockEnrollments(clientKey: string): MonitoringEnrollment[] {
  return BUREAUS.map((bureau, i) => ({
    enrollmentId: mockUuid(`enroll:${clientKey}:${i}`),
    clientKey,
    bureau,
    product: i === 0 ? 'credmo3bReportScore' : 'creditMonitoring',
    status: (i === 2 ? 'pending' : 'active') as MonitoringEnrollment['status'],
    enrolledAt: new Date(Date.now() - (i + 1) * 864e5 * 20).toISOString(),
  }))
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/** Token -> clientKey, so mock GET /user/v2 can resolve a session. */
const tokenIndex = new Map<string, string>()
/** How many userTokens we already minted per consumer (W-009). */
const issueCount = new Map<string, number>()
const consumerIndex = new Map<string, { firstName: string; lastName: string; ssnLast4: string }>()
/** authTokens handed out by getKbaQuestions, per clientKey. */
const authTokenIndex = new Map<string, string>()
/** reportKey -> { clientKey, displayToken, productCode } for ordered reports. */
const reportIndex = new Map<string, { clientKey: string; displayToken: string; productCode: string }>()

/**
 * The mock refuses identifiers it never issued (V-014). Without this the POC
 * only ever showed happy paths, while the real sandbox answers 400/404 to
 * unknown keys — which is what the integration has to handle.
 */
function requireConsumer(clientKey: string): void {
  if (consumerIndex.has(clientKey)) return
  throw new ArrayApiError('Bad Request', 400, {
    message: 'Bad Request',
    error: [
      {
        value: '',
        message: 'unknown clientKey — create the consumer first (mock keeps a registry, like the sandbox)',
        param: 'clientKey',
        location: 'body',
      },
    ],
  })
}

export class MockArrayProvider implements ArrayProvider {
  readonly mode = 'mock' as const

  /**
   * Re-register consumers/reports that D1 already knows about. The registry
   * lives in module memory, so a worker restart would otherwise invalidate a
   * clientKey the browser still has in localStorage.
   */
  hydrate(
    consumers: { clientKey: string; firstName: string; lastName: string; ssnLast4: string }[],
    reports: { reportKey: string; clientKey: string; displayToken: string; productCode: string }[],
  ): void {
    for (const c of consumers) {
      if (!c.clientKey || consumerIndex.has(c.clientKey)) continue
      consumerIndex.set(c.clientKey, {
        firstName: c.firstName,
        lastName: c.lastName,
        ssnLast4: c.ssnLast4,
      })
    }
    for (const r of reports) {
      if (!r.reportKey || reportIndex.has(r.reportKey)) continue
      reportIndex.set(r.reportKey, {
        clientKey: r.clientKey,
        displayToken: r.displayToken,
        productCode: r.productCode || 'credmo3bReportScore',
      })
    }
  }

  async createUser(input: CreateUserInput): Promise<CreateUserResult> {
    const seed = `${input.firstName}|${input.lastName}|${input.dob}|${ssnLast4(input.ssn)}`
    const clientKey = mockUuid(`user:${seed}`)
    consumerIndex.set(clientKey, {
      firstName: input.firstName.toUpperCase(),
      lastName: input.lastName.toUpperCase(),
      ssnLast4: ssnLast4(input.ssn),
    })
    return { clientKey, userId: clientKey, appKey: MOCK_APP_KEY, status: 'created' }
  }

  async getUserByToken(userToken: string) {
    const clientKey = tokenIndex.get(userToken)
    if (!clientKey) {
      throw new ArrayApiError('Bad Request', 400, { message: 'Bad Request' })
    }
    return { userId: clientKey, clientKey }
  }

  async getKbaQuestions({ clientKey }: { clientKey: string }) {
    requireConsumer(clientKey)
    const res = mockKbaQuestions(clientKey)
    authTokenIndex.set(clientKey, res.authToken)
    return res
  }

  async answerKba({ clientKey, authToken, answers }: { clientKey: string; authToken: string; answers: Record<string, string> }): Promise<AnswerKbaResult> {
    requireConsumer(clientKey)
    if (authTokenIndex.get(clientKey) !== authToken) {
      throw new ArrayApiError('Bad Request', 400, {
        message: 'Bad Request',
        error: [{ value: '', message: 'unknown or expired authToken', param: 'authToken', location: 'body' }],
      })
    }
    const wrong = Object.entries(MOCK_CORRECT_ANSWERS).filter(
      ([qid, correct]) => answers[qid] !== undefined && answers[qid] !== correct,
    )
    if (wrong.length > 2) {
      throw new ArrayApiError('Authentication failed', 400, {
        message: 'Authentication failed',
        error: [{ value: '', message: 'KBA answers rejected by provider', param: 'answers', location: 'body' }],
      })
    }
    const userToken = mockUuid(`token:${clientKey}:${authToken}`)
    tokenIndex.set(userToken, clientKey)
    return { userToken, clientKey, authToken, status: 'authenticated', ttlInMinutes: 60 }
  }

  async createUserToken({ clientKey, ttlInMinutes }: { clientKey: string; ttlInMinutes: number }): Promise<UserTokenResult> {
    requireConsumer(clientKey)
    // One new token per issuance: a deterministic-by-clientKey token made
    // "Renovar userToken" (and `?refresh=true`) look like a no-op (W-009).
    const seq = (issueCount.get(clientKey) ?? 0) + 1
    issueCount.set(clientKey, seq)
    const userToken = mockUuid(`token:${clientKey}:${ttlInMinutes}:${seq}`)
    tokenIndex.set(userToken, clientKey)
    return {
      appKey: MOCK_APP_KEY,
      clientKey,
      userToken,
      ttlInMinutes,
      expiresAt: new Date(Date.now() + ttlInMinutes * 60_000).toISOString(),
    }
  }

  async orderReport({ clientKey, productCode }: { clientKey: string; productCode: string }): Promise<OrderReportResult> {
    requireConsumer(clientKey)
    const reportKey = mockUuid(`report:${clientKey}:${productCode}`)
    const displayToken = mockUuid(`display:${clientKey}:${productCode}`)
    reportIndex.set(reportKey, { clientKey, displayToken, productCode })
    return { reportKey, displayToken, productCode, clientKey }
  }

  async getReport({ reportKey, displayToken, clientKey }: { reportKey: string; displayToken: string; clientKey?: string }) {
    // Same registry rule as alerts/monitoring/usertoken: an unknown clientKey
    // is a 400 here too, instead of silently handing out the report (W-010).
    if (clientKey) requireConsumer(clientKey)
    const known = reportIndex.get(reportKey)
    if (!known) throw new ArrayApiError('Report not found', 404, { message: 'Not Found' })
    if (known.displayToken !== displayToken) {
      throw new ArrayApiError('Bad Request', 400, {
        message: 'Bad Request',
        error: [{ value: '', message: 'displayToken does not match this reportKey', param: 'displayToken', location: 'query' }],
      })
    }
    if (clientKey && known.clientKey !== clientKey) {
      throw new ArrayApiError('Bad Request', 400, {
        message: 'Bad Request',
        error: [{ value: '', message: 'this reportKey does not belong to the given clientKey', param: 'clientKey', location: 'query' }],
      })
    }
    return mockReport(known.clientKey, known.productCode, reportKey, consumerIndex.get(known.clientKey))
  }

  async refreshDisplayToken({ clientKey, reportKey }: { clientKey: string; reportKey: string }) {
    const known = reportIndex.get(reportKey)
    if (!known || known.clientKey !== clientKey) {
      throw new ArrayApiError('Report not found', 404, { message: 'Not Found' })
    }
    const displayToken = mockUuid(`display2:${clientKey}:${reportKey}:${Date.now() % 1000}`)
    reportIndex.set(reportKey, { ...known, displayToken })
    return { reportKey, displayToken }
  }

  async getAlerts({ clientKey, bureau }: { clientKey: string; bureau?: string }) {
    requireConsumer(clientKey)
    const alerts = mockAlerts(clientKey)
    return { alerts: bureau ? alerts.filter((a) => a.bureau.toLowerCase() === bureau.toLowerCase()) : alerts }
  }

  async getAlertDetails({ alertId, clientKey }: { alertId: string; clientKey?: string }) {
    const alerts = mockAlerts(clientKey ?? 'demo')
    const found = alerts.find((a) => a.alertId === alertId)
    if (!found) throw new ArrayApiError('Alert not found', 404, { message: 'Not Found' })
    return found
  }

  async getMonitoringEnrollments({ clientKey }: { clientKey: string }) {
    requireConsumer(clientKey)
    return { enrollments: mockEnrollments(clientKey) }
  }

  async getScoreTracker({ clientKey }: { clientKey: string }) {
    requireConsumer(clientKey)
    return { clientKey, history: mockScoreHistory(clientKey) }
  }
}
