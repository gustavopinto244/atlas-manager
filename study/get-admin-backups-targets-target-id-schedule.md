# GET /admin/backups/targets/:targetId/schedule

## Resumo

Lê a política de agendamento atual de um alvo de backup (modo `manual`/`scheduled`/`disabled`, fuso horário e janelas semanais quando agendado). Existe para a UI mostrar/editar o agendamento sem ter que extrair esses campos da resposta completa do alvo.

## Contrato

- **Método/Path**: `GET /admin/backups/targets/:targetId/schedule`. Compartilha o mesmo path Express (`app.all`) com `PUT` e `DELETE` — o método real é dispachado dentro do handler.
- **Arquivo de registro**: `src/http/administrative-backups-route.ts` (`handler(dependencies, "schedule")`), catalogado como `backups.schedule.read` (operação `read_backup_schedule`, permissão `backups.schedule.read`) — roles com esse acesso: `backup_operator`, `administrator`. Note que este `routeId` é registrado junto com `backups.schedule.update` e `backups.schedule.delete` no mesmo `registerAdministrativeRoute` (todos compartilham o path `/admin/backups/targets/:targetId/schedule`).
- **Middlewares em `/admin*`**: envelope de segurança.
- **Autenticação/Autorização**: Cloudflare Access + permissão `backups.schedule.read`.
- **Parâmetros de rota**: `targetId` — validado por `isTargetId` antes do dispatch por método.
- **Query string**: não aceita.
- **Corpo da requisição**: não aceito para GET (`validateAdministrativeRequestHasNoBody`).
- **Formato da resposta** (200, `application/json`): `BackupSchedule` bruto do domínio — `{ mode: "manual"|"scheduled"|"disabled", timezone: string|null, schedule: WeeklyAvailabilitySchedule|null }` (**não** passa por nenhuma função `map*` — é o objeto de domínio serializado diretamente).
- **Códigos de status possíveis**:
  - `200` — sucesso.
  - `400 invalid_administrative_request` — query ou corpo presente.
  - `401` / `503 administrative_identity_unavailable`.
  - `403 administrative_authorization_denied`.
  - `404 registered_backup_target_not_found` — `targetId` mal formado OU alvo inexistente.
  - `405 method_not_allowed` — método fora de GET/PUT/DELETE.
  - `414 uri_too_long`.
  - `429 administrative_request_limited`.
  - `500 internal_error`.
  - `503 backup_operation_unavailable` / `503 administrative_authorization_unavailable`.

## Caminho da requisição

- `handler(dependencies, "schedule")` — headers, admissão.
- `process()`: valida URL; valida `targetId` (`isTargetId`) antes de qualquer coisa — 404 imediato se inválido, sem autenticar.
- Para `kind === "schedule"`: rejeita query sempre; se `request.method === "GET"`, valida ausência de corpo e segue direto para a leitura (não passa por `admitMutation` nem pelo gate de mutação — é só leitura).
- **Aqui está a lógica de negócio de verdade**: `protectedAdministration().getBackupSchedule.execute(targetId)`. Em `create-protected-administration.ts`, passa por `runner.run("read_backup_schedule", ...)` (autentica/autoriza/audita) e delega a `requireBackups().getBackupSchedule(targetId)`, que em `create-backup-management.ts` é `requireTarget(catalog, id).schedule` — lança `Error("registered_backup_target_not_found")` se o alvo não existir.
- `send()` serializa o `BackupSchedule` diretamente, sem transformação, com teto de 256 KiB.

## Funções-chave

- **`isTargetId`** (`administrative-backups-route.ts`) — barreira de formato antes de qualquer autenticação, compartilhada por toda a família `targets/:targetId/*`.
- **`ExecuteProtectedAdministrativeOperation.run`** (`create-protected-administration.ts`) — autentica/autoriza/audita `read_backup_schedule`.
- **`requireTarget`** (`create-backup-management.ts`) — decide se o alvo existe antes de expor seu `schedule`; usada também pelas rotas de mutação de agenda/retenção.

## Erros e casos de borda

- `targetId` mal formado responde 404 sem autenticar (mesmo padrão das demais rotas por `targetId`).
- Não há um "agendamento vazio" separado do modo `"manual"`/`"disabled"` — a ausência de agenda é representada pelo próprio `mode`, com `timezone`/`schedule` sempre `null` fora de `"scheduled"`.
- A resposta reflete o estado atual do catálogo em memória; como o catálogo é recarregado do disco apenas na inicialização do processo, uma edição feita fora da API HTTP (por exemplo diretamente no arquivo de política) não aparece até reiniciar.

## Observações

- Esta é uma das poucas respostas de leitura da família de backups que **não** passa por uma função de mapeamento dedicada (como `mapBackupTarget`/`mapBackupRun`) — devolve o tipo de domínio `BackupSchedule` praticamente cru. Isso significa que qualquer campo futuro adicionado ao domínio `BackupSchedule` vaza automaticamente na resposta pública, sem uma camada de tradução explícita para conter isso.
