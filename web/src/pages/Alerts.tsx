import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Alert, type Enrollment } from '../lib/api'
import { useSession } from '../lib/session'
import { Card, Empty, ErrorBox, Json, useAsync } from '../components/ui'

const SEV_CLASS: Record<Alert['severity'], string> = {
  critical: 'danger',
  high: 'danger',
  medium: 'warn',
  low: 'neutral',
  info: 'info',
}

const BUREAUS = ['', 'TransUnion', 'Experian', 'Equifax', 'IdentityProtect']

export function Alerts() {
  const { session } = useSession()
  const [clientKey, setClientKey] = useState(session.clientKey)
  const [bureau, setBureau] = useState('')
  const alerts = useAsync<{ alerts: Alert[] }>()
  const monitoring = useAsync<{ enrollments: Enrollment[] }>()

  const load = useCallback(async () => {
    const key = clientKey.trim()
    if (!key) return
    await alerts.run(() => api.alerts(key, bureau || undefined))
    await monitoring.run(() => api.monitoring(key))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientKey, bureau])

  // With a clientKey already in the session, load on mount instead of showing
  // an empty screen that looks like "there is nothing here" (V-007).
  const autoLoaded = useRef(false)
  useEffect(() => {
    if (autoLoaded.current || !session.clientKey) return
    autoLoaded.current = true
    void load()
  }, [session.clientKey, load])

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Alerts / Monitoring</h1>
          <p>
            Os paths de alertas e monitoramento são <strong>inferidos</strong> (<code>/alert/v2</code>,{' '}
            <code>/monitoring/v2</code>) — veja <code>// UNVERIFIED path</code> em{' '}
            <code>worker/src/array/client.ts</code>. Em modo mock as fixtures cobrem os tipos documentados.
          </p>
        </div>
      </div>

      <Card title="Consultar">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 300px' }}>
            <label>clientKey</label>
            <input value={clientKey} onChange={(e) => setClientKey(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 200px' }}>
            <label>Bureau</label>
            <select value={bureau} onChange={(e) => setBureau(e.target.value)}>
              {BUREAUS.map((b) => (
                <option key={b} value={b}>{b || 'Todos'}</option>
              ))}
            </select>
          </div>
          <button className="primary" onClick={load} disabled={!clientKey.trim() || alerts.loading}>
            {alerts.loading ? 'Buscando…' : 'Buscar alertas'}
          </button>
        </div>
        <ErrorBox error={alerts.error} />
        {!clientKey.trim() && (
          <p className="hint" style={{ marginTop: 10 }}>
            Sem <code>clientKey</code> na sessão: rode o Enrollment ou “Semear usuário demo” no Dashboard. Com a sessão
            preenchida esta tela busca os alertas sozinha ao abrir.
          </p>
        )}
      </Card>

      {alerts.data && (
        <Card title={`Alertas (${alerts.data.alerts.length})`}>
          {alerts.data.alerts.length === 0 ? (
            <Empty>Nenhum alerta para esse filtro.</Empty>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              {alerts.data.alerts.map((a) => (
                <div key={a.alertId} className="card" style={{ boxShadow: 'none' }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <div className="row" style={{ gap: 8 }}>
                      <span className={`badge ${SEV_CLASS[a.severity] ?? 'neutral'}`}>{a.severity}</span>
                      <strong>{a.title}</strong>
                    </div>
                    <div className="row small muted" style={{ gap: 8 }}>
                      <span className="badge neutral">{a.bureau}</span>
                      <span className="badge neutral">{a.type}</span>
                      {!a.read && <span className="badge info">não lido</span>}
                    </div>
                  </div>
                  <div className="small" style={{ marginTop: 6 }}>{a.description}</div>
                  <div className="small muted" style={{ marginTop: 4 }}>{new Date(a.createdAt).toLocaleString('pt-BR')}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            <Json data={alerts.data} />
          </div>
        </Card>
      )}

      {monitoring.data && (
        <Card title={`Enrollments de monitoramento (${monitoring.data.enrollments.length})`}>
          <ErrorBox error={monitoring.error} />
          <div className="table-wrap">
            <table>
              <thead><tr><th>Bureau</th><th>Produto</th><th>Status</th><th>Desde</th></tr></thead>
              <tbody>
                {monitoring.data.enrollments.map((e) => (
                  <tr key={e.enrollmentId}>
                    <td>{e.bureau}</td>
                    <td className="mono">{e.product}</td>
                    <td><span className={`badge ${e.status === 'active' ? 'ok' : 'warn'}`}>{e.status}</span></td>
                    <td>{new Date(e.enrolledAt).toLocaleDateString('pt-BR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
