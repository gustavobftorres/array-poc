# QA — como rodar a suíte de validação

Ambiente da POC: monorepo npm (`worker` + `web`), worker em `:8787`, front em `:5173`, modo MOCK.

## 0. Subir a POC

```bash
npm install
npm run db:migrate          # idempotente ("No migrations to apply" é sucesso)
npm run dev                 # worker :8787 + web :5173
curl localhost:8787/api/health   # {"ok":true,"mode":"mock"} = pronto
```

Ruído esperado no boot do `wrangler dev` (não é falha): `wrangler out-of-date` e um
`Error: Request was cancelled.` do undici na checagem de versão — a rede de saída é filtrada.

## 1. Chromium: o detalhe que trava todo mundo

O `@playwright/test` deste repo é 1.62.1 e **pede o build 1234 do Chromium**; a imagem só tem o
**1194** em `/opt/pw-browsers/`. Sem `executablePath` o Playwright falha com
"Executable doesn't exist … chromium-1234". Todos os scripts de browser aceitam a variável
`PW_CHROMIUM`, então rode sempre:

```bash
export PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome
```

Não rode `npx playwright install` (o download do CDN da Microsoft é bloqueado pelo proxy).
Os binários disponíveis:

```
/opt/pw-browsers/chromium-1194/chrome-linux/chrome                  # headed/headless completo
/opt/pw-browsers/chromium_headless_shell-1194/...                   # shell headless
```

## 2. Scripts da suíte

