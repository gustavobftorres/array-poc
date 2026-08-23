import { useEffect, useMemo, useState } from 'react'
import { ArrayComponent, buildSnippet, useArrayEvents } from '../components/ArrayComponent'
import { Card, CopyButton, Empty, useAsync, ErrorBox } from '../components/ui'
import { useSession } from '../lib/session'
import { api } from '../lib/api'

/**
 * Component catalogue — tags and attributes from docs/ARRAY_API_RESEARCH.md §4.
 * `attrs` lists the attributes that are meaningful for each tag; values are
 * editable live and feed both the rendered element and the copyable snippet.
 */
interface Spec {
  tag: string
  label: string
  describe: string
  expects: string[]
  attrs: Record<string, string>
}

const TOKEN = '__USER_TOKEN__'
const CLIENT = '__CLIENT_KEY__'

const CATALOG: Spec[] = [
  {
    tag: 'array-account-enroll',
    label: 'Account Enroll',
    describe: 'Formulário de cadastro do consumidor (nome, endereço, SSN, DOB) hospedado pela Array.',
    expects: ['Campos de identidade e endereço', 'Validação e submissão direto para a Array', 'Emite array-event com o clientKey resultante'],
    attrs: { clientKey: CLIENT, sandbox: 'true', exp: 'true', tui: 'false', efx: 'false' },
  },
  {
    tag: 'array-account-login',
    label: 'Account Login',
    describe: 'Tela de login do consumidor no ecossistema Array.',
    expects: ['Campos de e-mail/senha', 'Emite array-event com o userToken após autenticar'],
    attrs: { sandbox: 'true' },
  },
  {
    tag: 'array-account-settings',
    label: 'Account Settings',
    describe: 'Preferências da conta do consumidor (contato, notificações).',
    expects: ['Dados de contato editáveis', 'Preferências de alerta'],
    attrs: { userToken: TOKEN, sandbox: 'true' },
  },
  {
    tag: 'array-authentication-kba',
    label: 'Authentication KBA',
    describe: 'Fluxo completo de perguntas de identidade (KBA) renderizado pela Array.',
    expects: ['Perguntas multiple-choice vindas do bureau', 'Telas próprias de sucesso/falha (showResultPages)', 'array-event carrega o userToken no metadata'],
    attrs: { userId: CLIENT, sandbox: 'true', showResultPages: 'true', tui: 'true', exp: 'true', efx: 'true' },
  },
  {
    tag: 'array-credit-overview',
    label: 'Credit Overview',
    describe: 'Hub com score, resumo e links para as demais ferramentas.',
    expects: ['Score atual e variação', 'Cartões de atalho para relatório, alertas, simulador'],
    attrs: {
      userToken: TOKEN,
      sandbox: 'true',
      creditAlertsLink: '#creditAlerts',
      creditReportLink: '#creditReport',
      debtAnalysisLink: '#debtAnalysis',
      identityProtectLink: '#identityProtect',
      scoreFactorsLink: '#scoreFactors',
      scoreSimulatorLink: '#scoreSimulator',
      settingsLink: '#settings',
    },
  },
  {
    tag: 'array-credit-report',
    label: 'Credit Report',
    describe: 'Relatório de crédito completo (modo automático ou manual).',
    expects: ['Tradelines, consultas, registros públicos', 'Modo manual usa productCode + reportKey + displayToken'],
    attrs: { userToken: TOKEN, sandbox: 'true', productCode: 'credmo3bReportScore', reportKey: '', displayToken: '' },
  },
  {
    tag: 'array-credit-score',
    label: 'Credit Score',
    describe: 'Widget de score, com histórico.',
    expects: ['Número do score e faixa', 'Gráfico de evolução'],
    attrs: { userToken: TOKEN, sandbox: 'true' },
  },
  {
    tag: 'array-credit-score-insights',
    label: 'Score Insights',
    describe: 'Fatores que compõem o score: histórico de pagamento, utilização, dívida.',
    expects: ['Lista de fatores com impacto', 'Explicação por fator'],
    attrs: { userToken: TOKEN, sandbox: 'true' },
  },
  {
    tag: 'array-credit-score-simulator',
    label: 'Score Simulator',
    describe: 'Simulador what-if de score. TransUnion e Experian apenas — Equifax não simula.',
    expects: ['Sliders de cenário (pagar dívida, abrir conta)', 'Score projetado', 'Webhook “Credit Score Simulated”'],
    attrs: { userToken: TOKEN, sandbox: 'true' },
  },
  {
    tag: 'array-credit-alerts',
    label: 'Credit Alerts',
    describe: 'Alertas de monitoramento de crédito por bureau.',
    expects: ['Lista de alertas com severidade', 'Detalhe por alerta'],
    attrs: { userToken: TOKEN, sandbox: 'true' },
  },
  {
    tag: 'array-credit-debt-analysis',
    label: 'Debt Analysis',
    describe: 'Análise de dívidas e utilização por conta.',
    expects: ['Distribuição de dívida por tipo', 'Utilização de rotativo'],
    attrs: { userToken: TOKEN, sandbox: 'true' },
  },
]

