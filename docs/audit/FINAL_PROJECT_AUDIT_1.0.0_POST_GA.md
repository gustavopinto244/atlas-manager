# Auditoria final pós-GA — Atlas Manager 1.0.0

Data: 2026-08-13

## Resultado executivo

```text
PASS_WITH_DOCUMENTED_LIMITS
```

O estado auditado preserva o modo seguro esperado para `1.0.0`: o profile
systemd instalado por padrão é mock-only, não recebe o grupo
`atlas-manager-power`, aplica `NoNewPrivileges=true` e
`RestrictSUIDSGID=true`, e nenhuma configuração corrente habilita backend,
efeitos ou scheduler físicos. As gates independentes do ADR-015 continuam
presentes e fail-closed no source.

Não foram encontrados findings críticos ou altos no estado efetivamente
gerado. Foram encontrados três findings médios, todos relativos a garantias de
validação ou regressão que são mais amplas no texto do que no código:

1. o validador dos profiles systemd não fecha o conjunto completo de
   diretivas admitidas;
2. a classificação de requirements assume `implemented` quando falta uma
   decisão explícita e o snapshot versionado não possui uma equivalência total
   obrigatória no gate;
3. a verificação de ativação administrativa cobre somente uma fração das
   superfícies obrigatórias do profile que chama de `active_mock_verified`.

O source atual, os artefatos versionados e os testes permanecem coerentes
apesar desses gaps. Eles não demonstram uma exposição ativa no deployment GA,
mas devem ser corrigidos no início da manutenção, antes que mudanças futuras
dependam desses validadores como contratos fechados.

Também há uma imprecisão documental baixa no título/terminologia de dois
artefatos GA e uma observação de higiene da suíte de testes. Os gaps
operacionais já conhecidos continuam documentados sem evidência fabricada.

### Estado pós-remediação

Os findings abaixo são preservados como registro da auditoria do commit
`4d19b37c204e801fb569cdc8a782ee4af67cd2e0`. As correções subsequentes fecharam
os três findings médios, o finding baixo e a observação da suíte. A decisão
continua `PASS_WITH_DOCUMENTED_LIMITS` somente pelos gaps de evidência
operacional externa enumerados neste documento, não por finding de software
aberto.

## Baseline auditado

| Item                         | Valor                                              |
| ---------------------------- | -------------------------------------------------- |
| Repositório                  | `gustavopinto244/atlas-manager`                    |
| Branch                       | `agent/final-1.0.0-reconciliation-power-hardening` |
| Commit auditado              | `4d19b37c204e801fb569cdc8a782ee4af67cd2e0`         |
| `origin/main` observado      | `818daf21f2af319dc33c62d57f5f1260cfd7ecaf`         |
| Merge-base com `origin/main` | `818daf21f2af319dc33c62d57f5f1260cfd7ecaf`         |
| Relação                      | quatro commits à frente de `origin/main`           |
| Working tree inicial         | limpo                                              |
| Versão                       | `1.0.0`                                            |

Os quatro commits auditados são:

- `6c7deaa fix: reconcile v1 traceability inventories`;
- `c6f37b6 fix: harden default systemd power profile`;
- `52e2ab4 fix: reconcile 1.0.0 security and release state`;
- `4d19b37 ci: pin actions and verify power profiles`.

A comparação com `origin/main` contém 52 arquivos, 1.320 inserções e 279
remoções. Esta auditoria não fez fetch nem alterou a referência remota; os SHAs
acima são os observados no início do trabalho.

## Escopo e método

Foram correlacionados documentos normativos, ADRs aceitos, source TypeScript,
tooling Go de deployment, power-helper, contrato HTTP, geradores, snapshots,
workflow de CI e testes. Quando documentos históricos divergiam, o source,
os testes e os ADRs aceitos foram tratados como autoridade.

A revisão incluiu, em especial:

- requirements, capability matrix, architecture, security model, product
  vision, roadmap e `SECURITY.md`;
- traceability, release contract, security review histórico e evidência final
  de acceptance GA;
