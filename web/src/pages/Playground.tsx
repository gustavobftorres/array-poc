import { useEffect, useMemo, useState } from 'react'
import {
  APP_KEY_PLACEHOLDER,
  ArrayComponent,
  buildSnippet,
  isDangerousAttrName,
  isValidAppKey,
  isWellFormedAttrName,
  useArrayEvents,
  USER_TOKEN_PLACEHOLDER,
} from '../components/ArrayComponent'
import { Link } from 'react-router-dom'
import { Card, CopyButton, Empty, useAsync, ErrorBox } from '../components/ui'
import { useSession } from '../lib/session'
import { api } from '../lib/api'

/**
 * Component catalogue — tags and attributes from docs/ARRAY_API_RESEARCH.md §4.
 * `attrs` lists the attributes that are meaningful for each tag; values are
 * editable live and feed both the rendered element and the copyable snippet.
 */
/**
 * How solid our knowledge of each item is — surfaced in the UI so nobody
 * discovers the gap after buying the integration. See docs/ARRAY_API_RESEARCH.md.
 */
type Verification = 'verified' | 'unverified' | 'undocumented'

const VERIFICATION_LABEL: Record<Verification, string> = {
  verified: 'tag verificada',
  unverified: '// UNVERIFIED',
  undocumented: 'não documentado',
}

const VERIFICATION_CLASS: Record<Verification, string> = {
  verified: 'ok',
  unverified: 'warn',
  undocumented: 'danger',
}

