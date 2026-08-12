# DELETE /admin/services/:serviceId/schedule

## Resumo

Remove a política de disponibilidade (schedule) salva para um serviço registrado, voltando o serviço ao comportamento padrão (sem schedule customizado). Também é uma mutação protegida por confirmação e pelo gate de exclusão mútua.

## Contrato

- **Método/path**: `DELETE /admin/services/:serviceId/schedule`, mesmo path/handler Express das variantes GET/PUT.
- **Entrada no catálogo**: `services.schedule.delete`.
- **Ativação**: mesma condição composta `ADMINISTRATIVE_SERVICE_SCHEDULE_CAPABILITY` (availability HTTP habilitada + `SERVICE_AVAILABILITY_POLICY_FILE` configurada), verificada em `src/http/create-administrative-runtime.ts`.
- **Middlewares/segurança**: envelope administrativo + admissão de taxa compartilhada + gate de mutação (`mutationGate.tryAdmit()`), o mesmo lock booleano exclusivo compartilhado com `services`, `availability`, `machine schedule` e `backups`.
- **Autenticação**: obrigatória; permissão `services.availability.write` (operation `remove_registered_service_schedule`).
- **Confirmação**: `confirmationPolicy: "exact:confirm_registered_service_schedule_removal"` — corpo precisa ter exatamente o campo `confirmation` com esse valor.
- **Parâmetros de rota**: `serviceId`, mesma validação regex; falha → `404 registered_service_not_found`.
- **Query string**: proibida.
- **Corpo da requisição**: mesmas regras de `Content-Type`/`Content-Encoding`/tamanho (4096 bytes) das outras mutações. Formato esperado: objeto com **exatamente** a chave `confirmation` (sem `policy` — diferente do PUT). `confirmation` deve ser `"confirm_registered_service_schedule_removal"`.
- **Resposta em caso de sucesso**: `200 application/json`, corpo fixo `{ serviceId, removed: true }` — a rota **ignora** o valor retornado por `removeRegisteredServiceSchedule.execute` e monta essa resposta ela mesma.
- **Códigos de status possíveis**: `200`, `400 invalid_service_schedule_request`, `404 registered_service_not_found`, `409 administrative_service_operation_busy`, `413 payload_too_large`, `414 uri_too_long`, `415 unsupported_media_type`, `401/403/503`, `429`, `500`.

## Caminho da requisição

- `createHandler` → `process` — mesmo encanamento comum (headers, admissão, validação de `serviceId`, ausência de query).
- Ramo não-GET: `mutationGate.tryAdmit()`; `409` imediato se ocupado.
- `readBody` — mesma leitura/validação de corpo das outras mutações (Content-Type, Content-Encoding, tamanho, `parseStrictJson`).
- `parseMutation(body, "remove")` — exige objeto com **só** `confirmation`, valor exato `"confirm_registered_service_schedule_removal"`. Retorna `undefined` (não há `policy` a extrair nesse caso).
- **Lógica de negócio de verdade**: `protectedAdministration.removeRegisteredServiceSchedule.execute(serviceId)`, em `create-protected-administration.ts`: localiza o serviço (lança se não encontrado), captura o `service.availabilityPolicy` **antes** de remover, chama `RemoveRegisteredServiceAvailabilityPolicy.execute` (que por sua vez chama `policyStore.removeByServiceId`), e devolve o valor pré-remoção capturado.
- `send(response, { serviceId, removed: true })` — a rota descarta o retorno do use case e sempre monta essa resposta fixa. Encanamento.

## Funções-chave

- **`parseMutation`** (`src/http/administrative-service-schedule-route.ts`) — mesma função usada pelo PUT, mas com `kind: "remove"`: muda os campos esperados (só `confirmation`) e a string de confirmação exigida.
- **Use case de remoção** (implementação real em `create-protected-administration.ts`, chamando `RemoveRegisteredServiceAvailabilityPolicy` de `src/service-management/application/`) — localiza o serviço e apaga a entrada do `policyStore` por `serviceId`. É a única etapa que muda estado persistido nesta rota.
- **`FixedAdministrativePowerOperationGate.tryAdmit`** (`src/http/administrative-power-operation-gate.ts`) — mesmo lock exclusivo global das demais mutações desta família; garante que remoção e atualização (de qualquer serviço, ou até do machine schedule) nunca rodem simultaneamente.
- **`send`** (na rota) — monta a resposta fixa `{ serviceId, removed: true }`, independente do que o use case realmente devolveu.

## Erros e casos de borda

- Corpo com `policy` presente (sobrando um campo que não deveria estar lá em uma remoção) → `400 invalid_service_schedule_request`, porque `parseMutation` exige **exatamente** a chave `confirmation`.
- Remover um schedule que já não existe: o use case só falha se o **serviço** não existir (`RegisteredServiceNotFoundError` → `404`); se o serviço existe mas nunca teve schedule configurado, a chamada de remoção é idempotente do ponto de vista de resposta HTTP — devolve `200` normalmente (o comportamento exato do `policyStore.removeByServiceId` sobre uma entrada inexistente não foi lido a fundo aqui, mas a rota não trata isso como erro).
- `serviceId` inválido é checado antes do corpo, então nunca chega a ler/parsear o corpo.
- Duas remoções (ou uma remoção e qualquer outra mutação da mesma família de gate) simultâneas → a segunda recebe `409` imediatamente.

## Observações

- **Retorno descartado**: o use case de remoção captura e devolve a política **anterior à remoção** (`service.availabilityPolicy` antes da chamada), mas a rota HTTP nunca expõe esse valor — sempre responde `{ serviceId, removed: true }`. Não é um bug em si (a resposta fixa é suficiente para o cliente saber que a remoção ocorreu), mas significa que o valor computado internamente é jogado fora; comparar com a rota de remoção do machine schedule (`DELETE /admin/machine/schedule`), cujo use case interno faz o oposto — relê o estado **pós-remoção** — mas cujo HTTP layer também descarta o valor e devolve uma resposta fixa. As duas rotas têm convenções internas opostas (pré- vs pós-remoção) para um dado que, na prática, nenhuma delas expõe ao cliente.
