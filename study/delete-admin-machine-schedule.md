# DELETE /admin/machine/schedule

## Resumo

Remove a política operacional persistida da máquina, fazendo a próxima leitura (`GET /admin/machine/schedule`) cair de volta no default do ambiente. Mutação protegida por confirmação e pelo mesmo gate de exclusão mútua das demais rotas de mutação administrativa.

## Contrato

- **Método/path**: `DELETE /admin/machine/schedule`, mesmo path/handler das variantes GET/PUT em `src/http/administrative-machine-schedule-route.ts`.
- **Entrada no catálogo**: `machine.schedule.delete`.
- **Ativação**: mesma condição composta `ADMINISTRATIVE_MACHINE_SCHEDULE_CAPABILITY` (wake-alarm HTTP habilitado + `MACHINE_OPERATING_POLICY_FILE` configurada).
- **Middlewares/segurança**: envelope administrativo + admissão de taxa compartilhada + gate de mutação (`mutationGate.tryAdmit()`, compartilhado com `services`, `availability`, `service schedule` e `backups`).
- **Autenticação**: obrigatória; permissão `power.schedule.write` (operation `remove_machine_operating_policy`).
- **Confirmação**: `confirmationPolicy: "exact:confirm_machine_operating_policy_removal"`.
- **Parâmetros de rota/query**: nenhum parâmetro de rota; query proibida.
- **Corpo da requisição**: mesmas regras de tamanho/tipo das outras mutações. Formato esperado: objeto com **exatamente** a chave `confirmation`, valor `"confirm_machine_operating_policy_removal"`.
- **Resposta em caso de sucesso**: `200 application/json`, corpo fixo `{ removed: true }` (sem `serviceId`, já que não há id de recurso) — a rota ignora o retorno real do use case e monta essa resposta ela mesma.
- **Códigos de status possíveis**: `200`, `400 invalid_machine_schedule_request`, `409 administrative_machine_schedule_operation_busy`, `413`, `414`, `415`, `401/403/503`, `429`, `500`. Sem `404` — não há recurso identificável que possa "não existir".

## Caminho da requisição

- `createHandler` → `process` — encanamento comum.
- Ramo não-GET: `mutationGate.tryAdmit()`; `409` imediato se ocupado.
- `readBody` → `parseMutation(body, "remove")` — exige objeto com só `confirmation`, valor exato. Retorna `undefined` (não há `policy` para uma remoção).
- **Lógica de negócio de verdade**: `protectedAdministration.removeMachineOperatingPolicy.execute()`, em `src/power-management/application/remove-machine-operating-policy.ts`: chama `store.remove()`. Segundo o docstring, "uma vez removida, `GetMachineOperatingPolicy` cai de volta no default do ambiente já na próxima leitura — sem precisar reiniciar o processo". A conexão em `create-protected-administration.ts` (por volta das linhas 410-420) chama `getMachineOperatingPolicyUseCase.execute()` de novo **depois** da remoção, devolvendo o estado **pós-remoção**.
- `send(response, { removed: true })` — a rota descarta o que o use case devolveu e monta a resposta fixa.

## Funções-chave

- **`parseMutation`** (`src/http/administrative-machine-schedule-route.ts`) — portão de confirmação, mesmo padrão das outras mutações, mas exigindo só `confirmation` no corpo.
- **`RemoveMachineOperatingPolicy.execute`** (`src/power-management/application/remove-machine-operating-policy.ts`) — a única etapa que muda estado: apaga a policy do `machineOperatingPolicyStore`.
- **`getMachineOperatingPolicyUseCase.execute`** (reaproveitado dentro da composição em `create-protected-administration.ts` após a remoção) — relê o estado para devolver o resultado pós-remoção ao chamador interno do use case, mesmo que a rota HTTP não repasse esse valor ao cliente.
- **`FixedAdministrativePowerOperationGate.tryAdmit`** — mesmo lock global das demais mutações desta família.

## Erros e casos de borda

- Corpo com campo `policy` sobrando (não deveria estar em uma remoção) → `400`, porque `parseMutation` exige exatamente `{confirmation}`.
- Remover quando não há política persistida (já está no default do ambiente): a chamada de `store.remove()` sobre uma entrada inexistente não foi lida a fundo neste levantamento, mas a rota não trata esse cenário como erro — não há checagem explícita de "nada para remover" no handler HTTP.
- Duas mutações concorrentes em qualquer rota da família `service_mutation` → a segunda recebe `409 administrative_machine_schedule_operation_busy`.
- Sem parâmetro de rota, não há caminho para `404`.

## Observações

- **Convenção pré/pós-remoção invertida em relação ao service schedule**: o use case de remoção do machine schedule relê o estado **depois** de remover (`source: "environment_default"` esperado, pois cai no default), enquanto o use case equivalente do service schedule (`removeRegisteredServiceSchedule`, ver `study/delete-admin-services-service-id-schedule.md`) captura e devolve a política **antes** da remoção. Como as duas rotas HTTP descartam esses valores e devolvem respostas fixas (`{removed:true}` / `{serviceId, removed:true}`), a inconsistência é invisível para quem consome a API — mas é uma assimetria real entre dois trechos de código estruturalmente equivalentes, que pode confundir quem for reaproveitar essas funções de aplicação em outro contexto (ex.: um script interno que chame o use case diretamente em vez de passar pela rota HTTP).
