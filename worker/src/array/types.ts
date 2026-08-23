/** Shapes shared by the real Array client and the mock provider. */

export interface Address {
  street: string
  city: string
  state: string
  zip: string
}

export interface CreateUserInput {
  firstName: string
  lastName: string
  ssn: string
  dob: string
  address: Address
}

export interface CreateUserResult {
  clientKey: string
  userId?: string
  appKey: string
  status?: string
}

export interface KbaQuestionOption {
  answerId: string
  answer: string
}

export interface KbaQuestion {
  questionId: string
  question: string
  answers: KbaQuestionOption[]
}

export interface KbaQuestionsResult {
  authToken: string
  clientKey: string
  questions: KbaQuestion[]
}

export interface AnswerKbaResult {
  userToken: string
  clientKey: string
  authToken: string
  status: string
  ttlInMinutes?: number
}

export interface UserTokenResult {
  appKey: string
  clientKey: string
  userToken: string
  ttlInMinutes: number
  expiresAt: string
}

export interface OrderReportResult {
  reportKey: string
  displayToken: string
  productCode: string
  clientKey: string
}

export interface Tradeline {
  bureau: 'TransUnion' | 'Experian' | 'Equifax'
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

export interface Inquiry {
  bureau: string
  subscriberName: string
  date: string
  type: string
}

export interface Collection {
  bureau: string
  agency: string
  originalCreditor: string
  amount: number
  status: string
  reported: string
}

export interface ScoreFactor {
  code: string
  label: string
  impact: 'high' | 'medium' | 'low'
  direction: 'positive' | 'negative'
  description: string
}

export interface ScoreHistoryPoint {
  month: string
  score: number
}

export interface CreditReport {
  reportKey: string
  productCode: string
  clientKey: string
  generatedAt: string
  consumer: { firstName: string; lastName: string; ssnLast4: string; address: Address }
  scores: { bureau: string; model: string; score: number; range: [number, number] }[]
  score: number
  scoreModel: string
  scoreHistory: ScoreHistoryPoint[]
  factors: ScoreFactor[]
  summary: {
    totalAccounts: number
    openAccounts: number
    totalBalance: number
    totalCreditLimit: number
    utilization: number
    delinquencies: number
    inquiries6mo: number
    oldestAccountYears: number
  }
  tradelines: Tradeline[]
  inquiries: Inquiry[]
  collections: Collection[]
}

export interface Alert {
  alertId: string
  bureau: string
  clientKey: string
  type: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  title: string
  description: string
  createdAt: string
  read: boolean
}

export interface MonitoringEnrollment {
  enrollmentId: string
  clientKey: string
  bureau: string
  product: string
  status: 'active' | 'pending' | 'cancelled'
  enrolledAt: string
}

/** Provider interface implemented by both `client.ts` and `mock.ts`. */
export interface ArrayProvider {
  readonly mode: 'mock' | 'sandbox'
  createUser(input: CreateUserInput): Promise<CreateUserResult>
  getUserByToken(userToken: string): Promise<{ userId: string; clientKey: string }>
  getKbaQuestions(args: { clientKey: string }): Promise<KbaQuestionsResult>
  answerKba(args: {
    clientKey: string
    authToken: string
    answers: Record<string, string>
  }): Promise<AnswerKbaResult>
  createUserToken(args: { clientKey: string; ttlInMinutes: number }): Promise<UserTokenResult>
  orderReport(args: { clientKey: string; productCode: string }): Promise<OrderReportResult>
  getReport(args: { reportKey: string; displayToken: string; clientKey?: string }): Promise<CreditReport>
  refreshDisplayToken(args: { clientKey: string; reportKey: string }): Promise<{ reportKey: string; displayToken: string }>
  getAlerts(args: { clientKey: string; bureau?: string }): Promise<{ alerts: Alert[] }>
  getAlertDetails(args: { alertId: string; clientKey?: string }): Promise<Alert>
  getMonitoringEnrollments(args: { clientKey: string }): Promise<{ enrollments: MonitoringEnrollment[] }>
  getScoreTracker(args: { clientKey: string }): Promise<{ clientKey: string; history: ScoreHistoryPoint[] }>
}

export class ArrayApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
    readonly kind:
      | 'http'
      | 'timeout'
      | 'network'
      | 'blocked'
      | 'validation' = 'http',
  ) {
    super(message)
    this.name = 'ArrayApiError'
  }
}
