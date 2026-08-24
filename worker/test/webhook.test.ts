import { beforeEach, describe, expect, it } from 'vitest'
import app from '../src/index'
import { fakeD1 } from './fakeD1'
import { maskWebhookPath, normalizeWebhookEvent, timingSafeEqual, webhookTokenMatches } from '../src/webhook'

const TOKEN = 'w3bh00k-secret-do-path'

let db: ReturnType<typeof fakeD1>

const env = (extra: Record<string, unknown> = {}) =>
  ({ DB: db as unknown as D1Database, CACHE: {} as KVNamespace, ...extra }) as never

const call = (path: string, init?: RequestInit, extra: Record<string, unknown> = {}) =>
  app.fetch(new Request(`http://local${path}`, init), env(extra))

const postJson = (path: string, bodyObj: unknown, extra: Record<string, unknown> = {}) =>
  call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(bodyObj) }, extra)

beforeEach(() => {
  db = fakeD1()
})

// ---------------------------------------------------------------------------
// Comparação do token
// ---------------------------------------------------------------------------

describe('token do webhook', () => {
  it('compara em tempo constante, sem early-return por caractere', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true)
    expect(timingSafeEqual('abc', 'abd')).toBe(false)
    expect(timingSafeEqual('abc', 'abcd')).toBe(false)
    expect(timingSafeEqual('', '')).toBe(true)
    // Prefixo correto não vaza por comprimento diferente.
    expect(timingSafeEqual('segredo', 'segredoX')).toBe(false)
    expect(timingSafeEqual('segredoX', 'segredo')).toBe(false)
  })

  it('nunca autentica com token vazio dos dois lados', () => {
    expect(webhookTokenMatches('', '')).toBe(false)
    expect(webhookTokenMatches('', 'qualquer')).toBe(false)
    expect(webhookTokenMatches('configurado', '')).toBe(false)
    expect(webhookTokenMatches('configurado', 'configurado')).toBe(true)
  })

  it('mascara o segredo no path antes de qualquer gravação', () => {
    expect(maskWebhookPath('/api/webhooks/array/SEGREDO')).toBe('/api/webhooks/array/***')
    expect(maskWebhookPath('/api/webhooks/array/SEGREDO/extra')).toBe('/api/webhooks/array/***/extra')
    expect(maskWebhookPath('/api/status')).toBe('/api/status')
  })
})

