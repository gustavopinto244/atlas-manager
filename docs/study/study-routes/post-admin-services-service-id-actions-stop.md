# POST /admin/services/:serviceId/actions/stop

## Resumo

Para um serviço registrado, propagando a parada para os dependentes ativos (quem depende dele) antes de parar o próprio alvo — a ordem inversa do `start`. É uma mutação protegida por confirmação explícita.

## Contrato

- **Método**: POST
- **Path**: `/admin/services/:serviceId/actions/stop`
- **Parâmetro de rota**: `serviceId`, validado por `isServiceId`.
- **Query string**: não aceita.
- **Autenticação**: Cloudflare Access, obrigatória.
- **Permissão**: `services.stop` (operação `stop_registered_service`).
- **Confirmação**: corpo JSON `{ "confirmation": "confirm_registered_service_stop" }`, exatamente uma chave.
- **Content-Type/Content-Encoding**: mesmas regras da rota de `start` (`application/json`, sem `Content-Encoding`).
- **Tamanho máximo do corpo**: 512 bytes.
- **Gate de mutação**: `service_mutation`, compartilhado com `start`/`restart`/atualização de disponibilidade — só uma por vez.
- **Formato da resposta** (200): `{ serviceId, operation, successful }`.
- **Códigos de status possíveis**: 200, 400, 401/403/503, 404, 405, 409, 413, 415, 429, 503.

## Caminho da requisição

- Registrada pelo mesmo laço `for (const operation of ["start", "stop", "restart"])` em `registerAdministrativeServicesRoutes`, usando `createAdministrativeServiceActionHandler("stop", dependencies)`.
- O handler (`src/http/administrative-services-route.ts`) é idêntico em estrutura ao de `start`: valida `serviceId`, path exato (`.../actions/stop`), método POST, ausência de query, lê e valida o corpo (`readStrictJsonBody` + `exactConfirmation`), admite no gate de mutação.
- A chamada de negócio real é `protectedAdministration.stopRegisteredService.execute(serviceId)`, que por sua vez chama `runServiceMutation("stop_registered_service", serviceId, () => orchestrateRegisteredServiceControl.execute(serviceId, "stop"))` em `create-protected-administration.ts`.
- A orquestração de fato (`OrchestrateRegisteredServiceControl.execute`, em `src/service-management/application/orchestrate-registered-service-control.ts`) monta o plano via `planStop` (`plan-registered-service-orchestration.ts`): para cada serviço na ordem "dependentes primeiro" (`topologicalDependentsFirst` sobre os dependentes transitivos + o próprio alvo), executa `stop` — ou marca como pulado se já estiver parado.
- `mapServiceOperationResult` resume o resultado para a resposta pública.

## Funções-chave

- **`createAdministrativeServiceActionHandler`** (`src/http/administrative-services-route.ts`) — a mesma fábrica usada por start/restart; para `stop`, chama `protectedAdministration.stopRegisteredService.execute(serviceId)`.
- **`getCandidateServiceIds`** (`src/service-management/application/plan-registered-service-orchestration.ts`) — para operações diferentes de `start` (inclui `stop`), calcula a ordem "dependentes primeiro": todos os dependentes transitivos do alvo, mais o próprio alvo, ordenados topologicamente. Essa é a decisão de negócio que garante que nada fique rodando "no ar" sem o serviço que parou.
- **`planStop`** (mesmo arquivo) — para cada serviço candidato, decide entre um passo `control` com `operation: "stop"` (se o snapshot não estiver `stopped`) ou um passo sem operação (`{ kind: "control", serviceId }`, tratado como "já parado, pular" pelo executor).
- **`runServiceMutation`** (`create-protected-administration.ts`) — mesmo encanamento de auditoria "iniciado → terminal" descrito na rota de `start`.
- **`mapServiceOperationResult`** — reduz o resultado a `serviceId`/`operation`/`successful`.

## Erros e casos de borda

- Mesmos casos de borda de validação de forma da rota de `start` (serviceId inválido, path errado, corpo malformado, confirmação errada, tamanho, content-type/encoding).
- Gate de mutação ocupado → 409, igual à rota de `start` (o gate é o mesmo objeto compartilhado entre as três ações e a rota de disponibilidade).
- Se algum passo de parada falhar no meio do plano (por exemplo, o controlador de serviço lançar um erro ao tentar parar um dependente), a orquestração marca o passo como `failed` e interrompe os passos seguintes (`break` no laço de `execute`); o resultado retorna `successful: false`, mas a rota HTTP ainda responde 200 — o cliente precisa olhar o campo `successful` para saber se a operação realmente completou, não apenas o status HTTP.
- Falha de auditoria pós-execução → 503 `administrative_service_state_recheck_required` (efeito parcial) ou `administrative_event_history_unavailable` (auditoria genérica), igual à rota de `start`.

## Observações

Igual à rota de `start`, uma orquestração que falha no meio do caminho (`successful: false`) ainda responde HTTP 200 — o código de status não reflete se a operação de negócio teve sucesso, só se a requisição foi processada. Isso é coerente com o desenho (a resposta expõe `successful` explicitamente), mas é fácil um cliente apressado checar só o status HTTP e achar que a operação funcionou.
