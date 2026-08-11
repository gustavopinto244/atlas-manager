# GET / (dashboard shell)

## Resumo

Serve o HTML "casca" (shell) do dashboard administrativo — a página estática que carrega `app.js`/`styles.css` e monta as seções (Overview, Services, Schedules, Machine, Backups, Events) que o JS do front-end preenche depois via chamadas às APIs `/admin/*`. Existe para dar um ponto de entrada único e sempre igual à interface administrativa.

## Contrato

- **Método/path**: `GET /` — routeId `dashboard.read` no catálogo (`src/http/administrative-route-security-catalog.ts`).
- **Middlewares/autenticação**:
  - `createAdministrativeSecurityEnvelope` (`src/http/administrative-security-envelope.ts`), aplicado em `create-app.ts` a `/`, `/assets/*` e `/admin*` quando `administrativePublicOrigin` está configurado — valida Host, Origin e headers `Sec-Fetch-*`.
  - Registrada via `registerAdministrativeRoute(app, ["dashboard.read"], createShellHandler(...))`, que usa `app.all("/", handler)` — o handler dispacha o método manualmente.
  - `authenticationPolicy: "required"` no catálogo, `permission: "dashboard.read"`, `activationFlag: "ADMINISTRATIVE_DASHBOARD_ENABLED"`. A autenticação de fato (Cloudflare Access) e a checagem de permissão acontecem dentro de `getAdministrativeDashboard.execute()` (via `ExecuteProtectedAdministrativeOperation`, em `src/access-control/composition/create-protected-administration.ts`), não no arquivo da rota.
  - `confirmationPolicy: "none"`, `gatePolicy: "none"` — é leitura, sem gate de confirmação.
- **Parâmetros de rota/query**: nenhum parâmetro de rota; query string não é aceita (`rejectAdministrativeQuery` rejeita qualquer `?`).
- **Corpo da requisição**: nenhum body aceito (`validateAdministrativeRequestHasNoBody` rejeita `Content-Length`, `Transfer-Encoding` ou `Content-Type` presentes).
- **Resposta**: `200 OK`, `Content-Type: text/html`, corpo é a constante `HTML` montada em `src/http/administrative-dashboard-route.ts`.
- **Códigos de status possíveis**: `200` sucesso · `405 method_not_allowed` (método ≠ GET) · `414 uri_too_long` · `400 invalid_administrative_request` (query string ou body presentes) · `401`/`403`/`503` vindos de `mapAdministrativeAccessControlError` (autenticação/autorização falha) · `429 administrative_request_limited` (limite de admissão) · `503 administrative_dashboard_unavailable` (erro não mapeado) · `404 route_not_found` (se o path/asset não bater, não se aplica diretamente a `/`).

## Caminho da requisição

- `src/http/create-app.ts` — instala o envelope de segurança (Host/Origin/Sec-Fetch) condicionalmente e chama `registerAdministrativeDashboardRoutes`. Puro encanamento de montagem do app.
- `src/http/administrative-route-security-catalog.ts::registerAdministrativeRoute` — resolve o descriptor pelo routeId, garante que não há duplicidade e registra `app.all(path, handler)`. Encanamento/infraestrutura de roteamento — não decide nada de negócio.
- `src/http/administrative-dashboard-route.ts::createAdmissionHandler` — aplica headers de segurança + CSP específica do dashboard, tenta admitir a requisição via rate limiter (`dependencies.admission.tryAdmit()`), e só então chama `process`. Encanamento (throttling + headers), não lógica de domínio.
- `createShellHandler` → `process` (mesmo arquivo) — valida método GET, tamanho do request-target, ausência de query e de body — tudo encanamento/validação.
- **Aqui está a lógica de negócio de verdade**: `dependencies.createProtectedAdministration(reader).getAdministrativeDashboard.execute()` — dispara autenticação via Cloudflare Access (`createCloudflareAccessAssertionReader`) e autorização (`permission: dashboard.read`) dentro de `ExecuteProtectedAdministrativeOperation` (`src/access-control/composition/create-protected-administration.ts`). Se essa chamada falhar, nada é servido.
- De volta em `process` — se a chamada acima não lançar, `response.type("html").send(HTML)` devolve o shell estático. Note que o **resultado** de `getAdministrativeDashboard.execute()` é descartado (não é usado para montar o HTML) — a chamada serve só como gate de autenticação/autorização/auditoria.

