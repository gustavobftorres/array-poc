# VALIDATE — Ciclo 7 (QA adversarial)

Commit sob teste: `5125690` ("fix: Guia de Integracao com artefatos coláveis e fluxo de relatorio completo").
Modo MOCK, worker `:8787` + web `:5173`, Chromium 1194 via `PW_CHROMIUM` (ver `docs/QA.md`).

Não aceitei a palavra do DEV: além das cinco suítes do repo (`worker test`, `smoke-api.sh`,
`e2e-smoke.mjs`, `snippet-check.mjs`, `regression-ciclo3.mjs`, `guide-check-ciclo6.mjs`), escrevi
**cinco scripts novos e independentes** para este ciclo:

| Script novo | O que faz de diferente |
|---|---|
| `scripts/verify-guide-ciclo7.mjs` + `scripts/fake-array-ciclo7.mjs` | sobe um **servidor Array FALSO** (`127.0.0.1:8899`) que implementa `/api/user/v2`, `/api/authenticate/v2[/usertoken]` e `/api/report/v2` e **valida como a Array validaria**: 401 se o `x-credmo-client-token` não for byte-a-byte o segredo, `Validation failed` se faltar `appKey`. Extrai os 6 `curl` e os 6 TS **da tela renderizada**, roda `bash -n`, **executa** cada curl (só o host reescrito) e compila cada TS com `tsc --strict` |
| `scripts/kv-poison-ciclo7.mjs` | envenena o **blob** de entradas legítimas do KV (inserir linha nova no sqlite não é visto pelo namespace já aberto) em 11 variantes, com **caso de controle** para provar que o cache está vivo |
| `scripts/hostile-attrname-ciclo7.mjs` | 19 nomes de atributo hostis pelo `prompt` da UI; cola cada snippet resultante num HTML em branco instrumentado com `window.__pwned` e afere execução, `on*` no DOM, deslocamento da árvore e dialogs |
| `scripts/step-state-ciclo7.mjs` | os 6 estados de passo do Guia em **6 cenários** com `localStorage` limpo, incluindo **componente realmente montado** (CDN da Array stubado por interceptação de rota) e a checagem de "evento preso em verdadeiro" |
| `scripts/report-audit-ciclo7.mjs` | cria N consumidores novos, pede/busca o relatório e recomputa **tudo** do JSON cru (rotativo, utilização, janela de 6 meses das consultas, idade por calendário, histórico, fator×atraso) |
| `scripts/walkthrough-ciclo7.mjs` | 9 telas (8 rotas + rota inexistente) em desktop e mobile 390px, console, respostas ≥400, tema, F5 no meio do fluxo, coerência da contagem de usuários |

Suítes nesta rodada: `worker test` **62/62** · `smoke-api.sh` **42/42** · `e2e-smoke` 0 achados ·
`snippet-check` 0 achados · `regression-ciclo3` 0 desvios · `guide-check-ciclo6` 0 achados ·
`typecheck`/`build` limpos. Scripts próprios: `verify-guide` **0**, `kv-poison` **0**,
`report-audit` **0** em 16 relatórios, `step-state` **1**, `hostile-attrname` **5** (todos inertes,
ver Y-004), `walkthrough` **1**.

## Resumo da regressão

| Veredito | Qtd | IDs |
|---|---|---|
| CORRIGIDO | 12 | X-001, X-002, X-003, X-004, X-005, X-007, X-008, X-009, X-010, X-011, X-012, X-013 |
| PARCIAL | 1 | X-006 (o falso 4/4 morreu; o passo 5 ainda é inferido de chave presente, não de evento) |
| NÃO CORRIGIDO | 0 | — |
| REGREDIU | 0 | — |

Defeitos novos: **0 P0 · 0 P1 · 3 P2 · 4 P3**.

---

## Regressão dos 13 X-*

