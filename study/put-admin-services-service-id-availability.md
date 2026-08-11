# PUT /admin/services/:serviceId/availability

## Resumo

Define um override manual de disponibilidade para um serviço (por exemplo, forçar indisponível temporariamente por cima da política agendada). É uma mutação protegida por confirmação explícita e por um gate que serializa operações de serviço.

## Contrato

- **Método**: PUT (mesmo path/handler de GET e DELETE nesta rota — método dispachado dentro de `processAvailability`)
- **Path**: `/admin/services/:serviceId/availability`
- **Parâmetro de rota**: `serviceId`, validado por `isServiceId`.
- **Query string**: não aceita.
- **Autenticação**: Cloudflare Access, obrigatória.
- **Permissão**: `services.availability.write` (operação `update_registered_service_availability`).
- **Confirmação**: corpo JSON com exatamente duas chaves: `{ "confirmation": "confirm_registered_service_availability_update", "policy": <valor> }`. `policy` pode ser qualquer valor (`unknown`) na validação de forma — a validação semântica de fato acontece na camada de domínio.
- **Content-Type/Content-Encoding**: `application/json` (ou `; charset=utf-8`), sem `Content-Encoding`.
- **Tamanho máximo do corpo**: 4 096 bytes (`MAX_BODY_BYTES`, bem maior que o limite de 512 bytes das ações de serviço, porque aqui o corpo carrega uma política estruturada, não só uma confirmação).
- **Gate de mutação**: `service_mutation`, compartilhado com `start`/`stop`/`restart`.
- **Formato da resposta** (200): o valor bruto retornado por `setRegisteredServiceAvailability.execute(serviceId, policy)`, repassado sem mapeamento adicional via `send`.
- **Códigos de status possíveis**: 200, 400 (corpo/confirmação/policy inválidos), 401/403/503, 404, 405, 409 (`administrative_service_operation_busy`), 413, 415, 429, 503.

## Caminho da requisição

- Mesmo registro de rota que o GET (`registerAdministrativeRoute(app, ["services.availability.read", "services.availability.update", "services.availability.delete"], createAvailabilityHandler(dependencies))`), mas com o `routeId` `services.availability.update` correspondendo a esta operação no catálogo de segurança.
- `processAvailability` valida `serviceId`, alvo/URL e ausência de query antes de olhar o método; ao ver que não é GET, mas é PUT ou DELETE, tenta admitir no `mutationGate.tryAdmit()` — se ocupado, 409 imediato, sem ler o corpo.
- Só depois de admitido no gate é que o corpo é lido (`readBody`) e validado (`parseMutationBody(body, "update")`), que extrai o campo `policy` do corpo já confirmado.
- A chamada de negócio é `protectedAdministration.setRegisteredServiceAvailability.execute(serviceId, policy)`, que em `create-protected-administration.ts` roda dentro de `runServiceMutation("update_registered_service_availability", serviceId, () => requireServices().setRegisteredServiceAvailabilityOverride.execute(serviceId, value))`. É aqui — na porta `setRegisteredServiceAvailabilityOverride`, fora do escopo HTTP — que a validação semântica da política (formato, timezone, janelas etc.) realmente acontece, lançando erros de domínio como `ServiceAvailabilityPolicyValidationError` quando a política é inválida.
- O resultado é devolvido cru via `send` (sem passar por `mapAdministrativeAvailability`, diferente do GET — ver Observações).

## Funções-chave

- **`processAvailability`** (`src/http/administrative-service-availability-route.ts`) — mesmo dispatcher documentado no GET; para PUT/DELETE, é quem decide a ordem "admitir no gate → ler corpo → validar confirmação → chamar negócio".
- **`parseMutationBody`** (`src/http/administrative-service-availability-route.ts`) — para `kind: "update"`, exige exatamente as chaves `confirmation` e `policy`; devolve `record.policy` sem validar seu conteúdo — só garante a forma do envelope, não o conteúdo da política.
- **`setRegisteredServiceAvailabilityOverride.execute`** (porta injetada, implementação fora deste escopo) — a lógica de negócio real: valida e aplica o override de disponibilidade sobre a política agendada existente.
- **`runServiceMutation`** (`create-protected-administration.ts`) — mesmo encanamento de auditoria "iniciado → terminal" usado pelas ações de serviço, adaptado para a operação `update_registered_service_availability`.
- **`readBody`** (`src/http/administrative-service-availability-route.ts`) — leitura estrita do corpo com limite de 4 096 bytes e parse JSON estrito (`parseStrictJson`), rejeitando corpo vazio.

## Erros e casos de borda

- `serviceId` inválido → 404, antes de ler o corpo.
- Query string presente → 400.
- Gate de mutação ocupado → 409, antes mesmo de ler o corpo (perf: evita gastar banda lendo um corpo que não vai ser processado).
- Corpo com chaves diferentes de exatamente `{confirmation, policy}`, ou `confirmation` errada → 400 `invalid_service_availability_request`.
- Corpo maior que 4 096 bytes → 413.
- `Content-Type`/`Content-Encoding` não suportado → 415.
- Política com formato inválido (erro de domínio `ServiceAvailabilityPolicyValidationError`) — ver Observações: **não** é mapeada para 400 pela rota HTTP.
- Serviço inexistente → 404 `registered_service_not_found` (mensagem ou `code` do erro de domínio).
- Falha de auditoria pós-execução → mesmo padrão 503 das rotas de mutação de serviço.

## Observações

Este é o achado mais relevante da rota: `mapAvailabilityError` (`src/http/administrative-service-availability-route.ts`) só reconhece o `code === "invalid_interval"` como erro 400 de validação — mas a validação de uma política de disponibilidade inválida no `PUT` lança `ServiceAvailabilityPolicyValidationError`, cujo `code` é `"invalid_service_availability_policy"` (definido em `src/service-scheduling/domain/service-availability-policy-validation-error.ts`). Esse `code` não bate com `"invalid_interval"`, então o erro cai no fallback genérico e a rota responde **503 `service_availability_unavailable`** em vez de 400, para o que é claramente um erro de entrada do cliente (política malformada). O mesmo vale para `ServiceAvailabilityModeValidationError`, que a composição também deixa passar sem tradução. Um cliente mandando uma política mal formada recebe um 503 (que sugere "tente de novo depois"), quando deveria receber 400 (que sugere "corrija a requisição").

Diferente do GET desta mesma rota, a resposta do PUT não passa por `mapAdministrativeAvailability` — ela devolve o valor bruto de `setRegisteredServiceAvailabilityOverride.execute`, então o formato de resposta de sucesso do PUT não é garantidamente igual ao formato de leitura do GET.
