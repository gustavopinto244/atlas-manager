# Análise de lacunas — Atlas Manager 1.0.0-rc.1

> **HISTÓRICO (`1.0.0-rc.1`).** Esta análise descreve o baseline auditado em
> 2026-08-02. As classificações de CLI abaixo foram superadas pela entrega de
> ADR-027/031/032/034 antes de `1.0.0`; preserve-as como achados do RC, não como
> estado corrente. Veja `docs/capabilities.md` e a traceability v1 gerada.

## Objetivo

Este documento separa:

1. defeitos comprovados;
2. requisitos planejados mas não entregues;
3. contradições documentais;
4. lacunas operacionais ainda sem requisito;
5. escopo legitimamente deferido;
6. gates que só podem ser fechados no Atlas físico.

Não transforma toda melhoria em blocker. Os defeitos técnicos detalhados estão
em [SECURITY_REVIEW.md](SECURITY_REVIEW.md).

## Lacunas que bloqueiam o funcionamento ou a segurança

| ID           | Lacuna                                                        | Classificação                           | Evidência                                    | Necessidade              | Ação                                 |
| ------------ | ------------------------------------------------------------- | --------------------------------------- | -------------------------------------------- | ------------------------ | ------------------------------------ |
| AUD-HIGH-001 | Unit cria state directories rejeitados pelos stores           | Essencial para funcionamento            | `unit.go:24-25`; parsers de event/backup     | Bloqueia RC              | Unificar mode e testar integração    |
| AUD-HIGH-002 | Corrupt backup history falha aberta na segunda leitura        | Essencial para segurança                | `file-backup-run-store.ts:51-68`             | Bloqueia shutdown seguro | Persistir estado failed/fail-closed  |
| AUD-HIGH-003 | Sequência de backup falha após 101 e escreve antes de validar | Essencial para funcionamento            | `run-registered-backup.ts:66-70`             | Bloqueia RC              | Sequência autoritativa no store      |
| AUD-HIGH-004 | Retenção pode apagar mínimo configurado                       | Essencial para segurança                | `apply-registered-backup-retention.ts:61-88` | Bloqueia RC              | Reservar count mínimo antes de age   |
| AUD-HIGH-005 | Segundo prune de eventos quebra ledger                        | Essencial para funcionamento            | event store write/read hash discrepantes     | Bloqueia RC              | Encadear hash do record anterior     |
| AUD-HIGH-006 | Catálogo não prova rotas/policies Express reais               | Essencial para segurança                | `create-app.ts:87-142`                       | Bloqueia exposição       | Inventory única e reconciliation     |
| AUD-HIGH-007 | Replace/rollback não é atomicamente qualificado               | Essencial para segurança                | Go configuration lifecycle                   | Bloqueia recovery        | Candidate + TS parser + fault matrix |
| AUD-HIGH-008 | Evidence/contract não prova release qualificado               | Necessária antes da qualificação física | placeholders, baseline antigo, CI raso       | Bloqueia RC qualificado  | Gerar e verificar evidence real      |

## Requisitos funcionais esquecidos ou incompletos

| Tema                                                    | Origem                       | Estado encontrado                                                          | Classificação                           | Prioridade                        |
| ------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------- | --------------------------------------- | --------------------------------- |
| Checks externos de internet/DNS/public app              | FR-004, Should               | Não há capability composta                                                 | Melhoria futura                         | Backlog; proteger contra SSRF     |
| Maintenance response para indisponibilidade intencional | FR-015, Should               | Não há rota/página pública                                                 | Melhoria futura                         | Backlog                           |
| Task duration uniforme                                  | FR-034, Must                 | Timestamps/resultados existem por feature, sem contrato único demonstrável | Necessária antes de produção estável    | Completar rastreabilidade         |
| Dashboard completo                                      | FR-036, Should e ADR-022–025 | Shell básico, views e controles incompletos; fontes divergentes            | Necessária antes da qualificação física | Consolidar asset e testar browser |
| Security posture real                                   | ADR-025                      | Parte do status é hardcoded                                                | Necessária antes da qualificação física | Compor readers reais              |
| General administrative CLI                              | FR-037/ADR-025               | Explicitamente deferida                                                    | Escopo deferido                         | Não implementar no RC             |
| Docker limited logs                                     | FR-020, Could                | Ausente                                                                    | Escopo deferido                         | Backlog opcional                  |

## Contradições e precedência documental

### CLI e banco lógico

`docs/product-vision.md:112-124` e trechos históricos de initial release ainda
sugerem CLI e backup lógico. `docs/requirements.md:347-354`, ADR-023 e ADR-025,
mais recentes e específicos, deferem ambos. A decisão atual parece ser:

```text
CLI administrativa genérica → deferida
backup lógico/restore/remoto → deferido
entrypoints estreitos → mantidos
```

Lacuna: documentos antigos não estão marcados como superseded e podem induzir
um revisor a exigir ou implementar superfície perigosa.

### Release “qualified”

