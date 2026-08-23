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
| `bash scripts/smoke-api.sh` | 40 casos HTTP de abuso contra `:8787` (payload de 2 MB, JSON quebrado, chaves inexistentes, path traversal, clamp de paginação, registro do mock no `GET /report`, TTL/refresh do cache de userToken) | `pass=40 fail=0` |
| `PW_CHROMIUM=… node scripts/e2e-smoke.mjs` | percorre as 8 telas (inclui `/integracao`: 4 passos, diagrama, alternância curl/TypeScript, estado da sessão), roda o fluxo Enrollment→KBA→Report→Alerts, testa reload, foco por Tab e mobile 390px; grava `docs/screenshots/` | lista de achados (vazia = ok) |
| `PW_CHROMIUM=… node scripts/snippet-check.mjs` | **valida o snippet do Playground de verdade**: copia o snippet real de 5 componentes da UI, cola em HTML em branco, sobe um http-server local e abre no Chromium; afere HTML válido, custom element no DOM, ordem dos scripts, `appKey` de 36 chars, listener de `array-event` e ausência de `SyntaxError`. Desde o ciclo 5 também cola um snippet **hostil** (`true" onload="alert(1)` num atributo + nome de atributo inválido via `prompt`) e afere que nenhum handler executável chega ao DOM, que a árvore não desloca e que a linha `userToken` sai sempre com a explicação de origem/TTL | `snippet-check: 0 achado(s)`; artefatos em `scripts/.tmp-snippets/` |
| `PW_CHROMIUM=… node scripts/regression-ciclo3.mjs` | checagens de navegador dos IDs V-005…V-020 (labels, auto-load, tiles, base em mock, hint do Inspector, catálogo, overflow mobile 8/8 — com `/integracao` —, console limpo) + `GET /api/status` por visita (W-014) e se o input de atributo ainda estoura (V-018/W-015) | uma linha por ID |
| `npm --workspace worker run test` | vitest (58 testes; inclui namespace do cache de userToken, idade por calendário e aritmética do relatório) | 58 passed |
| `npm --workspace worker run typecheck` / `npm --workspace web run build` | tsc + vite | sem erros |

`scripts/.tmp-snippets/` é recriado a cada execução (HTML + PNG por componente) e não deve ser
comitado.

## 3. Passos não-óbvios

- **Scripts com `import { chromium } from '@playwright/test'` só rodam de dentro do repo.**
  Um `.mjs` em `/tmp` falha com `ERR_MODULE_NOT_FOUND` — o pacote está em `node_modules` da raiz.
- **`localStorage` é por contexto do Playwright.** Cada `newContext()` começa sem sessão, então
  todo script que precisa de `clientKey`/`userToken` tem que clicar em **Semear usuário demo** no
  Dashboard antes de navegar para KBA/Report/Alerts.
- **Modo SANDBOX para testar caminhos de erro**: suba um segundo worker sem tocar no `.dev.vars`:
  ```bash
  cd worker && npx wrangler dev --local --port 8788 \
    --var SMARTY_AUTH_ID:11111111-2222-4333-8444-555555555555 \
    --var SMARTY_AUTH_TOKEN:SUPERSECRETTOKEN123
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
  - o worker de sandbox em `:8788` compartilha o KV local, mas **não** enxerga mais os tokens do
    mock: a mesma requisição volta `502 kind:"blocked"` em vez de `200 cached:true` (era o W-001).
    Repro em um comando: mint no `:8787`, mesma requisição no `:8788`.
