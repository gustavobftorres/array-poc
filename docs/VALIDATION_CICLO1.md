# VALIDATE — Ciclo 1 (QA adversarial)

Ambiente: branch `claude/array-api-poc-cloudflare-bq7r2u`, modo MOCK, worker `:8787` + web `:5173`.
Ferramentas: `scripts/smoke-api.sh` (36 casos HTTP de abuso) e `scripts/e2e-smoke.mjs`
(Chromium headless via Playwright, 7 telas + fluxo completo). Screenshots em `docs/screenshots/`.

Contagem: **1 P0 · 7 P1 · 12 P2**.

---

## P0

### V-001 — API Inspector devolve 500 permanente depois de qualquer payload > 20 KB
- **Arquivo**: `worker/src/redact.ts:73` (`redactedJson`, truncagem) + `worker/src/index.ts:434-438` (`JSON.parse` do que foi truncado)
- **Repro**:
  1. `python3 -c "print('{\"firstName\":\"'+'A'*25000+'\"}')" > big.json`
  2. `curl -X POST -H 'Content-Type: application/json' --data-binary @big.json localhost:8787/api/array/user` → 400 (correto)
  3. `curl 'localhost:8787/api/inspector?limit=50'` → **500** `{"message":"Expected ',' or '}' after property value in JSON at position 20002","kind":"internal"}`
  4. Abrir <http://localhost:5173/inspector> → banner vermelho, `Chamadas (0)` (screenshot `15-inspector-500.png`)
- **Causa**: a truncagem gera `…"[TRUNCATED]"` colado no meio de um JSON, produzindo string inválida
  gravada em `api_calls.request`; o `GET /api/inspector` faz `JSON.parse` de cada linha sem try/catch,
  então **uma linha ruim derruba a página inteira** (todas as chamadas, não só a grande).
- **Esperado**: truncar para um JSON válido (ex.: `{"_truncated":true,"preview":"…"}`) e/ou `JSON.parse`
  defensivo por linha, devolvendo a linha crua como string em vez de 500.
- **Impacto real fora do mock**: um relatório 3-bureaus real da Array passa fácil de 20 KB
  (o fixture mock tem só 5 KB, por isso o ciclo 1 não viu). Em modo SANDBOX, **a primeira chamada de
  relatório mata a tela de Inspector** — que é justamente a tela que justifica a POC.
  Recuperação existe (botão “Limpar log”), mas apaga toda a evidência.

---

## P1

### V-002 — DOB inválida e DOB no futuro são aceitas (400 esperado, 200 obtido)
- **Arquivo**: `worker/src/index.ts:100` (`createUserSchema.dob`, só regex de formato) e `web/src/pages/Enrollment.tsx:27` (mesma regex no cliente)
- **Repro**: `curl -X POST -H 'Content-Type: application/json' -d '{"firstName":"A","lastName":"B","dob":"2099-01-01","ssn":"666230560","address":{"street":"1 Main St","city":"Austin","state":"TX","zip":"73301"}}' localhost:8787/api/array/user`
- **Observado**: `200 {"clientKey":…}`; idem com `"dob":"2024-13-45"`. Os dois usuários ficam gravados no D1
  e aparecem na tabela do Dashboard (screenshot `08-tema-alternado.png`, linhas `2099-01-01` e `2024-13-45`).
- **Esperado**: 400 com `error[]` — data real (mês 1-12, dia válido) e não futura; idade mínima plausível (18+).

### V-003 — O snippet do Playground usa custom element auto-fechado: inválido em HTML puro
- **Arquivo**: `web/src/components/ArrayComponent.tsx:53` (`buildSnippet`, retorna `` `<${tag}${attrText}\n/>` ``)
- **Repro**: Playground → qualquer componente → card “Snippet HTML”.
- **Observado**: `<array-account-login appKey="…" sandbox="true" />`
- **Esperado**: `<array-account-login appKey="…"></array-account-login>`. HTML não permite self-closing em
  elementos não-void: colado em uma página real, `/>` é ignorado e tudo que vier depois vira filho do
  componente. Os exemplos com `/>` de `docs/ARRAY_API_RESEARCH.md` §4.3 vêm de **JSX**, não de HTML.
  Como o entregável central da POC é “um snippet colável”, isso é defeito de correção, não de estilo.

