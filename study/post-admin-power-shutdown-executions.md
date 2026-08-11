# POST /admin/power/shutdown/executions

## Resumo

Executa de fato o desligamento: se a máquina estiver pronta (sem bloqueios) e dentro da janela agendada, reivindica a ocorrência (evita duplicidade), agenda o wake-alarm de retorno e dispara o desligamento no hardware. Ao contrário do que o nome sugere, esta rota **não prepara nada sozinha** — ela depende de o chamador já ter resolvido os bloqueios via `POST /admin/power/shutdown/preparations` antes.

## Contrato

- **Método**: POST
- **Path**: `/admin/power/shutdown/executions` (sem parâmetros de rota)
- **Query string**: não aceita nenhuma.
- **Autenticação**: Cloudflare Access, obrigatória.
- **Permissão**: `power.shutdown.execute` (operação `execute_machine_shutdown_occurrence`).
- **Feature flag**: `ADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED`.
- **Confirmação exigida**: `"confirmation": "confirm_shutdown_execution"` — exatamente essa string; mandar `confirm_shutdown_preparation` aqui é rejeitado com 400 igual a qualquer outro corpo malformado.
- **Gate de concorrência**: `power_operation` — mesmo `AdministrativePowerOperationGate` de slot único compartilhado com PUT/DELETE de wake-alarm e com `POST /admin/power/shutdown/preparations`.
- **Corpo da requisição**: JSON, até 1024 bytes, mesmo formato de `occurrence` + `confirmation` da rota de preparação: `{ "operation": "shutdown", "scheduledFor": <timestamp>, "wakeScheduledFor": <timestamp>, "confirmation": "confirm_shutdown_execution" }`. **O `occurrence` (scheduledFor/wakeScheduledFor) precisa ser idêntico ao usado na preparação correspondente** — são comparados por valor (`isSameMachineShutdownOccurrence`, usado no restante do sistema, embora não diretamente nesta rota — ver Funções-chave).
- **Formato da resposta** (200): `{ "occurrence": {...}, "processedAt": <timestamp>, "outcome": "not_due" | "stale" | "duplicate" | "rejected" | "preparation_incomplete" | "executed", "blockers"?: [...], "wakeAlarm"?: {outcome, scheduledFor}, "shutdown"?: {outcome} }` — os campos `wakeAlarm`/`shutdown` só aparecem quando `outcome === "executed"`; `blockers` só aparece quando `outcome === "rejected"`.
- **Códigos de status possíveis**: 200 (inclusive para `outcome: "rejected"` — a rejeição por falta de prontidão não é um erro HTTP), 400, 405, 409 (`administrative_power_operation_busy`), 413, 414, 415, 422, 401/403/503 (acesso), 429, 503 (`administrative_shutdown_claim_unavailable`, `administrative_shutdown_state_recheck_required`, `administrative_shutdown_readiness_unavailable`, `administrative_event_history_unavailable`), 500.

## Caminho da requisição

- Mesmo esqueleto da rota de preparação: `registerAdministrativeShutdownRoutes` → `createAdministrativeShutdownHandler("execution", dependencies)` → `processShutdownRequest(stage="execution", ...)`, todos em `src/http/administrative-shutdown-route.ts`.
- Validação de forma idêntica à da preparação (`readShutdownBody`, `parseShutdownRequest` — que aqui exige `confirmation.stage === "execution"`), depois aquisição do mesmo gate de concorrência `power_operation`.
- A chamada de negócio é `protectedAdministration.executeMachineShutdownOccurrence.execute(occurrence)`. É na composição de acesso (`src/access-control/composition/create-protected-administration.ts`, função `executeMachineShutdownOccurrence`) que a decisão crítica é tomada: ela chama `ExecuteMachineShutdownOccurrence.executeAt` passando `automaticallyPrepare: false` sempre que há um `confirmationReader` — e no caminho HTTP sempre há um. **Isso significa que a execução via HTTP nunca tenta preparar automaticamente**, mesmo que a classe `ExecuteMachineShutdownOccurrence` internamente tenha essa capacidade (usada pelo agendador automático, fora do escopo desta rota).
- Dentro de `ExecuteMachineShutdownOccurrence.executeCore` (`src/power-management/application/execute-machine-shutdown-occurrence.ts`): checa se já é hora (`scheduledFor`) e se ainda não expirou (`wakeScheduledFor`); avalia a prontidão (`EvaluateMachineShutdownReadiness`, os mesmos bloqueios da preparação); se rejeitada — e como `automaticallyPrepare` é `false` — retorna `outcome: "rejected"` imediatamente, **sem tentar corrigir nada**. Só se a prontidão já estiver aprovada é que o fluxo segue para reivindicar a ocorrência (`claim`, evita duplicidade), agendar o wake-alarm de retorno e disparar o desligamento real.
- A resposta é mapeada por `mapMachineShutdownExecutionResponse` e limitada por `sendBoundedResponse`.

## Funções-chave

