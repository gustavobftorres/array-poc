# Validação do ciclo 13 (QA adversarial do ciclo 14) — variáveis `ARRAY_*`, polling, auth mode e webhooks

Commit auditado: **`d9c86ec`** ("migra para as variaveis corretas da Array e implementa polling,
auth mode e webhooks"). Ambiente: modo MOCK + upstreams falsos próprios (`array.io` continua
bloqueado pelo proxy de egresso).

Tudo abaixo foi medido com instrumentação **deste** ciclo — nenhum teste do DEV foi usado como
prova. Os scripts novos ficam em `scripts/*-ciclo13.*` (ver `docs/QA.md` §"Ciclo 14"):

| Script novo | O que prova |
|---|---|
| `scripts/baseurl-matrix-ciclo13.mjs` | 22 valores de `ARRAY_BASE_URL` × com/sem `ARRAY_ENV`, direto no `getConfig` transpilado (esbuild) |
| `scripts/fake-upstream-ciclo13.mjs` | upstream falso **instrumentado**: grava método, path, query, **todos os headers**, corpo e timestamp de cada requisição em JSONL |
| `scripts/poll-probe-ciclo13.mjs` | 18 cenários de polling com worker isolado por cenário; **mede** nº de requisições, intervalos reais e tempo até o 504 |
| `scripts/poll-probe2-ciclo13.mjs` | 3 cenários que exigem worker limpo (intervalo gigante, 200 vazio, timeout gigante) |
| `scripts/boot-worker-ciclo13.sh` | sobe um worker isolado com `--var` e espera o `/api/status` |
| `scripts/walkthrough-ciclo13.mjs` | 9 telas × (desktop, 390px), console, tema, e o seletor de simulação do relatório (202→200 e 202→204) |

---

## 1. Tabela por variável