| Script | O que faz | Saída |
|---|---|---|
| `bash scripts/smoke-api.sh` | 42 casos HTTP de abuso contra `:8787` (payload de 2 MB, JSON quebrado, chaves inexistentes, path traversal, clamp de paginação, registro do mock no `GET /report`, TTL/refresh do cache de userToken) | `pass=42 fail=0` |
| `PW_CHROMIUM=… node scripts/e2e-smoke.mjs` | percorre as telas (inclui `/integracao`: 6 passos, diagrama, alternância curl/TypeScript, estado da sessão), roda o fluxo Enrollment→KBA→Report→Alerts, testa reload, foco por Tab e mobile 390px; grava `docs/screenshots/` | lista de achados (vazia = ok) |
| `PW_CHROMIUM=… node scripts/snippet-check.mjs` | **valida o snippet do Playground de verdade**: copia o snippet real de 5 componentes da UI, cola em HTML em branco, sobe um http-server local e abre no Chromium; afere HTML válido, custom element no DOM, ordem dos scripts, `appKey` de 36 chars, listener de `array-event` e ausência de `SyntaxError`. Desde o ciclo 5 também cola um snippet **hostil** (`true" onload="alert(1)` num atributo + nome de atributo inválido via `prompt`) e afere que nenhum handler executável chega ao DOM, que a árvore não desloca e que a linha `userToken` sai sempre com a explicação de origem/TTL | `snippet-check: 0 achado(s)`; artefatos em `scripts/.tmp-snippets/` |
| `PW_CHROMIUM=… node scripts/regression-ciclo3.mjs` | checagens de navegador dos IDs V-005…V-020 (labels, auto-load, tiles, base em mock, hint do Inspector, catálogo, overflow mobile 8/8 — com `/integracao` —, console limpo) + `GET /api/status` por visita (W-014) e se o input de atributo ainda estoura (V-018/W-015) | uma linha por ID |
| `PW_CHROMIUM=… node scripts/guide-check-ciclo6.mjs` | **prova que o Guia de Integração é colável** (ciclo 6): lê os 6 pares de snippet da tela, roda `bash -n` em cada `curl`, **executa** cada um contra o worker local com o host reescrito (exigindo `clientKey`/`authToken`/`userToken`/`reportKey`/`score` na resposta), compila cada snippet TypeScript com `tsc --strict`, e afere `appKey` em todo body, ausência de comentário dentro de header, selos verificado/inferido e o estado por passo (sessão limpa = 0/6; semeada = **1/6** desde o ciclo 9 — Y-001 tirou o passo 5 de "reportKey presente" e o pôs no evento `reportOrderedAt`, e o `/api/seed` pede o relatório no servidor) | `0 achado(s)` |
| `PW_CHROMIUM=… node scripts/verify-guide-ciclo7.mjs` | **verificação independente do Guia (ciclo 7)**: sobe `scripts/fake-array-ciclo7.mjs` (Array falsa em `127.0.0.1:8899`, que devolve 401 se o `x-credmo-client-token` não for byte-a-byte o segredo e `Validation failed` se faltar `appKey`), extrai os 6 pares de snippet da **tela renderizada**, roda `bash -n`, **executa** cada curl com o host reescrito e compila cada TS com `tsc --strict` (usa `node_modules/.bin/tsc` — `npx tsc` tenta baixar pelo proxy e trava) | `verify-guide-ciclo7: 0 achado(s)` + a lista de requisições vistas (7 desde o ciclo 9: o `GET /report/v2` da Array falsa autentica pelo par `reportKey`+`displayToken`, não pelo client token, e o `PUT` de renovação passou a ser exercitado) |
| `node scripts/kv-poison-ciclo7.mjs` | envenena o **blob** de entradas legítimas do KV em 11 variantes (sem `scope`, `scope` divergente/nulo/prefixo, `expiresAt` vencido/na margem, `ttl` divergente, client token rotacionado) com caso de controle. Detalhe que custa tempo: **inserir linha nova no sqlite do miniflare não é visto** pelo namespace já aberto — só a reescrita do blob de uma chave existente funciona; os blobs ficam em `worker/.wrangler/state/v3/kv/local-cache/blobs/` | `kv-poison-ciclo7: 0 achado(s)` |
| `PW_CHROMIUM=… node scripts/hostile-attrname-ciclo7.mjs` | 19 nomes de atributo hostis pelo `prompt` do Playground (case, espaços, homoglifos, `data-on*`, `formaction`, `href`, `xlink:href`, `background`) e cola cada snippet num HTML em branco instrumentado com `window.__pwned` | **19/19 recusados** desde o ciclo 9 (Y-004 fechou os 5 atributos de URL — `href`, `formaction`, `background`, `xlink:href`, `data-onload`); 0 execuções, 0 achados |
| `PW_CHROMIUM=… node scripts/step-state-ciclo7.mjs` | os 6 estados de passo do Guia em 6 cenários com `localStorage` limpo; monta um componente **de verdade** stubando o CDN da Array por `page.route` (o botão é **Montar componente**, não há auto-mount) | limpa 0/6 · semeada **1/6** · enrollment 1/6 · KBA 2/6 · usertoken **2/6** · componente 1/6 · **0 achados desde o ciclo 11** (Z-001: o evento do passo 4 é escopado à aba pelo `sessionStorage` e limpo no **Desmontar**, na falha de carga do CDN e ao reabrir o Playground sem componente montado, então a aba 6b sem stub já não conta o mount de outra aba) |
| `node scripts/report-audit-ciclo7.mjs [N]` | cria N consumidores, pede/busca o relatório e recomputa tudo do JSON cru (campos do summary: `inquiries6mo`, `oldestAccountYears`, `revolving*`) | `report-audit-ciclo7: 0 achado(s)` |
| `PW_CHROMIUM=… node scripts/walkthrough-ciclo7.mjs` | 9 alvos (as telas + a rota inexistente) em desktop e mobile 390px, console, ≥400, tema (`☾ Escuro`/`☀ Claro`), F5 no meio do fluxo e a coerência da contagem de usuários; grava `docs/screenshots/qa7-*` | `0 achado(s)` desde o ciclo 9 (Y-006 corrigido: a tela imprime o `total`) |
| `PW_CHROMIUM=… node scripts/regression-ciclo9.mjs` | **regressão independente dos 7 `Y-*` (ciclo 9)**: um veredito por ID com evidência própria — transpila `worker/src/dates.ts` com `esbuild` e varre 37 datas (dias 29/30/31, bissexto, virada de ano), recomputa a janela de consultas de 8 relatórios do JSON cru, extrai o `curl` do passo 6 da tela e o executa contra um **upstream próprio** que responde 401, `202`→`202`→`200` e `204` (o critério documentado, desde o ciclo 13) (o upstream roda em **outro processo** — `execFileSync` bloqueia o event loop, e um servidor no mesmo processo nunca aceitaria a conexão do curl), e cruza a recusa de nomes de atributo com os **20 atributos reais** da Array (§4.3 da pesquisa). Detalhe que custa tempo: sem `no_proxy=127.0.0.1` o `curl` do snippet vai para o proxy de egresso até para o loopback | `regression-ciclo9: 0 achado(s)` + `verdict.json` em `scripts/.tmp-ciclo9/` |
| `PW_CHROMIUM=… node scripts/step4-stuck-ciclo9.mjs` | caracteriza o Z-001 em 3 cenários no mesmo `localStorage`: CDN stubado + **Montar componente** → **Desmontar** (elemento fora do DOM) → aba nova com o CDN bloqueado | desde o ciclo 11 (Z-001) os três batem com o DOM: **A** feito (`1/6`) · **B** **pendente** (`0/6`) — reabrir o Playground sem componente montado limpa o evento · **C** **pendente** (`0/6`) — outra aba não conta |
| `npm --workspace worker run test` | vitest (139 testes desde o ciclo 13; inclui namespace do cache de userToken, idade por calendário, aritmética do relatório, normalização do `ARRAY_BASE_URL`, a invariante do `ARRAY_AUTH_MODE`, o polling 202/200/204 + timeout e o token/persistência do webhook) | 139 passed |
| `npm --workspace worker run typecheck` / `npm --workspace web run build` | tsc + vite | sem erros |

