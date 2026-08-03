# Plano de implementação da remediação — Atlas Manager 1.0.0-rc.1

## 1. Executive summary

### Baseline e objetivo

O código a corrigir é o commit
`162191dae6415cc33aab4e30a2cb60be7845cb5f`. A branch de auditoria está em
`16f1d2a124cb642fdfc0d5828c4049d6682e18bf`, cujo único delta em relação ao
baseline são os cinco relatórios de auditoria. Nenhuma decisão deste plano
considera o commit documental como alteração de produção.

Inventário:

- 8 achados High;
- 7 achados Medium;
- 4 achados Low;
- 3 achados Informative;
- 15 achados bloqueiam a qualificação física: todos os High e Medium;
- 3 Low adicionais bloqueiam somente a release estável;
- 1 Low fica para a próxima versão;
- 2 Informative permanecem em backlog;
- 1 Informative é um gate físico aceito, não uma correção de software.

O objetivo é produzir uma nova qualificação software-only, sem relaxar os
controles atuais e sem tocar Cloudflare, systemd, Docker, PM2, helper, RTC ou
D-Bus reais.

### Estratégia geral

```text
testes de regressão vermelhos
  → perfil gerenciado compatível
  → backup permanentemente fail-closed
  → sequência/transições/retention de backup
  → retention/export/migration de event history
  → registro administrativo dirigido por uma fonte única
  → security envelope e readiness reais
  → gerações administrativas transacionais
  → dashboard derivado de uma fonte
  → matrizes e generators de release
  → bundle e rehearsal duplos
  → nova decisão de qualificação física
```

Contratos e evidências são outputs finais. Eles não devem ser usados para
mascarar testes ausentes nem editados manualmente para obter resultado positivo.

### Estratégia de branches

A branch principal deve ser criada do `main` atualizado:

```text
fix/v1-rc-audit-remediation
```

Precondição: preservar os cinco relatórios. A opção preferida é integrar primeiro
o commit documental da auditoria ao `main`; se isso não ocorrer, a branch de
remediação deve incorporar somente esse commit documental antes de qualquer
alteração funcional e registrar que o código-base continua sendo `162191d`.

Não usar oito branches concorrentes. Depois de integrar a correção de modos,
somente estes três workstreams podem avançar em paralelo:

1. `fix/v1-rc-storage-integrity`: backup e event history;
2. `fix/v1-rc-administrative-security`: catálogo, envelope e readiness;
3. `fix/v1-rc-configuration-lifecycle`: replacement/rollback Go.

Todos partem do mesmo ponto já contendo a Fase 1. Eles não alteram CI, contratos,
release reports ou bundle metadata até serem integrados na branch principal.
Dashboard começa somente após o catálogo. Release qualification começa somente
após todos os workstreams funcionais.

Arquivos de maior risco de conflito:

- `src/event-history/infrastructure/file-segmented-administrative-event-history.ts`;
- `src/backup-management/application/ports/backup-ports.ts`;
- `src/backup-management/composition/create-backup-management.ts`;
- `src/http/create-app.ts`;
- `src/http/administrative-route-security-catalog.ts`;
- `src/http/create-administrative-runtime.ts`;
- `deployment/internal/administrativeconfiguration/configuration.go`;
- `deployment/internal/bundle/builder.go`;
- `.github/workflows/ci.yml`;
- `docs/contracts/*` e `docs/release/*`.

Integração recomendada: modos → storage → catálogo/security → configuração →
dashboard → release qualification.

### Resultado esperado

O resultado técnico recomendado é um novo `1.0.0-rc.2`. A manutenção de
`1.0.0-rc.1` só seria defensável se nunca houve distribuição conceitual ou uso
de seus artifacts e se a política de versionamento declarar explicitamente que
o identificador não foi publicado. Como o repositório já contém evidence
`qualified`, release notes e contratos para rc.1, a decisão preliminar é criar
`rc.2` depois das correções, nunca antes.

## 2. Confirmed finding inventory

Todos os defeitos foram reconfirmados por inspeção estática contra o código
idêntico ao baseline. Os achados com confiança original “Alta confiança” foram
confirmados por fluxo e inventário; nenhum permanece `NEEDS_RECONFIRMATION`.

<!-- prettier-ignore -->
| ID | Severity | Component | Root cause | Status | Physical blocker | Dependencies |
| -- | -------- | --------- | ---------- | ------ | ---------------- | ------------ |
| AUD-HIGH-001 | High | systemd / backup / event history | `StateDirectoryMode=0750` contradiz os roots privados `0700` | CONFIRMED | yes | none |
| AUD-HIGH-002 | High | backup run store / shutdown readiness | `#loaded=true` antes da reconstrução e ausência de invalidation permanente | CONFIRMED | yes | HIGH-001 para rehearsal gerenciado |
| AUD-HIGH-003 | High | backup sequence / journal | sequência inferida de página ascendente de 100; append durável precede validação em memória | CONFIRMED | yes | HIGH-002 |
| AUD-HIGH-004 | High | backup retention | universo truncado em 100 e regra `rank >= keep || tooOld` viola mínimo | CONFIRMED | yes | HIGH-003 |
| AUD-HIGH-005 | High | event-history retention ledger | writer usa hash da linha/ledger; verifier espera hash canônico do record anterior | CONFIRMED | yes | HIGH-001 para rehearsal gerenciado |
| AUD-HIGH-006 | High | administrative HTTP catalog | catálogo e registro Express são fontes separadas; validator só checa invariantes internas | CONFIRMED | yes | HIGH-001 para lifecycle completo |
| AUD-HIGH-007 | High | managed configuration | publicação multiarquivo sem commit transacional; parser TS real não valida candidate | CONFIRMED | yes | HIGH-001; HIGH-006 para profile final |
| AUD-HIGH-008 | High | release qualification | artifacts declarativos, placeholders, baseline antigo e CI sem geração/rehearsal real | CONFIRMED | yes | todos os High e Medium |
| AUD-MED-001 | Medium | Host/authority parser | `new URL("https://" + host)` aceita userinfo/path/query/fragment | CONFIRMED | yes | HIGH-006 |
| AUD-MED-002 | Medium | event-history exports | inventory parte de manifests e não verifica integralmente pares/footer/ID | CONFIRMED | yes | HIGH-005 |
| AUD-MED-003 | Medium | event-history v1 migration | escrita direta no root final e receipt parcialmente validado | CONFIRMED | yes | HIGH-005; MED-002 verifier compartilhado |
| AUD-MED-004 | Medium | dashboard / bundle | três fontes de assets; source TS não é o runtime entregue | CONFIRMED | yes | HIGH-006 |
| AUD-MED-005 | Medium | identity/security status | cache não expõe snapshot; posture usa constantes de sucesso | CONFIRMED | yes | HIGH-006 |
| AUD-MED-006 | Medium | dependency/license inventory | documento lista só quatro diretas; árvore production transitiva não é fechada | CONFIRMED | yes | HIGH-008 |
| AUD-MED-007 | Medium | test/CI assurance | matrizes declaradas não existem como testes executáveis | CONFIRMED | yes | todos os fixes funcionais |
| AUD-LOW-001 | Low | request correlation | ID é criado no response, sem request context em logs | CONFIRMED | no; NEXT_VERSION | HIGH-006 |
| AUD-LOW-002 | Low | Fetch Metadata | destination é validado só sintaticamente | CONFIRMED | no; stable blocker | HIGH-006; MED-001 |
| AUD-LOW-003 | Low | documentation governance | documentos históricos contradizem ADR-023/025 | CONFIRMED | no; stable blocker | HIGH-008 |
| AUD-LOW-004 | Low | CI supply chain | Actions usam tags e Node usa major flutuante | CONFIRMED | no; stable blocker | HIGH-008 |
| AUD-INFO-001 | Informative | external dependency health | FR-004 Should não entregue | DEFERRED | no | future ADR for allowlist/SSRF |
| AUD-INFO-002 | Informative | maintenance response | FR-015 Should não entregue | DEFERRED | no | future ingress decision |
| AUD-INFO-003 | Informative | physical effects | host/ingress/helper/RTC/shutdown deliberadamente não qualificados | ACCEPTED_LIMIT | physical gate itself | software go/no-go |

