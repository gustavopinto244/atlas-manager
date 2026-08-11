# GET /admin/event-history/retention

## Resumo

Devolve o resumo atual da política de retenção do histórico de eventos: a política configurada mais estatísticas (sequências retidas, segmentos selados, exportações elegíveis para poda). Existe para o operador conferir o estado de retenção antes de decidir alterar a política ou rodar uma poda.

## Contrato

- **Método/Path**: `GET /admin/event-history/retention`
- **Handler**: variante `"retention"`, ramo `request.method === "GET"` dentro de `process()` (`src/http/administrative-event-history-operations-route.ts`).
- **Catálogo**: routeId `event_history.retention.read`, operação `read_event_history_retention`, permissão `event_history.retention.read`, activationFlag `ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED`, `confirmationPolicy: "none"`, `gatePolicy: "none"`, `replayPolicy: "read_only"`. Nota: o mesmo path `/admin/event-history/retention` também está catalogado para PUT (`event_history.retention.update`) — os dois routeIds compartilham o mesmo handler Express (`app.all`), que despacha por `request.method`.
- **Autenticação/Autorização**: exige permissão `event_history.retention.read`. Roles: `audit_operator`, `administrator` (não `auditor`).
- **Parâmetros de rota**: nenhum. **Query string**: não aceita (`rejectAdministrativeQuery`).
- **Corpo da requisição**: não aceito (`validateAdministrativeRequestHasNoBody`).
- **Formato da resposta** (200, `application/json`): objeto de `mapEventHistoryRetention` (`administrative-event-history-operations-response.ts`): `policy` (objeto `{ automaticPruneEnabled, segments: {...}, exports: {...} }`), `earliestRetainedSequence`, `latestSequence`, `sealedSegmentCount`, `retainedEventCount`, `eligibleSegmentCount`, `exportCount`, `eligibleExportCount`, `automaticPruneEnabled`.
- **Códigos de status possíveis**:
  - `200` — sucesso.
  - `400 invalid_administrative_request` — query ou corpo indevidos.
  - `401`/`403`/`503` — autenticação/autorização/auditoria.
  - `405 method_not_allowed` — método diferente de GET/PUT no path (mas o `Allow` listado depende de qual ramo do código rejeitou — ver Observações).
  - `429 administrative_request_limited` — limite de requisições.
  - `500 internal_error` — erro não mapeado ou resposta > 1 MiB.
  - `503`/`409`/`410` — erros de `SegmentedEventHistoryError` propagados por `mapError`, se a leitura falhar na camada de armazenamento.

## Caminho da requisição

- `handler(dependencies, "retention")` — cabeçalhos de segurança e admissão de taxa (comum a todas as sub-rotas).
- `process`, ramo `kind === "retention"`: primeiro rejeita query string (`rejectAdministrativeQuery`), **antes mesmo de saber se é GET ou PUT** — ou seja, uma requisição GET com `?` é 400, mesmo que a query fosse ignorada de qualquer forma.
- Se `request.method === "GET"`: exige ausência de corpo (`validateAdministrativeRequestHasNoBody`) e chama `protectedAdministration().getEventHistoryRetention.execute()` diretamente — não passa pelo gate de mutação (`mutate`), pois é leitura.
- **Lógica de negócio de verdade**: `getEventHistoryRetention.execute()` (`create-protected-administration.ts`) roda `runner.run("read_event_history_retention", () => requireEventHistoryOperations().getRetentionSummary())` — autentica, autoriza, audita a decisão, e delega a leitura do resumo de retenção à camada de infraestrutura do histórico segmentado.
- `mapEventHistoryRetention` traduz o `EventHistoryRetentionSummary` de domínio para o formato JSON público (encanamento, mas espelha a estrutura de domínio quase 1:1).
- `send()` serializa e limita a 1 MiB.

## Funções-chave

- **`process` (ramo `kind === "retention"`, sub-ramo GET)** — decide o encanamento específico de leitura: sem query, sem corpo, delega direto sem passar pelo gate de mutação.
- **`getEventHistoryRetention.execute`** (`create-protected-administration.ts`) — autentica/autoriza contra `event_history.retention.read` e delega para `getRetentionSummary()` na infraestrutura.
- **`getRetentionSummary()`** (implementação em `file-segmented-administrative-event-history.ts`, fora do escopo detalhado aqui) — calcula as estatísticas atuais (sequências, segmentos, exportações elegíveis) combinando o estado do armazenamento com a política de retenção configurada.
- **`mapEventHistoryRetention`** (`administrative-event-history-operations-response.ts`) — normaliza a saída para o formato de resposta público, incluindo o sub-mapeamento de `policy` via `mapPolicy`.
- **`rejectAdministrativeQuery`** (`administrative-http.ts`) — barreira comum de "esta rota não aceita query string alguma", aplicada antes até de saber o método.

## Erros e casos de borda

- Requisição `GET /admin/event-history/retention?foo=1` é 400, mesmo que `foo` fosse um parâmetro inofensivo/ignorado — a rota é estritamente "sem query" para ambos os métodos.
- Um corpo presente numa requisição GET (ex. `Content-Type` setado mesmo sem payload) é rejeitado com 400, igual às demais rotas de leitura deste arquivo.
- Se a política de retenção nunca foi definida, presume-se que a camada de infraestrutura devolve algum default (`DEFAULT_EVENT_HISTORY_RETENTION_POLICY`, ver `src/event-history/domain/event-history-record.ts`) — este arquivo de rota não trata esse caso especificamente, é responsabilidade da implementação de `getRetentionSummary()`.
- Erros de leitura na camada de armazenamento (ex. corrupção, lock stale) propagam como `SegmentedEventHistoryError` e são mapeados para 409/410/503 por `mapError`, igual às demais operações.

## Observações

- O `requireMethod` para este `kind` só é chamado no ramo não-GET (`requireMethod(request, "PUT")`, ver `put-admin-event-history-retention.md`). Para métodos diferentes de GET e PUT (ex. DELETE), o código cai direto no `requireMethod(request, "PUT")` do ramo seguinte, então o cabeçalho `Allow` de uma tentativa `DELETE` reportará apenas `"PUT"`, não `"GET, PUT"` — um cliente que confie estritamente no header `Allow` para descobrir os métodos suportados pode ser enganado a achar que só PUT é aceito.
