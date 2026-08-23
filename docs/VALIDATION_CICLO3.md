# VALIDATE — Ciclo 3 (QA adversarial)

Commit sob teste: `3aed292` ("fix: snippet colável…"). Modo MOCK, worker `:8787` + web `:5173`,
Chromium 1194 via `PW_CHROMIUM` (ver `docs/QA.md`).

Ferramentas usadas: `scripts/smoke-api.sh` (36 casos), `scripts/e2e-smoke.mjs` (7 telas),
`scripts/snippet-check.mjs` (**novo** — cola o snippet real num HTML em branco, serve num
http-server local e abre no Chromium), `scripts/regression-ciclo3.mjs` (**novo** — V-005…V-020 no
navegador), corrupção manual do D1 e um segundo worker em modo SANDBOX na porta 8788.

## Resumo

| Veredito | Qtd | IDs |
|---|---|---|
| CORRIGIDO | 17 | V-001, V-002, V-003, V-004, V-005, V-007, V-009, V-010, V-011, V-012, V-013, V-014, V-015, V-016, V-017, V-019, V-020 |
| PARCIAL | 3 | V-006, V-008, V-018 |
| NÃO CORRIGIDO | 0 | — |
| REGREDIU | 0 | — |

Defeitos novos: **0 P0 · 4 P1 · 11 P2**.

Suítes: `worker test` 42/42 · `smoke-api.sh` 36/36 · `e2e-smoke.mjs` 0 achados ·
`snippet-check.mjs` 0 achados · `typecheck`/`build` limpos.

---

## Regressão dos 20 IDs

