import { describe, expect, it, vi } from 'vitest'
import { pollReport } from '../src/array/poll'
import { ArrayApiError } from '../src/array/types'
import { ArrayClient } from '../src/array/client'

/** Relógio e sleep falsos: o loop é testado sem esperar de verdade. */
function fakeClock(startedAt = 0) {
  let t = startedAt
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms
    },
    advance: (ms: number) => {
      t += ms
    },
  }
}

describe('pollReport — critério documentado 202/200/204', () => {
  it('200 na primeira: uma tentativa, sem espera', async () => {
    const clock = fakeClock()
    const res = await pollReport<{ ok: boolean }>(async () => ({ status: 200, body: { ok: true } }), {
      intervalMs: 1000,
      timeoutMs: 120_000,
      sleep: clock.sleep,
      now: clock.now,
    })
    expect(res).toMatchObject({ attempts: 1, elapsedMs: 0 })
    expect(res.value).toEqual({ ok: true })
  })

  it('202 → 202 → 200: repete até o 200 e devolve o corpo', async () => {
    const clock = fakeClock()
    const statuses = [202, 202, 200]
    let i = 0
    const res = await pollReport<{ score: number }>(
      async () => {
        const status = statuses[i++]
        return status === 200 ? { status, body: { score: 712 } } : { status }
      },
      { intervalMs: 1000, timeoutMs: 120_000, sleep: clock.sleep, now: clock.now },
    )
    expect(res.attempts).toBe(3)
    expect(res.value).toEqual({ score: 712 })
    // duas esperas de 1s entre as três tentativas
    expect(res.elapsedMs).toBe(2000)
  })

  it('204 aborta IMEDIATAMENTE como falha permanente (o bug antigo girava até o timeout)', async () => {
    const clock = fakeClock()
    const statuses = [202, 204, 200]
    let i = 0
    const attempt = vi.fn(async () => {
      const status = statuses[i++]
      return status === 200 ? { status, body: { nunca: true } } : { status }
    })
    const err = await pollReport(attempt, {
      intervalMs: 1000,
      timeoutMs: 120_000,
      sleep: clock.sleep,
      now: clock.now,
    }).catch((e) => e)

    expect(err).toBeInstanceOf(ArrayApiError)
    expect((err as ArrayApiError).kind).toBe('report_failed')
    expect((err as ArrayApiError).message).toMatch(/PERMANENTE/)
    // Parou na 2ª: não continuou até o timeout nem consumiu o 200 seguinte.
    expect(attempt).toHaveBeenCalledTimes(2)
  })

  it('202 eterno estoura o ARRAY_POLL_TIMEOUT com kind timeout', async () => {
    const clock = fakeClock()
    const attempt = vi.fn(async () => ({ status: 202 }))
    const err = await pollReport(attempt, {
      intervalMs: 1000,
      timeoutMs: 5000,
      sleep: clock.sleep,
      now: clock.now,
    }).catch((e) => e)

    expect((err as ArrayApiError).kind).toBe('timeout')
    expect((err as ArrayApiError).status).toBe(504)
    expect((err as ArrayApiError).message).toMatch(/ARRAY_POLL_TIMEOUT/)
    // 5s de janela, 1s de intervalo: 6 tentativas (t=0..5s) e nada de loop infinito.
    expect(attempt).toHaveBeenCalledTimes(6)
  })

  it('um timeout menor que o intervalo ainda faz UMA tentativa e sai', async () => {
    const clock = fakeClock()
    const attempt = vi.fn(async () => ({ status: 202 }))
    await expect(
      pollReport(attempt, { intervalMs: 10_000, timeoutMs: 100, sleep: clock.sleep, now: clock.now }),
    ).rejects.toThrow(/202/)
    expect(attempt).toHaveBeenCalledTimes(1)
  })

  it('status fora do contrato não é confundido com "ainda gerando"', async () => {
    const err = await pollReport(async () => ({ status: 418 }), { intervalMs: 1, timeoutMs: 10 }).catch((e) => e)
    expect((err as ArrayApiError).kind).toBe('http')
    expect((err as ArrayApiError).message).toMatch(/418/)
  })
})

// ---------------------------------------------------------------------------
// O mesmo critério, agora ponta a ponta no ArrayClient (fetch falso)
// ---------------------------------------------------------------------------

const jsonRes = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

function client(responses: Response[], extra: Record<string, unknown> = {}) {
  const calls: string[] = []
  const fetchImpl = (async (url: string) => {
    calls.push(String(url))
    const next = responses.shift()
    if (!next) throw new Error('fetch chamado mais vezes que o esperado')
    return next
  }) as unknown as typeof fetch
  return {
    calls,
    client: new ArrayClient({
      baseUrl: 'https://sandbox.array.io/api',
      appKey: 'APPKEY',
      clientToken: 'SUPERSECRET',
      fetchImpl,
      sleepImpl: async () => {},
      pollIntervalMs: 1,
      pollTimeoutMs: 1000,
      ...extra,
    }),
  }
}

