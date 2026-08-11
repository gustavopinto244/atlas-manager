# GET /admin/services/:serviceId/schedule

## Resumo

Lê o schedule (política de disponibilidade) atualmente salvo para um serviço registrado. É a rota de leitura "pura" — não simula nada, só devolve o estado persistido para o dashboard/CLI mostrar o que está configurado agora.

## Contrato

- **Método/path**: `GET /admin/services/:serviceId/schedule`
- **Registrada como dado** em `ADMINISTRATIVE_ROUTE_SECURITY_CATALOG` (`src/http/administrative-route-security-catalog.ts`), entrada `services.schedule.read`. O handler real é compartilhado com PUT e DELETE (mesmo `app.all`, dispatch por `request.method` dentro de `process`).
- **Ativação**: flag derivada `ADMINISTRATIVE_SERVICE_SCHEDULE_CAPABILITY`. Não é uma env var — a rota só é registrada quando, em `src/http/create-administrative-runtime.ts`, **as duas** condições abaixo são verdadeiras ao mesmo tempo: `config.administrativeServiceAvailabilityHttpEnabled === true` (env `ADMINISTRATIVE_SERVICE_AVAILABILITY_HTTP_ENABLED=true`) **e** `config.serviceAvailabilityPolicyFilePath !== undefined` (env `SERVICE_AVAILABILITY_POLICY_FILE` configurada). Sem as duas, `administrativeServiceSchedule` fica `undefined` em `create-app.ts` e a rota nem é montada.
- **Middlewares/segurança**: envelope administrativo (`createAdministrativeSecurityEnvelope`, checa Host/Origin/Sec-Fetch-*) aplicado a qualquer path `/admin*` em `create-app.ts`; dentro do handler, admissão de taxa (`dependencies.admission.tryAdmit()`, `FixedAdministrativeRequestAdmission` — janela de 60s, até 60 requisições, até 4 concorrentes, **compartilhada com todas as rotas administrativas**, não só schedule).
- **Autenticação**: obrigatória (`authenticationPolicy: "required"` no catálogo), resolvida via Cloudflare Access (`createCloudflareAccessAssertionReader`); permissão exigida: `services.availability.read` (mapeada a partir da operation `read_registered_service_schedule` por `permissionForAdministrativeOperation`).
- **Parâmetros de rota**: `serviceId` — validado por regex `^[a-z0-9]+(?:-[a-z0-9]+)*$` (minúsculas/dígitos com hífens simples). Se não bater, a rota responde `404 registered_service_not_found` — **não** `400` — mesmo sem consultar o repositório de serviços.
- **Query string**: não aceita nenhuma. `rejectAdministrativeQuery(request.url)` rejeita qualquer `?...` com `400 invalid_administrative_request`.
- **Corpo da requisição**: nenhum. `validateAdministrativeRequestHasNoBody` rejeita `Transfer-Encoding`, `Content-Length` diferente de `0`/ausente, ou `Content-Type` presente.
- **Resposta em caso de sucesso**: `200 application/json`, corpo devolvido por `getRegisteredServiceSchedule.execute(serviceId)`: `{ serviceId, policy: service.availabilityPolicy, observedAt }`.
- **Códigos de status possíveis**: `200` (sucesso), `404 registered_service_not_found` (serviceId malformado ou serviço inexistente), `414 uri_too_long` (URL > 4096 bytes), `400 invalid_administrative_request` (query presente), `401/403/503` (erros de acesso, ver mapeamento abaixo), `429 administrative_request_limited` (limite de admissão), `500 internal_error`.

## Caminho da requisição