| ID | Veredito | Evidência própria |
|---|---|---|
| **X-001** comentário dentro do valor do header | **CORRIGIDO** | Os 5 curl de servidor da tela executados contra a Array falsa: **16 requisições**, e em todas as que levam credencial o header chegou `ct=OK` (igualdade byte-a-byte com o segredo). O aviso de segredo virou bloco `# 0) …` no topo; o header é `-H "x-credmo-client-token: $ARRAY_CLIENT_TOKEN"` com aspas **duplas** (expandiu). `bash -n` limpo em 5/5, nenhum `$VAR` literal em nenhum corpo. |
| **X-002** bodies sem `appKey` | **CORRIGIDO** | A Array falsa recusa (`Validation failed`) qualquer corpo sem `appKey`: **nenhuma** requisição foi recusada. Corpos por heredoc, JSON válido em 100% (`POST /user/v2`, `POST /authenticate/v2`, `POST /authenticate/v2/usertoken`, `POST /report/v2`), `appKey` expandido para o valor do ambiente; o `GET /authenticate/v2` leva `appKey` na query. Os 6 snippets TypeScript compilam com `tsc --strict` (`--target es2022 --lib es2022,dom`, só declarações ambientes para `db`/`sessao`/`arrayGet`/…): **0 erros**. O curl extra do passo 3 contra `localhost:8787` devolveu `userToken` de verdade. |
| **X-003** guia parava no passo 4 | **CORRIGIDO** | Passos 5 (`POST /report/v2` → `reportKey`+`displayToken`) e 6 (`GET /report/v2` com retry de 3 s + `PUT /report/v2` para renovar) existem, executam e batem com `ARRAY_API_RESEARCH.md` §3.5/§3.6: corpo `clientKey`+`productCode`, resposta `{reportKey, displayToken}`, retry de 3000 ms "como a integração de referência", `PUT` com `{clientKey, reportKey}` + client token — **o `PUT` está no passo certo** (renovação de leitura, não novo pedido) e o texto diz explicitamente "sem pedir outro relatório (nem gastar outro produto)". O card de segurança e o modo manual do Playground agora têm origem declarada. Ressalvas em Y-002 (o retry engole erro) e Y-003 (heurística de "vazio"). |
| **X-004** consultas hard fora da janela | **CORRIGIDO** | 16 relatórios recomputados: `inquiries6mo == count(type==='Hard' && date >= hoje-6meses)` em 16/16, e o fator `INQUIRIES` sempre com o mesmo número do tile. Zero consultas na janela deixa de ser fator "negativo". Efeito colateral em Y-005 (agora existe o par inverso: tabela com 4 Hard e tile "0"). |
| **X-005** idade da conta por subtração de ano | **CORRIGIDO** | `oldestAccountYears == max(1, calendarAge(menor opened))` em 16/16, com a **mesma** função da validação de DOB (`worker/src/dates.ts`), e o fator `CREDIT_AGE` repetindo o número do summary. |
| **X-006** estado por passo do Guia | **PARCIAL** | Os 6 cenários, cada um em contexto novo: limpa **0/6**; semeada **2/6 [1,5]** com o motivo certo em cada pendência ("o userToken saiu direto do /api/seed, sem KBA"); enrollment manual **1/6 [1]**; KBA real respondida na tela **2/6 [1,2]**; "Renovar userToken" no browser **3/6 [1,3,5]**; componente **realmente montado** (CDN stubado) **1/6 [4]** — o falso 4/4 do ciclo 5 morreu e o passo 4 só acende com `onMounted`. Sobra que o passo 5 é derivado de `reportKey && displayToken` (chave presente) e não do evento `reportOrderedAt`, que o código **grava e não usa**: pela régua do passo 3, uma sessão semeada deveria dizer "o relatório foi pedido pelo /api/seed" em vez de contar o passo. Ver Y-001. |
| **X-007** nome de atributo `on*` | **CORRIGIDO** | 19 nomes hostis pelo `prompt`: `onload`, `onLoad`, `ONLOAD`, `oNlOaD`, `onload ` (espaço no fim), ` onload` (espaço no início), `on`, `onclick`, `onerror`, `style`, `srcdoc` → **recusados na UI** com a mensagem "é executável no HTML colado"; os homoglifos cirílicos (`оnload`, `onlоad`) caem antes, no nome inválido. Colei os 19 snippets em HTML em branco: `window.__pwned` falso em 19/19, 0 dialogs, 0 atributos `on*`/`style`/`srcdoc` no DOM, `#after` sempre filho de `<body>`. |
| **X-008** `scope` ausente aceito no cache | **CORRIGIDO** | Envenenamento do blob de entradas legítimas, com controle: valor íntegro (só o token trocado) **é servido** (`cached:true`, `POISONED-61`) — logo o cache está vivo; e são recusados: sem `scope`, `scope:null`, `scope` de outro modo, `scope` de outro appKey, prefixo/sufixo do escopo, `expiresAt` vencido, `expiresAt` dentro da margem de 60 s e `ttl` divergente. 10/10 recusas com reemissão de token novo. |
| **X-009** selos no Guia | **CORRIGIDO** | Os 6 passos têm selo próprio e lista "o que é fato e o que é inferência" com `verificado`/`// UNVERIFIED` por afirmação. Auditei as 24 afirmações contra a pesquisa: `expiresAt` marcado como campo **desta POC** (§3.4 só documenta `ttlInMinutes`) ✓; `1–1440` marcado como clamp do worker ✓; `clientKey` na query do `GET /authenticate/v2` marcado inferido ✓; `appKey` no corpo do `/report/v2` marcado inferido ✓; `x-credmo-user-token` (§2/§3.5) e webhooks (§3.10) agora citados ✓. Nenhum erro factual com selo "verificado" — as duas afirmações sem selo estão em Y-003. |
| **X-010** placeholder do userToken | **CORRIGIDO** | `USER_TOKEN_PLACEHOLDER = 'SEU_USER_TOKEN_AQUI'` (sem `<>`): o atributo sai `userToken="SEU_USER_TOKEN_AQUI"` e o comentário cita a **mesma** string, então busca-e-substitui casa. Idem `SEU_APP_KEY_36_CHARS`. |
| **X-011** client token fora do escopo do cache | **CORRIGIDO** | O escopo é `mock\|no-appkey\|https://sandbox.array.io/api\|ct00001505` — o segmento `ct…` é um fingerprint de 32 bits (djb2) e **o token não aparece na chave**. Entrada com `ct` de outro token é recusada (caso "client token rotacionado"). `grep` em `/api/inspector?limit=200`: 0 ocorrências de `x-credmo-client-token`, 0 de `SUPERSECRETTOKEN123`, 0 de SSN de 9 dígitos. |
| **X-012** chaves antigas no KV | **CORRIGIDO (como documentação)** | As chaves do ciclo 3 (`usertoken:<clientKey>`) e as do ciclo 5 (sem `ct…`) continuam no KV local e continuam **inertes** (listei as 9 chaves; a leitura atual não as alcança). O que o ciclo 7 fez foi documentar em `docs/QA.md` como listar/limpar — era exatamente o "ou nota no QA" do esperado. |
| **X-013** `/api/array/users` sem paginação | **CORRIGIDO na rota, com efeito colateral na UI** | A rota aceita `limit`/`offset` e devolve `{users, total, limit, offset}`: `limit=5`→5, `limit=999999`→200 (teto), `limit=-1`→1, `limit=abc`→50 (default), `offset=999999`→0 linhas com `total` correto. Mas a UI não passa nem lê nada disso — ver Y-006 (com 57 usuários a tela anuncia 50). |

