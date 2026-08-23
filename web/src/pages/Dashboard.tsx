import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useSession } from '../lib/session'
import { Card, ErrorBox, Empty, Json, Stat, TokenChip, useAsync } from '../components/ui'

export function Dashboard() {
  const { status, statusError, reloadStatus, session, patch } = useSession()
  const [users, setUsers] = useState<Record<string, unknown>[]>([])
  /** The D1 grows with every test seed; show a page, not everything (W-013). */
  const [showAll, setShowAll] = useState(false)
  const PAGE = 10
  const seed = useAsync<Record<string, unknown>>()

  const loadUsers = useCallback(
    () => api.users().then((r) => setUsers(r.users)).catch(() => setUsers([])),
    [],
  )
  // One fetch per mount. Depending on `status` used to fire this 3x per visit
  // (null -> object -> reload) and flooded the Inspector with internal calls.
  useEffect(() => {
    void loadUsers()
  }, [loadUsers])

  const runSeed = async () => {
    const res = await seed.run(() => api.seed())
    if (res) {
      patch({
        clientKey: String(res.clientKey ?? ''),
        userToken: String(res.userToken ?? ''),
        reportKey: String(res.reportKey ?? ''),
        displayToken: String(res.displayToken ?? ''),
      })
      reloadStatus()
      loadUsers()
    }
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>
            POC local da API da Array. Sem credenciais tudo roda com fixtures determinísticas; com credenciais os
            mesmos endpoints chamam o sandbox da Array.
          </p>
        </div>
        <div className="row">
          <button className="primary" onClick={runSeed} disabled={seed.loading}>
            {seed.loading ? 'Semeando…' : 'Semear usuário demo'}
          </button>
        </div>
      </div>

      {statusError && <ErrorBox error={new Error(statusError)} />}
      <ErrorBox error={seed.error} />

      <div className="grid cols-4">
        <Stat label="Modo" value={status?.mode.toUpperCase() ?? '…'} badge={<span className={`badge ${status?.mode === 'sandbox' ? 'ok' : 'warn'}`}>{status?.mode === 'sandbox' ? 'chamando a Array' : 'fixtures locais'}</span>} />
        <Stat label="SMARTY_AUTH_ID (appKey)" value={status?.hasAuthId ? 'presente' : 'ausente'} badge={<span className={`badge ${status?.hasAuthId ? 'ok' : 'danger'}`}>{status?.hasAuthId ? 'ok' : 'preencher .dev.vars'}</span>} />
        <Stat label="SMARTY_AUTH_TOKEN (client token)" value={status?.hasAuthToken ? 'presente' : 'ausente'} badge={<span className={`badge ${status?.hasAuthToken ? 'ok' : 'danger'}`}>{status?.hasAuthToken ? 'ok' : 'preencher .dev.vars'}</span>} />
        <Stat label="Usuários no D1" value={status?.users ?? users.length} />
      </div>

      <div className="grid cols-2">
        <Card title="Ambiente">
          <dl className="kv">
            <dt>ARRAY_ENV</dt>
            <dd>{status?.arrayEnv ?? '—'}</dd>
            <dt>Base URL</dt>
            <dd className="mono">{status?.baseUrl ?? '—'}</dd>
            <dt>CDN dos componentes</dt>
            <dd className="mono">{status?.componentsCdn ?? '—'}</dd>
            <dt>appKey</dt>
            <dd>
              <TokenChip value={status?.appKey ?? ''} mask />
            </dd>
          </dl>
          <p className="hint" style={{ marginTop: 10 }}>
            O client token nunca sai do worker — o frontend só vê booleanos e o <code>userToken</code> de curta duração.
          </p>
        </Card>

        <Card title="Sessão de trabalho">
          <dl className="kv">
            <dt>clientKey</dt>
            <dd><TokenChip value={session.clientKey} /></dd>
            <dt>userToken</dt>
            <dd><TokenChip value={session.userToken} mask /></dd>
            <dt>reportKey</dt>
            <dd><TokenChip value={session.reportKey} mask /></dd>
          </dl>
          <div className="row" style={{ marginTop: 12 }}>
            <Link className="btn" to="/enrollment">1 · Enrollment</Link>
            <Link className="btn" to="/kba">2 · KBA</Link>
            <Link className="btn" to="/report">3 · Relatório</Link>
            <Link className="btn" to="/playground">4 · Componentes</Link>
          </div>
        </Card>
      </div>

      {seed.data && (
        <Card title="Resultado do seed">
          <Json data={seed.data} open />
        </Card>
      )}

      <Card
        title={`Usuários no D1 (${users.length})`}
        actions={
          <div className="row">
            {users.length > PAGE && (
              <button className="tiny ghost" onClick={() => setShowAll((v) => !v)}>
                {showAll ? `Mostrar só os ${PAGE} mais recentes` : `Ver todos (${users.length})`}
              </button>
            )}
            <button className="tiny" onClick={loadUsers}>Recarregar</button>
          </div>
        }
      >
        {users.length === 0 ? (
          <Empty>Nenhum usuário ainda. Use “Semear usuário demo” ou a tela de Enrollment.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>DOB</th>
                  <th>SSN</th>
                  <th>clientKey</th>
                  <th>Modo</th>
                  <th>Criado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(showAll ? users : users.slice(0, PAGE)).map((u) => (
                  <tr key={String(u.id)}>
                    <td>{String(u.first_name)} {String(u.last_name)}</td>
                    <td>{String(u.dob)}</td>
                    <td className="mono">***-**-{String(u.ssn_last4)}</td>
                    <td className="mono">{String(u.client_key)}</td>
                    <td><span className="badge neutral">{String(u.mode)}</span></td>
                    <td className="muted">{String(u.created_at).slice(0, 19).replace('T', ' ')}</td>
                    <td>
                      <button className="tiny" onClick={() => patch({ clientKey: String(u.client_key) })}>
                        Usar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!showAll && users.length > PAGE && (
              <p className="hint" style={{ marginBottom: 0 }}>
                Mostrando os {PAGE} mais recentes de {users.length}. Use <strong>Ver todos</strong> para listar o resto —
                a rota <code>GET /api/array/users</code> devolve a lista completa do D1 local.
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}
