# DELETE /admin/power/wake-alarm

## Resumo

Cancela o alarme de despertar (RTC wake alarm) agendado na máquina, se houver um. É o inverso do PUT: garante que a máquina não vai religar sozinha, mesmo que um agendamento anterior existisse.

## Contrato

- **Método**: DELETE
- **Path**: `/admin/power/wake-alarm` (sem parâmetros de rota)
- **Query string**: não aceita nenhuma — qualquer `?` no request target é rejeitado com 400.
- **Autenticação**: Cloudflare Access, obrigatória.
- **Permissão**: `power.wake.delete` (operação `cancel_wake_alarm`).
- **Feature flag**: `ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED`.
- **Confirmação**: nenhuma exigida (`mutationWithoutConfirmation` no catálogo).
- **Gate de concorrência**: `power_operation` — o mesmo `AdministrativePowerOperationGate` de slot único compartilhado com PUT desta rota **e** com POST das duas rotas de shutdown. Só uma mutação de energia por vez em todo o sistema.
- **Corpo da requisição**: nenhum. Se vier `Content-Length` (≠ "0"), `Transfer-Encoding` ou `Content-Type`, a rota rejeita com 400 (`invalid_administrative_request`) — igual ao GET.
- **Formato da resposta** (200): `{ "operation": "cancel", "requestedAt": <timestamp>, "outcome": "cancelled" | "not_scheduled", "before": {...estado...}, "after": {...estado...} }`.
- **Códigos de status possíveis**: 200, 400 (corpo presente indevidamente, ou target/query inválidos), 401/403/503 (acesso), 404, 405, 409 (`administrative_wake_alarm_busy`, gate ocupado), 414, 429, 503 (`administrative_wake_alarm_unavailable` ou `administrative_wake_alarm_state_recheck_required`), 500.

## Caminho da requisição

- Mesmo ponto de entrada de GET/PUT: `registerAdministrativeWakeAlarmRoute` → `createAdministrativeWakeAlarmHandler` → `processRequest`, em `src/http/administrative-wake-alarm-route.ts`.
- Dentro de `processRequest`, para DELETE: `validateAdministrativeRequestHasNoBody` garante que não há corpo (encanamento) — não há parsing de payload, ao contrário do PUT.
- O gate de mutação (`dependencies.mutationGate.tryAdmit()`) é adquirido antes de qualquer chamada de negócio; se ocupado, 409 imediato.
- A lógica de negócio de verdade mora em `CancelWakeAlarm.executeAsAuthorized` (`src/power-management/application/cancel-wake-alarm.ts`), acessada via `protectedAdministration.cancelWakeAlarm.execute()`: grava um evento de auditoria "started", chama `WakeAlarmController.cancel(requestedAt)` (que decide `cancelled` vs `not_scheduled` conforme o estado atual do hardware) e fecha o evento de auditoria.
- A resposta é mapeada por `mapWakeAlarmMutationResponse` (mesma função usada pelo PUT, já que ambos produzem um `WakeAlarmMutationResult`) e limitada em tamanho por `sendBoundedResponse`.

## Funções-chave

- **`processRequest`** (`src/http/administrative-wake-alarm-route.ts`) — decide, pelo `request.method === "DELETE"`, chamar `cancelWakeAlarm.execute()` em vez de `scheduleWakeAlarm`/`getNextWakeAlarm`.
- **`CancelWakeAlarm.executeAsAuthorized`** (`src/power-management/application/cancel-wake-alarm.ts`) — função central: decide o `requestedAt`, envolve a chamada ao controlador de hardware com auditoria (begin/complete), e converte falha de fechamento de auditoria pós-efeito em `AdministrativeAuditPartialEffectError` em vez de deixar a rota reportar sucesso incondicional ou erro genérico.
- **`FixedAdministrativePowerOperationGate.tryAdmit`** (`src/http/administrative-power-operation-gate.ts`) — mesmo gate do PUT; impede cancelamento concorrente com outro agendamento ou com uma operação de shutdown em andamento.
- **`mapWakeAlarmMutationResponse`** (`src/http/administrative-wake-alarm-response.ts`) — reaproveitada do PUT, traduz `before`/`after`/`outcome` para o formato de resposta.
- **`validateAdministrativeRequestHasNoBody`** (`src/http/administrative-http.ts`) — rejeita qualquer corpo/headers de corpo presentes; é o que torna esta rota simétrica ao GET em termos de forma da requisição (mas ainda assim uma mutação, com gate e auditoria).

## Erros e casos de borda

- Path diferente de `/admin/power/wake-alarm` → 404 `route_not_found`.
- Método fora de GET/PUT/DELETE → 405, `Allow: GET, PUT, DELETE`.
- Qualquer corpo presente (mesmo vazio, mas com `Content-Type` setado) → 400 `invalid_administrative_request`.
- Gate de mutação ocupado → 409 `administrative_wake_alarm_busy` — inclusive se ocupado por uma preparação/execução de shutdown em andamento (gate compartilhado, ver Observações).
- Cancelar quando não há alarme agendado não é erro: o controlador retorna `outcome: "not_scheduled"` com status 200 — a rota não distingue "cancelei algo" de "não havia nada para cancelar" em termos de código HTTP, só no campo `outcome` da resposta.
- Falha do controlador de hardware → 503 `administrative_wake_alarm_unavailable`.
- Falha de auditoria após o cancelamento já ter ocorrido no hardware → 503 `administrative_wake_alarm_state_recheck_required` (o cliente precisa checar o estado real com GET, pois o cancelamento pode ter ocorrido mesmo sem confirmação).
- Rate limit → 429.

## Observações

Mesmo gate compartilhado descrito no documento do PUT: `power_operation` é uma única instância de `FixedAdministrativePowerOperationGate` reaproveitada entre PUT/DELETE de wake-alarm e POST das duas rotas de shutdown (`src/http/create-administrative-runtime.ts`). Um DELETE aqui pode ser recusado com 409 por causa de uma preparação de shutdown rodando em paralelo, o que pode ser surpreendente se não se souber que o gate é compartilhado.
