# GET /admin/event-history/exports

## Resumo

Lista os metadados de todas as exportações do histórico de eventos já criadas (sem o conteúdo). Existe para o operador ver quais exportações existem, seus intervalos de sequência e hashes, antes de baixar uma específica.

## Contrato

- **Método/Path**: `GET /admin/event-history/exports`
- **Handler**: variante `"exports"`, ramo `request.method === "GET"` dentro de `process()` (`src/http/administrative-event-history-operations-route.ts`) — o mesmo path também atende `POST` (criação de export), despachado por `request.method` dentro do mesmo `kind`.
- **Catálogo**: routeId `event_history.exports.read`, operação `list_event_history_exports`, permissão `event_history.exports.read`, activationFlag `ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED`, `confirmationPolicy: "none"`, `gatePolicy: "none"`, `replayPolicy: "read_only"`.
- **Autenticação/Autorização**: exige permissão `event_history.exports.read`. Roles: `auditor`, `audit_operator`, `administrator`.
- **Parâmetros de rota**: nenhum. **Query string**: não aceita.
- **Corpo da requisição**: não aceito.
- **Formato da resposta** (200, `application/json`): `{ exports: [...] }`, onde cada item é mapeado por `mapEventHistoryExport` (`administrative-event-history-operations-response.ts`): `{ exportId, fromSequence, throughSequence, eventCount, byteCount, createdAt, contentSha256 }`.
- **Códigos de status possíveis**:
  - `200` — sucesso (lista pode ser vazia).
  - `400 invalid_administrative_request` — query ou corpo indevidos.
  - `401`/`403`/`503` — autenticação/autorização/auditoria.
  - `405 method_not_allowed` — método não suportado neste path (GET/POST são os únicos válidos).
  - `429 administrative_request_limited` — limite de requisições.
  - `500 internal_error` — resposta > 1 MiB (lista de exportações muito grande) ou erro não mapeado.

## Caminho da requisição

- `handler`/`process`, ramo `kind === "exports"`, sub-ramo `request.method === "GET"`: rejeita query, exige ausência de corpo, e chama `protectedAdministration().listEventHistoryExports.execute()` — não passa pelo `mutate`/gate, por ser leitura.
- **Lógica de negócio de verdade**: `listEventHistoryExports.execute()` (`create-protected-administration.ts`) roda `runner.run("list_event_history_exports", () => requireEventHistoryOperations().listExports())` — autentica, autoriza contra `event_history.exports.read`, audita a decisão, delega a listagem para a infraestrutura de histórico segmentado.
- O resultado (`readonly EventHistoryExportMetadata[]`) é mapeado item a item por `mapEventHistoryExport` e embrulhado em `{ exports: [...] }` — encanamento de serialização feito diretamente no `process()`, não numa função dedicada (diferente de outras rotas que delegam tudo a uma função `mapEventHistory*` de nível de resposta completa).
- `send()` serializa e aplica o limite de 1 MiB.

## Funções-chave

- **`process` (ramo `kind === "exports"`, sub-ramo GET)** — decide o encanamento de leitura (sem query, sem corpo) e faz o mapeamento inline da lista antes de enviar.
- **`listEventHistoryExports.execute`** (`create-protected-administration.ts`) — autentica/autoriza contra `event_history.exports.read` e delega a `listExports()`.
- **`listExports()`** (implementação em `file-segmented-administrative-event-history.ts`, não detalhada aqui) — enumera os metadados de todas as exportações persistidas.
- **`mapEventHistoryExport`** (`administrative-event-history-operations-response.ts`) — normaliza cada item de exportação para o formato público, incluindo o hash de conteúdo (`contentSha256`) que permite ao cliente verificar integridade após o download.

## Erros e casos de borda

- Lista vazia (`{ exports: [] }`) é uma resposta 200 válida — nenhuma exportação criada ainda não é tratado como erro.
- Se o número de exportações crescer muito, a resposta pode ultrapassar 1 MiB e virar `500 internal_error` — não há paginação nesta rota, ao contrário de `GET /admin/event-history` (que pagina por `afterSequence`/`limit`).
- Query string presente (mesmo `?` vazio) é 400, igual às demais sub-rotas.

## Observações

- Esta é a única sub-rota de leitura do arquivo que monta a resposta inline em `process()` em vez de delegar tudo para uma função `mapEventHistory*` dedicada que já produza a forma final `{ exports: [...] }`. Não é um problema funcional, mas quebra o padrão adotado pelas outras rotas (`mapEventHistoryIntegrity`, `mapEventHistoryRetention` retornam o objeto de resposta completo).
- Não há paginação nem filtro por intervalo de sequência nesta listagem — diferente do histórico de eventos bruto (`GET /admin/event-history`), que suporta `afterSequence`/`limit`. Se o volume de exportações crescer, o único limite de proteção é o teto de 1 MiB da resposta (que vira 500, não uma paginação graciosa).
