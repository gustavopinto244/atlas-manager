# POST /admin/event-history/exports

## Resumo

Cria uma exportação (arquivo NDJSON assinado por hash) de um intervalo de sequências do histórico de eventos. Existe para permitir arquivar/baixar um recorte imutável e verificável do histórico, por exemplo antes de uma poda.

## Contrato

- **Método/Path**: `POST /admin/event-history/exports`
- **Handler**: variante `"exports"`, ramo não-GET dentro de `process()` (`src/http/administrative-event-history-operations-route.ts`) — mesmo path/handler de `GET /admin/event-history/exports`.
- **Catálogo**: routeId `event_history.exports.create`, operação `create_event_history_export`, permissão `event_history.exports.create`, activationFlag `ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED`, `confirmationPolicy: "exact:confirm_administrative_event_history_export"`, `gatePolicy: "event_history_maintenance"`, `replayPolicy: "state_recheck_required"` (não `"conflict_protected"`).
- **Autenticação/Autorização**: exige permissão `event_history.exports.create`. Roles: `auditor`, `audit_operator`, `administrator`.
- **Parâmetros de rota**: nenhum. **Query string**: não aceita.
- **Corpo da requisição**: JSON obrigatório, deve ter **exatamente três chaves**: `confirmation` (`"confirm_administrative_event_history_export"`), `fromSequence` e `throughSequence` (ambos `Number.isSafeInteger`). Validado por `exactExportBody`.
- **Formato da resposta** (200, `application/json`): metadados da exportação criada (ou já existente — ver Erros), mapeados por `mapEventHistoryExport`: `{ exportId, fromSequence, throughSequence, eventCount, byteCount, createdAt, contentSha256 }`.
- **Códigos de status possíveis**:
  - `200` — exportação criada (ou reaproveitada — ver Observações).
  - `400 invalid_event_history_request` — corpo sem as três chaves exatas, `fromSequence`/`throughSequence` não inteiros seguros, confirmação errada.
  - `401`/`403`/`503` — autenticação/autorização/auditoria.
  - `405 method_not_allowed` — método não suportado.
  - `409 event_history_retention_busy` — outra mutação de manutenção do histórico em andamento.
  - `409 event_history_writer_busy` / `410 event_history_pruned` / `503 event_history_capacity_exceeded (→503)` — erros de armazenamento, incluindo intervalo indisponível por poda prévia ou limite de tamanho/contagem de exportação excedido (`EVENT_HISTORY_MAX_EXPORT_EVENTS`/`EVENT_HISTORY_MAX_EXPORT_BYTES`, ver `event-history-record.ts`).
  - `413 payload_too_large` / `415 unsupported_media_type` — corpo grande demais ou tipo/codificação incorretos.
  - `429 administrative_request_limited` — limite de requisições.

## Caminho da requisição

- `handler`/`process`, ramo `kind === "exports"`, sub-ramo não-GET: exige POST, rejeita query, lê o corpo com `bodyJson`, valida com `exactExportBody(body)` — retorna `{ fromSequence, throughSequence }` congelado (`Object.freeze`).
- Chama `mutate(dependencies, () => protectedAdministration().createEventHistoryExport.execute(range))` — mesmo gate único de manutenção compartilhado com rotation/retention/prunes/exportPrune.
- **Lógica de negócio de verdade**: `createEventHistoryExport.execute(value)` (`create-protected-administration.ts`) → `runEventHistoryMutation("create_administrative_event_history_export", () => requireEventHistoryOperations().createExport(value), value)`. Note que aqui `details` da auditoria é o próprio `value` (o intervalo solicitado), diferente das outras mutações que passam `{}`. Autentica/autoriza, audita início/fim, e delega a `createExport({fromSequence, throughSequence})` na infraestrutura — que lê os eventos do intervalo, monta o NDJSON com cabeçalho/rodapé assinados por SHA-256 (ver `file-segmented-administrative-event-history.ts`, linhas ~601–630), calcula `exportId` como o SHA-256 do conteúdo completo, e persiste.
- `mapEventHistoryExport(result.metadata)` mapeia para o formato de resposta (note: `createExport` devolve `EventHistoryExportResult` com `{ outcome: "created" | "unchanged", metadata }`, mas o handler mapeia diretamente o retorno de `mutate` como se fosse os metadados — ver Observações, há uma inconsistência de tipos digna de nota).