| Variável | Migrada/implementada corretamente? | Evidência |
|---|---|---|
| `ARRAY_APP_KEY` | **sim** | worker :8790/:8796 — `/api/status.appKey` reflete o valor; `POST /api/user/v2` observado no upstream falso com `"appKey"` no **corpo** (nunca header). Alias deprecado `SMARTY_AUTH_ID` funciona e avisa (abaixo). |
| `ARRAY_SERVER_TOKEN` | **sim** | upstream falso: `x-credmo-client-token: SUPERSECRETTOKEN123` byte a byte em `/user/v2`, `/authenticate/v2`, `/authenticate/v2/usertoken`, `/report/v2` (POST) e `/alert/v2`. Nunca no corpo, nunca em `/api/status` (só `hasServerToken`). Alias `ARRAY_CLIENT_TOKEN` aceito **sem** aviso (correto: é alias, não depreciado). |
| `SMARTY_AUTH_ID` / `SMARTY_AUTH_TOKEN` (deprecados) | **sim** | worker :8796 só com os nomes antigos: `mode: "sandbox"` (continua funcionando) **e** `warnings[]` com as duas linhas "está DEPRECADO"; o log de boot traz `[config] SMARTY_AUTH_ID está DEPRECADO…`. `Layout.tsx:67` e `Dashboard.tsx:158` mostram os avisos na UI. Nenhum órfão: `grep -rn "SMARTY"` só acha o caminho de alias (`config.ts`, `types.ts`, `sync-env.mjs`), os testes do alias e notas históricas (README §"Nota histórica", `.env.example`, docs). |
| `ARRAY_BASE_URL` | **parcial** | Normalização certa nas 4 formas (`…io`, `…io/`, `…io/api`, `…io/api/` → `…io/api`), espaços, maiúsculas, query/hash e userinfo descartados; valor inválido (`sandbox.array.io`, `localhost:9999`, `javascript:`, `file://`, lixo) **nunca** aponta para produção — cai no host do `ARRAY_ENV` **com aviso**. Falhas: **W2-001** (host de produção não liga o ambiente de produção), **W2-005** (`http://` remoto sem aviso), **W2-007** (`/api/v2` → `/api/v2/api`). |
| `ARRAY_ENV` | **sim** | `production` explícito → `https://array.io/api` + CDN `embed.array.io` + SSN das personas `null` + persona avisada. Mas veja **W2-001**: `wrangler.toml [vars]` fixa `ARRAY_ENV="sandbox"`, então o ramo "host decide o ambiente" é inalcançável na POC rodando. |
| `ARRAY_AUTH_MODE` | **sim** (invariante real) | Worker :8793 em `browser` + upstream instrumentado, **14 rotas** exercitadas: 12 devolvem **409 `kind:"auth_mode"`** (incluindo `/api/seed`, `PUT /report/v2`, scoretracker, alerts, alerts/:id, monitoring — não só o report), `GET /api/array/user` com `x-credmo-user-token` passa e `GET /api/array/report` passa por capability token. **Requisições que chegaram ao upstream: 2; com `x-credmo-client-token`: 0.** A mensagem do 409 cita só o método/path — não vaza tamanho, prefixo nem forma do token. Valores inválidos (`serve`, `0`, `true`, `browser;server`) caem em `server` **com aviso**; `Server`/`SERVER` normalizam. Ressalva de doc: **W2-012**. |
| `ARRAY_IDENTITY` | **parcial** | Slug conhecido, slug com `_`/maiúsculas, slug inexistente (aviso), path traversal (aviso), JSON válido, JSON inválido (aviso) — todos corretos e sem derrubar o boot. Em produção o `/api/status` avisa e o `/api/personas` devolve `ssn: null`. **Mas o dado continua sendo usado**: **W2-002** (P1). Também **W2-010** (JSON parcial herda o SSN da persona default). SSN completo aparece só em `/api/personas` em sandbox (personas fictícias, faixa `666…`) e **não** em D1 (`users.ssn_last4`), nem no Inspector, nem no KV — conferido no sqlite. |
| `ARRAY_PRODUCT_CODE` | **sim** | `credmo3bReportScore` no corpo do `POST /report/v2` observado no upstream; `/api/status.productCode` e o `/api/seed` usam a variável. |
| `ARRAY_POLL_INTERVAL` | **sim** (com ressalva) | Intervalos **medidos** no upstream: `0.5` → 502–503 ms; `1.0` → 1002–1003 ms; `3.0` → 3002–3003 ms. `0`, `-5`, `abc` → default 1 s **com aviso** e sem loop. Valor gigante (1e9 s) não dorme para sempre: `elapsed+interval > timeout` gera 504 na 1ª tentativa (97 ms) — mas sem aviso (**W2-006**). |
| `ARRAY_POLL_TIMEOUT` | **sim** (com ressalva) | `timeout=4 s`, interval 1 s → **504 `kind:"timeout"`** com 4 requisições em **3027 ms** (bate com a variável; a última espera é suprimida de propósito) e a mensagem cita `ARRAY_POLL_TIMEOUT`. `abc`/`0` → default 120 s **com aviso**. `1e9` → aceito **sem aviso**, requisição pendurada (30 pedidos em 15 s, nenhuma resposta) — **W2-006**. |
| `ARRAY_LISTENER_URL` | **parcial** | Exibida em `/api/status`, `/api/webhooks/config` e na tela Webhooks, como prometido — **e é exatamente por isso que o segredo vaza** (**W2-003**), já que o formato documentado em `.env.example:52` embute o `ARRAY_WEBHOOK_TOKEN` no path. |
| `ARRAY_WEBHOOK_TOKEN` | **parcial** | Comparação indistinguível: 13 variantes de token (errado do mesmo tamanho, curto, prefixo, sufixo, correto+sufixo, case trocado, traversal, 1000 chars) → **sempre `404 {"message":"Not Found"}`, 23 bytes, mediana 4,1–4,4 ms** em 12 amostras cada. Não configurado → 404. Token **não** aparece em `/api/webhooks/events`, `/api/inspector` (path gravado como `/api/webhooks/array/***`), D1 (`grep` no sqlite = 0) nem KV. Falhas: **W2-003** (vaza pela listener URL), **W2-004** (aparece no log do `wrangler dev`), **W2-009** e **W2-011**. |

---

## 2. Defeitos novos

