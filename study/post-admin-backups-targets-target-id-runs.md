# POST /admin/backups/targets/:targetId/runs

## Resumo

Dispara manualmente uma execução de backup para um alvo registrado. Existe para permitir rodar um backup sob demanda (fora do agendamento), com confirmação explícita porque move dados e consome recursos do host.

## Contrato

- **Método/Path**: `POST /admin/backups/targets/:targetId/runs`.
- **Arquivo de registro**: `src/http/administrative-backups-route.ts` (`handler(dependencies, "manual")`), catalogado como `backups.run` (operação `run_registered_backup`, permissão `backups.run`, `confirmationPolicy: exact:confirm_registered_backup_run`, `gatePolicy: backup_operation`, `replayPolicy: state_recheck_required`) — roles: `backup_operator`, `administrator`.
- **Middlewares em `/admin*`**: envelope de segurança.
- **Autenticação/Autorização**: Cloudflare Access + permissão `backups.run`.
- **Parâmetros de rota**: `targetId` — validado por `isTargetId` **antes** de qualquer outra coisa (inclusive antes de checar o método HTTP).
- **Query string**: não aceita.
- **Corpo da requisição** (JSON, `Content-Type: application/json` ou `; charset=utf-8`, sem `Content-Encoding`, ≤ 4096 bytes — ver Observações sobre o limite real vs. o declarado no catálogo): exatamente `{ "confirmation": "confirm_registered_backup_run" }` — um único campo, valor exato (`exactBody`).
- **Formato da resposta** (200, `application/json`): o retorno bruto de `RunRegisteredBackup.execute` — `{ run: BackupRun, artifactDirectory: string | null }` (**note**: este endpoint não passa a resposta por `mapBackupRun`, diferente das rotas de leitura de runs — ver Observações).
- **Códigos de status possíveis**:
  - `200` — backup executado com sucesso (mesmo que a run em si tenha terminado como `"failed"` — ver Erros).
  - `400 invalid_backup_request` — corpo ausente/mal formado, chave extra, confirmação incorreta, `Content-Type` não suportado, payload não-UTF8.
  - `401` / `503 administrative_identity_unavailable`.
  - `403 administrative_authorization_denied`.
  - `404 registered_backup_target_not_found` — `targetId` mal formado OU alvo inexistente.
  - `405 method_not_allowed` — método diferente de POST.
  - `409 backup_operation_busy` — gate de mutação HTTP ocupado (ver Caminho da requisição) OU o gate interno de execução de backup ocupado (mapeado do `Error("backup_operation_busy")` lançado por `RunRegisteredBackup`).
  - `413 payload_too_large` — corpo acima de 4096 bytes.
  - `414 uri_too_long`.
  - `415 unsupported_media_type` — `Content-Type` incorreto ou `Content-Encoding` presente.
  - `429 administrative_request_limited`.
  - `500 internal_error`.
  - `503 backup_operation_unavailable` — inclui os casos não mapeados de `backup_target_disabled` e `backup_target_not_scheduled` (ver Observações — deveriam plausivelmente ser 400/409, não 503).
  - `503 administrative_authorization_unavailable` / `authorization_audit_unavailable`.

## Caminho da requisição

- `handler(dependencies, "manual")` — headers de segurança, admissão de requisição.
- `process()`: valida URL; **valida `targetId` com `isTargetId` antes de checar método/corpo** — `targetId` inválido responde 404 sem autenticar.
- Exige `POST`; rejeita query; lê e parseia o corpo com `bodyJson()` (Content-Type exato, sem compressão, ≤4096 bytes, UTF-8 válido, JSON estrito via `parseStrictJson`); valida forma exata do corpo com `exactBody(body, "confirm_registered_backup_run")`.
- **Gate de mutação HTTP**: `admitMutation(dependencies)` chama `dependencies.mutationGate.tryAdmit()` — se ocupado, lança `409 backup_operation_busy` **antes** de autenticar. Este gate (`FixedAdministrativePowerOperationGate`, instância `serviceMutationGate` na composição — ver Observações) é compartilhado com as mutações de `services`, `service availability` e `machine schedule`, não é exclusivo de backups.
- **Aqui está a lógica de negócio de verdade**: `protectedAdministration().runRegisteredBackup.execute(targetId)`. Em `create-protected-administration.ts`, a capacidade `runRegisteredBackup` chama `runBackupMutation("run_registered_backup", targetId, invoke)`, que primeiro passa pelo `runner.run(...)` (autentica/autoriza), depois grava um registro de auditoria "iniciado" (`operationAudit.begin`), executa `requireBackups().runRegisteredBackup({ targetId, trigger: "manual" })` e grava "concluído"/"falhou" (`operationAudit.complete`) conforme o resultado.
- `requireBackups().runRegisteredBackup` (`create-backup-management.ts`) delega a `RunRegisteredBackup.execute` (`src/backup-management/application/run-registered-backup.ts`): busca o alvo (404 se não existir), rejeita se `schedule.mode === "disabled"` (`backup_target_disabled`) ou se o gatilho fosse `scheduled` sem o alvo estar `scheduled` (não se aplica aqui, trigger é sempre `"manual"` nesta rota), adquire um **segundo gate interno** (`FixedBackupOperationGate`, próprio do módulo de backup, distinto do gate HTTP) — se ocupado, lança `Error("backup_operation_busy")` — aloca sequência, grava a run como `"started"`, roda o adapter (`mock` ou `filesystem_tree`) e grava o resultado terminal (`"succeeded"` ou `"failed"`).
- De volta ao HTTP: a resposta é enviada **sem** passar por `mapBackupRun` — o objeto `{ run, artifactDirectory }` bruto de `RunRegisteredBackupResult` é serializado diretamente.
- `finally { release() }` libera o gate HTTP independente do resultado.

