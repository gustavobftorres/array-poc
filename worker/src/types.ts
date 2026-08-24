/** Cloudflare bindings + vars available to the Worker. */
export interface Env {
  DB: D1Database
  CACHE: KVNamespace

  // -- canonical contract (docs/ARRAY_ENV_VARS.md) --------------------------
  /** Array `appKey` — UUID de 36 chars, público por design. */
  ARRAY_APP_KEY?: string
  /** Segredo de servidor enviado como header `x-credmo-client-token`. */
  ARRAY_SERVER_TOKEN?: string
  /** Override do host da API. Aceito com ou sem o sufixo `/api`. */
  ARRAY_BASE_URL?: string
  /** `server` (default) | `browser` — decide QUAL header autentica. */
  ARRAY_AUTH_MODE?: string
  /** Persona de teste do sandbox: slug conhecido ou JSON inline. */
  ARRAY_IDENTITY?: string
  /** `productCode` default de `POST /report/v2`. */
  ARRAY_PRODUCT_CODE?: string
  /** Intervalo do polling do relatório, em SEGUNDOS (unidade INFERIDA). */
  ARRAY_POLL_INTERVAL?: string
  /** Timeout do polling do relatório, em SEGUNDOS (unidade INFERIDA). */
  ARRAY_POLL_TIMEOUT?: string
  /** URL pública do seu listener de webhook — entregue ao CS da Array. */
  ARRAY_LISTENER_URL?: string
  /** Segredo GERADO POR VOCÊ que vive no path do listener (INFERIDO). */
  ARRAY_WEBHOOK_TOKEN?: string
  /** `sandbox` | `production` — caminho principal quando não há BASE_URL. */
  ARRAY_ENV?: string

  // -- aliases --------------------------------------------------------------
  /** Alias aceito de ARRAY_SERVER_TOKEN (mesmo header, mesmo segredo). */
  ARRAY_CLIENT_TOKEN?: string
  /** @deprecated nome errado, herdado de uma premissa equivocada. */
  SMARTY_AUTH_ID?: string
  /** @deprecated nome errado, herdado de uma premissa equivocada. */
  SMARTY_AUTH_TOKEN?: string
}

export type Mode = 'mock' | 'sandbox'
export type AuthMode = 'server' | 'browser'