Roadmap, release notes, contract e evidence declaram RC qualificado. A
traceability oficial não mapeia os requisitos reais e a evidence registra gates
indisponíveis. O estado do código e a auditoria têm precedência factual sobre a
declaração. A palavra `qualified` deve ser regenerada somente após os gates.

### Contrato administrativo

O source possui serializer de descriptors completos, mas o JSON versionado é
uma lista reduzida. Não está claro se o contrato é realmente gerado ou mantido
manualmente. ADR-025 requer derivação do catálogo; a implementação encontrada
não comprova isso.

### Profile e modos do filesystem

Documentação de stores requer private mode, enquanto a unit aplica 0750. Não é
uma escolha de risco documentada; é contradição operacional direta.

## Decisões sem ADR ou sem contrato suficiente

| Tema                                     | Lacuna                                                                                  | Classificação                        | Recomendação                               |
| ---------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------ |
| Fonte única de assets                    | Três implementações: TS dashboard, route strings e Go builder                           | Recomendável para manutenção         | Registrar build pipeline e inventory owner |
| Sequência global de backup               | Coordinator infere sequência por query paginada                                         | Essencial para funcionamento         | Tornar alocação responsabilidade do store  |
| Correlation ID                           | Header existe sem lifecycle/log contract                                                | Recomendável para manutenção         | Definir propagação e retenção              |
| Capacidade/disco cheio                   | Há códigos de capacity por adapters, sem orçamento operacional global                   | Necessária antes de produção estável | Capacity runbook e alert thresholds        |
| Compatibilidade de artifacts entre RCs   | Upgrade/rollback existe, mas schema/event/backup compatibility não tem matriz explícita | Necessária antes de produção estável | Version compatibility policy               |
| Política de source maps/dashboard builds | Inventário fechado, mas source owner indefinido                                         | Recomendável para manutenção         | Contract de build                          |

## Fluxos não previstos ou insuficientemente provados

### Disco cheio

Backup, event history, exports e deployment competem por state local. Há
classificações bounded em alguns adapters, mas não foi encontrado:

- orçamento mínimo por state directory;
- alerta preventivo;
- prioridade explícita entre audit append e backup;
- runbook para event-history sem espaço;
- reserva para terminal metadata após artifact publication.

**Classificação:** Necessária antes de produção estável. Antes do drill físico,
ao menos fault injection de `ENOSPC` é necessária.

### Clock drift

Schedules, JWT, retention, event chain e release evidence dependem de tempo.
Clocks injetáveis melhoram testes, mas não há operação documentada para clock
drift/NTP indisponível nem limites de skew operacionais.

**Classificação:** Necessária antes da qualificação física para JWT/schedules;
monitoramento contínuo antes de produção estável.

### Lockout administrativo

Replacement exige administrador em intenção, mas o lifecycle não foi
qualificado. Também falta um rehearsal completo de:

```text
configuração inválida
→ serviço permanece disabled
→ rollback offline
→ parser real
→ reativação
```

**Classificação:** Essencial para segurança; `AUD-HIGH-007`.

### Migração entre release candidates

Existe migration v1→v2 de event history e upgrade/rollback de bundle, mas não
uma matriz geral de compatibilidade para:

- backup run history;
- occurrence claims/cursors;
- event-history v2;
- administrative generations;
- rollback para binary anterior após store novo.

**Classificação:** Necessária antes de produção estável.

### Múltiplos processos

Event history possui lock cross-processo. Backup usa gate process-local e
single writer assumido; systemd normalmente executa uma instância, mas não há
invariante geral impedindo dois processos contra o mesmo backup root.

**Classificação:** Necessária antes de produção estável. Ou implementar lock
cross-processo, ou impedir/provar single instance no deployment.

## Lacunas operacionais

| Tema                        | Estado                                                                       | Classificação                                    | Motivo / próximo passo                                        |
| --------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------- |
| Incident response           | SECURITY.md existe, sem playbooks por corrupção/lockout completos e testados | Necessária antes de produção estável             | Definir owner, severidade, containment e evidence             |
| Alertas                     | Logs/health existem, sem sistema de alerta externo                           | Necessária antes de produção estável             | Ao menos audit unavailable, disk, backup failure, JWKS outage |
| Monitoramento externo       | FR-004 ausente                                                               | Recomendável para manutenção                     | Separar de admin API e allowlist destinos                     |
| SLO/SLA                     | Não definido                                                                 | Recomendável para manutenção                     | Definir availability e recovery objectives                    |
| Capacidade                  | Sem sizing validado                                                          | Necessária antes da qualificação física          | Medir disco/memória/CPU no ThinkCentre                        |
| Rotação de app logs         | Event history tem retention; logs da aplicação dependem de journald          | Necessária antes de produção estável             | Documentar journald policy                                    |
| Rotação de credenciais      | Runbook identity existe em intenção; matrix incompleta                       | Necessária antes da qualificação física          | Ensaiar audience/team/JWKS rotation sem Cloudflare real       |
| Atualização de dependências | Sem policy de cadence/EOL                                                    | Recomendável para manutenção                     | Definir patch cadence e emergency update                      |
| EOL Node/Go                 | Versões registradas, mas CI Node major flutuante                             | Recomendável para manutenção                     | Pin exato e calendário de upgrade                             |
| Disaster recovery           | Backup existe sem restore                                                    | Escopo deferido, mas risco operacional explícito | Não chamar backup de recoverability                           |
| Onboarding                  | Docs extensos, precedência pouco clara                                       | Recomendável para manutenção                     | Página “start here” e ownership                               |
| Operational ownership       | Não há RACI/on-call                                                          | Recomendável para manutenção                     | Definir quem responde por audit, backup e ingress             |