## Funções-chave

- **`exactBody`** (`administrative-backups-route.ts`) — barra qualquer corpo que não seja exatamente `{ confirmation: "confirm_registered_backup_run" }`; é o "checkpoint de confirmação explícita" da mutação.
- **`admitMutation`** (`administrative-backups-route.ts`) — impõe execução serializada (uma mutação HTTP de backup/serviço/agenda por vez) antes mesmo de autenticar.
- **`runBackupMutation`** (`create-protected-administration.ts`) — envolve a chamada de negócio com autenticação/autorização (via `runner.run`) e auditoria de início/fim; decide o que fica registrado no histórico de eventos administrativos.
- **`RunRegisteredBackup.execute`** (`src/backup-management/application/run-registered-backup.ts`) — a lógica de negócio real: valida se o alvo pode rodar (não desabilitado), serializa execuções via seu próprio gate, e é responsável por decidir sucesso/falha da run.
- **`FilesystemTreeBackupAdapter` / `MockBackupAdapter`** (fora do escopo detalhado aqui) — o adaptador escolhido por `target.kind` é quem efetivamente copia os dados; a rota HTTP nunca vê essa camada diretamente.

## Erros e casos de borda

- Confirmação com valor certo mas com campos extras (`{ confirmation: "...", note: "x" }`) é rejeitada por `exactBody` (exige exatamente 1 chave).
- Alvo com `schedule.mode === "disabled"` não pode ser executado manualmente — `RunRegisteredBackup` lança `Error("backup_target_disabled")`, que **não** é tratado explicitamente por `mapError()` desta rota (só trata `registered_backup_target_not_found`, `backup_run_not_found` e `backup_operation_busy`) e cai no fallback `503 backup_operation_unavailable` — um alvo desabilitado responde como se o subsistema estivesse fora do ar, não como um estado inválido do próprio alvo.
- Duas requisições concorrentes de mutação batem primeiro no gate HTTP (`409` imediato, antes de autenticar); se ambas passarem esse gate em momentos diferentes mas colidirem no gate interno do módulo de backup (por exemplo, uma tick agendada rodando ao mesmo tempo), a segunda recebe `Error("backup_operation_busy")` do próprio `RunRegisteredBackup`, mapeado para o mesmo `409`.
- Se o adapter falhar durante a cópia, a run é registrada como `"failed"` com um `failureCode`, e a resposta HTTP ainda é `200` — o "erro" fica dentro do corpo da resposta (`run.status === "failed"`), não como status HTTP de erro. Só falhas *antes* de a run começar (alvo inexistente/desabilitado, gate ocupado) viram erro HTTP.
- Falha ao gravar a auditoria de conclusão depois que o backup já rodou gera `AdministrativeAuditPartialEffectError`, que não é um dos casos tratados por `mapError()` desta rota e cai no fallback genérico `503 backup_operation_unavailable` — perdendo a distinção "o backup pode ter rodado mesmo assim" que o nome do erro carrega.

## Observações

- **A resposta não usa `mapBackupRun`**: todas as outras rotas de leitura de run (`GET /admin/backups/runs`, `GET /admin/backups/runs/:runId`) devolvem o formato filtrado de `mapBackupRun`, mas esta rota devolve `{ run, artifactDirectory }` cru, incluindo `artifactDirectory` (um caminho de sistema de arquivos no host) que não aparece em nenhuma outra resposta pública. Vale confirmar se isso é intencional.
- **Limite de corpo**: o catálogo (`administrative-route-security-catalog.ts`, `JSON_BODY`) declara `maxBodyBytes: 8_192` para rotas de mutação, mas `administrative-backups-route.ts` define seu próprio `MAX_BODY_BYTES = 4_096` e é esse valor que `bodyJson()` de fato aplica. A política declarada no catálogo não corresponde ao limite realmente imposto pelo código desta família de rotas.
- **Gate de mutação compartilhado**: `mutationGate` (tipo `AdministrativePowerOperationGate`) é, na composição real (`src/http/create-administrative-runtime.ts`), a mesma instância `serviceMutationGate` usada por `services`, `service availability` e `machine schedule` — não uma instância dedicada a backups, apesar do catálogo declarar `gatePolicy: "backup_operation"` como se fosse uma categoria própria. Um reinício de serviço em andamento bloqueia (`409`) um disparo manual de backup, e vice-versa.
- `backup_target_not_scheduled` (lançado por `RunRegisteredBackup` quando `trigger === "scheduled"` e o alvo não está em modo `scheduled`) nunca ocorre por esta rota HTTP, já que o trigger aqui é sempre `"manual"` — é relevante apenas para `POST /admin/backups/scheduler/ticks`.
