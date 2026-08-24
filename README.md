# POC Array.com — API + Web Components (100% local)

POC para **ver e mexer** nas funcionalidades da [Array](https://array.com/) — enrollment,
verificação de identidade (KBA), relatório de crédito, alertas e os **Web Components**
embutíveis — rodando inteiramente na sua máquina.

| Camada | Stack |
|---|---|
| Backend | Hono em Cloudflare Workers (`wrangler dev --local`) + D1 (SQLite) + KV |
| Frontend | React + Vite + TypeScript, CSS próprio (sem libs de UI) |
| Proxy | dev server do Vite: `/api` → `http://localhost:8787` |

Dois modos, mesmos endpoints:

- **MOCK** (padrão, sem credenciais): fixtures determinísticas — score 712, 12 meses de
  histórico, relatório 3 bureaus com tradelines/consultas/cobranças, 4 perguntas de KBA,
  6 alertas. Nada de rede.
- **SANDBOX** (com credenciais): as mesmas rotas chamam `https://sandbox.array.io/api`.

## Estado: pronta para avaliação (ciclo 9)

Nove ciclos de desenvolvimento + QA adversarial (relatórios em `docs/VALIDATION_CICLO*.md`).
**Não há P0 nem P1 aberto.** Toda a validação funcional foi feita em **modo MOCK**, porque neste
ambiente o egresso para `array.io` é bloqueado (ver *O que você precisa fazer manualmente*).

Se você abriu este repo agora, a ordem que economiza tempo é:

1. **Como rodar** (abaixo) — três comandos, sem credencial, tudo em mock;
2. a tela **Guia de Integração** (`/integracao`) — é o entregável principal: as 6 chamadas da Array
   com `curl` e TypeScript coláveis, a fronteira servidor/browser e, por afirmação, o selo
   **verificado** vs **`// UNVERIFIED`**;
3. **Onde colar as chaves** + **Prontidão com credenciais reais** — o que muda quando você pluga
   sandbox de verdade e o que pode falhar;
4. `docs/ARRAY_API_RESEARCH.md` — de onde cada fato veio (a doc da Array é fechada por senha) e
   `docs/QA.md` — como rodar as suítes.

| Diretório | O que tem |
|---|---|
| `worker/` | API Hono (Workers) + D1 + KV, provider `mock` e provider `array` real, 65 testes vitest |
| `web/` | 8 telas React (Dashboard, Enrollment, KBA, Credit Report, Alerts, Guia de Integração, Web Components, API Inspector) |
| `scripts/` | suítes de validação (HTTP, browser, snippets coláveis, envenenamento de KV, aritmética do relatório) |
| `docs/` | pesquisa da API, plano, QA e os relatórios de validação por ciclo |

## Como rodar

```bash
# 1. dependências (na raiz do repo)
npm install

# 2. migrações do D1 local
npm run db:migrate

# 3. worker (:8787) + web (:5173) juntos
npm run dev
```

No primeiro boot o `wrangler dev` imprime avisos esperados **antes** do `Ready on :8787`
(`wrangler out-of-date` e, sem rede liberada, um `Error: Request was cancelled.` do undici na
checagem de versão). Não são falhas: se `curl localhost:8787/api/health` responde `{"ok":true}`,
está tudo certo.

Abra <http://localhost:5173>. Comece pelo Dashboard → **Semear usuário demo**, ou percorra
Enrollment → KBA → Credit Report → Alerts → **Guia de Integração** → Web Components → API Inspector.

### Guia de Integração (`/integracao`) — comece por aqui se o objetivo é integrar

A tela **Guia de Integração** é a única que *prescreve* a integração em vez de mostrá-la depois do
fato. Ela traz, num stepper com diagrama:

- o encadeamento das **6 chamadas**: `POST /user/v2` → `GET`+`POST /authenticate/v2` →
  `POST /authenticate/v2/usertoken` → atributo `userToken` no web component →
  `POST /report/v2` → `GET /report/v2` (com o retry de 3 s, porque o relatório não sai pronto) e
  `PUT /report/v2` para renovar o `displayToken`;
- a **fronteira servidor/browser** desenhada: o *client token* nunca cruza; o `appKey` (público) e o
  `userToken` (curta duração) são os únicos valores que vão ao browser;
- por passo: o que **o seu backend** precisa implementar, o `curl` e o equivalente em **TypeScript**
  (servidor ou browser, conforme o passo). Os `curl` são **coláveis**: segredo em variável de
  ambiente com aspas duplas, aviso de segredo em linha de comentário própria (nunca dentro do valor
  de um header) e corpo JSON por heredoc, sempre com `appKey` — os mesmos campos que o
  `ArrayClient` do worker envia. `scripts/guide-check-ciclo6.mjs` executa cada um contra o worker
  local e compila cada snippet TypeScript com `tsc --strict`;
- por passo, o selo **verificado / `// UNVERIFIED`**: o que veio de fonte de primeira mão e o que é
  inferência desta POC (ex.: `expiresAt` é campo calculado aqui, não da Array; o clamp de
  `ttlInMinutes` 1–1440 é do worker);
- o **estado real da sessão atual** ao lado de cada passo, derivado do **evento** correspondente:
  respostas de KBA aceitas, `POST /api/array/usertoken` feito pelo browser, componente realmente
  montado no DOM, relatório pedido e relatório recebido. Uma sessão semeada mostra **1/6** — não 6/6: o `/api/seed` faz tudo no servidor, então nem KBA, nem `usertoken`, nem componente, nem o pedido do relatório contam como evento desta sessão;
- uma tabela dos erros que você vai encontrar (`userToken` expirado, appKey ≠ 36 chars, custom
  element auto-fechado, KBA reprovada, relatório vazio recém-pedido, `displayToken` expirado,
  `appKey` fora do corpo) e onde cada um se resolve.

Com um `clientKey` na sessão (seed ou enrollment), as telas de **KBA, Credit Report e Alerts
carregam sozinhas** ao abrir, e o relatório é re-buscado depois de um F5 usando o
`reportKey`+`displayToken` guardados no `localStorage`.

Comandos úteis:

```bash
npm --workspace worker run test        # vitest (65 testes)
npm --workspace web run build          # tsc -b + vite build
npm --workspace worker run typecheck   # tsc --noEmit
npm --workspace worker run dev         # só o worker
npm --workspace web run dev            # só o front
```

E a suíte de validação (pré-requisitos do Chromium e o que cada script cobre em
[`docs/QA.md`](docs/QA.md)):

```bash
npm --workspace worker run test && npm --workspace worker run typecheck
npm --workspace web run build
bash scripts/smoke-api.sh                                   # 42 casos HTTP de abuso
export PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome   # não rode playwright install
node scripts/e2e-smoke.mjs && node scripts/snippet-check.mjs
node scripts/regression-ciclo3.mjs && node scripts/guide-check-ciclo6.mjs
node scripts/verify-guide-ciclo7.mjs && node scripts/walkthrough-ciclo7.mjs
node scripts/kv-poison-ciclo7.mjs && node scripts/report-audit-ciclo7.mjs 8
node scripts/hostile-attrname-ciclo7.mjs && node scripts/step-state-ciclo7.mjs
```

## Onde colar as chaves

```bash
cp .env.example .env                        # referência para você
cp worker/.dev.vars.example worker/.dev.vars # este é o que o wrangler lê
```

Preencha `worker/.dev.vars` e **reinicie o worker**:

```ini
SMARTY_AUTH_ID=<appKey da Array>        # UUID de 36 chars
SMARTY_AUTH_TOKEN=<client token>        # segredo, fica só no worker
ARRAY_ENV=sandbox                       # sandbox | production
```

Se **qualquer um dos dois** estiver vazio, a POC cai automaticamente em modo MOCK. O banner
no topo do frontend sempre mostra o modo vigente (`GET /api/status`).

## Prontidão com credenciais reais (o que funciona em mock vs sandbox)

Resumo do checklist de prontidão de `docs/VALIDATION_CICLO7.md`.

**Vai funcionar de primeira, sem credencial nenhuma:** `npm install && npm run db:migrate &&
npm run dev`; as 9 telas em modo mock com fixtures que fecham a própria aritmética; as suítes de
validação verdes; o Guia de Integração inteiro (`curl` e TypeScript coláveis, executados contra uma
Array falsa em `scripts/fake-array-ciclo7.mjs`); o Inspector com segredo e PII redigidos; o cache de
`userToken` isolado por modo/appKey/baseUrl/client token.

**O que muda quando você preenche `worker/.dev.vars` e reinicia** (`ARRAY_ENV=sandbox`): enrollment,
KBA, `usertoken` e report passam a chamar `https://sandbox.array.io/api` pelos paths **verificados**
(§3.1–§3.6 da pesquisa) e devem responder. O que pode falhar, em ordem de probabilidade:

1. o **envelope exato** do `POST /user/v2` — o aninhamento de `address` é inferido (§3.1);
2. **KBA de sandbox** — as perguntas vêm de bureau real, então as respostas das fixtures não servem
   e um `400` legítimo é resposta esperada; pegue identidades de teste no portal da Array;
3. as telas que dependem de **path inferido** (abaixo) — se a Array usar outro path, a tela recebe
   404 mapeado para erro tratado, **não** tela branca, e a correção é uma linha por método.

**Paths inferidos (`// UNVERIFIED path` em `worker/src/array/client.ts`):**

| Tela | Chamada inferida |
|---|---|
| Alerts | `GET /alert/v2`, `GET /alert/v2/{id}` |
| Monitoring | `GET /monitoring/v2` |
| Histórico de score | `GET /report/v2/scoretracker` |

Além dos paths, o Guia de Integração e o Playground marcam **por afirmação** o que é
`verificado` e o que é `// UNVERIFIED` (por exemplo: `appKey` no corpo do `/report/v2`, `clientKey`
na query do `GET /authenticate/v2`, o critério de "relatório ainda vazio" e o mapeamento
401/403 = `displayToken` expirado — todos inferências desta POC).

## O que você precisa fazer manualmente

1. **Liberar egress** para `array.io`, `sandbox.array.io` e `embed[.sandbox].array.io` (CDN dos web
   components). No ambiente onde a POC foi desenvolvida os três são bloqueados pelo proxy, por isso
   o passo 4 do Guia só foi exercitado com o CDN stubado e toda a validação funcional é em mock.
2. **Pegar credenciais e identidades de sandbox no portal da Array**: `appKey` + client token para o
   `.dev.vars`, e consumidores de teste — as fixtures usam SSN do bloco `666…`, que é o bloco certo
   para teste, mas as identidades que o bureau de sandbox reconhece vêm de lá.
3. **Conferir os paths inferidos** (tabela acima) contra o OpenAPI/Postman do portal (§7 da
   pesquisa) antes de levar Alerts/monitoring/scoretracker para qualquer coisa séria.
4. Rodar a suíte depois de plugar as chaves: `docs/QA.md` §0–§2. O caminho canônico
   enrollment → KBA → usertoken → report é o que vale como aceite.

## Nota honesta sobre os nomes SMARTY_*

**A API da Array não usa credenciais Smarty.** Não existe header `Smarty-Auth-Id` /
`Smarty-Auth-Token` em nenhum endpoint da Array — isso pertence à
[Smarty](https://www.smarty.com/), fornecedora de validação de endereços, sem relação com a
Array. Detalhes e fontes em [`docs/ARRAY_API_RESEARCH.md`](docs/ARRAY_API_RESEARCH.md) §2.

Como o pedido exigia esses nomes de variável, eles foram **mapeados** para as credenciais
reais da Array:

| Variável do projeto | Credencial real da Array | Como é usada |
|---|---|---|
| `SMARTY_AUTH_ID` | `appKey` | UUID de 36 chars, **público por design** (vai no HTML dos componentes) |
| `SMARTY_AUTH_TOKEN` | client token | header `x-credmo-client-token`, **segredo — nunca vai ao browser** |

Aliases com os nomes reais também funcionam e têm prioridade menor:
`ARRAY_APP_KEY` e `ARRAY_CLIENT_TOKEN`.

## Rotas do worker

| Rota | Array por trás |
|---|---|
| `GET /api/health`, `GET /api/status` | — (status/modo; só booleanos, nunca o segredo) |
| `POST /api/seed` | cria consumidor demo + token + relatório + alertas |
| `POST /api/array/user` | `POST /user/v2` (enrollment → `clientKey`) |
| `GET /api/array/user` | `GET /user/v2` (resolve userId por `x-credmo-user-token`) |
| `GET /api/array/users` | lista o D1 local — pagina (`?limit=` 1–200, default 50; `?limit=` vazio = default, não mínimo) e devolve `total` à parte |
| `GET /api/array/authenticate` | `GET /authenticate/v2` (perguntas KBA + `authToken`) |
| `POST /api/array/authenticate` | `POST /authenticate/v2` (respostas → `userToken`) |
| `POST /api/array/usertoken` | `POST /authenticate/v2/usertoken` (token dos componentes) |
| `POST /api/array/report` | `POST /report/v2` (→ `reportKey` + `displayToken`) |
| `GET /api/array/report` | `GET /report/v2` |
| `PUT /api/array/report` | `PUT /report/v2` (renova `displayToken`) |
| `GET /api/array/scoretracker` | `GET /report/v2/scoretracker` — **path inferido** |
| `GET /api/array/alerts`, `/alerts/:id` | `GET /alert/v2` — **paths inferidos** |
| `GET /api/array/monitoring` | `GET /monitoring/v2` — **path inferido** |
| `GET /api/inspector`, `DELETE /api/inspector` | log de auditoria em D1 |

O relatório mock fecha a própria aritmética: `summary` traz o par `revolvingBalance` /
`revolvingLimit` (só `Credit Card`, `Charge Card` e `Revolving` — empréstimo estudantil, hipoteca e
financiamento de veículo são parcelados e entram em `installmentBalance`), e `utilization` é
exatamente `revolvingBalance / revolvingLimit`. O histórico de score converge para o score canônico
em vez de cair e recuperar 30 pontos no último mês, e os fatores `PAYMENT_HISTORY` / `DEROGATORY`
são derivados também das marcas de atraso — "nenhum registro negativo" só aparece quando não há nem
cobrança nem atraso.

O log de auditoria cobre só chamadas que representam a Array: `/api/health`, `/api/status`,
`/api/array/users`, `/api/array/reports` e `/api/array/usertoken/latest` são locais e **não**
entram no Inspector.

`POST /api/array/usertoken` usa o KV `CACHE`. A chave é **namespaciada pelo escopo do token** —
`usertoken:v2:<modo>|<appKey>|<baseUrl>|<ttlInMinutes>|<clientKey>` — porque um token emitido pelo
mock **nunca** pode ser servido enquanto o worker roda contra a Array de verdade (e vice-versa):
era exatamente o passo que você valida ao plugar as credenciais. O valor guardado carrega o escopo e
é reconferido na leitura, então uma entrada de um build antigo também é descartada. Além disso:

- o `ttlInMinutes` pedido faz parte da chave: pedir 1440 nunca devolve o token de 60 min de antes;
- um token com menos de 60 s de vida útil restante não é servido do cache, e um `ttl` de 1 minuto
  não é cacheado (a margem de segurança comeria a validade inteira);
- `?refresh=true|1|yes|on` força emissão nova; em modo mock cada emissão devolve um token
  **diferente** (o token deixou de ser determinístico por `clientKey`), então "Renovar userToken" no
  Playground muda o valor de verdade.

Tudo marcado como inferido tem um comentário `// UNVERIFIED path` em
`worker/src/array/client.ts` — a documentação da Array é fechada por senha.

## Validações do enrollment

`dob` é validada de verdade (não só o formato): data existente no calendário, no passado, e
idade entre 18 e 120 anos **contada por calendário** (ano/mês/dia), não dividindo milissegundos por
uma média de 365,25 dias — senão quem faz 18 anos hoje é aceito ou rejeitado conforme a hora do dia.
As mesmas fronteiras valem no cliente (`calendarAge` em `web/src/pages/Enrollment.tsx`) e no worker
(`calendarAge` em `worker/src/index.ts`). `2024-13-45`, `2023-02-30` e `2099-01-01` voltam 400 com `error[]`.
As mesmas regras rodam no cliente (`web/src/pages/Enrollment.tsx`) e no worker (`dobSchema`).

## O mock tem registro (caminhos de erro)

O provider mock só reconhece o que ele mesmo emitiu: `clientKey` desconhecido → 400,
`reportKey` desconhecido → 404, `displayToken` que não casa com o `reportKey` → 400,
`authToken` não emitido → 400. Assim a POC também demonstra os erros que o sandbox devolve.
O registro vive em memória, mas é reidratado do D1 a cada boot do worker — um `clientKey`
guardado no navegador continua valendo depois de reiniciar.

## Segurança da POC

- O client token existe **apenas** no worker. O frontend recebe só `userToken` de curta duração.
- SSN é gravado no D1 apenas como **últimos 4 dígitos** (`users.ssn_last4`).
- Toda chamada a `/api/*` vai para a tabela `api_calls` com SSN e tokens **redigidos**
  (`worker/src/redact.ts`) — visível na tela API Inspector.

## Limitações conhecidas neste ambiente

`array.io`, `sandbox.array.io` e `embed[.sandbox].array.io` são **bloqueados pelo proxy de
egresso**. Consequências:

- Em modo SANDBOX as chamadas voltam com erro tratado (`kind: "blocked"`, HTTP **502** — é
  condição de upstream, não erro do cliente; timeout vira 504) e uma dica no frontend — nunca
  uma tela branca.
- No Playground, os Web Components mostram um placeholder explicando o que apareceria, além
  do snippet HTML pronto para copiar para uma rede liberada. O snippet é colável num HTML em
  branco: runtime `array-web-component.js` primeiro, bundle do componente com `?appKey=`
  depois, elemento **com tag de fechamento** (custom element não é void) e o listener de
  `array-event`. Em modo mock o `appKey` é um placeholder de 36 caracteres
  (`MOCK0000-…`) — o loader da Array valida `appKey.length === 36`; troque pelo seu.
  Todo valor de atributo é escapado e todo nome é validado; nomes **executáveis** no HTML colado
  (`on*` e `data-on*`, `style`, `srcdoc`) são recusados na entrada e não entram nem no snippet nem no
  componente montado — `onload` é um nome HTML legal e viraria handler inline no arquivo do usuário.
  Desde o ciclo 9 os **atributos de URL** (`href`, `src`, `formaction`, `background`, `xlink:href`,
  `action`, `poster`, …) também são recusados: num custom element `<array-*>` eles foram *provados
  inertes* (o QA colou os cinco com `javascript:` e nada executou), mas o snippet é o entregável e o
  mesmo nome pode acabar num elemento real depois de um refactor na página do dev — e nenhum
  componente da Array recebe dados por esses atributos. Um valor com esquema executável
  (`javascript:`, `vbscript:`, `data:text/html`) em qualquer atributo é sinalizado na tela. Sem
  `userToken` na sessão o atributo sai com `SEU_USER_TOKEN_AQUI` (sem `<>`, para o find-and-replace
  do dev casar com o comentário).
- O Playground marca por componente o quanto a informação é confiável: tag verificada,
  `// UNVERIFIED` (Ads, cujo nome de tag é inferido) ou não documentado (disputas, que não têm
  componente nem endpoint em nenhuma fonte acessível). Alertas/monitoring/scoretracker têm
  slug verificado mas **path REST inferido**.
- Toda a validação funcional foi feita em modo MOCK.
- A tabela de usuários do Dashboard pede uma página de 10 (`?limit=10`) e **imprime o `total` da
  rota**, não o tamanho do payload: com 57 usuários a tela diz 57 e "Ver todos" busca até 200 (teto
  de uma página da rota) — acima disso o texto diz quantas está mostrando e aponta o `?offset=`.
- No relatório, o tile **Consultas hard nos últimos 6 meses** é a janela e a tabela **Consultas** é o
  histórico completo; a tela diz isso embaixo da tabela, e a fixture gera as consultas dentro da
  janela que anuncia.
