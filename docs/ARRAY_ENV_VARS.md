# Variáveis de ambiente `ARRAY_*` — significado exato

Pesquisado em 2026-08-24, como continuação de `docs/ARRAY_API_RESEARCH.md` (leia-o primeiro:
todas as referências `§x.y` abaixo apontam para ele).

## Achado que muda o enquadramento da pergunta

**Este conjunto de nomes não é um artefato da Array.** Procurei ativamente pelo
cliente/SDK/quickstart de referência que teria produzido esses nomes e ele não existe:

| Busca | Resultado |
|---|---|
| GitHub code search `ARRAY_SERVER_TOKEN` | **0 resultados** em todo o GitHub |
| GitHub code search `ARRAY_LISTENER_URL` / `ARRAY_WEBHOOK_TOKEN` | **0 resultados** |
| GitHub code search `"productCode" "credmo" array.io` | 9 hits, **todos deste próprio repositório** (`gustavobftorres/array-poc`) |
| npm registry — `credmo`, `array.io credit` | nenhum pacote da Array; nenhum SDK oficial |
| PyPI `array-io` | 404 |
| Web search pelas strings exatas | nenhuma ocorrência indexada |

Além disso, *(estado do ciclo 12)* **esta POC só conhecia 4 variáveis**: `SMARTY_AUTH_ID`,
`SMARTY_AUTH_TOKEN`, `ARRAY_APP_KEY`, `ARRAY_CLIENT_TOKEN`, `ARRAY_ENV`. Nenhuma das variáveis
desta pesquisa aparecia no código. **Hoje todas as onze aparecem** — `worker/src/types.ts`
(`Env`), `worker/src/config.ts` (`getConfig`) e a lista `CANONICAL` de `scripts/sync-env.mjs` —
e os dois nomes `SMARTY_*` viraram aliases deprecados que avisam no boot e no `/api/status`.

Conclusão: a Array **não publica um SDK oficial nem um `.env` de referência**. A autenticação
dela é HTTP puro com `appKey` + headers `x-credmo-*` (§2). Portanto, para cada variável abaixo
eu separo dois planos:

- **O conceito da API ao qual ela corresponde** — isso sim pode ser VERIFICADO contra a doc.
- **O nome da variável em si** — é uma convenção de quem escreveu a lista, sempre INFERIDO.

Escala de confiança: **VERIFICADO** (fonte citada) / **INFERIDO** (raciocínio explicitado).

