# Plano de remediação — Atlas Manager 1.0.0-rc.1

## Princípios

- corrigir primeiro integridade e comportamento fail-closed;
- não avançar ao host físico enquanto o perfil gerenciado falha em sandbox;
- manter restore, remote backup, SIEM, CLI geral e efeitos reais fora deste
  ciclo;
- cada correção deve ser uma Issue/branch pequena, com fault injection;
- contracts e evidence só são regenerados depois das correções funcionais;
- nenhuma tarefa deste plano foi implementada durante a auditoria.

## Ordem executiva

```text
filesystem modes
  → backup reconstruction/sequence/retention
  → event retention/export/migration
  → route reconciliation/security envelope
  → configuration generations
  → dashboard/readiness
  → test/release generators
  → bundle/rehearsal duplos
  → physical qualification
```

## 1. Bloqueadores imediatos

### REM-001 — Unificar modos dos state directories

- **Achado:** AUD-HIGH-001
- **Descrição:** alinhar unit systemd, installers, verifiers e parsers para que
  backup e event history recebam os modos privados realmente aceitos.
- **Justificativa:** o perfil gerenciado atualmente bloqueia primeiro audit e
  primeiro backup.
- **Arquivos prováveis:** `deployment/internal/systemdunit/`,
  `deployment/internal/servicelifecycle/`,
  `src/event-history/infrastructure/file-segmented-administrative-event-history.ts`,
  `src/backup-management/infrastructure/file-backup-run-store.ts`.
- **Dependências:** decidir um único contrato de ownership/mode; sem dependency
  nova.
- **Risco:** alteração incorreta pode afrouxar state privado ou quebrar upgrade.
- **Esforço:** Médio
- **Critério de aceite:** roots criados pelo unit contract são aceitos pelos dois
  stores; first audit e first backup persistem; group/world writable rejeitam.
- **Testes:** integração unit text→sandbox mode→TypeScript parsers, activation,
  upgrade e rollback.
- **Ordem:** 1

### REM-002 — Tornar reconstrução de backup permanentemente fail-closed

- **Achado:** AUD-HIGH-002
- **Descrição:** só marcar o store carregado após reconstrução integral ou manter
  estado terminal de erro.
- **Justificativa:** corrupção não pode desaparecer após uma leitura.
- **Arquivos prováveis:** `file-backup-run-store.ts`,
  `create-backup-management.ts` e testes de reconstruction/readiness.
- **Dependências:** nenhuma.
- **Risco:** concorrência de chamadas iniciais precisa de coordenação.
- **Esforço:** Pequeno
- **Critério de aceite:** toda leitura repetida de store corrompido falha; shutdown
  readiness permanece unavailable.
- **Testes:** malformed line, truncated line, unsafe metadata, leitura repetida e
  concorrente.
- **Ordem:** 2

### REM-003 — Mover alocação/validação de sequência para o backup store

- **Achado:** AUD-HIGH-003
- **Descrição:** eliminar inferência por query limit 100 e validar transição antes
  do append durável.
- **Justificativa:** sequência é propriedade de persistência, não de paginação.
- **Arquivos prováveis:** backup run store port, in-memory/file stores,
  `run-registered-backup.ts`.
- **Dependências:** REM-002.
- **Risco:** mudança de port afeta scheduler e tests.
- **Esforço:** Médio
- **Critério de aceite:** 1.000+ runs e restart preservam sequência; failure não
  deixa line inválida.
- **Testes:** boundaries, two store instances, append fault injection e
  reconstruction.
- **Ordem:** 3

### REM-004 — Corrigir retenção combinada e paginação de backup

- **Achado:** AUD-HIGH-004
- **Descrição:** reservar `keepLastSuccessful`, paginar todo managed set e então
  aplicar age aos elegíveis.
- **Justificativa:** política atual pode apagar o mínimo prometido.
- **Arquivos prováveis:** `apply-registered-backup-retention.ts`, query port e
  testes retention.
- **Dependências:** REM-003.
- **Risco:** seleção incorreta causa perda irreversível.
- **Esforço:** Médio
- **Critério de aceite:** mínimo nunca removido, mesmo por age; >100 artifacts
  avaliados determinística e bounded.
- **Testes:** count/age/both, exact boundary, >100, unknown, partial deletion.
- **Ordem:** 4

### REM-005 — Corrigir chain da retention ledger

