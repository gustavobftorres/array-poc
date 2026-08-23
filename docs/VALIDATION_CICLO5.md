# VALIDATE — Ciclo 5 (QA adversarial)

Commit sob teste: `2a091ea` ("feat: tela Guia de Integracao e cache de userToken isolado por modo").
Modo MOCK em `:8787` + web `:5173`; segundo worker SANDBOX em `:8788` e dois workers MOCK com
`appKey`/`ARRAY_ENV` diferentes em `:8790`/`:8791`/`:8792` compartilhando o **mesmo KV e D1 locais**.
Chromium 1194 via `PW_CHROMIUM` (ver `docs/QA.md`).

Ferramentas: as três suítes do repo (`smoke-api.sh`, `e2e-smoke.mjs`, `snippet-check.mjs`,
`regression-ciclo3.mjs`) **mais quatro scripts novos escritos para este ciclo**, para não aceitar a
palavra do DEV:

| Script novo | O que faz |
|---|---|
| `scripts/hostile-snippet-ciclo5.mjs` | 12 payloads no **valor** e 8 no **nome** do atributo; cola cada snippet num HTML em branco instrumentado com `window.__pwned`, abre no Chromium e afere execução, `on*` no DOM, deslocamento da árvore e HTML válido |
| `scripts/check-html.py` | parser independente do browser (`html.parser`): balanceamento de tags e self-closing em não-void |
| `scripts/report-arith-ciclo5.mjs` | recomputa **toda** a aritmética do relatório do JSON cru para N consumidores diferentes (12 nesta rodada) |
| `scripts/integration-audit-ciclo5.mjs` | audita `/integracao`: diagrama, 4 passos, curl/TS, botão Copiar, estado da sessão, tabela de erros e **fatos contra `docs/ARRAY_API_RESEARCH.md`** |
| `scripts/walkthrough-ciclo5.mjs` | 8 telas, console, requests ≥400, tema, reload no meio do fluxo, mobile 390px, screenshots `qa5-*` |

Suítes verdes nesta rodada: `worker test` **58/58** · `smoke-api.sh` **40/40** ·
`e2e-smoke.mjs` 0 achados · `snippet-check.mjs` 0 achados · `regression-ciclo3.mjs` 0 desvios ·
`hostile-snippet` 0 achados em 20 payloads · `walkthrough` 0 achados · `typecheck`/`build` limpos.

## Resumo

| Veredito | Qtd | IDs |
|---|---|---|
| CORRIGIDO | 18 | W-001 … W-015 + V-006, V-008, V-018 |
| PARCIAL | 0 | — |
| NÃO CORRIGIDO | 0 | — |
| REGREDIU | 0 | — |

Defeitos novos: **0 P0 · 4 P1 · 5 P2 · 3 P3**. Os quatro P1 estão **todos na tela nova
`/integracao`** ou na aritmética do relatório — nenhum no backend, no cache ou no snippet.

---

## Regressão dos 15 W-* e dos 3 PARCIAIS

