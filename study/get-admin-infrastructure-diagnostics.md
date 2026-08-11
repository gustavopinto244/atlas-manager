# GET /admin/infrastructure/diagnostics

## Resumo

Roda uma bateria de checagens de infraestrutura do host (serviço systemd do atlas, saúde do processo, PM2, listener TCP, cursores de agendadores, nginx, túnel cloudflared etc.) e devolve um relatório agregado. Existe para diagnóstico operacional rápido — "o que no host está `ok`/`degraded`/`down`/`disabled`/`unavailable`" — sem precisar entrar via SSH e rodar comandos manualmente.

## Contrato

- **Método/Path**: `GET /admin/infrastructure/diagnostics`.
- **Arquivo de registro**: `src/http/administrative-infrastructure-diagnostics-route.ts` (`registerAdministrativeInfrastructureDiagnosticsRoute` → `handler`), catalogado como `infrastructure.diagnostics.read` (operação `read_infrastructure_diagnostics`, permissão `infrastructure.diagnostics.read`, activationFlag `ADMINISTRATIVE_INFRASTRUCTURE_DIAGNOSTICS_HTTP_ENABLED`). Arquivo próprio, não compartilha `administrative-backups-route.ts`.
- **Middlewares em `/admin*`**: envelope de segurança.
- **Autenticação/Autorização**: Cloudflare Access + permissão `infrastructure.diagnostics.read` — role: `administrator` (a única listada com esta permissão em `ADMINISTRATIVE_ROLE_PERMISSIONS`).
- **Parâmetros de rota**: nenhum.
- **Query string**: não aceita.
- **Corpo da requisição**: não aceito.
- **Formato da resposta** (200, `application/json`, teto de 64 KiB): `{ generatedAt: string, overallStatus: "ok"|"degraded"|"down"|"disabled"|"unavailable", checks: [ { id, status, observed?, expected?, errorCode?, hint?, requiresPrivilege?, observedAt }, ... ] }` — ver Funções-chave para a lista de `id`s possíveis.
- **Códigos de status possíveis**:
  - `200` — sempre que a rota consegue *gerar* o relatório, mesmo que várias checagens individuais estejam `down`/`unavailable`/`degraded` (ver Erros e casos de borda — um 5xx aqui é reservado para a rota não conseguir responder de jeito nenhum, nunca para uma checagem falhar).
  - `400 invalid_administrative_request` — query ou corpo presente.
  - `401 administrative_authentication_required` / `503 administrative_identity_unavailable`.
  - `403 administrative_authorization_denied`.
  - `405 method_not_allowed`.
  - `414 uri_too_long`.
  - `429 administrative_request_limited`.
  - `500 internal_error` — resposta acima de 64 KiB.
  - `503 administrative_infrastructure_diagnostics_unavailable` — fallback genérico (inclui `infrastructureDiagnosticsReader` não configurado na composição).
  - `503 administrative_authorization_unavailable` / `authorization_audit_unavailable`.

## Caminho da requisição

- `handler(dependencies)` (`administrative-infrastructure-diagnostics-route.ts`) — headers de segurança, `admission.tryAdmit()` (429 se recusado).
- IIFE assíncrona: exige `GET`, valida tamanho da URL, rejeita query, valida ausência de corpo.
- **Aqui está a lógica de negócio de verdade**, em camadas:
  1. `dependencies.createProtectedAdministration(reader).getInfrastructureDiagnostics.execute()` — capacidade implementada em `src/access-control/composition/create-protected-administration.ts` (linhas ~436-445): passa por `runner.run("read_infrastructure_diagnostics", ...)` (autentica/autoriza/audita) e então invoca `input.infrastructureDiagnosticsReader.execute()`.
  2. O `infrastructureDiagnosticsReader` real vem de `createInfrastructureDiagnosticsRuntime` (`src/infrastructure-diagnostics/composition/create-infrastructure-diagnostics-runtime.ts`), construído em `src/http/create-administrative-runtime.ts` com os adaptadores de host (`NodeSystemctlUnitStateReader`, `NodeTcpListenerReader`, `NodeNginxConfigTestRunner`, `NodePm2ProcessListExecutor`) e os leitores de cursor de cada agendador (backup, power, service-availability-reconciliation) e do event history, todos opcionais conforme o que está configurado na instância.
  3. `getInfrastructureDiagnostics.execute` chama `buildInfrastructureDiagnosticReport(sources)` (`src/infrastructure-diagnostics/application/build-infrastructure-diagnostic-report.ts`) — a função que de fato roda as **13 checagens** (ver Funções-chave), cada uma isolada por um `probe()` que captura qualquer exceção (síncrona ou assíncrona) e a converte em `status: "unavailable"` em vez de propagar; uma fonte nunca composta na instância (por exemplo, nenhum arquivo de cursor de agendador configurado) reporta `status: "disabled"`, não `"down"`. Todas as 13 checagens rodam em paralelo (`Promise.all`), então a função inteira sempre resolve — nunca rejeita por causa de uma checagem individual.
  4. O relatório final é ordenado de forma determinística (`orderDiagnosticChecks`, `CHECK_ORDER` fixo) e o `overallStatus` é derivado por `deriveOverallStatus`: pior status entre as checagens **não-`disabled`** (`down` > `unavailable` > `degraded` > `ok`); se todas estiverem `disabled`, o relatório inteiro é `disabled`. Checagens desabilitadas intencionalmente nunca fazem o relatório parecer não saudável.
