# GET /admin/event-history

## Resumo

Lista uma página do histórico de eventos administrativos (quem fez o quê, quando, e com que resultado) do "atlas". Existe para dar visibilidade/auditoria sobre as ações administrativas realizadas no sistema, com paginação por sequência.

## Contrato

- **Método/Path**: `GET /admin/event-history`
- **Arquivo de registro**: `src/http/administrative-event-history-route.ts` (`registerAdministrativeEventHistoryRoute`), catalogado em `src/http/administrative-route-security-catalog.ts` como `event_history.read` (permission `event_history.read`, activationFlag `ADMINISTRATIVE_EVENT_HISTORY_HTTP_ENABLED`).
- **Middlewares aplicados a `/admin*`** (em `src/http/create-app.ts`): envelope de segurança (`createAdministrativeSecurityEnvelope`, valida Host/Origin/Sec-Fetch-*) antes de chegar no handler.
- **Autenticação/Autorização**: exige principal autenticado via Cloudflare Access (asserção lida por `createCloudflareAccessAssertionReader`) e autorização para a operação `read_administrative_event_history` (permissão `event_history.read`) — roles com esse acesso: `auditor`, `audit_operator`, `administrator` (ver `src/access-control/domain/administrative-operation.ts`).
- **Parâmetros de rota**: nenhum.
- **Query string** (todas opcionais, `?`-separadas, no máx. 8 pares, chaves não podem repetir): `afterSequence` (inteiro sem sinal, cursor de paginação), `limit`, `source`, `operation`, `status`, `attemptId`, `occurredFrom`, `occurredTo`. Parseadas por `parseAdministrativeEventHistoryQuery` em `src/http/administrative-event-history-query-parser.ts`, que delega a validação semântica final a `createAdministrativeEventHistoryQuery` (domínio).
- **Corpo da requisição**: não aceito. Qualquer `Content-Length` diferente de `0` ou presença de `Transfer-Encoding` gera 400.
- **Formato da resposta** (200, `application/json`): `{ events: [...], hasMore: boolean, nextAfterSequence?: number }`. Cada evento tem `sequence`, `attemptId`, `occurredAt`, `source.{kind,actorId}`, `target.{kind:"machine", id:"atlas"}`, `operation`, `status`, `details` (campos filtrados por operação — ver `mapDetails`/`fieldsForOperation` em `src/http/administrative-event-history-response.ts`).
- **Códigos de status possíveis**:
  - `200` — sucesso.
  - `400 invalid_administrative_request` — corpo presente indevidamente.
  - `400 invalid_administrative_event_history_query` — query malformada (chave desconhecida, duplicada, valor vazio, número inválido, etc.).
  - `401 administrative_authentication_required` / `503 administrative_identity_unavailable` — falhas de autenticação.
  - `403 administrative_authorization_denied` — autenticado mas sem permissão.
  - `404 route_not_found` — path diferente do esperado (defesa redundante, ver Observações).
  - `405 method_not_allowed` — método diferente de GET (`Allow: GET`).
  - `414 uri_too_long` — URL acima de 4096 bytes.
  - `429 administrative_request_limited` — limite de requisições administrativas concorrentes/por janela excedido (`Retry-After: 1`).
  - `500 internal_error` — resposta serializada ultrapassaria 1 MiB, ou erro interno não mapeado.
  - `503 administrative_event_history_unavailable` — a operação protegida falhou internamente (`protected_operation_failed`).
  - `503 authorization_audit_unavailable` / `503 administrative_authorization_unavailable` — falha ao gravar auditoria ou ao decidir autorização.

## Caminho da requisição

- `createAdministrativeEventHistoryHandler` (`administrative-event-history-route.ts`) é o `RequestHandler` registrado via `app.all(path, handler)` (encanamento de registro está em `registerAdministrativeRoute`, `administrative-route-security-catalog.ts`).
- No handler: define os headers de segurança (`setAdministrativeSecurityHeaders`), tenta admitir a requisição no limitador (`dependencies.admission.tryAdmit()`); se recusado, responde 429. Isso é encanamento de proteção de infraestrutura, não lógica de negócio da rota.
- `processRequest` (mesmo arquivo) faz as validações de encanamento em sequência: path exato, método GET, tamanho da URL, ausência de corpo, parse da query string.
- Cria um `CloudflareAccessAssertionReader` a partir do `request` (`createAssertionReader` → `createCloudflareAccessAssertionReader`) — é o adaptador que extrai a identidade do request.
- Constrói a query protegida via `dependencies.createProtectedEventHistoryQuery(reader)` — essa fábrica vem de fora (composição da aplicação) e injeta a lógica real de autenticação/autorização/leitura.
- **Aqui está a lógica de negócio de verdade**: `protectedQuery.execute(query)`. Por trás dessa interface (implementada em `createProtectedAdministration`, `src/access-control/composition/create-protected-administration.ts`, função `getAdministrativeEventHistory`), o fluxo é: autentica o principal, autoriza a operação `read_administrative_event_history` contra a permissão `event_history.read`, registra a decisão de autorização em auditoria, e só então delega a leitura de fato para `input.eventHistory.getAdministrativeEventHistory.execute(value)` (fora do escopo desses arquivos HTTP).
- De volta ao handler HTTP: `mapAdministrativeEventHistoryResponse` (`administrative-event-history-response.ts`) traduz o resultado de domínio (`AdministrativeEventHistoryPage`) para o formato JSON público, inclusive filtrando os campos de `details` conforme a operação do evento (`fieldsForOperation`) — isso é serialização/encanamento, mas é uma decisão importante: evita vazar campos internos não previstos para cada tipo de operação.
- `sendBoundedResponse` serializa e garante que a resposta não ultrapasse 1 MiB antes de enviar 200.
- Qualquer erro lançado no caminho é capturado e mapeado por `mapAdministrativeEventHistoryError` para um `HttpError` com código/status apropriado, e passado a `next()`.