| ID | Veredito | Evidência própria |
|---|---|---|
| **W-001** token de mock servido em sandbox | **CORRIGIDO** | Cenário exato reproduzido: `POST /api/array/usertoken` no `:8787` (mock) grava `usertoken:v2:mock\|no-appkey\|https://sandbox.array.io/api\|60\|FF9CDBA5-…`; a **mesma** requisição no `:8788` (sandbox, mesmo KV/D1) volta **502 `kind:"blocked"`** — nunca mais `200 cached:true`. Volta (sandbox→mock) é impossível por construção: as chaves são disjuntas (listei o KV). Troca de **appKey**: `:8790` (appKey `AAAA…`) e `:8791` (`BBBB…`) emitiram tokens próprios (`cached` ausente) e criaram entradas separadas. Troca de **baseUrl**: `:8792` (`ARRAY_ENV=production`) criou `…\|https://array.io/api\|…`. **Entrada de versão antiga**: a chave v1 `usertoken:<clientKey>` do ciclo 3 continua no KV e **é ignorada** (prefixo v2). Poisoning manual do KV: escopo divergente → recusado; `expiresAt` no passado → recusado; `ttlInMinutes` divergente no valor → recusado. Resíduo: valor **sem** campo `scope` é aceito (X-008). |
| **W-002** snippet sem escape de valor/nome | **CORRIGIDO** | 20 payloads próprios (`" onload=`, `--><script>`, `</script><script>`, `"><img onerror=`, aspas simples, backtick+espaço, sem aspas, `javascript:`, unicode/RTL, entidades, newline, 5 KB) colados em HTML em branco: `window.__pwned === false` em **20/20**, 0 dialogs, 0 atributos `on*` no DOM, 0 `<script>` injetado, `#after` sempre filho direto de `<body>`, `check-html.py` "HTML OK" em 20/20. Nomes inválidos (com espaço, iniciando por dígito, com `"`/`>`/`/`, 3 KB, unicode RTL) são recusados na UI com mensagem. Resíduo: o nome `onload` é um nome HTML **legal** e passa (X-007). |
| **W-003** snippet omite/embute userToken sem aviso | **CORRIGIDO** | Com sessão: `userToken="C4AE161F-…"` + 3 comentários (quem emite — `POST /authenticate/v2/usertoken` via `POST /api/array/usertoken`; que o client token é segredo de servidor; TTL de ~60 min com `expiresAt`; reinjeção por render). Sem sessão: a linha **continua saindo**, com placeholder e a frase "sem token o componente não busca dados". Nit em X-010. |
| **W-004** saldo total × limite só do rotativo | **CORRIGIDO** | `summary` agora traz o par `revolvingBalance`/`revolvingLimit` e a tela imprime a conta: "utilização do rotativo = US$ 12,881 ÷ US$ 20,015 = **64.4%**". Recomputei do JSON cru em **12 relatórios** diferentes: `utilization == round1(rb/rl*100)` em 12/12, `totalBalance == revolvingBalance + installmentBalance` em 12/12, `totalCreditLimit` não existe mais. |
| **W-005** empréstimo estudantil como rotativo | **CORRIGIDO** | `isRevolvingType` = `Credit Card`/`Charge Card`/`Revolving`; em 12/12 relatórios nenhuma conta `*Loan`/`Mortgage` entrou no rotativo; `Student Loan` aparece em `installmentBalance` e o tile diz "Saldo parcelado (hipoteca/auto/estudantil)". |
| **W-006** idade por 365,25 dias | **CORRIGIDO** | 19 datas contra `POST /api/array/user` em 2026-08-23: `2008-08-23` (18 hoje) → **200**; `2008-08-24` → 400; `2008-08-31` → 400; `2008-07-31` → 200; `1906-08-23` (120 hoje) → **200**; `1905-08-23` → 400; `2008-02-29` (bissexto) → 200; `2007-02-29`/`1900-02-29`/`2023-02-30`/`2024-13-45`/`0000-01-01` → 400 "real calendar date"; `2026-08-24` → 400 "future"; `2008-8-23` → 400 formato. Independe da hora do dia. O cliente espelha (`calendarAge` em `Enrollment.tsx`). |
| **W-007** TTL ignorado em cache hit | **CORRIGIDO** | `60` → cached; `1440` → token **novo** com `ttlInMinutes:1440`; volta a `60` → o token de 60 min. Chave inclui o TTL (visto no KV). |
| **W-008** margem de 60 s inócua | **CORRIGIDO** | `ttlInMinutes:1` nunca é cacheado (duas chamadas seguidas → dois tokens, `cached` ausente); `5` idem no primeiro uso e passa a servir do cache dentro da janela útil. |
| **W-009** `?refresh` sem efeito / só `true` | **CORRIGIDO** | `true`,`1`,`yes`,`on`,`TRUE`,`On` → token novo a cada chamada; `0`,`false`,`bogus` → `cached:true`. Em mock cada emissão devolve valor diferente. |
| **W-010** GET report com clientKey inexistente | **CORRIGIDO** | clientKey de **outro** usuário → 400 "this reportKey does not belong to the given clientKey"; inexistente → 400; `displayToken` errado → 400; `reportKey` inexistente → 404; coerente → 200. (Omitir `clientKey` continua 200, por design: o parâmetro é opcional.) |
| **W-011** score 712→681→712 | **CORRIGIDO** | 12/12 históricos terminam exatamente no score canônico e sobem monotonicamente (ex.: 695→712), maior degrau medido ≤ 4 pontos. |
| **W-012** fator positivo com 2 contas em atraso | **CORRIGIDO** | `PAYMENT_HISTORY` = *negative/high* "95% dos pagamentos em dia …, mas 9 marcas de atraso em 2 contas (pior marca: 60 dias)"; `DEROGATORY` = *negative* "2 contas com atraso"; a seção Cobranças diz "isso não quer dizer ficha limpa — 2 conta(s) têm marcas de atraso". 12/12 sem contradição fator×atraso. |
| **W-013** tabela de usuários sem paginação | **CORRIGIDO** | Com **34** usuários no D1 a tela mostra 10 + "Ver todos (34)" + a linha "Mostrando os 10 mais recentes de 34". (A API ainda devolve tudo — X-013, P3.) |
| **W-014** dois `GET /api/status` por visita | **CORRIGIDO** | Medido: `["GET /api/array/users","GET /api/status"]` — **1** status por visita. Micro-cache de 2 s **não** memoiza erro: com `/status` forçado a 500 aparece o banner "WORKER OFFLINE" e "Tentar de novo" refaz a chamada na hora; e cada reload de página zera o memo (nenhum risco de stale além dos 2 s dentro da mesma SPA). |
| **W-015** input do appKey cortava o valor | **CORRIGIDO** | 269,9 px de input para 36 chars: `scrollWidth == clientWidth == 268` e `title` com o valor completo. |
| **V-006** fixtures contraditórias | **CORRIGIDO** | Aritmética fecha em 12/12 (ver W-004/W-005/W-011/W-012). Sobram duas contradições **novas** de outra natureza: X-004 (janela de 6 meses das consultas) e X-005 (idade da conta mais antiga). |
| **V-008** 5 chamadas por visita ao Dashboard | **CORRIGIDO** | 2 chamadas por visita (`users` + `status`), 1 delas auditada; Inspector sem poluição (`AUDIT_SKIP`). |
| **V-018** input de atributo estreito | **CORRIGIDO** | Ver W-015. |