## 3. Dependency graph

### High findings

```text
AUD-HIGH-001
    ↓
managed profile roots become usable
    ├──→ AUD-HIGH-002 → AUD-HIGH-003 → AUD-HIGH-004
    │                         ↓
    │                backup/shutdown rehearsal
    ├──→ AUD-HIGH-005 → AUD-MED-002 → AUD-MED-003
    │                         ↓
    │                audit/export/migration rehearsal
    ├──→ AUD-HIGH-006
    │       ├──→ AUD-MED-001
    │       ├──→ AUD-MED-005
    │       ├──→ AUD-LOW-001/002
    │       └──→ AUD-MED-004
    └──→ AUD-HIGH-007
            ↓
    configuration lifecycle qualification

all functional tracks + AUD-MED-006/007
    ↓
AUD-HIGH-008
    ↓
contracts, bundle, evidence and release decision
```

`AUD-HIGH-004` será implementado junto do contrato de query/sequence de backup,
antes do event-history track. Isso ajusta a ordem inicial solicitada porque
evita alterar `BackupRunStore` duas vezes e permite congelar o contrato antes do
rehearsal.

### Release chain

```text
code and tests green
  → fixed source commit selected
  → API contract generated
  → dependency/license inventory generated
  → dashboard assets built twice
  → bundle built twice
  → rehearsal run twice
  → requirements/security reports validated
  → release evidence assembled
  → release contract assembled
  → qualified | not_qualified
```

O release contract deve ser um artifact externo ao archive final ou usar um
digest de payload definido sem autorreferência. A decisão deste plano é:

- o bundle final não inclui o release contract que contém o SHA do próprio
  archive;
- o administrative API contract continua dentro do bundle;
- o release contract é gerado por último como artifact de qualificação;
- `sourceCommit` é o commit imutável usado para construir o bundle;
- snapshots versionados posteriores não alteram o significado de
  `sourceCommit`.

Essa decisão deve ser registrada como clarificação do ADR-025 antes da
regeneração. Ela elimina os ciclos `bundle → contract → bundle` e
`commit → contract versionado → novo commit`.

## 4. Implementation phases

### Fase 0 — Preservação, baseline e testes vermelhos

- **Objetivo:** provar cada defeito no baseline antes de alterar comportamento.
- **Achados:** todos os High e Medium; inventário de Low/Info.
- **Causa raiz:** a suite atual não atravessa os contratos integrados.
- **Arquivos prováveis:** novos testes sob `tests/`, novos Go tests em
  `deployment/internal/`; nenhum código de produção.
- **Testes a criar primeiro:** modos 0750, dupla leitura corrompida, 1.001 runs,
  append inválido, retention combinada/>100, três prunes, route mismatch,
  Host ambiguity, export orphans, migration crash, config failure matrix,
  cached JWKS, dashboard inventory e release placeholders.
- **Mudanças propostas:** somente regression tests e fixtures sandboxed. Cada
  teste deve falhar pelo código esperado, não por timeout genérico.
- **Riscos:** reproduções tautológicas ou que usam mock no boundary que se quer
  testar.
- **Dependências:** branch criada do `main`; reports preservados.
- **Critérios de aceite:** ao menos um teste vermelho determinístico por achado
  High/Medium; saída não contém path temporário, segredo ou payload privado.
- **Comandos:** testes direcionados Vitest/Go; `git diff --check`.
- **Evidências:** tabela baseline “expected fail / observed fail / test name”.
- **Paralelismo:** fixtures de backup, event history, HTTP e Go podem ser
  escritas em paralelo; não integrar correção ainda.

### Fase 1 — Compatibilidade do perfil gerenciado

- **Objetivo:** fechar `AUD-HIGH-001`.
- **Causa raiz:** uma única diretiva systemd `0750` conflita com a política
  privada dos stores.
- **Decisão:** preservar os stores em `0700`; alterar
  `StateDirectoryMode=0700` e `RuntimeDirectoryMode=0700`. O processo owner
  continua `atlas-manager`; root mantém acesso administrativo; nenhum membro de
  grupo recebe leitura. O grupo do helper não precisa de acesso aos state roots.
- **Arquivos:** `deployment/internal/systemdunit/unit.go`, unit tests,
  service-lifecycle verifier, deployment rehearsal e documentação de modes.
- **Testes:** unit contract exato, sandbox que materializa modes, primeiro audit,
  primeiro backup, upgrade e rollback. Negativos para owner incorreto, 0750,
  group/world writable, symlink e hard link.
- **Riscos:** scripts de upgrade assumirem 0750; RuntimeDirectory ser usado por
  ferramenta externa.
- **Dependências:** nenhuma.
- **Critérios de aceite:** application owner acessa; group/other não; stores
  aceitam; lifecycle não afrouxa metadata; bundle contém unit exata.
- **Comandos:** testes deployment/systemd, tests dos dois stores, activation
  rehearsal.
- **Evidências:** mode contract e first-write results bounded.
- **Paralelismo:** não; integrar primeiro na branch principal.

### Fase 2 — Fail-closed permanente do backup store

- **Objetivo:** fechar `AUD-HIGH-002` e a parte de shutdown readiness.
- **Causa raiz:** boolean `#loaded` não representa loading/ready/failed e o
  arquivo não é revalidado após o primeiro acesso.
- **Mudança:** substituir por state machine
  `uninitialized | loading | ready | failed`. Falha de metadata, I/O, UTF-8,
  JSON, schema, sequence ou transition move o instance para `failed`; todas as
  leituras/mutações seguintes retornam o mesmo safe failure. Depois de load
  bem-sucedido, manter fingerprint privada de `dev`, `ino`, `size`, `mtime/ctime`
  e mode; cada operação valida identidade/metadata contra o último estado
  durable, atualizando fingerprint somente após append sincronizado próprio.
- **Arquivos:** file run store, run-store port/errors, backup composition e
  shutdown readiness integration.
- **Testes:** primeira/segunda/N leitura corrompida; corrupção após load;
  replace/truncate/chmod/symlink; chamadas concorrentes; scheduler/query/mutation
  bloqueados; readiness sempre unavailable.
- **Riscos:** falsos positivos de metadata após append próprio; Promise de load
  concorrente duplicada.
- **Dependências:** Fase 1 para rehearsal.
- **Critérios de aceite:** nenhum cached snapshot é usado após detecção de
  mudança; sem fallback in-memory.
- **Comandos:** tests do store, backup integration e power shutdown readiness.
- **Evidências:** repeated-read matrix.
- **Paralelismo:** pode ocorrer junto do event-history track após Fase 1.

### Fase 3 — Sequência, transições e retention de backup

- **Objetivo:** fechar `AUD-HIGH-003` e `AUD-HIGH-004`.
- **Causa raiz:** sequence é calculada por query paginada e a validação durable
  não é transacional; retention usa a mesma página truncada.
- **Mudança:** o port recebe um start sem sequence e retorna a run persistida
  com sequence alocada pelo store sob seu writer boundary. File store:
  reconstruir/validar candidate state, serializar, append+fsync, então publicar
  snapshot em memória. Falha pós-append marca instance failed e exige
  reconstrução por nova instância; não reexecuta adapter. Queries continuam
  paginadas, mas `reconstruct` e sequence metadata não truncam em 100.
- **Ordenação:** sequence é número seguro; não deriva de filename/string.
  Adicionar testes 9/10/99/100/101/102 para provar que não existe comparação
  lexicográfica.
