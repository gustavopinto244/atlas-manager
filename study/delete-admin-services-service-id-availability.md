# DELETE /admin/services/:serviceId/availability

## Resumo

Remove/cancela o override manual de disponibilidade de um serviço, voltando-o a seguir apenas a política agendada normal. É a operação inversa do `PUT`, também protegida por confirmação explícita.

## Contrato

- **Método**: DELETE (mesmo path/handler de GET e PUT nesta rota)
- **Path**: `/admin/services/:serviceId/availability`
- **Parâmetro de rota**: `serviceId`, validado por `isServiceId`.
- **Query string**: não aceita.
- **Autenticação**: Cloudflare Access, obrigatória.
- **Permissão**: `services.availability.write` (operação `remove_registered_service_availability`).
- **Confirmação**: corpo JSON com exatamente uma chave: `{ "confirmation": "confirm_registered_service_availability_removal" }`. Diferente do `PUT`, não há campo `policy` — a remoção não carrega dados além da confirmação.
- **Content-Type/Content-Encoding**: mesmas regras do `PUT` (`application/json`, sem `Content-Encoding`).
- **Tamanho máximo do corpo**: 4 096 bytes (mesmo limite do `PUT`, embora o corpo real seja bem menor).
- **Gate de mutação**: `service_mutation`, compartilhado com `start`/`stop`/`restart`/`PUT` desta mesma rota.
- **Formato da resposta** (200): `{ serviceId, removed: true, result: <valor bruto de removeRegisteredServiceAvailability.execute> }`.
- **Códigos de status possíveis**: 200, 400, 401/403/503, 404, 405, 409, 413, 415, 429, 503.

## Caminho da requisição

- Mesmo registro de rota dos outros dois métodos, com `routeId` `services.availability.delete` no catálogo.
- `processAvailability` segue o mesmo fluxo do `PUT`: valida `serviceId`/alvo/query, admite no `mutationGate`, lê o corpo (`readBody`), e chama `parseMutationBody(body, "remove")` — que, diferente do `"update"`, não extrai nenhum valor além de validar a confirmação (retorna `undefined`).
- A chamada de negócio é `protectedAdministration.removeRegisteredServiceAvailability.execute(serviceId)`, que em `create-protected-administration.ts` roda dentro de `runServiceMutation("remove_registered_service_availability", serviceId, () => requireServices().cancelRegisteredServiceAvailabilityOverride.execute(serviceId))`. A lógica de negócio real — decidir o que significa "cancelar" um override (por exemplo, se falha silenciosamente quando não havia override nenhum) — vive na porta `cancelRegisteredServiceAvailabilityOverride`, fora deste escopo HTTP.
- Diferente do `GET`/`PUT`, o handler HTTP aqui monta a resposta manualmente: `{ serviceId, removed: true, result: value }`, em vez de repassar o valor bruto ou usar `mapAdministrativeAvailability`.

## Funções-chave

- **`processAvailability`** — mesmo dispatcher documentado nos outros dois métodos; para DELETE, monta o envelope de resposta específico (`{ serviceId, removed: true, result }`).
- **`parseMutationBody`** (`kind: "remove"`) — exige exatamente `{ confirmation: "confirm_registered_service_availability_removal" }`, sem nenhum campo adicional; retorna `undefined` porque a remoção não precisa de payload além da confirmação.
- **`cancelRegisteredServiceAvailabilityOverride.execute`** (porta injetada) — a lógica de negócio real: cancela o override vigente.
- **`runServiceMutation`** — mesmo encanamento de auditoria "iniciado → terminal", adaptado para `remove_registered_service_availability`.

## Erros e casos de borda

- `serviceId` inválido → 404, antes de ler o corpo.
- Corpo com qualquer chave além de `confirmation`, ou confirmação errada → 400 (mesmo que o cliente tente reenviar o corpo do `PUT` com `policy` incluído — isso seria rejeitado por ter 2 chaves em vez de 1).
- Gate de mutação ocupado → 409.
- Corpo vazio, malformado, ou content-type errado → 400/413/415, mesmas regras do `PUT`.
- Serviço inexistente → 404.
- Falha de auditoria pós-execução → mesmo padrão 503 das outras mutações.
- Não há um caso especial documentado no HTTP para "remover um override que não existe" — esse comportamento depende inteiramente de `cancelRegisteredServiceAvailabilityOverride`, que está fora do escopo destes dois arquivos; a rota HTTP não decide se isso é um erro ou uma operação idempotente sem efeito.

## Observações

Como no `PUT`, qualquer erro de validação de domínio que não seja reconhecido explicitamente por `mapAvailabilityError` (que só trata `registered_service_not_found` e `code === "invalid_interval"`) cai no fallback genérico 503 `service_availability_unavailable`. Para esta rota especificamente isso é menos provável de ocorrer (não há política a validar), mas o padrão de tratamento de erro é o mesmo arquivo e vale saber que ele é compartilhado pelas três variantes do método.
