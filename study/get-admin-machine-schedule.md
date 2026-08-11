# GET /admin/machine/schedule

## Resumo

Lê a política operacional efetiva da máquina inteira (quando ela deve ligar/desligar), não de um serviço específico. Devolve a política salva se existir, ou o default vindo do ambiente caso contrário. Existe para o dashboard mostrar o schedule de energia vigente.

## Contrato

- **Método/path**: `GET /admin/machine/schedule`. Sem parâmetro de rota — a máquina é singular, então não há um id no path (diferente do service schedule, que sempre carrega `:serviceId`).
- **Handler**: `src/http/administrative-machine-schedule-route.ts`, `createHandler` → `process`. Arquivo separado do service schedule (`administrative-service-schedule-route.ts`) — estruturalmente muito parecido, mas é outro arquivo, outra implementação.
- **Entrada no catálogo**: `machine.schedule.read` em `ADMINISTRATIVE_ROUTE_SECURITY_CATALOG`.
- **Ativação**: flag derivada `ADMINISTRATIVE_MACHINE_SCHEDULE_CAPABILITY`. Também não é uma env var — em `src/http/create-administrative-runtime.ts`, a rota só é montada quando `config.administrativeWakeAlarmHttpEnabled === true` (env `ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED=true`) **e** existe um `machineOperatingPolicyStore`, que só é construído quando `config.machineOperatingPolicyFilePath !== undefined` (env `MACHINE_OPERATING_POLICY_FILE` configurada). Ou seja: depende de wake-alarm via HTTP estar ligado E de um arquivo de policy configurado — a mesma dupla condição do service schedule, mas usando as flags/env vars de wake-alarm em vez de availability.
- **Middlewares/segurança**: envelope administrativo (Host/Origin/Sec-Fetch-*) + admissão de taxa compartilhada (`admission.tryAdmit()` — a mesma instância global usada por todas as rotas administrativas, incluindo service schedule).
- **Autenticação**: obrigatória; permissão `power.schedule.read` (operation `read_machine_operating_policy`).
- **Parâmetros de rota/query**: nenhum. Query proibida (`rejectAdministrativeQuery`).
- **Corpo da requisição**: nenhum (`validateAdministrativeRequestHasNoBody`).
- **Resposta em caso de sucesso**: `200 application/json`, corpo devolvido por `getMachineOperatingPolicy.execute()`.
- **Códigos de status possíveis**: `200`, `400 invalid_administrative_request` (query presente), `414 uri_too_long`, `401/403/503` (acesso), `429 administrative_request_limited`, `500 internal_error`. **Não há `404`** — diferente do service schedule, não existe "máquina não encontrada".

## Caminho da requisição

- `createHandler` → `process` (`src/http/administrative-machine-schedule-route.ts`) — encanamento: headers, admissão, despacho por verbo (`405` se não for GET/PUT/DELETE).
- `process`, ramo GET: `validateAdministrativeRequestTarget`, `rejectAdministrativeQuery`, `validateAdministrativeRequestHasNoBody` — puro encanamento de validação de forma. Sem `serviceId` para validar, então essa etapa é mais curta que a do service schedule.
- **Lógica de negócio de verdade**: `protectedAdministration.getMachineOperatingPolicy.execute()`, implementada em `src/power-management/application/get-machine-operating-policy.ts` e conectada em `create-protected-administration.ts`: resolve a política **efetiva** — se há um override persistido no `machineOperatingPolicyStore`, devolve ele com `source: "persisted"`; senão, devolve o default do ambiente (ADR-012) com `source: "environment_default"`.
- `send(response, value)` — serializa e responde. Encanamento.

## Funções-chave

- **`process`** (`src/http/administrative-machine-schedule-route.ts`) — o mesmo padrão de despacho por verbo do service schedule, mas sem a etapa de validar id de recurso, já que o escopo é a máquina inteira.
- **`getMachineOperatingPolicy.execute`** (`src/power-management/application/get-machine-operating-policy.ts`) — a função de negócio real: decide entre política persistida e default do ambiente. Segundo o próprio docstring do use case, essa leitura "nunca influencia o scheduler nem o leitor de confirmação, que continuam usando apenas a política parseada do ambiente uma vez, na inicialização" — ou seja, o valor que esta rota devolve é informativo/administrativo; não é necessariamente o que o motor de wake-alarm está de fato usando em tempo de execução até uma releitura própria dele.
- **`FixedAdministrativeRequestAdmission.tryAdmit`** (`src/http/administrative-request-admission.ts`) — mesmo limitador global (60 req/min, 4 concorrentes) compartilhado com o service schedule e todas as outras rotas `/admin`.
- **`mapAdministrativeAccessControlError`** (`src/http/administrative-http.ts`) — mesma função usada em todas as rotas administrativas para traduzir erros de controle de acesso em status HTTP.

## Comparação com service schedule

- Sem `:serviceId` no path e sem etapa de "serviço não encontrado" — a máquina sempre existe, então não há `404` possível nesta rota.
- A leitura não delega a um "find" que pode falhar (como `listRegisteredServices.execute()` no service schedule); ela resolve direto entre override persistido e default de ambiente.
- O `mapError` desta rota (mais abaixo) não trata nenhum equivalente a `RegisteredServiceNotFoundError`, coerente com a ausência de `404`.

## Erros e casos de borda

- Qualquer query string → `400 invalid_administrative_request`.
- Corpo presente em GET → `400` (via `validateAdministrativeRequestHasNoBody`).
- Limite de admissão atingido → `429` com `Retry-After: 1`.
- Erro de controle de acesso → mapeado por `mapAdministrativeAccessControlError`, com fallback `403 administrative_access_denied` se o `code` não for reconhecido.
- Qualquer outro erro não capturado nos `instanceof` de `mapError` → `500 internal_error`.
- Não há tratamento especial para "arquivo de policy ausente/corrompido" nesta rota — se isso acontecer, o erro sobe como exceção não mapeada e cai no `500` genérico.

## Observações

- Nenhuma inconsistência de operation encontrada aqui (diferente do GET do service schedule): a implementação usa `read_machine_operating_policy`, exatamente a operation declarada no catálogo para `machine.schedule.read`.
