# GET /admin/machine/schedule/preview

## Resumo

Simula, sem persistir nada, como uma política operacional **candidata** para a máquina se comportaria a partir de agora — devolve o próximo plano de energia previsto sem tocar no store. Existe para o dashboard mostrar "veja como ficaria" antes de confirmar um PUT.

## Contrato

- **Método/path**: `GET /admin/machine/schedule/preview`, registrado separadamente (`createPreviewHandler`/`processPreview`) no mesmo arquivo `src/http/administrative-machine-schedule-route.ts`.
- **Entrada no catálogo**: `machine.schedule.preview`.
- **Ativação**: mesma condição composta `ADMINISTRATIVE_MACHINE_SCHEDULE_CAPABILITY` das demais variantes de machine schedule — base e preview nascem/somem juntas, registradas em `registerAdministrativeMachineScheduleRoutes`.
- **Middlewares/segurança**: envelope administrativo + admissão de taxa compartilhada. Sem `mutationGate` — é leitura.
- **Autenticação**: obrigatória; permissão `power.schedule.read` (operation `read_machine_operating_policy_preview`).
- **Parâmetros de rota**: nenhum.
- **Query string**: obrigatória e estrita, mas **mais simples que a do service schedule preview** — exige **exatamente uma** chave, `policy` (sem `startsAt`/`endsAt`). Qualquer outra combinação → `400 invalid_machine_schedule_request`.
- **Corpo da requisição**: nenhum.
- `policy` na query: string JSON, até 4096 bytes, parseada com `parseStrictJson`.
- **Resposta em caso de sucesso**: `200 application/json`, corpo devolvido por `previewMachineOperatingPolicy.execute(policy)`.
- **Códigos de status possíveis**: `200`, `400 invalid_machine_schedule_request`, `413`, `414`, `401/403/503`, `429`, `500`. Sem `404`.

## Caminho da requisição

- `createPreviewHandler` → `processPreview` — encanamento: headers, admissão, despacho (só GET; `405` caso contrário).
- `processPreview` valida a query estrita (exatamente `policy`, sem duplicata), extrai `rawPolicy`, checa tamanho, e faz `parseStrictJson`.
- **Lógica de negócio de verdade**: `protectedAdministration.previewMachineOperatingPolicy.execute(policy)`, implementada em `src/power-management/application/preview-machine-operating-policy.ts`: valida a política candidata com `createMachineOperatingPolicy(candidatePolicy)`, calcula `evaluatedAt = clock.now().toISOString()` e chama `evaluateMachinePowerPlan(policy, evaluatedAt)`, marcando o resultado com `source: "candidate_preview"`.
- `send(response, value)` — serializa e responde.

## Funções-chave

- **`processPreview`** (`src/http/administrative-machine-schedule-route.ts`) — portão de forma da query; mais simples que o equivalente de service schedule porque não há intervalo `[startsAt, endsAt]` a validar.
- **`previewMachineOperatingPolicy.execute`** / `PreviewMachineOperatingPolicy` (`src/power-management/application/preview-machine-operating-policy.ts`) — calcula o plano de energia a partir de "agora" para a política candidata, sem gravar nada.
- **`evaluateMachinePowerPlan`** (camada de domínio, `power-management`) — avaliador que projeta a próxima transição de energia a partir de um instante dado; é o mesmo tipo de avaliador que o `get`/`set` reais também acabam usando internamente para relatar estado.
- **`createMachineOperatingPolicy`** — mesma validação estrutural usada no PUT real.

## Comparação com o preview de service schedule

- **Sem intervalo explícito**: o preview de service schedule (item 4) exige `startsAt`/`endsAt` porque avalia disponibilidade **ao longo de um período**; o preview de machine avalia só "a partir de agora" (`clock.now()`), porque, segundo o próprio docstring do use case, "diferente do preview de serviço, não há override store nem intervalo para combinar, já que a máquina tem uma única política e o avaliador já relata a próxima transição a partir de 'agora'".
- **Sem override store**: o preview de service schedule combina a política candidata com o **override** atual do serviço (`overrideStore.findByServiceId`); o preview de machine não combina com nada — é só a política candidata avaliada isoladamente, porque a máquina não tem conceito de "override" separado de "política persistida".
- Estruturalmente os dois handlers HTTP (`processPreview` em cada arquivo) seguem o mesmo padrão de validação de query estrita + limite de bytes + `parseStrictJson`, só variando a lista de chaves exigidas.

## Erros e casos de borda

- `policy` ausente, ou query com chave a mais (ex.: um `?policy=...&extra=1`) → `400 invalid_machine_schedule_request`.
- `policy` malformado (JSON inválido) → `400`.
- `policy` estruturalmente inválido (falha em `createMachineOperatingPolicy`) → `400`, mapeado a partir de `MachineOperatingPolicyValidationError`/`MachineWeeklyOperatingScheduleValidationError`.
- `policy` acima de 4096 bytes → `413`.
- Sem parâmetro de rota, não há `404` possível.

## Observações

- Nenhuma inconsistência adicional notada além das já registradas nos documentos das outras variantes desta rota (limite de corpo divergente do contrato publicado, e a nota sobre o efeito administrativo vs. operacional do `set`/`get`, que não se aplica ao preview porque ele nunca persiste nada).
