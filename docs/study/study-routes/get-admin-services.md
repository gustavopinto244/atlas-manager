# GET /admin/services

## Resumo

Lista todos os serviços registrados na aplicação, com status atual e disponibilidade efetiva de cada um. É a visão geral usada pelo dashboard administrativo para saber "o que existe e como está agora".

## Contrato

- **Método**: GET
- **Path**: `/admin/services` (sem parâmetros de rota)
- **Query string**: não aceita nenhuma — qualquer `?` no request target é rejeitado com 400.
- **Autenticação**: Cloudflare Access (via `CloudflareAccessAssertionReader`), obrigatória (`authenticationPolicy: "required"` no catálogo).
- **Permissão**: `services.read` (operação `read_registered_services`).
- **Middlewares**: envelope de segurança administrativa (`createAdministrativeSecurityEnvelope`, valida Host/Origin/Sec-Fetch-*) em `src/http/create-app.ts`; admissão de taxa (`AdministrativeRequestAdmission`) por request.
- **Corpo da requisição**: nenhum. Se vier `Content-Length`, `Transfer-Encoding` ou `Content-Type`, a rota rejeita com 400 (`invalid_administrative_request`).
- **Formato da resposta** (200): `{ "services": [ { id, displayName, status, availability, supportedOperations, managementKind, dependencies }, ... ] }`, ordenada por `id` (`localeCompare`).
- **Códigos de status possíveis**: 200 (sucesso), 400 (query/target/corpo inválido), 401/403/503 (falhas de autenticação/autorização, ver `mapAdministrativeAccessControlError`), 404 (método/rota incorreta só se o path bater errado — improvável aqui), 405 (método diferente de GET), 429 (limite de requisições administrativas excedido), 503 (`administrative_service_management_unavailable` ou erros de trilha de auditoria), 500 (resposta ultrapassaria 262 144 bytes).

## Caminho da requisição

- `registerAdministrativeServicesRoutes` registra a rota via `registerAdministrativeRoute(app, ["services.list"], createServicesHandler(dependencies))` em `src/http/administrative-services-route.ts`. `registerAdministrativeRoute` (em `src/http/administrative-route-security-catalog.ts`) busca o descritor de segurança da rota no catálogo e faz `app.all(path, handler)` — o método real é decidido dentro do handler, não pelo Express.
- `createAdmittedHandler` (mesmo arquivo) é o encanamento comum a quase todas as rotas de serviço: define os headers de segurança (`setAdministrativeSecurityHeaders`), tenta admitir a requisição na janela de rate limit (`dependencies.admission.tryAdmit()`) e, se admitida, chama a função de processamento passada.
- Dentro de `createServicesHandler`: valida que o path bate exatamente com `/admin/services`, que o método é GET, que a URL não excede o tamanho máximo, que não há query string e que não há corpo — tudo isso é encanamento (validação de forma), não lógica de negócio.
- A chamada real de negócio é `dependencies.createProtectedAdministration(reader).getRegisteredServices.execute()`, que vem de `src/access-control/composition/create-protected-administration.ts`. É aqui que mora a lógica de verdade: autenticação, autorização, e a leitura de cada serviço (status + disponibilidade efetiva).
- A resposta é serializada e limitada em tamanho por `sendBounded` (encanamento).

## Funções-chave

- **`createServicesHandler`** (`src/http/administrative-services-route.ts`) — decide se a requisição bate com o contrato exato desta rota (path, método, ausência de query/corpo) antes de delegar para a camada protegida. É o "porteiro" HTTP da rota.
- **`getRegisteredServices.execute()`**, construído em `createProtectedAdministration` (`src/access-control/composition/create-protected-administration.ts`, função interna `readService` reaproveitada por várias rotas) — para cada serviço listado por `listRegisteredServices`, busca em paralelo (`Promise.all`) o `status` (`getRegisteredServiceStatus`) e a `effectiveAvailability` (`getRegisteredServiceEffectiveAvailability`). Essa combinação de dados é a real "leitura de negócio" da rota.
- **`ExecuteProtectedAdministrativeOperation.run`** (classe interna no mesmo arquivo de composição) — autentica o principal, autoriza a operação `read_registered_services` contra a permissão `services.read`, registra a decisão de autorização em auditoria, e só então invoca a função de leitura. Toda rota administrativa passa por aqui; é o ponto único de autenticação/autorização/auditoria.
- **`mapAdministrativeServiceList`** (`src/http/administrative-service-response.ts`) — mapeia e ordena a lista de serviços para o formato de resposta público, achatando `service`/`status`/`effectiveAvailability` em campos simples (`id`, `displayName`, `status`, `availability`, ...).
- **`sendBounded`** (`src/http/administrative-services-route.ts`) — serializa a resposta e garante que ela não ultrapasse `ADMINISTRATIVE_SERVICE_MAX_RESPONSE_BYTES` (262 144 bytes), lançando 500 caso ultrapasse. É encanamento defensivo, não lógica de negócio.

## Erros e casos de borda

- Path diferente de `/admin/services` (ex.: barra final, casing) → 404 `route_not_found` antes de qualquer outra validação.
- Método diferente de GET → 405 `method_not_allowed`, com header `Allow: GET`.
- Qualquer `?` na URL → 400 `invalid_administrative_request` (a rota não aceita paginação, filtro, nada).
- Presença de `Content-Length`, `Transfer-Encoding` ou `Content-Type` → 400, mesmo que o corpo esteja vazio (GET não deveria carregar nenhum desses headers).
- Falha de autenticação (`AdministrativeAccessControlError`) é mapeada por `mapAdministrativeAccessControlError` em `src/http/administrative-http.ts` para 401/403/503 conforme o `code` do erro.
- Erro de trilha de auditoria (`AdministrativeAuditTrailError`) vira 503 `administrative_event_history_unavailable`.
- Qualquer outro erro não reconhecido cai no catch-all de `mapServiceError` e vira 503 `administrative_service_management_unavailable` — a rota nunca deixa vazar um 500 "cru" para erros de domínio desconhecidos, exceto o caso de resposta grande demais.
- Rate limit (`admission.tryAdmit()` retorna `undefined`) → 429 com `Retry-After: 1`.

## Observações

Nenhuma inconsistência notada neste handler específico — a lógica é direta e a validação de forma é redundante em vários pontos (path, query, corpo) mas de forma intencional e defensiva.