- **Achado:** AUD-HIGH-005
- **Descrição:** usar o `retentionRecordSha256` anterior como predecessor e
  compartilhar uma função canônica entre writer/verifier.
- **Justificativa:** a segunda operação normal quebra todo audit store.
- **Arquivos prováveis:** segmented event-history store e golden tests.
- **Dependências:** nenhuma.
- **Risco:** compatibilidade com ledgers já produzidas deve ser explicitada; não
  reparar automaticamente.
- **Esforço:** Pequeno
- **Critério de aceite:** três+ prunes resultam
  `verified_with_retention`; tamper em qualquer record resulta broken.
- **Testes:** multi-prune, restart, mutation/delete/reorder ledger.
- **Ordem:** 5

### REM-006 — Criar reconciliação real catálogo↔rotas↔policies

- **Achado:** AUD-HIGH-006
- **Descrição:** transformar route inventory em fonte tipada única para
  descriptor, registro e contract, ou comparar a inventory real antes de
  listening.
- **Justificativa:** a principal garantia v0.9 atualmente não existe.
- **Arquivos prováveis:** `administrative-route-security-catalog.ts`,
  `create-app.ts`, todos os route factories, `administrative-api-contract.ts`.
- **Dependências:** estabilizar policies atuais; sem framework novo.
- **Risco:** refactor transversal pode alterar activation semantics.
- **Esforço:** Grande
- **Critério de aceite:** qualquer missing/extra/method/path/flag/parser/gate/
  confirmation/audit/op/permission mismatch bloqueia startup; contract é
  derivado da mesma inventory.
- **Testes:** mutation matrix de descriptor/handler e toda route matrix.
- **Ordem:** 6

### REM-007 — Reimplementar replace/rollback como geração transacional

- **Achado:** AUD-HIGH-007
- **Descrição:** candidate verificada pelo parser TypeScript real, hashes de
  current/previous input/env, journal e publicação/reconstruction determinísticos.
- **Justificativa:** recovery de identidade não pode criar lockout.
- **Arquivos prováveis:** `deployment/internal/administrativeconfiguration/`,
  maintenance/config validation TypeScript e rehearsal.
- **Dependências:** contrato de invocação offline do parser; Go permanece stdlib.
- **Risco:** interoperabilidade Go/TypeScript e crash windows.
- **Esforço:** Grande
- **Critério de aceite:** cada falha deixa current anterior válido ou
  recovery_required; rollback usa somente previous managed e nunca ativa.
- **Testes:** todas as failure windows do Issue, no-admin, modified generation,
  interrupted transaction e exact confirmation.
- **Ordem:** 7

### REM-008 — Revogar e regenerar a qualificação do RC

- **Achado:** AUD-HIGH-008
- **Descrição:** tratar evidence atual como inválida; criar generators offline
  estritos para contract, traceability, evidence e release gate.
- **Justificativa:** não se deve corrigir placeholders manualmente nem manter
  `qualified` sem gates.
- **Arquivos prováveis:** `docs/contracts/`, `docs/release/`,
  `.github/workflows/ci.yml`, release tooling Go/TS.
- **Dependências:** REM-001 a REM-007 e tarefas de testes abaixo.
- **Risco:** generator que lê artifacts stale repete o problema.
- **Esforço:** Grande
- **Critério de aceite:** commit/baseline/version corretos; zero placeholders;
  digests recalculáveis; todos os Must individualmente mapeados; dois
  bundles/rehearsals idênticos; unavailable nunca vira qualified.
- **Testes:** tamper/version/missing requirement/missing license/different
  evidence/bundle.
- **Ordem:** última correção imediata e primeiro novo candidate.

## 2. Antes da qualificação física

### REM-009 — Fechar parser de Host e browser-security matrix

- **Achados:** AUD-MED-001, AUD-MED-007
- **Descrição:** gramática exata de authority e testes Host/Origin/Fetch
  Metadata/forwarded/preflight para cada categoria.
- **Justificativa:** defesa no ingress deve estar provada antes do Tunnel real.
- **Arquivos:** `administrative-public-origin.ts`,
  `administrative-security-envelope.ts`, HTTP tests.
- **Dependências:** REM-006.
- **Risco:** rejeitar proxy legítimo se authority canonical real não estiver
  documentada.
- **Esforço:** Médio
- **Critério de aceite:** somente public authority exata; spoof/cross-site não
  alcançam autenticação; no CORS.
