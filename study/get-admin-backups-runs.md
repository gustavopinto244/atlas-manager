# GET /admin/backups/runs

## Resumo

Lista execuções de backup (histórico de runs), com paginação por sequência e filtros opcionais. Existe para auditoria/observabilidade operacional: "o que rodou, quando, com que resultado" — diferente de `/targets`, que é configuração.

## Contrato

- **Método/Path**: `GET /admin/backups/runs`.
- **Arquivo de registro**: `src/http/administrative-backups-route.ts` (`handler(dependencies, "runs")`), catalogado como `backups.runs.read` (operação `read_backup_runs`, permissão `backups.runs.read`) — roles: `auditor`, `backup_operator`, `administrator`.
- **Middlewares em `/admin*`**: envelope de segurança.
- **Autenticação/Autorização**: Cloudflare Access + permissão `backups.runs.read`.
- **Parâmetros de rota**: nenhum.
- **Query string** (única rota desta família que aceita query — `parseRunQuery`, `administrative-backups-route.ts`): chaves permitidas exatamente `afterSequence`, `limit`, `targetId`, `status`, `trigger`, `startedFrom`, `startedTo`; qualquer outra chave gera 400. `afterSequence`/`limit` devem casar com `^\d+$` (dígitos puros); demais campos são strings/enums repassados sem validação de formato pela rota HTTP — a validação de faixa (`limit` entre 1 e 100) acontece na camada de armazenamento.
- **Corpo da requisição**: não aceito.
- **Formato da resposta** (200, `application/json`): `{ runs: [ mapBackupRun(run), ... ] }` — cada run com `sequence`, `runId`, `targetId`, `trigger`, `scheduledFor`, `requestedAt`, `startedAt`, `completedAt`, `status`, e condicionalmente `fileCount`/`totalBytes`/`manifestSha256` (se houver artefato) ou `failureCode` (se houver falha).
- **Códigos de status possíveis**:
  - `200` — sucesso, mesmo lista vazia.
  - `400 invalid_administrative_request` — corpo presente; chave de query desconhecida; `afterSequence`/`limit` fora do formato `\d+`.
  - `400 invalid_backup_request` — a store rejeita a query com `Error("backup_query_invalid")` (por exemplo `limit` fora de `[1, 100]`) — ver Observações sobre onde esse erro é mapeado.
  - `401` / `503 administrative_identity_unavailable` — falhas de autenticação.
  - `403 administrative_authorization_denied`.
  - `405 method_not_allowed`.
  - `414 uri_too_long`.
  - `429 administrative_request_limited`.
  - `500 internal_error` — resposta acima de 256 KiB.
  - `503 backup_operation_unavailable` / `503 administrative_authorization_unavailable`.

## Caminho da requisição

- `handler(dependencies, "runs")` — encanamento de infraestrutura comum (headers, admissão).
- `process()`: valida tamanho da URL; exige `GET`; **chama `parseRunQuery(request.url)`** (em vez de `rejectAdministrativeQuery`, diferente de quase todas as outras rotas de backup) para transformar a query string crua num objeto `BackupRunQuery` tipado; valida ausência de corpo.
- **Aqui está a lógica de negócio de verdade**: `protectedAdministration().getBackupRuns.execute(query)`. Em `create-protected-administration.ts`, a capacidade `getBackupRuns` passa por `runner.run("read_backup_runs", ...)` (autenticação/autorização/auditoria) e delega a `requireBackups().getBackupRuns(query)`, que em `create-backup-management.ts` é `runs.query(query)` sobre o `BackupRunStore` (implementação padrão `InMemoryBackupRunStore`, `src/backup-management/infrastructure/in-memory-backup-run-store.ts`).
- A store faz o trabalho real: aplica `limit` (default 50, deve ser inteiro em `[1,100]`), filtra por `afterSequence` (paginação por cursor — só runs com `sequence > afterSequence`), reclassifica runs ainda `"started"` como `"interrupted"` na visão pública se necessário, aplica os demais filtros (`targetId`, `status`, `trigger`, `startedFrom`/`startedTo` como limites lexicográficos sobre timestamps ISO), ordena por `sequence` crescente e corta no `limit` **depois** de filtrar.
- `mapBackupRun` (`administrative-backup-response.ts`) traduz cada `BackupRun` de domínio para o formato público, omitindo `fileCount`/`totalBytes`/`manifestSha256` quando não há artefato e omitindo `failureCode` quando não há falha.
- `send` serializa com teto de 256 KiB.

## Funções-chave

- **`parseRunQuery`** (`administrative-backups-route.ts`) — decide o que é uma query de runs "bem formada o suficiente para tentar": lista fechada de chaves, `afterSequence`/`limit` só dígitos; tudo o mais (validade semântica de `status`/`trigger`/datas) é responsabilidade da camada abaixo.
- **`InMemoryBackupRunStore.query`** (`src/backup-management/infrastructure/in-memory-backup-run-store.ts`) — é aqui que a paginação por cursor, os filtros e o `limit` (com faixa `[1,100]`) realmente acontecem; decide também como runs "presos" em `started` aparecem para quem consulta.
- **`ExecuteProtectedAdministrativeOperation.run`** (`create-protected-administration.ts`) — autentica/autoriza/audita `read_backup_runs` antes de consultar a store.
- **`mapBackupRun`** (`administrative-backup-response.ts`) — decide quais campos condicionais aparecem por run (artefato vs. falha), evitando expor `null`s inúteis na resposta pública.

## Erros e casos de borda

- Lista vazia é uma resposta 200 válida.
- `limit` fora de `[1,100]` (por exemplo `limit=0` ou `limit=101`) passa pela validação sintática da rota HTTP (`\d+`) mas é rejeitado pela store com `Error("backup_query_invalid")` — **este erro não tem tratamento explícito em `mapError` de `administrative-backups-route.ts`**, então cai no fallback `503 backup_operation_unavailable` em vez de um 400 mais preciso (ver Observações).
- `afterSequence` muito grande apenas resulta em página vazia (`runs: []`), não é erro.
- `startedFrom`/`startedTo` são comparados como strings, não parseados como datas — um valor que não seja um timestamp ISO válido não gera erro, só produz filtragem sem sentido (comparação lexicográfica de uma string arbitrária).
- Runs que ficaram em `"started"` (processo interrompido no meio de um backup) aparecem remapeados como `"interrupted"` na leitura, sem que isso seja visível como uma transição de estado explícita — é uma projeção de leitura, não uma escrita no armazenamento.

## Observações

- `Error("backup_query_invalid")`, lançado pela store quando `limit` está fora de `[1, 100]`, não está entre os casos tratados por `mapError()` (`administrative-backups-route.ts`, regex `/^(registered_backup_target_not_found|backup_run_not_found)$/` e o check de `backup_operation_busy`) — cai no fallback genérico `503 backup_operation_unavailable`. Um `limit=999` no querystring, portanto, responde como se o subsistema de backups estivesse indisponível, e não como um erro de entrada do chamador (que seria mais correto como 400).
- Esta é a única rota da família `/admin/backups/*` que aceita query string — todas as outras chamam `rejectAdministrativeQuery` e recusam qualquer `?` na URL.
