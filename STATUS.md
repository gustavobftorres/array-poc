# STATUS — POC Array (entrega da sessão)

**Última atualização:** 2026-08-24 (ciclo 15/16)
**Branch:** `claude/array-api-poc-cloudflare-bq7r2u` · **último commit:** ver `git log -1`
**Estado:** entregável. Backlog de defeitos zerado (0 P0 / 0 P1 / 0 P2 / 0 P3).

## 1. O que foi entregue

POC local completa para avaliar a integração da Array (API + web components):

- **Backend** — Hono.js em Cloudflare Workers (`wrangler dev --local`), D1 para
  persistência e auditoria, KV para cache de user token isolado por
  modo/appKey/baseUrl/TTL/fingerprint do client token.
- **Cliente da API Array** — `user/v2`, `authenticate/v2`, `authenticate/v2/usertoken`,
  `report/v2` (POST/GET/PUT), scoretracker, alerts, monitoring. Timeout 12 s,
  3 tentativas com backoff, `blocked -> 502` e `timeout -> 504`.
- **Polling do relatório pelo critério documentado** (`202` = ainda gerando, `200` = pronto,
  `204` = falha permanente), com `ARRAY_POLL_INTERVAL`/`ARRAY_POLL_TIMEOUT` (segundos,
  tetos de 60 s e 3600 s) e `504 kind:"timeout"` citando a variável.
- **Trava do `ARRAY_AUTH_MODE`** — em `browser` o `x-credmo-client-token` **nunca** é anexado:
  a chamada falha com `409 kind:"auth_mode"` em vez de vazar o segredo.
- **Listener de webhook** (`POST /api/webhooks/array/<ARRAY_WEBHOOK_TOKEN>`) com segredo no path
  comparado em tempo constante, 404 idêntico para token errado e para listener não configurado,
  corpo não-objeto marcado `parseable: false` e **idempotência** por id de evento (senão
  `eventType+reportKey+clientKey`, coluna `dedupe_key`, migração `0003`), mais tela própria e
  `POST /api/webhooks/simulate` para exercitar sem a Array.
- **Fronteira sandbox × produção real** — o ambiente efetivo é **derivado do host** de
  `ARRAY_BASE_URL` (`ARRAY_ENV` é só fallback, e `wrangler.toml` não o fixa mais);
  `/api/status` expõe `arrayEnvSource`, `hostClass` e `envMismatch`; em produção a
  `ARRAY_IDENTITY` é **descartada** (config sem `ssn`/`dob`/endereço), `POST /api/seed` responde
  `409 kind:"identity_discarded"` e `/api/personas` devolve `ssn: null`.
- **Modo mock determinístico** — a POC é 100% explorável sem credenciais; as fixtures
  derivam do clientKey e a aritmética do relatório fecha em todas as dobras.
- **Frontend React+Vite — 9 telas:** Dashboard, Enrollment, KBA, Credit Report, Webhooks,
  Alerts, **Guia de Integração**, Web Components Playground e API Inspector.
- **Segurança** — client token nunca sai do worker; `users` guarda apenas
  `ssn_last4`; `api_calls` redige SSN, tokens e PII de identidade preservando a
  forma (`"firstName":"[REDACTED]:8 chars"`, `"dob":"[REDACTED]:1988"`).

**Duas peças centrais para o objetivo declarado:**
1. **Guia de Integração** (`/integracao`) — o encadeamento das 6 chamadas com a
   fronteira SERVIDOR × BROWSER, o que o seu backend implementa em cada passo,
   snippets em `curl` e TypeScript **testados executando**, o estado real da
   sessão por passo e selo verificado / `// UNVERIFIED` por afirmação.
2. **Playground** — os 11 componentes com atributos editáveis ao vivo e snippet
   colável (validado abrindo num HTML em branco no Chromium).

## 2. Como rodar

```bash
cd array-poc
npm install
npm --workspace worker run db:migrate
npm run dev                        # worker :8787 + web :5173  (modo MOCK)
```

**Para usar a API real da Array:**
```bash
cp .env.example .env               # preencha ARRAY_APP_KEY e ARRAY_SERVER_TOKEN
npm run dev                        # o hook predev gera worker/.dev.vars a partir do .env
```