Todos os `scripts/.tmp-*/` (`.tmp-snippets`, `.tmp-hostile`, `.tmp-attr7`, `.tmp-guide7`,
`.tmp-ciclo9`) são recriados a cada execução (HTML + PNG por componente) e **não devem ser
comitados** — o `.gitignore` cobre o glob `scripts/.tmp-*` desde o ciclo 11 (Z-006). Confira com
`git ls-files | grep tmp` (tem de sair vazio).

**Redação do Inspector (Z-005, ciclo 11)**: o que a tabela `api_calls` guarda não é o payload
literal. Além de SSN e tokens, a PII de identidade é redigida **preservando a forma**:
`"firstName":"[REDACTED]:5 chars"`, `"dob":"[REDACTED]:1990"` (só o ano), rua/CEP/e-mail/telefone
só com o tamanho, `city`/`state` em claro. Ao escrever teste de payload grande use um campo
**não-PII** (ex.: `notes`), porque um `firstName` de 25 000 chars vira uma string de ~20 chars e não
exercita mais o envelope de truncamento.

## 3. Passos não-óbvios

- **Scripts com `import { chromium } from '@playwright/test'` só rodam de dentro do repo.**
  Um `.mjs` em `/tmp` falha com `ERR_MODULE_NOT_FOUND` — o pacote está em `node_modules` da raiz.
- **`localStorage` é por contexto do Playwright.** Cada `newContext()` começa sem sessão, então
  todo script que precisa de `clientKey`/`userToken` tem que clicar em **Semear usuário demo** no
  Dashboard antes de navegar para KBA/Report/Alerts.
- **Credenciais vêm do `.env` da raiz** (ciclo 11, Z-004): `npm run dev` roda `scripts/sync-env.mjs`
  (hook `predev`) e **gera `worker/.dev.vars`** a partir dele; `npm run sync-env` faz só a geração.
  Sem `.env` nada é tocado (modo MOCK); um `.env` vazio não apaga um `.dev.vars` preenchido. Os dois
  arquivos são ignorados pelo git. Depois de mudar as chaves, **reinicie o worker**; o
  `GET /api/status` só reflete o modo novo ~10 s depois do boot do wrangler.
