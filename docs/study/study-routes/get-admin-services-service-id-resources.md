# GET /admin/services/:serviceId/resources

## Resumo

Retorna dados de consumo de recursos (ex.: CPU/memória) de um serviço registrado. É outra rota de diagnóstico, irmã de `/logs`, para inspecionar um serviço individual.

## Contrato

- **Método**: GET
- **Path**: `/admin/services/:serviceId/resources`
- **Parâmetro de rota**: `serviceId`, validado por `isServiceId`.
- **Query string**: não aceita.
- **Autenticação**: Cloudflare Access, obrigatória.
- **Permissão**: `services.read` (operação `read_registered_service_resources`).
- **Corpo da requisição**: nenhum.
- **Formato da resposta** (200): valor bruto de `getRegisteredServiceResources.execute(serviceId)`, tipado como `unknown` na interface — repassado sem transformação.
- **Códigos de status possíveis**: 200, 400, 401/403/503 (acesso), 404 (`registered_service_not_found`/`route_not_found`), 405, 429, 500, 503.

## Caminho da requisição

- Registrada via `registerAdministrativeRoute(app, ["services.resources.read"], createServiceResourcesHandler(dependencies))`.
- `createServiceResourcesHandler` (`src/http/administrative-services-route.ts`) segue exatamente o mesmo esqueleto de `createServiceLogsHandler`: valida `serviceId`, compara o path exato com `${ADMINISTRATIVE_SERVICES_ROUTE}/${serviceId}/resources`, exige GET, sem query, sem corpo.
- A lógica de negócio real é `dependencies.createProtectedAdministration(reader).getRegisteredServiceResources.execute(serviceId)` — implementação fora deste arquivo, injetada por composição.
- Resposta devolvida sem mapeamento adicional, apenas `sendBounded`.

## Funções-chave

- **`createServiceResourcesHandler`** (`src/http/administrative-services-route.ts`) — encanamento puro; a única decisão que toma é de forma (path/método/ausência de corpo e query).
- **`getRegisteredServiceResources.execute`** — decide o que conta como "recursos" de um serviço e como coletar esses dados; é a lógica de negócio de verdade, mas vive fora do escopo HTTP.
- **`isServiceId`** — guarda de formato compartilhada.
- **`sendBounded`** — limite de 262 144 bytes na resposta serializada.
- **`mapServiceError`** — tradução padrão de erros para HTTP, idêntica às outras rotas deste arquivo (inclusive tratando `AdministrativeAuditPartialEffectError`/`AdministrativeAuditTrailError`, embora essas rotas de leitura não passem pelo fluxo de auditoria de mutação — ver Observações).

## Erros e casos de borda

- `serviceId` inválido ou inexistente → 404 `registered_service_not_found`.
- Path com sufixo diferente de `/resources` → 404 `route_not_found`.
- Query string presente → 400.
- Resposta grande demais → 500.
- Erros de acesso → mapeados por `mapAdministrativeAccessControlError`.

## Observações

`mapServiceError` (compartilhado por todas as rotas deste arquivo, inclusive as de leitura) trata explicitamente `AdministrativeAuditPartialEffectError`. Essa exceção só é lançada pelo fluxo de mutação (`runServiceMutation`, usado por start/stop/restart/availability), não pelas leituras simples como esta. Não é um bug — é só uma função de mapeamento de erro genérica reaproveitada — mas vale saber que esse branch nunca deve disparar para `GET .../resources`.
