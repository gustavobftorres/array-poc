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

export const MOCK_APP_KEY = 'MOCK-APP-KEY-0000-0000-000000000000'
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

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

export function mockScoreHistory(clientKey: string): ScoreHistoryPoint[] {
  const out: ScoreHistoryPoint[] = []
  for (let i = 11; i >= 0; i--) {
    const drift = Math.round((rand(clientKey, `hist${i}`) - 0.45) * 24)
    const trend = Math.round((11 - i) * 1.8)
    out.push({
      month: monthsBack(i),
      score: Math.max(300, Math.min(850, MOCK_BASE_SCORE - trend - 10 + drift)),
    })
  }
  // Anchor the latest month at the canonical demo score.
  out[out.length - 1] = { month: monthsBack(0), score: MOCK_BASE_SCORE }
  return out
}

export function mockFactors(clientKey: string): ScoreFactor[] {
  const all: ScoreFactor[] = [
    {
      code: 'PAYMENT_HISTORY',
      label: 'Histórico de pagamentos',
      impact: 'high',
      direction: 'positive',
      description: '98% dos pagamentos em dia nos últimos 24 meses.',
    },
    {
      code: 'UTILIZATION',
      label: 'Utilização de crédito rotativo',
      impact: 'high',
      direction: 'negative',
      description: 'Utilização de 41% — acima dos 30% recomendados.',
    },
    {
      code: 'CREDIT_AGE',
      label: 'Idade média das contas',
      impact: 'medium',
      direction: 'positive',
      description: 'Conta mais antiga com 11 anos.',
    },
    {
      code: 'INQUIRIES',
      label: 'Consultas recentes',
      impact: 'low',
      direction: 'negative',
      description: `${int(clientKey, 'inq', 1, 4)} consultas hard nos últimos 6 meses.`,
    },
    {
      code: 'DEROGATORY',
      label: 'Registros negativos',
      impact: 'medium',
      direction: 'negative',
      description: '1 conta em cobrança reportada há 19 meses.',
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
    const isRevolving = creditor.type !== 'Auto Loan' && creditor.type !== 'Mortgage' && creditor.type !== 'Student Loan'
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
  const revolving = tradelines.filter((t) => t.creditLimit > 0 && t.accountType !== 'Mortgage' && t.accountType !== 'Auto Loan')
  const totalBalance = tradelines.reduce((s, t) => s + t.balance, 0)
  const totalLimit = revolving.reduce((s, t) => s + t.creditLimit, 0) || 1
  const revBalance = revolving.reduce((s, t) => s + t.balance, 0)
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
          reported: `${monthsBack(19)}-05`,
        },
      ]
    : []

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
    factors: mockFactors(clientKey),
    summary: {
      totalAccounts: tradelines.length,
      openAccounts: tradelines.filter((t) => t.status.startsWith('Open')).length,
      totalBalance,
      totalCreditLimit: totalLimit,
      utilization: Math.round((revBalance / totalLimit) * 1000) / 10,
      delinquencies: tradelines.filter((t) => t.paymentHistory.some((p) => p !== 'OK')).length,
      inquiries6mo: inquiries.filter((i) => i.type === 'Hard').length,
      oldestAccountYears: 11,
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
const consumerIndex = new Map<string, { firstName: string; lastName: string; ssnLast4: string }>()

export class MockArrayProvider implements ArrayProvider {
  readonly mode = 'mock' as const

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
    return mockKbaQuestions(clientKey)
  }

  async answerKba({ clientKey, authToken, answers }: { clientKey: string; authToken: string; answers: Record<string, string> }): Promise<AnswerKbaResult> {
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
    const userToken = mockUuid(`token:${clientKey}:${ttlInMinutes}`)
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
    return {
      reportKey: mockUuid(`report:${clientKey}:${productCode}`),
      displayToken: mockUuid(`display:${clientKey}:${productCode}`),
      productCode,
      clientKey,
    }
  }

  async getReport({ reportKey, clientKey }: { reportKey: string; displayToken: string; clientKey?: string }) {
    const key = clientKey ?? reportKey
    return mockReport(key, 'credmo3bReportScore', reportKey, consumerIndex.get(key))
  }

  async refreshDisplayToken({ clientKey, reportKey }: { clientKey: string; reportKey: string }) {
    return { reportKey, displayToken: mockUuid(`display2:${clientKey}:${reportKey}:${Date.now() % 1000}`) }
  }

  async getAlerts({ clientKey, bureau }: { clientKey: string; bureau?: string }) {
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
    return { enrollments: mockEnrollments(clientKey) }
  }

  async getScoreTracker({ clientKey }: { clientKey: string }) {
    return { clientKey, history: mockScoreHistory(clientKey) }
  }
}
