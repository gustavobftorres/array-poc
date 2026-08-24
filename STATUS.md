# STATUS — POC Array (checkpoint de sessão)

**Última atualização:** 2026-08-23 20:20 BRT
**Branch:** `claude/array-api-poc-cloudflare-bq7r2u`
**Motivo do checkpoint:** limite de uso de IA da sessão atingido (reseta 22:40 UTC / 19:40 BRT).

## 1. Onde parou

6 ciclos fix-and-validate concluídos (DEV alterna com VALIDATE adversarial):

| Ciclo | Entrega | Commit |
|---|---|---|
| 0 | Scaffold do monorepo + plano | `98c7a50` |
| 0 | Pesquisa da API da Array | `e5e476d` |
| 1 | POC completa em modo mock (backend + 7 telas) | `76b3751` |
| 2 | Validação com navegador: 1 P0 + 7 P1 + 12 P2 | `1c8392b` |
| 3 | Correções: snippet colável, Inspector à prova de payload, fixtures coerentes | `3aed292` |
| 4 | Regressão: 17/20 corrigidos, 4 P1 novos | `df86dd1` |
| 5 | Cache isolado por modo + tela Guia de Integração | `2a091ea` |
| 6 | Regressão: **18/18 corrigidos, 0 regressões**, 13 defeitos novos | este commit |

**Estado atual da POC:** roda 100% local, todas as suítes verdes —
58 testes vitest, smoke-api 40/40, e2e sem achados (8 telas, mobile 8/8),
snippet-check 20/20 na fase hostil, typecheck e build limpos.

**Veredito do QA:** *"Sim, dá para entregar como POC de avaliação."* A fronteira do
segredo está implementada (client token só no worker, apenas `ssn_last4` no D1,
Inspector redigido), os caminhos de erro são reais e a POC é honesta sobre o que é
inferência. O gargalo que sobra é o **conteúdo prescritivo do Guia de Integração**
(X-001/X-002/X-003): é o artefato que sai da POC para o código do usuário, e hoje
o `curl` não é colável e o body omite `appKey`.

## 2. O que falta (Top 5 do ciclo 7, em `docs/VALIDATION_CICLO5.md`)

1. **X-002 + X-001** — `appKey` no body dos 3 passos do Guia e retirar o comentário
   `# SEGREDO` de dentro do valor do header no `curl` (hoje o comando não cola).
2. **X-003** — fechar o fluxo no Guia: `POST /report/v2` → `GET /report/v2` com retry.
3. **X-004 + X-005** — as 2 contradições que sobraram no relatório: janela de 6 meses
   das consultas e idade da conta mais antiga por calendário.
4. **X-006** — estado por passo de verdade em `/integracao` (KBA ≠ userToken ≠
   componente montado; hoje o contador vai a 4/4 sem componente nenhum renderizado).
5. **X-007 + X-008** — recusar nomes de atributo `on*` no snippet e tratar `scope`
   ausente no cache como miss.

Depois: os P3 (X-010 a X-013).

**Pendências estruturais (não resolvíveis aqui):** `array.io` e `embed.sandbox.array.io`
são bloqueados pelo proxy deste ambiente, então os web components nunca renderizaram
de fato e os paths de alerts/monitoring/scoretracker seguem `// UNVERIFIED`. Ambos
se resolvem na sua máquina com credenciais reais.

## 3. Como retomar

```bash
# Rodar a POC
cd /home/user/array-poc
npm install
npm --workspace worker run db:migrate
npm run dev                      # worker :8787 + web :5173

# Usar a API real da Array: preencha as duas chaves e reinicie
cp .env.example .env   # preencha SMARTY_AUTH_ID (appKey) e SMARTY_AUTH_TOKEN (client token)
# o `npm run dev` roda scripts/sync-env.mjs e gera worker/.dev.vars a partir do .env

# Suíte de QA (ver docs/QA.md)
npm --workspace worker run test
bash scripts/smoke-api.sh
PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node scripts/e2e-smoke.mjs
PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node scripts/snippet-check.mjs
```

**Comando exato para retomar o loop de ciclos:**

```
/loop Continue os ciclos fix-and-validate da POC da Array até 02:00 BRT: 1 subagent DEV corrige o Top 5 de docs/VALIDATION_CICLO5.md, 1 subagent VALIDATE audita a regressão com navegador, commit descritivo + push ao fim de cada ciclo, e um resumo de 2-3 linhas do que melhorou.
```