---

## Defeitos novos

### P1

#### X-001 — Os `curl` dos passos 1–3 do Guia **não são coláveis**: o comentário "# SEGREDO" está dentro do valor do header
- **Arquivo**: `web/src/pages/Integration.tsx:43` (`CLIENT_TOKEN_NOTE`) usado em `:62`, `:106`, `:112`, `:150`
- **Repro**: `/integracao` → passo 1 → "Copiar" → colar no shell. Aferi com um servidor TCP local:
  ```
  x-credmo-client-token: $ARRAY_CLIENT_TOKEN   # SEGREDO: só no servidor
  ```
- **Observado**: o header viaja com o comentário **dentro do valor** e com `$ARRAY_CLIENT_TOKEN`
  literal (está entre aspas **simples**, o shell não expande). Contra a Array real isso é um
  401/400 de credencial — e o dev vai desconfiar da chave, não do snippet.
- **Esperado**: `-H "x-credmo-client-token: $ARRAY_CLIENT_TOKEN"` (aspas duplas) e o aviso de
  segredo **fora** do `-H`, como linha `#` própria. Mesmo tratamento para `$CLIENT_KEY`/`$AUTH_TOKEN`
  nos `-d '…'` dos passos 2 e 3.

#### X-002 — Os bodies do Guia (curl **e** TypeScript) omitem `appKey`, contra a pesquisa e contra o próprio cliente da POC
- **Arquivo**: `web/src/pages/Integration.tsx:63-69` (`/user/v2`), `:110-113` (`/authenticate/v2`), `:148-151` (`/usertoken`) e os TS em `:79`, `:125`, `:167`
- **Repro**: comparar com `docs/ARRAY_API_RESEARCH.md` §3.1/§3.3/§3.4 (`appKey` é propriedade
  **verificada** do body nas três) e com `worker/src/array/client.ts:164,205,224`, que **envia**
  `appKey` no body das três chamadas.
- **Observado**: o guia ensina `-d '{ "clientKey": …, "ttlInMinutes": 60 }'`. O usuário que copiar
  isso monta um backend que a Array rejeita — e o guia contradiz o código da própria POC (que está
  certo). Um guia de integração errado é pior que nenhum.
- **Esperado**: `appKey` no body dos três passos (curl e TS), como o `ArrayClient` faz.

#### X-003 — O Guia termina no passo 4 e nunca menciona pedir/buscar o relatório (`/report/v2`)
- **Arquivo**: `web/src/pages/Integration.tsx:45-221` (só 4 passos)
- **Repro**: buscar `report/v2` no texto de `/integracao` → 0 ocorrências (o script de auditoria
  afere isso).
