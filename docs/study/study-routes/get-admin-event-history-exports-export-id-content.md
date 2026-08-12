# GET /admin/event-history/exports/:exportId/content

## Resumo

Baixa o conteúdo bruto (arquivo NDJSON) de uma exportação do histórico de eventos já criada. Existe para permitir ao operador obter o arquivo assinado por hash para arquivamento externo ou verificação offline.

## Contrato

- **Método/Path**: `GET /admin/event-history/exports/:exportId/content`
- **Handler**: variante `"download"` em `process()` (`src/http/administrative-event-history-operations-route.ts`), no mesmo bloco final compartilhado com `"export"` que valida o formato de `exportId`.
- **Catálogo**: routeId `event_history.export.download`, operação `download_event_history_export`, permissão `event_history.exports.download`, activationFlag `ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED`, `confirmationPolicy: "none"`, `gatePolicy: "none"`, `replayPolicy: "read_only"`, `responsePolicy: "download"` (a única rota deste conjunto marcada assim no catálogo).
- **Autenticação/Autorização**: exige permissão `event_history.exports.download`. Roles: `auditor`, `audit_operator`, `administrator` (nota: distinta de `event_history.exports.read`, usada por list/read — ver `OPERATION_PERMISSIONS`).
- **Parâmetros de rota**: `exportId` — mesma validação hex-64 que a rota de metadados; formato inválido → 404 antes de checar o `kind`. **Query string**: não aceita.
- **Corpo da requisição**: não aceito.
- **Formato da resposta** (200): **não é JSON**. `Content-Type: application/x-ndjson`, corpo é o `Buffer` bruto do arquivo de exportação (linhas NDJSON: cabeçalho, uma linha por evento, rodapé com hash). Headers adicionais: `Content-Disposition: attachment; filename="atlas-manager-event-history-<exportId>.jsonl"`, `Cache-Control: no-store, private` (redundante com o cabeçalho de segurança padrão, setado de novo explicitamente aqui), `Accept-Ranges: none` (deixa explícito que não há suporte a download parcial/retomada por Range).
- **Códigos de status possíveis**:
  - `200` — conteúdo devolvido.
  - `400 invalid_administrative_request` — query ou corpo indevidos.
  - `401`/`403`/`503` — autenticação/autorização/auditoria.
  - `404 event_history_export_not_found` — `exportId` malformado ou exportação inexistente (mesma dinâmica da rota de metadados).
  - `405 method_not_allowed` — método diferente de GET.
  - `429 administrative_request_limited` — limite de requisições.
  - `500 internal_error` — o valor devolvido por `downloadEventHistoryExport.execute` não é um `Buffer` (defesa de tipo — ver Funções-chave).

## Caminho da requisição

- Mesmo encanamento comum (`handler`/`process`) e mesma validação de formato de `exportId` da rota de metadados (`get-admin-event-history-exports-export-id.md`).
- Para `kind === "download"` (o `else` final, depois do `if (kind === "export")`): exige GET, rejeita query, exige ausência de corpo, chama `protectedAdministration().downloadEventHistoryExport.execute(exportId)`.
- **Lógica de negócio de verdade**: `downloadEventHistoryExport.execute(exportId)` (`create-protected-administration.ts`) → `runner.run("download_event_history_export", () => requireEventHistoryOperations().readExport(exportId))` — autentica, autoriza contra `event_history.exports.download`, audita, delega a leitura do arquivo bruto à infraestrutura (`readExport`, que devolve um `Buffer`).
- De volta no handler HTTP: `if (!Buffer.isBuffer(content)) throw new HttpError(500, ...)` — checagem de tipo defensiva antes de enviar. Se passar, monta a resposta manualmente com `response.status(200).type("application/x-ndjson").setHeader(...).send(content)` — **não** usa a função `send()` compartilhada (que serializa JSON e aplica o limite de 1 MiB); aqui o corpo é binário e não passa por esse teto.

## Funções-chave

- **Checagem `Buffer.isBuffer(content)`** (`administrative-event-history-operations-route.ts`) — é a única validação de forma da resposta nesta rota; se a camada de aplicação devolver algo que não seja um `Buffer` (ex. erro de composição/tipo), a rota falha com 500 em vez de vazar dado malformado como se fosse o arquivo.
- **`readExport(exportId)`** (implementação em `file-segmented-administrative-event-history.ts`, não detalhada aqui) — lê o arquivo de exportação persistido (o mesmo conteúdo gerado por `createExport`, com cabeçalho/linhas/rodapé assinados) e devolve como `Buffer`.
- **Bloco de headers de download** (`administrative-event-history-operations-route.ts`, final de `process`) — decide o `Content-Type`, o nome do arquivo sugerido (`Content-Disposition`) e explicitamente desabilita `Range` requests (`Accept-Ranges: none`) — decisão deliberada de não suportar downloads retomáveis/parciais.

## Erros e casos de borda

- `exportId` malformado ou inexistente: mesmo comportamento 404 da rota de metadados (ver `get-admin-event-history-exports-export-id.md`).
- Diferente de todas as outras sub-rotas deste arquivo, a resposta aqui não passa pelo limite de 1 MiB de `send()` — um arquivo de exportação pode chegar a `EVENT_HISTORY_MAX_EXPORT_BYTES` (128 MiB, ver `src/event-history/domain/event-history-record.ts`) sem ser rejeitado por tamanho de resposta.
- `Accept-Ranges: none` significa que um cliente HTTP que tente retomar um download interrompido com `Range:` não terá esse pedido respeitado de forma correta — o servidor sempre reenvia o arquivo inteiro (o header apenas sinaliza a ausência de suporte, mas a rota não implementa lógica alguma para interpretar `Range`).
- `filename` no `Content-Disposition` é montado por interpolação de string direta com `exportId` (`atlas-manager-event-history-${exportId}.jsonl`) — como `exportId` já foi validado pela regex `^[0-9a-f]{64}$` antes de chegar aqui, não há risco de injeção de header via esse valor.

## Observações

- Esta é a única rota do conjunto marcada como `responsePolicy: "download"` no catálogo (`src/http/administrative-route-security-catalog.ts`) e a única cuja resposta não é JSON — vale notar para quem for construir um cliente genérico para `/admin/event-history/*`: assumir sempre `application/json` quebraria aqui.
- A permissão exigida (`event_history.exports.download`) é distinta da permissão de leitura de metadados (`event_history.exports.read`) — ambas as permissões, porém, estão atribuídas às mesmas roles (`auditor`, `audit_operator`, `administrator`) em `ADMINISTRATIVE_ROLE_PERMISSIONS`, então na prática hoje não há uma role que possa ver metadados de exportação mas não baixar o conteúdo, ou vice-versa. A separação existe no modelo de permissões, mas não é (ainda) explorada por nenhuma role real.