- `src/http/administrative-route-security-catalog.ts` — `registerAdministrativeRoute` monta o path via `app.all(path, handler)`; o catálogo é só metadado (permissão, ativação, políticas) validado em runtime, não faz roteamento por método.
- `src/http/administrative-service-schedule-route.ts`, `createHandler` — encanamento: aplica headers de segurança, tenta admissão (`admission.tryAdmit()`), delega para `process`.
- `process` (mesmo arquivo) — encanamento de despacho: confere método (`405` se não for GET/PUT/DELETE), valida `serviceId` por regex, valida tamanho da URL, rejeita query string, monta `protectedAdministration` a partir do leitor de asserção Cloudflare Access.
- Para GET especificamente: `validateAdministrativeRequestHasNoBody` e então **a chamada de negócio real**: `protectedAdministration.getRegisteredServiceSchedule.execute(serviceId)`.
- `src/access-control/composition/create-protected-administration.ts` — é aqui que mora a lógica de negócio de verdade: autoriza a operação, busca o serviço via `listRegisteredServices.execute()`, lança erro se não encontrado, e retorna `{ serviceId, policy: service.availabilityPolicy, observedAt }`.
- `send(response, value)` (na rota) — serializa a resposta como JSON com status 200. Puro encanamento.

## Funções-chave

- **`process`** (`src/http/administrative-service-schedule-route.ts`) — decide o roteamento por verbo HTTP e valida a forma da requisição (serviceId, ausência de query, ausência de corpo). É encanamento, mas é o ponto que decide se a requisição sequer chega à camada de negócio.
- **`getRegisteredServiceSchedule.execute`** (implementação real em `create-protected-administration.ts`, em torno das linhas 626-639) — a função de negócio desta rota: localiza o serviço registrado e projeta seu `availabilityPolicy` como "schedule". Importa entender que ela não lê de um store de schedule separado — o schedule É o `availabilityPolicy` do serviço.
- **`mapAdministrativeAccessControlError`** (`src/http/administrative-http.ts`) — traduz erros de controle de acesso (`AdministrativeAccessControlError`) em respostas HTTP (`401`, `403`, `503` conforme o `code`).
- **`setAdministrativeSecurityHeaders`** (`src/http/administrative-http.ts`) — aplica os headers de dureza (`Cache-Control: no-store`, CSP restritiva, `X-Frame-Options: DENY` etc.) antes de qualquer outra coisa rodar.
- **`FixedAdministrativeRequestAdmission.tryAdmit`** (`src/http/administrative-request-admission.ts`) — controla a taxa/concorrência global de todas as rotas administrativas; se recusar, a rota nem chega a validar `serviceId`.

## Erros e casos de borda

- `serviceId` com maiúsculas, underscore, espaço ou hífen duplo/nas pontas → `404 registered_service_not_found` sem nunca consultar o repositório (a regex já barra antes).
- Serviço com `serviceId` válido no formato mas inexistente no repositório → `RegisteredServiceNotFoundError` mapeado para o mesmo `404 registered_service_not_found` pelo `mapError` da rota — a resposta HTTP é idêntica nos dois casos, então quem chama a API não distingue "formato inválido" de "não existe".
- Qualquer query string, mesmo vazia (`?`) → `400 invalid_administrative_request` via `rejectAdministrativeQuery`.
- URL muito longa (> 4096 bytes) → `414 uri_too_long`.
- Limite de admissão (rate limit global de 60/min ou 4 concorrentes) atingido → `429 administrative_request_limited` com `Retry-After: 1`.
- Erros de controle de acesso (`AdministrativeAccessControlError`) são mapeados por `mapAdministrativeAccessControlError`; qualquer código não reconhecido nesse mapeamento cai no fallback `403 administrative_access_denied` do `mapError` local.
- Qualquer outro erro não capturado nos `instanceof` de `mapError` vira `500 internal_error` — nenhum detalhe do erro original vaza na resposta.

## Observações

- **Operation divergente da declarada no catálogo**: o catálogo (`administrative-route-security-catalog.ts`) declara esta rota sob a operation `read_registered_service_schedule`. Mas a implementação real, em `create-protected-administration.ts` (linha ~628), autoriza e audita a chamada usando `runner.run("read_registered_service_availability", ...)` — uma operation **diferente**. A permissão resultante (`services.availability.read`) é a mesma nos dois casos, então o comportamento de autorização não muda, mas o rótulo usado em log/auditoria não corresponde ao nome da operation declarado no catálogo para esta rota. As variantes PUT, DELETE e `/preview` desta mesma rota estão todas corretamente alinhadas com suas operations declaradas — só o GET tem essa divergência.
