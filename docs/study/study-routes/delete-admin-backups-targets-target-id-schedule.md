# DELETE /admin/backups/targets/:targetId/schedule

## Resumo

Remove o agendamento automático de um alvo de backup, forçando-o para o modo `manual`. Existe como um atalho seguro para "parar de agendar este alvo" sem exigir que o operador monte um `policy` completo (diferente de um `PUT` com `mode: "manual"`, que exigiria o mesmo corpo mínimo, mas via o caminho genérico de atualização).

## Contrato

- **Método/Path**: `DELETE /admin/backups/targets/:targetId/schedule` (mesmo path Express de GET/PUT, dispatch por método).
- **Arquivo de registro**: `src/http/administrative-backups-route.ts` (`handler(dependencies, "schedule")`), catalogado como `backups.schedule.delete` (operação `remove_backup_schedule`, permissão `backups.schedule.write` — a mesma permissão de escrita usada pelo `PUT`, não uma permissão de exclusão separada; `confirmationPolicy: exact:confirm_registered_backup_schedule_removal`, `gatePolicy: backup_operation`) — roles: `backup_operator`, `administrator`.
- **Middlewares em `/admin*`**: envelope de segurança.
- **Autenticação/Autorização**: Cloudflare Access + permissão `backups.schedule.write`.
- **Parâmetros de rota**: `targetId` — validado por `isTargetId` antes do dispatch por método.
- **Query string**: não aceita.
- **Corpo da requisição** (JSON, mesmas regras de tamanho/tipo das demais mutações): exatamente `{ "confirmation": "confirm_registered_backup_schedule_removal" }` (`exactBody`) — sem campo `policy`, diferente do `PUT`.
- **Formato da resposta** (200, `application/json`): o `BackupSchedule` resultante, sempre `{ mode: "manual", timezone: null, schedule: null }`.
- **Códigos de status possíveis**:
  - `200` — agenda removida (revertida para `manual`) com sucesso.
  - `400 invalid_backup_request` — corpo mal formado ou confirmação incorreta.
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

- Mesmo encanamento de `PUT .../schedule` até o ponto de dispatch por método: headers, admissão, validação de `targetId` (404 pré-autenticação se malformado), rejeição de query, `requireMethod("PUT", "DELETE")`, leitura do corpo, `admitMutation` (gate HTTP, 409 se ocupado, antes de autenticar).
- Para `DELETE`: `exactBody(body, "confirm_registered_backup_schedule_removal")` valida a confirmação (um único campo, sem `policy`).
- **Aqui está a lógica de negócio de verdade**: `protectedAdministration().removeBackupSchedule.execute(targetId)`. Em `create-protected-administration.ts`, passa por `runBackupMutation("remove_backup_schedule", targetId, invoke)` (autentica/autoriza/audita início-fim), chamando `requireBackups().removeBackupSchedule(targetId)`.
- `removeBackupSchedule` (`create-backup-management.ts`): busca o alvo (`requireTarget` — 404 se inexistente), constrói diretamente o valor `{ mode: "manual", timezone: null, schedule: null }` (**sem** passar por `createBackupSchedule` — é um literal fixo, não um "PUT disfarçado"), atualiza o catálogo (`catalog.updateSchedule`), tenta persistir (`policyStore.save`) com o mesmo padrão de rollback em caso de falha de `PUT`.
- `send()` devolve o `BackupSchedule` resultante.

## Funções-chave

- **`exactBody`** (`administrative-backups-route.ts`) — mesma função usada pelas demais confirmações simples de um campo só; aqui garante que nenhum `policy` seja aceito (diferente do `PUT`, que exige `policy`).
- **`removeBackupSchedule`** (`create-backup-management.ts`) — decide o valor de destino fixo (`manual`, sem agenda) e reaproveita o mesmo padrão de persistência-com-rollback do `setBackupSchedule`.
- **`runBackupMutation`** (`create-protected-administration.ts`) — autentica/autoriza/audita a remoção.

## Erros e casos de borda

- Remover a agenda de um alvo que já está em `manual` é idempotente em efeito (a resposta é sempre `{ mode: "manual", ... }`), mas ainda assim executa a escrita em disco a cada chamada — não há um "curto-circuito" que detecte "já está assim, não precisa persistir de novo".
- Se a persistência falhar, o catálogo em memória é revertido antes do erro subir, igual ao `PUT`.
- Diferente de "desabilitar" o alvo (`mode: "disabled"`), remover a agenda (`mode: "manual"`) ainda permite disparar backups manuais via `POST .../runs` — só backups agendados automaticamente param.

## Observações

- Semanticamente, este endpoint é um caso particular do `PUT` (mesmo destino que um `PUT` com `{ mode: "manual" }` produziria), mas exposto como uma operação de confirmação e permissão distintas (`confirm_registered_backup_schedule_removal` vs. `confirm_registered_backup_schedule_update`) — ambas exigem a mesma permissão `backups.schedule.write`, então na prática não há isolamento de acesso adicional entre "atualizar para manual" e "remover agenda", só uma UX mais direta.