### V-004 — O snippet embute um appKey fake de 35 caracteres, que o loader da Array rejeita
- **Arquivo**: `worker/src/config.ts:58` (`publicStatus`, `'MOCK-APP-KEY-0000-0000-000000000000'`) usado em `web/src/pages/Playground.tsx:171`
- **Repro**: `node -e 'console.log("MOCK-APP-KEY-0000-0000-000000000000".length)'` → **35**
- **Observado**: snippet copiável traz `appKey=MOCK-APP-KEY-0000-0000-000000000000` tanto no `<script>` quanto no atributo, sem qualquer aviso.
- **Esperado**: em modo mock, emitir um placeholder explícito (`<SEU_APP_KEY_36_CHARS>`) ou um UUID de 36
  chars, e um aviso “troque pelo seu appKey”. `docs/ARRAY_API_RESEARCH.md` §2 registra que o loader
  valida `length === 36` — o snippet atual falha silenciosamente na rede liberada.

### V-005 — Todos os campos de formulário estão sem label associado (a11y / teclado)
- **Arquivo**: `web/src/components/ui.tsx:131-134` (`<label>` sem `htmlFor`, `<input>` sem `id`/`aria-label`)
- **Repro**: `node scripts/e2e-smoke.mjs` → `P1 Enrollment: 8 campos sem label associado`
- **Observado**: 8/8 inputs do Enrollment sem associação (nenhum `label[for]`, nenhum ancestral `<label>`,
  nenhum `aria-label`); clicar no texto “SSN” não foca o campo e leitor de tela anuncia campo sem nome.
- **Esperado**: `id` gerado + `htmlFor`, ou envolver o input no `<label>` (como o KBA já faz em `Kba.tsx:105`).

### V-006 — Fixtures do relatório se contradizem na mesma tela
- **Arquivo**: `worker/src/array/mock.ts:109` / `:123` / `:130` (textos fixos) vs `:191` e `:228-231` (números derivados)
- **Repro**: Credit Report → “Pedir e buscar” (screenshot `04-report.png`)
- **Observado, lado a lado**:
  - “Utilização de crédito rotativo: **Utilização de 41%**” vs tile `UTILIZATION` = **75.1**
  - “Registros negativos: **1 conta em cobrança** reportada há 19 meses” vs card **Cobranças (0) — “Nenhuma cobrança — bom sinal.”**
  - “**2 consultas hard** nos últimos 6 meses” vs tile `INQUIRIES6MO` = **1** (tabela mostra 1 Hard)
- **Esperado**: descrições derivadas dos mesmos números (`summary`, `collections`, `inquiries`). Numa POC
  de avaliação de produto, dado que se contradiz na mesma dobra destrói a confiança na demo.

### V-007 — Telas do fluxo não carregam nada mesmo com `clientKey` já na sessão
- **Arquivo**: `web/src/pages/Alerts.tsx`, `web/src/pages/Kba.tsx:41`, `web/src/pages/CreditReport.tsx` (nenhum `useEffect` de auto-fetch)
- **Repro**: Dashboard → “Semear usuário demo” (popula clientKey/userToken/reportKey) → clicar em “Alerts / Monitoring”.
- **Observado**: ~75% da viewport em branco, só o card “Consultar” (screenshot `05-alerts.png`); idem KBA e Credit Report.
  É preciso clicar de novo em cada tela para ver qualquer dado.
- **Esperado**: com `session.clientKey` preenchido, buscar automaticamente ao montar (e com `reportKey`+`displayToken`,
  re-buscar o relatório) — ou, no mínimo, um estado vazio que explique o próximo clique.

### V-008 — Cada visita ao Dashboard dispara 5 chamadas (3× `/array/users`, 2× `/status`) e polui o Inspector
- **Arquivo**: `web/src/pages/Dashboard.tsx:13-15` (`useEffect(..., [status])` com `status` mudando de `null`→objeto) + `web/src/lib/session.tsx:47-56`
- **Repro**: abrir <http://localhost:5173/> e observar a rede (medido no Playwright):
  `["GET /api/array/users","GET /api/status","GET /api/array/users","GET /api/status","GET /api/array/users"]`
- **Observado**: no Inspector, 3 linhas idênticas `GET /api/array/users` por visita (screenshot `06-inspector.png`,
  35 chamadas registradas das quais a maioria é esse ruído) — o log de auditoria, principal ativo da POC,
  fica dominado por chamadas internas do frontend.
- **Esperado**: um fetch por montagem (deps `[]` ou dedupe), e/ou não auditar as rotas locais
  (`/api/array/users`, `/api/array/reports`) que não representam chamadas à Array.

---

## P2