> **Nota de leitura (ciclo 16).** Este documento é o **registro da pesquisa** feita em
> 2026-08-24, antes da implementação. As frases no tempo presente sobre "o que a POC faz hoje"
> descrevem o estado **daquele momento** — e estão marcadas abaixo com *(estado do ciclo 12)*.
> As **onze** variáveis pesquisadas foram implementadas nos ciclos 13 e 15; a seção
> [§Impacto na POC](#impacto-na-poc--estado-em-ciclo-15) no fim traz o estado **atual**, item por
> item, com o arquivo onde cada um vive. O contrato operacional (obrigatoriedade, default,
> avisos, tetos) está no `README.md` §"O contrato completo das variáveis" e no `.env.example`.

---

## 1. `ARRAY_APP_KEY`

- **Conceito**: o `appKey` da Array — UUID de 36 caracteres que identifica sua aplicação.
  **Público por design**: vai no `src` do script do componente como query param e no atributo
  `appKey` de cada web component, ou seja, aparece no HTML da página. O loader da Array valida
  `length === 36`.
- **Obrigatória**: **sim**, em praticamente toda chamada. Sem default possível.
- **Onde entra**: (a) propriedade `appKey` no **corpo** JSON de `POST /user/v2`,
  `POST /authenticate/v2`, `POST /authenticate/v2/usertoken`; (b) **query param** no script
  `embed*.array.io/cms/<componente>.js?appKey=…`; (c) **atributo** HTML nos componentes.
  Nunca é header.
- **Confiança**: **VERIFICADO** (§2, §3.1, §3.4, §4.1; código de produção em
  `creditbanc/creditbanc` e `pkelly504/array-poc`).
- **Nota**: implementada. Desde o ciclo 13 `ARRAY_APP_KEY` é o nome **canônico** e
  `SMARTY_AUTH_ID` é o alias **deprecado** (aceito com aviso) — a relação era inversa no ciclo 12.

## 2. `ARRAY_SERVER_TOKEN`

- **Conceito**: **é o mesmo que `x-credmo-client-token`** — testei a hipótese alternativa
  ("existe um *server token* distinto") e ela não se sustenta: a Array documenta exatamente
  **dois** tokens de portador, o *client token* (segredo server-side, nunca em código de site
  ou app) e o *user token* (por consumidor, `x-credmo-user-token`). Não há terceiro token de
  autenticação. O nome `SERVER_TOKEN` é apenas uma renomeação semântica do client token
  ("o token que só o servidor tem"), provavelmente escolhida porque `CLIENT_TOKEN` soa
  confuso justamente por ser o segredo do lado servidor.
- **Obrigatória**: **sim** para tudo que a POC faz server-side (criar usuário, KBA, emitir
  user token, pedir relatório). Sem default.
- **Onde entra**: **header** `x-credmo-client-token: <valor>`.
- **Confiança**: mapeamento conceito↔header **VERIFICADO** (§2; header literal capturado em
  código de produção). O nome `ARRAY_SERVER_TOKEN` como grafia oficial: **INFERIDO / não
  existe** *(no ciclo 12 a POC chamava isso de `ARRAY_CLIENT_TOKEN` / `SMARTY_AUTH_TOKEN`)*.
- **Recomendação**: aceitar `ARRAY_SERVER_TOKEN` como **alias** de `ARRAY_CLIENT_TOKEN`, não
  como um segundo segredo. **Implementado assim** (ciclo 13): `ARRAY_SERVER_TOKEN` é o canônico,
  `ARRAY_CLIENT_TOKEN` é alias aceito **sem** aviso (é o mesmo segredo, não é depreciação) e
  `SMARTY_AUTH_TOKEN` é alias **deprecado** com aviso.

## 3. `ARRAY_BASE_URL=https://sandbox.array.io`

- **Conceito**: host da API REST. Sandbox e produção são **path-idênticos**; troca-se só o host.
  **Atenção ao valor dado**: `https://sandbox.array.io` está **incompleto** — todas as rotas
  vivem sob o prefixo `/api` (`/api/user/v2`, `/api/authenticate/v2`, `/api/report/v2`). O valor
  correto como base é `https://sandbox.array.io/api` (produção: `https://array.io/api`), que é
  exatamente o que `worker/src/config.ts` já usa em `SANDBOX_BASE_URL`.
- **Obrigatória**: **não** — é derivável. Default sensato: `https://sandbox.array.io/api`.
  *(estado do ciclo 12: a POC resolvia isso só pelo enum `ARRAY_ENV=sandbox|production`.)*
  **Implementado** (ciclos 13 e 15): a variável existe, é normalizada para terminar em `/api`
  nas quatro formas, e o **host decide o ambiente** (`sandbox.` → sandbox, outro host remoto →
  produção, loopback não decide). `ARRAY_ENV` virou fallback; a divergência entre os dois vira
  `envMismatch` no `/api/status`. `http://` para host remoto e path extra além de `/api` geram
  aviso, e valor que não é URL http(s) cai no host do `ARRAY_ENV`, também com aviso.
- **Onde entra**: só configuração do cliente (prefixo da URL).
- **Confiança**: **VERIFICADO** (§1 — ambos os hosts probados ao vivo).
- **Nota importante**: o proxy de egresso **deste ambiente bloqueia `array.io`**; a POC já
  detecta e sinaliza (`kind: 'blocked'`).

## 4. `ARRAY_AUTH_MODE=server`

- **Conceito**: **sim, existe uma dualidade real na API da Array**, e ela é exatamente esta:
  a mesma operação pode ser autenticada por **um** dos dois headers.
  - `server` → chamadas saem do seu backend com **`x-credmo-client-token`** (o segredo).
  - o outro modo (`browser` / `client` / `user` — o nome fica a seu critério) → chamadas saem
    do dispositivo do consumidor com **`x-credmo-user-token`**, obtido via
    `POST /authenticate/v2/usertoken` ou lido do evento `array-event` do componente KBA.
  A doc é explícita para `POST /report/v2`: autentica-se "via `x-credmo-user-token` (do
  dispositivo) **ou** `x-credmo-client-token` (do seu servidor)" (§3.5). Então **sim, isso
  conecta diretamente com o `x-credmo-user-token`** da pesquisa anterior. A regra de ouro:
  o client token **nunca** desce para o browser.
  - Corolário no plano de UI: é o mesmo eixo do **modo automático vs manual** dos componentes
    (§4.3) — automático = componente recebe `userToken` e pede o produto sozinho (efetivamente
    modo browser); manual = você pede o relatório server-side e injeta
    `productCode`+`reportKey`+`displayToken` (modo server).