- **Modo SANDBOX para testar caminhos de erro**: suba um segundo worker sem tocar no `.dev.vars`:
  ```bash
  cd worker && npx wrangler dev --local --port 8788 \
    --var ARRAY_APP_KEY:11111111-2222-4333-8444-555555555555 \
    --var ARRAY_SERVER_TOKEN:SUPERSECRETTOKEN123
  curl -s -X POST -H 'content-type: application/json' \
    -d '{"clientKey":"AAA","ttlInMinutes":60}' localhost:8788/api/array/usertoken
  # esperado: 502 kind:"blocked" (o proxy responde 403 para sandbox.array.io)
  ```
  Atenção: esse worker **compartilha o D1 e o KV local** com o de `:8787` — o cache de userToken
  agora é namespaciado por modo/appKey/baseUrl, então o compartilhamento não mais vaza tokens de um
  modo para o outro (W-001, corrigido no ciclo 5).
- **Inspecionar/corromper o D1 direto** (guarda de parse, V-001):
  ```bash
  DB=$(ls worker/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite)
  sqlite3 "$DB" "update api_calls set request='{\"broken\": ' where id=(select id from api_calls limit 1)"
  curl -s 'localhost:8787/api/inspector?limit=200' | grep _unparseable
  ```
  (sem `sqlite3` no PATH, use `python3 -c "import sqlite3; …"`.)
- **Payload grande**: `python3 -c "print('{\"firstName\":\"'+'A'*300000+'\"}')" > big.json` e
  `curl --data-binary @big.json`. Espere `400` no POST e `200` no `GET /api/inspector`, com a linha
  marcada `{"_truncated":true,"bytes":…,"preview":"…"}`.
- **O Inspector pagina de 25 em 25** e ordena por `ts` desc: depois de muitos testes a linha que
  você quer inspecionar não está na primeira página — use `?limit=200` na API em vez de caçar na UI.
- **`limit`/`offset` em `GET /api/array/users`** (desde o ciclo 7): default `limit=50`, teto 200;
  valor não-inteiro **e string vazia/só-espaço** caem no default (`?limit=`, `?limit=%20` devolvem 50
  linhas — era 1 linha até o ciclo 9, Y-007). A UI do Dashboard pede `?limit=10` e imprime o `total`
  da rota (Y-006): com 57 no banco a tela diz 57 e **Ver todos** busca até 200 (teto de uma página).

- **Reset do estado local**: `rm -rf worker/.wrangler && npm run db:migrate` (perde usuários,
  relatórios, log de auditoria e o cache KV).
- **Cache de userToken no KV** (reescrito no ciclo 5): a chave é
  `usertoken:v2:<modo>|<appKey>|<baseUrl>|<ttl>|<clientKey>` e o valor carrega o escopo, reconferido
  na leitura. Consequências para o QA:
  - `?refresh=true`, `?refresh=1`, `?refresh=yes`, `?refresh=on` (case-insensitive) todos forçam
    emissão nova;
  - em modo mock cada emissão devolve um token **diferente** (contador por `clientKey`), então
    "Renovar userToken" muda o valor visível;
  - pedir um `ttlInMinutes` diferente **não** reaproveita o cache (`60` e `1440` são entradas
    distintas), e `ttlInMinutes: 1` não é cacheado;
  - desde o ciclo 6 o escopo inclui também um **hash do client token** (X-011): rotacionar
    `ARRAY_SERVER_TOKEN` invalida o cache mesmo com o mesmo `appKey`, e o token em si nunca entra na
    chave (só o fingerprint de 32 bits);
  - a leitura **exige** o campo `scope` no valor (X-008): entrada gravada à mão sem `scope` é
    tratada como miss, então a defesa não depende de quem escreveu;
  - **chaves de versões antigas** (o `usertoken:<clientKey>` do ciclo 3 e qualquer
    `usertoken:v2:…` sem o segmento `ct…` do ciclo 6) ficam no KV até expirar. Elas são inertes —
    o prefixo/escopo atual não as encontra — mas poluem a inspeção (X-012). Para limpar:
    ```bash
    # listar o que existe
    ls worker/.wrangler/state/v3/kv/*/ 2>/dev/null
    # limpeza total do estado local (perde D1 e KV)
    rm -rf worker/.wrangler && npm run db:migrate
    ```
  - o worker de sandbox em `:8788` compartilha o KV local, mas **não** enxerga mais os tokens do
    mock: a mesma requisição volta `502 kind:"blocked"` em vez de `200 cached:true` (era o W-001).
    Repro em um comando: mint no `:8787`, mesma requisição no `:8788`.

