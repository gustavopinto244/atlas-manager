# GET /admin/event-history/exports/:exportId

## Resumo

Devolve os metadados de uma exportação específica do histórico de eventos, identificada pelo seu `exportId` (o hash SHA-256 do conteúdo). Existe para o operador consultar detalhes de uma exportação já criada sem baixar o arquivo inteiro.

## Contrato

- **Método/Path**: `GET /admin/event-history/exports/:exportId`
- **Handler**: variante `"export"` em `process()` (`src/http/administrative-event-history-operations-route.ts`) — este `kind` e o `kind === "download"` (`/admin/event-history/exports/:exportId/content`) compartilham o bloco final de `process()` que extrai e valida `exportId` antes de se ramificar por `kind`.
- **Catálogo**: routeId `event_history.export.read`, operação `read_event_history_export`, permissão `event_history.exports.read` (nota: mesma permissão usada por `list_event_history_exports` — ver `OPERATION_PERMISSIONS` em `src/access-control/domain/administrative-operation.ts`), activationFlag `ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED`, `confirmationPolicy: "none"`, `gatePolicy: "none"`, `replayPolicy: "read_only"`.
- **Autenticação/Autorização**: exige permissão `event_history.exports.read`. Roles: `auditor`, `audit_operator`, `administrator`.
- **Parâmetros de rota**: `exportId` — deve casar com `^[0-9a-f]{64}$` (hash hexadecimal SHA-256 minúsculo de 64 caracteres), senão `404` **antes** de checar o `kind` (ou seja, antes mesmo de saber se seria "export" ou "download"). **Query string**: não aceita.
- **Corpo da requisição**: não aceito.
- **Formato da resposta** (200, `application/json`): mapeado por `mapEventHistoryExport`: `{ exportId, fromSequence, throughSequence, eventCount, byteCount, createdAt, contentSha256 }`.
- **Códigos de status possíveis**:
  - `200` — sucesso.
  - `400 invalid_administrative_request` — query ou corpo indevidos.
  - `401`/`403`/`503` — autenticação/autorização/auditoria.
  - `404 event_history_export_not_found` — `exportId` não casa com o formato hex-64, **ou** casa mas não existe nenhuma exportação com esse id (esse segundo caso vem de dentro de `getEventHistoryExport.execute`, que lança `Error("event_history_export_not_found")` se `getExport` devolver `undefined`).
  - `405 method_not_allowed` — método diferente de GET.
  - `429 administrative_request_limited` — limite de requisições.

## Caminho da requisição

- `handler`/`process`: cabeçalhos de segurança, admissão de taxa, validação de tamanho de URL (comum a todas as sub-rotas).
- No fim de `process`, depois de descartar os `kind`s anteriores (`integrity`, `rotation`, `retention`, `segmentPrune`, `exportPrune`, `exports`), o código extrai `request.params.exportId` e valida o formato com regex `^[0-9a-f]{64}$` — se não casar, `404 event_history_export_not_found` **para qualquer `kind` restante** (tanto `"export"` quanto `"download"`). Essa validação de formato é encanamento, mas tem uma função de segurança: rejeita tentativas de path traversal ou ids malformados antes de tocar em qualquer arquivo.
- Se `kind === "export"`: exige GET, rejeita query, exige ausência de corpo, chama `protectedAdministration().getEventHistoryExport.execute(exportId)`.
- **Lógica de negócio de verdade**: `getEventHistoryExport.execute(exportId)` (`create-protected-administration.ts`) → `runner.run("read_event_history_export", async () => { const value = await requireEventHistoryOperations().getExport(exportId); if (value === undefined) throw new Error("event_history_export_not_found"); return value; })`. Autentica, autoriza contra `event_history.exports.read`, audita, delega a busca por id à infraestrutura, e converte "não encontrado" (`undefined`) numa exceção com mensagem padronizada.
- `mapEventHistoryExport` mapeia o resultado; `send()` limita a 1 MiB e responde 200.

## Funções-chave

- **Bloco de validação de `exportId`** (final de `process()`, `administrative-event-history-operations-route.ts`) — a barreira de forma compartilhada entre `export` e `download`: só aceita hashes hex de 64 caracteres, senão 404 imediato.
- **`getEventHistoryExport.execute`** (`create-protected-administration.ts`) — autentica/autoriza e traduz "exportação inexistente" de um valor `undefined` para uma exceção com mensagem reconhecível por `mapError`.
- **`getExport(exportId)`** (implementação em `file-segmented-administrative-event-history.ts`, não detalhada aqui) — busca de fato os metadados persistidos pelo id.
- **`mapError`** (`administrative-event-history-operations-route.ts`) — reconhece `error.message === "event_history_export_not_found"` (erro genérico, não `SegmentedEventHistoryError`) e mapeia para `404`.

## Erros e casos de borda

- `exportId` com letras maiúsculas (ex. um SHA-256 em hex maiúsculo) não casa com a regex `[0-9a-f]{64}` (só minúsculas) — resulta em 404, mesmo que a exportação exista com esse id em outra caixa. Cliente precisa sempre usar minúsculas.
- `exportId` mais curto/longo que 64 caracteres, ou com caracteres fora de `0-9a-f` (incluindo tentativas de path traversal como `../../etc/passwd`): 404 imediato, sem tocar no sistema de arquivos.
- `exportId` bem formado mas de uma exportação que nunca existiu ou já foi podada por `POST /admin/event-history/exports/retention/prunes`: também 404, via o caminho de `getExport` devolvendo `undefined`.
- Query string presente (mesmo vazia) é 400, igual às demais sub-rotas.

## Observações

- A dupla validação de "não encontrado" (formato via regex → 404 direto no roteador; id inexistente → 404 via exceção mapeada) faz o mesmo código de erro (`event_history_export_not_found`) surgir por dois caminhos completamente diferentes no código — um sem nunca autenticar/autorizar (rejeição de formato acontece antes da chamada protegida), outro depois de autenticar/autorizar com sucesso. Do ponto de vista do cliente a resposta é idêntica, mas vale saber que um `exportId` malformado nunca gera uma tentativa de autenticação real.