---

## Defeitos novos

### P2

#### Y-001 — O passo 5 do Guia conta como "evento real" a simples presença de `reportKey`, com a régua oposta à do passo 3
- **Arquivo**: `web/src/pages/Integration.tsx:610-613` (`'order-report': { done: !!(session.reportKey && session.displayToken) }`); o evento existe e é ignorado: `web/src/lib/session.tsx:27` (`reportOrderedAt`), gravado em `web/src/pages/Dashboard.tsx:42` e `web/src/pages/CreditReport.tsx:102`.
- **Repro**: contexto novo → "Semear usuário demo" → `/integracao`.
- **Observado**: **2/6**, com o passo 5 "feito nesta sessão · reportKey … · displayToken …". O passo 3, na mesma tela e na mesma sessão, recusa contar e explica: "existe userToken na sessão, mas ele veio do /api/seed (servidor), não desta rota". O passo 5 foi pedido pelo mesmo `/api/seed`.
- **Esperado**: `done: !!session.reportOrderedAt` (campo já gravado) e, na sessão semeada, o mesmo tipo de `why` do passo 3. Enquanto o contador se vende como "passos com evento real", ele conta um passo por dedução.

#### Y-002 — O retry do passo 6 (versão `curl`) trata erro de credencial como "relatório vazio" e insiste 30 s em silêncio
- **Arquivo**: `web/src/pages/Integration.tsx:452-464` (laço `for tentativa in 1 … 10` + `grep -q '"reportKey"'`)
- **Repro**: aponte o snippet para um servidor que responda `401 {"message":"Unauthorized"}` (foi o que a minha Array falsa fez no `GET /report/v2`, que corretamente não leva client token): **10 requisições**, 10× `vazio na tentativa N — esperando 3 s`, 30 s de espera e **nada** impresso do corpo do erro.
- **Observado**: o snippet TypeScript do mesmo passo faz o certo (`if (res.status === 401 || res.status === 403) throw new DisplayTokenExpirado()`), o `curl` não. O dev que copiar a versão shell vai debugar "relatório demorado" quando o problema é credencial.
- **Esperado**: capturar o status (`-w '%{http_code}'` ou `--fail-with-body`) e sair do laço em qualquer 4xx, imprimindo o corpo.

