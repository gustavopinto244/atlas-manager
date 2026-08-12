# GET /admin/event-history/integrity

## Resumo

Verifica a integridade da cadeia de eventos do histórico administrativo (hashes encadeados, segmentos selados, âncora de retenção) e devolve um resumo do resultado. Existe para permitir auditar, sob demanda, se o log de eventos não foi corrompido ou adulterado.

## Contrato

- **Método/Path**: `GET /admin/event-history/integrity`
- **Handler**: variante `"integrity"` dentro de `handler()`/`process()` em `src/http/administrative-event-history-operations-route.ts`, registrado via `registerAdministrativeEventHistoryOperationsRoutes`.
- **Catálogo** (`src/http/administrative-route-security-catalog.ts`): routeId `event_history.integrity.read`, operação `verify_event_history_integrity`, permissão `event_history.integrity.read`, activationFlag `ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED`, `confirmationPolicy: "none"`, `gatePolicy: "none"`, `replayPolicy: "read_only"`.
- **Middlewares**: envelope de segurança administrativo (Host/Origin/Sec-Fetch) em `create-app.ts`, mais o admission/rate-limit e cabeçalhos de segurança feitos no próprio handler compartilhado.
- **Autenticação/Autorização**: exige principal autenticado e permissão `event_history.integrity.read`. Roles com acesso: `auditor`, `audit_operator`, `administrator`.
- **Parâmetros de rota**: nenhum.
- **Query string**: não aceita nenhuma — qualquer `?` na URL gera 400 (`rejectAdministrativeQuery`).
- **Corpo da requisição**: não aceito (`validateAdministrativeRequestHasNoBody` — rejeita `Content-Length` != "0", `Transfer-Encoding` presente, ou qualquer `Content-Type`).
- **Formato da resposta** (200, `application/json`): objeto mapeado por `mapEventHistoryIntegrity` (`administrative-event-history-operations-response.ts`): `outcome` (`"verified" | "verified_with_retention" | "broken" | "interrupted" | "unavailable"`), campos opcionais (`earliestRetainedSequence`, `latestSequence`, `sealedSegmentCount`, `activeSegmentEventCount`, `retainedEventCount`, `retentionAnchorPresent`, `lastRecordSha256`, `lastSegmentSha256`) presentes só quando definidos, e `verifiedAt` (sempre presente).
- **Códigos de status possíveis**:
  - `200` — verificação executada (note: mesmo um resultado `"broken"` ou `"interrupted"` pode vir com 200, pois é a operação que "funcionou" ao detectar o problema — mas ver Observações).
  - `400 invalid_administrative_request` — query string presente ou corpo indevido.
  - `401`/`403`/`503` — falhas de autenticação/autorização/auditoria (mesmo catálogo de erros das demais rotas administrativas).
  - `405 method_not_allowed` — método diferente de GET.
  - `410 event_history_pruned`, `409 event_history_writer_busy`, `503 event_history_integrity_unavailable`/`event_history_integrity_broken`/`event_history_interrupted` — ver seção de erros.
  - `429 administrative_request_limited` — limite de requisições excedido.
  - `500 internal_error` — resposta > 1 MiB (praticamente impossível para este payload) ou erro não mapeado.

## Caminho da requisição

