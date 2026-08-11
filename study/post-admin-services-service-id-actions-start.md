# POST /admin/services/:serviceId/actions/start

## Resumo

Inicia um serviço registrado, respeitando dependências (serviços dos quais ele depende são iniciados antes, se necessário). É uma operação de mutação protegida por confirmação explícita no corpo da requisição.

## Contrato

- **Método**: POST
- **Path**: `/admin/services/:serviceId/actions/start`
- **Parâmetro de rota**: `serviceId`, validado por `isServiceId`.
- **Query string**: não aceita.
- **Autenticação**: Cloudflare Access, obrigatória.
- **Permissão**: `services.start` (operação `start_registered_service`).
- **Confirmação**: corpo JSON com exatamente uma chave, `{ "confirmation": "confirm_registered_service_start" }`. Qualquer chave extra, valor diferente, ou tipo diferente de objeto → 400.
- **Content-Type aceito**: `application/json` ou `application/json; charset=utf-8`; `Content-Encoding` não é aceito (qualquer valor rejeita com 415).
- **Tamanho máximo do corpo**: 512 bytes (`ADMINISTRATIVE_SERVICE_MAX_BODY_BYTES`).
- **Gate de mutação**: `service_mutation` — só uma operação de mutação de serviço por vez é admitida (`mutationGate.tryAdmit()`); se já houver uma em andamento, retorna 409 antes de qualquer processamento.
- **Formato da resposta** (200): `{ serviceId, operation, successful }`, montado por `mapServiceOperationResult` a partir do resultado da orquestração.
- **Códigos de status possíveis**: 200, 400 (corpo/confirmação inválidos), 401/403/503 (acesso), 404 (`registered_service_not_found`/`route_not_found`), 405 (método diferente de POST), 409 (`administrative_service_operation_busy`), 413 (corpo grande demais), 415 (content-type/encoding não suportado), 429, 503 (`administrative_service_state_recheck_required` / `administrative_event_history_unavailable` / `administrative_service_management_unavailable`).

## Caminho da requisição

- As três ações (start/stop/restart) são registradas em laço no fim de `registerAdministrativeServicesRoutes`: `for (const operation of ["start", "stop", "restart"])`, cada uma chamando `createAdministrativeServiceActionHandler(operation, dependencies)`.
- `createAdministrativeServiceActionHandler("start", ...)` (`src/http/administrative-services-route.ts`) é o encanamento: valida `serviceId`, compara o path exato com `.../actions/start`, exige POST, valida ausência de query, lê e faz parse estrito do corpo (`readStrictJsonBody`), e verifica a confirmação exata (`exactConfirmation`).
- Antes de chamar a camada de negócio, tenta admitir na `mutationGate` — se ocupada, devolve 409 sem nunca chegar a autenticar/autorizar a operação de negócio.
- A chamada real é `protectedAdministration.startRegisteredService.execute(serviceId)`, construída em `src/access-control/composition/create-protected-administration.ts`. É aqui que a lógica de negócio de verdade acontece: autenticação, autorização, abertura de um registro de auditoria (`operationAudit.begin`), execução da orquestração e fechamento do registro de auditoria (`succeeded`/`failed`).
- A orquestração de fato é `requireServices().orchestrateRegisteredServiceControl.execute(serviceId, "start")`, implementada em `src/service-management/application/orchestrate-registered-service-control.ts` — monta um plano de execução considerando o grafo de dependências do serviço.
- O resultado da orquestração é resumido por `mapServiceOperationResult` (`src/http/administrative-services-route.ts`) para os três campos públicos (`serviceId`, `operation`, `successful`); o detalhe passo a passo da orquestração não é exposto na resposta HTTP.

## Funções-chave

- **`createAdministrativeServiceActionHandler`** (`src/http/administrative-services-route.ts`) — fábrica compartilhada pelas três ações; decide path/método, aplica o gate de mutação e delega a operação certa (`start`/`stop`/`restart`) para `protectedAdministration`.
- **`exactConfirmation`** (`src/http/administrative-services-route.ts`) — exige que o corpo seja exatamente `{ confirmation: "confirm_registered_service_start" }`, sem campos extras. É a barreira contra disparo acidental da mutação.
- **`runServiceMutation`** (interno a `create-protected-administration.ts`) — envolve a chamada de orquestração com abertura/fechamento de um registro de auditoria "iniciado → terminal"; se a orquestração for bem-sucedida mas o fechamento da auditoria falhar, lança `AdministrativeAuditPartialEffectError` (o efeito já aconteceu, mas não se sabe se foi registrado).
- **`OrchestrateRegisteredServiceControl.execute`** (`src/service-management/application/orchestrate-registered-service-control.ts`) — monta um plano (`planStart`, em `plan-registered-service-orchestration.ts`) que primeiro garante as dependências transitivas do serviço rodando (iniciando as que estiverem paradas, aguardando prontidão das que já estiverem rodando) e só depois inicia o próprio serviço.
- **`mapServiceOperationResult`** (`src/http/administrative-services-route.ts`) — reduz o resultado rico da orquestração (passos, estados, timestamps) aos três campos que o cliente HTTP recebe.

## Erros e casos de borda

- `serviceId` inválido/inexistente → 404 antes mesmo de ler o corpo.
- Corpo ausente, não-UTF8, JSON malformado, ou com chaves duplicadas (via `parseStrictJson`) → 400 `invalid_administrative_service_request`.
- Corpo com confirmação errada ou com chaves extras → 400, mesmo erro genérico (a rota não distingue "faltou confirmação" de "confirmação errada").
- Corpo maior que 512 bytes → 413 `payload_too_large`.
- `Content-Type` diferente de `application/json` (ou com charset diferente de utf-8) → 415; qualquer `Content-Encoding` presente também → 415.
- Gate de mutação ocupado (outra operação `start`/`stop`/`restart`/atualização de disponibilidade em andamento) → 409 `administrative_service_operation_busy`.
- Dependência indisponível/desabilitada bloqueando o `start` (quando a autoridade é `scheduled`, não aplicável nesta rota manual) → não se aplica diretamente aqui, pois esta rota HTTP sempre chama com autoridade `"manual"` (o parâmetro default de `OrchestrateRegisteredServiceControl.execute`); a validação de disponibilidade de dependências só roda para `authority === "scheduled"`.
- Falha ao fechar o registro de auditoria após a orquestração ter rodado → `AdministrativeAuditPartialEffectError`, mapeado para 503 `administrative_service_state_recheck_required` — sinaliza ao cliente que o estado real do serviço precisa ser reconferido, já que não se sabe se a auditoria capturou o resultado.
- Erro genérico de auditoria (`AdministrativeAuditTrailError`) → 503 `administrative_event_history_unavailable`.
- Qualquer erro de orquestração não reconhecido (dependência bloqueada, estado inválido, timeout de prontidão etc.) cai no catch-all de `mapServiceError` → 503 `administrative_service_management_unavailable` — o cliente não recebe o motivo detalhado da falha de orquestração via HTTP, só que a operação de serviço está indisponível.

## Observações

O corpo aceito é sempre `{ "confirmation": "confirm_registered_service_start" }` — não há como o cliente passar nenhum outro parâmetro (por exemplo, "só iniciar sem esperar dependências"). A liberdade toda de decisão fica na orquestração; o HTTP só liga/desliga a operação com uma confirmação fixa.
