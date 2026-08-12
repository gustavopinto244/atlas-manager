# GET /admin/overview

## Resumo

Endpoint agregador: junta em um único JSON o estado operacional do Atlas — serviços registrados e seus estados, disponibilidade, postura de segurança de energia (`powerSafety`), plano/agenda da máquina, resumo de backups, saúde do host e flags de quais módulos administrativos estão habilitados. É o payload que alimenta a seção "Overview" do dashboard.

## Contrato

- **Método/path**: `GET /admin/overview` — routeId `operations.read` no catálogo (`src/http/administrative-route-security-catalog.ts`), `permission: "operations.read"`, `activationFlag: "ADMINISTRATIVE_OVERVIEW_HTTP_ENABLED"`.
- **Middlewares/autenticação**: envelope de segurança condicional (Host/Origin/Sec-Fetch) em `create-app.ts` para `/admin*`; registrada via `registerAdministrativeRoute(app, ["operations.read"], createHandler(...))` (`app.all`). Autenticação (Cloudflare Access) e autorização (`permission: operations.read`) acontecem dentro de `protectedAdministration.getOperationsOverview.execute()`, via `ExecuteProtectedAdministrativeOperation`.
- **Parâmetros de rota/query**: nenhum — query string é rejeitada.
- **Corpo da requisição**: nenhum aceito.
- **Resposta** (`200 OK`, `application/json`), formato aproximado:
  ```
  {
    application: { version },
    runtime: { loopbackBinding: true, configurationProfile: "mock-administrative" },
    server: { ...ServerHealthSnapshot serializado },
    services: { registered, <estado>: contagem... },
    availability: { <categoria>: contagem... },
    powerSafety: { ... },
    machinePlan: ... | null,
    machineSchedule: ...,
    backups: { registeredTargets, enabledTargets, scheduledTargets, activeRuns, interruptedRuns, lastSuccessfulAt, schedulerState },
    administration: { dashboardEnabled, serviceManagementEnabled, serviceAvailabilityEnabled, eventHistoryEnabled, overviewEnabled, wakeAlarmEnabled, shutdownEnabled }
  }
  ```
- **Códigos de status possíveis**: `200` · `404 route_not_found` (path diferente de `/admin/overview`, checagem manual dentro do handler) · `405 method_not_allowed` · `400 invalid_administrative_request` · `414 uri_too_long` · `401`/`403`/`503` de autenticação/autorização · `429 administrative_request_limited` · `500 internal_error` (payload serializado excede 262.144 bytes) · `503 administrative_overview_unavailable` (fallback genérico).

## Caminho da requisição

- `src/http/create-app.ts` + `registerAdministrativeRoute` — mesmo encanamento de roteamento das demais rotas administrativas.
- `createHandler` (`src/http/administrative-overview-route.ts`) — aplica headers de segurança, tenta admitir via rate limiter (`admission.tryAdmit()`), e delega para `process`.
- `process` (mesmo arquivo) — valida: `request.path` bate exatamente com `/admin/overview` (checagem redundante ao roteamento, mas explícita), método é GET, tamanho do request-target, ausência de query e de body. Tudo isso é encanamento/validação.
- **Lógica de negócio real, parte 1 (autorização)**: `dependencies.createProtectedAdministration(reader)` monta a fachada autenticada; chamar `.getOperationsOverview.execute()` dispara o gate de autenticação/autorização.
- **Lógica de negócio real, parte 2 (agregação)**: dentro de `getOperationsOverview.execute` (`src/access-control/composition/create-protected-administration.ts`, função `getOperationsOverview`), o código busca a lista de serviços registrados, lê o estado de cada um (`readService`), soma contagens por `state` e `effectiveAvailability`, busca runs e targets de backup (se `input.backupManagement` estiver configurado), lê a postura de segurança de energia (`input.powerSafetyReader`) e o plano/agenda da máquina. **Esta é a única função do escopo que de fato agrega dados de vários subsistemas** — o restante do fluxo é validação/roteamento.
- De volta em `process` (`administrative-overview-route.ts`) — roda em paralelo (`Promise.all`) a chamada acima com `dependencies.getServerHealth.execute()` (mesma capability usada por `/health/server`), depois monta o objeto final combinando `application`, `runtime`, `server`, o retorno de `operations` (espalhado via spread) e um bloco `administration` com flags booleanas — algumas fixas (`dashboardEnabled: true` sempre) e outras vindas de `dependencies.administration` (`wakeAlarmEnabled`/`shutdownEnabled`).
- `send` (mesmo arquivo) — serializa com `JSON.stringify`, valida que o tamanho não passa de 262.144 bytes, e escreve a resposta manualmente (não usa `response.json()`).