- **Obrigatória**: **não**. Default sensato: **`server`** — é o modo seguro e é o que uma POC
  com worker deve fazer.
- **Onde entra**: só configuração do cliente; **decide qual header é enviado**. A lógica é
  mutuamente exclusiva em `worker/src/array/client.ts`
  (`if (spec.userToken) x-credmo-user-token else x-credmo-client-token`). *(No ciclo 12 o
  comportamento existia mas não era exposto como variável.)* **Implementado** (ciclo 13) como
  **trava**: em `browser` o client token nunca é anexado e a chamada sem `userToken` responde
  `409 kind:"auth_mode"`. `client` e `user` são aliases documentados de `browser` (ciclo 15,
  W2-012); qualquer outro valor cai em `server`, o modo seguro, com aviso.
- **Confiança**: existência dos dois modos e o que muda em cada um: **VERIFICADO** (§2, §3.4,
  §3.5, §4.4). O nome `ARRAY_AUTH_MODE` e o literal `server`: **INFERIDO**.

## 5. `ARRAY_IDENTITY`

- **Conceito**: testei as quatro hipóteses. A que se sustenta é a **primeira**: um seletor de
  **persona de teste do sandbox** (identidade fictícia publicada pela Array, com nome, DOB,
  SSN e endereço). A doc `/docs/sandbox-identities` diz: "when creating and testing your
  application, you can use any of the identities that are listed in Sandbox Identities", e as
  personas são nomeadas — confirmei os nomes **CARMEN BALAKHANPOUR, DALTON LOT,
  DENISE HENNESSY, DONALD BLAIR** (além de BANKER COLDIRON, já em §5). Todos os SSN de teste
  ficam na faixa `666…`, bloco inválido da SSA.
  Descarto as outras: não é `clientKey` (esse é **gerado** pela Array na resposta de
  `POST /user/v2`, não configurado); não é um identificador de consumidor genérico pelo mesmo
  motivo; "perfil nomeado" é meia-verdade — é um perfil nomeado, mas o nome é da **persona da
  Array**, não um profile de config seu.
- **Obrigatória**: **não** — só faz sentido em sandbox/seed/demo. Default sensato: uma persona
  fixa e conhecida (ex.: `BANKER_COLDIRON`) ou vazio. **Implementado assim** (ciclo 13): slug
  (`banker-coldiron` default, `dalton-lot`, `denise-hennessy`, `donald-blair`) **ou** JSON
  inline; slug inexistente, path traversal e JSON inválido avisam sem derrubar o boot, e um JSON
  parcial avisa **quais** campos vieram da persona default (inclusive o SSN — ciclo 15, W2-010).
  Em produção a identidade é **DESCARTADA** — a config fica sem `ssn`/`dob`/endereço,
  `POST /api/seed` responde `409 kind:"identity_discarded"` e `/api/personas` devolve
  `ssn: null` (ciclo 15, W2-002). Só **BANKER COLDIRON** tem DOB/SSN/endereço de fonte de
  primeira mão; as outras três têm o nome verificado e os demais campos são placeholder
  `// UNVERIFIED` na faixa `666…`, com selo mostrado na UI.
- **Onde entra**: **não vai na requisição como campo próprio**. É um seletor que **expande**
  para o corpo de `POST /user/v2`: `firstName`, `lastName`, `ssn`, `dob`, `address{street,
  city, state, zip}`.
- **Confiança**: que as identidades de sandbox são personas nomeadas e é isso que se preenche:
  **VERIFICADO** (§5 + `docs.array.com/docs/sandbox-identities`). O nome da variável e o
  formato do valor: **INFERIDO**.
