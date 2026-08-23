/** Cloudflare bindings + vars available to the Worker. */
export interface Env {
  DB: D1Database
  CACHE: KVNamespace
  /** Preferred names (required by the user's brief). */
  SMARTY_AUTH_ID?: string
  SMARTY_AUTH_TOKEN?: string
  /** Accepted aliases with Array's real semantics. */
  ARRAY_APP_KEY?: string
  ARRAY_CLIENT_TOKEN?: string
  ARRAY_ENV?: string
}

export type Mode = 'mock' | 'sandbox'