#### Y-003 — Duas afirmações operacionais do passo 6 são inferência e estão dentro de um passo selado "verificado", sem selo próprio
- **Arquivo**: `web/src/pages/Integration.tsx:457` (`grep -q '"reportKey"'` como teste de "relatório populado") e `:486-489` (comentário "401/403 = displayToken expirado")
- **Repro**: comparar com `docs/ARRAY_API_RESEARCH.md` §3.6 (a integração de referência repete "until `response.data` is populated" — não diz que o corpo ecoa `reportKey`) e §6 ("Authentication, authorization, and bureau-failure shapes are undocumented publicly"; os status observados são 400 e 404).
- **Observado**: o passo 6 lista 4 fatos selados e nenhum cobre essas duas; o leitor lê como fato verificado o critério de vazio e o mapeamento de status.
- **Esperado**: selo `// UNVERIFIED` para as duas (ou usar um critério defensável, tipo corpo não-vazio/`{}`), na mesma disciplina que o resto da tela adotou no X-009.

### P3

| ID | Defeito | Arquivo:linha | Observado vs esperado |
|---|---|---|---|
| Y-004 | Nomes legais-mas-suspeitos passam pelo filtro (provadamente inertes) | `web/src/components/ArrayComponent.tsx:75-78` (`isDangerousAttrName`) | `data-onload`, `formaction`, `href`, `xlink:href`, `background` entram no snippet; com valor `javascript:window.__pwned=1` eu colei os 5 num HTML em branco: **nada executou**, 0 dialog, 0 `on*` no DOM — num custom element `<array-*>` esses atributos são inertes. Fica como nota: o filtro é `on*`/`style`/`srcdoc` e isso basta hoje. Esperado (opcional): avisar quando um valor começa com `javascript:`. |
| Y-005 | O par tile×tabela das consultas hard agora contradiz na direção oposta | `worker/src/array/mock.ts:270-272` (datas geradas com `monthsBack(1..6)`, dia 10–13) vs `:285` (janela `>= monthsAgoISO(6)`) | Consumidor `3A5F9A42-…`: tabela com **4 consultas Hard** (2026-02-10…13) e tile "Consultas hard (6 meses) **0**" + fator `INQUIRIES` **positivo**. A conta está certa (as datas têm 6 meses e 14 dias), mas a fixture gera fora da janela que ela mesma anuncia. Esperado: gerar as datas dentro da janela (`monthsBack(0..5)`) ou o tile dizer "0 nos últimos 6 meses (4 mais antigas)". 2 em 16 relatórios. |
| Y-006 | A UI do Dashboard ignora `total` e passa a mentir a contagem acima de 50 usuários | `web/src/lib/api.ts:97` (`request('/array/users')`, sem `limit`/`offset` e sem tipar `total`), `web/src/pages/Dashboard.tsx:126,169` | Com **57** usuários no D1: API devolve `payload=50, total=57`; a tela mostra "Ver todos (**50**)" e "Mostrando os 10 mais recentes de **50**. … a rota GET /api/array/users devolve a lista completa do D1 local" — frase que o próprio ciclo 7 tornou falsa. 7 usuários ficam invisíveis, sem controle de página. Esperado: usar `total` no texto e `offset` no "Ver todos". |
| Y-007 | `monthsAgoISO` e `intParam` erram em duas bordas | `worker/src/dates.ts:37-41`; `worker/src/index.ts:275-280` | (a) `monthsAgoISO(6)` em um dia 29–31 estoura para o mês seguinte (em 2026-08-31 a janela vira 2026-03-03, ~5 m 28 d) — mesmo tipo de rollover que o `calendarAge` evita; (b) `intParam('')` → `Number('')===0` → clampa para o **mínimo**: `?limit=` ou `?limit=%20` devolve **1 usuário** em vez do default 50 (um `?limit=${x}` com `x` vazio no código do consumidor lê 1 linha e parece "banco vazio"). Esperado: tratar string vazia/só-espaço como ausente e clampar o dia ao último do mês-alvo. |

---

## Verificado OK (além da regressão)

- **Artefatos coláveis executados de verdade** — 16 requisições contra a Array falsa, todas com o
  client token íntegro e `appKey` no corpo; 5/5 `bash -n`; 6/6 TS com `tsc --strict`; o snippet HTML
  do passo 4 na ordem runtime→bundle e **sem** menção ao client token.
- **Fronteiras da DOB (`worker/src/dates.ts` extraído)** — 13 casos em 2026-08-24: 18 anos hoje
  (`2008-08-24`) → 200, um dia a menos (`2008-08-25`) → 400, `1906-08-24` (120) → 200,
  `1905-08-24` → 400, `2008-02-29` → 200, `2007-02-29`/`0000-01-01`/`2024-13-45` → "real calendar
  date", `2026-08-25` → "future", `2008-8-24` → formato. A regra bate nas duas pontas (validação e
  fixture do relatório) porque as duas importam a mesma função.