- `handler(dependencies, "integrity")` (`administrative-event-history-operations-route.ts`) é o `RequestHandler` genérico compartilhado por todas as sub-rotas de `/admin/event-history/*` deste arquivo — aplica cabeçalhos de segurança e admissão de taxa antes de despachar para `process`.
- `process(request, response, dependencies, "integrity")`: valida o tamanho da URL, e para o `kind === "integrity"` especificamente: exige método GET (`requireMethod`), rejeita query string (`rejectAdministrativeQuery`), exige ausência de corpo (`validateAdministrativeRequestHasNoBody`) — tudo encanamento.
- Constrói `protectedAdministration()` (fábrica que embrulha autenticação/autorização, injetada de fora) e chama `.verifyEventHistoryIntegrity.execute()`.
- **Lógica de negócio de verdade**: dentro de `createProtectedAdministration` (`src/access-control/composition/create-protected-administration.ts`), `verifyEventHistoryIntegrity.execute` roda `runner.run("verify_event_history_integrity", () => requireEventHistoryOperations().verifyIntegrity())` — autentica, autoriza, audita a decisão, e delega a verificação real para a implementação de infraestrutura do histórico segmentado (`FileSegmentedAdministrativeEventHistory` em `src/event-history/infrastructure/file-segmented-administrative-event-history.ts`), que recalcula hashes encadeados de registros e segmentos.
- Resultado é mapeado por `mapEventHistoryIntegrity` (encanamento de serialização — apenas inclui campos definidos) e enviado com `send()` (que também impõe o limite de 1 MiB).

## Funções-chave

- **`process` (ramo `kind === "integrity"`)** (`administrative-event-history-operations-route.ts`) — decide as regras de encanamento específicas desta sub-rota (GET, sem query, sem corpo) antes de acionar a operação protegida.
- **`ExecuteProtectedAdministrativeOperation.run`** (`create-protected-administration.ts`) — autentica, autoriza contra `event_history.integrity.read`, audita a decisão. Compartilhada com todas as rotas administrativas.
- **Implementação real de `verifyIntegrity()`** em `src/event-history/infrastructure/file-segmented-administrative-event-history.ts` — é quem de fato recalcula a cadeia de hashes e decide `outcome` (`verified`/`verified_with_retention`/`broken`/`interrupted`/`unavailable`). Não foi lido em detalhe (fora do escopo desta rota HTTP), mas é a peça que determina o resultado retornado.
- **`mapError`** (`administrative-event-history-operations-route.ts`) — traduz `SegmentedEventHistoryError` (e outros erros de domínio) em status HTTP específicos (409/410/503) conforme o `code` do erro.
- **`mapEventHistoryIntegrity`** (`administrative-event-history-operations-response.ts`) — monta a resposta pública, omitindo campos indefinidos (evita `null`/`undefined` explícitos no JSON).

## Erros e casos de borda

- Query string presente (mesmo vazia, ex. `?`) é rejeitada com 400, diferente da rota de leitura de eventos que aceita filtros — esta rota não tem parâmetros.
- Corpo com `Content-Type` definido, mesmo vazio, é rejeitado (400) — `validateAdministrativeRequestHasNoBody` também checa `contentType !== undefined`.
- Se `SegmentedEventHistoryError` for lançado com `code === "event_history_writer_busy"`, a resposta é `409 event_history_writer_busy` (outra escrita/gravação está em andamento no armazenamento subjacente).
- `code === "event_history_history_pruned"` vira `410 event_history_pruned` — o histórico foi podado além do que a verificação necessitava.
- `code === "event_history_corrupted"` vira `503 event_history_integrity_broken`; qualquer outro código de `SegmentedEventHistoryError` cai no fallback `503 event_history_integrity_unavailable`.
- Erros genéricos com `error.message === "event_history_history_pruned"` (fora de `SegmentedEventHistoryError`) também são tratados como 410 — sugere que mais de uma camada pode emitir esse sinal.
- Falha de autenticação/autorização/auditoria segue o padrão comum das rotas administrativas (401/403/503), tratado por `mapAdministrativeAccessControlError`.

## Observações

- O `outcome: "broken"` ou `"interrupted"` é devolvido dentro de um 200 quando a chamada à camada de infraestrutura não lança exceção — ou seja, "a cadeia está corrompida" e "não consegui verificar" podem, dependendo do caminho interno, aparecer como corpo 200 com `outcome` ruim OU como exceção `SegmentedEventHistoryError` (503/410). A distinção entre esses dois caminhos está na implementação de `verifyIntegrity()`, não neste arquivo de rota — vale conferir ao integrar um cliente, pois checar apenas o status HTTP não basta.
