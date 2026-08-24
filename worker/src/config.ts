import type { AuthMode, Env, Mode } from './types'
import { MOCK_APP_KEY } from './array/mock'
import { DISCARDED_IDENTITY, identityIsEmpty, resolveIdentity, type ResolvedIdentity } from './personas'
import { maskListenerUrl } from './webhook'

export const SANDBOX_BASE_URL = 'https://sandbox.array.io/api'
export const PROD_BASE_URL = 'https://array.io/api'
export const SANDBOX_COMPONENTS_CDN = 'https://embed.sandbox.array.io/cms/'
export const PROD_COMPONENTS_CDN = 'https://embed.array.io/cms/'

export const DEFAULT_PRODUCT_CODE = 'credmo3bReportScore'
/** Unidade SEGUNDOS: // UNVERIFIED (docs/ARRAY_ENV_VARS.md §7-8) */
export const DEFAULT_POLL_INTERVAL_S = 1.0
export const DEFAULT_POLL_TIMEOUT_S = 120
/**
 * Tetos de sanidade (W2-006). Sem eles um `ARRAY_POLL_TIMEOUT=1e9` pendura a
 * requisição para sempre e um intervalo absurdo faz a primeira tentativa já
 * estourar o timeout sem explicação.
 */
export const MAX_POLL_INTERVAL_S = 60
export const MAX_POLL_TIMEOUT_S = 3600

export interface AppConfig {
  mode: Mode
  /** ARRAY_APP_KEY (alias deprecado: SMARTY_AUTH_ID) -> Array `appKey`. */
  appKey: string
  /** ARRAY_SERVER_TOKEN (aliases: ARRAY_CLIENT_TOKEN, SMARTY_AUTH_TOKEN) -> `x-credmo-client-token`. */
  serverToken: string
  hasAppKey: boolean
  hasServerToken: boolean
  arrayEnv: 'sandbox' | 'production'
  baseUrl: string
  /** Como o baseUrl foi decidido — o Dashboard mostra isso. */
  baseUrlSource: 'ARRAY_BASE_URL' | 'ARRAY_ENV'
  /** Quem decidiu o `arrayEnv`: o host efetivo manda; ARRAY_ENV é fallback. */
  arrayEnvSource: 'ARRAY_BASE_URL' | 'ARRAY_ENV' | 'default'
  /** Classe do host que está REALMENTE sendo chamado. */
  hostClass: HostClass
  /**
   * Divergência entre o `ARRAY_ENV` declarado e o host efetivo (W2-001).
   * Nenhuma tela pode dizer um ambiente diferente do host chamado: quando isso
   * acontece o host ganha e a divergência vira erro visível.
   */
  envMismatch: { declared: 'sandbox' | 'production'; effective: 'sandbox' | 'production'; host: string } | null
  componentsCdn: string
  /** Trava explícita: em `browser` o client token NUNCA é anexado. */
  authMode: AuthMode
  productCode: string
  pollIntervalMs: number
  pollTimeoutMs: number
  identity: ResolvedIdentity
  /**
   * `true` quando a identidade foi DESCARTADA por estarmos falando com
   * produção (W2-002). Descartada significa vazia — não re-rotulada.
   */
  identityDiscarded: boolean
  identityDiscardReason: string | null
  /** URL do listener entregue ao Customer Success da Array (não há API de registro). */
  listenerUrl: string
  /** `listenerUrl` com o segredo elidido — é ESTA que pode sair do worker (W2-003). */
  listenerUrlMasked: string
  /** `true` quando a listener URL continha o `ARRAY_WEBHOOK_TOKEN` e foi elidida. */
  listenerUrlHadSecret: boolean
  /** Segredo no path do listener — gerado por você (INFERIDO). */
  webhookToken: string
  /** Nomes deprecados/valores inválidos encontrados no ambiente. */
  warnings: string[]
}

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * Normaliza `ARRAY_BASE_URL`.
 *
 * O valor que o usuário cola é `https://sandbox.array.io` (sem `/api`), mas
 * TODAS as rotas vivem sob `/api` (§3 da pesquisa). Aceitamos as quatro formas
 * (`…io`, `…io/`, `…io/api`, `…io/api/`) e devolvemos sempre `…io/api`.
 * Um valor que não é URL http(s) é recusado (o chamador cai no ARRAY_ENV).
 */
