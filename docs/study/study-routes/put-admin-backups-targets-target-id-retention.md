# PUT /admin/backups/targets/:targetId/retention

## Resumo

Atualiza a política de retenção de um alvo de backup (quantas runs bem-sucedidas manter, e opcionalmente por quantos dias). Existe para configurar o comportamento de limpeza automática que `POST .../retention/prunes` depois aplica.

## Contrato

- **Método/Path**: `PUT /admin/backups/targets/:targetId/retention` (mesmo path Express de GET, dispatch por método).
- **Arquivo de registro**: `src/http/administrative-backups-route.ts` (`handler(dependencies, "retention")`), catalogado como `backups.retention.update` (operação `update_backup_retention`, permissão `backups.retention.write`, `confirmationPolicy: exact:confirm_registered_backup_retention_update`, `gatePolicy: backup_operation`) — roles: `backup_operator`, `administrator`.
- **Middlewares em `/admin*`**: envelope de segurança.
- **Autenticação/Autorização**: Cloudflare Access + permissão `backups.retention.write`.
- **Parâmetros de rota**: `targetId` — validado por `isTargetId` antes do dispatch por método.
- **Query string**: não aceita.
- **Corpo da requisição** (JSON, mesmas regras de tamanho/tipo das mutações de backup): exatamente `{ "confirmation": "confirm_registered_backup_retention_update", "policy": <BackupRetentionPolicy candidato> }` (`exactPolicyBody`).
- **Formato da resposta** (200, `application/json`): a `BackupRetentionPolicy` já persistida.
- **Códigos de status possíveis**:
  - `200` — retenção atualizada.
  - `400 invalid_backup_request` — corpo mal formado, confirmação incorreta, `policy` ausente, ou `policy` inválido (`BackupTargetValidationError` de `createRetention`).
  - `401` / `503 administrative_identity_unavailable`.
  - `403 administrative_authorization_denied`.
  - `404 registered_backup_target_not_found` — `targetId` mal formado OU alvo inexistente.
  - `405 method_not_allowed`.
  - `409 backup_operation_busy`.
  - `413 payload_too_large`.
  - `414 uri_too_long`.
  - `415 unsupported_media_type`.
  - `429 administrative_request_limited`.
  - `500 internal_error`.
  - `503 backup_operation_unavailable` — inclui falha de persistência.
  - `503 administrative_authorization_unavailable` / `authorization_audit_unavailable`.

## Caminho da requisição

- `handler(dependencies, "retention")` — headers, admissão, validação de `targetId` pré-autenticação, rejeição de query.
- Como `request.method !== "GET"`: `requireMethod("PUT")`, leitura do corpo, `admitMutation` (gate HTTP, 409 se ocupado, antes de autenticar).
- `exactPolicyBody(body, "confirm_registered_backup_retention_update")` extrai `policy` cru, sem validar sua forma nesta camada.
- **Aqui está a lógica de negócio de verdade**: `protectedAdministration().setBackupRetention.execute(targetId, policy)`. Em `create-protected-administration.ts`, passa por `runBackupMutation("update_backup_retention", targetId, invoke)` (autentica/autoriza/audita início-fim). `invoke` chama `requireBackups().setBackupRetention(targetId, value)`.
- `setBackupRetention` (`create-backup-management.ts`): busca o alvo (`requireTarget`), **valida e constrói** a nova retenção com `createRetention(value)` (domínio) — exige `keepLastSuccessful` inteiro em `[1,100]`, `maxSuccessfulAgeDays` opcional inteiro em `[1,3650]`, e exatamente 1 ou 2 chaves no objeto (nenhuma chave extra). Se válida, atualiza o catálogo (`catalog.updateRetention`) e persiste (`policyStore.save`), com rollback do catálogo em memória se a persistência falhar.
- `send()` devolve a `BackupRetentionPolicy` resultante.

## Funções-chave

- **`exactPolicyBody`** (`administrative-backups-route.ts`) — garante a forma do envelope (`confirmation` + `policy`), sem validar o conteúdo de `policy`.
- **`createRetention`** (`src/backup-management/domain/backup-target.ts`) — a validação de negócio real: faixas numéricas e exclusividade de campos. É quem decide se `{ keepLastSuccessful: 0 }` ou `{ keepLastSuccessful: 5, maxSuccessfulAgeDays: 9999 }` são aceitáveis (não são).
- **`setBackupRetention`** (`create-backup-management.ts`) — orquestra atualização em memória + persistência com rollback, mesmo padrão de `setBackupSchedule`.
- **`runBackupMutation`** (`create-protected-administration.ts`) — autentica/autoriza/audita a mutação.

## Erros e casos de borda

- `keepLastSuccessful` fora de `[1,100]`, `maxSuccessfulAgeDays` fora de `[1,3650]`, ou objeto com chaves extras/faltando responde `400 invalid_backup_request` (via `BackupTargetValidationError`, reconhecido explicitamente por `mapError()`).
- Diminuir `keepLastSuccessful` **não** apaga runs/artefatos imediatamente — esta rota só grava a política; a limpeza de fato só acontece quando `POST .../retention/prunes` é chamado (manual, não automático).
- Se a persistência em disco falhar, o catálogo em memória é revertido antes do erro subir.

## Observações

- Assim como as demais mutações desta família, o limite de corpo real é 4096 bytes (constante local), não os 8192 declarados no catálogo (`JSON_BODY.maxBodyBytes`).
- Não existe uma rota `DELETE` para retenção (diferente de agenda, que tem `DELETE .../schedule`) — não há um "atalho" para uma retenção padrão; qualquer mudança precisa de um `PUT` com `policy` completo.
