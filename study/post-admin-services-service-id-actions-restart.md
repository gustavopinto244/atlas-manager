# POST /admin/services/:serviceId/actions/restart

## Resumo

Reinicia um serviço registrado. Não é implementado como "parar tudo, depois iniciar tudo" simetricamente — é um plano próprio que para os dependentes ativos, emite uma operação `restart` dedicada no próprio alvo (não `stop` + `start` nele), espera prontidão, e então religa os dependentes na ordem inversa.

## Contrato

- **Método**: POST
- **Path**: `/admin/services/:serviceId/actions/restart`
- **Parâmetro de rota**: `serviceId`, validado por `isServiceId`.
- **Query string**: não aceita.
- **Autenticação**: Cloudflare Access, obrigatória.
- **Permissão**: `services.restart` (operação `restart_registered_service`).
- **Confirmação**: corpo JSON `{ "confirmation": "confirm_registered_service_restart" }`, exatamente uma chave.
- **Content-Type/Content-Encoding**: mesmas regras das outras duas ações.
- **Tamanho máximo do corpo**: 512 bytes.
- **Gate de mutação**: `service_mutation`, compartilhado com `start`/`stop`/atualização de disponibilidade.
- **Formato da resposta** (200): `{ serviceId, operation, successful }`.
- **Códigos de status possíveis**: 200, 400, 401/403/503, 404, 405, 409, 413, 415, 429, 503.

## Caminho da requisição

- Registrada pelo mesmo laço das três ações, com `createAdministrativeServiceActionHandler("restart", dependencies)`.
- O handler HTTP é idêntico em estrutura aos de `start`/`stop`: só muda o `operation` usado para montar o path esperado (`.../actions/restart`), a mensagem de confirmação exigida e qual branch de `protectedAdministration` é chamado (`restartRegisteredService.execute(serviceId)`).
- A lógica de negócio real está em `create-protected-administration.ts` (`runServiceMutation("restart_registered_service", ...)`) e, principalmente, em `OrchestrateRegisteredServiceControl.execute(serviceId, "restart")` (`src/service-management/application/orchestrate-registered-service-control.ts`), cujo plano vem de `planRestart` (`src/service-management/application/plan-registered-service-orchestration.ts`).
- **Investigação pedida**: `planRestart` **não** delega para `planStop` + `planStart`. É uma função própria: calcula os dependentes transitivos ativos (`running`, `failed` ou `unknown`) do alvo, os para na ordem "dependentes primeiro" (`stopOrder`), insere um único passo `{ kind: "control", serviceId: targetServiceId, operation: "restart" }` seguido de um `wait_for_readiness` para o próprio alvo, e então religa cada dependente na ordem inversa (`restoreOrder`) com `start` + `wait_for_readiness`. Ou seja: o **alvo** recebe uma operação `restart` única e nativa (não dois passos `stop`+`start`); só os dependentes é que passam por `stop` e depois `start` reais.
- Isso significa que o comportamento de "restart" no controlador de serviço (`ServiceController`/`directControl`, fora do escopo deste documento) precisa suportar a operação `restart` diretamente — e de fato `validatePlannedOperations` exige que `restart` esteja em `service.supportedOperations` para o alvo.

## Funções-chave

- **`createAdministrativeServiceActionHandler`** (`src/http/administrative-services-route.ts`) — mesma fábrica das três ações; para `restart`, delega a `protectedAdministration.restartRegisteredService.execute(serviceId)`.
- **`planRestart`** (`src/service-management/application/plan-registered-service-orchestration.ts`) — a função central desta rota: decide a ordem de parada dos dependentes ativos, insere o passo `restart` único no alvo, e decide a ordem de retomada dos dependentes. É aqui, não no handler HTTP, que mora toda a decisão de "o que significa reiniciar um serviço com dependências".
- **`OrchestrateRegisteredServiceControl.execute`** (`orchestrate-registered-service-control.ts`) — executa o plano passo a passo; se qualquer passo falhar, marca `failed` e interrompe o restante (os dependentes que ainda não foram religados ficam parados).
- **`runServiceMutation`** (`create-protected-administration.ts`) — mesmo encanamento de auditoria "iniciado → terminal" das outras duas ações.
- **`mapServiceOperationResult`** — reduz o resultado a `serviceId`/`operation`/`successful`.

## Erros e casos de borda

- Mesmos casos de borda de validação de forma das outras duas ações de serviço.
- Se o passo `restart` do próprio alvo falhar, a orquestração para ali — os dependentes que já haviam sido parados **não são religados automaticamente** (o laço principal de `execute` interrompe com `break` no primeiro passo `failed`, e os passos de `start` dos dependentes viriam depois do passo do alvo no plano). Ou seja, uma falha no restart do alvo pode deixar dependentes previamente ativos parados até uma nova ação corretiva.
- Serviço alvo sem `restart` na lista `supportedOperations` → `validatePlannedOperations` lança `RegisteredServiceOrchestrationPlanError`, tratado por `createFailedResult` como falha do próprio passo de orquestração (resultado com `successful: false`, ainda HTTP 200) — não é surfaced como erro HTTP direto.
- Falhas de auditoria pós-execução seguem o mesmo padrão das outras duas ações (503 `administrative_service_state_recheck_required` ou `administrative_event_history_unavailable`).

## Observações

Confirmando o que a tarefa pediu para investigar: `restart` **não** é um atalho client-side para `stop` seguido de `start` no alvo — é uma operação de controlador própria (`operation: "restart"`), enquanto os _dependentes_ do alvo é que recebem `stop` real e depois `start` real ao redor dela. Um leitor que espera simetria perfeita com as rotas de `start`/`stop` deve notar essa assimetria: o alvo tem tratamento especial, os dependentes não.

Se o passo `restart` do próprio serviço falha, o plano interrompe antes de religar os dependentes já parados — não há rollback automático que tente restaurar o estado anterior dos dependentes.
