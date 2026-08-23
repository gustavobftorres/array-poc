import { useEffect, useRef, useState } from 'react'
import { api, type CreditReport } from '../lib/api'
import { useSession } from '../lib/session'
import { Card, Empty, ErrorBox, Json, TokenChip, useAsync } from '../components/ui'

const PRODUCTS = [
  { code: 'credmo3bReportScore', label: 'credmo3bReportScore — 3 bureaus + score' },
  { code: 'exp1bScore', label: 'exp1bScore — Experian, só score' },
]

const money = (n: number) => `US$ ${n.toLocaleString('en-US')}`

/** Human labels + per-field formatting for the `summary` block (V-011). */
const SUMMARY_META: Record<string, { label: string; format: (v: unknown) => string }> = {
  totalAccounts: { label: 'Contas (total)', format: String },
  openAccounts: { label: 'Contas abertas', format: String },
  totalBalance: { label: 'Saldo total', format: (v) => money(Number(v)) },
  totalCreditLimit: { label: 'Limite total (rotativo)', format: (v) => money(Number(v)) },
  utilization: { label: 'Utilização do rotativo', format: (v) => `${v}%` },
  delinquencies: { label: 'Contas com atraso', format: String },
  inquiries6mo: { label: 'Consultas hard (6 meses)', format: String },
  oldestAccountYears: { label: 'Conta mais antiga', format: (v) => `${v} anos` },
}

function summaryTile(key: string, value: unknown): { label: string; value: string } {
  const meta = SUMMARY_META[key]
  if (meta) return { label: meta.label, value: meta.format(value) }
  return { label: key, value: typeof value === 'number' ? value.toLocaleString('en-US') : String(value) }
}

function ScoreGauge({ score, model }: { score: number; model: string }) {
  const pct = Math.max(0, Math.min(1, (score - 300) / 550))
  const band = score >= 780 ? 'Excelente' : score >= 720 ? 'Muito bom' : score >= 660 ? 'Bom' : score >= 600 ? 'Regular' : 'Ruim'
  return (
    <div className="score-wrap">
      <div>
        <div className="score-num">{score}</div>
        <div className="muted small">{model} · {band}</div>
      </div>
      <div style={{ flex: '1 1 240px', minWidth: 200 }}>
        <div className="score-bar">
          <span className="pin" style={{ left: `calc(${pct * 100}% - 1px)` }} />
        </div>
        <div className="row small muted" style={{ justifyContent: 'space-between', marginTop: 6 }}>
          <span>300</span>
          <span>850</span>
        </div>
      </div>
    </div>
  )
}

function History({ points }: { points: { month: string; score: number }[] }) {
  if (!points?.length) return <Empty>Sem histórico.</Empty>
  const min = Math.min(...points.map((p) => p.score)) - 8
  const max = Math.max(...points.map((p) => p.score)) + 4
  return (
    <>
      <div className="spark">
        {points.map((p) => (
          <div key={p.month} title={`${p.month}: ${p.score}`} style={{ height: `${((p.score - min) / (max - min)) * 100}%` }} />
        ))}
      </div>
      <div className="row small muted" style={{ justifyContent: 'space-between', marginTop: 6 }}>
        <span>{points[0].month}</span>
        <span>{points[points.length - 1].month}</span>
      </div>
    </>
  )
}

function PaymentStrip({ history }: { history: string[] }) {
  return (
    <div className="ph-strip">
      {(history ?? []).slice(-12).map((h, i) => (
        <span key={i} className={h === '30' ? 'late30' : h === '60' ? 'late60' : ''} title={h} />
      ))}
    </div>
  )
}