- **Retention:** paginar por `afterSequence` até página vazia, impor bound
  configurado de scan, correlacionar cada artifact com success metadata, ordenar
  por completedAt/sequence/runId, reservar primeiro `keepLastSuccessful` e
  selecionar somente o restante. Age nunca remove o conjunto reservado.
- **Arquivos:** backup ports, coordinator, in-memory/file stores, retention e
  composition.
- **Testes:** 1.001 runs, process reconstruction, started/terminal invalid,
  durable write failure, scheduled/manual, count/age/combined/>100, partial
  delete e unknown artifact.
- **Riscos:** mudar port afeta mocks e protected API; artifact publicado com
  terminal persistence failure deve continuar state-recheck-required.
- **Dependências:** Fase 2.
- **Critérios de aceite:** sequência contígua sem escrita inválida; no retry;
  mínimo de retention preservado; universo completo processado.
- **Comandos:** backup domain/application/infrastructure/integration e shutdown.
- **Evidências:** high-volume run digest e retention selection digest.
- **Paralelismo:** interno ao storage workstream; não dividir sequence e
  retention em branches.

### Fase 4 — Event-history retention, export e migration

- **Objetivo:** fechar `AUD-HIGH-005`, `AUD-MED-002` e `AUD-MED-003`.
- **Causa raiz:** writer/verifier duplicam hash semantics; exports não usam
  inventory fechado; migration publica diretamente no destino.
- **Mudança retention:** parser canônico retorna também o último
  `retentionRecordSha256`; writer usa exatamente esse valor. Validar ledger
  integral antes do journal/efeito. Manter transaction após partial deletion.
- **Mudança export:** listar todos os directory entries, exigir pares 1:1
  `<id>.jsonl`/manifest, `exportId == contentSha256 == sha256(bytes)`, filename
  igual ao ID, parse estrito de header/events/footer e ranges/hashes. Definir
  footer hash sem autorreferência: `exportSha256` no footer é hash canônico do
  header+event lines+footer sem o próprio campo; manifest/content ID continua
  hash dos bytes finais.
- **Mudança migration:** root candidate sibling no mesmo filesystem, source
  fingerprint estável, store completo, receipt estrito, verifier, fsync e rename
  único para root final. v1 nunca é removido. Existing final/unknown state
  bloqueia.
- **Arquivos:** segmented store, event-history domain hash helpers,
  maintenance entrypoint e tests.
- **Testes:** 3+ prunes, múltiplos segmentos por prune, restart, exports após
  prunes, query below boundary, every orphan/tamper, migration fault injection.
- **Riscos:** stores já quebrados não podem ser reparados automaticamente;
  formato do footer deve ser documentado antes da mudança.
- **Dependências:** Fase 1; export/migration depois do retention helper.
- **Critérios de aceite:** integrity sempre verified_with_retention após ciclos
  válidos; unknown state bloqueia sem deletar; migration final é all-or-nothing.
- **Comandos:** event-history domain/infrastructure/maintenance/HTTP tests.
- **Evidências:** golden chain, export digest e migration receipt digest.
- **Paralelismo:** pode avançar junto das Fases 2/3, mas export e retention
  compartilham o mesmo arquivo e devem ser uma branch.

### Fase 5 — Catálogo e security envelope reais

- **Objetivo:** fechar `AUD-HIGH-006`, `AUD-MED-001`, `AUD-MED-005`,
  `AUD-LOW-001` e `AUD-LOW-002`.
- **Causa raiz:** descriptors, `app.all`, parsers, gates e protected invokers são
  definidos separadamente.
- **Arquitetura escolhida:** cada route module produz
  `AdministrativeRouteDefinition` contendo o descriptor e a factory do handler.
  Uma única função `registerAdministrativeRoutes` recebe definitions ativas,
  valida activation dependencies e registra Express. Somente essa função pode
  registrar caminhos `/admin`; um architecture test proíbe `app.all/get/post/...`
  em outros módulos administrativos.
- **Policy runtime:** o wrapper comum aplica method, request-target, query/body,
  content-type/encoding, admission, confirmation e response headers a partir do
  próprio descriptor. Operation/permission é validada contra a única policy de
  access control. Gate instances são resolvidas por `gatePolicy` no wrapper;
  protected mutation continua responsável por authorization/start/terminal
  audit, sem retry.
- **Reconciliation:** compara definitions ativas com flags/dependencies e
  access-control mapping antes de listening. Não compara duas listas manuais.
  O API contract serializa os mesmos definitions.
- **Host:** parser fechado de authority `hostname[:port]`, sem URL parser
  permissivo; rejeita userinfo, slash, query, fragment, whitespace, controls,
  duplicate Host e port alternativo.
- **Readiness/status:** JWKS provider expõe snapshot bounded read-only de cache e
  último refresh; implementa `ready_with_cached_keys`. Security posture recebe
  resultado real da reconciliation, flags reais, loopback/config e audit
  readiness. Nenhuma constante positiva.
- **Correlation/Fetch:** request ID interno em request context/logs; caller ID
  ignorado. Fetch mode/dest allowlist por response category.
- **Arquivos:** catálogo, all route modules, create-app/runtime, envelope,
  public-origin, authentication JWKS/composition, logging e tests HTTP.
- **Riscos:** maior refactor; admission/gate ordering; alterar 404/405; ativação
  parcial.
- **Dependências:** Fase 1; event history funcional para audit integration.
- **Critérios de aceite:** rota fora da definition é impossível pelo composition
  API; mismatch falha startup; route matrix completa; status não mente.
- **Comandos:** tests HTTP/access-control/authentication/maintenance, typecheck.
- **Evidências:** route definition count/digest e browser/identity matrices.
- **Paralelismo:** Host/readiness podem ser desenvolvidos após o definition type,
  mas integração final é serial.

### Fase 6 — Configuração administrativa e dashboard

- **Objetivo:** implementar `AUD-HIGH-007` e `AUD-MED-004`.
- **Config root cause:** environment/current/previous/state são publicados em
  passos que podem divergir; o parser Go é tratado como prova do parser TS.
- **Config mudança:** generations em diretórios imutáveis
  `generations/<internal-id>/` com environment, input evidence e canonical
  metadata; candidate sibling; parser Go primeiro, depois o entrypoint fixo
  `administrative-security.js` com a action `verify-configuration` e candidate
  environment passado como ambiente, nunca path do caller; fsync; rename da
  generation; troca atômica do current state; previous referencia somente
  generation verificada. Journal registra etapa e nunca é continuado
  automaticamente.
- **Rollback:** valida generation anterior, input evidence e parser TS antes da
  troca; current vira previous somente após commit; sem activation.
- **Dashboard:** `src/dashboard/` vira única fonte; build determinístico produz
  closed inventory consumida pelo route e pelo bundle. Remover strings Go/HTTP
  duplicadas e confirmações hardcoded. Views operam por capabilities e sempre
  reread.
- **Arquivos:** administrativeconfiguration Go/tests, maintenance security,
  dashboard source/build/route, bundle builder.
- **Riscos:** cross-language process contract, current deployment path,
  source-date/digest e CSP.
- **Dependências:** Fases 1 e 5; dashboard depois das route definitions.
- **Critérios de aceite:** toda failure window resulta em old-current válido ou
  recovery_required; TS parser executado; dashboard source/bundle digest único.
- **Comandos:** Go configuration/rehearsal, maintenance tests, dashboard tests,
  double asset build.
- **Evidências:** bounded generation evidence e dashboard assets SHA.
- **Paralelismo:** config e dashboard podem ocorrer em paralelo porque arquivos
  são distintos; ambos conflitam depois em bundle builder e integram
  sequencialmente.

### Fase 7 — Classificação de Medium/Low e hardening

- **Objetivo:** fechar todos os blockers da qualificação antes de release output.
- **BLOCKS_PHYSICAL_QUALIFICATION:** MED-001 a MED-007.
- **BLOCKS_STABLE_RELEASE:** LOW-002, LOW-003, LOW-004.
- **NEXT_VERSION:** LOW-001, se o request context não for necessário para a
  evidence; preferencialmente fechar junto da Fase 5.
