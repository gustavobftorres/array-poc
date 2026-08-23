import { Fragment, useCallback, useEffect, useState } from 'react'
import { api, type ApiCall, type InspectorPage } from '../lib/api'
import { Card, Empty, ErrorBox, useAsync } from '../components/ui'

const PAGE = 25

function statusClass(status: number) {
  if (status >= 500) return 'danger'
  if (status >= 400) return 'warn'
  if (status >= 200 && status < 300) return 'ok'
  return 'neutral'
}

export function Inspector() {
  const [offset, setOffset] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  const page = useAsync<InspectorPage>()

  const load = useCallback((off: number) => page.run(() => api.inspector(PAGE, off)), [])

  useEffect(() => {
    load(offset)
  }, [offset, load])

  const data = page.data
  const calls: ApiCall[] = data?.calls ?? []

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>API Inspector</h1>
          <p>
            Toda chamada a <code>/api/*</code> é gravada na tabela <code>api_calls</code> do D1, com SSN e tokens
            redigidos antes da escrita. Latência em ms.
          </p>
        </div>
        <div className="row">
          <button onClick={() => load(offset)}>Recarregar</button>
          <button
            className="ghost"
            onClick={async () => {
              await api.clearInspector()
              setOffset(0)
              load(0)
            }}
          >
            Limpar log
          </button>
        </div>
      </div>

      <ErrorBox error={page.error} />

      <Card title={`Chamadas (${data?.total ?? 0})`}>
        {calls.length === 0 ? (
          <Empty>Nada registrado ainda. Navegue pelas outras telas e volte aqui.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Método</th>
                  <th>Path</th>
                  <th>Status</th>
                  <th className="num">ms</th>
                  <th>Modo</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => (
                  <Fragment key={c.id}>
                    <tr className="clickable" onClick={() => setOpen(open === c.id ? null : c.id)}>
                      <td className="muted">{c.ts.slice(11, 19)}</td>
                      <td><span className="badge neutral">{c.method}</span></td>
                      <td className="mono">{c.path}</td>
                      <td><span className={`badge ${statusClass(c.status)}`}>{c.status}</span></td>
                      <td className="num">{c.duration_ms}</td>
                      <td className="small muted">{c.mode}</td>
                    </tr>
                    {open === c.id && (
                      <tr>
                        <td className="detail-cell" colSpan={6}>
                          <div className="grid cols-2">
                            <div>
                              <div className="label small muted">Request (redigido)</div>
                              <pre className="json">{JSON.stringify(c.request, null, 2)}</pre>
                            </div>
                            <div>
                              <div className="label small muted">Response (redigido)</div>
                              <pre className="json">{JSON.stringify(c.response, null, 2)}</pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="row" style={{ marginTop: 12, justifyContent: 'space-between' }}>
          <span className="small muted">
            {data ? `${data.offset + 1}–${Math.min(data.offset + PAGE, data.total)} de ${data.total}` : '—'}
          </span>
          <div className="row">
            <button className="tiny" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - PAGE))}>
              ← Anteriores
            </button>
            <button className="tiny" disabled={!data || offset + PAGE >= data.total} onClick={() => setOffset((o) => o + PAGE)}>
              Próximas →
            </button>
          </div>
        </div>
      </Card>
    </div>
  )
}
