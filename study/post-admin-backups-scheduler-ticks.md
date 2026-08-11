# POST /admin/backups/scheduler/ticks

## Resumo

Avança o agendador de backups em um "tick": procura ocorrências agendadas devidas desde a última verificação até agora, e dispara os backups correspondentes. Existe para ser chamada periodicamente (por um cron externo ou orquestrador) em vez de o processo Node manter seu próprio timer — e é protegida contra execução duplicada de uma mesma ocorrência agendada ("claim-protected replay", ver abaixo).

## Contrato

- **Método/Path**: `POST /admin/backups/scheduler/ticks`.
- **Arquivo de registro**: `src/http/administrative-backups-route.ts` (`handler(dependencies, "tick")`), catalogado como `backups.scheduler.tick` (operação `run_backup_scheduler_tick`, permissão `backups.scheduler.tick`, `confirmationPolicy: exact:confirm_backup_scheduler_tick`, `gatePolicy: backup_operation`, **`replayPolicy: "claim_protected"`** — a única rota de todo o catálogo administrativo com essa política) — roles: `backup_operator`, `administrator`.
- **Middlewares em `/admin*`**: envelope de segurança.
- **Autenticação/Autorização**: Cloudflare Access + permissão `backups.scheduler.tick`.
- **Parâmetros de rota**: nenhum.
- **Query string**: não aceita.
- **Corpo da requisição** (JSON, mesmas regras de tamanho/tipo das mutações de backup): exatamente `{ "confirmation": "confirm_backup_scheduler_tick" }` (`exactBody`).
- **Formato da resposta** (200, `application/json`): `BackupSchedulerTickResult` bruto — `{ result: "idle"|"initialized"|"advanced"|"incomplete"|"conflict"|"blocked", processedCount: number, duplicateCount: number }` (sem função de mapeamento).
- **Códigos de status possíveis**:
  - `200` — o tick foi *executado* (mesmo que `result` seja `"conflict"` ou `"incomplete"` — não são erros HTTP, são estados de negócio, ver Erros).
  - `400 invalid_backup_request` — corpo mal formado ou confirmação incorreta.
  - `401` / `503 administrative_identity_unavailable`.
  - `403 administrative_authorization_denied`.
  - `405 method_not_allowed`.
  - `409 backup_operation_busy` — apenas do gate de mutação **HTTP** (`mutationGate`); a reentrância interna do próprio scheduler não gera 409 (vira `result: "conflict"` em uma resposta 200).
  - `413 payload_too_large`.
  - `414 uri_too_long`.
  - `415 unsupported_media_type`.
  - `429 administrative_request_limited`.
  - `500 internal_error`.
  - `503 backup_operation_unavailable` — inclui falhas do armazenamento de cursor/claims (por exemplo `backup_cursor_corrupt`, `backup_claim_corrupt`, `backup_claim_too_large`).
  - `503 administrative_authorization_unavailable` / `authorization_audit_unavailable`.

## Caminho da requisição

- `handler(dependencies, "tick")` — headers, admissão.
- `process()` (não há bloco `if` dedicado a `"tick"` — é o caminho final, sem `else if`, do fluxo em `administrative-backups-route.ts`): valida URL; note que, diferente das rotas por `targetId`, aqui **não há** checagem de `isTargetId` (não existe `targetId` nesta rota).
- Exige `POST`; rejeita query; lê o corpo (`bodyJson`); `exactBody(body, "confirm_backup_scheduler_tick")`.
- **Gate de mutação HTTP**: `admitMutation` — 409 se ocupado, antes de autenticar.
- **Aqui está a lógica de negócio de verdade**: `protectedAdministration().runBackupSchedulerTick.execute()`. Em `create-protected-administration.ts`, a capacidade `runBackupSchedulerTick` não usa o helper genérico `runBackupMutation` (que exige um `targetId` para os detalhes de auditoria) — tem seu próprio bloco inline (linhas ~815-848): passa por `runner.run("run_backup_scheduler_tick", ...)` (autentica/autoriza), grava um registro de auditoria de início sem `targetId` nos detalhes, executa `requireBackups().runBackupSchedulerTick()`, e grava o fim como sucesso ou falha.
- `requireBackups().runBackupSchedulerTick()` delega a `RunBackupSchedulerTick.execute()` (`src/backup-management/application/run-backup-scheduler-tick.ts`) — **é aqui que a proteção contra replay realmente vive**, em três camadas independentes:
  1. **Reentrância no processo**: um flag privado `#active` na própria instância (única, compartilhada por todo o processo). Se um tick já está em andamento quando outro chega, o segundo retorna imediatamente `{ result: "conflict", processedCount: 0, duplicateCount: 0 }` sem tocar em cursor ou claims. Protege só dentro do mesmo processo Node — não entre réplicas.
  2. **Cursor com compare-and-set**: o agendador lê o cursor atual (`BackupSchedulerCursorStore.read()` — timestamp ISO da última verificação, ou `null` na primeira vez). Se `null`, inicializa com `compareAndSet(null, now)` (`result: "initialized"`); se a CAS falhar (alguém já inicializou primeiro), `result: "conflict"`. Com cursor existente, calcula as ocorrências devidas entre `(cursor, now]`, processa (ver item 3), e ao final tenta `compareAndSet(cursor, now)` para avançar a janela — se outra escrita já moveu o cursor nesse meio-tempo, `result: "conflict"` (com o `processedCount`/`duplicateCount` acumulado até então). `FileBackupSchedulerCursorStore` implementa isso de forma durável (escreve em arquivo temporário e renomeia atomicamente), então a proteção sobrevive a reinícios do processo.
  3. **Claim por ocorrência (a proteção central de "replay")**: para cada ocorrência `(targetId, scheduledFor)` devida na janela, o agendador chama `BackupOccurrenceClaimStore.claim(targetId, scheduledFor)` **antes** de rodar o backup. A chave da claim é a combinação exata `targetId` + horário agendado. Se a claim já existir, retorna `"duplicate"` — a ocorrência é pulada (`duplicateCount += 1`) e o backup **não** roda de novo; só uma claim nova (`"claimed"`) libera a execução (`RunRegisteredBackup.execute({ ..., trigger: "scheduled" })`). `FileBackupOccurrenceClaimStore` persiste cada claim como uma linha JSON em um arquivo privado (`0o600`), então a proteção também sobrevive a reinícios.
