# Guia de estudos — rotas HTTP do atlas-manager

Um documento por rota HTTP registrada na aplicação. Cada arquivo segue a
mesma estrutura: Resumo, Contrato, Caminho da requisição, Funções-chave,
Erros e casos de borda e, quando aplicável, Observações (bugs ou
inconsistências encontradas no código, sem correção).

Único servidor HTTP do repo: `src/http/create-app.ts`. As rotas
`/health/*` são registradas diretamente nele; todas as demais (`/`,
`/assets/*`, `/admin/*`) são declaradas como dados em
`src/http/administrative-route-security-catalog.ts` e montadas via
`registerAdministrativeRoute()`.

## Health

- [GET /health/live](get-health-live.md)
- [GET /health/server](get-health-server.md)

## Dashboard

- [GET /](get-root.md)
- [GET /assets/:asset](get-assets-asset.md)

## Overview

- [GET /admin/overview](get-admin-overview.md)

## Event history

- [GET /admin/event-history](get-admin-event-history.md)
- [GET /admin/event-history/integrity](get-admin-event-history-integrity.md)
- [POST /admin/event-history/rotations](post-admin-event-history-rotations.md)
- [GET /admin/event-history/retention](get-admin-event-history-retention.md)
- [PUT /admin/event-history/retention](put-admin-event-history-retention.md)
- [POST /admin/event-history/retention/prunes](post-admin-event-history-retention-prunes.md)
- [GET /admin/event-history/exports](get-admin-event-history-exports.md)
- [POST /admin/event-history/exports](post-admin-event-history-exports.md)
- [GET /admin/event-history/exports/:exportId](get-admin-event-history-exports-export-id.md)
- [GET /admin/event-history/exports/:exportId/content](get-admin-event-history-exports-export-id-content.md)
- [POST /admin/event-history/exports/retention/prunes](post-admin-event-history-exports-retention-prunes.md)

## Power

- [GET /admin/power/wake-alarm](get-admin-power-wake-alarm.md)
- [PUT /admin/power/wake-alarm](put-admin-power-wake-alarm.md)
- [DELETE /admin/power/wake-alarm](delete-admin-power-wake-alarm.md)
- [POST /admin/power/shutdown/preparations](post-admin-power-shutdown-preparations.md)
- [POST /admin/power/shutdown/executions](post-admin-power-shutdown-executions.md)

## Services

- [GET /admin/services](get-admin-services.md)
- [GET /admin/services/:serviceId](get-admin-services-service-id.md)
- [GET /admin/services/:serviceId/logs](get-admin-services-service-id-logs.md)
- [GET /admin/services/:serviceId/resources](get-admin-services-service-id-resources.md)
- [POST /admin/services/:serviceId/actions/start](post-admin-services-service-id-actions-start.md)
- [POST /admin/services/:serviceId/actions/stop](post-admin-services-service-id-actions-stop.md)
- [POST /admin/services/:serviceId/actions/restart](post-admin-services-service-id-actions-restart.md)
- [GET /admin/services/:serviceId/availability](get-admin-services-service-id-availability.md)
- [PUT /admin/services/:serviceId/availability](put-admin-services-service-id-availability.md)
- [DELETE /admin/services/:serviceId/availability](delete-admin-services-service-id-availability.md)
- [GET /admin/services/:serviceId/availability/preview](get-admin-services-service-id-availability-preview.md)

## Scheduling (serviço e máquina)

- [GET /admin/services/:serviceId/schedule](get-admin-services-service-id-schedule.md)
- [PUT /admin/services/:serviceId/schedule](put-admin-services-service-id-schedule.md)
- [DELETE /admin/services/:serviceId/schedule](delete-admin-services-service-id-schedule.md)
- [GET /admin/services/:serviceId/schedule/preview](get-admin-services-service-id-schedule-preview.md)
- [GET /admin/machine/schedule](get-admin-machine-schedule.md)
- [PUT /admin/machine/schedule](put-admin-machine-schedule.md)
- [DELETE /admin/machine/schedule](delete-admin-machine-schedule.md)
- [GET /admin/machine/schedule/preview](get-admin-machine-schedule-preview.md)

## Backups

- [GET /admin/backups/targets](get-admin-backups-targets.md)
- [GET /admin/backups/targets/:targetId](get-admin-backups-targets-target-id.md)
- [GET /admin/backups/runs](get-admin-backups-runs.md)
- [GET /admin/backups/runs/:runId](get-admin-backups-runs-run-id.md)
- [POST /admin/backups/targets/:targetId/runs](post-admin-backups-targets-target-id-runs.md)
- [GET /admin/backups/targets/:targetId/schedule](get-admin-backups-targets-target-id-schedule.md)
- [PUT /admin/backups/targets/:targetId/schedule](put-admin-backups-targets-target-id-schedule.md)
- [DELETE /admin/backups/targets/:targetId/schedule](delete-admin-backups-targets-target-id-schedule.md)
- [GET /admin/backups/targets/:targetId/retention](get-admin-backups-targets-target-id-retention.md)
- [PUT /admin/backups/targets/:targetId/retention](put-admin-backups-targets-target-id-retention.md)
- [POST /admin/backups/targets/:targetId/retention/prunes](post-admin-backups-targets-target-id-retention-prunes.md)
- [POST /admin/backups/scheduler/ticks](post-admin-backups-scheduler-ticks.md)

## Segurança e infraestrutura

- [GET /admin/security/status](get-admin-security-status.md)
- [GET /admin/infrastructure/diagnostics](get-admin-infrastructure-diagnostics.md)

## Observações consolidadas

Achados de bugs/inconsistências que apareceram durante a geração destes
documentos (detalhados na seção "Observações" de cada arquivo
correspondente):

- **PUT /admin/services/:serviceId/availability** — erro de política
  inválida (`invalid_service_availability_policy`) não é reconhecido por
  `mapAvailabilityError`, resultando em `503` em vez de `400`.
- **PUT /admin/event-history/retention** — erro de validação de política
  (`event_history_retention_invalid`) também não é mapeado, com o mesmo
  efeito de `503` em vez de `400`.
- **Limite de tamanho de corpo divergente**: o catálogo declara
  `maxBodyBytes: 8192` para mutações de backups e de agendamento, mas os
  handlers reais aplicam `MAX_BODY_BYTES = 4096`.
- **Gate de mutação compartilhado**: o "gate" de operações de backup
  (`backup_operation`) é, na composição real, a mesma instância usada
  por serviços/disponibilidade/agendamento de máquina — não é dedicado,
  apesar do rótulo próprio no catálogo.
- **`POST /admin/event-history/exports`** — possível mismatch de tipos:
  o resultado retornado pelo caso de uso não bate com o formato esperado
  pelo mapper de resposta.
- **`GET /admin/services/:serviceId`** — campo `dependents` sempre
  retorna vazio (`Object.freeze([])`), parece não implementado.
- Vários outros achados menores (audit label divergente, branch morto,
  campo de query nunca usado, docstring desatualizada) estão registrados
  nos documentos individuais correspondentes.