| ID | Veredito | Evidência |
|---|---|---|
| **V-001** Inspector 500 com payload > 20 KB | **CORRIGIDO** | POST de 25 KB / 100 KB / 1 MB / 300 KB → `400`; `GET /api/inspector?limit=50` → **200** com a linha `{"_truncated":true,"bytes":1000170,"maxLen":20000,"preview":"{\"query\"…"}`. Guarda de parse: corrompi à mão uma linha no D1 (`update api_calls set request='{"broken": ', response='NOT JSON AT ALL'`) → o GET continua **200** e a linha volta como `{"_unparseable":true,"raw":"{\"broken\": "}` sem derrubar as outras 127. Na UI: nenhum banner de erro, linha aberta mostra `"bytes": 300170` + `preview` (`docs/screenshots/qa3-inspector-truncado.png`). Código: `worker/src/redact.ts:63-89` (envelope) + parse por linha no `GET /api/inspector`. |
| **V-002** DOB inválida/futura aceita | **CORRIGIDO** (fronteiras: ver W-006) | `2099-01-01`→400, `2024-13-45`→400, `2023-02-29`→400, `1900-02-29`→400, `2026-08-23` (hoje)→400, `2008-10-01` (17a11m)→400, `2004-02-29`→200. Cliente espelha em `web/src/pages/Enrollment.tsx:23-32`. |
| **V-003** custom element auto-fechado | **CORRIGIDO** (ver W-002) | `scripts/snippet-check.mjs` com 5 componentes (`array-account-enroll`, `array-credit-overview`, `array-credit-report`, `array-credit-alerts`, `array-ads`): snippet copiado da UI, colado em HTML em branco entre um `<h1>` e um `<p id="after">`, servido em `http://127.0.0.1:<porta>` e aberto no Chromium. Em 5/5: elemento criado no DOM, **`#after` continuou filho direto de `<body>`** (não foi engolido), runtime `array-web-component.js` no índice 0 e bundle no 1, listener de `array-event` reagiu ao dispatch sintético, **0 `SyntaxError`/`TypeError`** no console (só as 2 falhas de rede esperadas do CDN bloqueado). Parser independente (`html.parser` do Python, stack de tags): 5/5 `HTML OK`, nenhuma tag não fechada, nenhum self-closing de não-void. |
| **V-004** appKey de 35 chars | **CORRIGIDO** | `MOCK_APP_KEY = 'MOCK0000-0000-4000-8000-MOCKAPPKEY00'` (`worker/src/array/mock.ts:29`) tem **36** chars e é a única cópia (`config.ts:59` importa dela). Medido no DOM: `appKey` da URL do bundle = 36, atributo do elemento = 36, iguais entre si, em 5/5 componentes. A UI ainda avisa "troque pelo appKey da sua conta". |
| **V-005** inputs sem label | **CORRIGIDO** | 8/8 inputs do Enrollment com `id` + `label[for]` (`useId`, `ui.tsx:131-140`); clicar no texto "SSN" foca o campo (`document.activeElement` correto); o campo SSN tem `aria-describedby` para a dica. |
| **V-006** fixtures contraditórias | **PARCIAL** | Recomputei os agregados do JSON cru (`GET /api/array/report`) contra a tela: `totalAccounts` 7=7, `totalBalance` 256436=256436, `utilization` 75.1 = 256436/341582, `inquiries6mo` 1 = 1 hard inquiry, `delinquencies` 2 = 2 tradelines com marca ≠ OK, `onTimePct` 95% = 1140/1200 slots, `oldestAccountYears` 4 = 2026−2022, `collections` 0 e o texto "Nenhum registro negativo" agora coerentes. **Fecham.** Mas sobraram três contradições novas na mesma dobra: W-004 (limite só do rotativo vs saldo total), W-005 (empréstimo estudantil contado como rotativo), W-011/W-012 (histórico de score e fator de pagamento). |
| **V-007** telas não auto-carregam | **CORRIGIDO** | Após o seed: `/kba` dispara `GET /array/authenticate?clientKey=…` e mostra as perguntas; `/report` dispara `GET /array/report?reportKey=…&displayToken=…` e mostra 712; `/alerts` dispara `alerts` + `monitoring`. Uma chamada por tela, sem clique. |
| **V-008** 5 chamadas por visita ao Dashboard | **PARCIAL** | Medido no Playwright: `["GET /api/status","GET /api/array/users","GET /api/status"]` — 5→3, e `/array/users` caiu de 3 para 1. A poluição do Inspector **acabou** (`AUDIT_SKIP` em `worker/src/index.ts:65` exclui `/status`, `/array/users`, `/array/reports`, `/health`, `/inspector`). Resta o `/api/status` duplicado por visita (não auditado) — ver W-014. |
| **V-009** overflow mobile em `/playground` | **CORRIGIDO** | 390×844 nas 7 telas: `scrollWidth == clientWidth == 390` em **7/7** (`.snippet pre { overflow-wrap:anywhere; word-break:break-word }`, `styles.css:204`). |
| **V-010** host bloqueado = 403 | **CORRIGIDO** | Worker em sandbox (`:8788`): `POST /api/array/usertoken` → **502** `{"kind":"blocked","hint":"O host array.io está bloqueado…","upstream":{"raw":"Host not in allowlist: sandbox.array.io…"}}` em 0,26 s (sem retry inútil); `GET /array/report` idem. Mapeamento em `worker/src/index.ts:215` (`blocked→502`, `timeout→504`) e `client.ts:137-142`. O caminho de timeout não é acionável neste ambiente (o proxy responde na hora) — coberto só pelo código e pelo teste `[400,403,405,407,502,504]`. |
| **V-011** tiles com chave crua | **CORRIGIDO** | `SUMMARY_META` em `web/src/pages/CreditReport.tsx:14-23`: "Contas (total)", "Saldo total US$ 256,436", "Limite total (rotativo) US$ 341,582", "Utilização do rotativo 75.1%", "Consultas hard (6 meses)", "Conta mais antiga 4 anos". |
| **V-012** console sujo | **CORRIGIDO** | Navegação pelas 7 telas + mobile: **0** erros/warnings de console, **0** requests ≥400 (favicon em `web/index.html`, future flags no router). |
| **V-013** README não avisa do ruído do boot | **CORRIGIDO** | `README.md` §"Como rodar": nota explícita sobre `wrangler out-of-date` e `Error: Request was cancelled.` antes do `Ready on :8787`. |
| **V-014** mock aceita qualquer chave | **CORRIGIDO** | `usertoken` com clientKey inexistente → 400 `"unknown clientKey — create the consumer first (mock keeps a registry, like the sandbox)"`; `alerts`/`monitoring`/`scoretracker` com clientKey inexistente → 400; `report` GET com reportKey inexistente → 404; displayToken trocado num dígito → 400. O registro sobrevive ao restart: subi um worker novo (`:8789`) e o `clientKey` antigo continuou válido (alerts/kba/report → 200). Exceção em W-010. |
| **V-015** "Base: sandbox.array.io" em modo mock | **CORRIGIDO** | `/kba`: "Modo mock: nenhuma chamada externa (a base seria https://sandbox.array.io/api)."; `/report` e `/enrollment` com a mesma ressalva. |
| **V-016** linhas do Inspector sem affordance | **CORRIGIDO** | Texto visível: "clique numa linha para ver request/response redigidos"; clique abre o detalhe. |
| **V-017** catálogo incompleto | **CORRIGIDO** | 13 abas (era 11): + **Ads (?)** com selo `?` e + **Disputas (?)** com selo `!`; `helloPrivacyLink` presente em `array-credit-overview`; parágrafo explicando os três selos e que alerts/monitoring/scoretracker têm **path REST inferido**. |
| **V-018** input de atributo estreito | **PARCIAL** | Layout corrigido (`.attr-row`: label em cima, `input { width:100% }`, `styles.css:199-202`) — o `appKey` não aparece mais como "MOCK-APP-KEY-0000". Mas a 1440px o input tem 270 px e o valor de 36 chars ainda estoura (`scrollWidth > clientWidth`), então o fim do UUID continua fora de vista sem rolar o campo. Ver W-015. |
| **V-019** relatório desaparece no F5 | **CORRIGIDO** | `e2e-smoke.mjs`: "OK Report continua visível após reload"; a sessão em `localStorage` mantém `reportKey`+`displayToken` e a tela re-busca sozinha. |
| **V-020** `array-credit-score` sem modo manual | **CORRIGIDO** | Atributos da aba Credit Score: `appKey, userToken, sandbox, productCode, reportKey, displayToken`, com o parágrafo "Automático vs manual" explicando quando preencher os três. |

