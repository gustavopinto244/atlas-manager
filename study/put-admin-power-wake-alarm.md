# PUT /admin/power/wake-alarm

## Resumo

Agenda (ou substitui) o alarme de despertar (RTC wake alarm) da máquina para um horário futuro específico. É a rota que efetivamente programa o hardware para religar a máquina sozinha — usada, por exemplo, antes de um desligamento planejado.

## Contrato

- **Método**: PUT
- **Path**: `/admin/power/wake-alarm` (sem parâmetros de rota)
- **Query string**: não aceita nenhuma — qualquer `?` no request target é rejeitado com 400.
- **Autenticação**: Cloudflare Access, obrigatória.
- **Permissão**: `power.wake.update` (operação `schedule_wake_alarm`).
- **Feature flag**: `ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED`.
- **Confirmação**: nenhuma exigida (`mutationWithoutConfirmation` no catálogo — diferente das rotas de shutdown, esta mutação não pede um campo de confirmação explícito no corpo).
- **Gate de concorrência**: `power_operation` — usa o mesmo `AdministrativePowerOperationGate` (`FixedAdministrativePowerOperationGate`, um único slot) compartilhado com DELETE desta rota **e** com POST das duas rotas de shutdown (`/admin/power/shutdown/preparations` e `/admin/power/shutdown/executions`). Só uma mutação de energia pode estar em andamento no sistema inteiro a qualquer momento.
- **Corpo da requisição**: JSON, `Content-Type: application/json` (ou `; charset=utf-8`), sem `Content-Encoding`, até 512 bytes. Único campo aceito: `{ "scheduledFor": <timestamp canônico ISO 8601, ex. "2026-01-01T00:00:00.000Z"> }`. Campos extras ou ausência de `scheduledFor` são rejeitados.
- **Formato da resposta** (200): `{ "operation": "schedule", "requestedAt": <timestamp>, "outcome": "scheduled" | "replaced" | "unchanged", "before": {...estado...}, "after": {...estado...} }`.
- **Códigos de status possíveis**: 200, 400 (`invalid_wake_alarm_request` — corpo malformado, JSON inválido, chave duplicada, campo desconhecido, corpo vazio, não-UTF-8), 405, 409 (`administrative_wake_alarm_busy` — gate ocupado), 413 (`payload_too_large`, corpo > 512 bytes, checado tanto por `Content-Length` quanto durante a leitura), 414 (`uri_too_long`), 415 (`unsupported_media_type` — `Content-Type` ou `Content-Encoding` incorretos), 422 (`wake_alarm_schedule_not_future` — `scheduledFor` não está no futuro), 401/403/503 (acesso), 429 (rate limit), 500 (resposta grande demais ou erro não mapeado).

## Caminho da requisição

- Mesmo ponto de entrada de GET/DELETE: `registerAdministrativeWakeAlarmRoute` → `createAdministrativeWakeAlarmHandler` → `processRequest`, todos em `src/http/administrative-wake-alarm-route.ts`.
- Dentro de `processRequest`, para PUT: primeiro lê e faz parse do corpo com `readScheduleBody` (streaming, com verificação de `Content-Type`, `Content-Encoding`, `Content-Length`, tamanho acumulado e UTF-8) — isso é encanamento de validação de forma, junto com o parse estrito de JSON (`parseStrictJson`, que rejeita chaves duplicadas).
- Em seguida valida a forma do payload de domínio com `createWakeAlarmSchedule` (`src/power-management/domain/wake-alarm-schedule.ts`) — ainda validação de forma, mas já no domínio.
- Só depois disso o gate de mutação (`dependencies.mutationGate.tryAdmit()`, o `AdministrativePowerOperationGate` compartilhado) é adquirido — se ocupado, 409 antes de qualquer chamada de negócio.
- A lógica de negócio de verdade mora em `ScheduleWakeAlarm.executeAsAuthorized` (`src/power-management/application/schedule-wake-alarm.ts`), acessada via `protectedAdministration.scheduleWakeAlarm.execute(schedule)`: valida de novo que o horário é futuro (`assertWakeAlarmScheduleIsFuture`, contra o relógio no momento da autorização, não o da leitura do corpo), grava um evento de auditoria "started", chama o `WakeAlarmController.schedule(...)` real (que decide se é `scheduled`/`replaced`/`unchanged` comparando com o estado atual do hardware) e fecha o evento de auditoria como "succeeded"/"failed".
- A resposta é mapeada por `mapWakeAlarmMutationResponse` e limitada em tamanho por `sendBoundedResponse` — encanamento.

