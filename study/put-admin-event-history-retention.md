# PUT /admin/event-history/retention

## Resumo

Substitui a política de retenção do histórico de eventos (limites de segmentos selados, limites de exportações, se a poda automática está ligada). Existe para permitir ao operador ajustar por quanto tempo/quantidade o histórico é mantido antes de ser elegível para poda.

## Contrato

- **Método/Path**: `PUT /admin/event-history/retention`
- **Handler**: variante `"retention"`, ramo não-GET dentro de `process()` (`src/http/administrative-event-history-operations-route.ts`) — mesmo path/handler de `GET /admin/event-history/retention`, despachado por `request.method`.
- **Catálogo**: routeId `event_history.retention.update`, operação `update_event_history_retention`, permissão `event_history.retention.write`, activationFlag `ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED`, `confirmationPolicy: "exact:confirm_administrative_event_history_retention_update"`, `gatePolicy: "event_history_maintenance"`, `replayPolicy: "state_recheck_required"` (não `"conflict_protected"` como rotation/prune — ver Observações).
- **Autenticação/Autorização**: exige permissão `event_history.retention.write`. Roles: `audit_operator`, `administrator`.
- **Parâmetros de rota**: nenhum. **Query string**: não aceita.
- **Corpo da requisição**: JSON obrigatório (`Content-Type: application/json[; charset=utf-8]`, até 8 KiB, UTF-8, JSON estrito sem chaves duplicadas). Deve ser **exatamente** duas chaves: `confirmation` (igual a `"confirm_administrative_event_history_retention_update"`) e `policy` (o objeto de política candidata — validado mais a fundo pela camada de domínio, não pelo parser HTTP).
- **Formato da resposta** (200, `application/json`): a política de retenção resultante, mapeada por `mapEventHistoryPolicy` → `mapPolicy` (`administrative-event-history-operations-response.ts`): `{ automaticPruneEnabled, segments: {...}, exports: {...} }`.
- **Códigos de status possíveis**:
  - `200` — política atualizada, corpo é a política já persistida.
  - `400 invalid_event_history_request` — corpo sem exatamente `{confirmation, policy}`, confirmação errada, JSON malformado/duplicado, ou não-UTF-8. Também 400 se `policy` for semanticamente inválida (ver Erros).
  - `401`/`403`/`503` — autenticação/autorização/auditoria.
  - `405 method_not_allowed` — método não suportado (`Allow: PUT` — ver Observações no doc do GET).
  - `409 event_history_retention_busy` — outra mutação de manutenção do histórico em andamento (gate compartilhado).
  - `413 payload_too_large` — corpo > 8 KiB.
  - `415 unsupported_media_type` — `Content-Type`/`Content-Encoding` incorretos.
  - `429 administrative_request_limited` — limite de requisições.

## Caminho da requisição

- `handler`/`process` compartilhados (ver documento de GET para o encanamento comum de `kind === "retention"`): rejeita query, e como o método não é GET, cai em `requireMethod(request, "PUT")`.
- Lê o corpo com `bodyJson`, depois `exactPolicy(body, "confirm_administrative_event_history_retention_update")` — exige exatamente as chaves `confirmation` e `policy`, com a confirmação correta; devolve o valor bruto de `policy` (ainda não validado semanticamente neste ponto).
- Chama `mutate(dependencies, () => protectedAdministration().setEventHistoryRetention.execute(policy))` — o mesmo gate de exclusão mútua (`FixedAdministrativePowerOperationGate`) usado por rotation/segmentPrune/exports create/exportPrune: só uma mutação de histórico por vez em todo o processo.
- **Lógica de negócio de verdade**: `setEventHistoryRetention.execute(policy)` (`create-protected-administration.ts`) → `runEventHistoryMutation("update_administrative_event_history_retention", () => requireEventHistoryOperations().setRetentionPolicy(value))`. Autentica/autoriza, abre auditoria "iniciada", chama `setRetentionPolicy(policy)` na camada de infraestrutura — que é quem de fato valida a forma da política (provavelmente via `createRetentionPolicy`, `src/event-history/domain/event-history-record.ts`, que checa limites como `minSealedSegments <= maxSealedSegments`) e persiste, fecha a auditoria como sucesso/falha.
- `mapEventHistoryPolicy(result)` mapeia a política persistida de volta para JSON; `send()` limita a 1 MiB e responde 200.