- **BACKLOG:** INFO-001 e INFO-002.
- **ACCEPTED_LIMIT:** INFO-003.
- **Mudanças:** dependency inventory transitivo, matrizes executable, docs
  precedence e toolchain pinning.
- **Riscos:** misturar atualização de dependency com remediação. Não atualizar
  packages nesta fase; a vulnerabilidade dev fica registrada e recebe Issue
  separada se não houver versão lockfile-only já aprovada.
- **Critérios de aceite:** nenhum Medium aberto; Low stable blockers fechados ou
  formalmente rejeitados por nova decisão arquitetural.
- **Comandos:** inventory validator, CI lint, docs consistency.
- **Evidências:** classifications finais.
- **Paralelismo:** inventory e docs podem avançar sem tocar storage; CI só é
  alterado após merge funcional.

### Fase 8 — Qualification de replacement/rollback

- **Objetivo:** provar a Fase 6 em lifecycle completo, não apenas unit tests.
- **Matrix:** active/enable rejection, confirmations, fixed input, admin
  assignment, unknown/duplicate role, Go parser, TS parser, candidate, current/
  previous, write failures, interruption, replacement, rollback, modified/
  unknown generation, repeated operations e final state.
- **Arquivos:** deployment rehearsal e service lifecycle tests.
- **Riscos:** fixture simular systemd de forma permissiva.
- **Dependências:** Fases 1, 5 e 6.
- **Critérios de aceite:** reactivation sandbox após replacement e rollback;
  nenhum service start dentro do configuration executable; evidence sem
  environment/role/origin/audience.
- **Comandos:** targeted Go tests e packaged Node parser.
- **Evidências:** canonical replacement/rollback report.
- **Paralelismo:** não; executado sobre branch integrada.

### Fase 9 — Regeneração derivada e release assurance

- **Objetivo:** fechar `AUD-HIGH-008`, `AUD-MED-006/007` e
  `AUD-LOW-003/004`.
- **Mudança:** criar entrypoints estreitos e fixed-output para API contract,
  dependency inventory, traceability validation, release evidence e release
  contract. Nenhum aceita output path arbitrário.
- **Ordem:** freeze source commit → generate API/dependencies → build dashboard
  → build/inspect bundles twice → run rehearsals twice → validate reports →
  generate evidence → generate detached release contract.
- **Invariantes:** SHA fields são 64 hex; source/baseline atuais; zero
  `placeholder|ci-generated|not_run|environment_unavailable` em resultado
  qualified; every Must ID explicit; evidence qualified somente se todos os
  machine reports são pass.
- **Arquivos:** release qualification source/tests, docs/contracts/release,
  CI e bundle inventory.
- **Riscos:** autorreferência de bundle/commit; artifact stale.
- **Dependências:** todas as fases funcionais.
- **Critérios de aceite:** outputs reproduzidos byte a byte em clean checkout;
  tamper/missing gate resulta not_qualified.
- **Comandos:** generators em check mode, double build/rehearsal.
- **Evidências:** digests reais, nunca valores antecipados.
- **Paralelismo:** não.

### Fase 10 — Validação total e go/no-go

- **Objetivo:** obter nova decisão independente.
- **Comandos Node:** `npm ci`, format check, lint, typecheck, serial tests, build,
  production audit e diff check.
- **Comandos Go:** formatting check, module verify, vet e tests para deployment
  e helper.
- **Artifacts:** two bundles, inspection, packaged smoke, two rehearsals in
  different roots, evidence comparison, secret scan e no-effect attestations.
- **Riscos:** usar artifacts compilados de commit anterior.
- **Dependências:** Fase 9.
- **Critérios de aceite:** checklist da seção 10 integralmente marcada por
  resultados de máquina.
- **Evidências:** final qualification directory fora do bundle source.
- **Paralelismo:** Node/Go podem rodar em jobs separados; assembler final espera
  todos.

## 5. Detailed task cards

### Task AUD-HIGH-001

```text
Task ID: REM-P0-001
Finding: AUD-HIGH-001
Title: Reconciliar os modos dos state/runtime directories
Priority: P0
Severity: High
Confidence: Confirmed
Blocking: BLOCKS_PHYSICAL_QUALIFICATION
Root cause: StateDirectoryMode 0750 conflita com stores que rejeitam bits de grupo.
Current behavior: primeira persistência de backup/audit falha no profile gerenciado.
Expected behavior: roots owner-only 0700, aceitos pelos stores e verificados pelo lifecycle.
Implementation approach: manter parsers estritos; alterar unit e verifiers para 0700; testar upgrade/rollback.
Files to inspect: deployment/internal/systemdunit/unit.go; ambos os file stores; service lifecycle.
Files likely to change: unit.go, unit_test.go, lifecycle/rehearsal tests e docs de modes.
Tests to add: materialização sandbox do mode; first audit/backup; unsafe owner/group/symlink.
Regression risks: tooling externo depender de group read; unit antiga durante upgrade.
Dependencies: none.
Acceptance criteria: mode/owner exatos, first writes passam, group/other continuam negados.
Validation commands: targeted Node stores; go test systemdunit/rehearsal; bundle inspection.
Documentation impact: unit contract e managed-profile runbook.
Estimated effort: Medium
```

### Task AUD-HIGH-002

```text
Task ID: REM-P0-002
Finding: AUD-HIGH-002
Title: Tornar o backup run store permanentemente fail-closed
Priority: P0
Severity: High
Confidence: Confirmed
Blocking: BLOCKS_PHYSICAL_QUALIFICATION
Root cause: #loaded é setado antes do parse e não existe estado failed/fingerprint.
Current behavior: primeira leitura corrupta falha; segunda retorna store vazio.
Expected behavior: corrupção detectada bloqueia toda operação posterior da instance.
Implementation approach: load state machine, shared loading Promise, failed terminal e metadata fingerprint.
Files to inspect: file-backup-run-store.ts; backup ports/composition; shutdown readiness.
Files likely to change: store, error mapping, composition e tests.
Tests to add: repeated/concurrent reads, post-load corruption, query/mutation/scheduler/readiness.
Regression risks: falsa detecção após append próprio; deadlock de load.
Dependencies: HIGH-001 para rehearsal.
Acceptance criteria: nenhuma leitura retorna ready/empty após corruption; no fallback.
Validation commands: Vitest backup infrastructure/integration e power readiness.
Documentation impact: backup recovery e shutdown readiness.
Estimated effort: Medium
```

### Task AUD-HIGH-003

```text
Task ID: REM-P0-003
Finding: AUD-HIGH-003
Title: Tornar sequence e transition responsabilidade transacional do store
Priority: P0
Severity: High
Confidence: Confirmed
Blocking: BLOCKS_PHYSICAL_QUALIFICATION
Root cause: sequence vem de query limit 100; disk append ocorre antes da validação em memória.
Current behavior: run 102 reutiliza sequence 101 e file journal pode receber transição inválida.
Expected behavior: allocation contígua sob writer boundary, validação pré-append e fsync.
Implementation approach: appendStarted aceita input sem sequence e retorna run persistida; candidate state antes do durable append.
Files to inspect: backup ports, coordinator, in-memory/file stores e domain run.
Files likely to change: esses módulos, mocks e callers scheduler/HTTP tests.
Tests to add: 9/10/99/100/101/102/1001, restart, two instances, partial append.
Regression risks: alterar immutable run contract e audit ordering; no adapter retry.
Dependencies: HIGH-002.
Acceptance criteria: sequence numérica contígua; journal sempre reconstrói; no duplicated effect.
Validation commands: all backup tests e shutdown integration.
Documentation impact: run persistence contract.
Estimated effort: Large
```

### Task AUD-HIGH-004