## Ciclo 13 — variáveis novas, polling e webhooks

- **Nomes canônicos**: `ARRAY_APP_KEY` e `ARRAY_SERVER_TOKEN`. `ARRAY_CLIENT_TOKEN` é alias;
  `SMARTY_AUTH_ID`/`SMARTY_AUTH_TOKEN` são **aliases deprecados** — quando usados, `GET /api/status`
  traz `warnings[]` e o worker imprime o aviso no boot. Um `.env` só com os nomes novos deve produzir
  `warnings: []`.
- **`ARRAY_BASE_URL`**: cole `https://sandbox.array.io` (sem `/api`) e confira em
  `GET /api/status` que `baseUrl` volta `https://sandbox.array.io/api` e
  `baseUrlSource: "ARRAY_BASE_URL"`. Variações cobertas por teste: com/sem `/api`, com barra no fim,
  host de produção (que também troca o CDN quando `ARRAY_ENV` não é explícito) e valor inválido
  (cai no host do `ARRAY_ENV` com aviso).
- **`ARRAY_AUTH_MODE=browser`** é uma trava, não convenção:
  ```bash
  cd worker && npx wrangler dev --local --port 8788 \
    --var ARRAY_APP_KEY:11111111-2222-4333-8444-555555555555 \
    --var ARRAY_SERVER_TOKEN:SUPERSECRETTOKEN123 --var ARRAY_AUTH_MODE:browser
  curl -s -X POST -H 'content-type: application/json' \
    -d '{"firstName":"A","lastName":"B","dob":"1980-01-01","ssn":"666000000",
         "address":{"street":"1 ST","city":"AUSTIN","state":"TX","zip":"78701"}}' \
    localhost:8788/api/array/user
  # esperado: 409 kind:"auth_mode" — e NENHUMA requisição sai (o segredo não é anexado)
  ```
- **Polling do relatório (202/200/204)**: em modo mock, `POST /api/array/report` aceita
  `simulate: "pending-then-ready" | "pending-then-failure"` (recurso DESTA POC, não da Array) e a
  tela Credit Report tem o seletor equivalente. Esperado: `pending-then-ready` → 200 depois de dois
  202; `pending-then-failure` → **502 `kind: report_failed`** imediato (não espera o timeout);
  `ARRAY_POLL_TIMEOUT` estourado → **504 `kind: timeout`** citando a variável.
- **Personas (`ARRAY_IDENTITY`)**: `GET /api/personas` lista as quatro personas conhecidas
  (`banker-coldiron` verificada; as outras três com DOB/SSN/endereço marcados `// UNVERIFIED`) e a
  ativa. Em `ARRAY_ENV=production` o SSN vem `null` e a persona é ignorada, com aviso.
- **Webhooks**:
  ```bash
  cd worker && npx wrangler dev --local --port 8788 --var ARRAY_WEBHOOK_TOKEN:SEGREDO-DO-PATH
  curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:8788/api/webhooks/array/errado   # 404
  curl -s -X POST -H 'content-type: application/json' \
    -d '{"eventType":"Customer ordered a report","clientKey":"CK","reportKey":"RK"}' \
    localhost:8788/api/webhooks/array/SEGREDO-DO-PATH   # {"received":true,...}
  curl -s localhost:8788/api/webhooks/events | head -c 400
  ```
  Sem `ARRAY_WEBHOOK_TOKEN` a rota responde **404** (não existe). O token é comparado em tempo
  constante e **nunca** aparece no Inspector: a auditoria grava o path como
  `/api/webhooks/array/***`. O botão "Simular evento" da tela grava `source: simulated` — a Array
  não alcança o seu `localhost`, e não há API de registro: a `ARRAY_LISTENER_URL` é entregue ao
  Customer Success.

## Ciclo 14 (QA) — sondas próprias das variáveis, do polling e do webhook

