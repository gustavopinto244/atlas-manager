# GET /health/live

## Resumo

Endpoint de liveness: responde `{ "status": "ok" }` se o processo Node está de pé e o Express consegue atender uma request. Existe para health checks locais (systemd, supervisor, curl manual) confirmarem que o processo não travou, sem depender de nenhum subsistema (banco, sistema de arquivos etc.).

## Contrato

- **Método/path**: `GET /health/live`
- **Middlewares**: apenas `healthHeaders` (função inline em `src/http/create-app.ts` que chama `setAdministrativeSecurityHeaders`). NÃO passa pelo `createAdministrativeSecurityEnvelope` (verificação de Host/Origin/Sec-Fetch-*) nem pelo catálogo administrativo — é registrada diretamente com `app.get(...)`.
- **Autenticação**: nenhuma. Deliberadamente pública/sem verificação, conforme comentário no próprio `create-app.ts` — o processo depende de estar em loopback para ser seguro.
- **Parâmetros de rota/query**: nenhum.
- **Corpo da requisição**: nenhum (GET, sem body esperado; não há validação de body).
- **Resposta**: `200 OK`, JSON `{ "status": "ok" }`. Sempre esse status — não há caminho de erro no handler.
- **Headers**: os mesmos headers de dureza administrativa (`Cache-Control: no-store, private`, `X-Content-Type-Options`, `X-Frame-Options: DENY`, CSP restritiva, `X-Atlas-Request-ID` etc.), aplicados via `setAdministrativeSecurityHeaders` (`src/http/administrative-http.ts`).

## Caminho da requisição

- `src/http/create-app.ts` — registro direto via `app.get("/health/live", healthHeaders, handler)`. É pura fiação: não há delegação a nenhuma camada de aplicação/domínio.
- `healthHeaders` (inline, mesmo arquivo) — aplica os headers de segurança antes do handler rodar.
- Handler inline (mesmo arquivo) — `response.status(200).json({ status: "ok" })`. Não há lógica de negócio nenhuma nessa rota; é só um sinal de vida do processo.

## Funções-chave

- **`createApp`** (`src/http/create-app.ts`) — é quem registra a rota diretamente com `app.get`, fora do catálogo administrativo. Importa entender porque explica por que essa rota não tem autenticação nem o envelope de segurança que as rotas `/admin/*` têm.
- **`setAdministrativeSecurityHeaders`** (`src/http/administrative-http.ts`) — aplica os headers de dureza HTTP. É a única coisa "real" que acontece antes de responder.

## Erros e casos de borda

- Não há nenhum caminho de erro no handler: qualquer requisição GET válida recebe `200`.
- Método diferente de GET nesse path cai no `notFoundHandler` (`src/http/middleware/not-found.js`), que devolve `404 route_not_found` via `createErrorHandler`, pois o Express só registrou o verbo GET (não usa `app.all`).
- Não há tratamento de rate limit, autenticação ou validação de corpo — está fora do escopo dessa rota por design.

## Observações

- Nenhuma inconsistência notada; o comentário em `create-app.ts` já documenta explicitamente por que a rota é deliberadamente pública e sem o envelope administrativo (ver bloco de comentário logo acima do registro das rotas `/health/*`).