- **Observado**: falta o trecho que a própria POC exercita e que a `docs/ARRAY_API_RESEARCH.md`
  §3.5/§3.6 documenta como parte do caminho canônico: `POST /report/v2` → `reportKey` +
  `displayToken` → `GET /report/v2` (com o detalhe operacional de que o relatório pode voltar vazio
  por alguns segundos e a integração de referência **repete a cada 3 s**) e `PUT /report/v2` para
  renovar o `displayToken`. Pior: o card "O que NUNCA vai ao browser" fala do `displayToken` e o
  Playground oferece o **modo manual** (`productCode`+`reportKey`+`displayToken`) sem que nenhum
  passo diga de onde esses valores vêm.
- **Esperado**: passos 5 e 6 (pedir e buscar o relatório, com o retry e o `PUT` de renovação), ou ao
  menos um bloco "depois do passo 4" com as duas rotas e o `curl` correspondente.

#### X-004 — "Consultas hard (6 meses)" conta consultas de mais de 6 meses — contradiz a tabela de consultas na mesma tela
- **Arquivo**: `worker/src/array/mock.ts:277` (`inquiries.filter(i => i.type === 'Hard').length`, sem
  filtro de data) contra `:259` (datas geradas com `monthsBack(1..6)`)
- **Repro**: consumidor `BA0B41A3-…` (`node scripts/report-arith-ciclo5.mjs 12` acha 2 em 12):
  consultas `2026-02-10` e `2026-02-11`, ambas *Hard*, com "hoje" = 2026-08-23.
- **Observado**: tile "Consultas hard (6 meses) **2**" e fator `INQUIRIES` "2 consultas hard nos
  últimos 6 meses" ao lado de uma tabela que mostra as duas datadas de **6 meses e 13 dias atrás**.
  É exatamente o par contraditório que o W-004 fechou, reaparecendo em outra dobra.
- **Esperado**: contar `type === 'Hard' && date >= hoje-6meses` (e/ou gerar as datas dentro da
  janela). O rótulo e o dado precisam fechar em qualquer clientKey.

### P2

| ID | Defeito | Arquivo:linha | Observado vs esperado |
|---|---|---|---|
| X-005 | `oldestAccountYears` por subtração de ano, não por calendário | `worker/src/array/mock.ts:278-281` | Conta aberta em `2012-12-01` → tile "Conta mais antiga **14 anos**" e fator "Conta mais antiga com 14 anos" em 2026-08-23 (real: 13); `2016-11-01` → 10 (real: 9). 2 em 12 relatórios. É a classe do W-006 sobrevivendo: o DEV corrigiu a DOB e deixou o relatório. Esperado: reusar a lógica de `calendarAge`. |
| X-006 | O "estado da sessão" do Guia não distingue os passos | `web/src/pages/Integration.tsx:302-320` | `kba.done` e `usertoken.done` são **os dois** `!!session.userToken`: depois de "Semear usuário demo" (que emite o token direto, sem KBA) o passo 2 diz "feito nesta sessão" sem que nenhuma pergunta tenha sido respondida, e o passo 3 diz "feito" sem nenhum `POST /api/array/usertoken` do browser. O passo 4 fica "feito" e o contador vai a **4/4** mesmo com o CDN bloqueado e nenhum componente renderizado. Esperado: derivar cada passo do evento correspondente (authToken vindo do KBA, chamada de usertoken registrada, componente efetivamente montado) — a tela se vende como "estado real". |
| X-007 | Nome de atributo `on*` é HTML legal e o snippet emite o handler | `web/src/components/ArrayComponent.tsx:61` (`ATTR_NAME_RE`) | Medido: "+ atributo" → `onload`, valor `window.__pwned=1;alert(9)` → o snippet sai com `onload="window.__pwned=1;alert(9)"` — handler inline executável no HTML que o dev vai colar. A metade "valor" do W-002 está fechada; a metade "nome" não. Esperado: rejeitar (ou avisar sobre) nomes `on*` e `style`/`srcdoc`, já que o snippet é o entregável. |
| X-008 | A guarda de escopo do cache é opcional no valor | `worker/src/index.ts:400` (`if (hit.scope && hit.scope !== …)`) | Gravei à mão no KV uma entrada v2 **sem** campo `scope` e ela foi servida em modo mock: `200 {"userToken":"POISONED-B","cached":true}`. Com escopo divergente, `expiresAt` vencido ou `ttl` divergente a recusa funciona. Esperado: tratar `scope` ausente como miss (`hit.scope !== scope` sem o `&&`), senão a defesa do W-001 depende do valor gravado e não da leitura. |
| X-009 | O Guia apresenta inferências com a mesma confiança dos fatos verificados | `web/src/pages/Integration.tsx:152`, `:169`, `:105`, `:143` | Afirma `expiresAt` como campo da resposta da Array (a pesquisa só documenta `appKey`/`clientKey`/token/`ttlInMinutes` — `expiresAt` é invenção desta POC), "ttlInMinutes (1 a 1440)" como se fosse a faixa da Array (é o clamp do worker), e `GET /authenticate/v2?clientKey=` como se o parâmetro fosse verificado. E não cita `x-credmo-user-token` (§2/§3.5, a alternativa a chamar do servidor) nem webhooks (§3.10). Esperado: os mesmos selos do Playground (verificado / inferido) — é o diferencial pedagógico da POC e a tela nova é a única sem eles. |