- catálogo de rotas administrativas e árvore de comandos CLI;
- composição, configuração e admissão de power-management;
- ADR-015, ADR-033, ADR-034 e ADR-035;
- units systemd, bundle inspection, instalação, runtime identity e service
  lifecycle;
- pinning de GitHub Actions, lockfile e dependency audit;
- inventário e resolução de links Markdown.

Todas as reproduções usaram somente o workspace, fixtures determinísticas e
um diretório temporário em `/tmp`. O host Atlas não foi acessado.

## Estado confirmado

### Requirements e capability inventories

O inventário derivado diretamente do source é:

| Inventário                       | Quantidade |
| -------------------------------- | ---------: |
| Administrative route descriptors |         52 |
| CLI command nodes                |         39 |
| CLI nodes implementados          |         39 |
| CLI stubs                        |          0 |

O `catalogSha256` calculado é
`255501931919a73ba8f669db1d7cce76d18aced624b6996aba60e78765044001` e
coincide com o contrato administrativo versionado. A marca machine-readable em
`docs/capabilities.md` coincide com o catálogo de rotas, a árvore CLI e o
contrato.

FR-037 está corretamente classificado como `implemented`. FR-026 está
corretamente classificado como `implemented_with_physical_gate`, com a decisão
futura sobre autoridade da policy persistida separada da ativação e da
qualificação física. FR-022, FR-024, FR-025 e FR-027 usam a mesma separação
quando aplicável. FR-004 e FR-015 permanecem deferred.

O snapshot de traceability versionado foi regenerado em `/tmp` com
`RELEASE_SNAPSHOT=true` e comparado com `cmp`; o conteúdo atual é byte a byte
igual ao output do gerador. O finding sobre traceability abaixo é, portanto,
um risco de regressão do mecanismo, não uma divergência presente entre os dois
arquivos.

### Documentação normativa e histórica

O estado corrente de autenticação, RBAC, dashboard e CLI/service-token está
corretamente descrito em `docs/security-model.md` e `docs/architecture.md`.
Afirmações antigas sobre ausência de autenticação ou CLI estão identificadas
como história nos documentos correntes revisados.

O generic v1 security review e o operational-readiness review são claramente
rotulados como snapshots históricos de `1.0.0-rc.8`. A auditoria de rc.1 e as
matrizes relacionadas têm avisos históricos e apontam para remediação e GA.
O `docs/agent-handoff.md` também separa o estado corrente do arquivo RC
histórico.

Product Vision e `SECURITY.md` distinguem software/control plane, acceptance
real do deployment Atlas/Cloudflare e efeitos físicos ainda não qualificados.
Os três gaps de evidência operacional permanecem explícitos.

A varredura de 202 arquivos Markdown encontrou zero links relativos quebrados.

### Power-management e systemd

O profile default contém:

```text
User=atlas-manager
Group=atlas-manager
NoNewPrivileges=true
RestrictSUIDSGID=true
```

e não contém `SupplementaryGroups` nem `atlas-manager-power`. O installer copia
somente `systemd/atlas-manager.service`; o template future power-enabled fica
em `systemd/profiles/` e não possui seleção implícita por installer, helper ou
presença de arquivo. Runtime verification do mock rejeita membership efetiva
no helper group.

O profile future power-enabled adiciona apenas o grupo fixo necessário ao
helper e remove os dois hardenings incompatíveis com setuid. Ele não define
backend, activation, confirmation, helper digest, scheduler ou flags HTTP.

As seguintes gates do ADR-015 continuam independentes:

```text
POWER_MANAGEMENT_BACKEND=linux_helper
surface effect-capable explicitamente habilitada
MACHINE_POWER_EFFECTS_ACTIVATION=linux_helper
MACHINE_POWER_EFFECTS_CONFIRMATION=confirm_linux_helper_power_effects
LINUX_POWER_HELPER_EXPECTED_SHA256=<SHA-256 exato e não zero>
runtime identity admission
preflight read-only do helper fixo
autenticação, RBAC e confirmação da operação
policy confirmation, readiness, preparation e permanent claims
qualificação e certificação físicas separadas
```