export function normalizeBaseUrl(raw: string, warnings?: string[]): string | null {
  const value = clean(raw)
  if (!value) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  // Só o host + path importam; query/hash em base URL é sempre erro de cópia.
  const path = url.pathname.replace(/\/+$/, '')
  const withApi = /(^|\/)api$/i.test(path) ? path : `${path}/api`
  const normalized = `${url.protocol}//${url.host}${withApi}`

  if (warnings) {
    // W2-005: `http://` é legítimo para loopback (é como o QA testa), mas para
    // host remoto significa mandar o x-credmo-client-token em texto claro.
    if (url.protocol === 'http:' && classifyHost(url.host) !== 'local') {
      warnings.push(
        `ARRAY_BASE_URL usa http:// para o host remoto "${url.host}" — o ARRAY_SERVER_TOKEN (x-credmo-client-token) sairia em TEXTO CLARO na rede. Use https:// (http:// só é aceito sem aviso para localhost/127.0.0.1).`,
      )
    }
    // W2-007: um path extra sobrevive e ganha `/api` no fim, então
    // `…/api/v2` vira `…/api/v2/api` e todas as chamadas dariam 404.
    if (path && !/^\/api$/i.test(path)) {
      warnings.push(
        `ARRAY_BASE_URL tem o path extra "${path}" — a POC acrescenta /api no fim, então a base efetiva é "${normalized}". Se não era isso, deixe só o host (ex.: https://sandbox.array.io).`,
      )
    }
  }
  return normalized
}

export type HostClass = 'sandbox' | 'production' | 'local'

/**
 * Classifica o host que está REALMENTE sendo chamado (W2-001).
 *
 *  - `local`  → loopback: é o upstream falso do QA/dev. Não afirma ambiente
 *               nenhum, então quem decide é o `ARRAY_ENV`.
 *  - `sandbox`→ host com rótulo `sandbox.` (ex.: `sandbox.array.io`).
 *  - `production` → qualquer outro host remoto (ex.: `array.io`).
 */
export function classifyHost(host: string): HostClass {
  const h = host.replace(/:\d+$/, '').toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1' || h.startsWith('127.') || h === '0.0.0.0' || h === '::1') {
    return 'local'
  }
  if (/(^|\.)sandbox\./i.test(h)) return 'sandbox'
  return 'production'
}

/** `server` | `browser`; qualquer outra coisa cai em `server` com aviso. */
function parseAuthMode(raw: string, warnings: string[]): AuthMode {
  const v = clean(raw).toLowerCase()
  if (!v) return 'server'
  if (v === 'server') return 'server'
  if (v === 'browser' || v === 'client' || v === 'user') return 'browser'
  warnings.push(`ARRAY_AUTH_MODE="${raw}" não é 'server' nem 'browser' — usando 'server' (modo seguro).`)
  return 'server'
}

/**
 * Segundos (float) -> ms. Valor inválido/≤0 cai no default, com aviso; valor
 * acima do teto de sanidade é CLAMPADO com aviso (W2-006) — sem isso um
 * `1e9` pendura a requisição indefinidamente.
 */
export function parseSeconds(
  raw: string | undefined,
  defaultSeconds: number,
  name: string,
  warnings: string[],
  maxSeconds?: number,
): number {
  const v = clean(raw)
  if (!v) return Math.round(defaultSeconds * 1000)
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) {
    warnings.push(`${name}="${raw}" não é um número de segundos positivo — usando o default (${defaultSeconds}s).`)
    return Math.round(defaultSeconds * 1000)
  }
  if (maxSeconds !== undefined && n > maxSeconds) {
    warnings.push(
      `${name}="${raw}" está acima do teto de sanidade (${maxSeconds}s) — usando ${maxSeconds}s. Valores absurdos penduram a requisição em vez de dar erro.`,
    )
    return Math.round(maxSeconds * 1000)
  }
  return Math.round(n * 1000)
}