- Se `run.execute` falhar para alguma ocorrência, o laço **para imediatamente** e retorna `{ result: "incomplete", processedCount, duplicateCount }` — as ocorrências restantes da janela não são tentadas nesse tick (ficarão para o próximo, já que o cursor só avança se todas as ocorrências da janela forem processadas com sucesso).
- `send()` devolve o `BackupSchedulerTickResult` bruto.

## Funções-chave

- **`RunBackupSchedulerTick.execute`** (`src/backup-management/application/run-backup-scheduler-tick.ts`) — o coração de toda a rota: decide quais ocorrências são "devidas", protege contra reentrância/replay em três camadas (flag em processo, CAS de cursor, claim por ocorrência) e decide quando o cursor pode avançar.
- **`BackupOccurrenceClaimStore.claim`** (interface em `backup-ports.ts`; implementações `InMemoryBackupOccurrenceClaimStore`/`FileBackupOccurrenceClaimStore`) — a claim propriamente dita: `"claimed"` vs. `"duplicate"` para um par `(targetId, scheduledFor)`, é o mecanismo que dá nome à política `claim_protected` do catálogo.
- **`BackupSchedulerCursorStore.compareAndSet`** — garante que o avanço da janela de varredura é atômico; sem isso, duas execuções poderiam recalcular a mesma janela "devida" e tentar reclamar as mesmas ocorrências simultaneamente (o que as claims também cobririam, mas em dobro de trabalho).
- **`dueOccurrences`** (função livre no mesmo arquivo) — decide, minuto a minuto dentro da janela `(cursor, now]`, quais `(targetId, scheduledFor)` batem com as janelas semanais configuradas de cada alvo `scheduled`, respeitando o fuso horário do alvo; limitada a no máximo 32 ocorrências por tick.
- **`runner.run` / bloco inline de auditoria** (`create-protected-administration.ts`) — autentica/autoriza a operação `run_backup_scheduler_tick` e grava o resultado (sucesso/falha) no histórico de auditoria, sem `targetId` associado (é uma operação de escopo global, não de um alvo específico).

## Erros e casos de borda

- **Replay do mesmo tick HTTP** (cliente reenvia a mesma requisição por timeout, retry automático etc.): se o primeiro tick já concluiu e avançou o cursor, o segundo tick simplesmente recalcula uma janela `(novo cursor, now]` — normalmente vazia ou com poucas ocorrências novas, então não reprocessa nada do tick anterior. Se o primeiro tick ainda está em andamento no mesmo processo, o segundo retorna `"conflict"` sem fazer nada. Se dois processos diferentes tentam simultaneamente (durável via arquivo), o perdedor do CAS do cursor recebe `"conflict"`; mesmo que ambos cheguem a tentar reclamar a mesma ocorrência, só um consegue a claim — o outro conta como `duplicateCount`.
- `result: "idle"` significa que a janela foi varrida e não havia ocorrências devidas — não é um erro.
- `result: "blocked"` não é gerado por este caminho (é um valor do tipo `BackupSchedulerTickResult`... na verdade não aparece na união de retorno do `execute()` atual — ver Observações).
- Uma ocorrência cuja execução falha (`RunRegisteredBackup.execute` lança) interrompe o laço inteiro do tick, não só aquela ocorrência — as ocorrências seguintes da mesma janela não são tentadas nesse tick.
- O limite de 32 ocorrências por tick (`dueOccurrences(...).slice(0, 32)`) significa que uma janela muito atrasada (processo fora do ar por muito tempo) precisa de múltiplos ticks sucessivos para se recuperar totalmente.

## Observações

- **"Onze" checagens à parte — aqui, o nome da política é o ponto central pedido**: `claim_protected` no catálogo (`administrative-route-security-catalog.ts`) é só um rótulo declarativo; a proteção real está inteiramente na implementação do `RunBackupSchedulerTick` e nas duas stores (`claims`, `cursor`) — não há nenhuma validação automática que confirme que o catálogo e o código permanecem alinhados.
- O tipo `BackupSchedulerTickResult["result"]` inclui `"blocked"` na união declarada (`run-backup-scheduler-tick.ts`, linha ~16), mas nenhum caminho dentro de `RunBackupSchedulerTick.execute` atualmente produz esse valor — os retornos reais são `"conflict"`, `"initialized"`, `"idle"`, `"advanced"` ou `"incomplete"`. Pode ser um valor reservado para uso futuro, ou um resquício de uma versão anterior da lógica.
- Como as demais mutações desta família, o limite de corpo real é 4096 bytes, não os 8192 declarados no catálogo (`JSON_BODY.maxBodyBytes`).
- O gate de mutação HTTP (`mutationGate`) é compartilhado com services/availability/machine-schedule — um reinício de serviço em andamento pode fazer um tick agendado externamente responder `409` em vez de rodar.