## Funções-chave

- **`process`** (`src/http/administrative-overview-route.ts`) — orquestra a rota: valida a requisição, dispara autenticação/autorização, busca saúde do servidor em paralelo, e monta o payload final combinando várias fontes.
- **`getOperationsOverview` (closure `execute`)** (`src/access-control/composition/create-protected-administration.ts`, por volta da linha 979) — a função que efetivamente agrega dados de negócio: contagens de serviços por estado/disponibilidade, métricas de backup, postura de energia e agenda de máquina. É a peça mais importante para entender "de onde vêm os números" desta rota.
- **`ExecuteProtectedAdministrativeOperation.run`** (usado via `runner.run("read_operations_overview", ...)` dentro de `create-protected-administration.ts`) — é quem efetivamente chama autenticação (`authenticateAdministrativeRequest`) e autorização (`authorizeAdministrativeOperation`) e registra auditoria antes de rodar a lógica de agregação.
- **`GetServerHealth.execute`** (`src/server-health/application/get-server-health.ts`) — reaproveitado aqui para preencher o campo `server`; mesma cadeia descrita em `study/get-health-server.md`.
- **`send`** (`src/http/administrative-overview-route.ts`) — decide o limite de tamanho de resposta (262.144 bytes) e serializa manualmente; é a única rota do lote com esse teto explícito de payload.

## Erros e casos de borda

- `request.path !== "/admin/overview"` → `404 route_not_found` (checagem defensiva dentro do handler, mesmo que o Express já tenha roteado por esse path exato — não deveria disparar em uso normal).
- Método diferente de GET → `405 method_not_allowed`.
- Query string presente ou body presente → `400 invalid_administrative_request`.
- Request-target grande demais → `414 uri_too_long`.
- Payload serializado maior que 262.144 bytes → `500 internal_error` (não há um código de erro mais específico para esse caso — cai no bucket genérico).
- Falha de autenticação/autorização → `401`/`403`/`503`, mapeada por `mapAdministrativeAccessControlError`.
- Rate limit da rota → `429 administrative_request_limited`.
- Qualquer erro não reconhecido → `503 administrative_overview_unavailable` (fallback de `mapError`).
- Se `input.backupManagement` não estiver configurado, o bloco `backups` cai para valores zerados e `schedulerState: "disabled"`, em vez de omitir o bloco — a resposta sempre tem a mesma forma.
- Se `input.powerSafetyReader` não estiver configurado, `powerSafety` cai para um objeto mock fixo (`backend: "mock", effects: "disabled", ...`) em vez de omitir o campo.

## Observações

- O campo `runtime.configurationProfile` está **hardcoded como `"mock-administrative"`** em `process` (`administrative-overview-route.ts`), independente da configuração real do ambiente. Da mesma forma, `runtime.loopbackBinding: true` é sempre `true`. Vale confirmar se isso é proposital (valor histórico/placeholder) ou um resquício que deveria refletir configuração real.
- No bloco `administration` da resposta, `dashboardEnabled`, `serviceManagementEnabled`, `serviceAvailabilityEnabled`, `eventHistoryEnabled` e `overviewEnabled` são sempre `true`, não checando de fato se essas rotas foram registradas (via `administrativeDashboard`, `administrativeServices` etc. em `create-app.ts`). Só `wakeAlarmEnabled`/`shutdownEnabled` refletem a configuração injetada (`dependencies.administration`). Isso pode divergir da realidade se algum desses módulos estiver desabilitado por flag de ativação — a resposta afirmaria que está habilitado mesmo quando não está.
- A checagem `if (request.path !== ADMINISTRATIVE_OVERVIEW_ROUTE)` dentro do handler é redundante com o roteamento do Express (a rota só é chamada para esse path exato via `app.all(path, handler)| trecho do catálogo), mas não é incorreta — é defesa em profundidade.