## Funções-chave

- **`createWakeAlarmSchedule`** (`src/power-management/domain/wake-alarm-schedule.ts`) — valida que o corpo tem exatamente o campo `scheduledFor` e que ele é um timestamp canônico. Primeira barreira de validação de domínio.
- **`assertWakeAlarmScheduleIsFuture`** (mesmo arquivo) — compara `scheduledFor` com o instante em que a mutação é de fato autorizada e lança `scheduled_for_not_future` se não for estritamente posterior. É chamada duas vezes no fluxo completo (uma vez em `processRequest` só para validar o formato via `createWakeAlarmSchedule`, e de novo dentro de `ScheduleWakeAlarm.executeAsAuthorized` com o timestamp real de autorização) — a segunda é a que efetivamente decide o 422.
- **`ScheduleWakeAlarm.executeAsAuthorized`** (`src/power-management/application/schedule-wake-alarm.ts`) — a função central da rota: decide o horário de "requestedAt", grava o par de eventos de auditoria (begin/complete) ao redor da chamada real ao controlador de hardware, e propaga `AdministrativeAuditPartialEffectError` se a mutação teve efeito mas a auditoria falhou ao fechar (para não mentir dizendo que nada aconteceu).
- **`FixedAdministrativePowerOperationGate.tryAdmit`** (`src/http/administrative-power-operation-gate.ts`) — um lock de slot único; decide se esta mutação pode prosseguir ou se deve ser rejeitada com 409 porque outra mutação de energia (wake ou shutdown) está em andamento.
- **`mapWakeAlarmMutationResponse`** (`src/http/administrative-wake-alarm-response.ts`) — traduz o resultado de domínio (`WakeAlarmMutationResult`, com `before`/`after`) para o formato de resposta HTTP.

## Erros e casos de borda

- Corpo ausente, vazio, não-UTF-8, JSON malformado, ou chave duplicada → 400 `invalid_wake_alarm_request` (via `parseStrictJson`/`readScheduleBody`).
- `Content-Type` diferente de `application/json` (com ou sem `; charset=utf-8`) → 415 `unsupported_media_type`.
- Qualquer `Content-Encoding` presente → 415 `unsupported_media_type` (a rota não descomprime nada).
- `Content-Length` maior que 512 bytes, ou corpo real maior que 512 bytes durante a leitura (mesmo sem `Content-Length` correto) → 413 `payload_too_large`.
- Campo `scheduledFor` ausente, campo extra, ou tipo/formato inválido → 400 `invalid_wake_alarm_request` (via `WakeAlarmScheduleValidationError`, exceto o código `scheduled_for_not_future`).
- `scheduledFor` no passado ou igual ao instante de autorização → 422 `wake_alarm_schedule_not_future`. Note que essa checagem usa o relógio no momento em que o gate já foi liberado e a operação está sendo autorizada — não o instante em que o corpo foi lido, então uma requisição "no limite" pode passar na validação de forma e falhar aqui.
- Gate de mutação ocupado (outra mutação de energia rodando) → 409 `administrative_wake_alarm_busy`.
- Falha do controlador de hardware, ou falha de auditoria após a mutação já ter ocorrido → 503 (`administrative_wake_alarm_unavailable` ou `administrative_wake_alarm_state_recheck_required`, respectivamente) — o segundo caso é importante: significa que o alarme pode ter sido de fato agendado, mas o cliente não recebeu confirmação, e precisa checar o estado com um GET.
- Rate limit → 429.

## Observações

O gate de concorrência (`power_operation`) é compartilhado entre PUT/DELETE de wake-alarm e POST das duas rotas de shutdown — uma única instância de `FixedAdministrativePowerOperationGate` é passada para todas (ver `src/http/create-administrative-runtime.ts`). Isso significa que, por exemplo, uma preparação de shutdown em andamento bloqueia (com 409) uma tentativa concorrente de reagendar o alarme, e vice-versa. Vale a pena o autor original ter isso em mente ao testar concorrência entre essas rotas.