- **Testes:** toda browser-security matrix da Issue.
- **Ordem:** 9

### REM-010 — Completar invariantes de export

- **Achado:** AUD-MED-002
- **Descrição:** inventory fechado, parser header/event/footer, ID content-derived
  e validação manifest/content bidirecional.
- **Justificativa:** export é evidence privada e retention não pode ignorar
  unknown state.
- **Arquivos:** segmented event-history store e export tests.
- **Dependências:** REM-005.
- **Risco:** exports existentes incompatíveis devem falhar fechado, não ser
  reparados.
- **Esforço:** Médio
- **Critério de aceite:** orphan/mismatch/footer/collision bloqueiam; equivalent
  export unchanged.
- **Testes:** tamper e concurrent download/prune.
- **Ordem:** 10

### REM-011 — Tornar migração v1 atomicamente publicável

- **Achado:** AUD-MED-003
- **Descrição:** candidate root no mesmo filesystem, verifier integral, receipt
  estrito e rename final.
- **Justificativa:** version-one real não pode ficar com v2 parcial.
- **Arquivos:** `src/maintenance/event-history.ts`, migration/store tests.
- **Dependências:** REM-005 e REM-010.
- **Risco:** filesystem rename/root ownership.
- **Esforço:** Médio
- **Critério de aceite:** interrupção pré-publicação não cria store final;
  source preservada; repeated migration unchanged.
- **Testes:** failure injection por etapa e changing source bytes.
- **Ordem:** 11

### REM-012 — Consolidar o dashboard em uma fonte de build

- **Achado:** AUD-MED-004
- **Descrição:** remover assets divergentes, compilar source TS existente,
  inventory fechada compartilhada e implementar sections declaradas.
- **Justificativa:** operador precisa de superfície realmente entregue e
  testável.
- **Arquivos:** `src/dashboard/`, dashboard route, bundle builder e tests.
- **Dependências:** REM-006; contratos de API estabilizados.
- **Risco:** CSP/assets digest e bundle reproducibility.
- **Esforço:** Grande
- **Critério de aceite:** overview/services/availability/backup/audit/security
  operam por capabilities; sem storage/unsafe DOM/optimism; mesmo digest no
  source e bundle.
- **Testes:** DOM/browser, a11y/keyboard/responsive, role controls, escaping,
  confirmations e rereads.
- **Ordem:** 12

### REM-013 — Fazer identity/security readiness refletir estado real

- **Achado:** AUD-MED-005
- **Descrição:** implementar `ready_with_cached_keys`, métricas bounded do cache
  e readers reais para catalog/feature/loopback/audit.
- **Justificativa:** status hardcoded não é evidence operacional.
- **Arquivos:** authentication composition, administrative runtime/status route.
- **Dependências:** REM-006.
- **Risco:** não expor issuer/audience/kid.
- **Esforço:** Médio
- **Critério de aceite:** todos os outcomes testados; mismatch não aparece ready;
  cache outage é distinguido.
- **Testes:** JWKS rotation/outage/expiry/duplicate/unknown kid e catalog mismatch.
- **Ordem:** 13

### REM-014 — Gerar inventário transitivo de dependencies/licenses

- **Achado:** AUD-MED-006
- **Descrição:** derivar offline do lockfile toda árvore production com licença,
  integrity e direct flag.
- **Justificativa:** release deve revisar todo código runtime.
- **Arquivos:** release tooling, JSON inventory e CI.
- **Dependências:** nenhuma dependency nova.
- **Risco:** optional/platform packages e licenças compostas.
- **Esforço:** Médio
- **Critério de aceite:** fechamento igual a `npm ls --omit=dev --all`; missing
  license falha; output determinístico.
- **Testes:** lockfile fixtures e tamper.
- **Ordem:** 14

### REM-015 — Executar qualificação completa no commit candidato

- **Achados:** AUD-MED-007, AUD-HIGH-008
- **Descrição:** Node, Go deployment, Go helper, bundle duplo, inspect, packaged
  smoke e rehearsal duplo em roots distintos.
- **Justificativa:** a validação local desta auditoria não tinha Go e não
  recompilou bundle.
- **Arquivos:** CI/rehearsal, sem alterar resultado manualmente.
- **Dependências:** REM-001 a REM-014.
- **Risco:** artifacts stale ou environment leakage.
- **Esforço:** Grande
- **Critério de aceite:** todos passam; evidence bytes iguais; nenhum recurso
  real acessado.