---

## Defeitos novos

### P1

#### W-001 — Em modo SANDBOX a POC devolve um userToken **do mock**, com 200 e sem chamar a Array
- **Arquivo**: `worker/src/index.ts:315-345` (`TOKEN_CACHE_PREFIX = 'usertoken:'`, chave = só o `clientKey`)
- **Repro**:
  1. modo mock (`:8787`): `POST /api/array/usertoken {"clientKey":"FF9CDBA5-…","ttlInMinutes":60}` → grava no KV `usertoken:FF9CDBA5-…`
  2. suba o worker com credenciais (`:8788`, `SMARTY_AUTH_ID`/`SMARTY_AUTH_TOKEN` preenchidos → `{"mode":"sandbox"}`)
  3. `POST localhost:8788/api/array/usertoken` com **o mesmo clientKey**
- **Observado**: `200 {"userToken":"ED9A14BA-…","cached":true}` — o token determinístico do mock, servido em modo sandbox, **sem nenhuma chamada de saída** e sem linha de erro no Inspector. Compare com qualquer outra rota, que devolve `502 kind:"blocked"`.
- **Esperado**: a chave do cache tem que incluir o modo e o `appKey` (ex. `usertoken:sandbox:<appKey>:<clientKey>`), ou o cache ser ignorado quando o modo mudou. Um token de mock aceito como token de sandbox é o pior falso positivo possível: é exatamente a etapa que o usuário quer validar quando pluga as credenciais.
- **Impacto**: destrói a promessa central do README ("dois modos, mesmos endpoints"). Também vale para o cenário oposto (credenciais removidas → token de sandbox expirado servido em mock).

#### W-002 — `buildSnippet` não escapa valores nem nomes de atributo: o snippet copiado pode sair quebrado (ou com HTML injetado)
- **Arquivo**: `web/src/components/ArrayComponent.tsx:66-68` (`` `\n  ${k}="${…v}"` ``)
- **Repro**: Playground → aba Credit Overview → no campo do atributo `sandbox` digite `true" onload="alert(1)` → card "Snippet HTML".
- **Observado**: `sandbox="true" onload="alert(1)"` — dois atributos, um deles um handler de evento executável na página em que o dev colar o snippet. Os valores vêm de inputs livres (e `+ atributo` aceita qualquer **nome** via `prompt`), então basta um `"` num token/URL para o snippet virar outro documento.
- **Esperado**: escapar `&`, `<`, `"` no valor e validar o nome do atributo (`/^[A-Za-z][A-Za-z0-9-]*$/`) antes de emitir. É a mesma classe de defeito do V-003: o snippet é o entregável, precisa ser HTML correto para qualquer entrada.

