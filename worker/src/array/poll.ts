/**
 * Polling de `GET /report/v2` pelo critério DOCUMENTADO — status HTTP, não
 * inspeção de corpo (docs/ARRAY_ENV_VARS.md §7-8, VERIFICADO em
 * docs.array.com/docs/how-to-retrieve-a-credit-report):
 *
 *   > "A 202 HTTP status means that the API is still generating the report, in
 *   >  which case you should repeat the call until it returns 200 (success) or
 *   >  204 (failure). The reportKey and displayToken will remain valid while
 *   >  you're making these iterated calls."
 *
 *   202 → ainda gerando, repetir
 *   200 → pronto
 *   204 → FALHA PERMANENTE, abortar já (a heurística antiga de "corpo vazio"
 *         girava até o timeout nesse caso — bug real corrigido no ciclo 13)
 *
 * O intervalo e o timeout vêm de ARRAY_POLL_INTERVAL / ARRAY_POLL_TIMEOUT.
 * A UNIDADE (segundos) é // UNVERIFIED: a Array não publica valores.
 */
import { ArrayApiError } from './types'

export interface PollOptions {
  intervalMs: number
  timeoutMs: number
  /** Injetáveis nos testes. */
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

export interface PollAttempt {
  status: number
  body?: unknown
}

export interface PollResult<T> {
  value: T
  attempts: number
  elapsedMs: number
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Repete `fetchOnce` enquanto ela devolver 202.
 * `200` resolve; `204` lança `kind: 'report_failed'`; qualquer outro status é
 * responsabilidade de `fetchOnce` (ela deve lançar antes de chegar aqui).
 */
export async function pollReport<T>(
  fetchOnce: (attempt: number) => Promise<PollAttempt>,
  opts: PollOptions,
): Promise<PollResult<T>> {
  const sleep = opts.sleep ?? defaultSleep
  const now = opts.now ?? (() => Date.now())
  const started = now()
  let attempts = 0

  for (;;) {
    attempts++
    const res = await fetchOnce(attempts)

    if (res.status === 200) {
      return { value: res.body as T, attempts, elapsedMs: now() - started }
    }

    if (res.status === 204) {
      throw new ArrayApiError(
        'A Array reportou falha PERMANENTE na geração do relatório (HTTP 204). Não adianta repetir: peça outro relatório (POST /report/v2).',
        502,
        { status: 204, attempts },
        'report_failed',
      )
    }

    if (res.status !== 202) {
      // Contrato do chamador: 4xx/5xx viram ArrayApiError antes daqui.
      throw new ArrayApiError(
        `Status inesperado no polling do relatório: HTTP ${res.status} (esperado 200, 202 ou 204)`,
        502,
        { status: res.status, attempts },
        'http',
      )
    }

    const elapsed = now() - started
    if (elapsed + opts.intervalMs > opts.timeoutMs) {
      throw new ArrayApiError(
        `O relatório continuou em geração (HTTP 202) após ${Math.round(opts.timeoutMs / 1000)}s e ${attempts} tentativa(s). ` +
          'Aumente ARRAY_POLL_TIMEOUT ou espere o webhook — o reportKey/displayToken continuam válidos.',
        504,
        { status: 202, attempts, timeoutMs: opts.timeoutMs },
        'timeout',
      )
    }
    await sleep(opts.intervalMs)
  }
}
