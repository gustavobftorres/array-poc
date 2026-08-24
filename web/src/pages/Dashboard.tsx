import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useSession } from '../lib/session'
import { Card, ErrorBox, Empty, Json, Stat, TokenChip, useAsync } from '../components/ui'

export function Dashboard() {
  const { status, statusError, reloadStatus, session, patch } = useSession()
  const [users, setUsers] = useState<Record<string, unknown>[]>([])
  /** Rows in the D1, straight from the route's `total` — never `users.length`. */
  const [total, setTotal] = useState(0)
  /** The D1 grows with every test seed; show a page, not everything (W-013). */
  const [showAll, setShowAll] = useState(false)
  const PAGE = 10
  /** Hard ceiling of `GET /api/array/users?limit=` — one page cannot exceed it. */
  const ROUTE_MAX = 200
  const seed = useAsync<Record<string, unknown>>()

  // The route pages (`limit`/`offset`) and reports `total` separately, so the
  // page size asked for here is what comes back: the screen must print `total`,
  // not the payload length, or it announces "50" with 57 users in the D1 (Y-006).
  const loadUsers = useCallback(
    (all = false) =>
      api
        .users({ limit: all ? ROUTE_MAX : PAGE })
        .then((r) => {
          setUsers(r.users)
          setTotal(r.total)
        })
        .catch(() => {
          setUsers([])
          setTotal(0)
        }),
    [],
  )
  // One fetch per mount. Depending on `status` used to fire this 3x per visit
  // (null -> object -> reload) and flooded the Inspector with internal calls.
  useEffect(() => {
    void loadUsers()
  }, [loadUsers])

  const toggleAll = () => {
    const next = !showAll
    setShowAll(next)
    void loadUsers(next)
  }

  const runSeed = async () => {
    const res = await seed.run(() => api.seed())
    if (res) {
      // Seeding mints the token server-side in one shot: it does NOT mean the
      // KBA was answered, that the browser called /usertoken or that any
      // component was mounted. Clearing these keeps /integracao honest (X-006).
      patch({
        clientKey: String(res.clientKey ?? ''),
        userToken: String(res.userToken ?? ''),
        reportKey: String(res.reportKey ?? ''),
        displayToken: String(res.displayToken ?? ''),
        authToken: '',
        kbaAuthenticatedAt: '',
        userTokenMintedAt: '',
        componentMountedAt: '',
        componentTag: '',
        userTokenSource: 'seed',
        // The seed orders the report server-side in the same shot. Stamping
        // `reportOrderedAt` here made /integracao count step 5 as done while
        // step 3, with the identical provenance, refused to (Y-001): the key
        // stays in the session, the EVENT does not.
        reportOrderedAt: '',
        reportFetchedAt: '',
      })
      reloadStatus()
      loadUsers(showAll)
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
        <Stat label="ARRAY_APP_KEY (appKey)" value={status?.hasAppKey ? 'presente' : 'ausente'} badge={<span className={`badge ${status?.hasAppKey ? 'ok' : 'danger'}`}>{status?.hasAppKey ? 'ok' : 'preencher .env'}</span>} />
        <Stat label="ARRAY_SERVER_TOKEN (x-credmo-client-token)" value={status?.hasServerToken ? 'presente' : 'ausente'} badge={<span className={`badge ${status?.hasServerToken ? 'ok' : 'danger'}`}>{status?.hasServerToken ? 'ok' : 'preencher .env'}</span>} />
        <Stat label="Usuários no D1" value={status?.users ?? users.length} />
      </div>

      <div className="grid cols-2">
        <Card title="Ambiente">
          <dl className="kv">
            <dt>ARRAY_ENV</dt>
            <dd>{status?.arrayEnv ?? '—'}</dd>
            <dt>Base URL</dt>
            <dd className="mono">
              {status?.baseUrl ?? '—'}{' '}
              <span className="badge neutral">
                {status?.baseUrlSource === 'ARRAY_BASE_URL' ? 'ARRAY_BASE_URL' : 'derivada do ARRAY_ENV'}
              </span>
            </dd>
            <dt>ARRAY_AUTH_MODE</dt>
            <dd>
              <span className={`badge ${status?.authMode === 'browser' ? 'warn' : 'ok'}`}>
                {status?.authMode ?? '—'}
              </span>{' '}
              <span className="small muted">
                {status?.authMode === 'browser'
                  ? 'só x-credmo-user-token — o client token não pode ser anexado'
                  : 'x-credmo-client-token sai do worker'}
              </span>
            </dd>
            <dt>ARRAY_PRODUCT_CODE</dt>
            <dd className="mono">{status?.productCode ?? '—'}</dd>
            <dt>ARRAY_POLL_*</dt>
            <dd>
              intervalo {status?.poll.intervalSeconds ?? '—'}s · timeout {status?.poll.timeoutSeconds ?? '—'}s{' '}
              {status?.poll.unitInferred && <span className="badge warn">// UNVERIFIED (unidade)</span>}
            </dd>
            <dt>ARRAY_IDENTITY</dt>
            <dd>
              {status?.identity.label ?? '—'}{' '}
              <span className={`badge ${status?.identity.confidence === 'verified' ? 'ok' : 'warn'}`}>
                {status?.identity.confidence === 'verified' ? 'verificado' : '// UNVERIFIED'}
              </span>{' '}
              <span className="badge neutral">só sandbox</span>
            </dd>
            <dt>ARRAY_LISTENER_URL</dt>
            <dd className="mono" style={{ overflowWrap: 'anywhere' }}>
              {status?.webhook.listenerUrl ?? 'não configurada'}{' '}
              <Link className="small" to="/webhooks">ver Webhooks</Link>
            </dd>
            <dt>CDN dos componentes</dt>
            <dd className="mono">{status?.componentsCdn ?? '—'}</dd>
            <dt>appKey</dt>
            <dd>
              <TokenChip value={status?.appKey ?? ''} mask />
            </dd>
          </dl>
          <p className="hint" style={{ marginTop: 10 }}>
            O <code>ARRAY_SERVER_TOKEN</code> nunca sai do worker — o frontend só vê booleanos e o{' '}
            <code>userToken</code> de curta duração.
          </p>
          {!!status?.warnings.length && (
            <div className="alert-box warn" style={{ marginTop: 10 }}>
              <strong>Avisos de configuração</strong>
              <ul className="small" style={{ margin: '6px 0 0 18px' }}>
                {status.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
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
        title={`Usuários no D1 (${total})`}
        actions={
          <div className="row">
            {total > PAGE && (
              <button className="tiny ghost" onClick={toggleAll}>
                {showAll ? `Mostrar só os ${PAGE} mais recentes` : `Ver todos (${total})`}
              </button>
            )}
            <button className="tiny" onClick={() => loadUsers(showAll)}>Recarregar</button>
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
            {!showAll && total > users.length && (
              <p className="hint" style={{ marginBottom: 0 }}>
                Mostrando os {users.length} mais recentes de {total}. Use <strong>Ver todos</strong> para pedir uma
                página maior — a rota <code>GET /api/array/users</code> pagina (<code>?limit=</code> 1–{ROUTE_MAX},
                default 50, <code>?offset=</code>) e devolve o <code>total</code> do D1 local à parte.
              </p>
            )}
            {showAll && total > users.length && (
              <p className="hint" style={{ marginBottom: 0 }}>
                Mostrando {users.length} de {total} — {ROUTE_MAX} é o teto de uma página em{' '}
                <code>GET /api/array/users?limit=</code>. Para ver o resto, use <code>?offset=</code> na rota (ou
                limpe o estado local: <code>rm -rf worker/.wrangler && npm run db:migrate</code>).
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}
