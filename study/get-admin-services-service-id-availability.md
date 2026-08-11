# GET /admin/services/:serviceId/availability

## Resumo

Lê a política de disponibilidade agendada de um serviço (quando ele deve estar disponível) junto com sua disponibilidade efetiva atual e um eventual override manual em vigor. É a leitura de estado que antecede qualquer decisão de `PUT`/`DELETE` nesta mesma rota.

## Contrato

- **Método**: GET (esta rota também atende PUT e DELETE — ver documentos irmãos; método é dispachado dentro do mesmo handler)
- **Path**: `/admin/services/:serviceId/availability`
- **Parâmetro de rota**: `serviceId`, validado por `isServiceId` (mesma regra das demais rotas de serviço).
- **Query string**: não aceita.
- **Autenticação**: Cloudflare Access, obrigatória.
- **Permissão**: `services.availability.read` (operação `read_registered_service_availability`).
- **Corpo da requisição**: nenhum.
- **Formato da resposta** (200): `{ serviceId, policy, effectiveAvailability, observedAt, override }`, montado por `mapAdministrativeAvailability` (`src/http/administrative-service-response.ts`). `policy` é normalizado por `mapPolicy` (achata para `{ mode }` ou, se `mode === "scheduled"`, `{ mode, timezone, windows: [{weekday, start, end}, ...] }`). `override` é `null` ou `{ kind, expiresAt }`.
- **Códigos de status possíveis**: 200, 400 (target/corpo/query inválido), 401/403/503 (acesso), 404 (`registered_service_not_found`/`route_not_found`), 405 (só quando o método não é GET/PUT/DELETE), 429, 503 (`service_availability_unavailable` / `administrative_service_management_unavailable`).

## Caminho da requisição

- Registrada em `registerAdministrativeServiceAvailabilityRoutes` (`src/http/administrative-service-availability-route.ts`) com `registerAdministrativeRoute(app, ["services.availability.read", "services.availability.update", "services.availability.delete"], createAvailabilityHandler(dependencies))` — as três operações (GET/PUT/DELETE) compartilham o mesmo path e o mesmo handler Express, mas têm entradas de catálogo separadas (permissões e políticas de confirmação diferentes).
- `createAvailabilityHandler` monta o encanamento de admissão (headers de segurança, rate limit) e delega para `processAvailability`.
- `processAvailability` (`src/http/administrative-service-availability-route.ts`) valida `serviceId`, valida o alvo/URL, rejeita query string, e só então olha o método: se `GET`, valida ausência de corpo e chama a leitura; senão, segue para o fluxo de mutação (documentado nos arquivos de PUT/DELETE).
- Para GET, a chamada de negócio é `protectedAdministration.getRegisteredServiceAvailability.execute(serviceId)`, construída em `src/access-control/composition/create-protected-administration.ts`. É aqui que mora a lógica real: busca o serviço na lista completa para confirmar que existe, e chama `getRegisteredServiceEffectiveAvailability.executeWithOverride(serviceId)` para obter a expectativa de disponibilidade e o override vigente.
- `mapAdministrativeAvailability` (encanamento de serialização) formata o resultado para a resposta pública.

## Funções-chave

- **`processAvailability`** (`src/http/administrative-service-availability-route.ts`) — o dispatcher central desta rota: decide se é leitura (GET) ou mutação (PUT/DELETE) e aplica as validações de forma adequadas a cada caminho. É compartilhado pelos três métodos HTTP desta rota.
- **`getRegisteredServiceAvailability.execute`** (interno a `create-protected-administration.ts`) — busca o serviço, chama `getRegisteredServiceEffectiveAvailability.executeWithOverride(serviceId)` e monta `{ serviceId, policy, effectiveAvailability: availability.expectation, override: availability.override, observedAt }`. É a lógica de negócio real desta leitura — decide o que "disponibilidade efetiva com override" significa.
- **`mapAdministrativeAvailability`** e **`mapPolicy`** (`src/http/administrative-service-response.ts`) — normalizam a política de disponibilidade para um formato de resposta estável, extraindo apenas os campos relevantes de acordo com o `mode` (`disabled`/`manual` vs `scheduled`).
- **`ExecuteProtectedAdministrativeOperation.run`** — autentica e autoriza `read_registered_service_availability` contra `services.availability.read` antes de qualquer leitura.
- **`isServiceId`** (duplicada localmente neste arquivo, igual à de `administrative-services-route.ts`) — guarda de formato do id do serviço.

## Erros e casos de borda

- `serviceId` malformado → 404 `registered_service_not_found`, antes de checar método.
- Query string presente (em qualquer dos três métodos) → 400 `invalid_administrative_request` (`rejectAdministrativeQuery`).
- GET com corpo (Content-Length/Content-Type presentes) → 400.
- Serviço formatado corretamente mas inexistente → `Error("registered_service_not_found")` da camada de negócio, mapeado por `mapAvailabilityError` para 404.
- Erros de acesso (`AdministrativeAccessControlError`, incluindo o mapeamento genérico "domínio de acesso indisponível") → 503 `administrative_service_management_unavailable` — repare que esse `mapAvailabilityError` trata `AdministrativeAccessControlError` de forma diferente de `mapAdministrativeAccessControlError` (que devolveria 401/403/503 conforme o `code`); a checagem de `mapAdministrativeAccessControlError` roda primeiro, então só cai nesse branch extra se o erro não for capturado por ela (ver Observações).
- Qualquer outro erro não reconhecido → 503 `service_availability_unavailable` (nome de código ligeiramente diferente do usado nas rotas de `services.ts`, que usam `administrative_service_management_unavailable` como fallback).

## Observações

`mapAvailabilityError` (`src/http/administrative-service-availability-route.ts`) tem um branch específico para `error instanceof AdministrativeAccessControlError` que devolve 503 `administrative_service_management_unavailable` — mas esse branch só seria alcançado se `mapAdministrativeAccessControlError` (chamado antes) retornasse `undefined` para o mesmo tipo de erro, o que não acontece: `mapAdministrativeAccessControlError` já trata todo `AdministrativeAccessControlError` e sempre retorna um `HttpError`. Esse segundo branch parece código morto/defensivo que nunca é alcançado na prática.
