# PUT /admin/services/:serviceId/schedule

## Resumo

Substitui a política de disponibilidade (schedule) salva para um serviço registrado. É uma mutação protegida por confirmação explícita no corpo e por um lock de exclusão mútua compartilhado com outras rotas de mutação administrativa.

## Contrato

- **Método/path**: `PUT /admin/services/:serviceId/schedule`. Mesmo path e mesmo handler Express (`app.all`) da rota GET/DELETE — o dispatch por verbo acontece dentro de `process`, em `src/http/administrative-service-schedule-route.ts`.
- **Entrada no catálogo**: `services.schedule.update` em `ADMINISTRATIVE_ROUTE_SECURITY_CATALOG`.
- **Ativação**: mesma condição composta das outras variantes desta rota — `ADMINISTRATIVE_SERVICE_SCHEDULE_CAPABILITY`, que só é satisfeita quando `administrativeServiceAvailabilityHttpEnabled === true` **e** `SERVICE_AVAILABILITY_POLICY_FILE` está configurada (verificado em `src/http/create-administrative-runtime.ts`).
- **Middlewares/segurança**: envelope administrativo (Host/Origin/Sec-Fetch-*) + admissão de taxa compartilhada (`admission.tryAdmit()`) + **gate de mutação** (`dependencies.mutationGate.tryAdmit()`, `FixedAdministrativePowerOperationGate` — lock booleano exclusivo, sem contagem, compartilhado com `services`, `availability`, `machine schedule` e `backups`: só uma mutação dessas famílias pode estar em voo por vez em todo o processo).
- **Autenticação**: obrigatória; permissão exigida `services.availability.write` (operation `update_registered_service_schedule`).
- **Confirmação**: `confirmationPolicy: "exact:confirm_registered_service_schedule_update"` no catálogo — o corpo precisa conter exatamente o campo `confirmation` com esse valor literal.
- **Parâmetros de rota**: `serviceId`, mesma validação regex das outras variantes; falha vira `404 registered_service_not_found`.
- **Query string**: proibida (`rejectAdministrativeQuery`).
- **Corpo da requisição**: `Content-Type` deve ser exatamente `application/json` ou `application/json; charset=utf-8` (qualquer outro valor → `415`); `Content-Encoding` não pode estar presente (qualquer encoding, mesmo `identity`, é rejeitado com `415` — o header simplesmente não pode existir); tamanho máximo **4096 bytes** (constante local `MAX_BODY_BYTES`, não os 8192 declarados como `JSON_BODY.maxBodyBytes` no catálogo — ver Observações); JSON parseado com `parseStrictJson` (rejeita chaves duplicadas). Formato esperado: objeto com **exatamente** as chaves `confirmation` e `policy` — nada a mais, nada a menos. `confirmation` deve ser a string literal `"confirm_registered_service_schedule_update"`.
- **Resposta em caso de sucesso**: `200 application/json`, corpo devolvido por `setRegisteredServiceSchedule.execute(serviceId, policy)`.
- **Códigos de status possíveis**: `200`, `400 invalid_service_schedule_request` (corpo malformado, chaves erradas, confirmação errada, ou política inválida em qualquer regra de domínio), `404 registered_service_not_found`, `409 administrative_service_operation_busy` (gate de mutação ocupado), `413 payload_too_large`, `414 uri_too_long`, `415 unsupported_media_type`, `401/403/503` (acesso), `429 administrative_request_limited`, `500 internal_error`.

## Caminho da requisição