## Funções-chave

- **`createShellHandler`** (`src/http/administrative-dashboard-route.ts`) — decide o fluxo desta rota especificamente: valida método/alvo/query/body, invoca o gate de autorização, e serve o HTML fixo. É a função central para entender esta rota.
- **`createAdmissionHandler`** (mesmo arquivo) — compartilhada com `createAssetHandler`; decide os headers de segurança (inclusive uma CSP `default-src 'none'` própria do dashboard, mais restrita que a genérica), aplica rate limiting via `admission.tryAdmit()`/`release`, e traduz qualquer exceção em `HttpError` via `mapError`.
- **`getAdministrativeDashboard.execute`** (`src/access-control/composition/create-protected-administration.ts`, não lido em detalhe, mas é o consumidor real) — é onde autenticação (Cloudflare Access) e autorização (`permission: dashboard.read`) de fato acontecem, além do registro de auditoria. É a peça que transforma esta rota de "servir HTML estático" em "servir HTML estático só para quem tem acesso administrativo".
- **`HTML`/`SECTIONS`/`TOPBAR` (constantes)** (mesmo arquivo) — montam o shell HTML. Importa saber que a estrutura tem contratos rígidos documentados em comentário: cada `<section>` precisa continuar filho direto de `<main>`, e ids são consumidos por `src/dashboard/*.ts` no client.
- **`mapError`** (mesmo arquivo) — traduz qualquer erro não-`HttpError` (tipicamente falha de auth) em `503 administrative_dashboard_unavailable`, usando `mapAdministrativeAccessControlError` para os casos conhecidos (401/403/503).

## Erros e casos de borda

- Método diferente de GET → `405 method_not_allowed` com header `Allow: GET` (tratado manualmente dentro do handler, já que `app.all` aceita qualquer verbo).
- Qualquer query string (`?...`) → `400 invalid_administrative_request`, mesmo que vazia (`?` sozinho já rejeita).
- Qualquer corpo, mesmo `Content-Length: 0` sem ser exatamente `"0"`, ou `Content-Type` presente → `400 invalid_administrative_request`.
- `request-target` maior que 4096 bytes → `414 uri_too_long`.
- Rate limit da rota (`admission.tryAdmit()`) esgotado → `429 administrative_request_limited` com `Retry-After: 1`.
- Falha de autenticação Cloudflare Access → `401 administrative_authentication_required`; falha de autorização → `403 administrative_authorization_denied`; identidade indisponível ou auditoria indisponível → `503`.
- Qualquer outro erro não reconhecido → `503 administrative_dashboard_unavailable` (fallback genérico em `mapError`).
- O envelope de segurança (`createAdministrativeSecurityEnvelope`) só é aplicado se `administrativePublicOrigin` estiver configurado; sem ele, os checks de Host/Origin/Sec-Fetch não rodam — a rota confia inteiramente na validação feita dentro do handler + na camada de autenticação.

## Observações

- O resultado de `getAdministrativeDashboard.execute()` é descartado — a chamada existe só para gatear autenticação/autorização/auditoria, não para montar o HTML (que é 100% estático). Isso é intencional (o HTML não varia por usuário), mas pode confundir quem espera que o handler use o retorno.
- A CSP aplicada em `createAdmissionHandler` (`default-src 'none'; script-src 'self'; ...`) sobrescreve a CSP mais genérica já setada por `setAdministrativeSecurityHeaders` (`default-src 'none'; frame-ancestors 'none'; base-uri 'none'`), já que `response.setHeader` substitui o valor anterior — não há duplicidade de header, mas vale notar a ordem de chamadas dentro de `createAdmissionHandler`.