#### W-003 — O snippet omite o `userToken` em silêncio e, quando o tem, embute um token de 60 min sem uma linha de aviso
- **Arquivo**: `web/src/components/ArrayComponent.tsx:64` (`entries.filter(([, v]) => v !== '')`)
- **Repro**: abra `/playground` numa sessão limpa (sem seed) → aba Credit Overview → copie o snippet.
- **Observado**: o snippet sai com `appKey` e os `*Link`, **sem `userToken` e sem nenhum comentário** dizendo que falta. Colado numa rede liberada, o componente não tem como buscar dados e o dev não sabe o que faltou. Com sessão, o oposto: sai `userToken="ED9A14BA-…"` **hardcoded**, sem dizer que expira em 60 minutos nem de onde ele deve vir no produto dele.
- **Esperado**: sempre emitir a linha `userToken="<TOKEN_DO_SEU_BACKEND>"` para os componentes de dados, com um comentário no snippet: quem emite (`POST /authenticate/v2/usertoken`, com o client token **no servidor**), qual o TTL e que o atributo deve ser injetado a cada render. Hoje o único artefato que o usuário leva para o produto dele ensina metade da integração.

#### W-004 — Relatório mostra saldo total de US$ 433 mil contra "limite total" de US$ 67 mil, e a utilização não fecha com nenhum par exibido
- **Arquivo**: `worker/src/array/mock.ts:207-213` (`totalLimit` = só o rotativo, `totalBalance` = todas as contas) exibidos juntos em `web/src/pages/CreditReport.tsx:195-205`
- **Repro**: crie um consumidor cujo `clientKey` gere hipoteca/financiamento (aconteceu em 4 de 8 usuários que criei) e peça o relatório. Exemplo real medido:
  `summary.totalBalance = 433419`, `summary.totalCreditLimit = 66777` (soma real dos limites: `922601`), `utilization = 26.3`.
- **Observado**: na mesma grade de tiles, "Saldo total US$ 433,419" e "Limite total (rotativo) US$ 66,777" — saldo 6,5× o limite — e "Utilização do rotativo 26.3%", que não é `433419/66777` (649%) nem `433419/922601` (47%). O rótulo "(rotativo)" avisa, mas nenhum dos números exibidos permite reconstruir a utilização.
- **Esperado**: exibir o par coerente (saldo rotativo / limite rotativo) e, se quiser mostrar o total, rotulá-lo separadamente. É o defeito do V-006 sobrevivendo em outra forma, na tela que é a demo da POC.

### P2