### P3

| ID | Defeito | Arquivo:linha | Observado vs esperado |
|---|---|---|---|
| X-010 | Placeholder do userToken sai escapado e não casa com o comentário | `web/src/components/ArrayComponent.tsx:50,136` + `:156` | O atributo sai `userToken="&lt;TOKEN_DO_SEU_BACKEND&gt;"` e o comentário diz `TOKEN_DO_SEU_BACKEND` (sem `<>`, removidos por `escapeComment`): busca-e-substitui do dev não casa nem com um nem com o outro. Esperado: placeholder sem `<>` (ex.: `SEU_USER_TOKEN_AQUI`). |
| X-011 | Escopo do cache não inclui o client token | `worker/src/index.ts:359-361` | Rotacionar/revogar o `SMARTY_AUTH_TOKEN` mantendo o mesmo `appKey` continua servindo os userTokens já cacheados. Esperado: incluir um hash do client token no escopo. |
| X-012 | Chaves de versões antigas ficam no KV até expirar | `worker/src/index.ts:341` | A entrada `usertoken:<clientKey>` do ciclo 3 ainda está no KV local (inofensiva — o prefixo v2 a ignora), mas polui a inspeção e nada a limpa. Esperado: varredura de prefixos antigos no boot ou nota no QA. |
| X-013 | `GET /api/array/users` continua devolvendo todos os usuários | `worker/src/index.ts` (`db.listUsers(env.DB, 200)`) | A paginação do W-013 é só de UI: com 34 usuários o payload traz 34 (limite duro 200). Esperado: `limit`/`offset` na rota. |

---

## Verificado OK (além da regressão)

- **Isolamento do cache de userToken por escopo** — 4 workers simultâneos sobre o mesmo KV
  (mock, sandbox, mock+appKey A, mock+appKey B, mock+prod baseUrl) produziram 5 entradas disjuntas;
  nenhuma leitura cruzada. Poisoning por escopo/validade/TTL recusado (exceto X-008).
- **Segredo e PII** — `grep` em `/api/inspector?limit=200` (628 chamadas): 0 ocorrências de
  `SUPERSECRETTOKEN123`, 0 de `x-credmo-client-token`, 0 de SSN de 9 dígitos, 0 do appKey de sandbox.
- **Snippets TypeScript do Guia compilam** — extraí os 4 blocos e rodei `tsc --strict`
  (`--target es2022 --lib es2022,dom`) com apenas declarações ambientes para os *helpers*
  ilustrativos (`db`, `sessao`, `arrayGet`, `app`, `process`): **0 erros**.
- **Diagrama servidor×browser correto** contra `docs/ARRAY_API_RESEARCH.md` §2/§3: as três chamadas
  de servidor com o client token, o `userToken` como única coisa que atravessa, o `appKey` público no
  browser, o client token marcado "nunca cruza a fronteira" (`docs/screenshots/qa5-integracao-diagrama.png`).
- **Botão Copiar** de cada passo entrega exatamente o texto exibido (clipboard lido no Chromium),
  nas duas linguagens, nos 4 passos.
