# VALIDATE — Ciclo 9 (QA adversarial · último ciclo da sessão)

Commit sob teste: `2960f7d` ("fix: acabamento de credibilidade — telas param de afirmar o que nao
aconteceu"). Modo MOCK, worker `:8787` + web `:5173`, Chromium 1194 via `PW_CHROMIUM`.

Este ciclo tinha quatro alvos: (1) regredir os 7 `Y-*` **com evidência própria**, com atenção
especial a se o Y-004 não passou a recusar atributo que a Array realmente usa; (2) **seguir o README
literalmente num clone limpo**, porque ele é o primeiro contato do avaliador; (3) caracterizar o
achado pendente do `step-state-ciclo7`; (4) varredura final de segredo/PII. Escrevi **dois scripts
novos** e independentes:

| Script novo | O que faz de diferente |
|---|---|
| `scripts/regression-ciclo9.mjs` | um veredito por `Y-*`, cada um por evidência produzida no próprio arquivo: transpila `worker/src/dates.ts` com `esbuild` e varre **37 datas** (dias 29/30/31, bissexto, virada de ano); recomputa a janela de consultas de 8 relatórios novos do JSON cru; extrai o `curl` do passo 6 **da tela renderizada** e o executa contra um **upstream próprio** que responde 401 e 200-vazio; e cruza a recusa de nomes de atributo com a **lista completa de atributos reais da Array** (§4.3 da pesquisa) para provar que o Y-004 não bloqueou nada legítimo |
| `scripts/step4-stuck-ciclo9.mjs` | caracteriza o `componentMountedAt` preso em 3 cenários encadeados no mesmo `localStorage`: CDN stubado e componente montado → **Desmontar** (elemento fora do DOM) → aba nova com o CDN **bloqueado** |

Suítes desta rodada, o bloco de comandos do README rodado **verbatim**: `worker test` **65/65** ·
`typecheck` limpo · `web build` limpo · `smoke-api.sh` **42/42** · `e2e-smoke` 0 · `snippet-check`
0 · `regression-ciclo3` 0 · `guide-check-ciclo6` 0 · `verify-guide-ciclo7` 0 ·
`walkthrough-ciclo7` 0 · `kv-poison-ciclo7` 0 · `report-audit-ciclo7` 0 em 8 ·
`hostile-attrname-ciclo7` 0 · `step-state-ciclo7` **1** (o único achado da suíte inteira: Z-001) ·
`regression-ciclo9` **0**.

## Resumo da regressão

| Veredito | Qtd | IDs |
|---|---|---|
| CORRIGIDO | 7 | Y-001, Y-002, Y-003, Y-004, Y-005, Y-006, Y-007 |
| PARCIAL | 0 | — |
| NÃO CORRIGIDO | 0 | — |
| REGREDIU | 0 | — |

Defeitos novos: **0 P0 · 0 P1 · 0 P2 · 6 P3**.

---

## Regressão dos 7 Y-*

| ID | Veredito | Evidência própria |
|---|---|---|
| **Y-001** passo 5 contava chave presente como evento | **CORRIGIDO** | Contexto novo → **Semear usuário demo** no Dashboard → `/integracao`: **1/6** (era 2/6). Sessão limpa: **0/6**. O passo 5 fica `pendente` com o motivo na régua do passo 3: *"existe reportKey na sessão, mas o relatório foi pedido pelo /api/seed (servidor), não por esta chamada"*. `done` passou a ser `!!session.reportOrderedAt` (`Integration.tsx:628`), o evento que o código já gravava e ignorava. |
| **Y-002** retry do passo 6 engolia 4xx | **CORRIGIDO** | Extraí o `curl` do passo 6 **da tela** e o executei contra um upstream meu. (a) **401**: **1 requisição**, `exit 1` em **26 ms**, stderr `HTTP 401 na tentativa 1 — abortando (não é relatório vazio): {"message":"Unauthorized…"}` — antes eram 10 requisições e 30 s de silêncio. (b) **200 vazio 2× depois corpo**: **3 requisições** e o corpo impresso — o laço de espera continua funcionando para o caso que ele existe para tratar. O status vem de `-w '\n%{http_code}'` e o corpo é separado com `sed '$d'`. |
| **Y-003** duas inferências sem selo | **CORRIGIDO** | O passo 6 tem **4 selos**, dois deles novos e exatamente nos pontos apontados: o critério de "relatório ainda vazio" (`// UNVERIFIED`, com a nota de que §3.6 só diz "até `response.data` estar populado" e não promete campo nenhum) e o mapeamento `401/403 = displayToken expirado` (`// UNVERIFIED`, citando §6). O critério mudou de `grep '"reportKey"'` para **corpo não-vazio e diferente de `{}`**, que é o que a fonte sustenta. |
| **Y-004** atributos de URL entravam no snippet | **CORRIGIDO — e sem falso positivo** | Este era o risco do ciclo: recusar um atributo que a Array precisa seria pior que o defeito. Passei pelo `prompt` da UI **os 20 atributos reais** documentados em `ARRAY_API_RESEARCH.md` §4.3 (`appKey`, `sandbox`, `userToken`, `clientKey`, `userId`, `exp`, `tui`, `efx`, `showResultPages`, `productCode`, `reportKey`, `displayToken` e os 8 `*Link` do `array-credit-overview`): **20/20 aceitos**. E os 13 hostis (`href`, `src`, `srcset`, `formaction`, `action`, `background`, `poster`, `ping`, `xlink:href`, `data-onload`, `onload`, `style`, `srcdoc`): **13/13 recusados**, com mensagem própria por classe. A interseção entre `URL_ATTR_NAMES`/`isDangerousAttrName` e a lista da Array é **vazia** — nenhum componente da Array recebe dado por atributo de URL, e nenhum atributo dela começa com `on`. |
| **Y-005** fixture gerava consulta fora da janela | **CORRIGIDO** | 8 consumidores novos, relatório buscado e recomputado do JSON cru com corte calculado por mim (`2026-02-24`): **0 consultas hard fora da janela** em 8/8 e `inquiries6mo` == contagem na janela em 8/8. O par tile×tabela deixou de se contradizer nas duas direções (X-004 e Y-005). |
| **Y-006** Dashboard mentia a contagem | **CORRIGIDO** | Com **58** usuários no D1: a tela diz *"Mostrando os 10 mais recentes de **58**"*, o botão diz *"Ver todos (**58**)"* e o texto explica a paginação da rota (`?limit=` 1–200, default 50, `?offset=`) em vez de afirmar "devolve a lista completa". A UI pede `?limit=10` e imprime o `total`, não o tamanho do payload. |
| **Y-007** bordas de data e de parâmetro | **CORRIGIDO** | (a) `monthsAgoISO`: **37 datas** contra o módulo real transpilado — `2026-08-31`→`2026-02-28`, `2026-03-31`→`2026-02-28`, `2024-08-29`→`2024-02-29`, virada de ano `2026-01-15`→`2025-07-15`, e uma varredura dos 31 dias de agosto onde o corte é **sempre** 6 meses de calendário atrás (era 5 m 28 d nos dias 29–31). `calendarAge` não regrediu na fronteira dos 18 anos. (b) `?limit=` vazio, `?limit=%20` e `?limit=abc` → **50** (default), teto **200**, clamp inferior **1**. |

---

## Auditoria do README como entrega

Clonei o repo num diretório limpo (`git clone /home/user/array-poc /tmp/readme-audit`) e segui o
README **literalmente**, sem usar nada do estado do repo de desenvolvimento.

| Instrução do README | Resultado literal |
|---|---|
| `npm install` (na raiz) | **funciona** — 200 pacotes em 13 s; o registry passa pelo proxy. Não puxa browser do Playwright (e o README manda não rodar `playwright install`). |
| `npm run db:migrate` | **funciona** — `0001_init.sql ✅`, 13 comandos; o prompt interativo cai em "yes" sozinho em contexto não-interativo. |
| `npm run dev` | **funciona sem `.dev.vars`** (o arquivo não existe no clone): worker sobe em modo `mock`, `GET /api/health` → `{"ok":true,"mode":"mock"}`. O ruído de boot que o README declara esperado (`wrangler out-of-date` e `Error: Request was cancelled.` do undici) apareceu **exatamente** como descrito, antes do `Ready`. |
| `npm --workspace worker run test # (65 testes)` | **65 passed** — o número no README está certo. |
| `npm --workspace worker run typecheck` / `npm --workspace web run build` | limpos. |
| bloco da suíte de validação (12 comandos) | rodado verbatim: **todos existem e rodam**; 11 saem com 0 achados, `step-state-ciclo7.mjs` sai com **1** (Z-001). Duas coisas o bloco não diz: que a POC precisa estar **rodando em outro terminal** (`npm run dev` é foreground) e que esse 1 achado é **conhecido** — ver Z-002. |
| `cp worker/.dev.vars.example worker/.dev.vars` + preencher `SMARTY_AUTH_ID`/`SMARTY_AUTH_TOKEN`/`ARRAY_ENV` e **reiniciar** | **correto**: nomes de arquivo, nomes de variável e local conferem com `worker/src/config.ts`; o banner da UI repete a mesma instrução ("preencha SMARTY_AUTH_ID e SMARTY_AUTH_TOKEN em worker/.dev.vars e reinicie o worker"). Com credencial fake o `/api/status` vira `mode:"sandbox"` e as rotas devolvem 502 `kind:"blocked"`, como o README promete. |
| `cp .env.example .env # referência para você` | **executa, mas não tem efeito**: nada no repo lê o `.env` da raiz. Ver Z-004. |
| tabela dos paths `// UNVERIFIED` | **corresponde ao código**, item por item: `GET /alert/v2` (`client.ts:298`), `/alert/v2/{id}` (`:311`), `/monitoring/v2` (`:324`), `/report/v2/scoretracker` (`:283`). Nenhum path inferido a mais nem a menos. |
| tabela de rotas do worker | as 16 linhas existem em `worker/src/index.ts`; as duas rotas locais citadas no texto (`/api/array/reports`, `/api/array/usertoken/latest`) existem e, como o README afirma, **não** entram no Inspector (limpei o log, chamei as 5 rotas locais, o Inspector ficou com **0 linhas**). |
| claims da seção Segurança / Limitações | conferidos um a um na varredura abaixo. |

**Veredito da auditoria**: o README funciona literalmente. Não achei nenhuma instrução quebrada,
nenhuma ordem errada e nenhum nome de arquivo/variável errado — **0 P1**. Os três reparos que eu
faria são cosméticos (Z-002, Z-003, Z-004).

---

## Defeitos novos

### P3

#### Z-001 — O passo 4 do Guia continua dizendo "web component montado no DOM" numa aba onde nada montou
- **Arquivo**: `web/src/pages/Integration.tsx:609-621` (`done: !!session.componentMountedAt`); o
  evento é gravado em `web/src/pages/Playground.tsx:433` e **nunca** é limpo — nem no botão
  **Desmontar** (`Playground.tsx:418`) nem quando o carregamento do CDN falha
  (`ArrayComponent.tsx`). Só o seed (`Dashboard.tsx:62`) e o enrollment (`Enrollment.tsx:92`) zeram.
- **Repro** (`scripts/step4-stuck-ciclo9.mjs`, contexto novo, `localStorage` limpo):
  1. CDN da Array stubado por `page.route` → `/playground` → **Montar componente** → `/integracao`:
     passo 4 **feito**, "`<array-credit-overview>` montado em 2026-08-24T02:18:52.972Z" — correto,
     1 custom element no DOM.
  2. volta ao `/playground`, clica **Desmontar** (0 elementos no DOM) → `/integracao`: passo 4
     **continua feito**, mesmo timestamp.
  3. aba nova do mesmo contexto com o CDN **bloqueado**, sem montar nada → `/integracao`: passo 4
     **continua feito**. É o achado 6b do `step-state-ciclo7`.
- **Em que cenário real engana o avaliador**: só depois de um mount **bem-sucedido**, que neste
  ambiente é impossível (o CDN é bloqueado) — o avaliador de amanhã, em mock, vê o passo 4 sempre
  pendente com o motivo certo. Com egress liberado, bastam **dois cliques** (Montar → Desmontar)
  para a tela afirmar um componente que não está mais na página. Atenua: o card mostra o
  **timestamp**, então lê-se como histórico; e os outros 5 passos têm a mesma semântica de "evento
  aconteceu nesta sessão". Agrava: é o único passo cujo rótulo está no presente do DOM
  ("montado no DOM"), e é justamente o passo que o usuário vai exercitar primeiro quando liberar o
  egress.
- **P2 ou P3?** **P3**: inalcançável no ambiente entregue, sem consequência funcional, e o conserto
  é uma linha (`patch({ componentMountedAt: '' })` no `Desmontar` e no `onError` do
  `ArrayComponent`). Seria P2 se o passo 4 fosse alcançável em mock.

#### Z-002 — O bloco da suíte no README não avisa dos dois pré-requisitos e do único achado esperado
- **Arquivo**: `README.md`, seção "E a suíte de validação".
- **Observado**: (a) todos os 12 comandos assumem worker `:8787` **e** web `:5173` no ar, mas
  `npm run dev` é foreground e o README não diz "em outro terminal"; quem seguir a página de cima
  para baixo num terminal só vai ver falhas de conexão. (b) `node scripts/step-state-ciclo7.mjs`
  termina com `1 achado(s)` — é o **único** achado de toda a suíte e é conhecido (Z-001), mas só
  `docs/QA.md` diz isso. Um avaliador que rode o bloco encontra um "achado" e não tem como saber se
  é regressão.
- **Esperado**: uma linha antes do bloco ("com `npm run dev` rodando em outro terminal") e uma nota
  de que `step-state-ciclo7` sai com 1 achado conhecido.

#### Z-003 — O README conta 8 telas numa seção e 9 na outra
- **Arquivo**: `README.md` (tabela de diretórios: "8 telas React"; seção Prontidão: "as 9 telas em
  modo mock").
- **Observado**: as duas estão "certas" (8 rotas + a rota inexistente = os 9 alvos que o
  `walkthrough-ciclo7` percorre), mas na mesma página o avaliador lê dois números para a mesma
  coisa. `App.tsx` tem 8 rotas de tela + `path="*"`.
- **Esperado**: 8 telas em todo lugar, e "9 alvos (8 telas + rota inexistente)" onde for sobre o
  walkthrough.

#### Z-004 — `cp .env.example .env` é um passo sem efeito na seção mais crítica do README
- **Arquivo**: `README.md`, "Onde colar as chaves"; `.env.example`.
- **Observado**: nada no repo lê o `.env` da raiz (`grep` em `worker/`, `web/`, `scripts/`,
  `wrangler.toml`: zero leitores). O README marca a linha como "referência para você" e a linha
  seguinte diz que `worker/.dev.vars` "é o que o wrangler lê", então não é falso — mas é o primeiro
  comando da seção onde o avaliador vai colar credencial real, e um `.env` preenchido não muda nada
  (o `.env.example` chega a dizer "Copie este arquivo para `.env` **E** para `worker/.dev.vars`",
  reforçando o passo inútil).
- **Esperado**: ou remover a linha, ou marcar `.env` explicitamente como "não é lido por nada nesta
  POC — só documentação".

#### Z-005 — O Inspector redige SSN e tokens, mas guarda nome, DOB e endereço em claro
- **Arquivo**: `worker/src/redact.ts`; tabela `api_calls`; `README.md` §"Segurança da POC".
- **Repro**: `POST /api/array/user` com `{"firstName":"Zed","lastName":"Redact","dob":"1990-05-05","ssn":"666998877",…}` →
  `GET /api/inspector?limit=5` devolve `"ssn":"[REDACTED]:8877"` (correto) e, ao lado,
  `firstName`, `lastName`, `dob` e o endereço completo **em claro**, gravados no D1.
- **Observado**: para uma POC com fixtures do bloco `666…` isso é inofensivo e até útil. O ponto é o
  texto: o README promete "SSN e tokens **redigidos**" sem dizer que o resto do payload de
  identidade é persistido literalmente — quem plugar identidades de sandbox reais (o passo 2 do
  "o que você precisa fazer manualmente") passa a ter PII em claro num SQLite local e numa tela.
- **Esperado**: uma frase no README/na tela do Inspector ("nome, DOB e endereço aparecem em claro —
  é log de desenvolvimento, não vá para produção assim") ou redigir também esses campos.

---

## Varredura final de segurança

Rodei com **credencial fake** (worker paralelo em `:8788`, `SMARTY_AUTH_ID=11111111-…`,
`SMARTY_AUTH_TOKEN=SUPERSECRETTOKEN123`, `mode:"sandbox"`) e com **credencial ausente**
(`:8787`, `mode:"mock"`), exercitando enrollment, `usertoken`, `alerts` e `report` nos dois.

| Superfície | Resultado |
|---|---|
| `GET /api/status` | só booleanos para o segredo (`hasAuthToken:true`) + o `appKey` (público por design, vai no HTML dos componentes) + `baseUrl`/`componentsCdn`/`users`. **0** ocorrências do client token. |
| `GET /api/inspector?limit=200` (nos dois workers) | 345 KB analisados: **0** `SUPERSECRETTOKEN123`, **0** `x-credmo-client-token`, **0** appKey fake, **0** sequências de 9 dígitos, **0** SSN completo. Um `POST /user/v2` com SSN completo entra como `"[REDACTED]:8877"`. |
| `/api/array/*` (mock e sandbox-bloqueado) | o erro de host bloqueado devolve `kind`, `hint` e o `upstream.raw` do proxy — **sem** header nem valor de credencial. |
| D1 (`api_calls`, `users`, `user_tokens`, `reports`, `alerts`) | **0** client token, **0** header, **0** SSN de 9 dígitos; `users.ssn_last4` = 4 dígitos (`0560`, `0561`, …). PII de identidade em claro: ver Z-005. |
| KV (32 blobs + as 37 chaves do `local-cache`) | **0** blobs com segredo ou SSN. Nenhuma chave contém o client token — o segmento é o fingerprint `ct00001505`. Continuam ali as chaves inertes de ciclos antigos (X-012, documentado em `QA.md`). |
| bundle do frontend (`web/dist`, 280 KB) | **0** valores de segredo. Aparecem os **nomes** `x-credmo-client-token`, `ARRAY_CLIENT_TOKEN` e `SMARTY_AUTH_TOKEN` (7+5+4 ocorrências) — são o texto dos snippets `curl` do Guia e das instruções, que precisam nomear a variável; nenhum valor. O único SSN completo do repo é a fixture `666230560` (bloco reservado para teste), em `Enrollment.tsx` (prefill do formulário), no corpo de exemplo do Guia e na fixture do seed — é o *request original*, por design. |
| logs do `wrangler` (mock e sandbox) | **0** ocorrências de segredo, header ou SSN. |
| `docs/screenshots/` | não são grepáveis (PNG comprimido); conferi visualmente o pior caso (`qa7-desktop-playground.png`, a tela que mostra token e snippet): banner **MODO MOCK**, `appKey` = placeholder `MOCK0000-…`, `userToken` = token de mock de ~60 min, nenhum client token. Todos os screenshots foram gerados contra `:5173`/`:8787` em modo mock; o worker de credencial fake (`:8788`) nunca foi fotografado, e credencial real **nunca existiu neste ambiente**. |
| fingerprint do client token no escopo do cache | `shortHash` é djb2 de 32 bits (`index.ts:373`) e entra na chave como `ct<8 hex>`; o token nunca entra. **Não é reversível** (não há pré-imagem: 32 bits para um espaço de tokens de tamanho de UUID). O limite honesto: 32 bits é um **verificador**, então quem tivesse o fingerprint poderia *confirmar* um token candidato offline — irrelevante aqui porque (a) o fingerprint só existe em chave de KV local e (b) **0** ocorrências dele em qualquer resposta HTTP (`/api/status`, `/api/inspector`, `/api/array/usertoken*`, `/api/array/users`: 0 hits de `scope`/`ct…`/`usertoken:v2`). |

---

## Veredito final de entrega

**A POC cumpre o objetivo declarado.** Ela permite avaliar *como integrar* os web components e a API
da Array ao produto do usuário: o Guia de Integração prescreve as 6 chamadas na ordem certa, com
`curl` e TypeScript **coláveis e testados executando** (contra o worker local e contra uma Array
falsa que valida como a Array validaria), a fronteira servidor/browser desenhada (client token nunca
cruza), o snippet HTML dos componentes pronto para uma rede liberada, e — o que mais importa numa
POC de avaliação — um selo **verificado / `// UNVERIFIED`** por afirmação, para que o usuário saiba
exatamente onde a documentação fechada da Array acabou e a inferência começou. **O que ela prova**:
que o encadeamento de tokens é implementável como descrito; que o modelo de segredos fecha (o client
token não sai do servidor, o `userToken` é curto e cacheado com escopo por modo/appKey/baseUrl/token,
o SSN não é persistido inteiro); que os erros da integração têm forma tratada (host bloqueado → 502
com dica, chave desconhecida → 400/404, `displayToken` trocado → 400) em vez de tela branca; e que a
aritmética do relatório fecha sozinha. **O que ela NÃO prova** — e este é o limite estrutural, não um
detalhe: **nenhum web component da Array jamais renderizou aqui**, porque `array.io`,
`sandbox.array.io` e `embed[.sandbox].array.io` são bloqueados pelo proxy de egresso deste ambiente.
Toda a validação funcional é em MOCK; o passo 4 só foi exercitado com o CDN stubado por QA. Também
não estão provados o envelope exato do `POST /user/v2` (aninhamento de `address` inferido), o KBA de
sandbox (as perguntas vêm de bureau real, as respostas de fixture não servem) e os 4 paths
`// UNVERIFIED` (alerts, alert details, monitoring, scoretracker). **O que fazer primeiro amanhã**,
em ordem: (1) liberar egress para os três hosts; (2) colar `appKey` + client token em
`worker/.dev.vars` e reiniciar; (3) rodar o caminho canônico enrollment → KBA → usertoken → report
com uma identidade de teste pega no portal da Array — é o aceite; (4) montar **um** componente no
Playground, que é a primeira coisa que este ambiente nunca conseguiu fazer; (5) só então conferir os
4 paths inferidos contra o OpenAPI/Postman do portal. Nada do backlog abaixo é bloqueante: são 5 P3,
todos de texto ou de rótulo de tela.

---

## Backlog remanescente (todos os ciclos)

Consolidado para quem retomar. Fechados nos ciclos 3/5/7/9: **V-001…V-020**, **W-001…W-018**,
**X-001…X-013**, **Y-001…Y-007** — sem nenhum aberto.

| ID | Sev | Uma linha | Situação |
|---|---|---|---|
| **Z-001** | P3 | `componentMountedAt` nunca é limpo: o passo 4 do Guia diz "montado no DOM" depois de **Desmontar** ou numa aba com o CDN bloqueado | **aberto** — inalcançável em mock; 2 cliques com egress liberado. Conserto: limpar o campo no `Desmontar` e no erro de load |
| **Z-002** | P3 | O bloco da suíte no README não diz que a POC tem de estar rodando em outro terminal nem que `step-state-ciclo7` sai com 1 achado conhecido | **aberto** — `docs/QA.md` já diz as duas coisas |
| **Z-003** | P3 | README conta "8 telas" na tabela de diretórios e "9 telas" na seção de prontidão | **aberto** |
| **Z-004** | P3 | `cp .env.example .env` é um passo sem efeito (nada lê o `.env` da raiz) na seção de colar credenciais | **aberto** |
| **Z-005** | P3 | O Inspector/D1 guarda nome, DOB e endereço em claro; o README promete redação e fala só de SSN e tokens | **aberto** — relevante quando entrarem identidades de sandbox reais |
| **Z-006** | P3 | Artefatos temporários de QA (`scripts/.tmp-ciclo9/*`, incluindo PNG) entraram no histórico no commit `64382f1`, contra o que `docs/QA.md` diz ("recriados a cada execução e não devem ser comitados") | **aberto** — `.gitignore` já cobre o diretório desde este ciclo; falta `git rm --cached scripts/.tmp-ciclo9` |
| X-012 | P3 | Chaves de userToken de ciclos antigos continuam no KV local (inertes, não alcançáveis pelo escopo atual) | **aceito como documentação** (`docs/QA.md` §3 ensina a listar e a limpar) |
| — | — | 4 paths `// UNVERIFIED` (alert, alert/{id}, monitoring, scoretracker) e o envelope do `POST /user/v2` | **não é defeito**: é lacuna de fonte, marcada no código, no Guia e no README |

## Prontidão — o que muda quando o usuário plugar credencial real

Inalterado em relação ao ciclo 7 e reconfirmado aqui com credencial fake: com
`worker/.dev.vars` preenchido o modo vira `sandbox` e as rotas passam a chamar
`https://sandbox.array.io/api`; neste ambiente todas voltam **502 `kind:"blocked"`** com dica na
tela (nunca tela branca), em ~0,3 s e sem retry inútil. Com egress liberado, o que pode falhar em
ordem de probabilidade: envelope do `POST /user/v2` → KBA de sandbox → os 4 paths inferidos. Cada um
é conserto de uma linha, e as três telas afetadas (Alerts, monitoring, histórico de score) já tratam
404 como erro de tela.