export function CreditReportPage() {
  const { session, patch, status } = useSession()
  const [clientKey, setClientKey] = useState(session.clientKey)
  const [productCode, setProductCode] = useState(PRODUCTS[0].code)
  const order = useAsync<{ reportKey: string; displayToken: string; productCode: string }>()
  const report = useAsync<CreditReport>()

  const run = async () => {
    const o = await order.run(() => api.orderReport({ clientKey: clientKey.trim(), productCode }))
    if (!o) return
    patch({ clientKey: clientKey.trim(), reportKey: o.reportKey, displayToken: o.displayToken })
    await report.run(() => api.getReport({ reportKey: o.reportKey, displayToken: o.displayToken, clientKey: clientKey.trim() }))
  }

  // A reload keeps clientKey/reportKey/displayToken in localStorage, so the
  // report itself must come back too instead of an empty screen (V-019/V-007).
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current) return
    if (!session.reportKey || !session.displayToken) return
    restored.current = true
    order.setData({
      reportKey: session.reportKey,
      displayToken: session.displayToken,
      productCode,
    })
    void report.run(() =>
      api.getReport({
        reportKey: session.reportKey,
        displayToken: session.displayToken,
        clientKey: session.clientKey || undefined,
      }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.reportKey, session.displayToken])

  const refresh = async () => {
    if (!order.data) return
    const res = await api.refreshDisplayToken({ clientKey: clientKey.trim(), reportKey: order.data.reportKey })
    order.setData({ ...order.data, displayToken: res.displayToken })
    patch({ displayToken: res.displayToken })
  }

  const r = report.data
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Credit Report</h1>
          <p>
            <code>POST /report/v2</code> devolve <code>reportKey</code> + <code>displayToken</code>;{' '}
            <code>GET /report/v2</code> busca o conteúdo.{' '}
            {status?.mode === 'mock' ? (
              <>
                Modo <strong>mock</strong>: nenhuma chamada externa (a base seria <code>{status?.baseUrl}</code>).
              </>
            ) : (
              <>Base: <code>{status?.baseUrl}</code></>
            )}
          </p>
        </div>
      </div>

      <Card title="Pedir relatório">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 300px' }}>
            <label>clientKey</label>
            <input value={clientKey} onChange={(e) => setClientKey(e.target.value)} placeholder="clientKey autenticado" />
          </div>
          <div style={{ flex: '1 1 260px' }}>
            <label>productCode</label>
            <select value={productCode} onChange={(e) => setProductCode(e.target.value)}>
              {PRODUCTS.map((p) => (
                <option key={p.code} value={p.code}>{p.label}</option>
              ))}
            </select>
          </div>
          <button className="primary" onClick={run} disabled={!clientKey.trim() || order.loading || report.loading}>
            {order.loading || report.loading ? 'Pedindo…' : 'Pedir e buscar'}
          </button>
          {order.data && <button onClick={refresh}>Renovar displayToken (PUT)</button>}
        </div>
        <ErrorBox error={order.error} />
        <ErrorBox error={report.error} />
        {order.data && (
          <dl className="kv" style={{ marginTop: 12 }}>
            <dt>reportKey</dt>
            <dd><TokenChip value={order.data.reportKey} /></dd>
            <dt>displayToken</dt>
            <dd><TokenChip value={order.data.displayToken} mask /></dd>
          </dl>
        )}
      </Card>

      {r && (
        <>
          <div className="grid cols-2">
            <Card title="Score">
              <ScoreGauge score={r.score} model={r.scoreModel} />
              <div className="grid cols-3" style={{ marginTop: 14 }}>
                {(r.scores ?? []).map((s) => (
                  <div key={s.bureau} className="card stat" style={{ boxShadow: 'none' }}>
                    <div className="label">{s.bureau}</div>
                    <div className="value">{s.score}</div>
                  </div>
                ))}
              </div>
            </Card>
            <Card title="Histórico (12 meses)">
              <History points={r.scoreHistory} />
            </Card>
          </div>

          <div className="grid cols-4">
            {Object.entries(r.summary ?? {}).map(([k, v]) => {
              const tile = summaryTile(k, v)
              return (
                <div className="card stat" key={k}>
                  <div className="label">{tile.label}</div>
                  <div className="value">{tile.value}</div>
                </div>
              )
            })}
          </div>

          <Card title="Fatores do score">
            <div className="grid cols-2">
              {(r.factors ?? []).map((f) => (
                <div key={f.code} className="card" style={{ boxShadow: 'none' }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <strong>{f.label}</strong>
                    <span className={`badge ${f.direction === 'positive' ? 'ok' : 'danger'}`}>
                      {f.direction === 'positive' ? '▲' : '▼'} {f.impact}
                    </span>
                  </div>
                  <div className="small muted">{f.description}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card title={`Tradelines (${r.tradelines?.length ?? 0})`}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Credor</th>
                    <th>Bureau</th>
                    <th>Tipo</th>
                    <th>Conta</th>
                    <th>Aberta</th>
                    <th className="num">Saldo</th>
                    <th className="num">Limite</th>
                    <th className="num">Parcela</th>
                    <th>Status</th>
                    <th>12m</th>
                  </tr>
                </thead>
                <tbody>
                  {(r.tradelines ?? []).map((t, i) => (
                    <tr key={`${t.creditorName}-${i}`}>
                      <td>{t.creditorName}</td>
                      <td><span className="badge neutral">{t.bureau}</span></td>
                      <td>{t.accountType}</td>
                      <td className="mono">{t.accountNumber}</td>
                      <td>{t.opened}</td>
                      <td className="num">{money(t.balance)}</td>
                      <td className="num">{money(t.creditLimit)}</td>
                      <td className="num">{money(t.monthlyPayment)}</td>
                      <td>{t.status}</td>
                      <td><PaymentStrip history={t.paymentHistory} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid cols-2">
            <Card title={`Consultas (${r.inquiries?.length ?? 0})`}>
              {r.inquiries?.length ? (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Assinante</th><th>Bureau</th><th>Data</th><th>Tipo</th></tr></thead>
                    <tbody>
                      {r.inquiries.map((q, i) => (
                        <tr key={i}>
                          <td>{q.subscriberName}</td>
                          <td>{q.bureau}</td>
                          <td>{q.date}</td>
                          <td><span className={`badge ${q.type === 'Hard' ? 'warn' : 'neutral'}`}>{q.type}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>Nenhuma consulta.</Empty>
              )}
            </Card>
            <Card title={`Cobranças (${r.collections?.length ?? 0})`}>
              {r.collections?.length ? (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Agência</th><th>Credor original</th><th className="num">Valor</th><th>Status</th><th>Reportado</th></tr></thead>
                    <tbody>
                      {r.collections.map((c, i) => (
                        <tr key={i}>
                          <td>{c.agency}</td>
                          <td>{c.originalCreditor}</td>
                          <td className="num">{money(c.amount)}</td>
                          <td><span className="badge danger">{c.status}</span></td>
                          <td>{c.reported}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>Nenhuma cobrança — bom sinal.</Empty>
              )}
            </Card>
          </div>

          <Card title="Payload completo">
            <Json data={r} />
          </Card>
        </>
      )}
    </div>
  )
}