- **Cache de userToken** — controle + 10 envenenamentos recusados; escopo com fingerprint do client
  token; token nunca na chave; nenhuma chave antiga alcançável.
- **Segredo e PII** — 0 ocorrências de client token, do valor `SUPERSECRETTOKEN123` ou de SSN de 9
  dígitos em `/api/inspector?limit=200`.
- **9 telas** (8 rotas + rota inexistente) em desktop e mobile 390 px: console sem erros/warnings
  próprios, 0 respostas ≥400 fora do CDN bloqueado, sem overflow horizontal, tema alternando,
  relatório sobrevivendo ao F5 (as perguntas de KBA não sobrevivem — por design, o `authToken` é de
  sessão). Screenshots `docs/screenshots/qa7-*.png`.
- **Aritmética do relatório** — 16 relatórios novos recompostos do zero: rotativo, utilização,
  parcelado, total, janela das consultas, idade por calendário, histórico terminando no score
  canônico e fator de pagamento nunca positivo com atraso.

---

## Checklist de prontidão — o usuário abrindo isso amanhã com credenciais reais

**Vai funcionar de primeira**: `npm install && npm run db:migrate && npm run dev`, as 9 telas em
modo mock com fixtures coerentes, as 6 suítes verdes, o Guia de Integração inteiro (curl e TS
coláveis, testados executando), o Inspector com segredo/PII redigidos e o cache de userToken
isolado por modo/appKey/baseUrl/client token.

**Vai mudar quando ele preencher `worker/.dev.vars`** (`SMARTY_AUTH_ID` = appKey, `SMARTY_AUTH_TOKEN`
= client token, `ARRAY_ENV=sandbox`): enrollment, KBA, usertoken e report seguem os paths
**verificados** (§3.1–§3.6) e devem responder; o que pode falhar é (a) o **envelope exato** do
`POST /user/v2` (aninhamento de `address` é inferido, §3.1), (b) **KBA de sandbox** — as perguntas
vêm de bureau real, então as respostas de fixture não servem e a POC pode receber 400 legítimo, e
(c) as telas que dependem de path inferido: **Alerts** (`GET /alert/v2`, `/alert/v2/{id}`),
**monitoring** (`GET /monitoring/v2`) e **histórico de score** (`GET /report/v2/scoretracker`) — todas
marcadas `// UNVERIFIED path` em `worker/src/array/client.ts:278,283,293,298,306,311,319,324`. Se a
Array usar outro path, esses três devolvem 404 mapeado para erro na tela, não tela branca — a
correção é uma linha por método.

**O que ele precisa fazer manualmente**: liberar egress para `array.io`/`sandbox.array.io` e
`embed[.sandbox].array.io` (aqui os dois são bloqueados, por isso o passo 4 do Guia só foi
exercitado com o CDN stubado); pegar identidades de sandbox no portal da Array (as fixtures usam
`666…`, que é o bloco certo, mas as identidades reais vêm de lá); e, se for além do caminho
canônico, conferir os paths inferidos contra o OpenAPI/Postman do portal (§7 da pesquisa). Nada do
que encontrei neste ciclo é bloqueante: os 7 defeitos novos são 3 P2 de texto/UI e 4 P3.

## Top 5 do próximo ciclo

1. **Y-006 — a contagem de usuários do Dashboard passou a mentir** (57 no banco, "50" na tela, com
   a frase "devolve a lista completa" que o próprio ciclo 7 invalidou). É o único defeito que um
   avaliador vê sozinho, sem ler código.
2. **Y-002 — o retry do passo 6 em `curl` engolir 4xx**: 30 s de "vazio" quando é 401. O artefato
   colável é o produto desta POC; ele já acerta no TS e erra no shell.
3. **Y-001 — fechar o X-006 de vez**: passo 5 por `reportOrderedAt` (campo já gravado), com o mesmo
   `why` do passo 3 na sessão semeada.
4. **Y-003 — selar as duas inferências do passo 6** (critério de "relatório vazio" e 401/403 =
   displayToken expirado), pela mesma disciplina do X-009.
5. **Y-005 + Y-007 — bordas de data e de parâmetro**: gerar as consultas dentro da janela que o
   tile anuncia, `monthsAgoISO` sem rollover de dia 31 e `limit=`/`limit=%20` caindo no default em
   vez do mínimo.
