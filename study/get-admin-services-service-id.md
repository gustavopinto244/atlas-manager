# GET /admin/services/:serviceId

## Resumo

Retorna o detalhe de um único serviço registrado (status + disponibilidade efetiva). É a versão "zoom in" de `GET /admin/services`, usada quando o dashboard já sabe qual serviço quer inspecionar.

## Contrato

- **Método**: GET
- **Path**: `/admin/services/:serviceId`
- **Parâmetro de rota**: `serviceId` — precisa satisfazer `isServiceId`: minúsculas/dígitos, segmentos separados por hífen (`/^[a-z0-9]+(?:-[a-z0-9]+)*$/u`), tamanho entre 1 e 64 caracteres.
- **Query string**: não aceita — rejeitada com 400.
- **Autenticação**: Cloudflare Access, obrigatória.
- **Permissão**: `services.read` (operação `read_registered_service`).
- **Corpo da requisição**: nenhum (mesma validação de "sem corpo" das outras rotas GET).
- **Formato da resposta** (200): `{ "service": { id, displayName, status, availability, supportedOperations, managementKind, dependencies }, "dependents": [] }`.
- **Códigos de status possíveis**: 200, 400, 401/403/503 (acesso), 404 (`registered_service_not_found` se o id não existir ou não bater o padrão; `route_not_found` se o path não casar), 405 (método diferente de GET), 429, 503.

## Caminho da requisição

- Registrada junto das demais em `registerAdministrativeServicesRoutes`, com `registerAdministrativeRoute(app, ["services.read"], createServiceHandler(dependencies))`. O Express monta `app.all("/admin/services/:serviceId", handler)` — repare que esse mesmo path também poderia, em tese, casar com sufixos como `/logs` se o roteamento não fosse explícito; por isso o handler reforça a validação com uma regex própria (`/^\/admin\/services\/([^/]+)$/u`) em vez de confiar apenas no `request.params.serviceId` do Express.
- `createServiceHandler` (`src/http/administrative-services-route.ts`), envolvido por `createAdmittedHandler`, faz toda a validação de forma: `serviceId` bate no formato esperado, o path bruto bate exatamente com `/admin/services/<serviceId decodificado>`, método é GET, sem query, sem corpo.
- A lógica de negócio real está em `getRegisteredService.execute(serviceId)`, que delega para a função interna `readService` em `create-protected-administration.ts` — a mesma função reaproveitada pela listagem (item 1), mas chamada para um único id.
- `mapAdministrativeServiceDetail` (`src/http/administrative-service-response.ts`) empacota o resultado no formato de resposta, incluindo `dependents: []` — sempre um array vazio fixo (ver Observações).

## Funções-chave

- **`createServiceHandler`** (`src/http/administrative-services-route.ts`) — valida o formato do `serviceId`, casa o path exato via regex (proteção extra contra ambiguidade de roteamento) e delega a leitura.
- **`readService`** (função interna em `src/access-control/composition/create-protected-administration.ts`) — busca o serviço na lista completa (`listRegisteredServices.execute()`) e filtra pelo id; se não encontrar, lança `new Error("registered_service_not_found")`. Depois busca `status` e `effectiveAvailability` em paralelo. É a lógica de negócio real desta rota.
- **`ExecuteProtectedAdministrativeOperation.run`** — autentica/autoriza a operação `read_registered_service` contra `services.read` antes de rodar `readService`.
- **`mapAdministrativeServiceDetail`** (`src/http/administrative-service-response.ts`) — serializa `service`/`status`/`effectiveAvailability` e força `dependents: []`.
- **`isServiceId`** (`src/http/administrative-services-route.ts`) — guarda de forma compartilhada por todas as rotas de serviço: rejeita ids malformados antes mesmo de tentar buscar no domínio, evitando uma viagem desnecessária à camada de negócio.

## Erros e casos de borda

- `serviceId` fora do padrão (maiúsculas, caracteres especiais, vazio, > 64 chars) → 404 `registered_service_not_found` — a rota não diferencia "formato inválido" de "não existe", ambos retornam o mesmo código e mensagem.
- Path bruto que não bate exatamente com `/admin/services/<serviceId>` (por exemplo trailing slash) → 404 `route_not_found`, mesmo com um `serviceId` válido nos `params`.
- Serviço formatado corretamente mas inexistente no catálogo → `readService` lança `Error("registered_service_not_found")`, capturado por `mapServiceError` e traduzido para 404 `registered_service_not_found`.
- Falha de autenticação/autorização → mapeada por `mapAdministrativeAccessControlError`.
- Rate limit → 429.

## Observações

`dependents` sempre volta como array vazio (`Object.freeze([])`, hardcoded em `mapAdministrativeServiceDetail`) — o campo existe no contrato de resposta mas nenhum dado real é preenchido nele. Pode ser um recurso planejado e ainda não implementado, ou um campo morto; vale confirmar com quem desenhou o schema.
