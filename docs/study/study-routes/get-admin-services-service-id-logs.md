# GET /admin/services/:serviceId/logs

## Resumo

Retorna as últimas linhas de log de um serviço registrado. Serve para diagnóstico rápido sem precisar acessar a máquina diretamente.

## Contrato

- **Método**: GET
- **Path**: `/admin/services/:serviceId/logs`
- **Parâmetro de rota**: `serviceId`, mesma validação `isServiceId` das demais rotas de serviço.
- **Query string**: não aceita — a rota rejeita qualquer `?` (isso inclui não haver como pedir `tailLines` customizado por query; ver Observações).
- **Autenticação**: Cloudflare Access, obrigatória.
- **Permissão**: `services.read` (operação `read_registered_service_logs`).
- **Corpo da requisição**: nenhum.
- **Formato da resposta** (200): o retorno bruto de `getRegisteredServiceLogs.execute(serviceId)` — o tipo é `unknown` na interface (`ProtectedAdministrativeServices`), então o formato exato depende da implementação de infraestrutura por trás da porta; a rota apenas repassa o valor via `sendBounded`.
- **Códigos de status possíveis**: 200, 400 (query/corpo/target inválido), 401/403/503 (acesso), 404 (`registered_service_not_found`/`route_not_found`), 405 (método diferente de GET), 429, 500 (resposta grande demais), 503.

## Caminho da requisição

- Registrada com `registerAdministrativeRoute(app, ["services.logs.read"], createServiceLogsHandler(dependencies))` em `registerAdministrativeServicesRoutes`.
- `createServiceLogsHandler` (`src/http/administrative-services-route.ts`), como as demais, faz só encanamento: valida `serviceId`, compara o path exato contra `${ADMINISTRATIVE_SERVICES_ROUTE}/${serviceId}/logs`, valida método GET, valida ausência de query e de corpo.
- A chamada de negócio é `dependencies.createProtectedAdministration(reader).getRegisteredServiceLogs.execute(serviceId)`. Repare que a interface `ProtectedAdministrativeServices.getRegisteredServiceLogs.execute` aceita um segundo parâmetro opcional `tailLines?: number`, mas o handler HTTP nunca o passa — sempre chama com um único argumento (`serviceId`).
- O resultado é devolvido tal como veio, sem nenhum mapeamento de formato (diferente da rota de serviços, que usa `mapAdministrativeServiceDetail`).

## Funções-chave

- **`createServiceLogsHandler`** (`src/http/administrative-services-route.ts`) — encanamento: validação de forma, sem transformação do corpo de resposta.
- **`getRegisteredServiceLogs.execute`** (implementação real fora do escopo deste arquivo, injetada via `dependencies.createProtectedAdministration`) — decide quais logs buscar e quantas linhas trazer (o padrão de `tailLines`, já que a rota nunca informa um valor). É aqui que mora a lógica de negócio de verdade, mas seu comportamento interno não faz parte do escopo desses dois arquivos HTTP.
- **`isServiceId`** — mesma guarda de formato reaproveitada em todo o arquivo.
- **`sendBounded`** — limita o tamanho da resposta serializada a 262 144 bytes; para logs isso é relevante porque a saída pode ser naturalmente grande.
- **`mapServiceError`** — traduz erros de domínio/acesso para códigos HTTP, igual às outras rotas deste arquivo.

## Erros e casos de borda

- `serviceId` malformado ou inexistente → 404 `registered_service_not_found`.
- Path com sufixo diferente de `/logs` ou barra a mais → 404 `route_not_found`.
- Qualquer query string → 400, mesmo que fosse para pedir um número de linhas — não há como o cliente pedir `tailLines` diferente do padrão através desta rota HTTP.
- Resposta de logs maior que 262 144 bytes serializados → 500 `internal_error` (a rota prefere falhar a truncar silenciosamente).
- Falhas de acesso/autorização seguem o mesmo mapeamento das demais rotas (`mapServiceError` → `mapAdministrativeAccessControlError`).

## Observações

A porta `getRegisteredServiceLogs.execute` suporta um `tailLines` opcional, mas a rota HTTP nunca o expõe nem o usa — a query string é inclusive proibida por completo (`rejectAdministrativeQuery`). Ou o parâmetro é vestigial (usado só em outros consumidores internos/testes), ou é uma capacidade planejada e ainda não conectada ao HTTP.
