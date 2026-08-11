# GET /admin/services/:serviceId/schedule/preview

## Resumo

Simula, sem persistir nada, como uma política de disponibilidade **candidata** (ainda não salva) se comportaria para um serviço em um intervalo de tempo específico. Existe para o dashboard mostrar "veja como ficaria" antes do usuário confirmar um PUT real.

## Contrato

- **Método/path**: `GET /admin/services/:serviceId/schedule/preview`. Path e handler **diferentes** da rota base — é registrada separadamente via `createPreviewHandler`/`processPreview`, embora no mesmo arquivo `src/http/administrative-service-schedule-route.ts`.
- **Entrada no catálogo**: `services.schedule.preview`.
- **Ativação**: mesma condição composta `ADMINISTRATIVE_SERVICE_SCHEDULE_CAPABILITY` das demais variantes de service schedule (availability HTTP habilitada + `SERVICE_AVAILABILITY_POLICY_FILE` configurada) — as duas rotas (base e preview) nascem ou somem juntas, registradas em `registerAdministrativeServiceScheduleRoutes`.
- **Middlewares/segurança**: envelope administrativo + admissão de taxa compartilhada. **Não** passa pelo `mutationGate` — é leitura, mesmo fazendo um cálculo não trivial.
- **Autenticação**: obrigatória; permissão `services.availability.read` (operation `read_registered_service_schedule_preview`).
- **Parâmetros de rota**: `serviceId`, mesma validação regex das outras variantes; falha → `404 registered_service_not_found`.
- **Query string**: **obrigatória e estrita** — precisa ter **exatamente** três chaves, sem duplicatas: `startsAt`, `endsAt`, `policy`. Qualquer chave a mais, a menos, ou duplicada → `400 invalid_service_schedule_request`. Isso é o oposto da rota base (item 1), que proíbe qualquer query.
- **Corpo da requisição**: nenhum (`validateAdministrativeRequestHasNoBody`), mesmo sendo GET com "payload" — o payload inteiro (incluindo a política candidata) vem via query string.
- `policy` na query é uma string JSON serializada, limitada a 4096 bytes (`MAX_BODY_BYTES`, mesma constante das mutações) e parseada com `parseStrictJson`.
- **Resposta em caso de sucesso**: `200 application/json`, corpo devolvido por `previewRegisteredServiceSchedule.execute(serviceId, { policy, startsAt, endsAt })`.
- **Códigos de status possíveis**: `200`, `400 invalid_service_schedule_request` (query fora do formato exigido, `policy` não é JSON válido, ou falha em regra de domínio), `404 registered_service_not_found`, `413 payload_too_large` (policy > 4096 bytes), `414 uri_too_long`, `401/403/503`, `429`, `500`.

## Caminho da requisição

- `createPreviewHandler` → `processPreview` (`src/http/administrative-service-schedule-route.ts`) — encanamento próprio desta variante: headers, admissão, e então `processPreview`.
- `processPreview` — confere método (só GET; `405` caso contrário), valida `serviceId`, valida tamanho da URL, e faz a validação estrita da query (exatamente `startsAt`+`endsAt`+`policy`, sem duplicatas).
- `parseStrictJson(rawPolicy)` — parseia a string de `policy` vinda da query. Encanamento de parsing, mas já é o primeiro ponto onde um JSON malformado vira `400`.
- **Lógica de negócio de verdade**: `protectedAdministration.previewRegisteredServiceSchedule.execute(serviceId, { policy, startsAt, endsAt })`, implementada em `src/service-management/application/preview-registered-service-availability-policy.ts` e conectada em `create-protected-administration.ts`. Ela: (1) valida a `policy` candidata com `createServiceAvailabilityPolicy(input.policy)` — as mesmas regras de domínio usadas no PUT real; (2) busca o **override** atual do serviço via `overrideStore.findByServiceId` (não o `policy` persistido); (3) chama o mesmo avaliador `evaluateRegisteredServiceAvailabilityForInterval` que a leitura autoritativa usa; (4) marca o resultado com `source: "candidate_preview"`.
- `send(response, value)` — serializa e responde. Encanamento.

## Funções-chave

- **`processPreview`** (`src/http/administrative-service-schedule-route.ts`) — decide se a query tem exatamente as três chaves esperadas e decodifica a política candidata. É o portão de forma da requisição.
- **`previewRegisteredServiceSchedule.execute`** / `PreviewRegisteredServiceAvailabilityPolicy` (`src/service-management/application/preview-registered-service-availability-policy.ts`) — a função central desta rota: reaproveita a mesma validação de domínio e o mesmo avaliador de intervalo (`evaluateRegisteredServiceAvailabilityForInterval`) que os caminhos de salvar e de "availability preview" já usam, para que o navegador nunca precise calcular transições de disponibilidade por conta própria.
- **`createServiceAvailabilityPolicy`** (camada de domínio, `service-scheduling`/`service-management`) — valida estruturalmente a política candidata; é a mesma validação que roda no PUT real, então um preview que passa aqui tem boa chance de passar no PUT com a mesma política.
- **`parseStrictJson`** (`src/config/strict-json.ts`) — parser JSON estrito (rejeita, entre outras coisas, chaves duplicadas) usado tanto para o corpo das mutações quanto para o `policy` vindo da query aqui.

## Erros e casos de borda

- Diferença chave em relação à leitura normal (item 1): o preview **não toca o `policyStore`** — ele nunca lê nem persiste a política salva do serviço. Em vez disso, combina a política candidata (que pode nem existir ainda) com o **override** atual do serviço para produzir o resultado.
- `policy` na query malformado (não é JSON válido) → `400`, mesmo que `startsAt`/`endsAt` estejam corretos.
- `policy` estruturalmente inválido (falha em `createServiceAvailabilityPolicy`) → mapeado por `mapError` para `400 invalid_service_schedule_request`, junto com os mesmos tipos de erro de domínio do PUT.
- Falta ou sobra de qualquer uma das três chaves de query, incluindo repetição da mesma chave (`?policy=a&policy=b`) → `400`, detectado antes mesmo de tentar ler os valores.
- `policy` maior que 4096 bytes → `413 payload_too_large` (checado só no `rawPolicy`, antes do parse).
- `serviceId` inválido/inexistente → `404 registered_service_not_found`, mesma checagem regex das demais variantes, mesmo antes de olhar a query.

## Observações

- Nenhuma inconsistência adicional além das já registradas para a rota base (a divergência de operation do GET normal não se repete aqui — a operation `read_registered_service_schedule_preview` declarada no catálogo é a mesma usada na autorização real).
