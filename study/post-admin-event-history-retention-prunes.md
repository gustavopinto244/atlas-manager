# POST /admin/event-history/retention/prunes

## Resumo

Executa a poda (remoção) de segmentos selados do histórico de eventos que estão fora da política de retenção configurada. Existe para liberar espaço/limitar o crescimento do histórico de forma controlada e auditável, respeitando os limites definidos em `PUT /admin/event-history/retention`.

## Contrato

- **Método/Path**: `POST /admin/event-history/retention/prunes`
- **Handler**: variante `"segmentPrune"` em `process()` (`src/http/administrative-event-history-operations-route.ts`).
- **Catálogo**: routeId `event_history.retention.prune`, operação `prune_event_history`, permissão `event_history.retention.prune`, activationFlag `ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED`, `confirmationPolicy: "exact:confirm_administrative_event_history_retention_prune"`, `gatePolicy: "event_history_maintenance"`, `replayPolicy: "conflict_protected"`.
- **Autenticação/Autorização**: exige permissão `event_history.retention.prune`. Roles: `audit_operator`, `administrator`.
- **Parâmetros de rota**: nenhum. **Query string**: não aceita.
- **Corpo da requisição**: JSON obrigatório, corpo deve ser **exatamente** `{ "confirmation": "confirm_administrative_event_history_retention_prune" }`.
- **Formato da resposta** (200, `application/json`): retorno bruto de `pruneEventHistory.execute()` (`EventHistoryRetentionResult`): `{ outcome: "unchanged" | "pruned" | "recovery_required" | "blocked", removedSegmentCount: number, removedEventCount: number }` — enviado sem função de mapeamento dedicada (mesmo padrão de `rotation`).
- **Códigos de status possíveis**:
  - `200` — poda executada (qualquer `outcome`, incluindo `"blocked"` e `"unchanged"`, vem com 200).
  - `400 invalid_event_history_request` — corpo sem a confirmação exata ou malformado.
  - `401`/`403`/`503` — autenticação/autorização/auditoria.
  - `405 method_not_allowed` — método diferente de POST.
  - `409 event_history_retention_busy` — outra mutação de manutenção em andamento.
  - `409 event_history_writer_busy` / `410 event_history_pruned` / `503 ...` — erros de armazenamento (`SegmentedEventHistoryError`).
  - `413 payload_too_large` / `415 unsupported_media_type` — corpo grande demais ou tipo/codificação incorretos.
  - `429 administrative_request_limited` — limite de requisições.

## Caminho da requisição

- `handler`/`process`, ramo `kind === "segmentPrune"`: exige POST, rejeita query, lê corpo com `bodyJson`, valida confirmação exata com `exactConfirmation(..., "confirm_administrative_event_history_retention_prune")`.
- Chama `mutate(dependencies, () => protectedAdministration().pruneEventHistory.execute())` — mesmo gate único de manutenção (`FixedAdministrativePowerOperationGate`) compartilhado com rotation/retention update/exports create/exportPrune. É essa a "proteção contra conflito/concorrência" mencionada no catálogo (`replayPolicy: "conflict_protected"`, `gatePolicy: "event_history_maintenance"`): não existe lógica de detecção de conflito baseada em estado (ex. versão/etag) neste caminho HTTP — a proteção é puramente "só uma operação de manutenção por vez, recusa a segunda com 409".
- **Lógica de negócio de verdade**: `pruneEventHistory.execute()` (`create-protected-administration.ts`) → `runEventHistoryMutation("prune_administrative_event_history", () => requireEventHistoryOperations().pruneSegments())`. Autentica/autoriza contra `event_history.retention.prune`, audita início/fim, e delega a `pruneSegments()` na infraestrutura segmentada — que decide quais segmentos selados estão fora da política de retenção atual (idade máxima, contagem máxima) e os remove, gravando uma âncora de retenção (`EventHistoryRetentionAnchor`, ver `event-history-record.ts`) para preservar a cadeia de hashes mesmo após a remoção.
- Resposta enviada crua por `send()` (limite de 1 MiB).

## Funções-chave

- **`mutate`** (`administrative-event-history-operations-route.ts`) — a única camada de proteção contra execução concorrente desta rota: gate compartilhado entre todas as mutações de histórico.
- **`exactConfirmation`** — exige confirmação exata, sem campos extras, prevenindo poda disparada por engano.
- **`pruneSegments()`** (implementação em `file-segmented-administrative-event-history.ts`, não detalhada aqui) — decide quais segmentos são elegíveis para remoção conforme a política de retenção atual e executa a remoção física, mantendo a cadeia de hashes íntegra via âncora de retenção.
- **`runEventHistoryMutation`** (`create-protected-administration.ts`) — garante o par begin/complete de auditoria em torno da poda, mesmo em caso de falha.
- **`mapError`** — traduz `SegmentedEventHistoryError` em 409 (`event_history_writer_busy`)/410 (`event_history_pruned`)/503 conforme o código retornado pela infraestrutura.

## Erros e casos de borda

- `outcome: "blocked"` retorna 200 com `removedSegmentCount`/`removedEventCount` provavelmente zerados — a poda não é um erro HTTP quando a política impede a remoção (ex. `minSealedSegments` não permitiria remover mais nada); o cliente precisa inspecionar o corpo.
- `outcome: "recovery_required"` também é 200 — indica estado inconsistente que precisa de intervenção manual, mas a rota não força um erro HTTP nesse caso.
- Duas podas simultâneas (ou uma poda concorrente com uma rotação/atualização de retenção/export): a segunda chamada recebe 409 `event_history_retention_busy` imediatamente, independente da ordem de chegada.
- Corpo com confirmação certa mas chaves extras (ex. `{"confirmation": "...", "dryRun": true}`) é rejeitado com 400 — não há suporte a modo "simulação" nesta rota.

## Observações

- Assim como em `rotation`, a resposta desta rota não passa por nenhuma função `mapEventHistory*` dedicada — o objeto de domínio (`EventHistoryRetentionResult`) é serializado diretamente. Qualquer campo futuro adicionado a esse tipo vaza automaticamente para o cliente HTTP.
- O nome da rota (`retention/prunes`) e o nome interno da operação (`prune_event_history`, variante `"segmentPrune"`) tratam apenas de **segmentos**; a poda de **exportações** é uma rota e operação totalmente separada (`POST /admin/event-history/exports/retention/prunes`, `prune_event_history_exports`) — os dois `gatePolicy: "event_history_maintenance"` compartilham o mesmo gate de exclusão mútua no processo, então uma poda de segmentos e uma poda de exportações não podem rodar ao mesmo tempo, mesmo sendo operações logicamente independentes.
