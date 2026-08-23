# POC Array.com — Plano de Arquitetura

## Objetivo
Visualizar e interagir, em um frontend, com as funcionalidades da API da Array
(https://array.com/) — incluindo os **Web Components** embutíveis — para entender
como integrar ao nosso produto.

## Stack (tudo local)
| Camada | Tecnologia |
|---|---|
| Backend | Hono.js rodando em Cloudflare Workers (`wrangler dev --local`) |
| Banco | Cloudflare D1 (SQLite local via Miniflare) |
| Cache/estado | Cloudflare KV (local) para cache de user tokens |
| Frontend | React + Vite + TypeScript |
| Proxy | Vite dev server com proxy `/api` -> Worker (`localhost:8787`) |

## Princípios
1. **Credenciais nunca no browser.** `SMARTY_AUTH_ID` / `SMARTY_AUTH_TOKEN`
   ficam apenas no Worker (`.dev.vars`). O frontend só recebe `userToken`
   de curta duração para alimentar os Web Components.
2. **Modo mock.** Sem credenciais a POC roda 100% com fixtures, para que o
   frontend seja explorável antes de o usuário colar as chaves no `.env`.
   Com credenciais, o mesmo endpoint chama o sandbox da Array.
3. **Auditoria.** Toda chamada à Array é registrada em D1 (`api_calls`) e
   exibida em uma aba "API Inspector" no frontend (request/response/latência).

## Estrutura
```
worker/            # Hono + Wrangler + D1
  src/index.ts     # app Hono, rotas
  src/array/       # cliente da API Array (+ mocks)
  src/db/          # schema, queries
  migrations/      # SQL D1
web/               # React + Vite
  src/pages/       # telas por funcionalidade
  src/components/  # wrappers dos Array Web Components
```

## Telas previstas
1. **Dashboard** — status de credenciais, modo (mock/sandbox), usuários criados.
2. **Enrollment** — formulário de cadastro de consumidor (nome, endereço, SSN, DOB).
3. **Identity / KBA** — perguntas de verificação de identidade e respostas.
4. **Credit Report / Score** — dados brutos + Web Components embutidos.
5. **Monitoring & Alerts** — alertas de monitoramento de crédito.
6. **Web Components Playground** — cada componente da Array com seus atributos
   editáveis ao vivo.
7. **API Inspector** — log de requests/responses gravado em D1.

## Ciclos fix-and-validate
- Subagent **DEV**: implementa/corrige.
- Subagent **VALIDATE**: roda build/testes/smoke HTTP, revisa e devolve lista de
  defeitos priorizada.
- Commit descritivo ao final de cada ciclo.