### W2-001 — `ARRAY_BASE_URL` de produção não liga o ambiente de produção (P1)
- **Arquivo**: `worker/wrangler.toml:14` (`ARRAY_ENV = "sandbox"` em `[vars]`) + `worker/src/config.ts:113-121`; afirmação em `README.md:174` e `.env.example:35`.
- **Repro**: `scripts/boot-worker-ciclo13.sh 8790 ARRAY_APP_KEY:… ARRAY_SERVER_TOKEN:… ARRAY_BASE_URL:https://array.io ARRAY_IDENTITY:banker-coldiron` → `GET /api/status`.
- **Observado**: `arrayEnv: "sandbox"`, `baseUrl: "https://array.io/api"`, `componentsCdn: "https://embed.sandbox.array.io/cms/"`, `warnings: []`, `identity.source: "persona"` e `/api/personas` devolvendo **SSN completo**.
- **Esperado**: o README diz "Sem `ARRAY_ENV` explícito, um host não-sandbox liga o ambiente de **produção** (e o CDN de produção)". Como `wrangler.toml` **sempre** define `ARRAY_ENV=sandbox` (e o `.env.example` também, descomentado), esse ramo é **código morto** na POC rodando: quem aponta a base para produção fica com CDN de sandbox, sem aviso e com a persona de teste ativa. Ou o `[vars]` deixa de fixar `ARRAY_ENV`, ou o README para de prometer.

### W2-002 — `ARRAY_IDENTITY` "ignorada em produção" é só rótulo: o SSN vai para produção (P1)
- **Arquivo**: `worker/src/config.ts:129-133` (`identity = { ...identity, source:'default', label:'(ignorada em produção)' }` — o spread **preserva** `firstName/lastName/dob/ssn/address`) + `worker/src/index.ts:711-719` (`/api/seed` usa `cfg.identity`).
- **Repro**: upstream falso instrumentado + `wrangler dev --var ARRAY_ENV:production --var ARRAY_BASE_URL:http://127.0.0.1:8905 --var ARRAY_IDENTITY:banker-coldiron`, depois `POST /api/seed`.
- **Observado** (`scripts/.tmp-ciclo13/seed-prod.jsonl`): `POST /api/user/v2` com `{"appKey":…,"firstName":"BANKER","lastName":"COLDIRON","dob":"1974-04-18","ssn":"666230560","address":{…}}`, enquanto `/api/status` diz `label: "(ignorada em produção)"` e emite o aviso "ignorada porque … aponta para produção". Com JSON inline a coisa piora: `ARRAY_IDENTITY={"firstName":"MARIA","ssn":"123456789"}` em produção mantém `ssn: "123456789"` no `cfg.identity` — um SSN **real** digitado pelo usuário seria enviado ao host de produção sob a promessa de que a variável foi ignorada.
- **Esperado**: em produção a identidade deve ser esvaziada de verdade (ou o `/api/seed` recusado), não apenas re-rotulada.

### W2-003 — o `ARRAY_WEBHOOK_TOKEN` sai em texto claro pela `ARRAY_LISTENER_URL` (P2)
- **Arquivo**: `worker/src/index.ts:821-833` (`listenerUrl: cfg.listenerUrl`), `worker/src/config.ts` (`publicStatus.webhook.listenerUrl`), `web/src/pages/Webhooks.tsx:62`; formato documentado em `.env.example:52` e `README.md` (`ARRAY_LISTENER_URL=https://seu.host/api/webhooks/array/<ARRAY_WEBHOOK_TOKEN>`).
- **Repro**: worker com `ARRAY_WEBHOOK_TOKEN:SEGREDO-DO-PATH-abc123` e `ARRAY_LISTENER_URL:https://meu.host/api/webhooks/array/SEGREDO-DO-PATH-abc123` → `curl /api/webhooks/config` e `curl /api/status`.
- **Observado**: `"listenerUrl":"https://meu.host/api/webhooks/array/SEGREDO-DO-PATH-abc123"` nas duas rotas, e a tela Webhooks imprime a URL inteira.
- **Esperado**: o README afirma que `GET /api/webhooks/config` "**nunca** devolve o token". Ou a listener URL é mascarada no último segmento (como já se faz com o path da auditoria), ou a documentação deixa de prometer o contrário.