- **Testes:** release matrix completa.
- **Ordem:** 15

## 3. Antes de produção estável

### REM-016 — Fechar política operacional de capacidade e ENOSPC

- **Achados:** GAP operacional, relacionado a AUD-HIGH-003/004/005
- **Descrição:** definir thresholds, reserva para metadata/audit, alertas e
  runbooks de disco cheio.
- **Justificativa:** quatro stores competem por disco local.
- **Arquivos:** config/readers/runbooks/tests.
- **Dependências:** stores corrigidos.
- **Risco:** política de prune não deve apagar unknown state.
- **Esforço:** Médio
- **Critério de aceite:** failure injection em todas as publication stages e
  alerta antes do limite.
- **Testes:** ENOSPC candidate/manifest/terminal/journal.
- **Ordem:** 16

### REM-017 — Definir compatibilidade de schemas e rollback entre releases

- **Achados:** GAP de migração
- **Descrição:** matriz de quais binaries leem backup/event/config states de
  versões adjacentes.
- **Justificativa:** rollback de binary pode encontrar schema mais novo.
- **Arquivos:** ADR, deployment verifier, rehearsal.
- **Dependências:** REM-007/011.
- **Risco:** rollback destrutivo não deve ser improvisado.
- **Esforço:** Grande
- **Critério de aceite:** upgrade/rollback por versão com resultado explicitamente
  supported/blocked.
- **Testes:** fixtures de cada schema.
- **Ordem:** 17

### REM-018 — Definir single-writer de backup entre processos

- **Achado:** GAP de multiprocess
- **Descrição:** lock cross-processo ou invariant systemd verificado.
- **Justificativa:** process-local gate não protege dois processos sobre JSONL.
- **Arquivos:** backup infrastructure/composition/deployment.
- **Dependências:** REM-003.
- **Risco:** stale-lock recovery complexa; evitar copiar permissive pattern.
- **Esforço:** Grande
- **Critério de aceite:** duas instâncias não duplicam sequence/effect.
- **Testes:** separate-process fixture, stale/busy/invalid.
- **Ordem:** 18

### REM-019 — Propagar correlation ID

- **Achado:** AUD-LOW-001
- **Descrição:** contexto request-scoped para logs e coordenação interna.
- **Justificativa:** melhora incident response sem criar idempotency/auth input.
- **Arquivos:** administrative HTTP, logger/error handler.
- **Dependências:** REM-006.
- **Risco:** não persistir header não confiável ou PII.
- **Esforço:** Pequeno
- **Critério de aceite:** ID interno em response/logs, caller ID nunca
  authoritative.
- **Testes:** success/error/concurrency/spoof.
- **Ordem:** 19

### REM-020 — Refinar Fetch Metadata por response category

- **Achado:** AUD-LOW-002
- **Descrição:** allowlists de mode/dest para shell/assets/API.
- **Justificativa:** fecha defesa browser complementar.
- **Arquivos:** envelope e catalog response policy.
- **Dependências:** REM-006/009.
- **Risco:** compatibilidade entre browsers; ausência continua aceita para
  clientes não-browser.
- **Esforço:** Pequeno
- **Critério de aceite:** combinações legítimas passam e contextos estranhos
  rejeitam.
- **Testes:** matrix mode/dest/site.
- **Ordem:** 20

### REM-021 — Pin de Actions e toolchain exata

- **Achado:** AUD-LOW-004
- **Descrição:** Actions por commit SHA e Node/npm/Go conforme contract.
- **Justificativa:** build reproducível não deve flutuar por tag/major.
- **Arquivos:** `.github/workflows/ci.yml`, toolchain docs.
- **Dependências:** processo de atualização.
- **Risco:** manutenção de pins.
- **Esforço:** Pequeno
- **Critério de aceite:** mismatch impede release e updates são reviewáveis.
- **Testes:** CI/toolchain validator.
- **Ordem:** 21

## 4. Melhorias arquiteturais

### REM-022 — Reduzir duplicação TypeScript/Go por contrato canônico

- **Achados:** AUD-HIGH-007/008
- **Descrição:** Go continua stdlib, mas consome/valida um schema/contract gerado
  e confirma o resultado com o parser TypeScript de produção.