## Segurança: lacunas adicionais

### Authentication e ingress

O verifier é sólido, mas readiness cached não é implementado conforme o modelo
e a qualificação real do Tunnel/Access permanece física. Antes do drill:

- corrigir Host grammar;
- testar Fetch Metadata e forwarded spoofing;
- provar status a partir de estado real;
- documentar comportamento durante outage/expired cache;
- definir relógio aceitável.

### Filesystem e TOCTOU

Adapters fazem boas inspeções, mas a qualificação deve incluir:

- modos criados pelo systemd real;
- filesystem local suportando fsync/rename semantics esperadas;
- ENOSPC em candidate/manifest/terminal metadata;
- ownership após install/upgrade/rollback;
- dois processos sobre backup root.

### Supply chain

O audit de produção é zero, porém:

- inventário transitivo de produção está incompleto;
- licenses não são fechadas pelo CI;
- Actions usam tags mutáveis;
- Node 24 não está pinado à patch;
- audit completo tem High em dependência de desenvolvimento;
- bundle/evidence duplos não foram reconstruídos.

**Classificação:** necessária antes da qualificação física para artifacts e antes
de produção estável para pinning completo.

## Observabilidade

Pontos fortes:

- Pino/structured logging;
- event history persistente separado de application logs;
- resultados bounded;
- health endpoints;
- authorization/start/terminal audit.

Lacunas:

- correlation ID não chega aos logs;
- security status é parcialmente constante;
- sem métricas agregadas/SLO;
- sem alert delivery;
- sem capacity telemetry específica para stores;
- a auditoria falha no profile devido ao mode.

Não se recomenda adicionar uma plataforma de observabilidade inteira antes do
drill. Recomenda-se corrigir correlation/status, definir logs/alertas mínimos e
medir capacidade.

## Acessibilidade, internacionalização e performance

- **Acessibilidade:** markup básico existe, mas não há teste browser/keyboard
  suficiente. Necessária antes de produção estável e recomendada antes do drill.
- **Internacionalização:** UI em inglês sem requisito de múltiplos idiomas.
  Melhoria futura.
- **Performance:** limites existem, mas não há load/capacity test do catálogo
  máximo, export 128 MiB, 100 mil backups ou event append prolongado. Necessária
  antes de produção estável.
- **Responsividade:** CSS existe em múltiplas fontes; validação visual não foi
  executada. Recomendável antes do drill.

## Disaster recovery e restore

Restore, replicação remota e recuperação física são explicitamente deferidos.
Isso não é defeito, mas implica:

```text
backup success ≠ restore comprovado
artifact local ≠ disaster recovery
retention local ≠ cópia off-site
```

Antes de produção estável, a organização deve aceitar formalmente esse risco ou
abrir ADR/issues separados. Não se deve adicionar restore à remediação deste RC.

## Prontidão física

### Software obrigatório antes do drill

1. resolver `AUD-HIGH-001` a `AUD-HIGH-008`;
2. resolver Host, exports, migration, dashboard, readiness e inventory;
3. executar Node, deployment Go e power-helper Go no mesmo commit;
4. gerar dois bundles byte-idênticos;
5. executar duas rehearsals em roots distintos;
6. recalcular contracts/evidence e obter `qualified` sem placeholders;
7. ensaiar replacement/rollback e todos os failure windows.

### Itens que pertencem ao drill físico

- ownership e group membership reais;
- service unit/hardening no host;
- Cloudflare Tunnel/Access e origin real;
- helper install separado;
- RTC read/wake observation;
- logind shutdown acceptance;
- firmware wake;
- real-effect rollback.

O helper e efeitos reais não devem ser combinados automaticamente com a primeira
instalação mock-administrativa.

## Melhorias futuras, sem bloquear o RC

- checks externos allowlisted;
- maintenance response;
- general CLI (deferida);
- Docker logs limitados;
- restore;
- backup remoto;
- SIEM;
- external signing/timestamp;
- multi-host;
- i18n;
- analytics/telemetry externa, somente com novo privacy review.

## Conclusão

O gap principal não é falta de quantidade de código. É a distância entre
componentes individualmente maduros e a prova integrada do perfil gerenciado.
O caminho correto é corrigir os oito bloqueadores, fechar as matrizes e somente
então executar a qualificação física separada.