```text
Task ID: REM-P0-004
Finding: AUD-HIGH-004
Title: Corrigir seleção completa e mínimo da retenção de backup
Priority: P0
Severity: High
Confidence: Confirmed
Blocking: BLOCKS_PHYSICAL_QUALIFICATION
Root cause: query truncada e condição OR permite age apagar o conjunto protegido.
Current behavior: artifacts >100 podem ficar invisíveis; recentes mínimos podem ser removidos.
Expected behavior: scan bounded completo e keepLastSuccessful sempre preservado.
Implementation approach: paginação afterSequence, ordering canônico, protected set e deletion somente do restante.
Files to inspect: apply-registered-backup-retention.ts; run query; artifact store.
Files likely to change: retention capability, query helper e tests.
Tests to add: count, age, combined, >100, equal timestamps, unknown/modified/partial.
Regression risks: perda irreversível por sort incorreto; scan sem limite.
Dependencies: HIGH-003.
Acceptance criteria: mínimo preservado e deletion set determinístico sobre todo managed set.
Validation commands: targeted retention e backup rehearsal.
Documentation impact: retention semantics.
Estimated effort: Medium
```

### Task AUD-HIGH-005

```text
Task ID: REM-P0-005
Finding: AUD-HIGH-005
Title: Unificar a cadeia canônica da retention ledger
Priority: P0
Severity: High
Confidence: Confirmed
Blocking: BLOCKS_PHYSICAL_QUALIFICATION
Root cause: writer calcula sha256 da linha; verifier avança pelo retentionRecordSha256.
Current behavior: primeiro prune verifica; segundo deixa o store broken.
Expected behavior: ciclos ilimitados preservam chain e retained boundary.
Implementation approach: parser/hash helper único; writer lê último record validado; ledger integral antes do efeito.
Files to inspect: segmented event-history store e event-history-record helpers.
Files likely to change: store/domain helper e tests.
Tests to add: três+ prunes, multi-segment, restart, tamper/delete/reorder e query pruned.
Regression risks: tentar adotar ledger já quebrada; proibido auto-repair.
Dependencies: HIGH-001 para lifecycle.
Acceptance criteria: verified_with_retention após todos os ciclos válidos.
Validation commands: event-history infrastructure/integration/HTTP.
Documentation impact: retention hash contract e recovery runbook.
Estimated effort: Medium
```

### Task AUD-HIGH-006

```text
Task ID: REM-P0-006
Finding: AUD-HIGH-006
Title: Tornar route definitions a fonte real de registro e policy
Priority: P0
Severity: High
Confidence: Confirmed
Blocking: BLOCKS_PHYSICAL_QUALIFICATION
Root cause: catálogo e app.all/parsers/gates são declarações independentes.
Current behavior: startup valida somente a forma do catálogo.
Expected behavior: toda rota /admin nasce de uma AdministrativeRouteDefinition única.
Implementation approach: registry único, shared policy wrapper, typed operation mapping e architecture test proibindo registro lateral.
Files to inspect: create-app, catálogo, todas as administrative routes, access-control mapping.
Files likely to change: toda delivery administrativa, contract serializer e tests.
Tests to add: missing/extra/method/path/flag/body/confirmation/gate/audit/replay/header mutations.
Regression risks: ordem admission/auth/gate/audit, 404/405 e activation independente.
Dependencies: event audit funcional para integration.
Acceptance criteria: mismatch impede listening e contract deriva das definitions reais.
Validation commands: HTTP/access-control/config tests, typecheck e API contract check.
Documentation impact: ADR-025 e administrative control-plane.
Estimated effort: Extra Large
```

### Task AUD-HIGH-007

```text
Task ID: REM-P0-007
Finding: AUD-HIGH-007
Title: Implementar generations transacionais e validação TS real
Priority: P0
Severity: High
Confidence: Confirmed
Blocking: BLOCKS_PHYSICAL_QUALIFICATION
Root cause: current/previous/state são escritos separadamente e só o parser Go valida input.
Current behavior: crash pode deixar environment e state divergentes; hashes de input não avançam corretamente.
Expected behavior: candidate generation validada, fsynced e publicada atomicamente; rollback só para previous managed.
Implementation approach: generation dirs, journal por etapa, fixed Node verifier com candidate env e commit atômico de state.
Files to inspect: administrativeconfiguration Go; administrative-security maintenance; environment parser.
Files likely to change: configuration/input/state Go, runner interface, Go tests e rehearsal.
Tests to add: toda matrix da Fase 8, inclusive no-admin, modified/unknown e repeated operations.
Regression risks: lockout, cross-language drift e candidate leakage.
Dependencies: HIGH-001 e HIGH-006 para final profile.
Acceptance criteria: old valid ou recovery_required em cada failure; nenhum auto-adopt/start.
Validation commands: Go package/rehearsal e packaged TypeScript verifier.
Documentation impact: replacement, rollback e recovery runbooks.
Estimated effort: Extra Large
```

### Task AUD-HIGH-008

```text
Task ID: REM-P0-008
Finding: AUD-HIGH-008
Title: Substituir qualificação declarativa por pipeline derivado
Priority: P0
Severity: High
Confidence: Confirmed
Blocking: BLOCKS_PHYSICAL_QUALIFICATION
Root cause: contracts/evidence estáticos e CI verifica existência, não provenance.
Current behavior: placeholders, baseline antigo e unavailable coexistem com qualified.
Expected behavior: qualified somente a partir de machine reports completos e reproduzíveis.
Implementation approach: fixed-output generators, detached release contract, strict parsers e final assembler fail-closed.
Files to inspect: contracts, release reports, evidence JSON, CI e bundle builder.
Files likely to change: release tooling, derived docs, workflow e bundle inventory.
Tests to add: placeholder, stale commit, missing Must/license/job, tamper e differing build/rehearsal.
Regression risks: autorreferência, artifact stale e sourceCommit ambíguo.
Dependencies: todos os blockers funcionais e MED-006/007.
Acceptance criteria: zero placeholders/unavailable em qualified; every digest recalculável.
Validation commands: generators --check, full CI, two bundles/rehearsals.
Documentation impact: ADR-025 clarification, release notes/reports.
Estimated effort: Extra Large
```

### Task AUD-MED-001

```text
Task ID: REM-P1-001
Finding: AUD-MED-001
Title: Implementar parser fechado de HTTP authority
Priority: P1
Severity: Medium
Confidence: Confirmed
Blocking: BLOCKS_PHYSICAL_QUALIFICATION
Root cause: URL parser normaliza Host com sintaxe que não pertence à authority aceita.
Current behavior: userinfo/path/query/fragment podem comparar como host válido.
Expected behavior: apenas hostname[:443] canônico e único.
Implementation approach: gramática explícita, control/whitespace rejection e comparação ASCII canônica.
Files to inspect: administrative-public-origin e security envelope.
Files likely to change: esses arquivos e HTTP/config tests.
Tests to add: userinfo, slash, query, hash, controls, duplicate, IDN, ports e HTTP/2 fixture.
Regression risks: proxy real enviar formato não documentado.
Dependencies: HIGH-006.
Acceptance criteria: somente authority exata alcança admission/auth.
Validation commands: public-origin e browser-security tests.
Documentation impact: ingress/Host contract.
Estimated effort: Small
```

### Task AUD-MED-002

```text
Task ID: REM-P1-002
Finding: AUD-MED-002
Title: Fechar inventory e verificação canônica de exports
Priority: P1
Severity: Medium
Confidence: Confirmed
Blocking: BLOCKS_PHYSICAL_QUALIFICATION
Root cause: manifests dirigem listagem e conteúdo/footer não é parseado integralmente.
Current behavior: orphan/mismatch pode escapar do inventory esperado.
Expected behavior: pares exatos e conteúdo integralmente verificável antes de list/download/prune.
Implementation approach: directory inventory bijetivo, strict line parser e separação entre footer digest e content ID.
Files to inspect: segmented event-history store e export domain.
Files likely to change: store/helpers/tests.
Tests to add: orphan de ambos os tipos, filename/ID/content/footer/range mismatch e active download.
Regression risks: definir hash autorreferente; evitar.
Dependencies: HIGH-005.
Acceptance criteria: qualquer unknown/tamper bloqueia sem modificar.
Validation commands: event-history export/HTTP tests.
Documentation impact: export format.
Estimated effort: Large
```

