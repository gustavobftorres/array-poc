# POC Array.com — API + Web Components (100% local)

POC para **ver e mexer** nas funcionalidades da [Array](https://array.com/) — enrollment,
verificação de identidade (KBA), relatório de crédito, alertas e os **Web Components**
embutíveis — rodando inteiramente na sua máquina.

| Camada | Stack |
|---|---|
| Backend | Hono em Cloudflare Workers (`wrangler dev --local`) + D1 (SQLite) + KV |
| Frontend | React + Vite + TypeScript, CSS próprio (sem libs de UI) |
| Proxy | dev server do Vite: `/api` → `http://localhost:8787` |

Dois modos, mesmos endpoints:

- **MOCK** (padrão, sem credenciais): fixtures determinísticas — score 712, 12 meses de
  histórico, relatório 3 bureaus com tradelines/consultas/cobranças, 4 perguntas de KBA,
  6 alertas. Nada de rede.
- **SANDBOX** (com credenciais): as mesmas rotas chamam `https://sandbox.array.io/api`.

## Como rodar

```bash
# 1. dependências (na raiz do repo)
npm install

# 2. migrações do D1 local
npm run db:migrate

# 3. worker (:8787) + web (:5173) juntos
npm run dev
```

Abra <http://localhost:5173>. Comece pelo Dashboard → **Semear usuário demo**, ou percorra
Enrollment → KBA → Credit Report → Alerts → Web Components → API Inspector.

Comandos úteis:

```bash
npm --workspace worker run test        # vitest (28 testes)
npm --workspace web run build          # tsc -b + vite build
npm --workspace worker run typecheck   # tsc --noEmit
npm --workspace worker run dev         # só o worker
npm --workspace web run dev            # só o front
```

## Onde colar as chaves

```bash
cp .env.example .env                        # referência para você
cp worker/.dev.vars.example worker/.dev.vars # este é o que o wrangler lê
```

Preencha `worker/.dev.vars` e **reinicie o worker**:

```ini
SMARTY_AUTH_ID=<appKey da Array>        # UUID de 36 chars
SMARTY_AUTH_TOKEN=<client token>        # segredo, fica só no worker
ARRAY_ENV=sandbox                       # sandbox | production
```

Se **qualquer um dos dois** estiver vazio, a POC cai automaticamente em modo MOCK. O banner
no topo do frontend sempre mostra o modo vigente (`GET /api/status`).

## Nota honesta sobre os nomes SMARTY_*

**A API da Array não usa credenciais Smarty.** Não existe header `Smarty-Auth-Id` /
`Smarty-Auth-Token` em nenhum endpoint da Array — isso pertence à
[Smarty](https://www.smarty.com/), fornecedora de validação de endereços, sem relação com a
Array. Detalhes e fontes em [`docs/ARRAY_API_RESEARCH.md`](docs/ARRAY_API_RESEARCH.md) §2.

Como o pedido exigia esses nomes de variável, eles foram **mapeados** para as credenciais
reais da Array:

| Variável do projeto | Credencial real da Array | Como é usada |
|---|---|---|
| `SMARTY_AUTH_ID` | `appKey` | UUID de 36 chars, **público por design** (vai no HTML dos componentes) |
| `SMARTY_AUTH_TOKEN` | client token | header `x-credmo-client-token`, **segredo — nunca vai ao browser** |

Aliases com os nomes reais também funcionam e têm prioridade menor:
`ARRAY_APP_KEY` e `ARRAY_CLIENT_TOKEN`.

## Rotas do worker

| Rota | Array por trás |
|---|---|
| `GET /api/health`, `GET /api/status` | — (status/modo; só booleanos, nunca o segredo) |
| `POST /api/seed` | cria consumidor demo + token + relatório + alertas |
| `POST /api/array/user` | `POST /user/v2` (enrollment → `clientKey`) |
| `GET /api/array/user` | `GET /user/v2` (resolve userId por `x-credmo-user-token`) |
| `GET /api/array/users` | lista o D1 local |
| `GET /api/array/authenticate` | `GET /authenticate/v2` (perguntas KBA + `authToken`) |
| `POST /api/array/authenticate` | `POST /authenticate/v2` (respostas → `userToken`) |
| `POST /api/array/usertoken` | `POST /authenticate/v2/usertoken` (token dos componentes) |
| `POST /api/array/report` | `POST /report/v2` (→ `reportKey` + `displayToken`) |
| `GET /api/array/report` | `GET /report/v2` |
| `PUT /api/array/report` | `PUT /report/v2` (renova `displayToken`) |
| `GET /api/array/scoretracker` | `GET /report/v2/scoretracker` — **path inferido** |
| `GET /api/array/alerts`, `/alerts/:id` | `GET /alert/v2` — **paths inferidos** |
| `GET /api/array/monitoring` | `GET /monitoring/v2` — **path inferido** |
| `GET /api/inspector`, `DELETE /api/inspector` | log de auditoria em D1 |

Tudo marcado como inferido tem um comentário `// UNVERIFIED path` em
`worker/src/array/client.ts` — a documentação da Array é fechada por senha.

## Segurança da POC

- O client token existe **apenas** no worker. O frontend recebe só `userToken` de curta duração.
- SSN é gravado no D1 apenas como **últimos 4 dígitos** (`users.ssn_last4`).
- Toda chamada a `/api/*` vai para a tabela `api_calls` com SSN e tokens **redigidos**
  (`worker/src/redact.ts`) — visível na tela API Inspector.

## Limitações conhecidas neste ambiente

`array.io`, `sandbox.array.io` e `embed[.sandbox].array.io` são **bloqueados pelo proxy de
egresso**. Consequências:

- Em modo SANDBOX as chamadas voltam com erro tratado (`kind: "blocked"`) e uma dica no
  frontend — nunca uma tela branca.
- No Playground, os Web Components mostram um placeholder explicando o que apareceria, além
  do snippet HTML pronto para copiar para uma rede liberada.
- Toda a validação funcional foi feita em modo MOCK.