- **`ExecuteMachineShutdownOccurrence.executeCore`** (`src/power-management/application/execute-machine-shutdown-occurrence.ts`) — o coração da rota: decide, em sequência, se está no prazo, se está pronta, se já foi reivindicada antes (dedup), e só então executa os dois efeitos irreversíveis (agendar wake-alarm + pedir shutdown ao hardware). É aqui que a relação com a preparação se torna concreta: como `automaticallyPrepare` chega `false` do caminho HTTP, um bloqueio de prontidão aqui **não é corrigido**, só reportado.
- **A composição em `create-protected-administration.ts` (`executeMachineShutdownOccurrence`)** — decide passar `automaticallyPrepare: false` sempre que existe `confirmationReader` (que no HTTP sempre existe). Essa única linha é o que transforma "executar" em uma operação que exige preparação prévia bem-sucedida, em vez de uma que resolve tudo sozinha.
- **`MachineShutdownOccurrenceClaimStore.claim`** (via `createMachineShutdownOccurrenceClaimResult`) — depois que a prontidão foi aprovada, é o que impede duas execuções concorrentes (ou repetidas) da mesma ocorrência de shutdown produzirem dois desligamentos; se já houver uma claim para a mesma ocorrência, o resultado é `outcome: "duplicate"`, 200, sem tocar em wake-alarm nem hardware.
- **`EvaluateMachineShutdownReadiness.evaluateAt`** (`src/power-management/application/evaluate-machine-shutdown-readiness.ts`) — reaproveitada tal e qual da rota de preparação; é porque a preparação já rodou os controladores reais (parou serviços, etc.) que uma nova avaliação aqui, na execução, tende a encontrar os mesmos bloqueios já resolvidos — a "ponte" entre as duas rotas não é um flag salvo em algum lugar, é o efeito colateral real já ter acontecido.
- **`mapMachineShutdownExecutionResponse`** (`src/http/administrative-shutdown-response.ts`) — decide quais campos expor conforme o `outcome` (`blockers` só em `rejected`; `wakeAlarm`/`shutdown` só em `executed`), refletindo o tipo discriminado `MachineShutdownOccurrenceExecutionResult`.

## Erros e casos de borda

- Mesmos erros de forma de corpo/confirmação/intervalo que a rota de preparação (400/422/413/415/414), trocando `confirm_shutdown_preparation` por `confirm_shutdown_execution` como valor exigido.
- **Executar sem preparar antes**: se ainda houver bloqueios (ex.: um serviço ainda rodando), a resposta é 200 com `outcome: "rejected"` e `blockers` listando o motivo — a rota não falha com erro HTTP, ela recusa educadamente. É o caso de borda mais importante de entender: chamar `executions` direto, sem passar por `preparations`, é uma operação válida que frequentemente vai resultar em `rejected` se houver qualquer coisa rodando na máquina.
- `scheduledFor` ainda no futuro → `outcome: "not_due"`, 200. `wakeScheduledFor` já passado → `outcome: "stale"`, 200. Nenhum dos dois é erro HTTP.
- Mesma ocorrência (`scheduledFor`/`wakeScheduledFor` idênticos) já reivindicada anteriormente → `outcome: "duplicate"`, 200 — proteção contra retries/duplo clique disparando dois shutdowns.
- Falha ao reivindicar a ocorrência (erro do `MachineShutdownOccurrenceClaimStore`) → 503 `administrative_shutdown_claim_unavailable` (erro HTTP de verdade, não um outcome).
- Falha ao agendar o wake-alarm de retorno **depois** de já ter reivindicado a ocorrência, ou falha ao pedir o shutdown ao hardware **depois** de já ter agendado o wake-alarm → 503 `administrative_shutdown_state_recheck_required`/`administrative_shutdown_readiness_unavailable` conforme o caso — situação em que o estado real da máquina pode estar parcialmente alterado (wake-alarm já agendado, shutdown não confirmado) e o cliente precisa checar com GET em vez de assumir sucesso ou falha total.
- Gate de concorrência ocupado (inclusive por uma preparação em andamento) → 409 `administrative_power_operation_busy`.
- Rate limit → 429.

## Observações

A relação entre `preparations` e `executions` **não é modelada por um estado persistido explícito** (não existe um "esta ocorrência foi preparada: sim/não" salvo em disco). A ligação é inteiramente indireta: a preparação executa efeitos reais no mundo (para serviços, drena tarefas, completa backup, sincroniza filesystem), e a execução simplesmente reavalia a mesma checagem de prontidão — que só passa se esses efeitos já tiverem acontecido. Isso implica que:
1. Se algo religar um serviço entre a preparação e a execução, a execução volta a ser bloqueada mesmo já tendo sido "preparada" antes.
2. Chamar `executions` sem nunca ter chamado `preparations` é um fluxo perfeitamente válido do ponto de vista da API — só costuma falhar (`rejected`) se houver bloqueios reais no momento.
3. A classe `ExecuteMachineShutdownOccurrence` internamente suporta preparar automaticamente (`automaticallyPrepare`, usado pelo agendador em `src/power-management/composition/create-power-management.ts`), mas o caminho HTTP explicitamente desativa isso (`automaticallyPrepare: false` em `create-protected-administration.ts`) — ou seja, a "automação" existe no código mas está deliberadamente desligada para chamadas manuais via API.
