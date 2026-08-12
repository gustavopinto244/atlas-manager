# GET /admin/power/wake-alarm

## Resumo

Lê o estado atual do alarme de despertar (RTC wake alarm) da máquina: se há um horário agendado, qual é, ou se o hardware não suporta a funcionalidade. É a rota de leitura que alimenta o dashboard e qualquer cliente que precise saber "a máquina vai acordar sozinha, e quando?".

## Contrato

- **Método**: GET
- **Path**: `/admin/power/wake-alarm` (sem parâmetros de rota)
- **Query string**: não aceita nenhuma — qualquer `?` no request target é rejeitado com 400.
- **Autenticação**: Cloudflare Access (via `CloudflareAccessAssertionReader`), obrigatória.
- **Permissão**: `power.wake.read` (operação `read_wake_alarm`).
- **Feature flag**: `ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED` (ver `ADMINISTRATIVE_ROUTE_SECURITY_CATALOG` em `src/http/administrative-route-security-catalog.ts`).
- **Middlewares**: envelope de segurança administrativa (`createAdministrativeSecurityEnvelope`, valida Host/Origin/Sec-Fetch-*) em `src/http/create-app.ts`; admissão de taxa (`AdministrativeRequestAdmission`) por request, compartilhada com PUT/DELETE da mesma rota.
- **Corpo da requisição**: nenhum. Se vier `Content-Length` (≠ "0"), `Transfer-Encoding` ou `Content-Type`, a rota rejeita com 400 (`invalid_administrative_request`).
- **Formato da resposta** (200): `{ "observedAt": <timestamp>, "wakeAlarm": { "state": "unsupported" | "not_scheduled" | "scheduled", "scheduledFor"?: <timestamp> } }`.
- **Códigos de status possíveis**: 200 (sucesso), 400 (query/corpo/target inválido), 401/403/503 (falhas de autenticação/autorização, via `mapAdministrativeAccessControlError`), 404 (path não bate com a rota), 405 (método fora de GET/PUT/DELETE), 429 (rate limit, `Retry-After: 1`), 503 (`administrative_wake_alarm_unavailable` se a leitura de hardware falhar, ou `administrative_event_history_unavailable` em erro de auditoria), 500 (resposta ultrapassaria 16 384 bytes).

## Caminho da requisição

- `registerAdministrativeWakeAlarmRoute` registra a rota via `registerAdministrativeRoute(app, ["power.wake.read", "power.wake.update", "power.wake.delete"], handler)` em `src/http/administrative-wake-alarm-route.ts`. As três permissões (GET/PUT/DELETE) compartilham o mesmo path e o mesmo handler Express (`app.all`) — quem decide o verbo de fato é `processRequest`.
- `createAdministrativeWakeAlarmHandler` (mesmo arquivo) é o encanamento comum às três operações: define os headers de segurança, tenta admitir a requisição no rate limiter compartilhado (`dependencies.admission.tryAdmit()`) e, se admitida, delega para `processRequest`.
- Dentro de `processRequest`: valida que o path bate exatamente com `/admin/power/wake-alarm`, que o método é um dos três suportados, o tamanho da URL, ausência de query string e (para GET/DELETE) ausência de corpo — tudo isso é encanamento de forma, não lógica de negócio.
- A chamada real de negócio, para GET, é `protectedAdministration.getNextWakeAlarm.execute()` — construída em `createProtectedAdministration` (`src/access-control/composition/create-protected-administration.ts`), que autentica, autoriza e só então delega para `GetNextWakeAlarm.executeAt` (`src/power-management/application/get-next-wake-alarm.ts`), que por sua vez chama o `WakeAlarmReader` real (leitura de hardware/mock).
- A resposta é mapeada por `mapWakeAlarmObservationResponse` (`src/http/administrative-wake-alarm-response.ts`) e serializada/limitada em tamanho por `sendBoundedResponse` (encanamento).

## Funções-chave

- **`processRequest`** (`src/http/administrative-wake-alarm-route.ts`) — o roteador de verdade: decide, a partir de `request.method`, qual das três operações de negócio (leitura, agendamento, cancelamento) disparar. É o "porteiro" HTTP da rota inteira, compartilhado pelos três verbos.
- **`GetNextWakeAlarm.executeAt`** (`src/power-management/application/get-next-wake-alarm.ts`) — valida que o timestamp de observação é canônico e delega para `WakeAlarmReader.read(observedAt)`. É a lógica de negócio real desta rota especificamente (para PUT/DELETE, ver os outros dois documentos).
- **`ExecuteProtectedAdministrativeOperation.run`** (classe interna em `create-protected-administration.ts`) — autentica o principal, autoriza a operação `read_wake_alarm`, registra a decisão em auditoria e só então invoca a leitura. Ponto único de autenticação/autorização/auditoria para toda rota administrativa.
- **`mapWakeAlarmObservationResponse`** (`src/http/administrative-wake-alarm-response.ts`) — valida a forma do resultado de domínio (`createWakeAlarmObservation`) e achata o estado do alarme (`mapState`) para o formato de resposta HTTP.
- **`sendBoundedResponse`** (`src/http/administrative-wake-alarm-route.ts`) — serializa a resposta e garante que não ultrapassa `ADMINISTRATIVE_WAKE_ALARM_MAX_RESPONSE_BYTES` (16 384 bytes), lançando 500 caso ultrapasse.

## Erros e casos de borda

- Path diferente de `/admin/power/wake-alarm` → 404 `route_not_found` antes de qualquer outra validação.
- Método fora de GET/PUT/DELETE → 405 `method_not_allowed`, com header `Allow: GET, PUT, DELETE`.
- Qualquer `?` na URL → 400 `invalid_administrative_request`.
- Presença de `Content-Length` (diferente de "0"), `Transfer-Encoding` ou `Content-Type` em um GET → 400 `invalid_administrative_request` (`validateAdministrativeRequestHasNoBody`).
- Falha de leitura do hardware (mapeada como `AdministrativeAccessControlError` com `code: "protected_operation_failed"` e `operation: "read_wake_alarm"`) → 503 `administrative_wake_alarm_unavailable`, em vez do 503 genérico de acesso negado.
- Falha de autenticação/autorização → 401/403/503 via `mapAdministrativeAccessControlError`.
- Erro de trilha de auditoria (`AdministrativeAuditTrailError`) → 503 `administrative_event_history_unavailable`.
- Rate limit (`admission.tryAdmit()` retorna `undefined`) → 429 com `Retry-After: 1`. Esse limitador é o mesmo (`admission`) usado pelo PUT e pelo DELETE da mesma rota.
- Qualquer erro não mapeado → 500 `internal_error`.

## Observações

Nenhuma inconsistência notada nesta variante GET especificamente. O handler é compartilhado pelas três operações (ver `src/http/administrative-wake-alarm-route.ts` completo) — os detalhes de mutação (PUT/DELETE) estão nos documentos correspondentes.