| ID | Defeito | Arquivo:linha | Observado vs esperado |
|---|---|---|---|
| W-005 | Empréstimo estudantil entra no filtro de "rotativo" | `worker/src/array/mock.ts:207` (exclui só `Mortgage` e `Auto Loan`) | No usuário demo, "Utilização do rotativo" = **75.1%** contando 4 `Student Loan`; só com os `Charge Card` a utilização é **64.4%**. Esperado: rotativo = `Credit Card`/`Charge Card`/`Revolving`. |
| W-006 | Idade da DOB por média de 365,25 dias contra `Date.now()` | `worker/src/index.ts:145-148` e `web/src/pages/Enrollment.tsx:29-31` | `2008-08-23` (18 anos exatos em 2026-08-23) dá `6574/365.25 = 17.9986` à meia-noite (→ **400**) e passa a 18.0008 no fim do dia (→ **200** medido às 18h50 UTC): o mesmo consumidor é aceito ou rejeitado conforme a hora. `1906-08-23` (120 anos exatos) → **400** (120.0021 > 120). Esperado: comparar aniversário no calendário (ano/mês/dia), não dividir milissegundos. |
| W-007 | TTL solicitado é ignorado em cache hit, sem sinal | `worker/src/index.ts:344-345` (chave sem `ttlInMinutes`) | `POST usertoken {"ttlInMinutes":1440}` depois de um de 60 → `200 {"ttlInMinutes":60,"cached":true}`: o chamador pediu 24 h e recebeu 1 h. Esperado: incluir o TTL na chave, ou emitir novo token quando o pedido for maior que o restante do cacheado. |
| W-008 | A margem de 60 s do cache é inócua para TTL curto | `worker/src/index.ts:332` (`Math.max(60, ttl*60 - 60)`) | Com `ttlInMinutes=1` o cache guarda por 60 s e o token vive 60 s → um token pode ser servido no segundo 59 e morrer no 60. Esperado: não cachear quando `ttl*60 <= margem`. |
| W-009 | `?refresh=true` parece não fazer nada em modo mock | `worker/src/array/mock.ts` (token determinístico por `clientKey`) | Antes: `ED9A14BA-…`; com `refresh=true`: `ED9A14BA-…` (só o `expiresAt` muda). O botão "Renovar userToken" do Playground não muda nada visível. Também: só a string exata `refresh=true` invalida — `refresh=1` e `refresh=TRUE` voltam `cached:true`. Esperado: token novo por emissão (ou dizer na UI que o mock é determinístico) e aceitar as grafias comuns do flag. |
| W-010 | `GET /array/report` aceita `clientKey` inexistente com 200 | `worker/src/index.ts` (handler do GET report) | `?reportKey=…&displayToken=…&clientKey=NAO-EXISTE` → **200** com o relatório completo, enquanto `alerts`, `monitoring`, `scoretracker` e `usertoken` devolvem 400 para o mesmo clientKey. Esperado: coerência do registro do mock (V-014) em todas as rotas. |
| W-011 | Histórico de score implausível: 712 → 681 → 712 | `worker/src/array/mock.ts:86-99` (último mês ancorado em `MOCK_BASE_SCORE`) | O gráfico do usuário demo mostra queda de 31 pontos ao longo de 11 meses e recuperação integral no último mês, sem nada no relatório que explique. Esperado: fazer a série convergir para o score canônico. |
| W-012 | Fator de pagamento "positivo" contra 2 contas em atraso na mesma tela | `worker/src/array/mock.ts:118-165` | `PAYMENT_HISTORY` = *positive/high* "95% dos pagamentos em dia" e `DEROGATORY` = "Nenhum registro negativo", enquanto o tile diz "Contas com atraso 2" e um tradeline exibe **seis marcas de 60 dias** seguidas. Esperado: derivar direção/texto também das marcas de atraso, não só de `collections`. |
| W-013 | Tabela de usuários do Dashboard sem paginação | `web/src/pages/Dashboard.tsx` (`GET /array/users`) | Depois dos testes deste ciclo a tela lista 14 usuários (inclusive os de fronteira de DOB) numa tabela única e sem limite; num D1 com centenas de seeds a tela fica inutilizável. Esperado: limite + "ver todos". |
| W-014 | Dois `GET /api/status` por visita ao Dashboard | `web/src/lib/session.tsx` + dedupe só de GETs concorrentes em `web/src/lib/api.ts:31-41` | Medido: `status, users, status`. As duas chamadas são sequenciais, então o dedupe (que só junta requisições em voo) não as colapsa. Sem impacto no Inspector (rota no `AUDIT_SKIP`), mas é o resíduo do V-008. |
| W-015 | Input do `appKey` no Playground ainda corta o valor | `web/src/styles.css:199-202` | A 1440px o input tem 270 px e o valor de 36 chars tem `scrollWidth > clientWidth`: o fim do UUID fica fora de vista. Esperado: `font-size` menor/`textarea`/`title` com o valor completo. |

---

## Verificado OK (além da tabela de regressão)

- **Snippet colável de verdade** — 5 componentes, HTML em branco, http-server local, Chromium:
  0 achados em 8 aferições por componente (`scripts/snippet-check.mjs`). A falha de rede do CDN é a
  única coisa que aparece no console, como esperado neste ambiente.
- **Guarda de parse do Inspector** — linha corrompida à mão no SQLite do D1 não derruba a página
  (238 linhas, banner limpo, `{"_unparseable":true,"raw":…}` só na linha ruim).
- **Registro do mock** — 400/404 coerentes para `clientKey`, `reportKey`, `displayToken` e
  `authToken` desconhecidos, com a mensagem útil chegando na UI (`ErrorBox` renderiza `upstream`),
  e o registro sobrevive ao restart do worker (reidratação do D1 comprovada num worker novo).
- **Mapeamento de erro de upstream** — `blocked → 502` com `hint`, em 0,26 s, sem retry inútil;
  nenhuma tela branca em modo sandbox.
- **Segredo** — worker em sandbox com `SMARTY_AUTH_TOKEN=SUPERSECRETTOKEN123`:
  `grep` no `/api/inspector?limit=200` → **0** ocorrências. SSN só como `ssn_last4`.
- **Dedupe de GETs** (`web/src/lib/api.ts:31-41`) — a entrada é removida no `finally`, então não há
  cache stale entre chamadas sequenciais; a rejeição compartilhada afeta apenas chamadas
  concorrentes idênticas (comportamento correto). Não encontrei race.
- **Suítes** — 42/42 vitest, 36/36 smoke HTTP, e2e sem achados, `typecheck` e `build` limpos,
  overflow mobile 7/7, console 0 erros.

---

## Olhar de produto: 10 minutos na POC como dev/PM avaliando a integração