Não há path de helper configurável, discovery, sudo implícito, ativação HTTP,
fallback silencioso para mock ou preflight depois de abrir HTTP/scheduler.

ADR-033 também permanece intacto: a policy persistida é autoridade para o
control plane declarativo e preview; o scheduler desabilitado consome a policy
imutável do environment. Escolher a autoridade futura continua sendo uma nova
decisão de ativação, não um live reload implícito.

### Supply chain e credenciais

Todas as cinco referências a Actions no único workflow estão pinadas a quatro
SHAs imutáveis revisados, com a versão humana em comentário. O teste de CI
rejeita pins por tag, SHA não reconhecido e ausência do comentário.

Os audits npm executados em 2026-08-13 retornaram zero vulnerabilidades tanto
para produção quanto para a árvore completa. Uma busca direcionada por markers
comuns de private key, AWS access key e GitHub token não encontrou credencial
versionada; o único match de service-token foi o placeholder explícito
`<client-secret>` da documentação.

Os exemplos correntes recomendam roles estreitas para service principals e
não usam `administrator` como default de automação. O acceptance GA preserva,
corretamente, o fato histórico de que o principal real testado recebeu
`administrator`.

## Findings

### AUD-FINAL-MED-001 — Validação de systemd não fecha diretivas e overrides

- **Severidade:** Medium
- **Confiança:** Alta
- **Área:** Deployment / least privilege / fail-closed validation
- **Status pós-remediação:** CLOSED em 2026-08-13
- **Evidência principal:** `deployment/internal/systemdunit/unit.go:124-184`,
  `deployment/internal/installer/installer.go:185-208`

`ValidateForProfile` procura a maior parte das diretivas obrigatórias com
`strings.Contains` e rejeita somente uma lista estreita de substrings. Apenas
`NoNewPrivileges`, `RestrictSUIDSGID` e `SupplementaryGroups` têm controle de
unicidade/valor por linha.

Consequentemente, um valor pode conter todas as linhas esperadas e ainda
incluir diretivas adicionais ou overrides que o validador não conhece. Entre
os exemplos que não são rejeitados pela implementação estão uma segunda
diretiva `User=root`, concessões como `AmbientCapabilities=CAP_SYS_BOOT` ou
`CapabilityBoundingSet=CAP_SYS_BOOT`, e overrides de hardening como
`ProtectSystem=false`. O mesmo problema existe nos dois profiles. Comentários
também podem satisfazer os checks baseados em substring.

`InspectBundleReadOnly` chama esses validadores depois de verificar manifest e
`SHA256SUMS`. Esses hashes provam consistência interna, não impedem que um
bundle autoconsistente carregue uma unit semanticamente ampliada. O projeto já
documenta que checksum não fornece autenticidade, mas o validador de profile
ainda afirma uma garantia semântica fail-closed que não cumpre integralmente.

O risco ativo é mitigado porque os dois conteúdos constantes atualmente
gerados foram revisados e são seguros, o installer seleciona apenas o mock e o
runtime mock rejeita o helper group. Não há entrada HTTP ou de usuário que
reescreva a unit. Por isso o finding é Medium, apesar do alto impacto potencial
de uma regressão admitida por um installer executado como root.

**Recomendação:** para os profiles imutáveis atuais, comparar bytes
normalizados com `Content`/`PowerEnabledContent` é a solução menor e mais
fechada. Se variabilidade futura for necessária, fazer parsing por section,
rejeitar diretivas desconhecidas e duplicatas/overrides e validar um multiset
exato. Adicionar regressões negativas para `User=root`, capabilities, segundo
`ExecStart`, reset de listas e overrides de cada hardening.

**Remediação aplicada:** `ValidateForProfile` agora aceita somente equivalência
byte a byte com o conteúdo canônico do profile explicitamente selecionado.
`ValidateManaged` mantém compatibilidade apenas com os conteúdos históricos
nominalmente enumerados, também por equivalência exata. Regressões negativas
cobrem usuário root, capabilities de boot, override de hardening, segundo ou
reset de `ExecStart`, comentários que tentem simular diretivas e bytes extras.