interface Spec {
  tag: string
  label: string
  describe: string
  expects: string[]
  attrs: Record<string, string>
  /** Confidence on the tag name + attributes. */
  verification: Verification
  /** Why it is not fully verified / what the API side looks like. */
  caveat?: string
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
    verification: 'verified',
  },
  {
    tag: 'array-account-login',
    label: 'Account Login',
    describe: 'Tela de login do consumidor no ecossistema Array.',
    expects: ['Campos de e-mail/senha', 'Emite array-event com o userToken após autenticar'],
    attrs: { sandbox: 'true' },
    verification: 'verified',
  },
  {
    tag: 'array-account-settings',
    label: 'Account Settings',
    describe: 'Preferências da conta do consumidor (contato, notificações).',
    expects: ['Dados de contato editáveis', 'Preferências de alerta'],
    attrs: { userToken: TOKEN, sandbox: 'true' },
    verification: 'verified',
  },
  {
    tag: 'array-authentication-kba',
    label: 'Authentication KBA',
    describe: 'Fluxo completo de perguntas de identidade (KBA) renderizado pela Array.',
    expects: ['Perguntas multiple-choice vindas do bureau', 'Telas próprias de sucesso/falha (showResultPages)', 'array-event carrega o userToken no metadata'],
    attrs: { userId: CLIENT, sandbox: 'true', showResultPages: 'true', tui: 'true', exp: 'true', efx: 'true' },
    verification: 'verified',
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
      helloPrivacyLink: '#helloPrivacy',
    },
    verification: 'verified',
  },
  {
    tag: 'array-credit-report',
    label: 'Credit Report',
    describe: 'Relatório de crédito completo (modo automático ou manual).',
    expects: ['Tradelines, consultas, registros públicos', 'Modo manual usa productCode + reportKey + displayToken'],
    attrs: { userToken: TOKEN, sandbox: 'true', productCode: 'credmo3bReportScore', reportKey: '', displayToken: '' },
    verification: 'verified',
  },
  {
    tag: 'array-credit-score',
    label: 'Credit Score',
    describe: 'Widget de score, com histórico.',
    expects: [
      'Número do score e faixa',
      'Gráfico de evolução',
      'Modo automático: só userToken — o componente pede o produto sozinho',
      'Modo manual: productCode + reportKey + displayToken (você pede o relatório pela API)',
    ],
    attrs: { userToken: TOKEN, sandbox: 'true', productCode: 'exp1bScore', reportKey: '', displayToken: '' },
    verification: 'verified',
  },
  {
    tag: 'array-credit-score-insights',
    label: 'Score Insights',
    describe: 'Fatores que compõem o score: histórico de pagamento, utilização, dívida.',
    expects: ['Lista de fatores com impacto', 'Explicação por fator'],
    attrs: { userToken: TOKEN, sandbox: 'true' },
    verification: 'verified',
  },
  {
    tag: 'array-credit-score-simulator',
    label: 'Score Simulator',
    describe: 'Simulador what-if de score. TransUnion e Experian apenas — Equifax não simula.',
    expects: ['Sliders de cenário (pagar dívida, abrir conta)', 'Score projetado', 'Webhook “Credit Score Simulated”'],
    attrs: { userToken: TOKEN, sandbox: 'true' },
    verification: 'verified',
  },
  {
    tag: 'array-credit-alerts',
    label: 'Credit Alerts',
    describe: 'Alertas de monitoramento de crédito por bureau.',
    expects: ['Lista de alertas com severidade', 'Detalhe por alerta'],
    attrs: { userToken: TOKEN, sandbox: 'true' },
    verification: 'verified',
    caveat:
      'A tag é verificada, mas os endpoints REST equivalentes (/alert/v2, /monitoring/v2) são inferidos — ' +
      'veja // UNVERIFIED path em worker/src/array/client.ts. Se você usar só o componente, isso não te afeta.',
  },
  {
    tag: 'array-credit-debt-analysis',
    label: 'Debt Analysis',
    describe: 'Análise de dívidas e utilização por conta.',
    expects: ['Distribuição de dívida por tipo', 'Utilização de rotativo'],
    attrs: { userToken: TOKEN, sandbox: 'true' },
    verification: 'verified',
  },
  {
    tag: 'array-ads',
    label: 'Ads (?)',
    describe: 'Componente de ofertas/Ads. A Array documenta /docs/ads e /docs/ads-component, mas o nome da tag não aparece em nenhuma fonte acessível.',
    expects: ['Provavelmente cartões de oferta pré-qualificada', 'Atributos desconhecidos'],
    attrs: { userToken: TOKEN, sandbox: 'true' },
    verification: 'unverified',
    caveat:
      'Nome da tag INFERIDO (docs/ARRAY_API_RESEARCH.md §4.2). Montar aqui provavelmente falha mesmo em rede liberada — ' +
      'confirme o nome com o portal da Array antes de planejar a integração.',
  },
  {
    tag: 'array-dispute',
    label: 'Disputas (?)',
    describe: 'Fluxo de disputa de informação no relatório. A Array entrega UX de disputa no My Credit Manager, mas nem componente nem endpoint aparecem em qualquer fonte acessível.',
    expects: ['Nada verificado: sem tag, sem atributos, sem rota REST'],
    attrs: { userToken: TOKEN, sandbox: 'true' },
    verification: 'undocumented',
    caveat:
      'Lacuna real da POC (docs/ARRAY_API_RESEARCH.md §3.9): não existe API nem componente de disputas verificado. ' +
      'Se disputa é requisito do seu produto, isso é a primeira pergunta para o contato comercial da Array.',
  },
]