Suíte de QA completa: ver `docs/QA.md` (pré-requisitos, comandos e saída esperada).

## 3. Ciclos executados (15)

| # | Entrega | Commit |
|---|---|---|
| 0 | Scaffold + pesquisa da API | `98c7a50`, `e5e476d` |
| 1–2 | POC em modo mock + validação com navegador (1 P0, 7 P1) | `76b3751`, `1c8392b` |
| 3–4 | Snippet colável, Inspector à prova de payload, fixtures coerentes | `3aed292`, `df86dd1` |
| 5–6 | Cache isolado por modo + Guia de Integração | `2a091ea`, `dc54ba3` |
| 7–8 | Guia com artefatos coláveis e fluxo do relatório | `5125690`, `32821a4` |
| 9–10 | Acabamento de credibilidade + README auditado em clone limpo | `2960f7d`, `bc81fd5` |
| 11–12 | PII redigida, `.env` com uso real, backlog zerado | `81267b1`, `c83f61a` |
| 13 | Contrato de variáveis corrigido (`ARRAY_*`, `SMARTY_*` deprecado), `ARRAY_BASE_URL` normalizada, trava do `ARRAY_AUTH_MODE`, polling 202/200/204 com `ARRAY_POLL_*`, personas de `ARRAY_IDENTITY` e **listener de webhook** com tela nova | `d9c86ec` |
| 14 | QA adversarial da migração: 14 defeitos (2 P1, 3 P2, 9 P3) em `docs/VALIDATION_CICLO13.md` | `45a543e` |
| 15 | **Fronteira sandbox/produção real** (ambiente derivado do host, identidade descartada em produção, seed recusado) + **token do webhook mascarado** na listener URL, tetos de `ARRAY_POLL_*`, avisos de `http://` remoto e path extra, listener idempotente e porta livre nos scripts de QA | `392c1b9` |
| 16 | Documentação alinhada ao código (README, `.env.example`, `docs/ARRAY_ENV_VARS.md`, `docs/QA.md`, este STATUS) | este |

### As variáveis (contrato atual)

| Variável | Papel |
|---|---|
| `ARRAY_APP_KEY` | `appKey` da Array, no **corpo** das chamadas e no HTML dos componentes (público por design) |
| `ARRAY_SERVER_TOKEN` | segredo de servidor, header `x-credmo-client-token` (alias: `ARRAY_CLIENT_TOKEN`) |
| `ARRAY_BASE_URL` | host da API; normaliza `/api`. **Quando definida, o host decide o ambiente** |
| `ARRAY_ENV` | `sandbox` \| `production` — **fallback**, só decide sem `ARRAY_BASE_URL` (ou com loopback) |
| `ARRAY_AUTH_MODE` | `server` (default) \| `browser` (aliases `client`, `user`) — trava de header |
| `ARRAY_IDENTITY` | persona de sandbox (slug ou JSON inline); **descartada em produção** |
| `ARRAY_PRODUCT_CODE` | `productCode` default de `POST /report/v2` (`credmo3bReportScore`) |
| `ARRAY_POLL_INTERVAL` / `ARRAY_POLL_TIMEOUT` | polling do relatório, em segundos (tetos 60 s / 3600 s) |
| `ARRAY_LISTENER_URL` | URL do seu listener, entregue **à mão** ao Customer Success; exibida elidida |
| `ARRAY_WEBHOOK_TOKEN` | segredo **gerado por você**, no path do listener |
| `SMARTY_AUTH_ID` / `SMARTY_AUTH_TOKEN` | aliases **DEPRECADOS** (nomes errados), aceitos com aviso |

Suítes ao final: **163 testes** (vitest), smoke-api **42/42**, typecheck e build limpos, e
**0 achados** em todos os `.mjs` da suíte — exceto os dois com achados conhecidos e inócuos,
`integration-audit-ciclo5` (**3**) e `pii-probe-ciclo11` (**5**), explicados em `docs/QA.md` §2.

## 4. O limite estrutural (leia antes de amanhã)

O egress deste ambiente **bloqueia `array.io` e `embed[.sandbox].array.io`**. Consequências:

- **Nenhum web component renderizou de fato.** O wrapper degrada para placeholder
  com o snippet, e o passo 4 do Guia só foi exercitado com o CDN stubado. A POC
  prova o encadeamento de tokens, o modelo de segredos e a forma dos erros —
  **não prova nada visual**.
- O envelope real do `POST /user/v2` e o KBA de sandbox (perguntas do bureau real,
  não fixtures) são as duas coisas mais prováveis de exigir ajuste.

### O que continua INFERIDO (`// UNVERIFIED`) — confira com o portal em mão

| Inferência | Onde está marcada | Como confirmar |
|---|---|---|
| **4 paths REST**: `GET /alert/v2`, `GET /alert/v2/{id}`, `GET /monitoring/v2`, `GET /report/v2/scoretracker` | `// UNVERIFIED path` em `worker/src/array/client.ts` | OpenAPI/Postman do portal (§7 da pesquisa). Um path errado dá 404 mapeado para erro tratado, não tela branca; a correção é uma linha por método |
| **Unidade em segundos** do `ARRAY_POLL_INTERVAL` / `ARRAY_POLL_TIMEOUT` | `worker/src/config.ts` (`DEFAULT_POLL_*`) e `poll.unitInferred: true` em `/api/status` | a Array não publica valores recomendados; só o critério `202/200/204` é verificado |
| **Token no path do webhook** (`/api/webhooks/array/<token>`) como autenticação | `worker/src/webhook.ts` e `webhook.secretInPathInferred: true` em `/api/status` | é interpretação desta POC: a Array **não** assina os webhooks nem manda header customizado (isso sim é verificado). Pergunte ao Customer Success se há HMAC ou faixa de IP |
| **DOB, SSN e endereço de 3 das 4 personas** (`dalton-lot`, `denise-hennessy`, `donald-blair`) | `worker/src/personas.ts` (`confidence: 'unverified'`, `note` por persona; a UI mostra o selo) | só **BANKER COLDIRON** tem o pareamento nome↔DOB↔SSN↔endereço de fonte de primeira mão. Os outros três têm o **nome** verificado e os demais campos são placeholder na faixa `666…` — troque pelos da sua conta |
| **Nome e formato de todas as variáveis `ARRAY_*`** | `docs/ARRAY_ENV_VARS.md` | não existe SDK nem `.env` de referência da Array (0 resultados em GitHub/npm/PyPI); os **conceitos** são verificados, as **grafias** são convenção local |

**Ordem recomendada amanhã:** liberar egress → colar as chaves no `.env` →
rodar enrollment → KBA → usertoken → report com identidade de sandbox →
montar um componente → só então conferir os 4 paths inferidos contra o OpenAPI
da Array (pegue no portal; `docs.array.com` é password-gated).

## 5. Ponto de partida para retomar

Não há defeitos abertos (os 14 do ciclo 14 foram fechados no ciclo 15; a documentação foi
realinhada no ciclo 16). O que faria sentido num próximo ciclo, em ordem de valor:

1. Substituir os **4 paths `// UNVERIFIED`** pelos reais, com o OpenAPI em mão (tabela §4).
2. Confirmar com o Customer Success da Array: existe HMAC/assinatura ou faixa de IP para
   webhooks? Isso derrubaria a dependência de segredo-no-path — que hoje é a única
   autenticação possível e cujo custo é aparecer nos **access logs** (README §Segurança).
3. Trocar os **placeholders de DOB/SSN/endereço** das três personas não verificadas pelas
   identidades de sandbox da sua conta.
4. Mapear o envelope real do `GET /report/v2` para o view model da tela
   (hoje o client repassa o payload cru; em sandbox alguns campos virão vazios).
5. Renderizar os componentes de verdade e capturar o formato real de `e.detail`
   por componente no painel de eventos do Playground.
6. Disputas — não documentadas em fonte nenhuma; lacuna admitida na POC.

**Comando para retomar o loop de ciclos:**

```
/loop Continue os ciclos fix-and-validate da POC da Array: 1 subagent DEV ataca o item 1 da secao "Ponto de partida para retomar" do STATUS.md, 1 subagent VALIDATE audita com navegador, commit descritivo + push ao fim de cada ciclo, e um resumo de 2-3 linhas do que melhorou.
```