Scripts do QA adversarial do ciclo 14 (relatório em `docs/VALIDATION_CICLO13.md`). Nenhum depende
do `npm run dev` já estar de pé, **exceto** o `walkthrough-ciclo13.mjs` (precisa de `:5173`+`:8787`).

| Script | O que faz | Saída |
|---|---|---|
| `node scripts/baseurl-matrix-ciclo13.mjs` | 22 valores de `ARRAY_BASE_URL` × com/sem `ARRAY_ENV`, chamando `getConfig` transpilado com esbuild (não sobe worker). Imprime `baseUrl`/`baseUrlSource`/`arrayEnv`/CDN/aviso por caso | tabela + `N achado(s)`; hoje **2** (o `http://` remoto sem aviso, W2-005 — loopback não é sinalizado) |
| `node scripts/fake-upstream-ciclo13.mjs --port 8905 --log … --script "202,202,200"` | upstream falso instrumentado: grava método, path, query, **todos os headers**, corpo e timestamp de cada requisição em JSONL. Use `--script` para roteirizar o `GET /report/v2` (`202`, `204`, `200-empty`, `500`, `202*`) | fica em foreground; mate quando acabar |
| `node scripts/poll-probe-ciclo13.mjs` | 18 cenários de polling, um `wrangler dev` isolado por cenário; **mede** nº de requisições, os intervalos reais e o tempo até o 504 | 4 "achados" são expectativa do harness (timeout inválido cai no default de 120 s, então a resposta demora de propósito) |
| `node scripts/poll-probe2-ciclo13.mjs` | os 3 casos que exigem worker limpo: intervalo gigante, `200` com corpo vazio, timeout gigante | 3 blocos de log (sem contador) |
| `scripts/boot-worker-ciclo13.sh PORTA VAR:VALOR …` | sobe um worker isolado com `--var` e espera o `/api/status`; imprime o PID na 1ª linha | `kill <pid>` no fim |
| `PW_CHROMIUM=… node scripts/walkthrough-ciclo13.mjs` | 9 telas × (desktop, 390 px): console, overflow, ausência de `SMARTY_AUTH_*` na UI, tema, e o seletor de simulação do relatório (`pending-then-ready` e `pending-then-failure`) na tela Credit Report. Grava `docs/screenshots/qa13-*` | `walkthrough-ciclo13: 0 achado(s)` |

Passos não-óbvios aprendidos aqui (custam tempo):

- **Portas fixas colidem.** `scripts/verify-guide-ciclo7.mjs` usa `127.0.0.1:8899` e
  `scripts/regression-ciclo9.mjs` usa `8931`. Se outro processo (por exemplo o
  `fake-upstream-ciclo13.mjs`, ou um worker de teste esquecido) ocupar a porta, os dois saem com
  achados **falsos** — 5 e 8 respectivamente, com "requisições vistas: 0". Antes de acusar
  regressão, confira as portas (W2-014).
- **Matar worker de teste**: `kill` no PID do `wrangler` deixa o `workerd` vivo e a porta presa.
  Mate os dois (`ps -eo pid,args | grep -E "[w]rangler dev|[w]orkerd serve"`) e **não** derrube
  por engano o `workerd` do `:8787` (o do `npm run dev` tem dois processos `workerd`, um deles com
  `--socket-addr=entry=127.0.0.1:0`).
- **Dois scripts saem com achado por design** e não estão na suíte do README:
  `scripts/integration-audit-ciclo5.mjs` (**3 achados**: audita um Guia de 4 passos, que tem 6
  desde o ciclo 6) e `scripts/pii-probe-ciclo11.mjs` (**5 achados**: 4 são sentinelas dentro dos
  envelopes `{_truncated,preview}`/`{raw}` e do sqlite bruto da tabela `users`, por design; 1 é a
  mensagem de erro do upstream não redigida). Qualquer número diferente de 3 e 5 é regressão.
- Os artefatos ficam em `scripts/.tmp-ciclo13/` (`baseurl-matrix.json`, `poll-probe.json`, os
  JSONL do upstream falso) — cobertos pelo `.gitignore` do glob `scripts/.tmp-*`.
