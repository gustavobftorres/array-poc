import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CopyButton } from '../components/ui'
import { tabId, useSession } from '../lib/session'
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
 * Regras que esta tela tem que respeitar, porque ela é o artefato que sai da
 * POC para o código do usuário (VALIDATION ciclo 5):
 *  - todo `curl` tem que ser COLÁVEL: segredo em variável de ambiente, aspas
 *    duplas para o shell expandir, comentário NUNCA dentro do valor de um
 *    header e corpo JSON via heredoc (X-001);
 *  - todo corpo leva `appKey`, como a pesquisa documenta e como o
 *    `ArrayClient` desta POC já faz (X-002);
 *  - o fluxo vai até o relatório (`POST` + `GET /report/v2`, com o retry e o
 *    `PUT` de renovação), que é o que Credit Report e o modo manual do
 *    Playground usam (X-003);
 *  - cada passo mostra o estado REAL da sessão, derivado do EVENTO
 *    correspondente e não da presença de um token (X-006);
 *  - cada afirmação vem com o selo verificado/inferido do resto da POC (X-009).
 */

type Lane = 'server' | 'browser'

/** Mesma escala de confiança do Playground e do docs/ARRAY_API_RESEARCH.md. */
type Confidence = 'verified' | 'unverified'

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  verified: 'verificado',
  unverified: '// UNVERIFIED',
}
const CONFIDENCE_CLASS: Record<Confidence, string> = { verified: 'ok', unverified: 'warn' }

interface Fact {
  level: Confidence
  text: string
}

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
  /** Selo geral do passo + o que é fato e o que é inferência (X-009). */
  confidence: Confidence
  facts: Fact[]
  curl: string
  ts: string
  /** Tela da POC que exercita o passo. */
  screen: { to: string; label: string }
  notes?: string
}

/**
 * O aviso de segredo é uma LINHA de comentário própria — dentro do `-H` ele
 * viajava como parte do valor do header e a Array respondia 401/400 (X-001).
 */
const SHELL_ENV = `# 0) segredos e chaves ficam no SHELL, não no snippet:
#      export ARRAY_SERVER_TOKEN='...'   # SEGREDO de servidor: nunca no browser
#      export ARRAY_APP_KEY='...'        # público por design (36 caracteres)`

const CLIENT_TOKEN_HEADER = `  -H "x-credmo-client-token: $ARRAY_SERVER_TOKEN" \\`

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
      'Enviar o appKey no corpo, junto da identidade (é o que a pesquisa documenta e o que o ArrayClient desta POC faz).',
      'Guardar o clientKey retornado junto do seu usuário (é a chave de tudo o que vem depois).',
      'Nunca persistir o SSN completo: só os últimos 4 dígitos, como esta POC faz.',
    ],
    produces: 'clientKey',
    confidence: 'verified',
    facts: [
      { level: 'verified', text: 'Rota POST /user/v2 e os nomes dos campos (appKey, firstName, lastName, ssn, dob, address).' },
      { level: 'verified', text: 'Header x-credmo-client-token (visto em integração real).' },
      { level: 'unverified', text: 'O envelope exato do JSON (aninhamento de address) — §3.1 da pesquisa marca isso como inferido.' },
    ],
    curl: `${SHELL_ENV}

curl -sS -X POST https://sandbox.array.io/api/user/v2 \\
  -H "content-type: application/json" \\
${CLIENT_TOKEN_HEADER}
  -d @- <<JSON
{
  "appKey": "$ARRAY_APP_KEY",
  "firstName": "BANKER",
  "lastName": "COLDIRON",
  "dob": "1974-04-18",
  "ssn": "666230560",
  "address": { "street": "3627 CALIFORNIA ST", "city": "GRAND PRAIRIE", "state": "TX", "zip": "75052" }
}
JSON
# -> { "clientKey": "FF9CDBA5-..." }
# guarde o clientKey:  export CLIENT_KEY='FF9CDBA5-...'`,
    ts: `// SERVIDOR (Node/Workers). O client token nunca sai daqui.
export async function criarConsumidor(identidade: Identidade): Promise<string> {
  const res = await fetch('https://sandbox.array.io/api/user/v2', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-credmo-client-token': process.env.ARRAY_SERVER_TOKEN!, // segredo
    },
    // appKey vai no CORPO das chamadas de API, não só no loader do browser.
    body: JSON.stringify({ appKey: process.env.ARRAY_APP_KEY!, ...identidade }),
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
      'Enviar as respostas do usuário de volta com appKey + clientKey + authToken.',
      'Tratar reprovação: a Array responde 400 e o consumidor não tem userToken (nada de relatório).',
    ],
    produces: 'authToken → userToken (na aprovação)',
    confidence: 'verified',
    facts: [
      { level: 'verified', text: 'Rotas GET e POST /authenticate/v2 e o corpo do POST (appKey, clientKey, authToken, answers).' },
      { level: 'verified', text: 'As perguntas vêm de bureau real e são corrigidas por ele — inclusive em sandbox.' },
      { level: 'unverified', text: 'Como o clientKey é passado no GET (aqui: query ?clientKey=…): a pesquisa não mostra a assinatura da chamada de perguntas.' },
    ],
    curl: `${SHELL_ENV}
