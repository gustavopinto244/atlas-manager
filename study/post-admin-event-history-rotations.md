# POST /admin/event-history/rotations

## Resumo

Força a rotação do segmento ativo do histórico de eventos (sela o segmento atual e abre um novo). Existe para permitir manutenção manual do log de eventos (por exemplo, antes de uma exportação ou poda), sem esperar o segmento atingir seu limite automático de tamanho/contagem.

## Contrato

- **Método/Path**: `POST /admin/event-history/rotations`
- **Handler**: variante `"rotation"` em `process()` (`src/http/administrative-event-history-operations-route.ts`).
- **Catálogo**: routeId `event_history.rotation.run`, operação `rotate_event_history`, permissão `event_history.rotation.run`, activationFlag `ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED`, `confirmationPolicy: "exact:confirm_administrative_event_history_rotation"`, `gatePolicy: "event_history_maintenance"`, `replayPolicy: "conflict_protected"`.
- **Autenticação/Autorização**: exige permissão `event_history.rotation.run`. Roles com acesso: `audit_operator`, `administrator` (não `auditor` — auditor só lê/exporta, não roda manutenção).
- **Parâmetros de rota**: nenhum. **Query string**: não aceita.
- **Corpo da requisição**: JSON obrigatório, `Content-Type: application/json` (ou `application/json; charset=utf-8`), até 8 KiB, UTF-8 válido, JSON estritamente parseado (sem chaves duplicadas — ver `parseStrictJson`). Corpo deve ser **exatamente** `{ "confirmation": "confirm_administrative_event_history_rotation" }` — nenhum outro campo, nenhum campo faltando.
- **Formato da resposta** (200, `application/json`): o retorno bruto de `rotateEventHistory.execute()` (`Readonly<{ outcome: "rotated" | "unchanged" | "recovery_required" }>`), enviado sem mapeamento adicional (ao contrário de integrity/retention/exports, aqui não há função `mapEventHistory*` — é serializado como veio da camada de aplicação).
- **Códigos de status possíveis**:
  - `200` — rotação executada (outcome pode ser `rotated`, `unchanged` ou `recovery_required`, todos com 200).
  - `400 invalid_event_history_request` — corpo ausente de confirmação exata, JSON malformado, ou payload não-UTF-8.
  - `401`/`403`/`503` — falhas de autenticação/autorização/auditoria.
  - `405 method_not_allowed` — método diferente de POST.
  - `409 event_history_retention_busy` — outra operação de manutenção do histórico já está em andamento (gate compartilhado).
  - `409 event_history_writer_busy` / `410 event_history_pruned` / `503 ...` — erros vindos da camada de armazenamento (`SegmentedEventHistoryError`).
  - `413 payload_too_large` — corpo acima de 8 KiB.
  - `415 unsupported_media_type` — `Content-Type` incorreto ou `Content-Encoding` presente.
  - `429 administrative_request_limited` — limite de requisições excedido.

## Caminho da requisição

- `handler(dependencies, "rotation")` aplica cabeçalhos de segurança e admissão de taxa (encanamento comum às 8 sub-rotas deste arquivo).
- `process`, ramo `kind === "rotation"`: exige método POST, rejeita query, lê e faz parse do corpo com `bodyJson` (valida `Content-Type`, `Content-Encoding`, tamanho máximo, UTF-8 e JSON estrito), depois `exactConfirmation(body, "confirm_administrative_event_history_rotation")` — exige que o corpo tenha **exatamente** uma chave `confirmation` com esse valor exato. Tudo isso é encanamento de validação de entrada, mas com uma intenção deliberada: exigir confirmação explícita evita rotação acidental por engano de cliente.
- Chama `mutate(dependencies, () => protectedAdministration().rotateEventHistory.execute())`. **`mutate`** (mesmo arquivo) é a peça de proteção contra concorrência: tenta admitir no `dependencies.mutationGate` (uma instância `FixedAdministrativePowerOperationGate` — permite só uma operação por vez); se já houver uma mutação de histórico em andamento, lança 409 `event_history_retention_busy` **antes** de sequer autenticar o request. Esse gate é compartilhado entre todas as mutações de `/admin/event-history/*` (rotation, retention update, segmentPrune, exports create, exportPrune) — só uma delas roda por vez em todo o processo.
- **Lógica de negócio de verdade**: dentro de `rotateEventHistory.execute()` (`create-protected-administration.ts`), passa por `runEventHistoryMutation("rotate_administrative_event_history", () => requireEventHistoryOperations().rotate())`, que por sua vez: autentica/autoriza via `runner.run`, abre um registro de auditoria "iniciado" (`operationAudit.begin`), executa `rotate()` (na infraestrutura segmentada — sela o segmento atual, cria um novo), e fecha o registro de auditoria como `succeeded`/`failed`.
- Resposta enviada por `send()` (limite de 1 MiB, `application/json`).

## Funções-chave

- **`mutate`** (`administrative-event-history-operations-route.ts`) — o mecanismo de exclusão mútua entre operações de manutenção do histórico. Decide se a rotação pode prosseguir ou se deve ser recusada de imediato com 409, sem gastar autenticação/autorização.
- **`exactConfirmation`** (mesmo arquivo) — exige que o corpo seja um objeto com exatamente uma chave (`confirmation`) igual à string de confirmação esperada. Não aceita campos extras nem confirmação parcial — é a barreira contra rotação disparada por acidente (ex. corpo vazio `{}` ou corpo de outra rota reaproveitado).
- **`runEventHistoryMutation`** (`create-protected-administration.ts`) — envolve toda mutação de histórico em um par begin/complete de auditoria, garantindo que mesmo uma falha durante a rotação deixe rastro (`failed`) no log de eventos administrativos.
- **`rotate()`** (implementação em `src/event-history/infrastructure/file-segmented-administrative-event-history.ts`, não detalhada aqui) — a operação real que sela o segmento ativo e inicia um novo; decide entre `rotated`, `unchanged` (nada a rotacionar) ou `recovery_required`.
- **`mapError`** (`administrative-event-history-operations-route.ts`) — traduz falhas de `SegmentedEventHistoryError` em 409/410/503 conforme o código.

## Erros e casos de borda

- Corpo `{}` (vazio), `{"confirmation": "algo errado"}`, ou `{"confirmation": "...", "extra": 1}` são todos 400 — `exactConfirmation` exige exatamente uma chave com o valor certo.
- JSON com chaves duplicadas é rejeitado por `parseStrictJson` (400) antes mesmo de checar a confirmação.
- Corpo maior que 8 KiB é cortado no meio da leitura de stream e rejeitado com 413, sem tentar fazer parse.
- `Content-Encoding` presente (mesmo `identity`, pela checagem `!== undefined`) é rejeitado com 415 — a rota não aceita corpo comprimido de forma alguma.
- Duas rotações simultâneas: a segunda recebe 409 `event_history_retention_busy` imediatamente — não fica na fila, não espera a primeira terminar.
- `outcome: "recovery_required"` retorna 200, não um erro — o cliente precisa inspecionar o corpo da resposta para saber se a rotação de fato aconteceu ou se requer intervenção manual (recuperação de estado inconsistente).

## Observações

- Diferente de `retention` (PUT) e `exports` (POST), a resposta desta rota não passa por nenhuma função `mapEventHistory*` — o objeto de aplicação é serializado como veio. Isso significa que qualquer campo futuro adicionado ao retorno de `rotate()` vaza diretamente para o cliente HTTP sem filtro, ao contrário do padrão mais defensivo usado nas outras sub-rotas (ex. `mapEventHistoryIntegrity` que só inclui campos definidos).
