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

Além disso, **esta POC hoje só conhece 4 variáveis**: `SMARTY_AUTH_ID`, `SMARTY_AUTH_TOKEN`,
`ARRAY_APP_KEY`, `ARRAY_CLIENT_TOKEN`, `ARRAY_ENV` (ver `worker/src/types.ts` e
`worker/src/config.ts`). Nenhuma das dez variáveis desta pesquisa aparece no código.

Conclusão: a Array **não publica um SDK oficial nem um `.env` de referência**. A autenticação
dela é HTTP puro com `appKey` + headers `x-credmo-*` (§2). Portanto, para cada variável abaixo
eu separo dois planos:

- **O conceito da API ao qual ela corresponde** — isso sim pode ser VERIFICADO contra a doc.
- **O nome da variável em si** — é uma convenção de quem escreveu a lista, sempre INFERIDO.

Escala de confiança: **VERIFICADO** (fonte citada) / **INFERIDO** (raciocínio explicitado).

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
- **Nota**: já implementada nesta POC (`ARRAY_APP_KEY` é alias aceito de `SMARTY_AUTH_ID`).

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
  existe** — a POC hoje chama isso de `ARRAY_CLIENT_TOKEN` / `SMARTY_AUTH_TOKEN`.
- **Recomendação**: aceitar `ARRAY_SERVER_TOKEN` como **alias** de `ARRAY_CLIENT_TOKEN`, não
  como um segundo segredo.

## 3. `ARRAY_BASE_URL=https://sandbox.array.io`

- **Conceito**: host da API REST. Sandbox e produção são **path-idênticos**; troca-se só o host.
  **Atenção ao valor dado**: `https://sandbox.array.io` está **incompleto** — todas as rotas
  vivem sob o prefixo `/api` (`/api/user/v2`, `/api/authenticate/v2`, `/api/report/v2`). O valor
  correto como base é `https://sandbox.array.io/api` (produção: `https://array.io/api`), que é
  exatamente o que `worker/src/config.ts` já usa em `SANDBOX_BASE_URL`.
- **Obrigatória**: **não** — é derivável. Default sensato: `https://sandbox.array.io/api`.
  Esta POC já resolve isso melhor, por um enum `ARRAY_ENV=sandbox|production`, o que evita
  que alguém aponte para produção por erro de digitação.
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
- **Onde entra**: só configuração do cliente; **decide qual header é enviado**. Note que a
  lógica é mutuamente exclusiva: `worker/src/array/client.ts` já implementa isso
  (`if (spec.userToken) x-credmo-user-token else x-credmo-client-token`) — ou seja, o
  comportamento existe, só não é exposto como variável.
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
  fixa e conhecida (ex.: `BANKER_COLDIRON`) ou vazio.
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

---

## Impacto na POC

O que existe hoje (`worker/src/config.ts`, `worker/src/array/client.ts`,
`worker/src/index.ts`): `appKey` + client token, seleção sandbox/produção por `ARRAY_ENV`,
escolha automática do header `x-credmo-user-token` vs `x-credmo-client-token`,
`productCode` com default `credmo3bReportScore`, e retry de relatório por heurística de
corpo vazio.

O que **precisa ser implementado e não existe**:

1. **Polling correto de relatório por status HTTP.** Substituir a heurística "corpo vazio" por
   `202 → repetir`, `200 → pronto`, `204 → falha permanente`. É a correção de maior valor
   desta pesquisa: elimina uma inferência marcada `// UNVERIFIED` no Guia de Integração e
   corrige um bug latente (hoje um `204` de falha seria lido como "ainda vazio" e o loop
   giraria até o timeout).
2. **Intervalo e timeout de polling configuráveis** (`ARRAY_POLL_INTERVAL`, segundos, default
   1,0; `ARRAY_POLL_TIMEOUT`, segundos, default 120 — e avaliar 300 pelo caso de re-tentativa
   de vários minutos). Hoje o intervalo de 3000 ms está hard-coded e não há timeout explícito.
3. **Distinguir falha permanente de "ainda processando"** na resposta ao cliente da POC, e
   registrar que os tokens valem **uma** recuperação (usar `PUT /report/v2` para reler).
4. **Endpoint de listener de webhook**: rota `POST` que aceite JSON, valide o segredo do path,
   **responda 200 rapidamente** e enfileire o processamento; sem confiar no payload como
   verdade. Não existe nada disso hoje. Note que **não há API de registro** — a URL é
   entregue ao Customer Success da Array, então documente isso no README como passo manual.
5. **`ARRAY_WEBHOOK_TOKEN` como segredo gerado localmente** (não como credencial da Array), com
   comparação em tempo constante e o valor jamais logado (a POC já tem redação de PII no
   Inspector — estender a ela).
6. **`ARRAY_AUTH_MODE` explícito** (`server` default | `browser`), hoje implícito na presença
   de `spec.userToken`. Tornar explícito serve de trava: em modo `browser` o worker nunca deve
   poder enviar o client token.
7. **`ARRAY_SERVER_TOKEN` como alias** de `ARRAY_CLIENT_TOKEN`/`SMARTY_AUTH_TOKEN` — e
   `ARRAY_PRODUCT_CODE` / `ARRAY_IDENTITY` como configuração de default e de seed, em vez de
   literais no código.
8. **`ARRAY_BASE_URL` como override opcional**, mantendo `ARRAY_ENV` como caminho principal;
   se aceitar a variável, **normalizar o sufixo `/api`** (o valor `https://sandbox.array.io`
   da lista original quebraria todas as rotas).

## Lacunas

1. **`/docs/webhook-events` continua gated** — não há lista verificada de nomes de evento nem
   um exemplo real de payload de webhook. Sabemos as duas famílias e os campos citados
   (`clientKey`, `reportKey`, `displayToken`, `productCode`), não o envelope.
2. **Não existe `ARRAY_*` canônico.** Nenhuma das dez variáveis aparece em nenhum repositório
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