#      export CLIENT_KEY='...'           # do passo 1

# 2a. perguntas (o clientKey na query é INFERIDO — ver selos ao lado)
curl -sS -G https://sandbox.array.io/api/authenticate/v2 \\
  --data-urlencode "appKey=$ARRAY_APP_KEY" \\
  --data-urlencode "clientKey=$CLIENT_KEY" \\
${CLIENT_TOKEN_HEADER.replace(' \\', '')}
# -> { "authToken": "…", "questions": [ { "questionId": "Q1", "answers": [...] } ] }
# export AUTH_TOKEN='...'

# 2b. respostas
curl -sS -X POST https://sandbox.array.io/api/authenticate/v2 \\
  -H "content-type: application/json" \\
${CLIENT_TOKEN_HEADER}
  -d @- <<JSON
{
  "appKey": "$ARRAY_APP_KEY",
  "clientKey": "$CLIENT_KEY",
  "authToken": "$AUTH_TOKEN",
  "answers": { "Q1": "Q1A1" }
}
JSON
# -> { "status": "authenticated", "userToken": "ED9A14BA-…", "ttlInMinutes": 60 }`,
    ts: `// SERVIDOR. As perguntas vão ao browser; o authToken fica na sessão.
export async function perguntasKba(clientKey: string) {
  const res = await arrayGet(\`/authenticate/v2?appKey=\${APP_KEY}&clientKey=\${clientKey}\`)
  const { authToken, questions } = await res.json()
  await sessao.set('authToken', authToken) // não mande ao browser
  return questions // só as perguntas
}

export async function responderKba(clientKey: string, answers: Record<string, string>) {
  const authToken = await sessao.get('authToken')
  // appKey no corpo, como em todas as chamadas de API da Array.
  const res = await arrayPost('/authenticate/v2', { appKey: APP_KEY, clientKey, authToken, answers })
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
      'Chamar a Array com appKey + clientKey + ttlInMinutes no corpo e o client token no header.',
      'Devolver ao frontend apenas o userToken (e, se quiser, um prazo calculado por você).',
      'Escolher o ttlInMinutes: quanto menor, menor o dano se o token vazar. Esta POC limita o valor a 1–1440 — a faixa aceita pela Array não está documentada publicamente.',
      'Reemitir quando expirar: o componente com token vencido simplesmente não carrega dados.',
      'Se cachear o token, a chave do cache tem que incluir ambiente, appKey e um hash do client token — um token de mock servido como se fosse de sandbox é o pior falso positivo possível (foi o defeito W-001 desta POC).',
    ],
    produces: 'userToken (curta duração)',
    confidence: 'verified',
    facts: [
      { level: 'verified', text: 'Rota POST /authenticate/v2/usertoken, corpo { appKey, clientKey, ttlInMinutes } e header x-credmo-client-token — visto em código de produção.' },
      { level: 'verified', text: 'A resposta traz appKey, clientKey, o token e ttlInMinutes.' },
      { level: 'unverified', text: 'expiresAt NÃO é campo da Array: é calculado por esta POC a partir do ttlInMinutes (faça o mesmo no seu backend, ou guarde o instante da emissão).' },
      { level: 'unverified', text: 'A faixa 1–1440 do ttlInMinutes é o clamp deste worker, não um limite documentado da Array.' },
      { level: 'verified', text: 'Alternativa: em vez de chamar do servidor a cada render, o próprio dispositivo pode usar o userToken como header x-credmo-user-token nas chamadas de leitura (§2/§3.5).' },
    ],
    curl: `${SHELL_ENV}
#      export CLIENT_KEY='...'           # do passo 1

curl -sS -X POST https://sandbox.array.io/api/authenticate/v2/usertoken \\
  -H "content-type: application/json" \\