describe('ArrayClient.getReport', () => {
  // W2-008 — 200 com corpo VAZIO é upstream malformado, não relatório pronto.
  it('W2-008: 200 sem corpo vira erro tratado, não relatório vazio', async () => {
    const c = client([new Response('', { status: 200 })])
    const err = await c.client
      .getReport({ reportKey: 'RK', displayToken: 'DT', clientKey: 'CK', productCode: 'P' } as never)
      .catch((e) => e)
    expect(err).toBeInstanceOf(ArrayApiError)
    expect((err as ArrayApiError).kind).toBe('http')
    expect((err as ArrayApiError).message).toMatch(/sem corpo/)
  })

  it('faz o polling real: 202, 202, 200', async () => {
    const c = client([jsonRes(202), jsonRes(202), jsonRes(200, { reportKey: 'RK', score: 712 })])
    const report = await c.client.getReport({ reportKey: 'RK', displayToken: 'DT' })
    expect(report).toMatchObject({ score: 712 })
    expect(c.calls).toHaveLength(3)
    expect(c.calls[0]).toContain('reportKey=RK')
    expect(c.calls[0]).toContain('displayToken=DT')
  })

  it('204 vira erro report_failed sem mais nenhuma requisição', async () => {
    const c = client([jsonRes(202), jsonRes(204)])
    const err = await c.client.getReport({ reportKey: 'RK', displayToken: 'DT' }).catch((e) => e)
    expect((err as ArrayApiError).kind).toBe('report_failed')
    expect(c.calls).toHaveLength(2)
  })

  it('4xx no meio do polling não é tratado como "ainda gerando"', async () => {
    const c = client([jsonRes(202), jsonRes(400, { message: 'Bad Request' })])
    const err = await c.client.getReport({ reportKey: 'RK', displayToken: 'DT' }).catch((e) => e)
    expect((err as ArrayApiError).kind).toBe('http')
    expect((err as ArrayApiError).status).toBe(400)
  })

  it('a leitura do relatório é anônima: os capability tokens na query SÃO a auth', async () => {
    const c = client([jsonRes(200, { reportKey: 'RK' })])
    await c.client.getReport({ reportKey: 'RK', displayToken: 'DT' })
    // Nenhum header de client token é montado para esta chamada.
    const headers = c.client.headers({ method: 'GET', path: '/report/v2', anonymous: true })
    expect(headers['x-credmo-client-token']).toBeUndefined()
  })

  it('respeita o ARRAY_POLL_TIMEOUT vindo do config (202 para sempre)', async () => {
    const fetchImpl = (async () => jsonRes(202)) as unknown as typeof fetch
    const c = new ArrayClient({
      baseUrl: 'https://sandbox.array.io/api',
      appKey: 'A',
      clientToken: 'SUPERSECRET',
      fetchImpl,
      sleepImpl: async () => {},
      pollIntervalMs: 10,
      pollTimeoutMs: 30,
    })
    const err = await c.getReport({ reportKey: 'RK', displayToken: 'DT' }).catch((e) => e)
    expect((err as ArrayApiError).kind).toBe('timeout')
    expect((err as ArrayApiError).message).toMatch(/202/)
  })
})

// ---------------------------------------------------------------------------
// ARRAY_AUTH_MODE — invariante, não convenção
// ---------------------------------------------------------------------------

describe('ARRAY_AUTH_MODE — invariante do header', () => {
  const mk = (authMode: 'server' | 'browser') =>
    new ArrayClient({ baseUrl: 'https://sandbox.array.io/api', appKey: 'A', clientToken: 'SUPERSECRET', authMode })

  it('server: anexa o client token', () => {
    const h = mk('server').headers({ method: 'POST', path: '/user/v2' })
    expect(h['x-credmo-client-token']).toBe('SUPERSECRET')
    expect(h['x-credmo-user-token']).toBeUndefined()
  })

  it('server: um userToken presente substitui o client token (mutuamente exclusivos)', () => {
    const h = mk('server').headers({ method: 'GET', path: '/user/v2', userToken: 'UT' })
    expect(h['x-credmo-user-token']).toBe('UT')
    expect(h['x-credmo-client-token']).toBeUndefined()
  })

  it('browser: usa x-credmo-user-token e NUNCA o client token', () => {
    const h = mk('browser').headers({ method: 'GET', path: '/user/v2', userToken: 'UT' })
    expect(h['x-credmo-user-token']).toBe('UT')
    expect(h['x-credmo-client-token']).toBeUndefined()
    expect(JSON.stringify(h)).not.toContain('SUPERSECRET')
  })

  it('browser: sem userToken a chamada FALHA em vez de vazar o segredo', () => {
    let thrown: unknown
    try {
      mk('browser').headers({ method: 'POST', path: '/user/v2' })
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(ArrayApiError)
    expect((thrown as ArrayApiError).kind).toBe('auth_mode')
    expect((thrown as ArrayApiError).message).not.toContain('SUPERSECRET')
  })

  it('browser: nenhuma requisição chega a sair sem userToken', async () => {
    const fetchImpl = vi.fn(async () => jsonRes(200, {})) as unknown as typeof fetch
    const c = new ArrayClient({
      baseUrl: 'https://sandbox.array.io/api',
      appKey: 'A',
      clientToken: 'SUPERSECRET',
      authMode: 'browser',
      fetchImpl,
    })
    await expect(
      c.createUser({
        firstName: 'A',
        lastName: 'B',
        dob: '1980-01-01',
        ssn: '666000000',
        address: { street: '1 ST', city: 'AUSTIN', state: 'TX', zip: '78701' },
      }),
    ).rejects.toMatchObject({ kind: 'auth_mode' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('browser: a leitura anônima do relatório continua funcionando (query = auth)', async () => {
    const fetchImpl = (async () => jsonRes(200, { reportKey: 'RK' })) as unknown as typeof fetch
    const c = new ArrayClient({
      baseUrl: 'https://sandbox.array.io/api',
      appKey: 'A',
      clientToken: 'SUPERSECRET',
      authMode: 'browser',
      fetchImpl,
    })
    await expect(c.getReport({ reportKey: 'RK', displayToken: 'DT' })).resolves.toMatchObject({ reportKey: 'RK' })
  })
})
