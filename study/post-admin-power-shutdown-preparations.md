# POST /admin/power/shutdown/preparations

## Resumo

Prepara a máquina para um desligamento agendado: avalia se há bloqueios (serviços rodando, tarefas ativas, backup em andamento, filesystem por sincronizar) e, se houver, executa as ações necessárias para removê-los (parar serviços, drenar tarefas, completar backup, sincronizar disco). Não desliga a máquina — só deixa o terreno pronto para que a execução (`POST /admin/power/shutdown/executions`) tenha sucesso depois.

## Contrato

- **Método**: POST
- **Path**: `/admin/power/shutdown/preparations` (sem parâmetros de rota)
- **Query string**: não aceita nenhuma.
- **Autenticação**: Cloudflare Access, obrigatória.
- **Permissão**: `power.shutdown.prepare` (operação `prepare_machine_shutdown_occurrence`).
- **Feature flag**: `ADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED`.
- **Confirmação exigida**: o corpo precisa conter `"confirmation": "confirm_shutdown_preparation"` — exatamente essa string, senão a requisição é rejeitada como inválida (não como "confirmação incorreta" — o handler HTTP mistura essa checagem com a validação de forma do corpo, ver abaixo).
- **Gate de concorrência**: `power_operation` — o mesmo `AdministrativePowerOperationGate` de slot único compartilhado com PUT/DELETE de wake-alarm e com POST de `/admin/power/shutdown/executions`.
- **Corpo da requisição**: JSON, `Content-Type: application/json` (ou `; charset=utf-8`), sem `Content-Encoding`, até 1024 bytes. Exatamente 4 campos: `{ "operation": "shutdown", "scheduledFor": <timestamp canônico>, "wakeScheduledFor": <timestamp canônico>, "confirmation": "confirm_shutdown_preparation" }`. `scheduledFor` deve ser anterior a `wakeScheduledFor`, e a diferença entre os dois não pode passar de 7 dias.
- **Formato da resposta** (200): `{ "occurrence": {operation, scheduledFor, wakeScheduledFor}, "processedAt": <timestamp>, "outcome": "not_required" | "blocked" | "prepared" | "incomplete", "completedStepCount": <número>, "blockers": [...] }`.
- **Códigos de status possíveis**: 200 (a rota responde 200 mesmo quando a preparação falha logicamente — `outcome` é que carrega o resultado real, ver Erros e casos de borda), 400 (`invalid_machine_shutdown_request`), 405, 409 (`administrative_power_operation_busy`, gate ocupado), 413, 414, 415, 422 (`invalid_machine_shutdown_interval`, janela entre os dois timestamps maior que 7 dias), 401/403/503 (acesso), 429, 503 (`administrative_shutdown_preparation_state_recheck_required`/`administrative_shutdown_preparation_unavailable`/`administrative_event_history_unavailable`), 500.

## Caminho da requisição

- `registerAdministrativeShutdownRoutes` registra as duas rotas de shutdown (preparation e execution) em `src/http/administrative-shutdown-route.ts`, cada uma com seu próprio path e permissão, mas ambas passando pelo mesmo `processShutdownRequest` parametrizado por `stage: "preparation" | "execution"`.
- `createAdministrativeShutdownHandler("preparation", dependencies)` monta o handler Express: headers de segurança, admissão de taxa (`admission.tryAdmit()`), e delega para `processShutdownRequest`.
- Dentro de `processShutdownRequest`: valida path/método, lê e faz parse do corpo (`readShutdownBody`, streaming com limites de tamanho/tipo), e então `parseShutdownRequest(body, "preparation")` — que valida a forma do `occurrence` (`createMachineShutdownOccurrence`), a forma da `confirmation` (`createMachineShutdownConfirmation`) **e** que o estágio da confirmação bate com a rota chamada (`confirmation.stage !== stage` lança erro). Tudo isso é encanamento de validação de forma.
- Só depois disso o gate de concorrência (`powerOperationGate.tryAdmit()`) é adquirido; se ocupado, 409 antes de qualquer chamada de negócio.
- A lógica de negócio de verdade mora em `PrepareMachineShutdownOccurrence.executeAsAuthorized` → `prepareAt` (`src/power-management/application/prepare-machine-shutdown-occurrence.ts`): avalia a prontidão atual (`EvaluateMachineShutdownReadiness`), monta um plano de passos concretos para resolver os bloqueios resolvíveis, executa cada passo (parar serviços, drenar tarefas, completar backup, sincronizar filesystem), registra eventos a cada etapa, e reavalia a prontidão no final.
- A resposta é mapeada por `mapMachineShutdownPreparationResponse` (`src/http/administrative-shutdown-response.ts`) e limitada em tamanho por `sendBoundedResponse`.

## Funções-chave