- **Justificativa:** regras duplicadas já divergiram.
- **Arquivos:** config parsers, contracts, deployment tooling.
- **Dependências:** REM-007.
- **Risco:** não introduzir runtime dependency nem parser permissivo.
- **Esforço:** Grande
- **Critério de aceite:** corpus único aceita/rejeita igual nos dois lados.
- **Testes:** compatibility corpus e golden environment.
- **Ordem:** após bloqueadores.

### REM-023 — Tornar stores responsáveis por sequência/transação

- **Achados:** AUD-HIGH-003 e padrões relacionados
- **Descrição:** formalizar invariantes de append/sequence/transition nos ports,
  não em queries de aplicação.
- **Justificativa:** reduz acoplamento e elimina bugs de paginação.
- **Arquivos:** backup/event stores e application capabilities.
- **Dependências:** REM-003.
- **Risco:** refactor amplo; manter pequenos PRs.
- **Esforço:** Grande
- **Critério de aceite:** nenhum caller calcula sequência global por query.
- **Testes:** property/boundary/reconstruction.
- **Ordem:** depois da correção mínima.

### REM-024 — Definir ownership de artifacts web

- **Achado:** AUD-MED-004
- **Descrição:** source TS → deterministic build → closed inventory → bundle.
- **Justificativa:** remove código morto e três fontes.
- **Arquivos:** dashboard/build/bundle.
- **Dependências:** REM-012.
- **Risco:** digest/CSP.
- **Esforço:** Médio
- **Critério de aceite:** source único e generated files identificados.
- **Testes:** deterministic double build.
- **Ordem:** junto de REM-012.

## 5. Ampliação de testes

### REM-025 — Matrizes data-driven por route descriptor

- **Achado:** AUD-MED-007
- **Descrição:** gerar casos disabled/auth/roles/bounds/content/confirmation/gate/
  audit/headers/CORS/replay por catálogo.
- **Justificativa:** cobertura nominal não prova negações.
- **Arquivos:** HTTP/security tests.
- **Dependências:** REM-006.
- **Risco:** evitar teste tautológico que usa a mesma policy como expected.
- **Esforço:** Grande
- **Critério de aceite:** mutation em descriptor ou handler quebra teste.
- **Testes:** a própria matrix e negative controls.
- **Ordem:** simultânea a REM-006.

### REM-026 — Failure injection de persistência

- **Achados:** AUD-HIGH-002/003/004/005/007, AUD-MED-002/003
- **Descrição:** cada fsync/write/rename/state/journal/delete stage.
- **Justificativa:** atomicidade só é demonstrada nas janelas de crash.
- **Arquivos:** infrastructure tests e filesystem fakes.
- **Dependências:** contracts corrigidos.
- **Risco:** mocks não devem substituir filesystem semantics que se quer provar.
- **Esforço:** Grande
- **Critério de aceite:** estado pós-falha é anterior válido ou
  recovery_required, nunca success parcial.
- **Testes:** table-driven por stage.
- **Ordem:** com cada correção.

### REM-027 — Browser/a11y test real

- **Achado:** AUD-MED-004
- **Descrição:** harness DOM/browser para safe rendering, keyboard, responsive,
  downloads, clear confirmation e reread.
- **Justificativa:** HTTP text assertions não exercitam frontend.
- **Arquivos:** dashboard tests.
- **Dependências:** REM-012.
- **Risco:** nova dependency exige aprovação; preferir capability já disponível
  ou browser test aprovado separadamente.
- **Esforço:** Médio
- **Critério de aceite:** todos os fluxos de UI e negações exercitados.
- **Testes:** XSS strings, storage spies, network request inventory.
- **Ordem:** antes do drill.

### REM-028 — Capacity/load boundaries

- **Achados:** GAP de capacidade
- **Descrição:** catálogos máximos, 100k events/backup files, export máximo e
  long-running append.
- **Justificativa:** limites declarados precisam de comportamento previsível.
- **Arquivos:** performance/rehearsal tests.
- **Dependências:** stores corrigidos.
- **Risco:** CI time; separar smoke de benchmark.
- **Esforço:** Médio
- **Critério de aceite:** memória/tempo bounded e erro explícito no limite.
- **Testes:** boundary e one-over.
- **Ordem:** antes de stable.

## 6. Atualização documental

### REM-029 — Reconciliar product vision, requirements e roadmap

- **Achado:** AUD-LOW-003
- **Descrição:** marcar histórico/superseded e manter CLI, logical backup,
  restore e physical gate sem contradição.