- **Tabela de erros** com 6 linhas úteis e acionáveis (token expirado, appKey ≠ 36, self-closing,
  KBA reprovada, clientKey de outro ambiente, cache sem escopo) — cada uma aponta se resolve no
  servidor ou no browser.
- **8 telas** com console limpo (0 erros/warnings), 0 respostas ≥400 fora do CDN bloqueado, tema
  alternando, KBA e relatório sobrevivendo a `F5` no meio do fluxo, mobile 390 px sem overflow em
  8/8 (screenshots `docs/screenshots/qa5-*.png`).
- **Micro-cache do `/status`** — erro **não** é cacheado (banner "WORKER OFFLINE" + "Tentar de novo"
  refaz na hora); o memo morre a cada reload; janela de 2 s só colapsa o duplo mount do StrictMode.
- **Fronteiras da DOB** — 19 casos, incluindo 18 anos hoje, 120 anos hoje, 29/02 bissexto e
  não-bissexto, fim de mês e formatos inválidos.

---

## Olhar de produto: 10 minutos como dev/PM decidindo a integração

`/integracao` é a melhor coisa que este ciclo produziu e resolve as lacunas (b) e (c) do ciclo 3:
em uma tela o avaliador vê a fronteira do segredo, a ordem das chamadas, o que o **backend dele**
precisa expor, o estado real da sua sessão e os erros que vai encontrar. O diagrama está correto e
os TS compilam. O problema é que **os artefatos coláveis dessa tela têm erro factual**: nenhum dos
três `curl` de servidor funciona como está (X-001) e os três bodies omitem `appKey` (X-002) —
enquanto o `ArrayClient` da própria POC acerta. Somado a isso, o guia **para antes** de pedir o
relatório (X-003), que é justamente o que as telas Credit Report e o modo manual do Playground
usam, e é a única tela da POC sem os selos de confiança que dão credibilidade ao resto (X-009).
São quatro correções de texto num único arquivo; sem elas, a tela mais valiosa é também a que mais
pode custar tempo ao usuário.

## Veredito de prontidão

**Sim, dá para entregar como POC de avaliação.** Um avaliador que rode `npm run dev` hoje conclui,
com razão, que a POC cobre o fluxo Array de ponta a ponta em fixtures determinísticas, que a
fronteira do segredo está desenhada e implementada (client token só no worker, SSN só `ssn_last4`,
Inspector redigido), que os caminhos de erro são reais (400/404/502 com dica, nunca tela branca) e
que a POC é honesta sobre o que é inferência. O único gargalo que sobra **não** é o CDN/API
bloqueados: esse risco está contido — o worker envia `appKey` no body e `x-credmo-client-token` no
header nas rotas certas, mapeia bloqueio/timeout para 502/504 e o cache já é isolado por
modo/appKey/baseUrl, então na máquina do usuário basta preencher `worker/.dev.vars` e reiniciar,
sem retrabalho de código (o que ninguém pode validar daqui são os **paths inferidos** de
alerts/monitoring/scoretracker e o envelope exato dos bodies — estão marcados `// UNVERIFIED`).
O gargalo real é o **conteúdo prescritivo do Guia de Integração**: é o artefato que sai da POC para
o código do usuário e hoje ele erra o `curl` e o body. Corrigido isso, a POC entrega o que promete.

## Top 5 do próximo ciclo

1. **X-002 + X-001 — consertar os artefatos coláveis do Guia.** `appKey` no body dos 3 passos e o
   header do client token sem comentário embutido, com aspas duplas. É texto num arquivo e é o que
   o usuário leva para o produto dele.
2. **X-003 — fechar o fluxo no Guia: `POST /report/v2` → `GET /report/v2` (+ retry de 3 s) e
   `PUT /report/v2`.** Sem isso o `displayToken` citado no card de segurança e o modo manual do
   Playground ficam sem origem.
3. **X-004 + X-005 — fechar as duas contradições que sobraram no relatório**: janela de 6 meses das
   consultas hard e idade da conta mais antiga por calendário (reusar `calendarAge`).
4. **X-006 — estado por passo de verdade em `/integracao`** (KBA ≠ userToken ≠ componente montado);
   hoje uma sessão semeada exibe 4/4 com o CDN bloqueado.
5. **X-007 + X-008 — fechar as duas metades que faltaram das correções anteriores**: recusar nomes
   de atributo `on*` no snippet e tratar `scope` ausente como miss no cache de userToken.