**(a) Quais componentes existem — SIM.** 13 abas nomeadas, com descrição, atributos editáveis e
selo de confiabilidade (verificada / `// UNVERIFIED` / não documentado). É a melhor parte da POC:
em dois minutos ele sabe o que existe e o que a Array não documenta (Ads, disputas).

**(b) Como obter e passar o userToken — PARCIALMENTE, e é a maior lacuna.** Ele consegue *ver* um
token aparecer (KBA ou seed) e vê-lo entrar no atributo. O que a app **não** diz em lugar nenhum:
quem emite o token no produto dele (o backend dele, com o client token secreto), que ele expira
(o TTL só aparece como um `expiresAt` cru numa resposta JSON), que precisa ser reinjetado a cada
render, e que numa sessão sem token o snippet **sai sem o atributo** (W-003). Um dev que só copie o
snippet do Playground vai colar no produto dele um token de 60 minutos hardcoded.

**(c) O que o backend dele precisa implementar — NÃO, não a partir da app.** A informação existe,
mas só no README (tabela de rotas) e em `docs/ARRAY_API_RESEARCH.md`. Nenhuma tela responde
"quais endpoints **eu** preciso expor, na ordem, e o que fica no servidor". Falta o ativo mais
barato e mais valioso: uma tela (ou um bloco no Dashboard) com o encadeamento
`POST /user/v2 → GET+POST /authenticate/v2 → POST /authenticate/v2/usertoken → atributo userToken`,
marcando o que é servidor (client token) e o que é browser (appKey, userToken), com o `curl` de cada
passo. Hoje o Inspector mostra as chamadas *depois* de acontecerem, mas não prescreve nada.

**(d) O que ainda é incógnita — SIM, e com honestidade.** Os selos do Playground, os comentários
`// UNVERIFIED path` e as seções do README sobre paths inferidos, disputas e nomes `SMARTY_*`
deixam as lacunas explícitas. Esse é o ponto forte de pedagogia da POC.

**Lacunas concretas de pedagogia, em ordem de custo/benefício**
1. Não existe uma "página de integração" com o diagrama do fluxo de tokens e o que é
   servidor vs browser (c). Tudo está no README, que não é o que ele percorre.
2. O snippet não ensina a origem nem o ciclo de vida do `userToken` (W-003) — e é o único
   artefato que sai da POC para o código dele.
3. Nada mostra o **contrato de resposta** que o backend dele vai ter que consumir: o Inspector
   mostra o payload redigido de uma chamada já feita, mas não há um "exemplo de request/response por
   endpoint" navegável nem link entre uma linha do Inspector e a rota correspondente do README.
4. `array-event` é apresentado como "todos emitem um único evento", mas o painel só mostra o evento
   sintético do botão de teste — nenhum exemplo do formato real de `e.detail` por componente, que é
   o que ele precisa para desenhar os handlers.
5. Os erros que ele vai enfrentar de verdade (userToken expirado, displayToken vencido, KBA
   reprovada) não têm um botão que os provoque: só dá para vê-los digitando chave errada na mão.

---

## Top 5 do próximo ciclo
(ordenado pelo objetivo: **integrar os web components da Array ao produto do usuário**)

1. **W-001 — cache de userToken servindo token de mock em modo sandbox.** É a etapa exata que ele
   testa ao plugar as credenciais, e ela mente com 200 + `cached:true`. Namespaciar a chave por
   modo/appKey é uma linha; sem isso a POC valida o pipeline errado.
2. **W-003 + lacuna de pedagogia (b)/(c) — ensinar o ciclo de vida do userToken e o que o backend
   dele expõe.** Sempre emitir `userToken="<TOKEN_DO_SEU_BACKEND>"` com comentário de origem/TTL, e
   uma tela de integração com o encadeamento das 4 chamadas e a fronteira servidor/browser.
3. **W-002 — escapar valores e validar nomes de atributo no snippet.** O entregável central não
   pode virar HTML diferente (nem executar um `onload`) por causa de um `"` digitado.
4. **W-004 + W-005 (+W-011, W-012) — fechar a aritmética do relatório.** Saldo total contra limite
   só do rotativo, empréstimo estudantil contado como rotativo, score que cai 31 pontos e volta, e
   "nenhum registro negativo" ao lado de duas contas em atraso. É a tela usada como demo interna.
5. **W-006 + W-007/W-008 — fronteiras e semântica.** Idade calculada por calendário (hoje quem faz
   18 anos é aceito ou rejeitado conforme a hora do dia) e cache que respeite o TTL pedido.
