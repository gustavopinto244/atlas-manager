# GET /admin/backups/targets/:targetId/retention

## Resumo

Lê a política de retenção atual de um alvo de backup (quantas runs bem-sucedidas manter e por quantos dias). Existe para a UI mostrar/editar a retenção sem precisar da resposta completa do alvo.

## Contrato

- **Método/Path**: `GET /admin/backups/targets/:targetId/retention`. Compartilha o path Express com `PUT` (dispatch por método dentro do handler).
- **Arquivo de registro**: `src/http/administrative-backups-route.ts` (`handler(dependencies, "retention")`), catalogado como `backups.retention.read` (operação `read_backup_retention`, permissão `backups.retention.read`) — roles: `backup_operator`, `administrator`.
- **Middlewares em `/admin*`**: envelope de segurança.
- **Autenticação/Autorização**: Cloudflare Access + permissão `backups.retention.read`.
- **Parâmetros de rota**: `targetId` — validado por `isTargetId` antes do dispatch por método.
- **Query string**: não aceita.
- **Corpo da requisição**: não aceito para GET.
- **Formato da resposta** (200, `application/json`): `BackupRetentionPolicy` bruto — `{ keepLastSuccessful: number, maxSuccessfulAgeDays: number|null }` (sem passar por função de mapeamento).
- **Códigos de status possíveis**:
  - `200` — sucesso.
  - `400 invalid_administrative_request` — query ou corpo presente.
  - `401` / `503 administrative_identity_unavailable`.
  - `403 administrative_authorization_denied`.
  - `404 registered_backup_target_not_found` — `targetId` mal formado OU alvo inexistente.
  - `405 method_not_allowed` — método fora de GET/PUT.
  - `414 uri_too_long`.
  - `429 administrative_request_limited`.
  - `500 internal_error`.
  - `503 backup_operation_unavailable` / `503 administrative_authorization_unavailable`.

## Caminho da requisição

- `handler(dependencies, "retention")` — headers, admissão.
- `process()`: valida URL; valida `targetId` (`isTargetId`) antes de tudo — 404 imediato se malformado, sem autenticar.
- Para `kind === "retention"`: rejeita query sempre; se `GET`, valida ausência de corpo e segue direto para leitura (sem gate de mutação).
- **Aqui está a lógica de negócio de verdade**: `protectedAdministration().getBackupRetention.execute(targetId)`. Em `create-protected-administration.ts`, passa por `runner.run("read_backup_retention", ...)` e delega a `requireBackups().getBackupRetention(targetId)` → `requireTarget(catalog, id).retention` (`create-backup-management.ts`) — lança `Error("registered_backup_target_not_found")` se o alvo não existir.
- `send()` serializa a política diretamente.

## Funções-chave

- **`isTargetId`** — barreira de formato pré-autenticação, compartilhada por toda a família `targets/:targetId/*`.
- **`ExecuteProtectedAdministrativeOperation.run`** — autentica/autoriza/audita `read_backup_retention`.
- **`requireTarget`** (`create-backup-management.ts`) — decide se o alvo existe antes de expor sua `retention`.

## Erros e casos de borda

- `targetId` mal formado responde 404 sem autenticar.
- `maxSuccessfulAgeDays: null` significa "sem limite de idade" — só `keepLastSuccessful` seria aplicado nesse caso (a interpretação de negócio disso está em `ApplyRegisteredBackupRetention.execute`, acionado por `POST .../retention/prunes`, não nesta rota de leitura).

## Observações

- Igual à rota de agenda, esta resposta expõe o tipo de domínio `BackupRetentionPolicy` sem uma função `map*` intermediária — qualquer campo novo adicionado ao domínio aparece automaticamente na API pública.
