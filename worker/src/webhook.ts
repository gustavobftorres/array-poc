/**
 * Listener de webhook da Array.
 *
 * VERIFICADO (docs.array.com/docs/how-to-receive-webhooks, §3.10):
 *  - a mensagem é `POST` com `Content-Type: application/json`;
 *  - "The message doesn't contain query parameters or custom headers" — ou seja
 *    NÃO existe header de assinatura, NÃO existe HMAC, NÃO existe segredo
 *    emitido pela Array para verificar o callback;
 *  - o registro do listener é MANUAL: você entrega a URL ao seu representante
 *    de Customer Success. **Não existe API de registro.**
 *  - o listener deve responder `200` para confirmar o recebimento.
 *
 * // UNVERIFIED (interpretação desta POC): sem assinatura, a única
 * autenticação possível é uma URL secreta — o `ARRAY_WEBHOOK_TOKEN` vive no
 * PATH (`/api/webhooks/array/<token>`), é gerado por você e comparado em tempo
 * constante. Ele nunca é logado nem devolvido.
 */

/**
 * Comparação em tempo constante. Sem early-return por caractere: o loop roda
 * sobre o comprimento máximo e acumula as diferenças. O comprimento em si não é
 * segredo útil aqui (o token tem tamanho fixo por ambiente), mas ele também
 * entra no acumulador.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return diff === 0
}

/** Um token vazio nunca autentica (senão a rota abriria sem configuração). */
export function webhookTokenMatches(configured: string, presented: string): boolean {
  if (!configured || !presented) return false
  return timingSafeEqual(configured, presented)
}

/** Path com o segredo trocado por `***` — é isso que vai para a auditoria. */
export function maskWebhookPath(path: string): string {
  return path.replace(/^(\/api\/webhooks\/array)\/[^/]+/, '$1/***')
}

export interface NormalizedWebhookEvent {
  eventType: string
  clientKey: string | null
  reportKey: string | null
  payload: unknown
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * O envelope exato do webhook é // UNVERIFIED (a página /docs/webhook-events é
 * gated). Só extraímos os campos CITADOS pela documentação — `clientKey`,
 * `reportKey`, `displayToken`, `productCode` — e guardamos o corpo cru inteiro,
 * sem descartar nada. O payload é tratado como NOTIFICAÇÃO NÃO CONFIÁVEL:
 * nada aqui é usado como verdade sem reconfirmar pela API.
 */
export function normalizeWebhookEvent(body: unknown): NormalizedWebhookEvent {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const nested = (b.data && typeof b.data === 'object' ? (b.data as Record<string, unknown>) : {}) as Record<string, unknown>
  const eventType =
    str(b.eventType) || str(b.event) || str(b.type) || str(b.name) || str(nested.eventType) || '(sem eventType no corpo)'
  return {
    eventType,
    clientKey: str(b.clientKey) || str(nested.clientKey) || null,
    reportKey: str(b.reportKey) || str(nested.reportKey) || null,
    payload: body ?? null,
  }
}