### AUD-FINAL-MED-002 — Traceability classifica ausências como implemented

- **Severidade:** Medium
- **Confiança:** Alta
- **Área:** Requirements governance / release evidence
- **Status pós-remediação:** CLOSED em 2026-08-13
- **Evidência principal:**
  `scripts/generate-requirements-traceability.mjs:23-67`,
  `tests/release/requirements-traceability.test.ts:33-54`,
  `scripts/validate-versioned-release-snapshots.mjs:14-53`

Há 64 requirements normativos: 38 FR, 14 NFR e 12 SEC. O arquivo de status
classifica explicitamente somente sete: dois deferred e cinco
implemented-with-physical-gate. Os outros 57 são classificados como
`implemented` por ausência de entrada.

O gerador falha para IDs desconhecidos e conflitos entre as duas listas, mas
não falha quando um requirement normativo não possui decisão explícita. Assim,
um novo `FR-*`, `NFR-*` ou `SEC-*` entra automaticamente como implementado no
próximo output, antes de uma revisão de source/evidência.

Os testes específicos protegem FR-037 e FR-026. O snapshot validator protege a
natureza detached dos snapshots, mas não compara o documento inteiro ao
gerador. O gate de release gera outra cópia em diretório de artifacts e valida
essa cópia, sem exigir equivalência com o snapshot versionado. Hoje eles são
equivalentes, mas o mecanismo permite drift futuro nas outras 62 linhas.

**Recomendação:** representar `implemented`,
`implementedWithPhysicalGate` e `deferredByAcceptedScope` como uma partição
completa do inventário. O gerador deve falhar para ID ausente, desconhecido ou
duplicado. Extrair o renderer para uma função testável e comparar o snapshot
versionado completo com a geração detached.

**Remediação aplicada:** os 64 requirements agora possuem exatamente uma
classificação explícita. O gerador falha para ID ausente, desconhecido,
duplicado ou presente em mais de uma classe. O novo modo
`--check-versioned` gera a representação detached em memória e exige
equivalência integral com o snapshot versionado; esse check passou a integrar
`release:validate-snapshots`.

### AUD-FINAL-MED-003 — `active_mock_verified` cobre só parte do profile administrativo

- **Severidade:** Medium
- **Confiança:** Alta
- **Área:** Operational verification / deployment lifecycle
- **Status pós-remediação:** CLOSED em 2026-08-13
- **Evidência principal:**
  `deployment/internal/runtimeverification/verification.go:31-127`,
  `deployment/internal/servicelifecycle/lifecycle.go:159-174`,
  `deployment/internal/servicelifecycle/lifecycle.go:350-406`

O parser do profile administrativo exige que event history, service
management, service availability, overview, dashboard, backups e security
status estejam habilitados. Porém `VerifyAdministrative` verifica health,
`GET /admin/event-history` e cinco métodos de wake/shutdown. Ele não prova a
presença ou o envelope protegido de dashboard, assets, overview, services,
availability, backups, security status ou event-history operations.

Portanto, a ativação pode retornar `active_mock_verified` mesmo se uma dessas
superfícies obrigatórias estiver ausente, desde que health, event history e o
estado esperado das rotas power respondam corretamente.

O risco corrente é reduzido porque a reconciliação Express ↔ catálogo falha no
startup, os testes Node cobrem as rotas, o rehearsal completo cobre o control
plane e o acceptance GA exercitou as principais capacidades. A lacuna está no
significado do verificador operacional usado em uma ativação futura, não na
implementação atual das rotas.

**Recomendação:** definir uma matriz canônica de probes seguros derivada do
profile. Cada superfície habilitada deve provar pelo menos presença, Host
authority, autenticação obrigatória e método esperado sem usar credenciais nem
disparar mutações. Adicionar testes que removam uma superfície obrigatória por
vez e exijam bloqueio da ativação.

**Remediação aplicada:** `VerifyAdministrative` executa agora probes GET sem
credenciais sobre dashboard, asset, event history e integridade, services,
availability, overview, backups e security status. Cada resposta deve manter
o envelope protegido no Host administrativo. As rotas power conservam sua
matriz separada e suas gates; testes removem cada superfície obrigatória por
vez e exigem falha. Nenhum probe executa mutação autenticada ou efeito físico.