- **Justificativa:** docs são fontes normativas.
- **Arquivos:** product vision, requirements, roadmap, README e glossary.
- **Dependências:** nenhuma.
- **Risco:** não reabrir escopo sem ADR.
- **Esforço:** Pequeno
- **Critério de aceite:** checker não encontra initial-scope conflitante.
- **Testes:** docs consistency.
- **Ordem:** após decisão de RC.

### REM-030 — Documentar incident, capacity, clock e compatibility runbooks

- **Achados:** GAP operacional
- **Descrição:** owner, detecção, containment, recovery e stop conditions.
- **Justificativa:** recovery não pode ser improvisada no host.
- **Arquivos:** `docs/operations/`, SECURITY e release readiness.
- **Dependências:** comportamento corrigido.
- **Risco:** runbook que promete auto-repair proibido.
- **Esforço:** Médio
- **Critério de aceite:** rehearsal executa cada procedimento sem segredo/path
  arbitrário.
- **Testes:** tabletop e sandbox runbook.
- **Ordem:** antes de stable; subset antes do drill.

## 7. Backlog futuro

### REM-031 — External dependency health

- **Achado:** AUD-INFO-001
- **Descrição:** checks allowlisted para DNS/internet/public availability.
- **Justificativa:** melhora diagnóstico, mas é FR Should.
- **Arquivos:** nova feature de health e docs.
- **Dependências:** ADR de SSRF/egress.
- **Risco:** SSRF, informação externa e flakiness.
- **Esforço:** Médio
- **Critério de aceite:** destinations fixos, timeout/bounds/cache explícitos.
- **Testes:** DNS/network fake e deny arbitrary URL.
- **Ordem:** backlog.

### REM-032 — Maintenance response

- **Achado:** AUD-INFO-002
- **Descrição:** resposta segura para serviço intencionalmente unavailable.
- **Justificativa:** UX externa, não blocker do control plane.
- **Arquivos:** availability delivery/docs.
- **Dependências:** definição de ingress público por serviço.
- **Risco:** não expor schedule/admin state.
- **Esforço:** Médio
- **Critério de aceite:** resposta bounded/cache policy e nenhum bypass.
- **Testes:** available/unavailable/unknown.
- **Ordem:** backlog.

### REM-033 — Restore e disaster recovery

- **Achado:** escopo deferido
- **Descrição:** ADR/Issue separados para restore testado e eventual off-site.
- **Justificativa:** backup local não prova recuperação de desastre.
- **Arquivos:** futuro.
- **Dependências:** threat model, key management e operação física.
- **Risco:** muito alto; não acoplar ao RC.
- **Esforço:** Grande
- **Critério de aceite:** restore sandbox e drill aprovados, sem sobrescrita
  arbitrária.
- **Testes:** corpus, rollback e disaster rehearsal.
- **Ordem:** backlog futuro.

### REM-034 — SIEM/attestation/multi-host/i18n

- **Achado:** escopo deferido
- **Descrição:** manter separados até haver caso de uso e ADR.
- **Justificativa:** não são necessários para o primeiro RC software-only.
- **Arquivos:** futuro.
- **Dependências:** requisitos novos.
- **Risco:** expansão indevida de superfície.
- **Esforço:** Grande
- **Critério de aceite:** Issue/ADR específico antes de implementação.
- **Testes:** definidos no futuro.
- **Ordem:** backlog.

## Gate de saída para a qualificação física

Somente marcar “ready” quando:

- REM-001 a REM-015 estiverem concluídas;
- todos os achados High estiverem fechados;
- os Medium relacionados a ingress, event history, dashboard, identity,
  dependencies e tests estiverem fechados;
- Node, deployment Go e power-helper Go passarem no commit final;
- `npm audit --omit=dev` reportar zero;
- contratos não tiverem placeholders;
- requirements Must estiverem individualmente mapeados;
- dois bundles e duas evidences forem byte-idênticos;
- nenhum efeito real tiver ocorrido durante a qualificação software;
- o drill físico possuir aprovação, rollback, observação e stop conditions
  separados.

## Primeira correção recomendada

Executar **REM-001** primeiro. Ela é pequena o suficiente para ser isolada, mas
bloqueia toda administração auditada e backup no perfil systemd. Em seguida,
tratar **REM-002** antes de qualquer exercício de shutdown, porque seu
comportamento fail-open pode transformar corrupção persistente em readiness
positivo.