${CLIENT_TOKEN_HEADER}
  -d @- <<JSON
{
  "appKey": "$ARRAY_APP_KEY",
  "clientKey": "$CLIENT_KEY",
  "ttlInMinutes": 60
}
JSON
# -> { "appKey": "...", "clientKey": "...", "userToken": "ED9A14BA-…", "ttlInMinutes": 60 }
#    (expiresAt é acrescentado por ESTA POC; a Array devolve ttlInMinutes)

# nesta POC (?refresh=true|1|yes força emissão nova, ignorando o cache):
curl -sS -X POST "http://localhost:8787/api/array/usertoken?refresh=true" \\
  -H "content-type: application/json" \\
  -d @- <<JSON
{ "clientKey": "$CLIENT_KEY", "ttlInMinutes": 60 }
JSON`,
    ts: `// SERVIDOR — o único lugar em que o client token aparece.
// Handler do SEU endpoint (ex.: GET /credito/token), atrás do seu login.
export async function tokenDoUsuario(userId: string): Promise<{ userToken: string; expiresAt: string }> {
  const clientKey = await db.clientKeyDoUsuario(userId) // da SUA sessão, não do query string
  const ttlInMinutes = 60
  const r = await fetch('https://sandbox.array.io/api/authenticate/v2/usertoken', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-credmo-client-token': process.env.ARRAY_SERVER_TOKEN!,
    },
    body: JSON.stringify({ appKey: process.env.ARRAY_APP_KEY!, clientKey, ttlInMinutes }),
  })
  if (!r.ok) throw new Error(\`Array /usertoken -> \${r.status}\`)
  const { userToken } = (await r.json()) as { userToken: string }
  // expiresAt é SEU: a resposta documentada da Array traz ttlInMinutes.
  const expiresAt = new Date(Date.now() + ttlInMinutes * 60_000).toISOString()
  return { userToken, expiresAt } // só isto vai ao browser
}`,
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
    confidence: 'verified',
    facts: [
      { level: 'verified', text: 'Ordem dos scripts, ?appKey= no bundle, appKey de 36 caracteres validado pelo loader e o atributo sandbox="true".' },
      { level: 'verified', text: 'Um único evento array-event no window para todos os componentes.' },
      { level: 'unverified', text: 'A lista completa de atributos de cada componente (os selos por componente estão no Playground).' },
    ],
    curl: `<!-- BROWSER. appKey é público; userToken é de curta duração. -->
<script src="https://embed.sandbox.array.io/cms/array-web-component.js"></script>
<script src="https://embed.sandbox.array.io/cms/array-credit-overview.js?appKey=${APP_KEY_PLACEHOLDER}"></script>

<array-credit-overview
  appKey="${APP_KEY_PLACEHOLDER}"
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
  {
    n: 5,
    id: 'order-report',
    title: 'Pedir o relatório',
    lane: 'server',
    arrayRoute: 'POST /report/v2',
    pocRoute: 'POST /api/array/report',
    backend: [
      'Um endpoint seu (ex.: POST /credito/relatorio) que pede o relatório para o clientKey do usuário logado, com o productCode do seu plano.',
      'Só funciona para consumidor AUTENTICADO (passo 2): sem KBA aprovada não há relatório.',
      'Guardar reportKey + displayToken: são credenciais de leitura daquele relatório, não identificadores públicos.',
      'Autenticar com o client token (do servidor) ou com x-credmo-user-token (do dispositivo do usuário).',
      'É este passo que dá origem ao par reportKey/displayToken usado pelo modo manual do Playground e pelos componentes array-credit-report / array-credit-score.',
    ],
    produces: 'reportKey + displayToken',
    confidence: 'verified',
    facts: [
      { level: 'verified', text: 'Rota POST /report/v2, corpo com clientKey + productCode e a resposta { reportKey, displayToken }.' },
      { level: 'verified', text: 'productCode credmo3bReportScore (3 bureaus + score) e exp1bScore (Experian) vistos em produção.' },
      { level: 'unverified', text: 'A lista completa de productCodes (depende do plano) e se o appKey é obrigatório no corpo — esta POC o envia, como nas outras rotas.' },
      { level: 'verified', text: 'Este pedido dispara webhook ("customer ordered a report") com clientKey, reportKey, displayToken e productCode (§3.10) — é a forma de reagir sem ficar consultando.' },
    ],
    curl: `${SHELL_ENV}
#      export CLIENT_KEY='...'           # do passo 1, já autenticado no passo 2

curl -sS -X POST https://sandbox.array.io/api/report/v2 \\
  -H "content-type: application/json" \\
${CLIENT_TOKEN_HEADER}
  -d @- <<JSON
{
  "appKey": "$ARRAY_APP_KEY",
  "clientKey": "$CLIENT_KEY",
  "productCode": "credmo3bReportScore"
}
JSON
# -> { "reportKey": "9C1E...", "displayToken": "4A77..." }
# export REPORT_KEY='9C1E...' DISPLAY_TOKEN='4A77...'`,
    ts: `// SERVIDOR — o par reportKey/displayToken é credencial, trate como token.
export async function pedirRelatorio(clientKey: string, productCode = 'credmo3bReportScore') {
  const res = await fetch('https://sandbox.array.io/api/report/v2', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-credmo-client-token': process.env.ARRAY_SERVER_TOKEN!,
    },
    body: JSON.stringify({ appKey: process.env.ARRAY_APP_KEY!, clientKey, productCode }),
  })
  if (!res.ok) throw new Error(\`Array /report/v2 -> \${res.status}\`)
  const { reportKey, displayToken } = (await res.json()) as { reportKey: string; displayToken: string }
  await db.salvarRelatorio(clientKey, reportKey, displayToken) // no SEU banco
  return { reportKey, displayToken }
}`,
    screen: { to: '/report', label: 'Credit Report' },
    notes:
      'O displayToken libera a leitura de UM relatório: trate-o como o userToken (curto, reinjetado, nunca em HTML estático ou cache de CDN).',
  },
  {
    n: 6,
    id: 'get-report',
    title: 'Buscar o relatório (polling 202/200/204) e renovar o displayToken',
    lane: 'server',
    arrayRoute: 'GET /report/v2?reportKey=…&displayToken=…  ·  PUT /report/v2',
    pocRoute: 'GET /api/array/report  ·  PUT /api/array/report',
    backend: [
      'Buscar o conteúdo com reportKey + displayToken na query — este par É a autenticação da leitura.',
      'Fazer o polling pelo STATUS HTTP, não pelo corpo: 202 = ainda gerando (repita), 200 = pronto, 204 = falha PERMANENTE (aborte já, não adianta repetir).',
      'Usar intervalo e timeout configuráveis (aqui: ARRAY_POLL_INTERVAL e ARRAY_POLL_TIMEOUT, em segundos) em vez de um sleep hard-coded.',
      'Nunca fazer esse polling no browser com o client token: quem espera é o SEU backend (ou o componente, com o userToken dele).',
      'Contar que os tokens valem UMA recuperação: eles seguem válidos durante os 202, mas depois do 200 é preciso renovar com PUT /report/v2 para reler.',
      'Renovar com PUT /report/v2 { clientKey, reportKey } quando o displayToken expirar ou for reusado — devolve um displayToken novo, sem pedir outro relatório (nem gastar outro produto).',
      'Guardar o payload se você for reexibi-lo: esta POC grava o JSON no D1 para sobreviver a um F5.',
    ],
    produces: 'relatório (JSON) — score, tradelines, consultas, cobranças',
    confidence: 'verified',
    facts: [
      { level: 'verified', text: 'GET /report/v2?reportKey=&displayToken= e o critério de conclusão por STATUS: "A 202 HTTP status means that the API is still generating the report, in which case you should repeat the call until it returns 200 (success) or 204 (failure)" (docs.array.com/docs/how-to-retrieve-a-credit-report).' },
      { level: 'verified', text: 'Os tokens continuam válidos durante as chamadas iteradas — e valem UMA recuperação: "The tokens are good for one retrieval, only." Para reler, renove com PUT /report/v2.' },
      { level: 'verified', text: 'PUT /report/v2 com { clientKey, reportKey } e o header do client token renova o displayToken.' },
      { level: 'verified', text: 'Formatos documentados: JSON, XML, PDF e HTML.' },
      { level: 'unverified', text: 'O esquema completo do envelope do relatório (esta POC modela um subconjunto e sempre guarda o payload cru).' },
      { level: 'unverified', text: 'A UNIDADE de ARRAY_POLL_INTERVAL/ARRAY_POLL_TIMEOUT (segundos) e os valores default 1,0 s / 120 s: a Array não publica intervalo nem timeout recomendados. Fonte TERCEIRA (integração da Forth) descreve re-tentativas de bureau em 1 min + 1 min, com falha permanente na 3ª — se isso valer para a sua conta, 120 s pode ser curto: considere 300 s ou espere o webhook.' },
      { level: 'unverified', text: '401/403 = displayToken expirado: §6 registra que os shapes de autenticação/autorização não são públicos (os status observados foram 400 e 404). Trate qualquer 4xx como erro que NÃO melhora esperando, e renove o displayToken com o PUT antes de reler.' },
    ],
    curl: `${SHELL_ENV}
#      export REPORT_KEY='...' DISPLAY_TOKEN='...'   # do passo 5
#      export ARRAY_POLL_INTERVAL=1.0                # segundos (// UNVERIFIED: unidade inferida)
#      export ARRAY_POLL_TIMEOUT=120                 # segundos (// UNVERIFIED: unidade inferida)

# O critério é o STATUS HTTP, não o corpo (documentado pela Array):
#   202 = ainda gerando  -> repita
#   200 = pronto         -> use o corpo
#   204 = FALHA PERMANENTE -> aborte AGORA (repetir não resolve)
# Qualquer 4xx também não melhora esperando: mostre o corpo e pare (Y-002).
fim=$(( $(date +%s) + \${ARRAY_POLL_TIMEOUT:-120} ))
tentativa=0
while :; do
  tentativa=$(( tentativa + 1 ))
  resposta=$(curl -sS -G -w '\\n%{http_code}' https://sandbox.array.io/api/report/v2 \\
    --data-urlencode "reportKey=$REPORT_KEY" \\
    --data-urlencode "displayToken=$DISPLAY_TOKEN")
  status=$(printf '%s' "$resposta" | tail -n1)
  corpo=$(printf '%s' "$resposta" | sed '$d')
  case "$status" in
    200) printf '%s\\n' "$corpo"; break ;;
    204) echo "HTTP 204 na tentativa $tentativa — falha PERMANENTE da geração; peça outro relatório" >&2; exit 1 ;;
    202) echo "HTTP 202 na tentativa $tentativa — ainda gerando, repetindo" >&2 ;;
    *)   echo "HTTP $status na tentativa $tentativa — abortando:" >&2; printf '%s\\n' "$corpo" >&2; exit 1 ;;
  esac
  [ "$(date +%s)" -ge "$fim" ] && { echo "timeout de \${ARRAY_POLL_TIMEOUT:-120}s ainda em 202" >&2; exit 1; }
  sleep "\${ARRAY_POLL_INTERVAL:-1}"
done

# os tokens valem UMA recuperação: para RELER, renove o displayToken
# (também é o que fazer se ele expirar) — sem pedir outro relatório:
curl -sS -X PUT https://sandbox.array.io/api/report/v2 \\
  -H "content-type: application/json" \\
${CLIENT_TOKEN_HEADER}
  -d @- <<JSON
{ "clientKey": "$CLIENT_KEY", "reportKey": "$REPORT_KEY" }
JSON
# -> { "displayToken": "novo..." }`,
    ts: `// SERVIDOR — o relatório não sai pronto: espere no backend, não no browser.
// O critério é o STATUS HTTP (documentado): 202 repete, 200 pronto, 204 falha
// PERMANENTE. Nunca inspecione o corpo para decidir se "ainda está vindo".
const espera = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// Unidade em SEGUNDOS: // UNVERIFIED (a Array não publica valores).
const INTERVALO_MS = Number(process.env.ARRAY_POLL_INTERVAL ?? 1) * 1000
const TIMEOUT_MS = Number(process.env.ARRAY_POLL_TIMEOUT ?? 120) * 1000

export class RelatorioFalhouPermanentemente extends Error {}
export class DisplayTokenExpirado extends Error {}

export async function buscarRelatorio(reportKey: string, displayToken: string) {
  const url = \`/report/v2?reportKey=\${reportKey}&displayToken=\${displayToken}\`
  const limite = Date.now() + TIMEOUT_MS
  for (let tentativa = 1; ; tentativa++) {
    const res = await arrayGet(url)
    if (res.status === 200) return await res.json()
    // 204 = falha permanente: abortar aqui é o ponto. Tratar 204 como "ainda
    // vazio" faz o loop girar até o timeout — era o bug da versão anterior.
    if (res.status === 204) throw new RelatorioFalhouPermanentemente(\`204 na tentativa \${tentativa}\`)
    if (res.status === 401 || res.status === 403) throw new DisplayTokenExpirado()
    if (res.status !== 202) throw new Error(\`Array /report/v2 -> \${res.status} \${await res.text()}\`)
    if (Date.now() + INTERVALO_MS > limite) {
      throw new Error(\`ainda 202 depois de \${TIMEOUT_MS / 1000}s (\${tentativa} tentativas)\`)
    }
    await espera(INTERVALO_MS)
  }
}

// Os tokens valem UMA recuperação: para reler o MESMO relatório, renove.
export async function renovarDisplayToken(clientKey: string, reportKey: string) {
  const res = await arrayPut('/report/v2', { clientKey, reportKey })
  return (await res.json()) as { displayToken: string }
}`,
    screen: { to: '/report', label: 'Credit Report' },
    notes:
      'Os componentes array-credit-report e array-credit-score aceitam reportKey + displayToken em modo manual: é daqui que esses valores saem. Para não ficar consultando, assine os webhooks (§3.10 da pesquisa).',
  },
]

