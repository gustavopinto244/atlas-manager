# PUT /admin/backups/targets/:targetId/schedule

## Resumo

Atualiza a política de agendamento de um alvo de backup (muda para `manual`, `disabled`, ou `scheduled` com fuso e janelas semanais). Existe para permitir configurar quando um alvo roda automaticamente, com confirmação explícita e persistência em disco.

## Contrato

- **Método/Path**: `PUT /admin/backups/targets/:targetId/schedule` (mesmo path Express de GET/DELETE, dispatch por método dentro do handler).
- **Arquivo de registro**: `src/http/administrative-backups-route.ts` (`handler(dependencies, "schedule")`), catalogado como `backups.schedule.update` (operação `update_backup_schedule`, permissão `backups.schedule.write`, `confirmationPolicy: exact:confirm_registered_backup_schedule_update`, `gatePolicy: backup_operation`) — roles: `backup_operator`, `administrator`.
- **Middlewares em `/admin*`**: envelope de segurança.
- **Autenticação/Autorização**: Cloudflare Access + permissão `backups.schedule.write`.
- **Parâmetros de rota**: `targetId` — validado por `isTargetId` antes do dispatch por método.
- **Query string**: não aceita.
- **Corpo da requisição** (JSON, mesmas regras de `Content-Type`/tamanho/encoding de todas as mutações de backup — ver Observações sobre o limite real de 4096 bytes): exatamente 2 campos — `{ "confirmation": "confirm_registered_backup_schedule_update", "policy": <BackupSchedule candidato> }` (`exactPolicyBody`). O `policy` é validado pelo domínio, não pela rota HTTP — ver Caminho da requisição.
- **Formato da resposta** (200, `application/json`): o `BackupSchedule` já persistido, no mesmo formato bruto de `GET .../schedule`.
- **Códigos de status possíveis**:
  - `200` — agenda atualizada com sucesso.
  - `400 invalid_backup_request` — corpo mal formado, confirmação incorreta, chave `policy` ausente, ou `policy` inválido segundo `createBackupSchedule` (`BackupTargetValidationError`).
  - `401` / `503 administrative_identity_unavailable`.
  - `403 administrative_authorization_denied`.
  - `404 registered_backup_target_not_found` — `targetId` mal formado OU alvo inexistente.
  - `405 method_not_allowed`.
  - `409 backup_operation_busy` — gate de mutação HTTP ocupado.
  - `413 payload_too_large`.
  - `414 uri_too_long`.
  - `415 unsupported_media_type`.
  - `429 administrative_request_limited`.
  - `500 internal_error`.
  - `503 backup_operation_unavailable` — inclui falha ao persistir a política em disco (ver Erros).
  - `503 administrative_authorization_unavailable` / `authorization_audit_unavailable`.

## Caminho da requisição

- `handler(dependencies, "schedule")` — headers, admissão.
- `process()`: valida URL; valida `targetId` antes de tudo (404 se malformado, sem autenticar).
- Para `kind === "schedule"`, sempre rejeita query; como `request.method !== "GET"`, exige `PUT` ou `DELETE` (`requireMethod`), lê o corpo (`bodyJson`), admite a mutação no gate HTTP (`admitMutation` — 409 antes de autenticar se ocupado).
- Para `PUT` especificamente: `exactPolicyBody(body, "confirm_registered_backup_schedule_update")` valida que o corpo tem exatamente as chaves `confirmation` (valor exato) e `policy` (qualquer valor, repassado sem validação de forma nesta camada) — retorna `input.policy` cru.
- **Aqui está a lógica de negócio de verdade**: `protectedAdministration().setBackupSchedule.execute(targetId, policy)`. Em `create-protected-administration.ts`, passa por `runBackupMutation("update_backup_schedule", targetId, invoke)` — autentica/autoriza (`runner.run`), grava auditoria de início, executa, grava auditoria de fim. `invoke` chama `requireBackups().setBackupSchedule(targetId, value)`.
- `setBackupSchedule` (`create-backup-management.ts`): busca o alvo atual (`requireTarget` — 404 se não existir), **valida e constrói** a nova agenda com `createBackupSchedule(value)` (domínio, `src/backup-management/domain/backup-target.ts`) — é aqui que a forma do `policy` é de fato checada (modo válido, para `"scheduled"` exige `timezone` e `windows` corretos; qualquer desvio lança `BackupTargetValidationError`). Se válida, atualiza o catálogo em memória (`catalog.updateSchedule`) e tenta persistir com `policyStore.save(catalog.list())` (`FileBackupTargetPolicyStore`); **se a persistência falhar, reverte o catálogo em memória para o valor anterior e relança o erro** — evita que o processo fique com um estado em memória que nunca foi salvo em disco.
- `send()` devolve o `BackupSchedule` resultante (bruto, sem `map*`).

## Funções-chave

- **`exactPolicyBody`** (`administrative-backups-route.ts`) — garante que o corpo tem exatamente `confirmation` + `policy`, nada mais; não valida o conteúdo de `policy`, só sua presença.
- **`createBackupSchedule`** (`src/backup-management/domain/backup-target.ts`) — a validação de negócio real da nova agenda: modo permitido, exclusividade de campos por modo, fuso horário e janelas semanais válidos quando `scheduled`. É o único lugar que decide se um `policy` é aceitável.
- **`setBackupSchedule`** (`create-backup-management.ts`) — orquestra atualização em memória + persistência em disco com rollback em caso de falha de persistência; decide que "salvo com sucesso" significa "em memória e em disco ao mesmo tempo".
- **`runBackupMutation`** (`create-protected-administration.ts`) — autentica/autoriza/audita a mutação, separando "a chamada foi autorizada" de "a mudança foi aplicada com sucesso".

## Erros e casos de borda

- `policy` malformado (`{}`, modo desconhecido, `scheduled` sem `windows`, fuso horário inválido) responde `400 invalid_backup_request` — o erro de domínio `BackupTargetValidationError` é explicitamente reconhecido por `mapError()` desta rota (comentário no código: um erro do chamador não deve virar um 503 que sugere "tente de novo", pois tentar de novo sem mudar a política nunca vai funcionar).
- Se `policyStore.save` falhar (por exemplo, erro de I/O ao gravar o arquivo de política), o catálogo em memória é revertido antes de o erro subir — o chamador recebe um erro (mapeado para `503 backup_operation_unavailable`, já que não é um dos erros especificamente tratados) e pode confiar que a agenda **não** mudou, mesmo que a resposta não deixe isso explícito.
- Trocar de `"scheduled"` para `"manual"`/`"disabled"` via este endpoint é uma atualização de agenda como qualquer outra — não é a mesma coisa que `DELETE .../schedule` (que força especificamente `mode: "manual"`).

## Observações

- O corpo desta rota carrega uma política inteira (fuso + janelas semanais), mas o limite de tamanho de corpo aplicado de fato é 4096 bytes (`MAX_BODY_BYTES` em `administrative-backups-route.ts`), não os 8192 declarados no catálogo (`JSON_BODY.maxBodyBytes`) — o mesmo desvio observado nas demais mutações desta família. Uma agenda com muitas janelas semanais poderia esbarrar nesse limite antes do esperado pela política declarada.
- O gate de mutação (`mutationGate`) é a mesma instância compartilhada com `services`/`service availability`/`machine schedule` (ver observação equivalente em `post-admin-backups-targets-target-id-runs.md`).