describe('normalização do evento', () => {
  it('extrai só os campos CITADOS pela doc e guarda o corpo cru', () => {
    const e = normalizeWebhookEvent({ eventType: 'Report ready', clientKey: 'CK', reportKey: 'RK', extra: 1 })
    expect(e).toMatchObject({ eventType: 'Report ready', clientKey: 'CK', reportKey: 'RK' })
    expect(e.payload).toMatchObject({ extra: 1 })
  })

  it('aceita envelope aninhado e corpo sem eventType', () => {
    expect(normalizeWebhookEvent({ event: 'x', data: { clientKey: 'CK' } })).toMatchObject({ eventType: 'x', clientKey: 'CK' })
    expect(normalizeWebhookEvent({}).eventType).toMatch(/sem eventType/)
    expect(normalizeWebhookEvent(null).clientKey).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Rota do listener
// ---------------------------------------------------------------------------

describe('POST /api/webhooks/array/:token', () => {
  it('404 quando ARRAY_WEBHOOK_TOKEN não está configurado (rota não existe)', async () => {
    const res = await postJson('/api/webhooks/array/qualquer', { eventType: 'x' })
    expect(res.status).toBe(404)
    expect(db.webhookEvents).toHaveLength(0)
  })

  it('404 genérico com token errado — e nada é persistido', async () => {
    const res = await postJson('/api/webhooks/array/errado', { eventType: 'x' }, { ARRAY_WEBHOOK_TOKEN: TOKEN })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ message: 'Not Found' })
    expect(db.webhookEvents).toHaveLength(0)
  })

  it('200 com o token certo e persiste o evento no D1', async () => {
    const res = await postJson(
      `/api/webhooks/array/${TOKEN}`,
      { eventType: 'Customer ordered a report', clientKey: 'CK-1', reportKey: 'RK-1', productCode: 'credmo3bReportScore' },
      { ARRAY_WEBHOOK_TOKEN: TOKEN },
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ received: true, eventType: 'Customer ordered a report' })

    expect(db.webhookEvents).toHaveLength(1)
    const row = db.webhookEvents[0]
    expect(row).toMatchObject({ event_type: 'Customer ordered a report', client_key: 'CK-1', report_key: 'RK-1', source: 'array' })
    expect(String(row.payload)).toContain('credmo3bReportScore')
  })

  it('o token NUNCA aparece na resposta, no evento gravado nem na auditoria', async () => {
    await postJson(`/api/webhooks/array/${TOKEN}`, { eventType: 'x' }, { ARRAY_WEBHOOK_TOKEN: TOKEN })
    expect(JSON.stringify(db.webhookEvents)).not.toContain(TOKEN)
    const audited = JSON.stringify(db.apiCalls)
    expect(audited).not.toContain(TOKEN)
    expect(audited).toContain('/api/webhooks/array/***')
  })

  it('lista os eventos e sabe limpá-los', async () => {
    await postJson(`/api/webhooks/array/${TOKEN}`, { eventType: 'a' }, { ARRAY_WEBHOOK_TOKEN: TOKEN })
    await postJson(`/api/webhooks/array/${TOKEN}`, { eventType: 'b' }, { ARRAY_WEBHOOK_TOKEN: TOKEN })

    const list = await (await call('/api/webhooks/events', undefined, { ARRAY_WEBHOOK_TOKEN: TOKEN })).json()
    expect(list.total).toBe(2)
    expect(list.events.map((e: { event_type: string }) => e.event_type)).toEqual(['b', 'a'])

    await call('/api/webhooks/events', { method: 'DELETE' }, { ARRAY_WEBHOOK_TOKEN: TOKEN })
    expect((await (await call('/api/webhooks/events')).json()).total).toBe(0)
  })
})

describe('simulação local e configuração', () => {
  it('POST /api/webhooks/simulate grava um evento marcado como simulado', async () => {
    const res = await postJson('/api/webhooks/simulate', {})
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ received: true, simulated: true })
    expect(db.webhookEvents[0]).toMatchObject({ source: 'simulated' })
  })

  it('a simulação aceita um envelope próprio', async () => {
    await postJson('/api/webhooks/simulate', { eventType: 'Credit Score Simulated', clientKey: 'CK-9' })
    expect(db.webhookEvents[0]).toMatchObject({ event_type: 'Credit Score Simulated', client_key: 'CK-9', source: 'simulated' })
  })

  it('GET /api/webhooks/config diz o que informar ao Customer Success, sem o segredo', async () => {
    const res = await call('/api/webhooks/config', undefined, {
      ARRAY_WEBHOOK_TOKEN: TOKEN,
      ARRAY_LISTENER_URL: 'https://meu.host/api/webhooks/array/xxx',
    })
    const json = await res.json()
    expect(json).toMatchObject({
      listenerUrl: 'https://meu.host/api/webhooks/array/xxx',
      configured: true,
      registrationIsManual: true,
      signatureFromArray: false,
      secretInPathInferred: true,
    })
    expect(JSON.stringify(json)).not.toContain(TOKEN)
  })

  it('/api/status expõe o listener e o modo de auth, nunca o token', async () => {
    const res = await call('/api/status', undefined, {
      ARRAY_WEBHOOK_TOKEN: TOKEN,
      ARRAY_LISTENER_URL: 'https://meu.host/hook',
      ARRAY_AUTH_MODE: 'browser',
    })
    const json = await res.json()
    expect(json).toMatchObject({ authMode: 'browser' })
    expect(json.webhook).toMatchObject({ configured: true, listenerUrl: 'https://meu.host/hook' })
    expect(JSON.stringify(json)).not.toContain(TOKEN)
  })
})
