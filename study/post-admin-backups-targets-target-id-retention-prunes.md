# POST /admin/backups/targets/:targetId/retention/prunes

## Resumo

Executa a poda (prune) de artefatos de backup de um alvo, aplicando a política de retenção atual (mantém as N runs mais recentes bem-sucedidas e/ou remove as mais antigas que uma idade máxima). Existe para liberar espaço em disco sob controle explícito do operador, em vez de apagar automaticamente.

## Contrato

- **Método/Path**: `POST /admin/backups/targets/:targetId/retention/prunes`.
- **Arquivo de registro**: `src/http/administrative-backups-route.ts` (`handler(dependencies, "prune")`), catalogado como `backups.retention.prune` (operação `run_backup_retention_prune`, permissão `backups.retention.prune`, `confirmationPolicy: exact:confirm_registered_backup_retention_prune`, `gatePolicy: backup_operation`) — roles: `backup_operator`, `administrator`.
- **Middlewares em `/admin*`**: envelope de segurança.
- **Autenticação/Autorização**: Cloudflare Access + permissão `backups.retention.prune`.
- **Parâmetros de rota**: `targetId` — validado por `isTargetId` antes de qualquer outra coisa.
- **Query string**: não aceita.
- **Corpo da requisição** (JSON, mesmas regras de tamanho/tipo das mutações de backup): exatamente `{ "confirmation": "confirm_registered_backup_retention_prune" }` (`exactBody`).
- **Formato da resposta** (200, `application/json`): `BackupRetentionResult` bruto — `{ targetId, processedCount, deletedCount, result: "completed"|"busy"|"blocked"|"partial" }` (**sem** passar por função de mapeamento; note que `result: "busy"`/`"blocked"`/`"partial"` são devolvidos com HTTP 200 — ver Erros e Observações).
- **Códigos de status possíveis**:
  - `200` — a poda foi _tentada_; o campo `result` no corpo é que diz se completou, ficou bloqueada, parcial ou não rodou por estar ocupada.
  - `400 invalid_backup_request` — corpo mal formado ou confirmação incorreta.
  - `401` / `503 administrative_identity_unavailable`.
  - `403 administrative_authorization_denied`.
  - `404 registered_backup_target_not_found` — `targetId` mal formado OU alvo inexistente.
  - `405 method_not_allowed`.
  - `409 backup_operation_busy` — apenas do gate de mutação **HTTP** (`mutationGate`); o gate **interno** do módulo de backup, quando ocupado, não gera 409 — vira `result: "busy"` dentro de uma resposta 200 (ver Caminho da requisição).
  - `413 payload_too_large`.
  - `414 uri_too_long`.
  - `415 unsupported_media_type`.
  - `429 administrative_request_limited`.
  - `500 internal_error`.
  - `503 backup_operation_unavailable` — inclui `Error("backup_run_history_corrupt")` se o histórico de runs estiver inconsistente.
  - `503 administrative_authorization_unavailable` / `authorization_audit_unavailable`.

## Caminho da requisição

