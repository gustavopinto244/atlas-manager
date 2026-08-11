# GET /admin/services/:serviceId/availability/preview

## Resumo

Simula, para um intervalo de tempo arbitrário (`startsAt`/`endsAt`) passado por query string, se o serviço deveria estar disponível segundo sua política agendada — sem consultar nem depender do estado runtime atual do serviço. É uma ferramenta de "e se", diferente da leitura normal de disponibilidade (`GET .../availability`), que responde "como está agora, com o override vigente".

## Contrato

- **Método**: GET
- **Path**: `/admin/services/:serviceId/availability/preview`
- **Parâmetro de rota**: `serviceId`, validado por `isServiceId`.
- **Query string**: **obrigatória e estritamente controlada** — exatamente duas chaves, `startsAt` e `endsAt`, sem chaves repetidas nem extras (`keys.length !== 2 || new Set(keys).size !== 2`). Essa é a única rota deste conjunto que exige query string; as outras a proíbem.
- **Autenticação**: Cloudflare Access, obrigatória.
- **Permissão**: `services.availability.read` (operação `read_registered_service_availability_preview`) — mesma permissão de leitura da disponibilidade normal, não uma permissão própria de "preview".
- **Corpo da requisição**: nenhum.
- **Formato da resposta** (200): valor bruto de `getRegisteredServiceAvailabilityPreview.execute(serviceId, { startsAt, endsAt })`, repassado sem mapeamento (diferente de `mapAdministrativeAvailability` usado no GET normal).
- **Códigos de status possíveis**: 200, 400 (`invalid_service_availability_request` — query ausente/incompleta/duplicada, ou intervalo inválido), 401/403/503, 404, 405 (método diferente de GET), 429, 503.

## Caminho da requisição

- Registrada separadamente das outras três variantes de `/availability`, com seu próprio `routeId`: `registerAdministrativeRoute(app, ["services.availability.preview"], createAvailabilityPreviewHandler(dependencies))` em `registerAdministrativeServiceAvailabilityRoutes`.
- `createAvailabilityPreviewHandler` monta o mesmo encanamento de admissão (headers de segurança + rate limit) que as demais rotas administrativas, delegando para `processAvailabilityPreview`.
- `processAvailabilityPreview` (`src/http/administrative-service-availability-route.ts`) valida método GET, `serviceId`, alvo da URL, ausência de corpo, e então — ao contrário de todas as outras rotas deste conjunto — **exige** a query string: extrai `startsAt`/`endsAt` de `new URL(request.url, "http://atlas.invalid").searchParams` e valida que são exatamente essas duas chaves.
- A chamada de negócio é `protectedAdministration.getRegisteredServiceAvailabilityPreview.execute(serviceId, { startsAt, endsAt })`, que em `create-protected-administration.ts` delega direto (sem passar pelo fluxo de auditoria de mutação, já que é leitura) para `requireServices().getRegisteredServiceAvailabilityForInterval.execute({ serviceId, startsAt, endsAt })`.
- A lógica real de "o que aconteceria nesse intervalo" vive em `evaluateRegisteredServiceAvailabilityForInterval` (`src/service-management/domain/registered-service-availability-interval.ts`): valida o formato canônico dos timestamps, garante `startsAt < endsAt` e que o intervalo não passa de 8 dias, e calcula as transições de política dentro da janela — devolvendo se a disponibilidade é `"required"`/`"not_required"`, o primeiro instante em que muda (se houver), e até 5 transições futuras.
- Diferente da leitura normal, este fluxo **não** consulta override nem status runtime — é puramente derivado da política declarada (`policy`), por isso é chamado de "preview": não reflete o estado atual, só o que a política *diria* para aquele intervalo hipotético.

## Funções-chave

- **`processAvailabilityPreview`** (`src/http/administrative-service-availability-route.ts`) — único ponto desta rota que lê e valida a forma da query string; é o encanamento que traduz `?startsAt=...&endsAt=...` em argumentos tipados para a camada de negócio.
- **`evaluateRegisteredServiceAvailabilityForInterval`** (`src/service-management/domain/registered-service-availability-interval.ts`) — a lógica de negócio de verdade: valida o intervalo (timestamp canônico, ordem cronológica, limite de 8 dias) e decide o resultado (`outcome`, `firstRequiredAt`, `transitions`) a partir da política do serviço, sem olhar para estado runtime.
- **`getRegisteredServiceAvailabilityPreview.execute`** (interno a `create-protected-administration.ts`) — encanamento fino que só encaminha a chamada para `getRegisteredServiceAvailabilityForInterval`, dentro do `runner.run` que cuida de autenticação/autorização.
- **`computeUpcomingTransitions`** (helper interno ao mesmo arquivo de domínio, não lido em detalhe aqui) — monta a lista de até `MAX_RENDERED_TRANSITIONS` (5) transições futuras dentro da janela solicitada.

## Erros e casos de borda

- Método diferente de GET → 405.
- `serviceId` inválido/inexistente → 404 `registered_service_not_found`.
- Query string ausente, com apenas uma das duas chaves, com chaves repetidas, ou com chaves extras além de `startsAt`/`endsAt` → 400 `invalid_service_availability_request`.
- `startsAt`/`endsAt` fora do formato de timestamp canônico, `startsAt >= endsAt`, ou intervalo maior que 8 dias → o domínio lança `RegisteredServiceAvailabilityIntervalValidationError` com `code: "invalid_interval"`, que `mapAvailabilityError` traduz explicitamente para 400.
- Corpo presente numa requisição GET → 400 (mesma validação `validateAdministrativeRequestHasNoBody` das outras leituras).
- Falhas de acesso → mapeadas normalmente por `mapAdministrativeAccessControlError`.

## Observações

Este é o único ponto do arquivo onde `mapAvailabilityError` de fato acerta o mapeamento 400 para um erro de validação de domínio (`code === "invalid_interval"`) — ao contrário do `PUT`, onde o erro de política inválida (`code: "invalid_service_availability_policy"`) não tem tratamento equivalente e cai em 503 (ver `study/put-admin-services-service-id-availability.md`). Vale notar essa assimetria: o preview trata bem seu próprio erro de validação específico, mas o `code` usado (`"invalid_interval"`) é definido em `registered-service-availability-interval.ts`, um arquivo de domínio diferente do que define o erro de política do `PUT` — são dois vocabulários de erro distintos que o HTTP só conhece parcialmente.

`RegisteredServiceAvailabilityIntervalValidationError` também pode ter `code: "invalid_service_id"` ou `"invalid_combination"`, mas nenhum desses é tratado explicitamente por `mapAvailabilityError` — cairiam no fallback 503 se algum dia fossem lançados por este caminho. Na prática `invalid_service_id` não deveria ocorrer aqui porque o HTTP já valida o `serviceId` antes de chamar o domínio.
