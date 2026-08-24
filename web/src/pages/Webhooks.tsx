import { useCallback, useEffect, useState } from 'react'
import { api, type WebhookConfig, type WebhookEvent } from '../lib/api'
import { useSession } from '../lib/session'
import { Card, CopyButton, Empty, ErrorBox, Json, useAsync } from '../components/ui'

/**
 * Tela de Webhooks (ciclo 13).
 *
 * O que é VERIFICADO (docs.array.com/docs/how-to-receive-webhooks):
 *  - a Array faz `POST` JSON no SEU listener, sem query params e sem headers
 *    customizados — portanto sem assinatura e sem HMAC;
 *  - o listener responde `200` para confirmar;
 *  - **não existe API de registro**: a URL é entregue ao seu representante de
 *    Customer Success (um listener para sandbox, outro para produção).
 *
 * O que é INFERIDO nesta POC:
 *  - `ARRAY_WEBHOOK_TOKEN` como segredo GERADO POR VOCÊ e embutido no PATH do
 *    listener (única autenticação possível sem assinatura);
 *  - o envelope do evento (a página /docs/webhook-events é gated).
 */
export function WebhooksPage() {
  const { status } = useSession()
  const [cfg, setCfg] = useState<WebhookConfig | null>(null)
  const [events, setEvents] = useState<WebhookEvent[]>([])
  const [total, setTotal] = useState(0)
  const [custom, setCustom] = useState('')
  const sim = useAsync<{ received: boolean; eventType: string }>()

  const load = useCallback(async () => {
    const [c, e] = await Promise.all([
      api.webhookConfig().catch(() => null),
      api.webhookEvents().catch(() => ({ events: [], total: 0 })),
    ])
    if (c) setCfg(c)
    setEvents(e.events)
    setTotal(e.total)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const simulate = async () => {
    let payload: unknown = undefined
    if (custom.trim()) {
      try {
        payload = JSON.parse(custom)
      } catch {
        sim.setError(new Error('O JSON do evento não é válido — corrija antes de simular.'))
        return
      }
    }
    const res = await sim.run(() => api.simulateWebhook(payload))
    if (res) await load()
  }

  const clear = async () => {
    await api.clearWebhookEvents()
    await load()
  }

  // W2-003: o que chega aqui JÁ vem com o segredo do path elidido — a URL
  // completa nunca sai do worker.
  const listener = cfg?.listenerUrl ?? status?.webhook.listenerUrl ?? null
  const listenerMasked = (cfg?.listenerUrlMasked ?? status?.webhook.listenerUrlMasked) === true
  const configured = cfg?.configured ?? status?.webhook.configured ?? false

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Webhooks</h1>
          <p>
            A Array avisa seu backend por <strong>webhook</strong> quando um relatório fica pronto e quando um alerta
            é detectado. Aqui você vê os eventos que chegaram no listener desta POC — e simula um localmente, já que a
            Array não consegue chamar o seu <code>localhost</code>.
          </p>
          <p className="hint">
            <span className="badge ok">verificado</span> A mensagem é <code>POST</code> com{' '}
            <code>Content-Type: application/json</code> e <strong>não traz query params nem headers customizados</strong>
            — logo não há assinatura, não há HMAC e não há segredo emitido pela Array. Seu listener deve responder{' '}
            <code>200</code>.
          </p>
          <p className="hint">
            <span className="badge warn">// UNVERIFIED</span> A interpretação do <code>ARRAY_WEBHOOK_TOKEN</code> como um
            segredo <strong>gerado por você</strong> e embutido no <strong>path</strong> do listener é inferência desta
            POC — é a mitigação padrão quando o remetente não assina. O envelope exato do evento também é inferido (a
            página <code>/docs/webhook-events</code> é fechada): a POC guarda o corpo cru inteiro e só destaca os campos
            citados pela documentação (<code>clientKey</code>, <code>reportKey</code>, <code>displayToken</code>,{' '}
            <code>productCode</code>).
          </p>
        </div>
      </div>

      <div className="grid cols-2">
        <Card title="Registro do listener (passo MANUAL)">
          <div className="alert-box warn">
            <strong>Não existe API de registro de webhook na Array.</strong> Você entrega a URL completa do listener ao
            seu representante de <em>Customer Success</em>. Recomendado: duas URLs registradas, uma para sandbox e uma
            para produção.
          </div>
          <dl className="kv" style={{ marginTop: 12 }}>
            <dt>ARRAY_LISTENER_URL</dt>
            <dd className="mono" style={{ overflowWrap: 'anywhere' }}>
              {listener ?? <span className="muted">não configurada — defina ARRAY_LISTENER_URL no .env</span>}
              {listener && <CopyButton text={listener} label="Copiar (elidida)" />}
              {listenerMasked && (
                <>
                  {' '}
                  <span className="badge ok">segredo elidido</span>
                  <p className="small muted" style={{ margin: '6px 0 0' }}>
                    O último segmento é o <code>ARRAY_WEBHOOK_TOKEN</code>, então a URL inteira é segredo: a API
                    devolve <code>***</code> no lugar dele e o botão copia essa versão. A URL completa que você
                    entrega ao Customer Success está no seu <code>.env</code> — leia de lá.
                  </p>
                </>
              )}
            </dd>
            <dt>Rota desta POC</dt>
            <dd className="mono">{cfg?.localPath ?? '/api/webhooks/array/<ARRAY_WEBHOOK_TOKEN>'}</dd>
            <dt>ARRAY_WEBHOOK_TOKEN</dt>
            <dd>
              <span className={`badge ${configured ? 'ok' : 'danger'}`}>
                {configured ? 'configurado' : 'ausente — a rota responde 404'}
              </span>{' '}
              <span className="small muted">
                comparado em tempo constante; a POC nunca o grava nem o devolve (a listener URL sai elidida)
              </span>
              <p className="small muted" style={{ margin: '6px 0 0' }}>
                <span className="badge warn">ressalva</span> Segredo-no-path aparece no{' '}
                <strong>access log do runtime</strong>: o <code>wrangler dev</code> imprime{' '}
                <code>POST /api/webhooks/array/&lt;token&gt;</code> no terminal, e o mesmo vale para proxies e CDNs em
                produção. É a fraqueza inerente do modelo (a Array não assina os webhooks). Trate o log como
                sensível e rotacione o token.
              </p>
            </dd>
            <dt>Assinatura da Array</dt>
            <dd>
              <span className="badge danger">não existe</span>
            </dd>
          </dl>
          <p className="hint" style={{ marginBottom: 0 }}>
            Trate todo payload como <strong>notificação não confiável</strong>: reconfirme pela API antes de agir e
            aplique idempotência por <code>reportKey</code>/id de evento — o listener desta POC já deduplica por{' '}
            <code>id</code> (ou <code>eventType+reportKey+clientKey</code>) e marca como{' '}
            <strong>NÃO PARSEÁVEL</strong> um corpo que não seja objeto JSON, respondendo <code>200</code> como a doc
            exige. Rotacionar o token exige pedir a troca da URL
            ao Customer Success (aceite dois tokens durante a janela de rotação).
          </p>
        </Card>

        <Card title="Simular um evento localmente">
          <p className="small muted">
            A Array não alcança o seu <code>localhost</code>. Este botão grava um evento com{' '}
            <code>source: simulated</code> — ele nunca se passa por evento real.
          </p>
          <label htmlFor="webhook-envelope">Envelope JSON (opcional)</label>
          <textarea
            id="webhook-envelope"
            rows={6}
            className="mono"
            value={custom}
            placeholder={'{\n  "eventType": "Customer ordered a report",\n  "clientKey": "…",\n  "reportKey": "…"\n}'}
            onChange={(e) => setCustom(e.target.value)}
          />
          <div className="row" style={{ marginTop: 10 }}>
            <button className="primary" onClick={simulate} disabled={sim.loading}>
              {sim.loading ? 'Enviando…' : 'Simular evento'}
            </button>
            <button className="ghost" onClick={() => setCustom('')}>Limpar JSON</button>
            <span className="spacer" />
            <button className="tiny" onClick={load}>Recarregar</button>
            <button className="tiny ghost" onClick={clear} disabled={!total}>Limpar eventos</button>
          </div>
          <ErrorBox error={sim.error} />
          {sim.data && <div className="alert-box ok" style={{ marginTop: 10 }}>Evento registrado: {sim.data.eventType}</div>}
        </Card>
      </div>

      <Card title={`Eventos recebidos (${total})`}>
        {events.length === 0 ? (
          <Empty>
            Nenhum evento ainda. Use “Simular evento” — ou, com a POC publicada, registre a{' '}
            <code>ARRAY_LISTENER_URL</code> com o Customer Success da Array.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Recebido</th>
                  <th>Evento</th>
                  <th>clientKey</th>
                  <th>reportKey</th>
                  <th>Origem</th>
                  <th>Payload</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td className="muted">{String(e.received_at).slice(0, 19).replace('T', ' ')}</td>
                    <td>{e.event_type}</td>
                    <td className="mono">{e.client_key ?? '—'}</td>
                    <td className="mono">{e.report_key ?? '—'}</td>
                    <td>
                      <span className={`badge ${e.source === 'array' ? 'ok' : 'neutral'}`}>
                        {e.source === 'array' ? 'listener' : 'simulado'}
                      </span>
                    </td>
                    <td>
                      <Json data={e.payload} label="payload" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