- `createHandler` → `process` (`src/http/administrative-service-schedule-route.ts`) — mesmo encanamento comum às três variantes (headers, admissão, validação de `serviceId`, ausência de query).
- Dentro de `process`, ramo não-GET: tenta `mutationGate.tryAdmit()`; se ocupado, `409` antes mesmo de ler o corpo.
- `readBody(request)` — encanamento de leitura: valida `Content-Type`/`Content-Encoding`, acumula chunks respeitando o limite de 4096 bytes, faz `parseStrictJson`.
- `parseMutation(body, "update")` — encanamento de validação de forma: garante exatamente `{confirmation, policy}` e o valor exato de `confirmation`. Extrai `policy` cru (`unknown`), sem validar seu conteúdo — quem valida o domínio é a camada de aplicação.
- **Lógica de negócio de verdade**: `protectedAdministration.setRegisteredServiceSchedule.execute(serviceId, policy)`, wired em `src/access-control/composition/create-protected-administration.ts`, que delega a `UpdateRegisteredServiceAvailabilityPolicy` (`src/service-management/application/update-registered-service-availability-policy.ts`): localiza o serviço, valida o `policy` cru com `createServiceAvailabilityPolicy(input)` (aqui moram as regras reais de disponibilidade — modo, timezone, intervalos etc.) e persiste com `policyStore.save(service.id, policy)`.
- `send(response, value)` — serializa e responde. Encanamento.

## Funções-chave

- **`readBody`** (`src/http/administrative-service-schedule-route.ts`) — só aceita JSON não codificado até 4096 bytes; decide `413`/`415`/`400` antes de qualquer lógica de negócio rodar.
- **`parseMutation`** (mesmo arquivo) — é o portão de confirmação: exige a string exata de confirmação e nenhum campo extra no corpo. Sem essa checagem, a mutação nem chega à camada de aplicação.
- **`UpdateRegisteredServiceAvailabilityPolicy.execute`** (`src/service-management/application/update-registered-service-availability-policy.ts`) — a função de negócio real: valida o `policy` recebido via `createServiceAvailabilityPolicy` e persiste no `policyStore`. É aqui que erros de domínio (`ServiceAvailabilityPolicyValidationError`, `ServiceScheduleValidationError`, `ServiceScheduleTimezoneValidationError`, `RegisteredServiceAvailabilityIntervalValidationError` etc.) podem ser lançados.
- **`FixedAdministrativePowerOperationGate.tryAdmit`** (`src/http/administrative-power-operation-gate.ts`) — lock exclusivo booleano, sem fila nem timeout: se já há uma mutação em voo em qualquer rota que compartilha esse gate (`services`, `availability`, `schedule`, `machine schedule`, `backups`), a requisição é recusada imediatamente com `409`.
- **`mapError`** (na rota) — mapeia os erros de validação de domínio do serviço para `400 invalid_service_schedule_request`, mantendo a resposta HTTP genérica mesmo quando a causa raiz é bem específica (ex.: timezone inválida).

## Erros e casos de borda

- Corpo vazio → `400 invalid_service_schedule_request` (checagem explícita `if (!chunks.length)` em `readBody`).
- Corpo com campos extras além de `confirmation`/`policy`, ou faltando um dos dois → `400`.
- `confirmation` com valor certo mas de tipo errado (ex. número) ou string diferente → `400`.
- `policy` estruturalmente presente mas violando alguma regra de domínio (modo inválido, timezone inválida, intervalo inválido) → `400 invalid_service_schedule_request`, mas a mensagem HTTP não distingue qual regra falhou; o detalhe fica só no tipo da exceção capturada internamente.
- `Content-Encoding` de qualquer tipo (mesmo `identity`) presente no header → `415`, mesmo que o corpo não esteja de fato comprimido — a rota rejeita a mera presença do header.
- Duas mutações simultâneas na mesma família de gate → a segunda recebe `409 administrative_service_operation_busy` imediatamente, sem esperar a primeira terminar.
- `serviceId` inválido é checado **antes** da leitura do corpo, então um PUT com `serviceId` ruim nunca chega a consumir/parsear o corpo.

## Observações

- **Limite de corpo divergente do catálogo**: o catálogo declara `JSON_BODY.maxBodyBytes = 8_192` para rotas de mutação (usado em `createAdministrativeApiContract`, que publica esse número como parte do "contrato" da API). Mas o código real da rota usa uma constante local `MAX_BODY_BYTES = 4_096` para decidir quando devolver `413`. Ou seja, o número publicado no contrato da API (8192 bytes) não é o limite realmente aplicado (4096 bytes) — quem confia no contrato publicado pode levar um `413` inesperado em um corpo menor do que o documentado como permitido.
