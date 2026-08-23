import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CopyButton } from '../components/ui'
import { useSession } from '../lib/session'
import { APP_KEY_PLACEHOLDER, USER_TOKEN_PLACEHOLDER, isValidAppKey } from '../components/ArrayComponent'

/**
 * Guia de Integração — a única tela que PRESCREVE a integração em vez de
 * mostrá-la depois do fato (o Inspector faz isso).
 *
 * Ela responde as três perguntas que nenhuma outra tela respondia (VALIDATION
 * ciclo 3, olhar de produto (b) e (c)):
 *  1. de onde vem o `userToken`, quanto ele vive e quem o emite;
 *  2. o que fica no SERVIDOR (client token) e o que pode ir ao BROWSER
 *     (appKey + userToken);
 *  3. quais endpoints o backend do usuário precisa expor, em que ordem.
 *
 * Cada passo mostra o estado REAL da sessão atual ao lado da prescrição, para
 * que o dev consiga cruzar "o que eu preciso fazer" com "o que já aconteceu".
 */

type Lane = 'server' | 'browser'

interface Step {
  n: number
  id: string
  title: string
  lane: Lane
  /** O que a Array expõe. */
  arrayRoute: string
  /** A mesma coisa nesta POC. */
  pocRoute: string
  /** O que o backend do usuário tem que implementar neste passo. */
  backend: string[]
  produces: string
  curl: string
  ts: string
  /** Tela da POC que exercita o passo. */
  screen: { to: string; label: string }
  notes?: string
}

const CLIENT_TOKEN_NOTE = 'x-credmo-client-token: $ARRAY_CLIENT_TOKEN   # SEGREDO: só no servidor'

