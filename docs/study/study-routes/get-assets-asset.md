# GET /assets/:asset

## Resumo

Serve os dois arquivos estáticos que o shell do dashboard (`GET /`) referencia: `app.js` (o JS do painel) e `styles.css`. Existe para não depender de um servidor de arquivos estáticos separado — os assets do dashboard são servidos pela mesma rota administrativa autenticada.

## Contrato

- **Método/path**: `GET /assets/:asset` — routeId `dashboard.asset.read` no catálogo, mesmo arquivo de código-fonte de `GET /` (`src/http/administrative-dashboard-route.ts`), mas função diferente (`createAssetHandler`).
- **Middlewares/autenticação**: idêntico à rota `/` — envelope de segurança condicional em `create-app.ts`, `registerAdministrativeRoute(app, ["dashboard.asset.read"], createAssetHandler(...))` via `app.all("/assets/:asset", handler)`, `permission: "dashboard.asset.read"`, `activationFlag: "ADMINISTRATIVE_DASHBOARD_ENABLED"` (mesma flag da rota shell — as duas sobem/descem juntas), `authenticationPolicy: "required"`. A autenticação/autorização real também acontece dentro de `getAdministrativeDashboard.execute()` — **a mesma capability usada pela rota `/`**, não uma capability específica de assets.
- **Parâmetros de rota**: `:asset` — só dois valores são aceitos: `"app.js"` e `"styles.css"` (chaves de `SERVED_ASSETS`). Qualquer outro valor é 404.
- **Parâmetros de query**: nenhum aceito.
- **Corpo da requisição**: nenhum aceito.
- **Resposta**: `200 OK`, `Content-Type: application/javascript` (para `app.js`) ou `text/css` (para `styles.css`), corpo é o conteúdo lido do arquivo fonte em disco.
- **Códigos de status possíveis**: `200` · `404 route_not_found` (asset não reconhecido) · `405 method_not_allowed` · `400 invalid_administrative_request` · `414 uri_too_long` · `401`/`403`/`503` de autenticação/autorização · `429 administrative_request_limited` · `503 administrative_dashboard_unavailable`.

## Caminho da requisição

- `src/http/create-app.ts` / `registerAdministrativeRoute` — mesmo encanamento de montagem descrito em `study/get-root.md`.
- `createAssetHandler` → `process` (`src/http/administrative-dashboard-route.ts`) — valida método GET, request-target, ausência de query e body (mesma validação de `createShellHandler`).
- Diferença central em relação à rota `/`: `const asset = request.params.asset; if (typeof asset !== "string" || !Object.hasOwn(SERVED_ASSETS, asset)) throw new HttpError(404, ...)`. Essa checagem de whitelist é o que restringe a rota a exatamente dois arquivos — puro encanamento/validação, mas é a lógica que decide "esse asset existe ou não".
- **Lógica de negócio real**: mesma chamada de `dependencies.createProtectedAdministration(reader).getAdministrativeDashboard.execute()` usada pela rota `/` — autenticação e autorização acontecem aqui, antes de servir o arquivo.
- De volta em `process` — `response.type(value.type).send(value.body)`, onde `value` vem de `SERVED_ASSETS[asset]`, cujo conteúdo já foi lido do disco **uma vez, na inicialização do módulo** (não a cada requisição).

## Funções-chave

- **`createAssetHandler`** (`src/http/administrative-dashboard-route.ts`) — a função central desta rota; a única diferença estrutural em relação a `createShellHandler` é a checagem de whitelist do parâmetro `:asset` e o uso de `SERVED_ASSETS` em vez do `HTML` fixo.
- **`SERVED_ASSETS`** (mesmo arquivo, nível de módulo) — mapa congelado (`Object.freeze`) com os dois assets permitidos e seus `type` MIME. É montado uma única vez no carregamento do módulo, chamando `readDashboardSource`.
- **`readDashboardSource`** (mesmo arquivo) — lê o arquivo de `src/dashboard/<nome>` do disco, tentando primeiro a versão TypeScript (`main.ts`) e depois o fallback JS compilado (`main.js`/`styles.css`), síncrono via `readFileSync`. Se nenhum dos dois existir, lança erro na inicialização do processo (não por requisição) — `dashboard_asset_source_unavailable`.
- **`createAdmissionHandler`** (mesmo arquivo, compartilhada com a rota shell) — aplica headers de segurança/CSP e rate limiting antes de chamar `process`.
- **`getAdministrativeDashboard.execute`** (`src/access-control/composition/create-protected-administration.ts`) — mesma capability de autenticação/autorização usada pela rota shell; aqui também o retorno é descartado, servindo só de gate.

## Erros e casos de borda

- `:asset` fora da whitelist (ex.: `/assets/favicon.ico`, `/assets/app.js.map`) → `404 route_not_found`.
- Mesmas validações de método/query/body/tamanho de target da rota `/`, com os mesmos códigos (`405`, `400`, `414`).
- Falhas de autenticação/autorização seguem o mesmo mapeamento (`401`/`403`/`503`) e o mesmo rate limiter compartilhado (`429`).
- Os arquivos são lidos do disco **uma única vez, no boot do processo** (import-time). Se o arquivo em disco mudar depois (ex.: deploy sem reiniciar o processo), a rota continua servindo o conteúdo antigo em memória — não há recarregamento por requisição.
- Não há suporte a `ETag`/`If-None-Match`/cache condicional: cada requisição bem-sucedida reenvia o corpo inteiro, e `Cache-Control: no-store, private` (de `setAdministrativeSecurityHeaders`) impede qualquer cache no cliente — aceitável para o volume baixo de tráfego administrativo, mas note que os assets nunca são cacheados apesar de serem estáticos.

## Observações

- `dashboard.asset.read` é uma permissão separada de `dashboard.read` no catálogo, mas na prática ambas as rotas chamam exatamente a mesma capability (`getAdministrativeDashboard.execute()`) para autenticar/autorizar — não existe uma capability `getAdministrativeDashboardAsset` distinta. Ou seja, a separação de permissão existe só a nível de catálogo/routeId; o gate de autorização de fato não diferencia "ler o shell" de "ler um asset".
- `readDashboardSource` engolindo o erro do primeiro `readFileSync` (bloco `catch { /* comentário */ }`) e só lançando se ambos os caminhos falharem é uma escolha correta e documentada, não um bug — mas vale saber que uma falha de permissão de arquivo (não "arquivo não existe") no primeiro caminho também seria silenciosamente ignorada antes de tentar o fallback.