### W2-004 — o token do webhook é registrado no log do `wrangler dev` (P2)
- **Arquivo**: afirmação em `README.md` ("comparado em tempo constante e nunca logado") e `docs/QA.md` §Ciclo 13; comportamento é do runtime.
- **Repro**: qualquer `POST /api/webhooks/array/<token>` e depois `grep abc123` no stdout do worker.
- **Observado**: `[wrangler:inf] POST /api/webhooks/array/SEGREDO-DO-PATH-abc123 200 OK (25ms)` — 12 linhas com o segredo em claro no terminal do `npm run dev`.
- **Esperado**: a POC não loga o token (isso é verdade), mas a afirmação "nunca logado" é falsa na prática — é a fraqueza clássica de segredo-no-path (access log do runtime, do proxy reverso, do CDN). Precisa de ressalva explícita no README/QA, como a própria pesquisa já sugere.

### W2-005 — `ARRAY_BASE_URL` com `http://` para host remoto é aceita sem aviso (P2)
- **Arquivo**: `worker/src/config.ts:53-66` (`normalizeBaseUrl` aceita `http:` sem distinguir loopback).
- **Repro**: `node scripts/baseurl-matrix-ciclo13.mjs` (linhas `http:// (sem TLS)`; loopback é aceito de propósito).
- **Observado**: `ARRAY_BASE_URL=http://sandbox.array.io` → `baseUrl: "http://sandbox.array.io/api"`, `baseUrlSource: ARRAY_BASE_URL`, `warnings: []` — o `x-credmo-client-token` sairia em texto claro na rede.
- **Esperado**: `http://` é legítimo para `127.0.0.1`/`localhost` (é como o QA testa), mas para host remoto tem de avisar (ou promover a `https`).

### W2-006 — `ARRAY_POLL_*` sem teto de sanidade (P3)
- **Arquivo**: `worker/src/config.ts:73-84` (`parseSeconds` só rejeita ≤0 e não-número).
- **Repro**: `node scripts/poll-probe2-ciclo13.mjs`, caso "timeout=1e9 s, 202 infinito".
- **Observado**: `timeoutSeconds: 1000000000`, `warnings: []`, 30 requisições em 15 s e **nenhuma resposta** (abortei do lado do QA). O mesmo vale para intervalos absurdos.
- **Esperado**: aviso (e clamp, ex. 1 h) para valores fora de qualquer faixa plausível — hoje um dedo escorregado no `.env` pendura a requisição indefinidamente.

### W2-007 — path extra em `ARRAY_BASE_URL` é remendado silenciosamente (P3)
- **Arquivo**: `worker/src/config.ts:63-65`.
- **Observado**: `https://sandbox.array.io/api/v2` → `https://sandbox.array.io/api/v2/api`, sem aviso (todas as chamadas dariam 404).
- **Esperado**: aviso quando o path não é vazio nem `/api`.

### W2-008 — `GET /report/v2` com 200 e corpo vazio virá "relatório pronto" vazio (P3)
- **Arquivo**: `worker/src/array/client.ts:reportAttempt` + `array/poll.ts` (200 resolve com `body` `undefined`).
- **Repro**: `scripts/poll-probe2-ciclo13.mjs`, caso "200 com corpo VAZIO".
- **Observado**: `GET /api/array/report` responde **HTTP 200 com corpo vazio** (`""`), sem `kind` nem mensagem; `saveReportPayload` grava o vazio.
- **Esperado**: 200 sem corpo é resposta malformada do upstream — deveria virar erro tratado (`kind: "http"`/`"report_failed"`), não relatório pronto.