## Funções-chave

- **`exactPolicy`** (`administrative-event-history-operations-route.ts`) — garante que o corpo tem exatamente `confirmation` e `policy`, nada mais, nada menos, e que a confirmação é a string exata esperada. Não valida o *conteúdo* de `policy` — só a forma do envelope.
- **`mutate`** — mesmo gate único de manutenção usado por todas as mutações de histórico; decide se esta atualização pode prosseguir ou deve falhar com 409 imediatamente.
- **`setRetentionPolicy(value)`** (implementação real na infraestrutura de histórico segmentado) — quem de fato valida `policy` semanticamente e a persiste; é onde erros de validação de domínio (ex. `event_history_retention_invalid`, ver `createRetentionPolicy` em `src/event-history/domain/event-history-record.ts`) originam.
- **`createRetentionPolicy`** (`src/event-history/domain/event-history-record.ts`) — a validação de domínio da política: exige `schemaVersion: 1`, chaves exatas em `segments`/`exports`, inteiros dentro de faixas (`minSealedSegments` 1–1000, `maxSealedSegments` 1–10000, etc.), e consistência (`maxSealedSegments >= minSealedSegments`, `maxExports >= minExports`).
- **`mapEventHistoryPolicy`/`mapPolicy`** (`administrative-event-history-operations-response.ts`) — serializa a política final para o formato público.

## Erros e casos de borda

- Corpo com apenas `confirmation` (sem `policy`), ou `policy` presente mas confirmação errada, ou chaves extras: todos 400 antes de qualquer tentativa de persistir.
- `policy` presente mas com forma inválida (ex. `schemaVersion` errado, campos faltando, `maxSealedSegments < minSealedSegments`) — a validação acontece dentro de `setRetentionPolicy`/`createRetentionPolicy`, não no parser HTTP; o erro resultante precisa ser tratado por `mapError` (não há mapeamento explícito para `event_history_retention_invalid` nesse arquivo, então provavelmente cai no fallback de erro genérico — ver Observações).
- Duas atualizações de política simultâneas: a segunda recebe 409 `event_history_retention_busy` de imediato.
- Atualizar a política não dispara automaticamente uma poda — apenas muda os critérios; a poda em si é acionada por `POST /admin/event-history/retention/prunes`.

## Observações

- O `mapError` em `administrative-event-history-operations-route.ts` trata explicitamente `SegmentedEventHistoryError` e duas mensagens de erro genéricas (`event_history_history_pruned`, `event_history_export_not_found`), mas não há tratamento visível para um erro de validação de política malformada (`event_history_retention_invalid`, lançado por `createRetentionPolicy`). Se esse erro não for uma instância de `HttpError`, `AdministrativeAccessControlError` ou `SegmentedEventHistoryError`, cai no fallback final de `mapError`: `503 event_history_integrity_unavailable`. Isso significa que uma política malformada enviada pelo cliente (erro do cliente, deveria ser 400) provavelmente responde como se fosse indisponibilidade do serviço (503) — vale conferir com um teste manual, pois pode ser uma inconsistência de mapeamento de erro.
- Ao contrário de `rotation` e `retention/prunes`, esta rota usa `replayPolicy: "state_recheck_required"` em vez de `"conflict_protected"` no catálogo — ou seja, do ponto de vista da política declarada, atualizar a política é tratado como uma escrita idempotente-ish que exige reverificação de estado, não como uma operação que precisa de proteção explícita contra conflito de replay. Na prática, a proteção contra execução concorrente vem inteiramente do `mutationGate` compartilhado, não de alguma lógica de `replayPolicy` visível neste arquivo.