### Task AUD-MED-003

```text
Task ID: REM-P1-003
Finding: AUD-MED-003
Title: Publicar migration v1 por candidate root
Priority: P1
Severity: Medium
Confidence: Confirmed
Blocking: BLOCKS_PHYSICAL_QUALIFICATION
Root cause: target.record escreve diretamente no root final; receipt usa parse parcial.
Current behavior: crash deixa v2 parcial no destino.
Expected behavior: nenhum root final antes de complete verification e atomic rename.
Implementation approach: sibling candidate, source fingerprint, strict receipt, fsync e publish.
Files to inspect: src/maintenance/event-history.ts e store verifier.
Files likely to change: maintenance, receipt parser e tests.
Tests to add: failure em cada etapa, source change, repeated unchanged e unsafe receipt.
Regression risks: rename cross-filesystem e tentativa de auto-repair.
Dependencies: HIGH-005 e export verifier helpers quando reutilizáveis.
Acceptance criteria: v1 preservado; final ausente ou totalmente verified.
Validation commands: maintenance and event-history tests.
Documentation impact: migration/recovery.
Estimated effort: Large
```

### Task AUD-MED-004

```text
Task ID: REM-P1-004
Finding: AUD-MED-004
Title: Consolidar dashboard em source/build/inventory únicos
Priority: P1
Severity: Medium
Confidence: Confirmed
Blocking: BLOCKS_PHYSICAL_QUALIFICATION
Root cause: TS source, HTTP strings e Go bundle assets divergem.
Current behavior: correções em src/dashboard não governam runtime; views declaradas são incompletas.
Expected behavior: um build determinístico consumido por route e bundle.
Implementation approach: compile/copy fixed source, generated closed inventory e eliminar hardcoded confirmations.
Files to inspect: src/dashboard, dashboard route e bundle builder.
Files likely to change: source/build scripts, route, Go bundle e tests.
Tests to add: behavior DOM, a11y, role controls, safe rendering, clear confirmation, reread e digest.
Regression risks: CSP, source maps, external requests e bundle reproducibility.
Dependencies: HIGH-006.
Acceptance criteria: todas as sections declaradas funcionam sem storage/unsafe DOM/optimism.
Validation commands: dashboard HTTP/browser tests e double asset build.
Documentation impact: dashboard operations.
Estimated effort: Extra Large
```

### Task AUD-MED-005

```text
Task ID: REM-P1-005
Finding: AUD-MED-005
Title: Derivar identity readiness e security posture de estado real
Priority: P1
Severity: Medium
Confidence: Confirmed
Blocking: BLOCKS_PHYSICAL_QUALIFICATION
Root cause: JWKS provider não expõe snapshot e runtime preenche campos constantes.
Current behavior: ready_with_cached_keys é inalcançável; catalog/audit podem aparecer saudáveis sem check.
Expected behavior: todos os outcomes e feature counts observados, bounded e sem secrets.
Implementation approach: read-only cache snapshot, explicit readiness evaluator e injected posture readers.
Files to inspect: JWKS provider/auth composition, runtime e security status route.
Files likely to change: esses módulos e tests.
Tests to add: fresh/cache/rotation/outage/expiry/malformed/duplicate e catalog/audit failure.
Regression risks: expor kid/issuer/audience ou disparar refresh não solicitado.
Dependencies: HIGH-006.
Acceptance criteria: status nunca usa constantes positivas e não faz network implícito no inspect.
Validation commands: authentication, maintenance e status HTTP tests.
Documentation impact: identity readiness/recovery.
Estimated effort: Large
```

### Task AUD-MED-006

```text
Task ID: REM-P1-006
Finding: AUD-MED-006
Title: Gerar inventory transitivo de produção e licenças
Priority: P1
Severity: Medium
Confidence: Confirmed
Blocking: BLOCKS_PHYSICAL_QUALIFICATION
Root cause: documento foi montado com dependências diretas, sem fechar package-lock.
Current behavior: dezenas de packages runtime não entram na revisão.
Expected behavior: árvore production completa, determinística e offline.
Implementation approach: strict lockfile walker para prod/optional/peer resolvidos, dedupe por name/version/integrity e license policy.
Files to inspect: package-lock e release inventory.
Files likely to change: release generator/tests, inventory derivado e CI.
Tests to add: transitive/optional/peer, duplicate version, missing license/integrity e ordering.
Regression risks: contar dev-only ou omitir optional usado na plataforma.
Dependencies: HIGH-008.
Acceptance criteria: fechamento confere com npm ls --omit=dev --all e unknown falha.
Validation commands: inventory generate/check e npm audit --omit=dev.
Documentation impact: production dependencies/license report.
Estimated effort: Medium
```

### Task AUD-MED-007

```text
Task ID: REM-P1-007
Finding: AUD-MED-007
Title: Implementar matrizes executáveis e rehearsal completo
Priority: P1
Severity: Medium
Confidence: Confirmed
Blocking: BLOCKS_PHYSICAL_QUALIFICATION
Root cause: CI invoca suites amplas, mas não gera casos dos contratos declarados.
Current behavior: bugs de policy/persistência passam em 198 files verdes.
Expected behavior: cada descriptor/failure window possui negação e efeito observável.
Implementation approach: data-driven matrices com expected independente da implementação e fault injection realista.
Files to inspect: tests/http, deployment rehearsal e CI.
Files likely to change: novos tests/fixtures, rehearsal Go e workflow.
Tests to add: route, browser, identity, config, storage, bundle e evidence matrices.
Regression risks: teste tautológico ou mock substituir boundary.
Dependencies: todos os fixes.
Acceptance criteria: mutation deliberada de policy/invariant falha a suite.
Validation commands: targeted matrices e full release gate.
Documentation impact: release rehearsal.
Estimated effort: Extra Large
```

### Task AUD-LOW-001

```text
Task ID: REM-P2-001
Finding: AUD-LOW-001
Title: Propagar correlation ID interno
Priority: P2
Severity: Low
Confidence: Confirmed
Blocking: NEXT_VERSION; pode ser incluído na Fase 5
Root cause: ID é criado diretamente no response sem request-scoped context.
Current behavior: erro/log não pode ser correlacionado ao header.
Expected behavior: mesmo UUID interno em response e structured logs, nunca como auth/idempotency.
Implementation approach: middleware inicial cria typed context; logger usa campo bounded.
Files to inspect: administrative-http, error handler e logger.
Files likely to change: middleware/types/tests.
Tests to add: success/error/concurrency e caller request-ID spoof.
Regression risks: aceitar caller ID ou persistir PII.
Dependencies: HIGH-006.
Acceptance criteria: ID interno consistente e não autoritativo.
Validation commands: HTTP/logging tests.
Documentation impact: observability.
Estimated effort: Medium
```

### Task AUD-LOW-002

```text
Task ID: REM-P2-002
Finding: AUD-LOW-002
Title: Aplicar Fetch Metadata por response category
Priority: P2
Severity: Low
Confidence: Confirmed
Blocking: BLOCKS_STABLE_RELEASE
Root cause: destination é somente syntax-checked.
Current behavior: contextos dest incompatíveis alcançam auth.
Expected behavior: shell/assets/API aceitam apenas mode/dest revisados; ausência válida para non-browser.
Implementation approach: policy no route definition e envelope shared.
Files to inspect: security envelope e route response policy.
Files likely to change: envelope/catalog/tests.
Tests to add: navigate/script/style/empty/cors/no-cors e malformed.
Regression risks: browser compatibility.
Dependencies: HIGH-006 e MED-001.
Acceptance criteria: matrix explícita sem substituir auth.
Validation commands: browser-security tests.
Documentation impact: security envelope.
Estimated effort: Small
```