### W2-009 — o listener aceita qualquer coisa como evento, sem marca e sem idempotência (P3)
- **Arquivo**: `worker/src/index.ts:880-897`, `worker/src/webhook.ts:normalizeWebhookEvent`.
- **Observado**: JSON inválido (`{"broken":`), corpo vazio e `[1,2,3]` → `200 {"received":true,…}` com `eventType: "(sem eventType no corpo)"`, sem nenhum campo dizendo "não parseável"; o mesmo evento (`id: "EVT-1"`) postado 2× grava **2 linhas** em `webhook_events`.
- **Esperado**: responder 200 (a doc exige) mas marcar o evento como não-parseável, e aplicar idempotência por `reportKey`/id — recomendação da própria pesquisa (`docs/ARRAY_ENV_VARS.md` §10, "idempotência por `reportKey`/id de evento").

### W2-010 — `ARRAY_IDENTITY` JSON parcial herda o SSN da persona default (P3)
- **Arquivo**: `worker/src/personas.ts:resolveIdentity` (cada campo cai no `DEFAULT_IDENTITY`).
- **Observado**: `ARRAY_IDENTITY={}` → `source: "json"`, `label: "? ?"`, `ssn: 666230560`, DOB e endereço da BANKER COLDIRON, **sem aviso**.
- **Esperado**: aviso listando os campos preenchidos por default — senão o usuário acha que mandou a identidade dele.

### W2-011 — 404 do listener distingue "não configurado" de "token errado" (P3)
- **Arquivo**: `worker/src/index.ts:883-885`.
- **Observado**: sem `ARRAY_WEBHOOK_TOKEN` → `404 {"message":"Not Found","hint":"defina ARRAY_WEBHOOK_TOKEN para habilitar o listener"}`; com token errado → `404 {"message":"Not Found"}`. Quem sonda de fora aprende que a rota existe e está desprotegida/desligada.
- **Esperado**: a dica é útil no terminal, não na resposta HTTP.

### W2-012 — `client` e `user` são aceitos em `ARRAY_AUTH_MODE` mas não documentados (P3)
- **Arquivo**: `worker/src/config.ts:68-72` (`v === 'browser' || v === 'client' || v === 'user'`); `README.md`, `.env.example` e `wrangler.toml` só falam `server | browser`.
- **Esperado**: documentar os sinônimos ou removê-los (hoje `client` liga a trava sem que nada na doc diga isso).

### W2-013 — a suíte documentada ignora dois scripts que saem com achados (P3)
- **Arquivo**: `README.md` (bloco da suíte) e `docs/QA.md` §2.
- **Observado**: `scripts/integration-audit-ciclo5.mjs` (**3 achados**) e `scripts/pii-probe-ciclo11.mjs` (**5 achados**) não aparecem em nenhuma lista, nem seus achados conhecidos. Quem roda tudo em `scripts/` conclui que há 8 regressões.
- **Esperado**: listar os dois com o número esperado de achados (como já se faz com o `step-state-ciclo7`).

### W2-014 — portas fixas fazem a suíte reportar achados falsos (P3)
- **Arquivo**: `scripts/verify-guide-ciclo7.mjs` (`127.0.0.1:8899`), `scripts/regression-ciclo9.mjs:143` (`8931`).
- **Repro**: com outro processo ocupando 8899/8931, `verify-guide-ciclo7` sai com **5 achados** e "requisições vistas pela Array falsa: **0**"; `regression-ciclo9` sai com **8 achados** e "Y-002 NAO CORRIGIDO". Nos dois casos o veredito é falso — soltas as portas, ambos voltam a 0.
- **Esperado**: falhar explicitamente ("porta ocupada") em vez de acusar o produto. Custou uma hora deste ciclo.

---

## 3. Verificado OK (com evidência própria)

1. **Migração sem órfãos**: `grep -rn "SMARTY\|ARRAY_ENV\|clientToken"` em `*.ts/*.tsx/*.mjs` — cada
   ocorrência conferida: `SMARTY_*` só no caminho de alias, nos testes do alias e em notas
   históricas; `clientToken` é campo interno de `ClientOptions` (a UI só vê `hasServerToken`);
   `ARRAY_ENV` continua sendo variável válida. Scripts de QA, `sync-env.mjs` (lista `CANONICAL`
   com as 11 variáveis), UI, README, STATUS e docs falam os nomes novos.
