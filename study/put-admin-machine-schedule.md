# PUT /admin/machine/schedule

## Resumo

Substitui a política operacional da máquina inteira (quando ligar/desligar), sobrescrevendo o default do ambiente para toda leitura futura via `GetMachineOperatingPolicy`. Mutação protegida por confirmação explícita e por lock de exclusão mútua.

## Contrato

- **Método/path**: `PUT /admin/machine/schedule`, mesmo path/handler Express das variantes GET/DELETE (`src/http/administrative-machine-schedule-route.ts`).
- **Entrada no catálogo**: `machine.schedule.update`.
- **Ativação**: mesma condição composta `ADMINISTRATIVE_MACHINE_SCHEDULE_CAPABILITY` (wake-alarm HTTP habilitado + `MACHINE_OPERATING_POLICY_FILE` configurada), verificada em `src/http/create-administrative-runtime.ts`.
- **Middlewares/segurança**: envelope administrativo + admissão de taxa compartilhada + **gate de mutação** (`mutationGate.tryAdmit()`) — a mesma instância `FixedAdministrativePowerOperationGate` (`serviceMutationGate`) compartilhada com `services`, `availability`, `service schedule` e `backups`. Ou seja: uma mutação de machine schedule em voo bloqueia, por exemplo, um PUT simultâneo no schedule de um serviço qualquer, e vice-versa.
- **Autenticação**: obrigatória; permissão `power.schedule.write` (operation `update_machine_operating_policy`).
- **Confirmação**: `confirmationPolicy: "exact:confirm_machine_operating_policy_update"`.
- **Parâmetros de rota/query**: nenhum parâmetro de rota (não há `:id`); query proibida.
- **Corpo da requisição**: mesmas regras de `Content-Type`/`Content-Encoding`/tamanho (4096 bytes, constante local `MAX_BODY_BYTES`) e `parseStrictJson` das mutações de service schedule. Formato esperado: objeto com **exatamente** as chaves `confirmation` e `policy`. `confirmation` deve ser `"confirm_machine_operating_policy_update"`.
- **Resposta em caso de sucesso**: `200 application/json`, corpo devolvido por `setMachineOperatingPolicy.execute(policy)`.
- **Códigos de status possíveis**: `200`, `400 invalid_machine_schedule_request` (corpo malformado, confirmação errada, ou política inválida por regra de domínio), `409 administrative_machine_schedule_operation_busy` (gate ocupado — note o código específico, diferente do `administrative_service_operation_busy` do service schedule), `413`, `414`, `415`, `401/403/503`, `429`, `500`.

## Caminho da requisição

- `createHandler` → `process` — encanamento comum às três variantes desta rota (headers, admissão, despacho por verbo).
- Ramo não-GET: `mutationGate.tryAdmit()`; `409` imediato se ocupado.
- `readBody` — validação de `Content-Type`/`Content-Encoding`/tamanho e parse estrito, idêntica em estrutura à do service schedule (mesmo `MAX_BODY_BYTES = 4_096` local).
- `parseMutation(body, "update")` — exige exatamente `{confirmation, policy}` com o valor de confirmação certo. Extrai `policy` cru.
- **Lógica de negócio de verdade**: `protectedAdministration.setMachineOperatingPolicy.execute(policy)`, em `src/power-management/application/set-machine-operating-policy.ts`: valida via `createMachineOperatingPolicy(input)` e persiste via `store.save(policy)`. Segundo o docstring do use case, isso "sobrescreve o default do ambiente para toda leitura subsequente de `GetMachineOperatingPolicy`" — mas, como no GET, "nunca influencia o scheduler nem o leitor de confirmação".
- `send(response, value)` — serializa e responde.

## Funções-chave

- **`parseMutation`** (`src/http/administrative-machine-schedule-route.ts`) — mesmo papel estrutural que no service schedule: portão de confirmação e forma do corpo, mas com as strings de confirmação específicas de machine (`confirm_machine_operating_policy_update`).
- **`SetMachineOperatingPolicy.execute`** (`src/power-management/application/set-machine-operating-policy.ts`) — valida a política via `createMachineOperatingPolicy` e persiste no `machineOperatingPolicyStore`. É o único lugar desta rota que muda estado.
- **`createMachineOperatingPolicy`** (camada de domínio, `power-management`) — validação estrutural da política (janelas semanais etc.); erros aqui viram `MachineOperatingPolicyValidationError` ou `MachineWeeklyOperatingScheduleValidationError`, capturados por `mapError`.
- **`FixedAdministrativePowerOperationGate.tryAdmit`** — mesmo lock global das mutações de service schedule; aqui é o que garante que não se pode atualizar a política da máquina enquanto outra mutação da mesma família está em andamento.

## Erros e casos de borda

- Corpo vazio, com campos extras, ou com `confirmation` errada → `400 invalid_machine_schedule_request`.
- `policy` presente mas violando regra de domínio (ex.: janela semanal inconsistente) → `400`, mapeado a partir de `MachineOperatingPolicyValidationError`/`MachineWeeklyOperatingScheduleValidationError`.
- `Content-Encoding` presente (qualquer valor) → `415`.
- Corpo acima de 4096 bytes → `413`.
- Duas mutações concorrentes em qualquer rota da família `service_mutation` (inclusive uma no service schedule de outro serviço) → a segunda recebe `409` — aqui com o código específico `administrative_machine_schedule_operation_busy`.
- Não há checagem de "id de recurso" (não existe), então nenhuma variante de `404` é possível.

## Observações

- **Limite de corpo divergente do catálogo**, mesma observação já registrada para o service schedule: o catálogo declara `JSON_BODY.maxBodyBytes = 8_192` (publicado por `createAdministrativeApiContract`), mas o código desta rota aplica `MAX_BODY_BYTES = 4_096` local, de forma independente. O número documentado no "contrato" da API não é o que é de fato aplicado.
- **Efeito só administrativo, não operacional em tempo real**: tanto o `set` quanto o `get` desta família deixam explícito em docstring que a política salva por esta rota não realimenta o scheduler nem o leitor de confirmação de wake-alarm, que seguem usando a política parseada do ambiente na inicialização do processo. Isso não é um bug — está documentado no próprio use case — mas é fácil de esquecer ao reaprender o fluxo: um PUT bem-sucedido aqui muda o que a API relata, não necessariamente (sem mais contexto) o que o motor de agendamento está executando.