- **Alerta operacional (VERIFICADO, §5)**: as identidades de sandbox são fictícias mas **não
  são canned** — autenticar uma delas puxa perguntas KBA reais de um bureau real e o relatório
  vem com dados reais de bureau. Sandbox **não** é offline.

## 6. `ARRAY_PRODUCT_CODE`

- **Conceito**: o `productCode` — declara **qual produto/relatório** você está comprando.
  Descobri o **padrão de nomenclatura**, que é mais útil que uma lista parcial:
  `<provedor><N>b<Conteúdo>`, onde o provedor é `tui` (TransUnion), `exp` (Experian),
  `efx` (Equifax) ou `credmo` (multi-bureau da Array), `N`b = número de bureaus, e o conteúdo
  é `Report`, `Score` ou `ReportScore`. A doc confirma literalmente:
  **`tui1bReportScore` = "TransUnion (only) Report and Score"**.
  Códigos confirmados: `credmo3bReportScore` (3 bureaus, relatório+score),
  `exp1bScore` (Experian, só score), `tui1bReportScore`, e `tui1bReport` citado.
- **Catálogo completo**: **NÃO consegui fechar.** A doc de `Order a Credit Report` não lista os
  códigos publicamente, e o conjunto disponível é **por contrato/plano** — cada cliente Array
  tem seus produtos habilitados. Não existe lista canônica única; peça a sua ao contato Array.
- **Obrigatória**: **sim** no `POST /report/v2`. Default sensato: `credmo3bReportScore`
  (é o que a POC já usa como default do Zod em `worker/src/index.ts`).
- **Onde entra**: propriedade `productCode` no **corpo** de `POST /report/v2`; e como
  **atributo** `productCode` nos componentes em modo manual.
- **Confiança**: conceito, padrão de nome e os 4 códigos: **VERIFICADO**
  (`docs.array.com/reference/order-credit-report`, §3.5). Catálogo completo: **não verificado**.

## 7. `ARRAY_POLL_INTERVAL=1.0` e 8. `ARRAY_POLL_TIMEOUT=120`