export function Playground() {
  const { session, patch, status } = useSession()
  const [tag, setTag] = useState(CATALOG[4].tag)
  const [attrs, setAttrs] = useState<Record<string, string>>({})
  const [mounted, setMounted] = useState(false)
  const { events, clear } = useArrayEvents()
  const token = useAsync<Awaited<ReturnType<typeof api.userToken>>>()

  const spec = useMemo(() => CATALOG.find((c) => c.tag === tag)!, [tag])
  const appKey = status?.appKey ?? ''

  // Reset the attribute editor whenever the selected component changes,
  // substituting the live session values for the placeholders.
  useEffect(() => {
    const resolved = Object.fromEntries(
      Object.entries(spec.attrs).map(([k, v]) => [
        k,
        v === TOKEN ? session.userToken : v === CLIENT ? session.clientKey : v,
      ]),
    )
    if (spec.tag === 'array-credit-report') {
      resolved.reportKey = session.reportKey
      resolved.displayToken = session.displayToken
    }
    setAttrs({ appKey, ...resolved, sandbox: status?.arrayEnv === 'production' ? 'false' : 'true' })
    setMounted(false)
  }, [spec, appKey, session.userToken, session.clientKey, session.reportKey, session.displayToken, status?.arrayEnv])

  const snippet = buildSnippet(status?.componentsCdn ?? '', spec.tag, attrs, appKey)

  const mint = async () => {
    if (!session.clientKey) return
    const res = await token.run(() => api.userToken({ clientKey: session.clientKey, ttlInMinutes: 60 }))
    if (res?.userToken) {
      patch({ userToken: res.userToken })
      setAttrs((a) => ({ ...a, ...(a.userToken !== undefined ? { userToken: res.userToken } : {}) }))
    }
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Web Components Playground</h1>
          <p>
            Cada componente da Array é carregado do CDN <code>{status?.componentsCdn}</code> (runtime{' '}
            <code>array-web-component.js</code> + bundle por componente). Edite os atributos ao vivo, copie o snippet e
            observe os eventos <code>array-event</code>.
          </p>
        </div>
      </div>

      <div className="tabs">
        {CATALOG.map((c) => (
          <button key={c.tag} className={c.tag === tag ? 'active' : ''} onClick={() => setTag(c.tag)}>
            {c.label}
          </button>
        ))}
      </div>

      <div className="pg">
        <div className="stack">
          <Card title="Atributos">
            <div className="stack" style={{ gap: 6 }}>
              {Object.entries(attrs).map(([k, v]) => (
                <div className="attr-row" key={k}>
                  <label style={{ margin: 0 }} className="mono">{k}</label>
                  <input value={v} onChange={(e) => setAttrs((a) => ({ ...a, [k]: e.target.value }))} placeholder="(vazio = omitido)" />
                  <button className="tiny ghost" title="remover" onClick={() => setAttrs((a) => { const n = { ...a }; delete n[k]; return n })}>×</button>
                </div>
              ))}
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="tiny" onClick={() => { const k = prompt('Nome do atributo'); if (k) setAttrs((a) => ({ ...a, [k]: '' })) }}>
                + atributo
              </button>
              <button className="tiny" onClick={mint} disabled={!session.clientKey || token.loading}>
                {token.loading ? 'Gerando…' : 'Renovar userToken'}
              </button>
            </div>
            {!session.userToken && (
              <p className="hint" style={{ marginTop: 8 }}>
                Sem <code>userToken</code> na sessão. Rode o fluxo de KBA (ou o seed no Dashboard) para preencher os
                atributos automaticamente.
              </p>
            )}
            <ErrorBox error={token.error} />
          </Card>

          <Card title="Sobre este componente">
            <p className="small">{spec.describe}</p>
            <ul className="small muted" style={{ margin: '0 0 0 18px' }}>
              {spec.expects.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="stack">
          <Card
            title={<code>{`<${spec.tag}>`}</code>}
            actions={
              mounted ? (
                <button className="tiny" onClick={() => setMounted(false)}>Desmontar</button>
              ) : (
                <button className="tiny primary" onClick={() => setMounted(true)}>Montar componente</button>
              )
            }
          >
            {mounted ? (
              <ArrayComponent
                cdn={status?.componentsCdn ?? ''}
                tag={spec.tag}
                attrs={attrs}
                appKey={appKey}
                describe={spec.describe}
                expects={spec.expects}
              />
            ) : (
              <div className="component-host">
                <div className="placeholder">
                  <h4>Componente não montado</h4>
                  <p>
                    Clique em <strong>Montar componente</strong> para injetar os scripts do CDN e renderizar{' '}
                    <code>{`<${spec.tag}>`}</code>. Neste ambiente o egress para <code>embed.array.io</code> está
                    bloqueado, então o resultado esperado é o aviso de CDN inacessível — o snippet abaixo é o que você
                    leva para uma rede liberada.
                  </p>
                </div>
              </div>
            )}
          </Card>

          <Card title="Snippet HTML" actions={<CopyButton text={snippet} label="Copiar snippet" />}>
            <div className="snippet">
              <pre className="json">{snippet}</pre>
            </div>
          </Card>

          <Card
            title={`Eventos array-event (${events.length})`}
            actions={<button className="tiny ghost" onClick={clear} disabled={!events.length}>Limpar</button>}
          >
            {events.length === 0 ? (
              <Empty>
                Nenhum evento ainda. Todos os componentes da Array emitem um único evento <code>array-event</code> no{' '}
                <code>window</code>; o payload chega em <code>e.detail</code>.
              </Empty>
            ) : (
              <div className="event-panel">
                {events.map((e, i) => (
                  <div className="event-item" key={i}>
                    <time>{e.at}</time>
                    <pre className="json" style={{ marginTop: 6 }}>{JSON.stringify(e.detail, null, 2)}</pre>
                  </div>
                ))}
              </div>
            )}
            <button
              className="tiny"
              style={{ marginTop: 10 }}
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent('array-event', {
                    detail: { component: spec.tag, event: 'demo-dispatch', metadata: { note: 'evento sintético para validar o painel' } },
                  }),
                )
              }
            >
              Disparar evento de teste
            </button>
          </Card>
        </div>
      </div>
    </div>
  )
}