export function Playground() {
  const { session, patch, status } = useSession()
  const [tag, setTag] = useState(CATALOG[4].tag)
  const [attrs, setAttrs] = useState<Record<string, string>>({})
  const [mounted, setMounted] = useState(false)
  const [attrError, setAttrError] = useState('')
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
    if (spec.tag === 'array-credit-report' || spec.tag === 'array-credit-score') {
      resolved.reportKey = session.reportKey
      resolved.displayToken = session.displayToken
    }
    setAttrs({ appKey, ...resolved, sandbox: status?.arrayEnv === 'production' ? 'false' : 'true' })
    setMounted(false)
  }, [spec, appKey, session.userToken, session.clientKey, session.reportKey, session.displayToken, status?.arrayEnv])

  // Data components must always carry the userToken line, with or without a
  // live session — that is the only artefact that leaves the POC (W-003).
  const needsUserToken = Object.prototype.hasOwnProperty.call(spec.attrs, 'userToken')
  const snippet = buildSnippet(status?.componentsCdn ?? '', spec.tag, attrs, appKey, {
    needsUserToken,
    userTokenTtlMinutes: token.data?.ttlInMinutes ?? 60,
    tokenEndpoint: 'POST /authenticate/v2/usertoken (via POST /api/array/usertoken nesta POC)',
  })
  const malformedAttrs = Object.keys(attrs).filter((k) => !isWellFormedAttrName(k))
  const blockedAttrs = Object.keys(attrs).filter((k) => isWellFormedAttrName(k) && isDangerousAttrName(k))

  const mint = async () => {
    if (!session.clientKey) return
    const res = await token.run(() => api.userToken({ clientKey: session.clientKey, ttlInMinutes: 60 }))
    if (res?.userToken) {
      patch({
        userToken: res.userToken,
        userTokenMintedAt: new Date().toISOString(),
        userTokenSource: 'usertoken',
      })
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
            observe os eventos <code>array-event</code>. O snippet sai pronto para colar num HTML em branco —
            runtime primeiro, bundle com <code>?appKey=</code> depois, elemento com tag de fechamento e o listener de{' '}
            <code>array-event</code>.
          </p>
          <p className="hint">
            Os selos em cada aba dizem o quanto essa informação é confiável:{' '}
            <span className="badge ok">tag verificada</span> vista em integração real,{' '}
            <span className="badge warn">// UNVERIFIED</span> inferida da documentação indexada,{' '}
            <span className="badge danger">não documentado</span> lacuna admitida (disputas). Alertas, monitoring e
            scoretracker têm tag/slug verificados mas <strong>paths REST inferidos</strong>.
          </p>
        </div>
      </div>

      <div className="tabs">
        {CATALOG.map((c) => (
          <button key={c.tag} className={c.tag === tag ? 'active' : ''} onClick={() => setTag(c.tag)}>
            {c.label}
            {c.verification !== 'verified' && (
              <span className={`badge ${VERIFICATION_CLASS[c.verification]}`} style={{ marginLeft: 6 }}>
                {c.verification === 'unverified' ? '?' : '!'}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="pg">
        <div className="stack">
          <Card title="Atributos">
            <div className="stack" style={{ gap: 6 }}>
              {Object.entries(attrs).map(([k, v]) => (
                <div className="attr-row" key={k}>
                  <label style={{ margin: 0 }} className="mono" htmlFor={`attr-${k}`}>{k}</label>
                  <input
                    id={`attr-${k}`}
                    className={v.length > 24 ? 'mono long-value' : 'mono'}
                    title={v || undefined}
                    value={v}
                    onChange={(e) => setAttrs((a) => ({ ...a, [k]: e.target.value }))}
                    placeholder="(vazio = omitido)"
                  />
                  <button className="tiny ghost" title="remover" onClick={() => setAttrs((a) => { const n = { ...a }; delete n[k]; return n })}>×</button>
                </div>
              ))}
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button
                className="tiny"
                onClick={() => {
                  const k = prompt('Nome do atributo (letras, dígitos, - _ . :)')?.trim()
                  if (!k) return
                  // A name that is not a legal HTML attribute name cannot be
                  // emitted at all — refuse it here instead of shipping broken
                  // markup in the snippet (W-002).
                  if (!isWellFormedAttrName(k)) {
                    setAttrError(`"${k}" não é um nome de atributo HTML válido (use letras, dígitos, - _ . :).`)
                    return
                  }
                  // `onload` IS a legal attribute name — and the snippet is the
                  // artefact the dev pastes into their page, so an executable
                  // handler is refused at the door (X-007).
                  if (isDangerousAttrName(k)) {
                    setAttrError(
                      `"${k}" é executável no HTML colado (on*/style/srcdoc) e não entra no snippet. ` +
                        'Os componentes da Array recebem dados por atributos comuns e emitem array-event.',
                    )
                    return
                  }
                  setAttrError('')
                  setAttrs((a) => ({ ...a, [k]: '' }))
                }}
              >
                + atributo
              </button>
              <button className="tiny" onClick={mint} disabled={!session.clientKey || token.loading}>
                {token.loading ? 'Gerando…' : 'Renovar userToken'}
              </button>
            </div>
            {attrError && <p className="hint danger" style={{ marginTop: 8 }}>{attrError}</p>}
            {malformedAttrs.length > 0 && (
              <p className="hint danger" style={{ marginTop: 8 }}>
                Nome(s) inválido(s) em HTML e por isso ignorado(s) no snippet:{' '}
                <code>{malformedAttrs.join(', ')}</code>.
              </p>
            )}
            {blockedAttrs.length > 0 && (
              <p className="hint danger" style={{ marginTop: 8 }}>
                Nome(s) recusado(s) por serem executáveis no HTML que você vai colar:{' '}
                <code>{blockedAttrs.join(', ')}</code>. <code>on*</code> é handler inline,{' '}
                <code>style</code> é CSS injetado e <code>srcdoc</code> é um documento inteiro — nenhum entra no
                snippet nem no componente montado (X-007).
              </p>
            )}
            {!session.userToken && needsUserToken && (
              <p className="hint" style={{ marginTop: 8 }}>
                Sem <code>userToken</code> na sessão: o snippet sai com{' '}
                <code>{USER_TOKEN_PLACEHOLDER}</code> e com o comentário de onde ele vem. Rode o fluxo de KBA (ou o seed
                no Dashboard) para preencher com um token real, e veja o encadeamento completo no{' '}
                <Link to="/integracao">Guia de Integração</Link>.
              </p>
            )}
            <ErrorBox error={token.error} />
          </Card>

          <Card
            title="Sobre este componente"
            actions={
              <span className={`badge ${VERIFICATION_CLASS[spec.verification]}`}>
                {VERIFICATION_LABEL[spec.verification]}
              </span>
            }
          >
            <p className="small">{spec.describe}</p>
            <ul className="small muted" style={{ margin: '0 0 0 18px' }}>
              {spec.expects.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
            {spec.caveat && (
              <p className="hint" style={{ marginTop: 10 }}>
                <strong>{VERIFICATION_LABEL[spec.verification]}:</strong> {spec.caveat}
              </p>
            )}
            {(spec.tag === 'array-credit-report' || spec.tag === 'array-credit-score') && (
              <p className="hint" style={{ marginTop: 10 }}>
                <strong>Automático vs manual:</strong> deixe <code>reportKey</code> e <code>displayToken</code> vazios e
                o componente pede o relatório sozinho a partir do <code>userToken</code> (modo automático). Preencha os
                três (<code>productCode</code> + <code>reportKey</code> + <code>displayToken</code>, obtidos no{' '}
                <code>POST /report/v2</code> da tela Credit Report) para o modo manual, em que o pedido é seu.
              </p>
            )}
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
                onMounted={(tag) =>
                  patch({ componentMountedAt: new Date().toISOString(), componentTag: tag })
                }
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
            <p className="hint" style={{ marginTop: 0 }}>
              {isValidAppKey(appKey) ? (
                <>
                  <code>appKey</code> de {appKey.length} caracteres
                  {status?.mode === 'mock' ? ' (placeholder do modo mock)' : ''} — o loader da Array exige exatamente 36.{' '}
                  <strong>Troque pelo appKey da sua conta antes de usar.</strong>
                </>
              ) : (
                <>
                  Sem <code>appKey</code> válido: o snippet sai com <code>{APP_KEY_PLACEHOLDER}</code>. O loader da Array
                  valida <code>appKey.length === 36</code>.
                </>
              )}
            </p>
            {needsUserToken && (
              <p className="hint" style={{ marginTop: 0 }}>
                <strong>userToken:</strong> {session.userToken ? 'o valor no snippet é o token desta sessão e expira em ~60 min' : `o snippet sai com ${USER_TOKEN_PLACEHOLDER}`}
                . Quem emite é <strong>o seu backend</strong> (<code>POST /authenticate/v2/usertoken</code> com o client
                token, que nunca vai ao browser) e o atributo tem que ser reinjetado a cada render.{' '}
                <Link to="/integracao">Ver o fluxo completo →</Link>
              </p>
            )}
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