- **`parseShutdownRequest`** (`src/http/administrative-shutdown-route.ts`) — além de validar a forma do corpo, é aqui que a confirmação declarada no catálogo (`exact:confirm_shutdown_preparation`) é de fato checada contra o `stage` da rota. Sem essa checagem, um cliente poderia mandar `confirm_shutdown_execution` para a rota de preparação.
- **`createMachineShutdownPreparationPlan`** (`src/power-management/application/prepare-machine-shutdown-occurrence.ts`) — decide, a partir da decisão inicial de prontidão, se a preparação é "not_required" (já está tudo pronto), "blocked" (há bloqueios que a preparação não sabe resolver, como `not_due`/`stale`/`not_confirmed`, ou um `service_running` sem `serviceId`) ou um plano concreto de passos ordenados (`stop_registered_services`, `drain_active_tasks`, `complete_backup`, `synchronize_filesystem`). É a peça central de "o que fazer" antes de sequer tocar em qualquer controlador real.
- **`PrepareMachineShutdownOccurrence.prepareAt`** (mesmo arquivo) — o motor de execução do plano: roda cada passo em sequência, registra eventos de auditoria de preparação, para no primeiro passo que falhar/bloquear, e reavalia a prontidão no final para decidir entre `prepared` (tudo resolvido) e `incomplete` (algo ainda impede o shutdown, mesmo após tentar preparar).
- **`EvaluateMachineShutdownReadiness.evaluateAt`** (`src/power-management/application/evaluate-machine-shutdown-readiness.ts`) — chamada duas vezes dentro de uma preparação (decisão inicial e reavaliação final): primeiro checa se `scheduledFor` já chegou e `wakeScheduledFor` ainda não passou, depois checa a confirmação (via `MachineShutdownConfirmationReader`, que no caminho HTTP sempre retorna "confirmed" — ver Observações), e por fim coleta bloqueios de serviços/tarefas/backup/filesystem/auditoria.
- **`mapMachineShutdownPreparationResponse`** (`src/http/administrative-shutdown-response.ts`) — expõe só o essencial do relatório de preparação: contagem de passos completados e os bloqueios finais (ou iniciais, se não houve reavaliação).

## Erros e casos de borda

- Corpo com campos a mais/faltando, chave duplicada, JSON inválido, tipo errado de `operation`/`scheduledFor`/`wakeScheduledFor` → 400 `invalid_machine_shutdown_request`.
- `confirmation` diferente de `confirm_shutdown_preparation` (incluindo mandar `confirm_shutdown_execution` nesta rota) → 400 `invalid_machine_shutdown_request` (não um erro de "confirmação incorreta" distinto — `MachineShutdownConfirmationValidationError` é capturado pelo catch genérico de `parseShutdownRequest` e vira o mesmo código 400).
- `scheduledFor >= wakeScheduledFor` → rejeitado já dentro de `createMachineShutdownOccurrence` como `invalid_timestamp_order` (400).
- Janela entre `scheduledFor` e `wakeScheduledFor` maior que 7 dias → 422 `invalid_machine_shutdown_interval` (checagem feita em `parseShutdownRequest`, não no domínio).
- `scheduledFor` ainda no futuro (agora < scheduledFor) ou já expirado (agora >= wakeScheduledFor) → a preparação retorna 200 com `outcome: "blocked"` e um bloqueio `{ area: "confirmation", code: "not_due" | "stale" }` — não é um erro HTTP, é um resultado de negócio.
- Falha ao registrar um evento de preparação (auditoria interna de passos) → a preparação é interrompida e retorna `outcome: "incomplete"` com status 200; o cliente só percebe pelo campo `outcome`/`blockers`, não pelo código HTTP.
- Falha de um passo de preparação (ex.: parar um serviço falha) → também `outcome: "incomplete"`, 200.
- Falha da trilha de auditoria administrativa (não a de eventos de preparação) depois que a preparação já teve efeito real (serviços parados, etc.) → 503 `administrative_shutdown_preparation_state_recheck_required`.
- Gate de concorrência ocupado → 409 `administrative_power_operation_busy`.
- Rate limit → 429.

## Observações

O `MachineShutdownConfirmationReader` usado durante a avaliação de prontidão, no caminho HTTP, **sempre** retorna `"confirmed"` — veja `createRequestConfirmationReader` em `src/http/administrative-shutdown-route.ts`, que ignora completamente o valor de `confirmation` e resolve `"confirmed"` incondicionalmente. Isso é intencional (a confirmação real já foi checada por `parseShutdownRequest` contra o `stage` da rota, então chegar até aqui já implica confirmação válida), mas o nome do leitor (`ConfirmationReader`) e sua posição dentro de `EvaluateMachineShutdownReadiness` podem enganar quem espera que ele reflita algo dinâmico — na prática, no caminho HTTP manual, o bloqueio `not_confirmed` nunca pode ocorrer; ele só existe para o caminho automático do agendador (`ScheduledPolicyMachineShutdownConfirmationReader`, fora do escopo desta rota).