- **Conceito**: **CONFIRMADO — `GET /report/v2` exige polling**, e agora com o **critério
  documentado de "pronto"**, que é por **status HTTP**, não por inspeção de corpo:
  > "The Retrieve a Credit Report operation initiates the process that generates the report and
  > then returns immediately. Often, the report generation will still be in progress when the
  > operation returns. **A 202 HTTP status means that the API is still generating the report, in
  > which case you should repeat the call until it returns 200 (success) or 204 (failure). The
  > reportKey and displayToken will remain valid while you're making these iterated calls.**"
  Isto é um achado importante: a POC hoje usa uma **heurística de corpo vazio** ("retry a cada
  3000 ms até `response.data` estar populado", §3.6 / passo 6 do Guia). O critério correto é
  `202 → continue`, `200 → pronto`, `204 → falhou`. Trocar isso elimina a inferência marcada
  como `// UNVERIFIED` no Guia de Integração.
- **Unidade**: **segundos** — confirmado por coerência: `1.0` só é plausível como segundo
  (1 ms seria absurdo; e o `.0` fracionário indica float de segundos), e `120` casa com o
  timeout típico de 2 min. **INFERIDO com alta confiança**; a Array não publica valores
  recomendados de intervalo.
- **Obrigatórias**: **não**, ambas com default. Defaults sensatos: intervalo **1,0 s** (a
  integração de referência da §3.6 usa 3 s — ambos aceitáveis; use backoff), timeout **120 s**.
- **Onde entram**: só configuração do cliente (loop de retry). Nada vai na requisição.
  **Implementado** (ciclo 13): `worker/src/array/poll.ts` faz `202 → repetir`, `200 → pronto`,
  `204 → 502 kind:"report_failed"` (aborta na primeira, não espera o timeout) e
  `504 kind:"timeout"` citando `ARRAY_POLL_TIMEOUT`. Valor inválido cai no default com aviso;
  desde o ciclo 15 há **teto de sanidade** — 60 s de intervalo e 3600 s de timeout, clampados com
  aviso, porque um `1e9` escorregado pendurava a requisição indefinidamente (W2-006). Um `200`
  com corpo vazio virou erro tratado em vez de "relatório pronto vazio" (W2-008).
- **Confiança**: necessidade do polling e critério 202/200/204: **VERIFICADO**
  (`docs.array.com/docs/how-to-retrieve-a-credit-report`). Unidade e valores: **INFERIDO**.
- **Dois avisos VERIFICADOS que afetam o loop**:
  1. **"The tokens are good for one retrieval, only."** O par `reportKey`+`displayToken` vale
     **uma** recuperação bem-sucedida — permanece válido durante os 202 sucessivos, mas depois
     do 200 é queimado. Para reler, renove com `PUT /report/v2` (§3.6).
  2. A Array **não garante disponibilidade imediata** e agenda re-tentativas próprias como
     background jobs (1ª após 1 min, 2ª +1 min; falha permanente na 3ª) — descrito na
     documentação de integração da Forth, portanto **terceiro, não first-party**. Se esse
     comportamento vale para sua conta, um timeout de 120 s pode ser **curto demais**: o pior
     caso descrito passa de 2 minutos. Considere 300 s, ou polling assíncrono + webhook.

## 9. `ARRAY_LISTENER_URL`

- **Conceito**: a URL do **seu** endpoint HTTP que recebe os webhooks da Array — a doc usa
  exatamente a palavra *listener*, o que explica o nome da variável:
  > "To tell Array that you want to receive webhooks, you register an API endpoint — or
  > **listener** — that you create and host on your own API server. To register a listener, you
  > provide your Array Customer Success representative with the listener's full URL."
  Formato da mensagem (VERIFICADO): **`POST` com `Content-Type: application/json`**;
  **"The message doesn't contain query parameters or custom headers"**; corpo é um objeto JSON
  descrevendo o evento; seu listener **deve responder `200`** para confirmar recebimento.
  Recomenda-se **dois** listeners registrados, um para sandbox e um para produção.
  E **sim** — a Array chama seu listener para avisar de relatório e de alerta: as duas famílias
  de evento são (§3.10) **API-triggered** (ex.: "customer ordered a report", disparado por
  `POST /report/v2`, payload com `clientKey`, `reportKey`, `displayToken`, `productCode`) e
  **detected events** (alertas de bureau e de Identity Protect, `Credit Score Simulated`,
  eventos de monitoramento). Outros eventos citados: cliente **enrolled** na Array.
- **Obrigatória**: **não** para o fluxo síncrono (order → poll → get). Vira o caminho preferido
  para alertas/monitoramento, que não têm um "momento" para você fazer polling.
- **Onde entra**: **não vai em requisição nenhuma.** Ponto crítico: **não existe API de
  registro de webhook.** O registro é **manual, humano, via seu representante de Customer
  Success da Array**. Ou seja, `ARRAY_LISTENER_URL` é, do lado do código, apenas a
  configuração da rota que o seu servidor expõe — o valor tem de bater com o que você entregou
  ao contato da Array.
- **Confiança**: **VERIFICADO** (`docs.array.com/docs/how-to-receive-webhooks`, §3.10).
  Catálogo exato de nomes de evento: **não verificado** (a página `/docs/webhook-events` é
  gated; só os títulos/descrições ficaram indexados).
- **Implementado** (ciclos 13 e 15): a variável é só informativa — `GET /api/webhooks/config` diz
  o que entregar ao Customer Success. Como o formato embute o `ARRAY_WEBHOOK_TOKEN` no path, a
  URL **inteira é o segredo**: `/api/status`, `/api/webhooks/config` e a tela Webhooks mostram o
  último segmento **elidido** (`…/api/webhooks/array/***`), e a URL completa vive só no `.env`
  (W2-003). Se a URL configurada não contiver o token, a POC avisa que ela não bate com a rota
  que o listener realmente atende.

## 10. `ARRAY_WEBHOOK_TOKEN`

- **Conceito**: aqui a doc dá uma resposta **negativa e decisiva**. A pergunta era "como o
  token autentica o callback — header? body? assinatura HMAC?". A resposta:
  **nenhum dos três.** A Array afirma que a mensagem de webhook
  **"doesn't contain query parameters or custom headers"**. Logo:
  - **não há header de assinatura** tipo `X-Array-Signature`;
  - **não há HMAC** documentado;
  - **não há segredo compartilhado** emitido pela Array para verificar webhooks.
  Portanto `ARRAY_WEBHOOK_TOKEN` **não pode ser um valor fornecido pela Array**. O único
  significado coerente é um **segredo que você mesmo gera** e embute no *path* da própria
  listener URL (ex.: `https://seu.host/array/webhook/<token>`), transformando a URL secreta
  no mecanismo de autenticação — que é a mitigação padrão quando o remetente não assina.
  Como a URL é registrada manualmente pela Array, rotacionar esse token exige pedir a troca
  ao Customer Success (atrito real; considere aceitar dois tokens durante a rotação).
- **Obrigatória**: **não** pela Array; **sim** como boa prática se você expor um listener.
  Default sensato: nenhum — gere um valor aleatório de alta entropia por ambiente.
- **Onde entra**: no **path (ou query) da sua própria URL de listener**, verificado pelo seu
  código. Nunca é enviado para a Array em requisição alguma.
- **Confiança**: ausência de headers/assinatura da Array: **VERIFICADO**
  (`docs.array.com/docs/how-to-receive-webhooks`). Interpretação do token como segredo-na-URL
  próprio: **INFERIDO**.
- **Defesas adicionais recomendadas** (INFERIDO, já que não há assinatura): allowlist de IP de
  origem se a Array publicar faixas, tratar o payload como **notificação não confiável** e
  sempre reconfirmar pela API antes de agir, e idempotência por `reportKey`/id de evento.
- **Implementado** (ciclos 13 e 15): token comparado em tempo constante; 404 **idêntico** para
  token errado e para listener não configurado (a dica ficou no terminal — W2-011); payload
  tratado como notificação não confiável e nunca usado como verdade; PII do evento redigida como
  no resto; corpo que não é objeto JSON responde 200 (a doc exige) mas fica marcado
  `parseable: false` (W2-009); e **idempotência** por id de evento, senão por
  `eventType+reportKey+clientKey` (coluna `dedupe_key`, migração `0003`) — o segundo POST do
  mesmo evento devolve `duplicate: true` e grava uma linha só.
- **Limitação assumida e não corrigível pela aplicação**: segredo-no-path aparece no **access log
  do runtime**. O `wrangler dev` imprime `POST /api/webhooks/array/<token> 200 OK` no stdout, e
  proxies/CDNs fazem o mesmo em produção (W2-004). A POC não grava nem devolve o token, mas não
  há como suprimir o log do runtime: trate o stdout e os access logs como sensíveis e rotacione
  o token. A allowlist de IP e a assinatura seguem **não** disponíveis — é o que perguntar ao
  Customer Success ao registrar o listener.

---

## Impacto na POC — estado em ciclo 15

Esta seção substitui a lista de pendências da pesquisa original: **as oito estão implementadas**.
Cada item traz onde vive e o que ficou de fora.

| # | O que a pesquisa pedia | Estado | Onde |
|---|---|---|---|
| 1 | Polling por status HTTP (`202`/`200`/`204`) em vez da heurística de corpo vazio | **feito** (ciclo 13) | `worker/src/array/poll.ts`; `204` aborta na primeira tentativa |
| 2 | Intervalo e timeout configuráveis | **feito** (ciclo 13) + tetos de sanidade (ciclo 15) | `ARRAY_POLL_INTERVAL`/`ARRAY_POLL_TIMEOUT`, `parseSeconds` em `worker/src/config.ts` |
| 3 | Distinguir falha permanente de "ainda processando"; tokens valem **uma** recuperação | **feito** | `502 kind:"report_failed"` vs `504 kind:"timeout"`; `PUT /api/array/report` renova o `displayToken` |
| 4 | Endpoint de listener que valide o segredo do path e responda 200 rápido | **feito** (ciclo 13), endurecido no 15 | `POST /api/webhooks/array/:token` em `worker/src/index.ts` + `worker/src/webhook.ts`; tela Webhooks |
| 5 | `ARRAY_WEBHOOK_TOKEN` como segredo local, comparação em tempo constante, nunca logado | **feito, com uma ressalva** | `timingSafeEqual`; a auditoria grava `/api/webhooks/array/***`. **Ressalva**: o access log do runtime (`wrangler dev`) imprime o path completo e a aplicação não pode suprimi-lo (W2-004) |
| 6 | `ARRAY_AUTH_MODE` explícito como trava | **feito** (ciclo 13) | `parseAuthMode`; `409 kind:"auth_mode"` em 12 das 14 rotas exercitadas pelo QA, com 0 requisições levando o client token |
| 7 | `ARRAY_SERVER_TOKEN` como alias; `ARRAY_PRODUCT_CODE`/`ARRAY_IDENTITY` como configuração | **feito** (ciclo 13) | `getConfig`; `SMARTY_*` virou alias **deprecado** com aviso |
| 8 | `ARRAY_BASE_URL` como override, normalizando `/api` | **feito** (ciclo 13) e promovido a **fonte da verdade do ambiente** (ciclo 15) | `normalizeBaseUrl` + `classifyHost`; `ARRAY_ENV` virou fallback e `wrangler.toml` não o fixa mais |

O que a pesquisa **não** previa e o QA adversarial obrigou a acrescentar (ciclo 15,
`docs/VALIDATION_CICLO13.md`): a identidade de sandbox **descartada** em produção em vez de
re-rotulada (W2-002, era PII saindo para um host de produção), o ambiente **derivado do host**
com `envMismatch` visível (W2-001), a elisão do token dentro da `ARRAY_LISTENER_URL` (W2-003) e
os avisos de `http://` remoto e de path extra na base URL (W2-005, W2-007).

## Lacunas

1. **`/docs/webhook-events` continua gated** — não há lista verificada de nomes de evento nem
   um exemplo real de payload de webhook. Sabemos as duas famílias e os campos citados
   (`clientKey`, `reportKey`, `displayToken`, `productCode`), não o envelope.
2. **Não existe `ARRAY_*` canônico.** Nenhuma das onze variáveis aparece em nenhum repositório
   público, npm ou PyPI. O artefato de referência procurado (SDK/quickstart oficial da Array)
   **não existe**; qualquer grafia é convenção local.
3. **Catálogo completo de `productCode`** — só o padrão e 4 códigos. O conjunto é por contrato.
4. **Valores recomendados de intervalo/timeout de polling** não são publicados pela Array. O
   comportamento de re-tentativa em 1 min / 3 tentativas vem de fonte **terceira** (Forth) e
   pode ser específico daquela integração.
5. **Segurança de webhook**: não sei se a Array publica faixas de IP de origem, nem se contas
   novas têm alguma opção de assinatura/HMAC não documentada publicamente. Perguntar ao
   Customer Success ao registrar o listener.
6. **Lista completa e autoritativa de identidades de sandbox** (com o pareamento correto
   nome↔DOB↔SSN↔endereço) segue gated; os nomes recuperados servem de amostra.
7. **`ARRAY_IDENTITY`**: o formato do valor é livre. Se ele deve ser um slug de persona, um
   índice, ou um JSON inline, é decisão da POC — não há convenção da Array a seguir.

## Fontes novas (além das de `ARRAY_API_RESEARCH.md`)

- https://docs.array.com/docs/how-to-receive-webhooks — registro do listener via Customer
  Success, `POST` JSON, **sem query params nem headers customizados**, resposta 200, dois
  listeners (sandbox/prod).
- https://docs.array.com/docs/how-to-retrieve-a-credit-report — **202 = gerando; repetir até
  200 (sucesso) ou 204 (falha)**; tokens válidos durante as iterações; tokens valem **uma**
  recuperação.
- https://docs.array.com/reference/order-credit-report — `productCode`;
  **`tui1bReportScore` = "TransUnion (only) Report and Score"**.
- https://docs.array.com/docs/sandbox-identities — identidades de sandbox como personas
  nomeadas (CARMEN BALAKHANPOUR, DALTON LOT, DENISE HENNESSY, DONALD BLAIR).
- https://docs.array.com/docs/webhook-events — duas famílias de evento; "customer ordered a
  report" disparado por Order a Credit Report; alertas de bureau e Identity Protect.
- https://support.forthcrm.com/hc/en-us/articles/12854610524435-Array-io-Integration —
  terceiro: re-tentativas em background (1 min, 1 min, falha permanente na 3ª).
- GitHub code search (`ARRAY_SERVER_TOKEN`, `ARRAY_LISTENER_URL`, `ARRAY_WEBHOOK_TOKEN`) —
  0 resultados; npm/PyPI — nenhum SDK da Array. Evidência **por ausência**.