export function getConfig(env: Partial<Env> | undefined): AppConfig {
  const e = env ?? {}
  const warnings: string[] = []

  // Nomes canônicos primeiro; SMARTY_* só como alias DEPRECADO.
  const appKey = clean(e.ARRAY_APP_KEY) || clean(e.SMARTY_AUTH_ID)
  const serverToken = clean(e.ARRAY_SERVER_TOKEN) || clean(e.ARRAY_CLIENT_TOKEN) || clean(e.SMARTY_AUTH_TOKEN)

  if (clean(e.SMARTY_AUTH_ID) && !clean(e.ARRAY_APP_KEY)) {
    warnings.push('SMARTY_AUTH_ID está DEPRECADO (nome errado): renomeie para ARRAY_APP_KEY.')
  }
  if (clean(e.SMARTY_AUTH_TOKEN) && !clean(e.ARRAY_SERVER_TOKEN) && !clean(e.ARRAY_CLIENT_TOKEN)) {
    warnings.push('SMARTY_AUTH_TOKEN está DEPRECADO (nome errado): renomeie para ARRAY_SERVER_TOKEN.')
  }

  const rawEnv = clean(e.ARRAY_ENV).toLowerCase()
  const declaredEnv: 'sandbox' | 'production' | null =
    rawEnv === 'production' || rawEnv === 'prod' ? 'production' : rawEnv === 'sandbox' ? 'sandbox' : null
  if (rawEnv && !declaredEnv) {
    warnings.push(`ARRAY_ENV="${e.ARRAY_ENV}" não é 'sandbox' nem 'production' — ignorado.`)
  }

  const overrideBase = normalizeBaseUrl(clean(e.ARRAY_BASE_URL), warnings)
  if (clean(e.ARRAY_BASE_URL) && !overrideBase) {
    warnings.push(`ARRAY_BASE_URL="${e.ARRAY_BASE_URL}" não é uma URL http(s) — usando o host derivado de ARRAY_ENV.`)
  }

  /**
   * W2-001 — o ambiente é DERIVADO do host que está sendo chamado.
   *
   * Quem manda é o baseUrl efetivo: se as chamadas vão para `array.io`, o
   * ambiente é `production`, e nenhuma tela pode dizer o contrário (era o bug:
   * `wrangler.toml` fixava `ARRAY_ENV=sandbox` e o Dashboard dizia "sandbox"
   * chamando produção). `ARRAY_ENV` vale como FALLBACK — e só decide sozinho
   * quando não há `ARRAY_BASE_URL` ou quando o host é loopback (upstream falso
   * do dev/QA, que não afirma ambiente nenhum).
   */
  const overrideHost = overrideBase ? new URL(overrideBase).host : ''
  const hostClassOfOverride = overrideBase ? classifyHost(overrideHost) : null
  const hostDecides = hostClassOfOverride === 'sandbox' || hostClassOfOverride === 'production'

  const arrayEnv: 'sandbox' | 'production' = hostDecides
    ? (hostClassOfOverride as 'sandbox' | 'production')
    : (declaredEnv ?? 'sandbox')
  const arrayEnvSource: 'ARRAY_BASE_URL' | 'ARRAY_ENV' | 'default' = hostDecides
    ? 'ARRAY_BASE_URL'
    : declaredEnv
      ? 'ARRAY_ENV'
      : 'default'

  // Divergência declarada × efetiva: erro VISÍVEL, não detalhe.
  const envMismatch =
    hostDecides && declaredEnv && declaredEnv !== arrayEnv
      ? { declared: declaredEnv, effective: arrayEnv, host: overrideHost }
      : null
  if (envMismatch) {
    warnings.push(
      `ARRAY_ENV="${envMismatch.declared}" contradiz o host de ARRAY_BASE_URL ("${envMismatch.host}", que é ${envMismatch.effective}). O host MANDA: o ambiente efetivo é "${envMismatch.effective}" (CDN e regras de identidade incluídas). Corrija uma das duas variáveis.`,
    )
  }

  const baseUrl = overrideBase ?? (arrayEnv === 'production' ? PROD_BASE_URL : SANDBOX_BASE_URL)
  const hostClass: HostClass = hostClassOfOverride ?? (arrayEnv === 'production' ? 'production' : 'sandbox')
  const authMode = parseAuthMode(clean(e.ARRAY_AUTH_MODE), warnings)

  const identityResolved = resolveIdentity(e.ARRAY_IDENTITY)
  if (identityResolved.warning) warnings.push(identityResolved.warning)

  /**
   * W2-002 — em produção a identidade é DESCARTADA na origem.
   *
   * O ciclo anterior só re-rotulava (`label: '(ignorada em produção)'`) e o
   * spread preservava `firstName/lastName/dob/ssn/address`, então o `/api/seed`
   * mandava o SSN da persona — ou o SSN REAL que alguém tivesse digitado na
   * variável — para o host de produção, sob a promessa contrária. Aqui o valor
   * nem existe mais no objeto de config: não há como um caminho de código
   * novo vazá-lo por descuido.
   */
  const identityDiscarded = arrayEnv === 'production'
  let identity = identityDiscarded ? DISCARDED_IDENTITY : identityResolved.identity
  let identityDiscardReason: string | null = null
  if (identityDiscarded) {
    identityDiscardReason =
      `A identidade foi DESCARTADA (esvaziada, não apenas ignorada) porque o ambiente efetivo é produção` +
      `${arrayEnvSource === 'ARRAY_BASE_URL' ? ` — derivado do host "${overrideHost}" em ARRAY_BASE_URL` : ' — declarado em ARRAY_ENV'}` +
      `. Personas de sandbox não existem em produção, e a POC não envia PII para um host de produção: POST /api/seed é recusado.`
    if (clean(e.ARRAY_IDENTITY)) warnings.push(`ARRAY_IDENTITY foi DESCARTADA. ${identityDiscardReason}`)
  }
  // Invariante (testada): identidade descartada não guarda NENHUM campo de PII.
  if (identityDiscarded && !identityIsEmpty(identity)) {
    identity = DISCARDED_IDENTITY
    throw new Error('INVARIANTE VIOLADA: identidade descartada ainda carrega campos de PII em produção.')
  }

  const hasAppKey = appKey.length > 0
  const hasServerToken = serverToken.length > 0

  /**
   * W2-003 — o `ARRAY_WEBHOOK_TOKEN` vive no PATH da listener URL, então a URL
   * inteira É o segredo. A versão mascarada é a única que sai do worker.
   */
  const listenerUrl = clean(e.ARRAY_LISTENER_URL)
  const webhookToken = clean(e.ARRAY_WEBHOOK_TOKEN)
  const listenerUrlMasked = maskListenerUrl(listenerUrl, webhookToken)
  if (listenerUrl && listenerUrlMasked === listenerUrl && webhookToken) {
    warnings.push(
      'ARRAY_LISTENER_URL não contém o ARRAY_WEBHOOK_TOKEN no path — o listener desta POC só responde em /api/webhooks/array/<ARRAY_WEBHOOK_TOKEN>. Confira se a URL registrada com o Customer Success é a mesma.',
    )
  }

  return {
    mode: hasAppKey && hasServerToken ? 'sandbox' : 'mock',
    appKey,
    serverToken,
    hasAppKey,
    hasServerToken,
    arrayEnv,
    baseUrl,
    baseUrlSource: overrideBase ? 'ARRAY_BASE_URL' : 'ARRAY_ENV',
    arrayEnvSource,
    hostClass,
    envMismatch,
    componentsCdn: arrayEnv === 'production' ? PROD_COMPONENTS_CDN : SANDBOX_COMPONENTS_CDN,
    authMode,
    productCode: clean(e.ARRAY_PRODUCT_CODE) || DEFAULT_PRODUCT_CODE,
    pollIntervalMs: parseSeconds(e.ARRAY_POLL_INTERVAL, DEFAULT_POLL_INTERVAL_S, 'ARRAY_POLL_INTERVAL', warnings, MAX_POLL_INTERVAL_S),
    pollTimeoutMs: parseSeconds(e.ARRAY_POLL_TIMEOUT, DEFAULT_POLL_TIMEOUT_S, 'ARRAY_POLL_TIMEOUT', warnings, MAX_POLL_TIMEOUT_S),
    identity,
    identityDiscarded,
    identityDiscardReason,
    listenerUrl,
    listenerUrlMasked,
    listenerUrlHadSecret: listenerUrlMasked !== listenerUrl,
    webhookToken,
    warnings,
  }
}