2. **Alias deprecado funciona e avisa**: worker só com `SMARTY_*` sobe em `mode: "sandbox"`, com
   dois `warnings[]` e dois `[config] … DEPRECADO` no boot; badge "2 aviso(s) de config" na UI.
3. **Invariante do `ARRAY_AUTH_MODE`**: 14 rotas, 0 requisições com `x-credmo-client-token`;
   409 `auth_mode` sem informação do token; valores inválidos caem no modo seguro com aviso.
4. **Polling 202/200/204**: 202→200 (3 requisições), **204 aborta na PRIMEIRA** (1 requisição,
   502 `report_failed`), 202→204 (2 requisições), 404/500/403 no meio **não** viram "ainda
   gerando" nem timeout (viram `kind:"http"` com o status do upstream), 504 `timeout` no tempo
   certo, intervalos medidos batendo com a variável, valores inválidos → default + aviso, sem
   loop infinito em nenhum dos 21 cenários.
5. **Webhook — token**: 13 variantes de token errado, todas `404` idênticos (23 bytes, mediana
   4,1–4,4 ms); token ausente → 404; token nunca em `/api/webhooks/events`, `/api/inspector`
   (path `/api/webhooks/array/***`), D1 (`grep` no sqlite = 0) ou KV blobs.
6. **Webhook — corpo**: PII dentro do evento é redigida como no resto
   (`"ssn":"[REDACTED]:0560"`, `"dob":"[REDACTED]:1974"`, rua/CEP/e-mail/telefone só com o
   tamanho, `city`/`state` em claro); payload de 300 kB vira envelope `{_truncated, bytes,
   maxLen, preview}`; `POST /api/webhooks/simulate` grava `source: "simulated"`.
7. **Personas**: 8 formas de `ARRAY_IDENTITY` (slug, slug normalizado, inexistente, traversal,
   JSON válido/inválido/vazio, ausente) — nenhuma derruba o boot; em produção `/api/personas`
   devolve `ssn: null` + `ssnLast4`; SSN completo nunca em D1/Inspector/KV.
8. **Navegador**: 9 telas (Webhooks inclusa) × desktop 1280 e mobile 390 px — **0 achados**:
   console limpo, sem overflow horizontal, nenhuma menção a `SMARTY_AUTH_*` na UI, tema
   `light → dark`, e o seletor de simulação da tela Credit Report fecha os dois caminhos
   (`pending-then-ready` mostra score; `pending-then-failure` mostra a falha permanente).
   Screenshots em `docs/screenshots/qa13-*.png`.
9. **Suíte do README, saída real**: `139 passed` (vitest), typecheck e build limpos,
   `pass=42 fail=0` (`smoke-api.sh`), e **0 achado(s)** em `e2e-smoke`, `snippet-check`,
   `regression-ciclo3`, `guide-check-ciclo6`, `verify-guide-ciclo7` (7 requisições vistas),
   `walkthrough-ciclo7`, `kv-poison-ciclo7`, `report-audit-ciclo7 8`,
   `hostile-attrname-ciclo7`, `step-state-ciclo7`, `regression-ciclo9` (Y-001…Y-007 todos
   CORRIGIDO), `step4-stuck-ciclo9`.
10. **Pré-existentes confirmados**: `integration-audit-ciclo5` = **3 achados**,
    `pii-probe-ciclo11` = **5 achados**. São **inócuos e não viraram defeito**:
    - `integration-audit-ciclo5` audita um Guia de **4 passos**; o Guia tem **6** desde
      `5125690` (ciclo 6). O ciclo 13 só trocou uma string de mensagem dentro do script
      (`git show d9c86ec -- scripts/integration-audit-ciclo5.mjs`: uma linha,
      `ARRAY_CLIENT_TOKEN` → `ARRAY_SERVER_TOKEN`), logo os 3 achados são expectativa velha
      ("esperados 4 passos, encontrados 6", "sessão limpa deveria mostrar 0/4" e o `expiresAt`
      que a própria tela já marca como invenção da POC).
    - `pii-probe-ciclo11.mjs` está **intocado** desde `c83f61a` (pré-ciclo 13) e o
      `worker/src/redact.ts` que ele audita **não** foi modificado por `d9c86ec` (não aparece
      no `git show --stat`). Dos 5: 4 são sentinelas dentro dos envelopes `{_truncated,preview}`
      e `{raw}` (por design: o Inspector preserva a forma) e no sqlite bruto da tabela `users`
      (por design, documentado no README); o 5º é a **mensagem de erro do upstream não
      redigida** — função pura de `redact.ts`, que reproduzi idêntica rodando o probe contra o
      commit anterior (`4a5ad51`, worktree isolada). Nenhum deles vaza o token do webhook nem
      PII nova das rotas do ciclo 13 (conferido: os eventos de webhook **são** redigidos).