const STEPS: Step[] = [
  {
    n: 1,
    id: 'user',
    title: 'Criar o consumidor',
    lane: 'server',
    arrayRoute: 'POST /user/v2',
    pocRoute: 'POST /api/array/user',
    backend: [
      'Um endpoint seu (ex.: POST /credito/consumidor) que recebe os dados de identidade do usuário logado.',
      'Encaminhar para a Array com o client token no header — nunca com dados vindos do browser sem validação.',
      'Guardar o clientKey retornado junto do seu usuário (é a chave de tudo o que vem depois).',
      'Nunca persistir o SSN completo: só os últimos 4 dígitos, como esta POC faz.',
    ],
    produces: 'clientKey',
    curl: `curl -X POST https://sandbox.array.io/api/user/v2 \\
  -H 'content-type: application/json' \\
  -H '${CLIENT_TOKEN_NOTE}' \\
  -d '{
    "firstName": "BANKER",
    "lastName": "COLDIRON",
    "dob": "1974-04-18",
    "ssn": "666230560",
    "address": { "street": "3627 CALIFORNIA ST", "city": "GRAND PRAIRIE", "state": "TX", "zip": "75052" }
  }'
# -> { "clientKey": "FF9CDBA5-..." }`,
    ts: `// SERVIDOR (Node/Workers). O client token nunca sai daqui.
export async function criarConsumidor(identidade: Identidade): Promise<string> {
  const res = await fetch('https://sandbox.array.io/api/user/v2', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-credmo-client-token': process.env.ARRAY_CLIENT_TOKEN!, // segredo
    },
    body: JSON.stringify(identidade),
  })
  if (!res.ok) throw new Error(\`Array /user/v2 -> \${res.status}\`)
  const { clientKey } = (await res.json()) as { clientKey: string }
  await db.salvarClientKey(identidade.userId, clientKey) // guarde no SEU banco
  return clientKey
}`,
    screen: { to: '/enrollment', label: 'Enrollment' },
    notes:
      'Também é possível terceirizar este passo para o componente <array-account-enroll>, que fala direto com a Array e devolve o clientKey num array-event. Mesmo assim você precisa guardar o clientKey no seu banco.',
  },
  {
    n: 2,
    id: 'kba',
    title: 'Verificar a identidade (KBA)',
    lane: 'server',
    arrayRoute: 'GET /authenticate/v2  →  POST /authenticate/v2',
    pocRoute: 'GET /api/array/authenticate  →  POST /api/array/authenticate',
    backend: [
      'Buscar as perguntas com o clientKey (a Array devolve as perguntas + um authToken de vida curta).',
      'Repassar as perguntas ao seu frontend SEM o client token; guardar o authToken na sessão do servidor.',
      'Enviar as respostas do usuário de volta com o authToken.',
      'Tratar reprovação: a Array responde 400 e o consumidor não tem userToken (nada de relatório).',
    ],
    produces: 'authToken → userToken (na aprovação)',
    curl: `# 2a. perguntas
curl 'https://sandbox.array.io/api/authenticate/v2?clientKey=$CLIENT_KEY' \\
  -H '${CLIENT_TOKEN_NOTE}'
# -> { "authToken": "…", "questions": [ { "questionId": "Q1", "answers": [...] } ] }

# 2b. respostas
curl -X POST https://sandbox.array.io/api/authenticate/v2 \\
  -H 'content-type: application/json' \\
  -H '${CLIENT_TOKEN_NOTE}' \\
  -d '{ "clientKey": "$CLIENT_KEY", "authToken": "$AUTH_TOKEN", "answers": { "Q1": "Q1A1" } }'
# -> { "status": "authenticated", "userToken": "ED9A14BA-…", "ttlInMinutes": 60 }`,
    ts: `// SERVIDOR. As perguntas vão ao browser; o authToken fica na sessão.
export async function perguntasKba(clientKey: string) {
  const res = await arrayGet(\`/authenticate/v2?clientKey=\${clientKey}\`)
  const { authToken, questions } = await res.json()
  await sessao.set('authToken', authToken) // não mande ao browser
  return questions // só as perguntas
}

export async function responderKba(clientKey: string, answers: Record<string, string>) {
  const authToken = await sessao.get('authToken')
  const res = await arrayPost('/authenticate/v2', { clientKey, authToken, answers })
  if (!res.ok) throw new KbaReprovada() // 400 = identidade não confirmada
  return (await res.json()) as { userToken: string; ttlInMinutes: number }
}`,
    screen: { to: '/kba', label: 'Identity / KBA' },
    notes:
      'O componente <array-authentication-kba> faz este fluxo inteiro no browser e entrega o userToken dentro do array-event — útil quando você não quer trafegar as perguntas pelo seu backend.',
  },
  {
    n: 3,
    id: 'usertoken',
    title: 'Emitir o userToken para o browser',
    lane: 'server',
    arrayRoute: 'POST /authenticate/v2/usertoken',
    pocRoute: 'POST /api/array/usertoken',
    backend: [
      'Um endpoint seu (ex.: GET /credito/token) que só o usuário logado alcança e que resolve o clientKey a partir da SUA sessão — nunca de um parâmetro enviado pelo browser.',
      'Chamar a Array com o client token e devolver ao frontend apenas { userToken, expiresAt }.',
      'Escolher o ttlInMinutes (1 a 1440). Quanto menor, menor o dano se o token vazar.',
      'Reemitir quando expirar: o componente com token vencido simplesmente não carrega dados.',
      'Se cachear o token, a chave do cache tem que incluir o ambiente e o appKey — um token de mock servido como se fosse de sandbox é o pior falso positivo possível (foi o defeito W-001 desta POC).',
    ],
    produces: 'userToken (curta duração)',
    curl: `curl -X POST https://sandbox.array.io/api/authenticate/v2/usertoken \\
  -H 'content-type: application/json' \\
  -H '${CLIENT_TOKEN_NOTE}' \\
  -d '{ "clientKey": "$CLIENT_KEY", "ttlInMinutes": 60 }'
# -> { "userToken": "ED9A14BA-…", "ttlInMinutes": 60, "expiresAt": "2026-08-23T20:00:00.000Z" }

# nesta POC (?refresh=true|1|yes força emissão nova, ignorando o cache):
curl -X POST 'http://localhost:8787/api/array/usertoken?refresh=true' \\
  -H 'content-type: application/json' \\
  -d '{ "clientKey": "$CLIENT_KEY", "ttlInMinutes": 60 }'`,
    ts: `// SERVIDOR — o único lugar em que o client token aparece.
app.get('/credito/token', requerLogin, async (req, res) => {
  const clientKey = await db.clientKeyDoUsuario(req.user.id) // NÃO do query string
  const r = await fetch('https://sandbox.array.io/api/authenticate/v2/usertoken', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-credmo-client-token': process.env.ARRAY_CLIENT_TOKEN!,
    },
    body: JSON.stringify({ clientKey, ttlInMinutes: 60 }),
  })
  const { userToken, expiresAt } = await r.json()
  res.json({ userToken, expiresAt }) // só isto vai ao browser
})`,
    screen: { to: '/playground', label: 'Web Components' },
    notes:
      'É este o token que entra no atributo userToken do componente. Ele expira: trate 401/vazio no browser pedindo um token novo ao SEU endpoint, sem recarregar a página.',
  },
  {
    n: 4,
    id: 'component',
    title: 'Montar o web component no browser',
    lane: 'browser',
    arrayRoute: 'embed[.sandbox].array.io/cms/<componente>.js?appKey=…',
    pocRoute: 'snippet copiável na tela Web Components',
    backend: [
      'Servir a página com o appKey (público por design, vai no HTML) e injetar o userToken vindo do seu endpoint do passo 3.',
      'Carregar array-web-component.js ANTES do bundle do componente.',
      'Reinjetar o atributo userToken a cada render — não versione o valor nem o coloque em HTML estático/cache de CDN.',
      'Assinar o evento array-event no window para reagir ao que o componente faz.',
    ],
    produces: 'componente renderizado com os dados do consumidor',
    curl: `<!-- BROWSER. appKey é público; userToken é de curta duração. -->
<script src="https://embed.sandbox.array.io/cms/array-web-component.js"></script>
<script src="https://embed.sandbox.array.io/cms/array-credit-overview.js?appKey=$APP_KEY"></script>

<array-credit-overview
  appKey="$APP_KEY"
  userToken="${USER_TOKEN_PLACEHOLDER}"
  sandbox="true"
></array-credit-overview>

<script>
  window.addEventListener('array-event', (e) => console.log('array-event', e.detail))
</script>`,
    ts: `// BROWSER — busca o token no SEU backend e o injeta a cada render.
async function montarOverview(host: HTMLElement) {
  const { userToken } = await fetch('/credito/token', { credentials: 'include' }).then((r) => r.json())
  const el = document.createElement('array-credit-overview')
  el.setAttribute('appKey', APP_KEY)      // público
  el.setAttribute('userToken', userToken) // curta duração, nunca em HTML estático
  el.setAttribute('sandbox', 'true')
  host.replaceChildren(el)
}

window.addEventListener('array-event', (e) => {
  // e.detail = { component, event, metadata } — um único evento para todos
  telemetria.registrar((e as CustomEvent).detail)
})`,
    screen: { to: '/playground', label: 'Web Components' },
    notes:
      'Custom element NÃO é void element: <array-credit-overview /> engole o resto da página. Sempre com tag de fechamento.',
  },
]