- De volta ao HTTP: serializa, garante teto de 64 KiB, responde 200.
- `mapError()` traduz erros não-`HttpError`/não-`AdministrativeAccessControlError` para `503 administrative_infrastructure_diagnostics_unavailable` — mas, como cada checagem já captura sua própria falha internamente, este caminho só é alcançado se a orquestração em si (não uma checagem) falhar, ou se autenticação/autorização falhar antes.

## Funções-chave

- **`buildInfrastructureDiagnosticReport`** (`src/infrastructure-diagnostics/application/build-infrastructure-diagnostic-report.ts`) — orquestra as 13 checagens em paralelo, isola falhas por checagem via `probe()`, monta o relatório final. É o coração de toda a rota.
- **As 13 checagens** (`CHECK_ORDER`, `src/infrastructure-diagnostics/domain/check-ids.ts`), na ordem de emissão: `atlas.service` (estado systemd do serviço atlas-manager), `atlas.health.live` (processo respondendo), `atlas.health.server` (memória/disco via `serverHealthReader`, `degraded` acima de ~90-95% de uso), `pm2.process` (lista de processos PM2 e contagem online), `listener.atlas` (listener TCP na porta/binding configurados), `scheduler.backup` (cursor do agendador de backups legível), `scheduler.power` (cursor do agendador de energia), `scheduler.service_availability` (cursor do reconciliador de disponibilidade de serviços), `event_history.readiness` (armazenamento de histórico de eventos pronto), `power.posture` (backend de efeitos de energia — `disabled` é tratado como calmo, não como falha), `nginx.service` (estado systemd do nginx), `nginx.config` (resultado de `nginx -t`, roda a cada chamada — ver Observações), `tunnel.cloudflared.service` (estado systemd do cloudflared).
- **`probe`** (interno a `build-infrastructure-diagnostic-report.ts`) — a função que garante o isolamento: qualquer exceção de uma checagem individual vira `status: "unavailable"` em vez de derrubar a resposta inteira. É a decisão de design mais importante desta rota (documentada no próprio comentário do handler HTTP).
- **`deriveOverallStatus`** (`src/infrastructure-diagnostics/domain/diagnostic-report.ts`) — decide o `overallStatus` agregando o pior status entre as checagens não-desabilitadas, com `unavailable` propositalmente classificado como "menos grave" que `down` (não saber não pode soar mais alto que "está quebrado").
- **`orderDiagnosticChecks`** (mesmo arquivo) — garante ordem de emissão determinística e estável, independente da ordem em que as 13 promessas resolvem.

## Erros e casos de borda

- Uma checagem individual falhando (por exemplo, `systemctl` não encontrado, timeout, permissão negada) nunca produz um erro HTTP — vira uma entrada `status: "unavailable"` dentro de uma resposta 200. Um 5xx nesta rota significa "não consegui nem montar o relatório", não "algo no host está com problema".
- Uma capacidade nunca configurada nesta instância (por exemplo, nenhum arquivo de cursor de agendador de power) aparece como `status: "disabled"`, e é excluída do cálculo de `overallStatus` — não conta como degradação.
- `nginx.config` roda um `nginx -t` real a cada chamada desta rota — o comentário no handler HTTP explica que isso é aceitável porque a página de infraestrutura não está no conjunto de auto-poll de 30s do dashboard, só dispara em chamada manual/CLI.
- Não há paginação nem filtro por `id` — a resposta sempre traz as 13 checagens (ou o subconjunto habilitado), mesmo que o operador só queira uma.

## Observações

- **O comentário no próprio código está desatualizado**: `src/http/administrative-infrastructure-diagnostics-route.ts` comenta "e esconderia as onze checagens que tiveram sucesso" (tradução), mas `CHECK_ORDER` em `src/infrastructure-diagnostics/domain/check-ids.ts` lista **13** identificadores de checagem, não 11. Vale confirmar se o comentário só ficou desatualizado depois que checagens foram adicionadas, ou se há alguma condição em que só 11 rodam de fato.
- O teto de resposta desta rota (64 KiB) é igual ao de `GET /admin/security/status` e menor que o das rotas de backup (256 KiB), reforçando que não há um padrão central único de teto de resposta entre as rotas administrativas.
- Só a role `administrator` tem `infrastructure.diagnostics.read` em `ADMINISTRATIVE_ROLE_PERMISSIONS` (`src/access-control/domain/administrative-operation.ts`) — nem `auditor` nem `audit_operator` têm acesso a esta rota, diferente de `security.posture.read`, que ambos possuem.