### AUD-FINAL-LOW-001 — Terminologia de GA ainda usa release-candidate/physical release

- **Severidade:** Low
- **Confiança:** Alta
- **Área:** Documentação de release
- **Status pós-remediação:** CLOSED em 2026-08-13
- **Evidência:**
  `docs/release/atlas-manager-v1-requirements-traceability.md:3-5`,
  `scripts/generate-requirements-traceability.mjs:108-112`,
  `docs/roadmap.md:841-849`

O traceability de `1.0.0` se identifica como `Release candidate` e usa
`software-only qualification`, embora seja um snapshot de GA com acceptance
real de deployment documentado separadamente. O roadmap usa o heading
`v1.0 stable physical release — completed`, que pode ser confundido com
qualificação de power físico.

Os parágrafos próximos e todos os documentos de segurança deixam claro que
RTC/wake/shutdown físicos continuam desabilitados e não qualificados. Não há
claim falso quando o texto é lido em contexto; resta uma ambiguidade de baixa
severidade.

**Recomendação:** gerar `Release: 1.0.0`, chamar o escopo de
`software/control-plane traceability with separate physical-effect gates` e
renomear o heading do roadmap para `stable GA deployment on Atlas`.

**Remediação aplicada:** o snapshot e sua fonte geradora usam `Release:
1.0.0` e distinguem control plane de gates físicas. O roadmap agora denomina o
marco como deployment GA estável no Atlas, sem sugerir qualificação de efeitos
físicos.

## Observação não classificada como finding

A suíte Node completa passa, mas emite `MaxListenersExceededWarning` para
`unhandledRejection` e `uncaughtException`. `tests/main.test.ts` importa
`src/main.ts` repetidamente e cada inicialização registra handlers globais no
`process`; o runtime de produção inicializa uma vez. Não há evidência de leak
no uso normal, porém o ruído pode ocultar regressões reais da lifecycle.
Recomenda-se que o harness remova handlers no teardown ou que a composição de
startup exponha uma cleanup testável.

**Status pós-remediação:** CLOSED em 2026-08-13. O harness preserva os
listeners preexistentes e remove no teardown somente os listeners adicionados
pela importação isolada de `src/main.ts`. A suíte completa foi repetida sem o
warning; o comportamento de startup de produção não foi alterado.

## Validação executada

Toolchain local desta auditoria:

- Node.js `24.19.0`;
- npm `11.17.0`;
- Go `1.26.5-X:nodwarf5`.

Ela não substitui a evidência de reproducibilidade do release, que foi gerada
com Node `24.18.0`, npm `11.16.0` e Go `1.23.0` no gate já versionado para este
commit.

| Comando/check                                           | Resultado                           |
| ------------------------------------------------------- | ----------------------------------- |
| `npm run format:check`                                  | PASS                                |
| `npm run lint`                                          | PASS                                |
| `npm run typecheck`                                     | PASS                                |
| `npm run build`                                         | PASS                                |
| full `npm test` com power-helper fixture determinística | PASS — 260 files, 3.482 tests       |
| deployment `gofmt -l .`                                 | PASS — nenhum arquivo listado       |
| deployment `go vet ./...`                               | PASS                                |
| deployment `go test ./... -count=1`                     | PASS                                |
| power-helper `gofmt -l .`                               | PASS — nenhum arquivo listado       |
| power-helper `go vet ./...`                             | PASS                                |
| power-helper `go test ./... -count=1`                   | PASS                                |
| `npm run release:validate-snapshots`                    | PASS                                |
| traceability generation em `/tmp` + `cmp` com snapshot  | PASS                                |
| route/CLI/API source reconciliation                     | PASS — 52/39/39/0                   |
| `npm run package:operator`                              | PASS                                |
| `npm audit --omit=dev --audit-level=high`               | PASS — zero vulnerabilities         |
| `npm audit --audit-level=high`                          | PASS — zero vulnerabilities         |
| relative Markdown link scan                             | PASS — 202 files, zero broken links |
| `git diff --check`                                      | PASS                                |