const LANE_LABEL: Record<Lane, string> = { server: 'SERVIDOR', browser: 'BROWSER' }

function Flow() {
  return (
    <div className="flow-diagram">
      <svg viewBox="0 0 900 300" role="img" aria-label="Encadeamento das 4 chamadas: servidor cria consumidor, faz KBA e emite userToken; browser monta o componente com appKey e userToken.">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
          </marker>
        </defs>

        {/* faixa servidor */}
        <rect x="8" y="8" width="884" height="150" rx="10" className="lane lane-server" />
        <text x="22" y="30" className="lane-title">SERVIDOR — client token (segredo)</text>

        {/* faixa browser */}
        <rect x="8" y="176" width="884" height="112" rx="10" className="lane lane-browser" />
        <text x="22" y="198" className="lane-title">BROWSER — appKey (público) + userToken (curta duração)</text>

        {/* passos do servidor */}
        <g className="node">
          <rect x="26" y="48" width="200" height="86" rx="8" />
          <text x="40" y="72" className="node-n">1</text>
          <text x="58" y="72" className="node-t">Criar consumidor</text>
          <text x="40" y="94" className="node-c">POST /user/v2</text>
          <text x="40" y="114" className="node-o">→ clientKey</text>
        </g>
        <g className="node">
          <rect x="256" y="48" width="220" height="86" rx="8" />
          <text x="270" y="72" className="node-n">2</text>
          <text x="288" y="72" className="node-t">KBA (identidade)</text>
          <text x="270" y="94" className="node-c">GET + POST /authenticate/v2</text>
          <text x="270" y="114" className="node-o">→ authToken → aprovação</text>
        </g>
        <g className="node">
          <rect x="506" y="48" width="230" height="86" rx="8" />
          <text x="520" y="72" className="node-n">3</text>
          <text x="538" y="72" className="node-t">Emitir userToken</text>
          <text x="520" y="94" className="node-c">POST /authenticate/v2/usertoken</text>
          <text x="520" y="114" className="node-o">→ userToken (TTL 1–1440 min)</text>
        </g>

        {/* passo do browser */}
        <g className="node">
          <rect x="506" y="212" width="230" height="62" rx="8" />
          <text x="520" y="236" className="node-n">4</text>
          <text x="538" y="236" className="node-t">Web component</text>
          <text x="520" y="258" className="node-c">appKey + userToken</text>
        </g>

        {/* setas */}
        <line x1="226" y1="91" x2="256" y2="91" className="edge" markerEnd="url(#arrow)" />
        <line x1="476" y1="91" x2="506" y2="91" className="edge" markerEnd="url(#arrow)" />
        <line x1="621" y1="134" x2="621" y2="212" className="edge" markerEnd="url(#arrow)" />
        <text x="632" y="180" className="edge-label">só o userToken atravessa</text>

        {/* fronteira */}
        <line x1="8" y1="167" x2="892" y2="167" className="boundary" />
        <text x="770" y="162" className="boundary-label">fronteira</text>

        {/* o que nunca cruza */}
        <g className="node danger-node">
          <rect x="766" y="48" width="110" height="86" rx="8" />
          <text x="780" y="72" className="node-t">client token</text>
          <text x="780" y="94" className="node-c">nunca cruza</text>
          <text x="780" y="114" className="node-c">a fronteira</text>
        </g>
      </svg>
    </div>
  )
}

