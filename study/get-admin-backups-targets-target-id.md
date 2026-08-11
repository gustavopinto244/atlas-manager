# GET /admin/backups/targets/:targetId

## Resumo

Lê a configuração de um único alvo de backup pelo `id`. Existe para permitir que a UI (ou um operador via `curl`) veja o detalhe de um alvo específico sem baixar a lista inteira.

## Contrato

- **Método/Path**: `GET /admin/backups/targets/:targetId`.
- **Arquivo de registro**: `src/http/administrative-backups-route.ts` (`handler(dependencies, "target")`), catalogado como `backups.target.read` (operação `read_registered_backup_target`, permissão `backups.targets.read` — a mesma permissão da listagem, não uma permissão própria por alvo).
- **Middlewares em `/admin*`**: envelope de segurança (`createAdministrativeSecurityEnvelope`) antes do handler.
- **Autenticação/Autorização**: Cloudflare Access + permissão `backups.targets.read` — roles: `auditor`, `backup_operator`, `administrator`.
- **Parâmetros de rota**: `targetId` — deve casar com `^[a-z0-9]+(?:-[a-z0-9]+)*$` e ter no máximo 64 bytes (`isTargetId`, `administrative-backups-route.ts`).
- **Query string**: não aceita.
- **Corpo da requisição**: não aceito.
- **Formato da resposta** (200, `application/json`): objeto único no formato de `mapBackupTarget` (`id`, `displayName`, `kind`, `scheduleMode`, `retentionSummary`, `capabilities`) — mesmo shape de cada item de `GET /admin/backups/targets`.
- **Códigos de status possíveis**:
  - `200` — sucesso.
  - `400 invalid_administrative_request` — query ou corpo presente.
  - `401` / `503 administrative_identity_unavailable` — falhas de autenticação.
  - `403 administrative_authorization_denied` — sem permissão.
  - `404 registered_backup_target_not_found` — `targetId` mal formado OU alvo inexistente (ver Caminho da requisição e Observações — são dois caminhos de código diferentes para o mesmo status).
  - `405 method_not_allowed` — método diferente de GET.
  - `414 uri_too_long` — URL grande demais.
  - `429 administrative_request_limited`.
  - `500 internal_error` — resposta grande demais ou erro interno.
  - `503 backup_operation_unavailable` / `503 administrative_authorization_unavailable` — falhas não classificadas.

## Caminho da requisição

- `handler(dependencies, "target")` — mesmo encanamento de infraestrutura (headers, `admission.tryAdmit`) das demais rotas de backup.
- `process()`: valida tamanho da URL; extrai `targetId` de `request.params.targetId`; **antes de checar método, query, corpo ou autenticação**, valida o formato do `targetId` com `isTargetId()` — se inválido, lança `404 registered_backup_target_not_found` imediatamente. Isso é encanamento de validação de entrada, mas com uma consequência de segurança: ver Observações.
- Só então: exige `GET`, rejeita query, valida ausência de corpo.
- **Aqui está a lógica de negócio de verdade**: `protectedAdministration().getRegisteredBackupTarget.execute(targetId)`. Implementado em `createProtectedAdministration` (`src/access-control/composition/create-protected-administration.ts`, capacidade `getRegisteredBackupTarget`): passa por `runner.run("read_registered_backup_target", ...)` (autentica → autoriza → audita) e então chama `requireBackups().getRegisteredBackupTarget(targetId)`, que em `src/backup-management/composition/create-backup-management.ts` é `catalog.findById(id)`. Se `null`, lança `new Error("registered_backup_target_not_found")` — **este** é o segundo caminho para o mesmo código HTTP 404, mas passando por autenticação/autorização primeiro.
- `mapBackupTarget` converte o resultado para o formato público; `send` serializa com teto de 256 KiB.
- `mapError` traduz o `Error("registered_backup_target_not_found")` (via regex em `mapError`) para `HttpError(404, ...)`.

## Funções-chave

- **`isTargetId`** (`administrative-backups-route.ts`) — decide, só de olhar a sintaxe, se um `targetId` é candidato válido; barra qualquer coisa fora de `a-z0-9` e hífens simples, e limita a 64 bytes. É a única validação que acontece **antes** de qualquer autenticação nesta rota.
- **`ExecuteProtectedAdministrativeOperation.run`** (`create-protected-administration.ts`) — autentica, autoriza e audita a operação `read_registered_backup_target` antes de tocar no catálogo.
- **`getRegisteredBackupTarget`** (fechamento em `create-backup-management.ts`, delega a `catalog.findById`) — decide se o alvo (já sintaticamente válido) de fato existe.
- **`mapBackupTarget`** (`administrative-backup-response.ts`) — mesma função usada na listagem; serializa o alvo único.

## Erros e casos de borda

- `targetId` sintaticamente inválido (maiúsculas, underscore, mais de 64 bytes etc.) nunca chega a autenticar — responde 404 direto. Um `targetId` sintaticamente válido mas inexistente autentica e autoriza normalmente antes de responder 404.
- Método diferente de GET com um `targetId` inválido também vira 404 em vez de 405, porque a checagem de formato roda antes de `requireMethod`.
- Não há distinção de resposta entre "alvo nunca existiu" e "alvo foi removido" — o catálogo é só a lista atual, sem histórico.

## Observações

- A checagem de formato do `targetId` acontecendo antes da autenticação significa que um chamador sem credenciais válidas pode diferenciar "path com `targetId` mal formado" (404 imediato, sem round-trip de autenticação) de "path com `targetId` bem formado" (que ainda assim tentará autenticar e provavelmente devolverá 401/403) só observando a latência/ordem — um vazamento de informação de baixo risco, mas real, comum a `target`, `manual` (POST runs), `schedule` e `retention`/`prune` (todas usam a mesma checagem `isTargetId` antes do dispatch).
