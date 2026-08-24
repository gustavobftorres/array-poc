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
 * constante. A POC nunca o grava (a auditoria guarda `/api/webhooks/array/***`)
 * nem o devolve em resposta alguma — mas atenção (W2-004): o **access log do
 * runtime** registra o path completo (`wrangler dev` imprime
 * `POST /api/webhooks/array/<token> 200 OK`), e proxies/CDNs fazem o mesmo em
 * produção. Não há como a aplicação suprimir esse log; é a fraqueza inerente de
 * segredo-no-path, documentada no README §Segurança.
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

/**
 * W2-003 — elide o `ARRAY_WEBHOOK_TOKEN` de dentro da `ARRAY_LISTENER_URL`.
 *
 * O formato documentado embute o segredo no PATH
 * (`https://seu.host/api/webhooks/array/<ARRAY_WEBHOOK_TOKEN>`), então devolver
 * a URL "só informativa" era devolver o segredo. Elidimos:
 *  - o último segmento de `/api/webhooks/array/<...>`;
 *  - qualquer segmento de path igual ao token configurado;
 *  - qualquer valor de query igual ao token.
 * O resto da URL (host e caminho) continua visível, que é o que o usuário
 * precisa conferir.
 */
export function maskListenerUrl(url: string, token: string): string {
  const raw = (url ?? '').trim()
  if (!raw) return ''
  let masked = raw.replace(/(\/api\/webhooks\/array\/)[^/?#]+/i, '$1***')
  const t = (token ?? '').trim()
  if (t) {
    // Split/join em vez de regex: o token é dado do usuário, não padrão.
    masked = masked.split(t).join('***')
  }
  return masked
}

export interface NormalizedWebhookEvent {
  eventType: string
  clientKey: string | null
  reportKey: string | null
  payload: unknown
  /**
   * W2-009: `false` quando o corpo não é um objeto JSON (JSON inválido, corpo
   * vazio, array, escalar). A doc exige responder 200, mas o evento não pode
   * se passar por evento bem-formado.
   */
  parseable: boolean
  /**
   * Chave de idempotência (W2-009): id do evento se houver, senão
   * `eventType + reportKey/clientKey`. `null` quando não há como deduplicar.
   */
  dedupeKey: string | null
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * O envelope exato do webhook é // UNVERIFIED (a página /docs/webhook-events é
 * gated). Só extraímos os campos CITADOS pela documentação — `clientKey`,
 * `reportKey`, `displayToken`, `productCode` — e guardamos o corpo cru inteiro,
 * sem descartar nada. O payload é tratado como NOTIFICAÇÃO NÃO CONFIÁVEL:
 * nada aqui é usado como verdade sem reconfirmar pela API.
 */
export function normalizeWebhookEvent(
  body: unknown,
  opts: { unparseable?: boolean } = {},
): NormalizedWebhookEvent {
  const isObject = !!body && typeof body === 'object' && !Array.isArray(body)
  const parseable = !opts.unparseable && isObject
  if (!parseable) {
    const why = opts.unparseable
      ? 'corpo não é JSON válido'
      : body === undefined || body === null
        ? 'corpo vazio'
        : Array.isArray(body)
          ? 'corpo é um array, não um objeto'
          : `corpo é um ${typeof body}, não um objeto`
    return {
      eventType: `(evento NÃO PARSEÁVEL: ${why})`,
      clientKey: null,
      reportKey: null,
      payload: { _unparseable: true, reason: why, raw: body ?? null },
      parseable: false,
      dedupeKey: null,
    }
  }
  const b = body as Record<string, unknown>
  const nested = (b.data && typeof b.data === 'object' ? (b.data as Record<string, unknown>) : {}) as Record<string, unknown>
  const eventType =
    str(b.eventType) || str(b.event) || str(b.type) || str(b.name) || str(nested.eventType) || '(sem eventType no corpo)'
  const clientKey = str(b.clientKey) || str(nested.clientKey) || null
  const reportKey = str(b.reportKey) || str(nested.reportKey) || null
  const eventId = str(b.id) || str(b.eventId) || str(nested.id) || str(nested.eventId)
  const dedupeKey = eventId
    ? `id:${eventId}`
    : reportKey || clientKey
      ? `evt:${eventType}|${reportKey ?? ''}|${clientKey ?? ''}`
      : null
  return { eventType, clientKey, reportKey, payload: body ?? null, parseable: true, dedupeKey }
}