### Task AUD-LOW-003

```text
Task ID: REM-P2-003
Finding: AUD-LOW-003
Title: Reconciliar precedência documental
Priority: P2
Severity: Low
Confidence: Confirmed
Blocking: BLOCKS_STABLE_RELEASE
Root cause: visão/initial scope históricos não foram marcados como superseded.
Current behavior: CLI/logical backup aparecem simultaneamente entregues e deferidos.
Expected behavior: ADR-023/025 e requirements atuais têm precedência explícita.
Implementation approach: editar fontes normativas após fixes e adicionar consistency validator.
Files to inspect: product vision, requirements, roadmap, README e glossary.
Files likely to change: esses documentos e docs validator.
Tests to add: identifier/scope consistency.
Regression risks: reabrir escopo por engano.
Dependencies: HIGH-008 release decision.
Acceptance criteria: nenhuma contradição sobre CLI/restore/physical release.
Validation commands: docs validator e format check.
Documentation impact: direto.
Estimated effort: Small
```

### Task AUD-LOW-004

```text
Task ID: REM-P2-004
Finding: AUD-LOW-004
Title: Fixar Actions e toolchains
Priority: P2
Severity: Low
Confidence: Confirmed
Blocking: BLOCKS_STABLE_RELEASE
Root cause: mutable action tags e Node major sem patch.
Current behavior: build pode mudar sem source diff.
Expected behavior: Actions por commit SHA e Node/npm/Go exatos.
Implementation approach: pins revisados e validator que compara workflow/contract/builder.
Files to inspect: CI workflow e bundle pinned constants.
Files likely to change: workflow e release docs.
Tests to add: deliberate version mismatch.
Regression risks: manutenção dos SHAs.
Dependencies: HIGH-008.
Acceptance criteria: CI falha em qualquer toolchain mismatch.
Validation commands: workflow validator e full CI.
Documentation impact: dependency update policy.
Estimated effort: Small
```

### Task AUD-INFO-001

```text
Task ID: REM-P3-001
Finding: AUD-INFO-001
Title: Planejar checks externos allowlisted
Priority: P3
Severity: Informative
Confidence: Confirmed
Blocking: BACKLOG
Root cause: FR-004 Should foi deferido na implementação.
Current behavior: health é local.
Expected behavior: nenhuma mudança neste ciclo.
Implementation approach: futura ADR de egress/SSRF antes de código.
Files to inspect: future.
Files likely to change: none in remediation.
Tests to add: future timeout/DNS/allowlist/SSRF.
Regression risks: ampliar superfície de rede.
Dependencies: future requirement.
Acceptance criteria: Issue futura criada ou deferimento mantido explícito.
Validation commands: none now.
Documentation impact: backlog only.
Estimated effort: Large
```

### Task AUD-INFO-002

```text
Task ID: REM-P3-002
Finding: AUD-INFO-002
Title: Planejar maintenance response pública
Priority: P3
Severity: Informative
Confidence: Confirmed
Blocking: BACKLOG
Root cause: FR-015 Should não foi entregue.
Current behavior: dashboard conhece intent; consumidor público não.
Expected behavior: nenhuma mudança neste ciclo.
Implementation approach: futura ADR separada do control plane.
Files to inspect: future.
Files likely to change: none in remediation.
Tests to add: future availability/cache/privacy.
Regression risks: vazar schedule/admin state.
Dependencies: future ingress decision.
Acceptance criteria: deferimento explícito.
Validation commands: none now.
Documentation impact: backlog only.
Estimated effort: Medium
```

### Task AUD-INFO-003

```text
Task ID: REM-P3-003
Finding: AUD-INFO-003
Title: Preservar gates físicos separados
Priority: P3
Severity: Informative
Confidence: Confirmed
Blocking: ACCEPTED_LIMIT / physical drill
Root cause: efeitos reais exigem host e aprovação.
Current behavior: mock backend e effects disabled.
Expected behavior: continuar disabled durante toda remediação e qualification software.
Implementation approach: somente assertions negativas e runbook futuro separado.
Files to inspect: power profile, systemd unit e physical runbooks.
Files likely to change: nenhum comportamento real neste ciclo.
Tests to add: profile/bundle assertions de ausência de efeito.
Regression risks: combinar helper activation com first drill.
Dependencies: software READY decision.
Acceptance criteria: no helper/RTC/D-Bus/shutdown access nos jobs.
Validation commands: safety scans e mock rehearsals.
Documentation impact: manter physical gate explícito.
Estimated effort: Large
```

## 6. Test strategy

### Testes que devem falhar antes da correção

<!-- prettier-ignore -->
| Finding | Regression test | Expected baseline failure |
| ------- | --------------- | ------------------------- |
| HIGH-001 | unit mode materializado e first writes | permissions unsafe |
| HIGH-002 | duas leituras do mesmo JSONL corrupto | segunda retorna success/empty |
| HIGH-003 | 1.001 runs + restart | conflict em 102 e/ou journal inválido |
| HIGH-004 | policy combined e 150 successes | mínimo removido ou artifact desconhecido bloqueia incorretamente |
| HIGH-005 | três prunes | segundo integrity broken |
| HIGH-006 | definition/route mutation | startup continua |
| HIGH-007 | state-write failure após environment publish | current/state divergem |
| HIGH-008 | release validator contra placeholders/unavailable | gate atual passa por existência |
| MED-001 | Host com userinfo/path/query/hash | matcher aceita |
| MED-002 | orphan export / footer tamper | inventory não bloqueia integralmente |
| MED-003 | migration interruption no evento N | root final parcial existe |
| MED-004 | alterar src/dashboard e comparar runtime/bundle | assets divergem |
| MED-005 | outage com cache válido e catalog mismatch | outcome/status incorretos |
| MED-006 | comparar lockfile production closure | inventory omite transitivas |
| MED-007 | executar route/config/release matrix inventory | casos ausentes |

### Camadas

- **Unitários:** hash helpers, strict parsers, state machines, retention
  selection, route-definition invariants e dependency walker.
- **Integração:** file stores reais em `mkdtemp`, fsync/rename, restart,
  concurrent calls, protected audit ordering e packaged TypeScript parser.
- **Processo:** separate Node instances para writer/backup, child process
  bounded para maintenance e fake systemd apenas.
- **Persistência/reconstrução:** every line/transition, truncation, mutation,
  chmod/link/replace e repeated read.
- **Concorrência:** process-local gates, event cross-process lock e decisão
  explícita de single-writer de backup. Antes da stable release, implementar
  lock cross-processo ou provar/enforce single instance; não deixar como
  suposição.
- **HTTP:** data-driven por definition com disabled/auth/role/body/query/media/
  confirmation/gate/audit/replay/headers/CORS.
- **Dashboard:** DOM seguro, sem browser storage/external requests, a11y,
  capability controls, confirmation clearing e authoritative reread.
- **Deployment:** unit modes, install/verify/replace/rollback/upgrade e failure
  windows sem real systemd/accounts.
- **Bundle:** closed inventory, exact modes, manifest/checksum, two builds.
- **Evidence:** two roots, canonical bytes, tamper rejection e no placeholders.

Relógios, UUIDs e source date são injetados. Temporary roots são sempre limpos;
processos e servers são encerrados. Nenhum teste usa porta fixa se puder usar
porta efêmera.

## 7. Contract and evidence regeneration

### Outputs derivados