O primeiro `npm test` dentro do sandbox falhou somente porque Supertest e a
fixture não puderam abrir sockets/processos (`EPERM`); a repetição fora dessa
restrição passou integralmente. O primeiro package smoke foi bloqueado pela
mesma restrição de subprocesso e passou na repetição. A chamada bare de
`npm run dashboard:verify-assets` rejeitou corretamente a ausência dos três
argumentos obrigatórios (`source-root`, `bundle-root`, `manifest`); geração de
assets passou no build, e a equivalência bundle/served-assets permanece
coberta pelo gate CI/rehearsal registrado no review da tranche.

### Revalidação pós-remediação

| Comando/check                                           | Resultado                     |
| ------------------------------------------------------- | ----------------------------- |
| `npm run format:check`                                  | PASS                          |
| `npm run lint`                                          | PASS                          |
| `npm run typecheck`                                     | PASS                          |
| `npm run build`                                         | PASS                          |
| full `npm test` com power-helper fixture determinística | PASS — 260 files, 3.484 tests |
| deployment `gofmt -l .`                                 | PASS — nenhum arquivo listado |
| deployment `go vet ./...`                               | PASS                          |
| deployment `go test ./... -count=1`                     | PASS                          |
| power-helper `gofmt -l .`                               | PASS — nenhum arquivo listado |
| power-helper `go vet ./...`                             | PASS                          |
| power-helper `go test ./... -count=1`                   | PASS                          |
| `npm run release:validate-snapshots`                    | PASS — snapshot equivalente   |
| `npm run package:operator` + SHA-256 + `atlas --help`   | PASS                          |

Os artefatos de release vinculados a commit e os rehearsals reproduzíveis não
foram regenerados sobre um working tree sem commit, pois isso atribuiria as
mudanças a um SHA anterior. Esses gates permanecem obrigatórios no CI após o
commit; a evidência determinística do baseline auditado continua preservada.

## Evidência operacional que continua externa

Não foi encontrada evidência posterior que feche os limites documentados no
acceptance GA:

- Infrastructure Diagnostics não foram exercitados no host porque a
  capability estava desabilitada;
- backup acceptance observou `targets: []` e não executou um target real;
- rollback foi validado estruturalmente e por testes, sem live
  rollback-and-restore drill;
- helper físico, RTC, wake alarm, logind shutdown e autoridade futura do
  scheduler permanecem não qualificados.

Esses itens são gaps de evidência operacional, não FAILs de software. Nenhum
deles foi inferido como concluído nesta auditoria.

## Remediação pós-auditoria

| Finding/observação   | Estado | Garantia adicionada                               |
| -------------------- | ------ | ------------------------------------------------- |
| `AUD-FINAL-MED-001`  | CLOSED | profiles systemd aceitos por conteúdo exato       |
| `AUD-FINAL-MED-002`  | CLOSED | partição explícita e snapshot integral            |
| `AUD-FINAL-MED-003`  | CLOSED | probes seguros de todas as superfícies requeridas |
| `AUD-FINAL-LOW-001`  | CLOSED | terminologia GA sem claim de power físico         |
| warning de listeners | CLOSED | cleanup isolado no harness de teste               |

O software auditado pode entrar em maintenance mode. Permanecem somente os
limites operacionais externos abaixo; eles não devem ser reinterpretados como
evidência de diagnóstico, backup, rollback ou power físico executado.

## Confirmação explícita de segurança física

Esta auditoria não acessou o host Atlas, não instalou nem executou o helper,
não chamou systemd, PM2, Docker ou Cloudflare real, não tocou RTC ou D-Bus, não
configurou wake alarm e não solicitou shutdown, reboot, suspend ou hibernate.

O estado confirmado permanece:

```text
POWER_MANAGEMENT_BACKEND=mock
MACHINE_POWER_EFFECTS_ACTIVATION=disabled
MACHINE_POWER_SCHEDULER_ENABLED=false
```
