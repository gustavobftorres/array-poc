import type { AuthMode, Env, Mode } from './types'
import { MOCK_APP_KEY } from './array/mock'
import { resolveIdentity, type ResolvedIdentity } from './personas'

export const SANDBOX_BASE_URL = 'https://sandbox.array.io/api'
export const PROD_BASE_URL = 'https://array.io/api'
export const SANDBOX_COMPONENTS_CDN = 'https://embed.sandbox.array.io/cms/'
export const PROD_COMPONENTS_CDN = 'https://embed.array.io/cms/'

export const DEFAULT_PRODUCT_CODE = 'credmo3bReportScore'
/** Unidade SEGUNDOS: // UNVERIFIED (docs/ARRAY_ENV_VARS.md §7-8) */
export const DEFAULT_POLL_INTERVAL_S = 1.0
export const DEFAULT_POLL_TIMEOUT_S = 120

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
  componentsCdn: string
  /** Trava explícita: em `browser` o client token NUNCA é anexado. */
  authMode: AuthMode
  productCode: string
  pollIntervalMs: number
  pollTimeoutMs: number
  identity: ResolvedIdentity
  /** URL do listener entregue ao Customer Success da Array (não há API de registro). */
  listenerUrl: string
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
export function normalizeBaseUrl(raw: string): string | null {
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
  return `${url.protocol}//${url.host}${withApi}`
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

/** Segundos (float) -> ms. Valor inválido/≤0 cai no default, com aviso. */
export function parseSeconds(raw: string | undefined, defaultSeconds: number, name: string, warnings: string[]): number {
  const v = clean(raw)
  if (!v) return Math.round(defaultSeconds * 1000)
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) {
    warnings.push(`${name}="${raw}" não é um número de segundos positivo — usando o default (${defaultSeconds}s).`)
    return Math.round(defaultSeconds * 1000)
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
  const overrideBase = normalizeBaseUrl(clean(e.ARRAY_BASE_URL))
  if (clean(e.ARRAY_BASE_URL) && !overrideBase) {
    warnings.push(`ARRAY_BASE_URL="${e.ARRAY_BASE_URL}" não é uma URL http(s) — usando o host derivado de ARRAY_ENV.`)
  }

  // Com ARRAY_ENV explícito ele manda. Sem ele, um base URL de override
  // define o ambiente pelo host (senão um override de produção continuaria
  // carregando o CDN de sandbox).
  const arrayEnv: 'sandbox' | 'production' =
    rawEnv === 'production' || rawEnv === 'prod'
      ? 'production'
      : rawEnv === 'sandbox'
        ? 'sandbox'
        : overrideBase && !/(^|\.)sandbox\./i.test(new URL(overrideBase).host)
          ? 'production'
          : 'sandbox'

  const baseUrl = overrideBase ?? (arrayEnv === 'production' ? PROD_BASE_URL : SANDBOX_BASE_URL)
  const authMode = parseAuthMode(clean(e.ARRAY_AUTH_MODE), warnings)

  const identityResolved = resolveIdentity(e.ARRAY_IDENTITY)
  if (identityResolved.warning) warnings.push(identityResolved.warning)
  // A persona é artefato de SANDBOX. Em produção ela é ignorada de propósito.
  let identity = identityResolved.identity
  if (arrayEnv === 'production' && clean(e.ARRAY_IDENTITY)) {
    warnings.push('ARRAY_IDENTITY é uma persona de teste do SANDBOX — ignorada porque ARRAY_ENV/ARRAY_BASE_URL aponta para produção.')
    identity = { ...identity, source: 'default', label: '(ignorada em produção)', note: 'Personas de sandbox não existem em produção.' }
  }

  const hasAppKey = appKey.length > 0
  const hasServerToken = serverToken.length > 0

  return {
    mode: hasAppKey && hasServerToken ? 'sandbox' : 'mock',
    appKey,
    serverToken,
    hasAppKey,
    hasServerToken,
    arrayEnv,
    baseUrl,
    baseUrlSource: overrideBase ? 'ARRAY_BASE_URL' : 'ARRAY_ENV',
    componentsCdn: arrayEnv === 'production' ? PROD_COMPONENTS_CDN : SANDBOX_COMPONENTS_CDN,
    authMode,
    productCode: clean(e.ARRAY_PRODUCT_CODE) || DEFAULT_PRODUCT_CODE,
    pollIntervalMs: parseSeconds(e.ARRAY_POLL_INTERVAL, DEFAULT_POLL_INTERVAL_S, 'ARRAY_POLL_INTERVAL', warnings),
    pollTimeoutMs: parseSeconds(e.ARRAY_POLL_TIMEOUT, DEFAULT_POLL_TIMEOUT_S, 'ARRAY_POLL_TIMEOUT', warnings),
    identity,
    listenerUrl: clean(e.ARRAY_LISTENER_URL),
    webhookToken: clean(e.ARRAY_WEBHOOK_TOKEN),
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
    },
    webhook: {
      /** URL que você entrega ao Customer Success (não há API de registro). */
      listenerUrl: cfg.listenerUrl || null,
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
}