/** Public, non-secret view of the config — safe to send to the browser. */
export function publicStatus(cfg: AppConfig) {
  return {
    mode: cfg.mode,
    hasAppKey: cfg.hasAppKey,
    hasServerToken: cfg.hasServerToken,
    arrayEnv: cfg.arrayEnv,
    baseUrl: cfg.baseUrl,
    baseUrlSource: cfg.baseUrlSource,
    /** O ambiente é derivado do host efetivo; ARRAY_ENV é só fallback (W2-001). */
    arrayEnvSource: cfg.arrayEnvSource,
    hostClass: cfg.hostClass,
    envMismatch: cfg.envMismatch,
    componentsCdn: cfg.componentsCdn,
    authMode: cfg.authMode,
    productCode: cfg.productCode,
    /** Unidade em segundos: // UNVERIFIED (a Array não publica recomendação). */
    poll: {
      intervalSeconds: cfg.pollIntervalMs / 1000,
      timeoutSeconds: cfg.pollTimeoutMs / 1000,
      unit: 'seconds',
      unitInferred: true,
    },
    identity: {
      slug: cfg.identity.slug ?? null,
      label: cfg.identity.label,
      source: cfg.identity.source,
      confidence: cfg.identity.confidence,
      note: cfg.identity.note,
      /** Persona só vale em sandbox. */
      sandboxOnly: true,
      /** W2-002: em produção a identidade é esvaziada, não re-rotulada. */
      discarded: cfg.identityDiscarded,
      discardReason: cfg.identityDiscardReason,
    },
    webhook: {
      /**
       * URL que você entrega ao Customer Success (não há API de registro),
       * com o segredo do path ELIDIDO (W2-003) — a URL completa nunca sai do
       * worker, ela vive só no seu `.env`.
       */
      listenerUrl: cfg.listenerUrlMasked || null,
      listenerUrlMasked: cfg.listenerUrlHadSecret,
      /** Path local do listener desta POC, com o segredo mascarado. */
      localPath: cfg.webhookToken ? '/api/webhooks/array/<ARRAY_WEBHOOK_TOKEN>' : null,
      configured: cfg.webhookToken.length > 0,
      /** Segredo-no-path é interpretação desta POC: // UNVERIFIED. */
      secretInPathInferred: true,
      registrationIsManual: true,
    },
    warnings: cfg.warnings,
    /** appKey is public by design in Array (it ships in page source). */
    appKey: cfg.mode === 'mock' ? MOCK_APP_KEY : cfg.appKey,
  }
}

/** Aviso único no boot (nunca imprime valor de segredo). */
export function logBootWarnings(cfg: AppConfig): void {
  for (const w of cfg.warnings) console.warn(`[config] ${w}`)
  // W2-001 — o boot diz qual host está sendo chamado e quem decidiu o ambiente,
  // para que nenhuma tela possa afirmar um ambiente diferente sem contradizer o
  // terminal.
  console.warn(`[config] ambiente="${cfg.arrayEnv}" (decidido por ${cfg.arrayEnvSource}) · baseUrl=${cfg.baseUrl} · CDN=${cfg.componentsCdn}`)
  if (cfg.envMismatch) {
    console.error(
      `[config] ERRO DE CONFIGURAÇÃO: ARRAY_ENV="${cfg.envMismatch.declared}" contradiz o host "${cfg.envMismatch.host}" (${cfg.envMismatch.effective}). O host manda.`,
    )
  }
  // W2-002 — o descarte da identidade é anunciado no boot, com o motivo.
  if (cfg.identityDiscarded) console.warn(`[config] ${cfg.identityDiscardReason}`)
}
