# GET /health/server

## Resumo

Retorna uma fotografia (snapshot) de métricas do host: memória, CPU (uso e temperatura), load average e disco. Existe para monitoramento operacional local — permite checar a saúde da máquina sem entrar via SSH, mas fica atrás de loopback/proxy porque expõe dados sensíveis do host.

## Contrato

- **Método/path**: `GET /health/server`
- **Middlewares**: `healthHeaders` (aplica `setAdministrativeSecurityHeaders`), igual à `/health/live`. Registrada diretamente em `src/http/create-app.ts`, fora do catálogo administrativo, sem o envelope de segurança (`createAdministrativeSecurityEnvelope`).
- **Autenticação**: nenhuma — mesma justificativa da liveness (loopback/reverse proxy fazem o isolamento; ver `docs/operations/atlas-manager-nginx.md`).
- **Parâmetros de rota/query**: nenhum.
- **Corpo da requisição**: nenhum.
- **Resposta** (`200 OK`), JSON:
  ```
  {
    capturedAt, uptimeSeconds,
    memory: { totalBytes, freeBytes, usedBytes, usagePercentage },
    cpu: { usagePercentage, temperatureCelsius },
    cpuLoadAverage: { oneMinute, fiveMinutes, fifteenMinutes },
    disk: { totalBytes, availableBytes, usedBytes, usagePercentage }
  }
  ```
- **Erros**: se a leitura de métricas falhar (valores inconsistentes vindos do SO), a exceção sobe sem ser capturada no handler e cai no `createErrorHandler` genérico, respondendo `500 internal_error`.

## Caminho da requisição

- `src/http/create-app.ts` — registra `app.get("/health/server", healthHeaders, createServerHealthHandler(getServerHealth))`. `getServerHealth` é injetado via `CreateAppDependencies` (implementa `GetServerHealthCapability`), então quem monta o app decide qual implementação real é usada.
- `createServerHealthHandler` (`src/server-health/http/server-health-handler.ts`) — só faz `await getServerHealth.execute()` e depois serializa o snapshot em JSON com nomes de campo mais "públicos" (ex.: `totalMemoryBytes` → `memory.totalBytes`). É encanamento/serialização, não lógica de negócio.
- `GetServerHealth.execute` (`src/server-health/application/get-server-health.ts`) — delega para `reader.read()`. Também é uma camada fina (Application layer clássica), só repassa.
- **Aqui está a lógica de negócio de verdade**: `NodeServerHealthReader.read` / `captureSnapshot` (`src/server-health/infrastructure/node-server-health-reader.ts`). É quem calcula uso de CPU (comparando duas amostras de `cpus()` com 100ms de intervalo), memória, disco (via `statfs`) e valida consistência de cada valor lido do SO, lançando erro se algo parecer impossível (ex.: memória livre > memória total).

## Funções-chave

- **`NodeServerHealthReader.read`** (`src/server-health/infrastructure/node-server-health-reader.ts`) — orquestra a coleta: tira uma amostra de CPU, espera ~100ms (`waitForCpuSample`), tira outra amostra, lê disco e temperatura, e monta o snapshot. É o coração da rota.
- **`calculateCpuUsagePercent` / `calculateCpuUsagePercentFromDeltas`** (mesmo arquivo) — calculam `%` de uso de CPU a partir do delta de tempo ocioso entre as duas amostras. Interessante entender porque é a única métrica calculada (as outras são leituras diretas do SO).
- **`requireNonNegativeFiniteValue` / `requireNonNegativeSafeInteger` / `requireSafeProduct`** (mesmo arquivo) — funções de guarda que rejeitam valores inválidos vindos do SO (NaN, negativos, overflow) transformando-os em `Error`. É uma escolha de design deliberada: "rejeita valores inválidos ou inconsistentes em vez de normalizar silenciosamente" (comentário na classe).
- **`createServerHealthHandler`** (`src/server-health/http/server-health-handler.ts`) — ponto de tradução entre o snapshot de domínio e o payload HTTP público; útil para saber onde os nomes de campo mudam.

## Erros e casos de borda

- Qualquer inconsistência detectada pelo `NodeServerHealthReader` (ex.: `freeMemoryBytes > totalMemoryBytes`, deltas de CPU negativos, `cpuLoadAverages.length !== 3`, overflow de inteiro seguro no cálculo de bytes de disco) lança um `Error` comum (não `HttpError`), que o `createErrorHandler` trata como erro genérico → **500 `internal_error`**, sem detalhe da causa exposto ao cliente (só logado).
- Divisão por zero é tratada explicitamente: `memoryUsagePercent`/`diskUsagePercent` retornam `0` quando o total é `0`, em vez de `NaN`.
- Temperatura de CPU pode ser `null` (nem toda máquina expõe sensor) — o payload aceita isso como valor válido.
- Não há timeout explícito para `filesystemStats`/`statfs`; se o filesystem travar, a requisição fica pendurada.

## Observações

Nenhuma inconsistência de código notada. Vale registrar que, diferente das rotas `/admin/*`, aqui um erro de leitura de métricas produz um `500` genérico sem `HttpError` — ou seja, esse endpoint não tem um "vocabulário" de erro próprio, só sucesso (200) ou falha genérica (500).
