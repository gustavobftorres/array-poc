import type { Env, Mode } from './types'

export const SANDBOX_BASE_URL = 'https://sandbox.array.io/api'
export const PROD_BASE_URL = 'https://array.io/api'
export const SANDBOX_COMPONENTS_CDN = 'https://embed.sandbox.array.io/cms/'
export const PROD_COMPONENTS_CDN = 'https://embed.array.io/cms/'

export interface AppConfig {
  mode: Mode
  /** SMARTY_AUTH_ID (or ARRAY_APP_KEY) -> Array `appKey`. */
  appKey: string
  /** SMARTY_AUTH_TOKEN (or ARRAY_CLIENT_TOKEN) -> `x-credmo-client-token`. */
  clientToken: string
  hasAuthId: boolean
  hasAuthToken: boolean
  arrayEnv: 'sandbox' | 'production'
  baseUrl: string
  componentsCdn: string
}

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

export function getConfig(env: Partial<Env> | undefined): AppConfig {
  const e = env ?? {}
  // SMARTY_* are the names the user asked for; ARRAY_* are accepted aliases.
  const appKey = clean(e.SMARTY_AUTH_ID) || clean(e.ARRAY_APP_KEY)
  const clientToken = clean(e.SMARTY_AUTH_TOKEN) || clean(e.ARRAY_CLIENT_TOKEN)

  const rawEnv = clean(e.ARRAY_ENV).toLowerCase()
  const arrayEnv: 'sandbox' | 'production' =
    rawEnv === 'production' || rawEnv === 'prod' ? 'production' : 'sandbox'

  const hasAuthId = appKey.length > 0
  const hasAuthToken = clientToken.length > 0

  return {
    mode: hasAuthId && hasAuthToken ? 'sandbox' : 'mock',
    appKey,
    clientToken,
    hasAuthId,
    hasAuthToken,
    arrayEnv,
    baseUrl: arrayEnv === 'production' ? PROD_BASE_URL : SANDBOX_BASE_URL,
    componentsCdn: arrayEnv === 'production' ? PROD_COMPONENTS_CDN : SANDBOX_COMPONENTS_CDN,
  }
}

/** Public, non-secret view of the config — safe to send to the browser. */
export function publicStatus(cfg: AppConfig) {
  return {
    mode: cfg.mode,
    hasAuthId: cfg.hasAuthId,
    hasAuthToken: cfg.hasAuthToken,
    arrayEnv: cfg.arrayEnv,
    baseUrl: cfg.baseUrl,
    componentsCdn: cfg.componentsCdn,
    /** appKey is public by design in Array (it ships in page source). */
    appKey: cfg.mode === 'mock' ? 'MOCK-APP-KEY-0000-0000-000000000000' : cfg.appKey,
  }
}