const LANE_LABEL: Record<Lane, string> = { server: 'SERVIDOR', browser: 'BROWSER' }

function Flow() {
  return (
    <div className="flow-diagram">
      <svg
        viewBox="0 0 900 400"
        role="img"
        aria-label="Encadeamento das 6 chamadas: o servidor cria o consumidor, faz o KBA, emite o userToken, pede e busca o relatório; o browser monta o componente com appKey e userToken. O client token nunca cruza a fronteira."
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
          </marker>
        </defs>

        {/* faixa servidor */}
        <rect x="8" y="8" width="884" height="250" rx="10" className="lane lane-server" />
        <text x="22" y="30" className="lane-title">SERVIDOR — client token (segredo)</text>

        {/* faixa browser */}
        <rect x="8" y="276" width="884" height="112" rx="10" className="lane lane-browser" />
        <text x="22" y="298" className="lane-title">BROWSER — appKey (público) + userToken (curta duração)</text>

        {/* passos do servidor — linha 1 */}
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
          <text x="520" y="114" className="node-o">→ userToken (TTL curto)</text>
        </g>

        {/* passos do servidor — linha 2 (relatório) */}
        <g className="node">
          <rect x="26" y="152" width="200" height="86" rx="8" />
          <text x="40" y="176" className="node-n">5</text>
          <text x="58" y="176" className="node-t">Pedir relatório</text>
          <text x="40" y="198" className="node-c">POST /report/v2</text>
          <text x="40" y="218" className="node-o">→ reportKey + displayToken</text>
        </g>
        <g className="node">
          <rect x="256" y="152" width="220" height="86" rx="8" />
          <text x="270" y="176" className="node-n">6</text>
          <text x="288" y="176" className="node-t">Buscar relatório</text>
          <text x="270" y="198" className="node-c">GET /report/v2 (202 → 200/204)</text>
          <text x="270" y="218" className="node-o">→ JSON · PUT renova o token</text>
        </g>

        {/* passo do browser */}
        <g className="node">
          <rect x="506" y="312" width="230" height="62" rx="8" />
          <text x="520" y="336" className="node-n">4</text>
          <text x="538" y="336" className="node-t">Web component</text>
          <text x="520" y="358" className="node-c">appKey + userToken</text>
        </g>

        {/* setas */}
        <line x1="226" y1="91" x2="256" y2="91" className="edge" markerEnd="url(#arrow)" />
        <line x1="476" y1="91" x2="506" y2="91" className="edge" markerEnd="url(#arrow)" />
        <path d="M126,134 V152" className="edge" fill="none" markerEnd="url(#arrow)" />
        <line x1="226" y1="195" x2="256" y2="195" className="edge" markerEnd="url(#arrow)" />
        <line x1="621" y1="134" x2="621" y2="312" className="edge" markerEnd="url(#arrow)" />
        <text x="632" y="240" className="edge-label">só o userToken atravessa</text>

        {/* fronteira */}
        <line x1="8" y1="267" x2="892" y2="267" className="boundary" />
        <text x="770" y="262" className="boundary-label">fronteira</text>

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

interface StepState {
  done: boolean
  value: string
  label: string
  /** Por que este passo NÃO está marcado como feito, quando for o caso. */
  why?: string
}

export function IntegrationGuide() {
  const { session, status } = useSession()
  const [langByStep, setLangByStep] = useState<Record<string, 'curl' | 'ts'>>({})
  const appKey = status?.appKey ?? ''

  /**
   * Estado real da sessão desta POC, por passo. Cada passo vem do EVENTO
   * correspondente: antes, `kba` e `usertoken` eram os dois `!!userToken`, então
   * "Semear usuário demo" acendia 4/4 sem nenhuma pergunta respondida e sem
   * nenhum componente montado (X-006).
   */
  const state = useMemo<Record<string, StepState>>(() => {
    const semeado = session.userTokenSource === 'seed'
    const mountedHere = !!session.componentMountedAt && session.componentMountedTab === tabId()
    const mountedOtherTab = !!session.componentMountedAt && !mountedHere
    return {
      user: { done: !!session.clientKey, value: session.clientKey, label: 'clientKey' },
      kba: {
        done: !!session.kbaAuthenticatedAt,
        value: session.kbaAuthenticatedAt
          ? `respostas aceitas em ${session.kbaAuthenticatedAt} — authToken ${session.authToken || '(consumido)'}`
          : '',
        label: 'respostas de KBA aceitas',
        why: session.authToken
          ? 'perguntas buscadas (authToken na sessão), mas nenhuma resposta aprovada ainda'
          : semeado
            ? 'a sessão foi semeada: o userToken saiu direto do /api/seed, sem KBA'
            : undefined,
      },
      usertoken: {
        done: !!session.userTokenMintedAt,
        value: session.userTokenMintedAt
          ? `POST /api/array/usertoken em ${session.userTokenMintedAt} → ${session.userToken}`
          : '',
        label: 'POST /api/array/usertoken feito pelo browser',
        why:
          !session.userTokenMintedAt && session.userToken
            ? semeado
              ? 'existe userToken na sessão, mas ele veio do /api/seed (servidor), não desta rota'
              : 'existe userToken na sessão, mas ele veio do KBA (passo 2), não desta rota'
            : undefined,
      },
      // Z-001: the event is scoped to the TAB that mounted it and is cleared on
      // "Desmontar" and on a failed CDN load, so this step cannot keep claiming
      // a component in a tab where none was ever mounted. `localStorage` is
      // shared by every tab; `sessionStorage` (tabId) is not.
      component: {
        done: mountedHere,
        value: mountedHere
          ? `<${session.componentTag}> montado nesta aba em ${session.componentMountedAt}` +
            (isValidAppKey(appKey) ? ` com appKey de ${appKey.length} chars` : '')
          : '',
        label: 'web component montado nesta aba',
        why: mountedHere
          ? undefined
          : mountedOtherTab
            ? 'um componente foi montado em outra aba/janela desta sessão — este passo só conta o que montou nesta aba'
            : !isValidAppKey(appKey)
              ? 'sem appKey de 36 caracteres o loader da Array não valida o bundle'
              : 'nenhum componente montado nesta aba (o CDN embed.array.io está bloqueado neste ambiente)',
      },
      'order-report': {
        // Derived from the EVENT (`reportOrderedAt`), like every other step: a
        // key sitting in the session proves only that SOMEBODY ordered the
        // report — the seeded session had the same key and step 3, one card
        // above, refused to count exactly that (Y-001, closing X-006).
        done: !!session.reportOrderedAt,
        value: session.reportOrderedAt
          ? `POST /api/array/report em ${session.reportOrderedAt} → reportKey ${session.reportKey} · displayToken ${session.displayToken}`
          : '',
        label: 'POST /api/array/report feito nesta sessão',
        why:
          !session.reportOrderedAt && session.reportKey
            ? semeado
              ? 'existe reportKey na sessão, mas o relatório foi pedido pelo /api/seed (servidor), não por esta chamada'
              : 'existe reportKey na sessão, mas ele não veio de um pedido feito nesta sessão'
            : undefined,
      },
      'get-report': {
        done: !!session.reportFetchedAt,
        value: session.reportFetchedAt ? `relatório recebido em ${session.reportFetchedAt}` : '',
        label: 'relatório com conteúdo',
        why:
          !session.reportFetchedAt && session.reportKey
            ? 'relatório pedido, mas o conteúdo ainda não foi buscado nesta sessão'
            : undefined,
      },
    }
  }, [
    session.clientKey,
    session.userToken,
    session.authToken,
    session.kbaAuthenticatedAt,
    session.userTokenMintedAt,
    session.componentMountedAt,
    session.componentMountedTab,
    session.componentTag,
    session.userTokenSource,
    session.reportKey,
    session.displayToken,
    session.reportOrderedAt,
    session.reportFetchedAt,
    appKey,
  ])

  const doneCount = Object.values(state).filter((s) => s.done).length
  const total = STEPS.length

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Guia de Integração</h1>
          <p>
            As seis chamadas que levam do "nada" até um web component da Array renderizando dados do seu usuário e um
            relatório de crédito na mão — e, em cada uma, o que fica <strong>no seu servidor</strong> e o que pode ir{' '}
            <strong>ao browser</strong>. As outras telas <em>mostram</em> a POC funcionando; esta <em>prescreve</em> o
            que o seu backend precisa expor.
          </p>
          <p className="hint">
            Regra única que resume tudo: o <strong>client token</strong> (<code>ARRAY_SERVER_TOKEN</code> nesta POC) é
            segredo de servidor e nunca aparece em HTML, JS ou request do browser. O <strong>appKey</strong> é público
            por design (e vai também no <em>corpo</em> das chamadas de API) e o <strong>userToken</strong> é de curta
            duração — é ele, e só ele, que atravessa a fronteira.
          </p>
          <p className="hint">
            Os selos são os mesmos do <Link to="/playground">Playground</Link>:{' '}
            <span className="badge ok">verificado</span> visto em fonte de primeira mão ou em integração real,{' '}
            <span className="badge warn">// UNVERIFIED</span> inferido da documentação indexada (a Array mantém{' '}
            <code>docs.array.com</code> fechado). Cada passo lista o que é fato e o que é aposta desta POC.
          </p>
        </div>
        <div className="row">
          <span className={`badge ${doneCount === total ? 'ok' : 'warn'}`}>
            {doneCount}/{total} passos com evento real nesta sessão
          </span>
        </div>
      </div>

      <Card title="O encadeamento das 6 chamadas">
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
                  <span className={`badge ${CONFIDENCE_CLASS[s.confidence]}`}>{CONFIDENCE_LABEL[s.confidence]}</span>
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

                  <div>
                    <div className="label small muted">O que é fato e o que é inferência</div>
                    <ul className="small" style={{ margin: '6px 0 0 18px' }}>
                      {s.facts.map((f) => (
                        <li key={f.text}>
                          <span className={`badge ${CONFIDENCE_CLASS[f.level]}`}>{CONFIDENCE_LABEL[f.level]}</span>{' '}
                          {f.text}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className={`step-state ${st.done ? 'ok' : ''}`}>
                    <div className="label small muted">Nesta sessão · {st.label}</div>
                    {st.done ? (
                      <div className="mono small" style={{ overflowWrap: 'anywhere' }}>{st.value}</div>
                    ) : (
                      <div className="small muted">
                        pendente{st.why ? ` — ${st.why}` : ''}. Rode <Link to={s.screen.to}>{s.screen.label}</Link> (ou{' '}
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
              <strong>client token</strong> (<code>x-credmo-client-token</code> / <code>ARRAY_SERVER_TOKEN</code>): dá
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
              <strong>displayToken</strong> em HTML estático: ele libera a leitura do relatório do passo 5; trate-o como
              o userToken (curto e reinjetado, renovado com <code>PUT /report/v2</code>).
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
              segredo-de-usuário que o browser precisa ver. O dispositivo pode usá-lo como header{' '}
              <code>x-credmo-user-token</code> nas leituras, em vez de você intermediar tudo.
            </li>
            <li>
              As <strong>perguntas de KBA</strong> (sem o authToken) e o <strong>reportKey</strong> quando você usa o
              componente em modo manual.
            </li>
          </ul>
          <p className="hint" style={{ marginBottom: 0 }}>
            Pronto para colar? A tela <Link to="/playground">Web Components</Link> gera o snippet completo do passo 4
            com o appKey e o userToken desta sessão, o <Link to="/report">Credit Report</Link> exercita os passos 5 e 6,
            e o <Link to="/inspector">API Inspector</Link> mostra as chamadas que já aconteceram, com os segredos
            redigidos.
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
                <td><code>202</code> no <code>GET /report/v2</code></td>
                <td>o relatório ainda está sendo montado pelos bureaus</td>
                <td>Servidor: repetir com <code>ARRAY_POLL_INTERVAL</code> até 200/204, nunca no browser</td>
              </tr>
              <tr>
                <td><code>204</code> no <code>GET /report/v2</code></td>
                <td>falha <strong>permanente</strong> da geração</td>
                <td>Servidor: abortar já e pedir outro relatório — repetir não resolve</td>
              </tr>
              <tr>
                <td>Leitura recusada na SEGUNDA vez, logo depois de um 200</td>
                <td>os tokens valem <strong>uma</strong> recuperação</td>
                <td>Servidor: <code>PUT /report/v2</code> antes de reler (passo 6)</td>
              </tr>
              <tr>
                <td>Leitura do relatório recusada horas depois</td>
                <td><code>displayToken</code> expirado</td>
                <td>Servidor: <code>PUT /report/v2</code> (passo 6), sem pedir outro relatório</td>
              </tr>
              <tr>
                <td>Corpo rejeitado com erro de validação</td>
                <td><code>appKey</code> ausente no corpo da chamada de API</td>
                <td>Servidor: <code>appKey</code> vai no corpo dos passos 1, 2, 3 e 5</td>
              </tr>
              <tr>
                <td>Token "cacheado" que não devia servir</td>
                <td>cache de <code>userToken</code> sem ambiente/appKey/client token na chave</td>
                <td>Servidor: veja a última linha do passo 3</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
