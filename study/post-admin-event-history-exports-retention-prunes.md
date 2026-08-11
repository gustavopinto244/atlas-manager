# POST /admin/event-history/exports/retention/prunes

## Resumo

Executa a poda (remoção) de exportações do histórico de eventos que estão fora da política de retenção de exports configurada. Existe para limitar o número/idade de arquivos de exportação acumulados, análogo à poda de segmentos, mas para exportações.

## Contrato

- **Método/Path**: `POST /admin/event-history/exports/retention/prunes`
- **Handler**: variante `"exportPrune"` em `process()` (`src/http/administrative-event-history-operations-route.ts`). Nota: este `kind` é resolvido **antes** do bloco `if (kind === "exports")` no código-fonte, então não conflita com o roteamento de `/admin/event-history/exports` (path literal diferente, `express` já roteia para o handler correto por causa do `pathTemplate` distinto no catálogo).
- **Catálogo**: routeId `event_history.exports.prune`, operação `prune_event_history_exports`, permissão `event_history.exports.prune`, activationFlag `ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED`, `confirmationPolicy: "exact:confirm_administrative_event_history_export_prune"`, `gatePolicy: "event_history_maintenance"`, `replayPolicy: "conflict_protected"`.
- **Autenticação/Autorização**: exige permissão `event_history.exports.prune`. Roles: `audit_operator`, `administrator` (não `auditor`).
- **Parâmetros de rota**: nenhum. **Query string**: não aceita.
- **Corpo da requisição**: JSON obrigatório, deve ser **exatamente** `{ "confirmation": "confirm_administrative_event_history_export_prune" }`.
- **Formato da resposta** (200, `application/json`): retorno bruto de `pruneEventHistoryExports.execute()`: `{ outcome: "unchanged" | "pruned" | "blocked", removedExportCount: number }` — sem função de mapeamento dedicada (mesmo padrão de `rotation`/`segmentPrune`).
- **Códigos de status possíveis**:
  - `200` — poda executada (qualquer `outcome`, incluindo `"blocked"`, vem com 200).
  - `400 invalid_event_history_request` — corpo sem a confirmação exata ou malformado.
  - `401`/`403`/`503` — autenticação/autorização/auditoria.
  - `405 method_not_allowed` — método diferente de POST.
  - `409 event_history_retention_busy` — outra mutação de manutenção do histórico em andamento (mesmo gate compartilhado com rotation/retention/segmentPrune/exports create).
  - `413 payload_too_large` / `415 unsupported_media_type` — corpo grande demais ou tipo/codificação incorretos.
  - `429 administrative_request_limited` — limite de requisições.

## Caminho da requisição

- `handler`/`process`, ramo `kind === "exportPrune"`: exige POST, rejeita query, lê e valida o corpo com `exactConfirmation(await bodyJson(request), "confirm_administrative_event_history_export_prune")`.
- Chama `mutate(dependencies, () => protectedAdministration().pruneEventHistoryExports.execute())` — mesmo gate único (`FixedAdministrativePowerOperationGate`) que serializa **todas** as mutações de `/admin/event-history/*` (rotation, retention update, segmentPrune, exports create, exportPrune) num único fluxo por vez em todo o processo.
- **Lógica de negócio de verdade**: `pruneEventHistoryExports.execute()` (`create-protected-administration.ts`) → `runEventHistoryMutation("prune_administrative_event_history_exports", () => requireEventHistoryOperations().pruneExports())`. Autentica/autoriza contra `event_history.exports.prune`, audita início/fim, delega a `pruneExports()` na infraestrutura — que decide quais arquivos de exportação estão fora da política atual (`exports.minExports`, `exports.maxExports`, `exports.maxExportAgeDays`, ver `EventHistoryRetentionPolicy` em `event-history-record.ts`) e os remove fisicamente.
- Resposta enviada crua por `send()` (limite de 1 MiB).

## Funções-chave

- **`mutate`** — a exclusão mútua entre esta poda e qualquer outra mutação de manutenção do histórico (inclusive a poda de segmentos, apesar de logicamente independente).
- **`exactConfirmation`** — exige confirmação exata sem campos extras.
- **`pruneExports()`** (implementação em `file-segmented-administrative-event-history.ts`, não detalhada aqui) — decide quais exportações são elegíveis para remoção conforme `policy.exports` e as remove.
- **`runEventHistoryMutation`** — garante auditoria begin/complete em torno da poda de exportações.
- **`mapError`** — mesma tradução de `SegmentedEventHistoryError` usada pelas demais mutações (embora exportações removidas não tenham a mesma noção de "sequência podada" que segmentos — os códigos de erro relevantes aqui provavelmente giram em torno de `event_history_writer_busy`/genéricos, não `event_history_history_pruned`).

## Erros e casos de borda

- `outcome: "blocked"` retorna 200 com `removedExportCount` provavelmente zero — a política impede remover mais exportações (ex. `minExports` já no limite); não é um erro HTTP.
- Duas podas de exportação simultâneas, ou uma poda de exportação concorrendo com rotation/retention update/segmentPrune/exports create: a segunda chamada recebe 409 `event_history_retention_busy` de imediato — mesmo sendo operações sobre recursos logicamente distintos (segmentos vs. exportações), o gate é único para todo o histórico.
- Corpo com confirmação certa mas chaves extras é 400, igual às demais mutações de confirmação simples.

## Observações

- Esta rota e `POST /admin/event-history/retention/prunes` (poda de segmentos) têm nomes de path muito parecidos (`.../retention/prunes` vs `.../exports/retention/prunes`) e o mesmo `gatePolicy` (`event_history_maintenance`), mas atuam sobre recursos completamente diferentes (segmentos selados vs. arquivos de exportação) e usam políticas de retenção diferentes (`policy.segments` vs `policy.exports`, ambas dentro do mesmo objeto `EventHistoryRetentionPolicy`). Fácil de confundir os dois endpoints ao integrar um cliente — vale conferir sempre o path completo.
- Assim como `rotation` e `segmentPrune`, a resposta não passa por uma função `mapEventHistory*` dedicada — o objeto de domínio é serializado diretamente.
