# STATUS — POC Array (entrega da sessão)

**Última atualização:** 2026-08-24 00:25 BRT
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

## 3. Ciclos executados (13)

| # | Entrega | Commit |
|---|---|---|
| 0 | Scaffold + pesquisa da API | `98c7a50`, `e5e476d` |
| 1–2 | POC em modo mock + validação com navegador (1 P0, 7 P1) | `76b3751`, `1c8392b` |
| 3–4 | Snippet colável, Inspector à prova de payload, fixtures coerentes | `3aed292`, `df86dd1` |
| 5–6 | Cache isolado por modo + Guia de Integração | `2a091ea`, `dc54ba3` |
| 7–8 | Guia com artefatos coláveis e fluxo do relatório | `5125690`, `32821a4` |
| 9–10 | Acabamento de credibilidade + README auditado em clone limpo | `2960f7d`, `bc81fd5` |
| 11–12 | PII redigida, `.env` com uso real, backlog zerado | `81267b1`, `c83f61a` |
| 13 | Contrato de variáveis corrigido (`ARRAY_*`, `SMARTY_*` deprecado), `ARRAY_BASE_URL` normalizada, trava do `ARRAY_AUTH_MODE`, polling 202/200/204 com `ARRAY_POLL_*`, personas de `ARRAY_IDENTITY` e **listener de webhook** com tela nova | este |

Suítes ao final: **139 testes**, smoke-api **42/42**, e2e/snippet-check/guide-check/
kv-poison/report-audit/hostile-attrname/regression × 3 — **todos em 0 achados**.

## 4. O limite estrutural (leia antes de amanhã)

O egress deste ambiente **bloqueia `array.io` e `embed[.sandbox].array.io`**. Consequências:

- **Nenhum web component renderizou de fato.** O wrapper degrada para placeholder
  com o snippet, e o passo 4 do Guia só foi exercitado com o CDN stubado. A POC
  prova o encadeamento de tokens, o modelo de segredos e a forma dos erros —
  **não prova nada visual**.
- **4 paths continuam inferidos** (`// UNVERIFIED` em `worker/src/array/client.ts`):
  `/alert/v2`, `/alert/v2/{id}`, `/monitoring/v2`, `/report/v2/scoretracker`.
- O envelope real do `POST /user/v2` e o KBA de sandbox (perguntas do bureau real,
  não fixtures) são as duas coisas mais prováveis de exigir ajuste.

**Ordem recomendada amanhã:** liberar egress → colar as chaves no `.env` →
rodar enrollment → KBA → usertoken → report com identidade de sandbox →
montar um componente → só então conferir os 4 paths inferidos contra o OpenAPI
da Array (pegue no portal; `docs.array.com` é password-gated).

## 5. Ponto de partida para retomar

Não há defeitos abertos. O que faria sentido num próximo ciclo:

1. Substituir os 4 paths `// UNVERIFIED` pelos reais, com o OpenAPI em mão.
2. Mapear o envelope real do `GET /report/v2` para o view model da tela
   (hoje o client repassa o payload cru; em sandbox alguns campos virão vazios).
3. Renderizar os componentes de verdade e capturar o formato real de `e.detail`
   por componente no painel de eventos do Playground.
4. Webhooks (§3.10 da pesquisa) — nada implementado.
5. Disputas — não documentadas em fonte nenhuma; lacuna admitida na POC.

**Comando para retomar o loop de ciclos:**

```
/loop Continue os ciclos fix-and-validate da POC da Array: 1 subagent DEV ataca o item 1 da secao "Ponto de partida para retomar" do STATUS.md, 1 subagent VALIDATE audita com navegador, commit descritivo + push ao fim de cada ciclo, e um resumo de 2-3 linhas do que melhorou.
```