<!-- prettier-ignore -->
| Output | Responsible entrypoint | Preconditions | Invariants |
| ------ | ---------------------- | ------------- | ---------- |
| `docs/contracts/atlas-manager-administrative-api.json` | fixed API-contract generator from route definitions | HIGH-006 closed | full descriptors, canonical order, digest recalculable |
| `docs/release/atlas-manager-production-dependencies.json` | offline lockfile inventory generator | MED-006 closed | full production closure, licenses/integrities known |
| dashboard asset inventory | deterministic dashboard build | MED-004 closed | no maps/CDN, same bytes in route/bundle |
| requirements traceability | structured requirement mapping generator/validator | all functional statuses known | every FR/NFR/SEC explicit, no broad fictional ranges |
| release security review | reviewed report plus strict classification validator | all security tasks closed | no unresolved Critical/High |
| bundle manifest/SHA256SUMS | deployment bundle builder | contracts/assets stable | closed inventory and exact modes |
| release evidence JSON | final evidence assembler | all machine reports present | qualified only on all-pass |
| release contract JSON | detached final contract assembler | bundle/evidence digests final | no circular inclusion, source commit fixed |

### Entry points

Implementar um entrypoint estreito de release qualification com actions fixas,
sem output path fornecido pelo caller:

```text
generate-administrative-api-contract
generate-production-dependency-inventory
validate-requirements-traceability
assemble-release-evidence
assemble-release-contract
verify-derived-artifacts
```

Em CI, generators rodam primeiro em temporary output e comparam bytes com
snapshots quando estes forem versionados. `--write` genérico e arbitrary path não
são suportados.

### Ausência de placeholders

`qualified` deve rejeitar qualquer valor ou token:

```text
placeholder
replace-with
ci-generated
environment_unavailable
not_run
unknown license
<64 lowercase...
```

Hashes esperados não são documentados antecipadamente. Devem ser recalculados
de bytes canônicos e comparados por duas execuções independentes.

## 8. CI qualification

### Local mandatory

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test -- --maxWorkers=1
npm run build
npm audit --omit=dev
git diff --check
```

Também obrigatórios localmente antes de abrir revisão:

- regressions direcionadas de cada task;
- API contract generator em check mode;
- requirements/dependency validators;
- scan de secrets/placeholders;
- nenhuma alteração não intencional em generated artifacts.

### CI mandatory

Jobs separados:

1. **node-quality:** format, lint, typecheck, serial tests e build;
2. **storage-integrity:** backup/event-history regression, reconstruction,
   concurrency e attack matrices;
3. **administrative-security:** route reconciliation, browser, auth, identity,
   dashboard e no-CORS;
4. **deployment-go:** gofmt check, mod verify, vet e all tests;
5. **power-helper-go:** gofmt check, mod verify, vet, tests e Node compatibility
   fixture;
6. **configuration-lifecycle:** replace/rollback matrix e packaged TS parser;
7. **supply-chain:** production audit, dependency/license closure, pinned
   toolchains e secret scan;
8. **bundle:** build A/B, inspect, SHA equality e packaged smoke;
9. **release-rehearsal:** roots A/B, evidence byte equality;
10. **release-assembler:** consumes immutable reports from jobs anteriores e
    produz `qualified|not_qualified`.

Nenhum job pode converter “skipped”, “unavailable” ou “not run” em sucesso.

### Physical qualification deferred

Fora do CI e desta remediação:

- ThinkCentre real;
- Cloudflare Tunnel/Access real;
- systemd/account/group reais;
- helper install/setuid;
- RTC read/write/wake;
- logind shutdown;
- firmware wake e real-effect rollback.

## 9. Release decision

### KEEP 1.0.0-rc.1

Permitido somente se todos forem verdadeiros:

- nenhum artifact `1.0.0-rc.1` foi distribuído, instalado ou usado por terceiro;
- não existe tag, GitHub Release, registry artifact ou bundle publicado;
- política documental afirma que rc.1 era rascunho não publicado;
- release notes/evidence incorretas são retiradas antes de qualquer consumo;
- todos os fixes e nova evidence podem ser incorporados sem quebrar identidade
  já observada.

Mesmo assim, a decisão exige aprovação explícita do owner e registro no ADR/
release notes.

### CREATE 1.0.0-rc.2

Obrigatório se qualquer um for verdadeiro:

- rc.1 foi compartilhado ou considerado qualificado;
- bundle/evidence rc.1 foi gerado fora do repositório;
- correções mudam persistência, route contract, deployment modes,
  configuration generations ou dashboard assets;
- contracts/digests do candidate mudam;
- não é possível provar ausência de consumo do identificador rc.1.

Os fixes planejados alteram todos esses contratos materiais. Portanto a decisão
preliminar é **CREATE 1.0.0-rc.2**. O bump ocorre somente depois dos P0/P1
funcionais e antes do freeze do source commit, nunca durante correções
intermediárias.

## 10. Final go/no-go checklist

### Software correctness

- [ ] Todos os testes vermelhos da Fase 0 passam após suas correções.
- [ ] Nenhum High permanece aberto.
- [ ] Nenhum Medium permanece aberto.
- [ ] LOW-002/003/004 estão fechados antes de stable release.
- [ ] State/runtime roots são owner-only e aceitos pelos stores.
- [ ] Backup corruption permanece fail-closed em leituras repetidas.
- [ ] 1.001+ runs mantêm sequence contígua após restart.
- [ ] Retention preserva o mínimo e processa mais de 100 artifacts.
- [ ] Três ou mais event-history prunes preservam integrity.
- [ ] Export/migration unknown state falha fechado.
- [ ] Configuration replacement/rollback é transacional e usa parser TS real.

### Administrative security

- [ ] Toda rota `/admin` é registrada pela única route-definition registry.
- [ ] Startup rejeita qualquer mismatch de route/policy/operation/permission.
- [ ] Host/Origin/Fetch Metadata matrices passam.
- [ ] Forwarded headers não alteram nenhum security decision.
- [ ] Security status deriva de readers reais.
- [ ] Identity cached/outage/rotation matrix passa.
- [ ] Dashboard entregue é o asset source canônico.
- [ ] No CORS, session, auth cookie, JWT storage ou role claim foi introduzido.

### Toolchain and artifacts

- [ ] Node validation completa passa.
- [ ] Deployment Go formatting/module/vet/tests passam.
- [ ] Power-helper Go formatting/module/vet/tests passam.
- [ ] Production npm audit retorna zero.
- [ ] Dependency/license inventory fecha o lockfile production.
- [ ] Actions/toolchains estão fixados.
- [ ] Dois dashboard builds são byte-idênticos.
- [ ] Dois bundles são byte-idênticos e passam inspection.
- [ ] Packaged smoke usa artifacts do source commit congelado.
- [ ] Duas rehearsals em roots distintos geram bytes idênticos.

### Contracts and evidence

- [ ] API contract é gerado das route definitions reais.
- [ ] Every FR/NFR/SEC está individualmente rastreado.
- [ ] Release security review não tem Critical/High aberto.
- [ ] Baseline/source commit correspondem ao candidate congelado.
- [ ] Nenhum placeholder/unavailable/not_run aparece em qualified.
- [ ] Todos os SHA-256 são recalculáveis de seus bytes.
- [ ] Release contract não participa do bundle cujo hash declara.
- [ ] Tamper de qualquer report produz `not_qualified`.

### Safety

- [ ] Nenhum Cloudflare real foi contatado.
- [ ] Nenhum systemctl/Docker/PM2 real foi executado.
- [ ] Nenhum usuário/grupo real foi criado ou alterado.
- [ ] Nenhum helper real foi instalado ou executado.
- [ ] Nenhum RTC ou D-Bus foi acessado.
- [ ] Nenhum wake/shutdown/reboot/suspend/hibernate ocorreu.
- [ ] Restore, remote backup, SIEM e CLI geral não foram adicionados.

### Decision

```text
READY FOR PHYSICAL QUALIFICATION
```

somente quando todas as caixas de software, segurança, toolchain, contracts e
safety estiverem marcadas por evidence verificável.

Qualquer caixa obrigatória não marcada resulta em:

```text
NOT READY FOR PHYSICAL QUALIFICATION
```

Sem exceção baseada em “aparentemente”, sucesso parcial ou documento
declarativo.