| ID | Defeito | Arquivo | Observado vs esperado |
|---|---|---|---|
| V-009 | Overflow horizontal no mobile 390×844 só em `/playground` (`scrollWidth 404 > 390`) | `web/src/pages/Playground.tsx:180` (URL do CDN em `<code>` sem `word-break`) | Página rola de lado 14px; esperado: `overflow-wrap`/`word-break` nos `<code>` longos. As demais 6 telas passam (tabelas rolam dentro de `.table-wrap`, correto). |
| V-010 | Host bloqueado é reportado como **403** | `worker/src/array/client.ts:117-123`, `worker/src/index.ts:154` | Em modo sandbox `POST /api/array/usertoken` → `403 kind:"blocked"`. Um bloqueio de egresso é condição de upstream: esperado 502/503, senão o Inspector pinta um erro de infraestrutura como “culpa do cliente”. |
| V-011 | Tiles de summary com chave crua e formatação inconsistente | `web/src/pages/CreditReport.tsx:149-153` | `TOTALACCOUNTS`, `INQUIRIES6MO`, `OLDESTACCOUNTYEARS`; `TOTALBALANCE US$ 256,436` formatado mas `TOTALCREDITLIMIT 341582` cru e `UTILIZATION 75.1` sem `%` (só chaves com “balance” recebem moeda). Esperado: rótulos legíveis e formatador por tipo. |
| V-012 | Console sujo em toda navegação | `web/index.html` (sem favicon), `web/src/App.tsx:15` (React Router v6 sem future flags) | `GET /favicon.ico → 404` + 2 warnings “React Router Future Flag” em cada tela. Esperado: console limpo numa POC que será demonstrada com devtools aberto. |
| V-013 | README não avisa do ruído do wrangler no boot | `README.md:26-34` | `npm run dev` imprime `Error: Request was cancelled.` + stacktrace do undici e “wrangler out-of-date, run npm install --save-dev wrangler@4” **antes** do `Ready on :8787`. Dev novo lê isso como falha. Esperado: nota “esses avisos são esperados sem rede” ou upgrade do wrangler. |
| V-014 | Mock aceita qualquer `clientKey`/`reportKey`/`authToken` com 200 | `worker/src/array/mock.ts` (todas as funções derivam do input) | `GET /api/array/report?reportKey=xxx&displayToken=yyy` → relatório completo; `clientKey=NAO-EXISTE` autentica; `authToken=y` retorna userToken. Esperado: mock com um registro do que existe, para a POC também demonstrar os caminhos de erro (é isso que o usuário vai enfrentar no sandbox). |
| V-015 | “Base: `https://sandbox.array.io/api`” exibido em modo mock | `web/src/pages/Kba.tsx:70`, `CreditReport.tsx`, `Enrollment.tsx:66` | Em MOCK nada sai pela rede, mas a tela afirma a base real. Esperado: “mock — nenhuma chamada externa (base seria …)”. |
| V-016 | Linhas do Inspector são clicáveis mas não parecem | `web/src/pages/Inspector.tsx:74` | O detalhe request/response redigido (o ativo mais valioso da tela) só aparece clicando; não há cursor/hint/ícone. Confirmei que funciona (`13`/`11` screenshots). Esperado: chevron + texto “clique para ver o payload”. |
| V-017 | Catálogo do Playground incompleto face à pesquisa | `web/src/pages/Playground.tsx:29-160` | 11 dos 11 tags verificados estão lá (OK), mas faltam: `helloPrivacyLink` em `array-credit-overview` (§4.3), e nenhuma menção ao componente de Ads (§4.2) nem à ausência de API/componente de disputas (§3.9) — o usuário não descobre que essa lacuna existe. |
| V-018 | Input de atributo estreito corta o valor | `web/src/styles.css:195` (`.attr-row` 1fr/1.4fr) | `appKey` aparece como `MOCK-APP-KEY-0000` (screenshot `07c`); valores de token/UUID ficam ilegíveis. Esperado: input full-width abaixo do label, ou `title`/textarea. |
| V-019 | Reload no meio do fluxo mantém a sessão, mas o relatório desaparece | `web/src/pages/CreditReport.tsx` | `localStorage['array-poc.session']` persiste `clientKey/userToken/reportKey/displayToken` (verificado), porém após F5 em `/report` a tela volta vazia — o `reportKey` guardado não é usado. Esperado: re-buscar com o par salvo. |
| V-020 | `array-credit-score` não oferece o modo manual | `web/src/pages/Playground.tsx:112-117` | Só `userToken`/`sandbox`; a pesquisa (§4.3) documenta modo manual (`productCode`+`reportKey`+`displayToken`) para **score e report**. Esperado: mesmos atributos oferecidos no `array-credit-report`. |