- `handler(dependencies, "prune")` — headers, admissão.
- `process()`: valida URL; valida `targetId` (`isTargetId`) antes de tudo — 404 se malformado, sem autenticar.
- Exige `POST`; rejeita query; lê o corpo (`bodyJson`); `exactBody(body, "confirm_registered_backup_retention_prune")` valida a confirmação de campo único.
- **Gate de mutação HTTP**: `admitMutation` — 409 se ocupado, antes de autenticar. Mesmo gate compartilhado com services/availability/machine-schedule (ver observações das demais rotas de mutação).
- **Aqui está a lógica de negócio de verdade**: `protectedAdministration().pruneBackupRetention.execute(targetId)`. Em `create-protected-administration.ts`, passa por `runBackupMutation("run_backup_retention_prune", targetId, invoke)` (autentica/autoriza/audita início-fim). `invoke` chama `requireBackups().pruneBackupRetention(targetId)` → `ApplyRegisteredBackupRetention.execute(targetId)` (`src/backup-management/application/apply-registered-backup-retention.ts`).
- `ApplyRegisteredBackupRetention.execute`: busca o alvo (404 se inexistente); adquire o **gate interno** do módulo de backup (`FixedBackupOperationGate`, o mesmo usado por `RunRegisteredBackup`) — **se ocupado, não lança erro: retorna `{ result: "busy", processedCount: 0, deletedCount: 0 }`**, diferente de `RunRegisteredBackup`, que lança `Error("backup_operation_busy")` no mesmo cenário; pagina todas as runs `succeeded` com artefato conhecido; cruza os artefatos gerenciados em disco com as runs conhecidas — se encontrar um artefato órfão (sem run correspondente), retorna `result: "blocked"` sem apagar nada, como proteção contra apagar algo não rastreado; calcula o conjunto protegido (as `keepLastSuccessful` runs mais recentes); marca para exclusão o que não está protegido e é antigo demais (`maxSuccessfulAgeDays`) ou de outra forma redundante; remove cada artefato marcado, um a um — se uma remoção falhar no meio do caminho, para e retorna `result: "partial"` (ou `"blocked"` se nada foi apagado ainda) em vez de propagar o erro.
- `send()` devolve o `BackupRetentionResult` bruto.

## Funções-chave

- **`exactBody`** (`administrative-backups-route.ts`) — confirmação de campo único, mesmo padrão das demais mutações "de ação" (sem `policy`).
- **`ApplyRegisteredBackupRetention.execute`** (`src/backup-management/application/apply-registered-backup-retention.ts`) — toda a lógica de negócio real: o que é "protegido", o que é "antigo demais", o que é "órfão e bloqueia a poda". É a função mais complexa de todo o escopo de backups.
- **`runBackupMutation`** (`create-protected-administration.ts`) — autentica/autoriza/audita a chamada de poda, tratando-a como qualquer outra mutação de backup mesmo que o resultado de negócio seja "não fiz nada" (`busy`/`blocked`).

## Erros e casos de borda

- **`result: "busy"` chega como HTTP 200**, não como 409 — só o gate de mutação HTTP (checado antes de autenticar) gera 409 de fato; o gate interno do módulo de backup, quando ocupado (por exemplo, um `POST .../runs` ou um tick agendado rodando ao mesmo tempo), se manifesta como um corpo de sucesso com `result: "busy"`. Um cliente que só olha o status HTTP pode achar que a poda rodou.
- **`result: "blocked"`** acontece quando existe pelo menos um artefato gerenciado em disco sem uma run `succeeded` correspondente conhecida — o sistema prefere não apagar nada a arriscar apagar algo que não devia, mas isso significa que uma poda pode nunca progredir até esse artefato órfão ser resolvido manualmente (não há um mecanismo automático de reconciliação exposto por esta rota).
- **`result: "partial"`** acontece se uma remoção de artefato específica falhar (erro de I/O) depois que outras já tinham sido removidas com sucesso — a poda para no primeiro erro em vez de tentar as restantes.
- Histórico de runs inconsistente (paginação da store detecta que a sequência não avançou) lança `Error("backup_run_history_corrupt")`, não tratado especificamente por `mapError()`, caindo em `503 backup_operation_unavailable`.

## Observações

- A assimetria entre `RunRegisteredBackup` (gate ocupado → **lança** erro → HTTP 409) e `ApplyRegisteredBackupRetention` (gate ocupado → **retorna** `result: "busy"` → HTTP 200) para o mesmo gate interno compartilhado (`FixedBackupOperationGate`) é inconsistente: duas operações de backup concorrentes reagem de formas observáveis diferentes ao mesmo tipo de conflito, uma como erro HTTP e outra como corpo de sucesso.
- Como em outras mutações desta família, o limite de corpo real é 4096 bytes, não os 8192 declarados no catálogo.