## Funções-chave

- **`exactExportBody`** (`administrative-event-history-operations-route.ts`) — valida a forma do corpo: exatamente três chaves, confirmação exata, `fromSequence`/`throughSequence` inteiros seguros. Não valida que `throughSequence >= fromSequence` nem que o intervalo existe — isso fica para a camada de domínio/infraestrutura.
- **`mutate`** — gate único de manutenção; recusa a criação com 409 se outra mutação de histórico já estiver rodando.
- **`createExport(request)`** (implementação em `file-segmented-administrative-event-history.ts`) — a peça central: lê os registros do intervalo, monta o conteúdo NDJSON com hash encadeado (cabeçalho → linhas de evento → rodapé com `exportSha256`), calcula `exportId = sha256(content)`, e checa se já existe uma exportação com esse mesmo `exportId` (deduplicação por conteúdo).
- **`runEventHistoryMutation`** — envolve a criação em auditoria begin/complete, incluindo o intervalo solicitado nos detalhes do evento de auditoria.
- **`mapEventHistoryExport`** — serializa os metadados para o formato de resposta público.

## Erros e casos de borda

- `fromSequence`/`throughSequence` fora de ordem (`throughSequence < fromSequence`), sequências inexistentes, ou intervalo vazio: a validação HTTP (`exactExportBody`) só checa que são inteiros seguros — a rejeição semântica (se houver) vem da camada de domínio/infraestrutura, provavelmente propagada como `SegmentedEventHistoryError` e mapeada para 409/410/503 (não 400) por `mapError`. Um cliente pode achar estranho receber 503 em vez de 400 para um intervalo claramente inválido.
- Intervalo que ultrapassa `EVENT_HISTORY_MAX_EXPORT_EVENTS` (100.000) ou `EVENT_HISTORY_MAX_EXPORT_BYTES` (128 MiB) gera `SegmentedEventHistoryError("event_history_capacity_exceeded")`, mapeado para `503` pelo fallback de `mapError` (não há código específico de 4xx para "intervalo grande demais").
- Se parte do intervalo pedido já foi podado (fora da retenção), a criação provavelmente falha com algo relacionado a `event_history_history_pruned` (410).
- Duas criações de exportação simultâneas (ou concorrendo com rotation/retention/prune): a segunda recebe 409 `event_history_retention_busy`.

## Observações

- **Possível inconsistência de tipos**: `createEventHistoryExport.execute` (na composição de acesso) retorna uma `Promise<EventHistoryExportResult>`, que é `{ outcome: "created" | "unchanged", metadata: EventHistoryExportMetadata }` (ver `src/event-history/application/ports/administrative-event-history-operations.ts`). Mas em `administrative-event-history-operations-route.ts`, o handler faz `mapEventHistoryExport((await mutate(...)) as never)` e passa o resultado de `mutate` **diretamente** para `mapEventHistoryExport`, que espera um `EventHistoryExportMetadata` "achatado" (com `exportId`, `fromSequence` etc. no nível raiz) — não um objeto com `outcome`/`metadata` aninhados. Se o tipo de retorno realmente for `EventHistoryExportResult`, os campos mapeados (`value.exportId`, `value.fromSequence`, ...) estariam `undefined` na resposta, pois eles estariam dentro de `value.metadata`, não em `value` diretamente. Isso pode ser um bug de mapeamento, ou o `ProtectedAdministrativeEventHistoryOperations.createEventHistoryExport.execute` local (interface deste arquivo de rota, linha ~47-49) pode estar deliberadamente "achatando" o resultado numa camada intermediária não lida aqui — vale conferir com um teste de integração real desta rota.
- O outcome `"unchanged"` de `createExport` (quando o mesmo intervalo já foi exportado antes, deduplicado por `exportId`) também retorna 200 como se fosse uma criação nova — o cliente não tem como distinguir "acabei de criar" de "essa exportação já existia" só pelo status HTTP.