---

## Verificado OK

**Reprodutibilidade do zero** — `rm -rf worker/.wrangler` → `npm run db:migrate` (13 comandos, migração 0001 aplicada)
→ `npm run dev` → `:8787` e `:5173` no ar. O README é seguível **literalmente** (único ajuste: V-013, o ruído do boot).
Sem `worker/.dev.vars` (clone limpo) o worker sobe e cai em MOCK corretamente (`{"mode":"mock"}`).

**Build e testes** — `worker test` 28/28 verdes; `worker typecheck` sem erros; `web build` (tsc -b + vite) sem erros.

**Segurança** — subi uma instância com `SMARTY_AUTH_TOKEN=SUPERSECRETTOKEN123` e varri
`/api/status`, `/api/health`, `/api/inspector?limit=200`, `/api/array/users`, `/api/array/reports`
e todo o estado do D1: **0 ocorrências do segredo**. `/api/status` expõe só booleanos + `appKey`
(público por design). SSN completo **não** chega ao D1 (`grep 666230560` no `.wrangler/state`: nada;
só `ssn_last4`). Tokens aparecem redigidos no Inspector. Modo sandbox bloqueado retorna erro tratado
com `kind:"blocked"` + dica, nunca tela branca.

**Robustez das rotas** (25/36 casos do `scripts/smoke-api.sh` já passam): body vazio, sem body, JSON quebrado,
array no lugar de objeto, SSN curto, ZIP inválido, payload de 2 MB, `userToken` ausente/inexistente,
`answers` vazio, `ttlInMinutes=99999`, `reportKey` sem `displayToken`, rota inexistente, método errado
→ todos **400/404 tratados, nenhum 500**. Path traversal (`/api/array/alerts/..%2F..%2Fetc%2Fpasswd`) → 404.
Paginação do Inspector com `limit=-5`, `offset=-10`, `offset=1e30` → clamp correto.

**Navegador (7/7 telas renderizam conteúdo real)** — nenhuma tela branca, nenhum spinner infinito,
nenhum `undefined`/`NaN`/`[object Object]` no texto de nenhuma tela; nenhum erro de página (pageerror)
e nenhum request de API falhando. Fluxo completo executado pela UI:
Enrollment (form → `clientKey`) → KBA (16 opções, 4 perguntas, respostas → `userToken`) →
Credit Report (score 712, 3 bureaus, 7 tradelines, 4 consultas, histórico 12 meses) → Alerts (6 alertas
com severidade) → Inspector (as três chamadas `POST /array/user`, `GET+POST /array/authenticate`,
`POST+GET /array/report` aparecem no log, com detalhe redigido) → Playground (11 componentes, troca de
aba, edição de atributos ao vivo, snippet, placeholder de CDN bloqueado com “o que apareceria”).
Toggle de tema claro/escuro funciona e persiste (`data-theme`); sessão persiste em `localStorage` após F5;
navegação por Tab passa por todos os links e botões em ordem visual; mobile 390px sem overflow em 6 das 7 telas.

---

## Top 5 do próximo ciclo
(ordenado pelo objetivo: **entender como integrar os web components ao produto do usuário**)

1. **V-003 + V-004 — consertar o snippet do Playground.** É o único artefato que o usuário leva para o
   produto dele. Hoje sai com custom element auto-fechado (inválido em HTML) e com um appKey de 35 chars
   que o loader da Array rejeita. Sem isso, a tela “ensina” uma integração que não funciona.
2. **V-001 — API Inspector 500 com payload > 20 KB.** Assim que ele plugar as credenciais reais, o primeiro
   relatório derruba a tela que mostra request/response — exatamente a evidência que ele precisa para
   desenhar o backend dele.
3. **V-007 (+V-019) — auto-carregar as telas com a sessão existente.** Depois do seed, 4 telas aparecem vazias;
   quem está avaliando o produto conclui que “não tem nada aí”.
4. **V-006 — coerência das fixtures do relatório.** Números que se contradizem na mesma dobra (41% vs 75.1;
   “1 cobrança” vs “Cobranças (0)”) inviabilizam usar a POC como demo interna.
5. **V-017 (+V-020) — completar a pedagogia do Playground.** `helloPrivacyLink`, modo manual no
   `array-credit-score`, e dizer explicitamente o que **não** foi verificado (Ads, disputas) e o que é
   `// UNVERIFIED path` — para ele não descobrir a lacuna só depois de comprar a integração.