## Funções-chave

- **`processRequest`** (`administrative-event-history-route.ts`) — orquestra toda a validação de encanamento (path, método, tamanho, corpo, query) antes de acionar a lógica protegida. É o ponto que decide "essa requisição é válida o suficiente para prosseguir?".
- **`parseAdministrativeEventHistoryQuery`** (`administrative-event-history-query-parser.ts`) — transforma a query string crua em um objeto tipado, rejeitando chaves desconhecidas/duplicadas, valores vazios ou com caracteres de controle, e números fora do formato decimal sem sinal. Decide o que é uma consulta de histórico "bem formada" antes mesmo de tocar no domínio.
- **`ExecuteProtectedAdministrativeOperation.run`** (`src/access-control/composition/create-protected-administration.ts`) — o coração da autorização: autentica, autoriza, audita a decisão e só então invoca a operação real. Toda rota administrativa passa por aqui; entender essa função é entender por que a rota pode responder 401/403/503 antes mesmo de ler qualquer evento.
- **`mapAdministrativeEventHistoryResponse` / `mapDetails` / `fieldsForOperation`** (`administrative-event-history-response.ts`) — decide exatamente quais campos de `details` cada tipo de evento expõe na resposta pública, evitando vazamento de campos internos não documentados para aquele `operation`.
- **`mapAdministrativeEventHistoryError`** (`administrative-event-history-route.ts`) — centraliza a tradução de exceções de domínio/infraestrutura em códigos HTTP e mensagens padronizadas, inclusive distinguindo `protected_operation_failed` (503) dos demais erros de acesso.

## Erros e casos de borda

- Corpo presente em uma requisição GET é rejeitado explicitamente (400), mesmo que vazio de conteúdo mas com `Content-Length` diferente de "0".
- Query com mais de 8 pares, pares vazios, chaves fora do conjunto permitido, chaves duplicadas, valores vazios, valores/chaves com espaços nas pontas ou caracteres de controle: todos geram 400 antes de qualquer acesso a dados.
- `afterSequence`/`limit` só aceitam decimais sem sinal (`^(?:0|[1-9][0-9]*)$`) que sejam `Number.isSafeInteger`; qualquer outra coisa é 400.
- Limite de requisições administrativas (`admission.tryAdmit()`) é compartilhado por toda a infraestrutura administrativa (não é específico desta rota) — ao esgotar, responde 429 com `Retry-After: 1` sem sequer chegar a autenticar.
- Resposta cuja serialização excede 1 MiB (`ADMINISTRATIVE_EVENT_HISTORY_MAX_RESPONSE_BYTES`) não é enviada parcialmente: vira 500. Ou seja, uma página "grande demais" falha de forma opaca em vez de ser truncada.
- Falha ao gravar a auditoria da decisão de autorização (mesmo quando a decisão seria "permitido") impede a resposta (503 `authorization_audit_unavailable`) — o sistema prefere falhar a servir dados sem rastro de auditoria.

## Observações

- A checagem `request.path !== ADMINISTRATIVE_EVENT_HISTORY_ROUTE` dentro de `processRequest` é redundante em circunstâncias normais: `registerAdministrativeRoute` já registra o handler exclusivamente em `/admin/event-history` via `app.all(path, handler)`. Ela funciona como uma defesa extra caso o roteamento do Express mude de comportamento, mas não é alcançável em uso normal.
- Diferente das demais rotas de `/admin/event-history/*` (arquivo `administrative-event-history-operations-route.ts`), esta rota tem handler próprio e não compartilha a função `bodyJson`/`mutate`/gate de mutação — faz sentido, já que é a única rota de leitura pura com query string neste conjunto.
