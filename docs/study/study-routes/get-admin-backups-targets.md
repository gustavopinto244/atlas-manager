# GET /admin/backups/targets

## Resumo

Lista todos os alvos de backup registrados no "atlas" (o que existe para ser copiado, com seu modo de agendamento e resumo de retenção). Existe para dar visibilidade de configuração — "quais backups estão definidos e como estão configurados" — sem detalhar execuções.

## Contrato

- **Método/Path**: `GET /admin/backups/targets`.
- **Arquivo de registro**: `src/http/administrative-backups-route.ts` (`registerAdministrativeBackupRoutes` → `handler(dependencies, "targets")`), catalogado em `src/http/administrative-route-security-catalog.ts` como `backups.targets.read` (operação `read_registered_backup_targets`, permissão `backups.targets.read`, activationFlag `ADMINISTRATIVE_BACKUP_HTTP_ENABLED`).
- **Middlewares em `/admin*`**: envelope de segurança (`createAdministrativeSecurityEnvelope`, `src/http/create-app.ts`) valida Host/Origin/Sec-Fetch-* antes do handler.
- **Autenticação/Autorização**: exige principal Cloudflare Access autenticado e autorização para `read_registered_backup_targets` (permissão `backups.targets.read`) — roles: `auditor`, `backup_operator`, `administrator`.
- **Parâmetros de rota**: nenhum.
- **Query string**: não aceita nenhuma — `?` na URL já gera 400 (`rejectAdministrativeQuery`).
- **Corpo da requisição**: não aceito (`validateAdministrativeRequestHasNoBody` — qualquer `Content-Length` ≠ "0", `Transfer-Encoding` ou `Content-Type` presentes geram 400).
- **Formato da resposta** (200, `application/json`): `{ targets: [ { id, displayName, kind, scheduleMode, retentionSummary: { keepLastSuccessful, maxSuccessfulAgeDays }, capabilities: { manualRun, schedule, retention } } ] }` — ver `mapBackupTarget` em `src/http/administrative-backup-response.ts`.
- **Códigos de status possíveis**:
  - `200` — sucesso, mesmo que a lista venha vazia.
  - `400 invalid_administrative_request` — query string presente ou corpo presente.
  - `401 administrative_authentication_required` / `503 administrative_identity_unavailable` — falhas de autenticação.
  - `403 administrative_authorization_denied` — autenticado mas sem permissão.
  - `405 method_not_allowed` — método diferente de GET (`Allow: GET`).
  - `414 uri_too_long` — URL acima de 4096 bytes.
  - `429 administrative_request_limited` — limite de requisições administrativas excedido (`Retry-After: 1`).
  - `500 internal_error` — resposta serializada ultrapassaria 256 KiB, ou erro interno não mapeado.
  - `503 backup_operation_unavailable` — falha não classificada na camada de backup (inclui o subsistema de backups estar desabilitado na composição).
  - `503 administrative_authorization_unavailable` / `503 authorization_audit_unavailable` — falhas de autorização/auditoria.

## Caminho da requisição

- `handler(dependencies, "targets")` (`administrative-backups-route.ts`) é o `RequestHandler` único desta família, registrado via `app.all(path, handler)` (`registerAdministrativeRoute`, `administrative-route-security-catalog.ts`). O `path` real dispatch por `kind` é decidido dentro do próprio handler — é puro encanamento de roteamento manual.
- No `handler`: define headers de segurança, tenta admitir no limitador (`dependencies.admission.tryAdmit()`); se recusado, 429. Isso é proteção de infraestrutura compartilhada, não lógica da rota.
- `process()` (mesmo arquivo), para `kind === "targets"`: valida tamanho da URL, exige `GET` (`requireMethod`), rejeita query string, valida ausência de corpo — tudo encanamento.
- Cria um `CloudflareAccessAssertionReader` a partir do request e obtém `protectedAdministration()` — fábrica injetada de fora (composição da aplicação).
- **Aqui está a lógica de negócio de verdade**: `protectedAdministration().getRegisteredBackupTargets.execute()`. Essa interface é implementada em `createProtectedAdministration` (`src/access-control/composition/create-protected-administration.ts`): a chamada passa primeiro por `ExecuteProtectedAdministrativeOperation.run("read_registered_backup_targets", ...)`, que autentica o principal, autoriza a operação contra a permissão, registra a decisão em auditoria e só então invoca `requireBackups().listRegisteredBackupTargets()` — implementado em `src/backup-management/composition/create-backup-management.ts` como `catalog.list()`, uma leitura síncrona do catálogo de alvos em memória (carregado de `FileBackupTargetPolicyStore` na inicialização).
- De volta ao HTTP: `mapBackupTarget` (`administrative-backup-response.ts`) traduz cada `BackupTarget` de domínio para o formato público, incluindo o campo derivado `capabilities` (`manualRun`/`schedule` = `scheduleMode !== "disabled"`; `retention` sempre `true`).
- `send()` serializa e garante que a resposta não ultrapasse 256 KiB antes de enviar 200.
- Qualquer erro é capturado e mapeado por `mapError()` para um `HttpError`.

## Funções-chave

- **`process`** (`administrative-backups-route.ts`) — orquestra toda a validação de encanamento (método, query, corpo, target id quando aplicável) antes de acionar a lógica protegida; para esta rota, a parte relevante é curta: nenhuma query, nenhum corpo.
- **`ExecuteProtectedAdministrativeOperation.run`** (`create-protected-administration.ts`) — autentica, autoriza, audita e só então invoca a operação real. Decide se a requisição sequer chega a tocar no catálogo de backups.
- **`listRegisteredBackupTargets`** (fechamento em `create-backup-management.ts`, delega a `MutableBackupTargetCatalog.list()`) — devolve o estado atual em memória dos alvos (já carregado do disco via `FileBackupTargetPolicyStore.load` na composição); é aqui que "quais alvos existem" é decidido, não na rota HTTP.
- **`mapBackupTarget`** (`administrative-backup-response.ts`) — decide exatamente quais campos do domínio (`BackupTarget`) são expostos publicamente e deriva `capabilities` a partir do `scheduleMode` — é serialização, mas com uma decisão de produto embutida (o que a UI pode oferecer para aquele alvo).
- **`send`** (`administrative-backups-route.ts`) — impõe o teto de 256 KiB na resposta serializada.

## Erros e casos de borda

- Lista vazia (nenhum alvo registrado) é uma resposta 200 válida com `targets: []`, não um erro.
- Qualquer query string, mesmo vazia (`?`), é rejeitada com 400 antes de tocar em autenticação.
- Não há paginação: se o catálogo de alvos crescesse a ponto de estourar 256 KiB serializados, a rota responderia 500 em vez de paginar ou truncar (mesmo padrão observado em outras rotas administrativas de listagem).
- Falha ao autenticar/autorizar nunca chega a consultar o catálogo — a ordem é sempre autenticação → autorização → auditoria → leitura.

## Observações

- Diferente da rota de evento histórico (`GET /admin/event-history`), esta listagem não tem nenhum parâmetro de paginação ou filtro — é sempre "todos os alvos", o que é aceitável hoje porque o número de alvos de backup tende a ser pequeno (configuração, não dados operacionais), mas não escala da mesma forma que `runs`.
