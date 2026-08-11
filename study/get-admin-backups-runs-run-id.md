# GET /admin/backups/runs/:runId

## Resumo

Lê o detalhe de uma execução de backup específica pelo `runId` (UUID). Existe para inspecionar uma run pontual sem paginar o histórico inteiro.

## Contrato

- **Método/Path**: `GET /admin/backups/runs/:runId`.
- **Arquivo de registro**: `src/http/administrative-backups-route.ts` (`handler(dependencies, "run")`), catalogado como `backups.run.read` (operação `read_backup_run`, permissão `backups.runs.read` — a mesma permissão da listagem de runs).
- **Middlewares em `/admin*`**: envelope de segurança.
- **Autenticação/Autorização**: Cloudflare Access + permissão `backups.runs.read`.
- **Parâmetros de rota**: `runId` — deve casar com o formato de UUID (versão 1–5, variante 8/9/a/b): `^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$` (`isRunId`, `administrative-backups-route.ts`).
- **Query string**: não aceita.
- **Corpo da requisição**: não aceito.
- **Formato da resposta** (200, `application/json`): objeto único `mapBackupRun(run)` — mesmo shape de cada item de `GET /admin/backups/runs`.
- **Códigos de status possíveis**:
  - `200` — sucesso.
  - `400 invalid_administrative_request` — query ou corpo presente.
  - `401` / `503 administrative_identity_unavailable`.
  - `403 administrative_authorization_denied`.
  - `404 backup_run_not_found` — `runId` não é UUID válido OU run inexistente (dois caminhos de código diferentes, ver Caminho da requisição).
  - `405 method_not_allowed`.
  - `414 uri_too_long`.
  - `429 administrative_request_limited`.
  - `500 internal_error`.
  - `503 backup_operation_unavailable` / `503 administrative_authorization_unavailable`.

## Caminho da requisição

- `handler(dependencies, "run")` — encanamento padrão de headers/admissão.
- `process()`: valida tamanho da URL; para `kind === "run"` **não** há validação prévia de `targetId` (essa checagem só se aplica a `target`/`manual`/`schedule`/`retention`/`prune`) — o `runId` é lido e validado **dentro** do bloco `if (kind === "run")`, depois de `requireMethod("GET")` e `rejeitAdministrativeQuery`: `const runId = paramString(request.params.runId); if (!isRunId(runId)) throw new HttpError(404, ...)`. Isso significa que, diferente da rota por `targetId`, aqui a checagem de formato roda **depois** de confirmar o método, mas ainda **antes** de qualquer autenticação.
- **Aqui está a lógica de negócio de verdade**: `protectedAdministration().getBackupRun.execute(runId)`. Em `create-protected-administration.ts`, a capacidade `getBackupRun` passa por `runner.run("read_backup_run", ...)` (autentica/autoriza/audita) e chama `requireBackups().getBackupRun(runId)` → `runs.getByRunId(id)` na store (`InMemoryBackupRunStore`). Se `null`, lança `new Error("backup_run_not_found")` — segundo caminho para o mesmo 404, mas após autenticar.
- `mapBackupRun` traduz o resultado; `send` serializa com teto de 256 KiB.

## Funções-chave

- **`isRunId`** (`administrative-backups-route.ts`) — valida sintaticamente que o `runId` é um UUID no formato esperado (inclusive checando o nibble de versão `1-5` e o de variante `8/9/a/b`), antes de qualquer tentativa de busca.
- **`ExecuteProtectedAdministrativeOperation.run`** (`create-protected-administration.ts`) — autentica/autoriza/audita `read_backup_run`.
- **`getByRunId`** (`InMemoryBackupRunStore`) — decide se a run (já sintaticamente válida) existe no armazenamento.
- **`mapBackupRun`** (`administrative-backup-response.ts`) — serializa a run única.

## Erros e casos de borda

- `runId` com formato de UUID incorreto (não-hex, comprimento errado, nibble de versão/variante fora do esperado) responde 404 antes de autenticar.
- `runId` sintaticamente válido mas nunca emitido pelo sistema responde 404 depois de autenticar/autorizar normalmente.
- Não há distinção entre "run nunca existiu" e "run existiu mas foi purgada" — o armazenamento de runs não tem uma política de expiração visível nesta rota (retenção afeta artefatos, não os registros de run em si — ver retenção).

## Observações

- Mesmo padrão de "validação de formato antes de autenticar" documentado em `get-admin-backups-targets-target-id.md` se aplica aqui para `runId`: um chamador sem credenciais pode diferenciar "UUID mal formado" (404 imediato) de "UUID bem formado" (tenta autenticar) só pela latência.