export function IntegrationGuide() {
  const { session, status } = useSession()
  const [langByStep, setLangByStep] = useState<Record<string, 'curl' | 'ts'>>({})
  const appKey = status?.appKey ?? ''

  // Estado real da sessão desta POC, por passo — "feito" vs "pendente".
  const state = useMemo(() => {
    const done: Record<string, { done: boolean; value: string; label: string }> = {
      user: { done: !!session.clientKey, value: session.clientKey, label: 'clientKey' },
      kba: {
        done: !!session.userToken,
        value: session.authToken || (session.userToken ? '(aprovado — userToken emitido)' : ''),
        label: 'authToken / aprovação',
      },
      usertoken: { done: !!session.userToken, value: session.userToken, label: 'userToken' },
      component: {
        done: !!session.userToken && isValidAppKey(appKey),
        value: isValidAppKey(appKey) ? `appKey de ${appKey.length} chars + userToken da sessão` : '',
        label: 'appKey + userToken',
      },
    }
    return done
  }, [session.clientKey, session.userToken, session.authToken, appKey])

  const doneCount = Object.values(state).filter((s) => s.done).length

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Guia de Integração</h1>
          <p>
            As quatro chamadas que levam do "nada" até um web component da Array renderizando dados do seu usuário — e,
            em cada uma, o que fica <strong>no seu servidor</strong> e o que pode ir <strong>ao browser</strong>. As
            outras telas <em>mostram</em> a POC funcionando; esta <em>prescreve</em> o que o seu backend precisa expor.
          </p>
          <p className="hint">
            Regra única que resume tudo: o <strong>client token</strong> (<code>SMARTY_AUTH_TOKEN</code> nesta POC) é
            segredo de servidor e nunca aparece em HTML, JS ou request do browser. O <strong>appKey</strong> é público
            por design e o <strong>userToken</strong> é de curta duração — é ele, e só ele, que atravessa a fronteira.
          </p>
        </div>
        <div className="row">
          <span className={`badge ${doneCount === 4 ? 'ok' : 'warn'}`}>{doneCount}/4 passos com dado real nesta sessão</span>
        </div>
      </div>

      <Card title="O encadeamento das 4 chamadas">
        <Flow />
        <p className="hint" style={{ marginBottom: 0 }}>
          Modo atual: <strong>{status?.mode?.toUpperCase() ?? '…'}</strong> · base{' '}
          <code>{status?.baseUrl ?? '—'}</code> · CDN dos componentes <code>{status?.componentsCdn ?? '—'}</code>.
          {status?.mode === 'mock' && ' Em modo mock nenhuma dessas chamadas sai da máquina: as respostas são fixtures.'}
        </p>
      </Card>

      <div className="steps">
        {STEPS.map((s) => {
          const st = state[s.id]
          const lang = langByStep[s.id] ?? 'curl'
          const code = lang === 'curl' ? s.curl : s.ts
          return (
            <Card
              key={s.id}
              className="step"
              title={
                <span className="row" style={{ gap: 8 }}>
                  <span className="step-n">{s.n}</span>
                  <span>{s.title}</span>
                  <span className={`badge ${s.lane === 'server' ? 'danger' : 'ok'}`}>{LANE_LABEL[s.lane]}</span>
                </span>
              }
              actions={
                <span className={`badge ${st.done ? 'ok' : 'warn'}`}>{st.done ? 'feito nesta sessão' : 'pendente'}</span>
              }
            >
              <div className="step-grid">
                <div className="stack" style={{ gap: 10 }}>
                  <dl className="kv">
                    <dt>Array</dt>
                    <dd className="mono small">{s.arrayRoute}</dd>
                    <dt>Nesta POC</dt>
                    <dd className="mono small">{s.pocRoute}</dd>
                    <dt>Produz</dt>
                    <dd className="small">{s.produces}</dd>
                  </dl>

                  <div>
                    <div className="label small muted">O que o SEU backend implementa</div>
                    <ul className="small" style={{ margin: '6px 0 0 18px' }}>
                      {s.backend.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  </div>

                  <div className={`step-state ${st.done ? 'ok' : ''}`}>
                    <div className="label small muted">Nesta sessão · {st.label}</div>
                    {st.done ? (
                      <div className="mono small" style={{ overflowWrap: 'anywhere' }}>{st.value}</div>
                    ) : (
                      <div className="small muted">
                        pendente — rode <Link to={s.screen.to}>{s.screen.label}</Link> (ou{' '}
                        <Link to="/">Semear usuário demo</Link>) para ver o valor real aqui.
                      </div>
                    )}
                  </div>

                  {s.notes && <p className="hint" style={{ margin: 0 }}>{s.notes}</p>}
                </div>

                <div className="stack" style={{ gap: 8 }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <div className="row" style={{ gap: 4 }}>
                      <button
                        className={`tiny ${lang === 'curl' ? '' : 'ghost'}`}
                        onClick={() => setLangByStep((m) => ({ ...m, [s.id]: 'curl' }))}
                      >
                        {s.lane === 'browser' ? 'HTML' : 'curl'}
                      </button>
                      <button
                        className={`tiny ${lang === 'ts' ? '' : 'ghost'}`}
                        onClick={() => setLangByStep((m) => ({ ...m, [s.id]: 'ts' }))}
                      >
                        TypeScript
                      </button>
                    </div>
                    <CopyButton text={code} label="Copiar" />
                  </div>
                  <div className="snippet">
                    <pre className="json">{code}</pre>
                  </div>
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      <div className="grid cols-2">
        <Card title="O que NUNCA vai ao browser">
          <ul className="small" style={{ margin: '0 0 0 18px' }}>
            <li>
              <strong>client token</strong> (<code>x-credmo-client-token</code> / <code>SMARTY_AUTH_TOKEN</code>): dá
              acesso a todos os consumidores da sua conta. Só no servidor, só em variável de ambiente.
            </li>
            <li>
              <strong>authToken</strong> do KBA: fica na sessão do servidor; o browser só precisa das perguntas.
            </li>
            <li>
              <strong>SSN completo</strong>: esta POC grava apenas <code>ssn_last4</code> no D1 e redige o valor no log
              de auditoria.
            </li>
            <li>
              <strong>displayToken</strong> em HTML estático: ele libera a leitura de um relatório específico; trate-o
              como o userToken (curto e reinjetado).
            </li>
          </ul>
        </Card>

        <Card title="O que pode (e deve) ir ao browser">
          <ul className="small" style={{ margin: '0 0 0 18px' }}>
            <li>
              <strong>appKey</strong> — público por design; o loader da Array exige exatamente 36 caracteres.{' '}
              {isValidAppKey(appKey) ? (
                <>
                  Nesta sessão: <code className="mono">{appKey}</code>{' '}
                  {status?.mode === 'mock' && <em>(placeholder do modo mock)</em>}.
                </>
              ) : (
                <>
                  Sem appKey válido agora — os snippets saem com <code>{APP_KEY_PLACEHOLDER}</code>.
                </>
              )}
            </li>
            <li>
              <strong>userToken</strong> — curta duração, emitido pelo seu backend a cada sessão/render. É o único
              segredo-de-usuário que o browser precisa ver.
            </li>
            <li>
              As <strong>perguntas de KBA</strong> (sem o authToken) e o <strong>reportKey</strong> quando você usa o
              componente em modo manual.
            </li>
          </ul>
          <p className="hint" style={{ marginBottom: 0 }}>
            Pronto para colar? A tela <Link to="/playground">Web Components</Link> gera o snippet completo do passo 4
            com o appKey e o userToken desta sessão, e o <Link to="/inspector">API Inspector</Link> mostra as chamadas
            dos passos 1–3 que já aconteceram, com os segredos redigidos.
          </p>
        </Card>
      </div>

      <Card title="Erros que você vai encontrar (e o que eles significam)">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Sintoma</th>
                <th>Causa provável</th>
                <th>Onde resolver</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Componente monta mas fica vazio</td>
                <td><code>userToken</code> expirado ou ausente no atributo</td>
                <td>Servidor: reemitir no passo 3 e reinjetar o atributo</td>
              </tr>
              <tr>
                <td>Nada renderiza, sem erro no console</td>
                <td><code>appKey</code> com tamanho ≠ 36, ou bundle carregado antes do runtime</td>
                <td>Browser: ordem dos <code>&lt;script&gt;</code> e appKey no passo 4</td>
              </tr>
              <tr>
                <td>O resto da página desaparece</td>
                <td>custom element auto-fechado (<code>&lt;array-x /&gt;</code>)</td>
                <td>Browser: sempre com tag de fechamento</td>
              </tr>
              <tr>
                <td><code>400</code> no <code>/authenticate/v2</code></td>
                <td>KBA reprovada, ou <code>authToken</code> expirado/reutilizado</td>
                <td>Servidor: refazer o passo 2 do zero</td>
              </tr>
              <tr>
                <td><code>400</code> com <code>unknown clientKey</code></td>
                <td>o consumidor do passo 1 não existe nesse ambiente</td>
                <td>Servidor: chaves de sandbox e de produção não se misturam</td>
              </tr>
              <tr>
                <td>Token "cacheado" que não devia servir</td>
                <td>cache de <code>userToken</code> sem o ambiente/appKey na chave</td>
                <td>Servidor: veja a última linha do passo 3</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