---

## 4. Estado dos 14 defeitos (fechado no ciclo 15/16)

Todos foram corrigidos. Esta tabela existe para não se ler a lista acima como backlog aberto:

| ID | Onde foi fechado |
|---|---|
| W2-001 | `worker/src/config.ts` — ambiente **derivado do host** (`classifyHost`, `arrayEnvSource`, `hostClass`, `envMismatch`); `wrangler.toml` não fixa mais `ARRAY_ENV` |
| W2-002 | `worker/src/config.ts` + `worker/src/personas.ts` — identidade **descartada** (`DISCARDED_IDENTITY`, invariante testada) e `POST /api/seed` → `409 identity_discarded` |
| W2-003 | `worker/src/webhook.ts` `maskListenerUrl` — `/api/status`, `/api/webhooks/config` e a tela mostram `…/array/***` |
| W2-004 | **não é corrigível pela aplicação** — documentado como limitação conhecida no `README.md` §Segurança, no `.env.example` e em `docs/QA.md` §Ciclo 15 |
| W2-005 / W2-007 | avisos em `normalizeBaseUrl` (`http://` remoto; path extra além de `/api`) |
| W2-006 | `MAX_POLL_INTERVAL_S=60` / `MAX_POLL_TIMEOUT_S=3600` com clamp e aviso |
| W2-008 | `worker/src/array/client.ts` — `200` sem corpo → `502 kind:"http"` |
| W2-009 | `normalizeWebhookEvent` (`parseable:false`) + `dedupe_key` (migração `0003`) |
| W2-010 | aviso listando os campos herdados da persona default |
| W2-011 | 404 do listener **idêntico** com e sem token configurado |
| W2-012 | `client`/`user` documentados como aliases de `browser` |
| W2-013 | os dois scripts entraram na suíte do `README.md` e em `docs/QA.md` §2.1, com o número esperado de achados e o motivo |
| W2-014 | `scripts/free-port.mjs`; nenhum script da suíte abre porta fixa (medido: com 8901 ocupada, `hostile-attrname-ciclo7` cai em porta efêmera e sai em 0 achados) |

## 5. Top 5 do próximo ciclo (escrito no ciclo 14; já executado)

1. **W2-002** — esvaziar a identidade de verdade em produção (ou recusar `/api/seed`); é o único
   achado com risco de PII real saindo para um host de produção.
2. **W2-001** — decidir quem manda: ou `wrangler.toml` para de fixar `ARRAY_ENV`, ou o README
   para de prometer que o host da base liga o ambiente de produção. Hoje o Dashboard diz
   "sandbox" enquanto as chamadas vão para `array.io`.
3. **W2-003 + W2-004** — mascarar o último segmento da `ARRAY_LISTENER_URL` em `/api/status`, em
   `/api/webhooks/config` e na tela, e trocar "nunca logado" por uma ressalva honesta sobre
   access logs (a fraqueza inerente do segredo-no-path).
4. **W2-005 + W2-006 + W2-007** — endurecer o parsing de configuração: aviso para `http://`
   remoto, clamp/aviso para `ARRAY_POLL_*` absurdo, aviso para path extra na base URL.
5. **W2-013 + W2-014** — pôr `integration-audit-ciclo5` e `pii-probe-ciclo11` na suíte
   documentada com o número esperado de achados, e fazer os scripts que abrem porta fixa
   (8899, 8931) falharem com "porta ocupada" em vez de culpar o produto.
