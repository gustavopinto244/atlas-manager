# Auditoria completa do Atlas Manager — v1.0.0-rc.1

## Resumo executivo

O repositório contém uma implementação ampla e, em vários módulos, madura das
capacidades anunciadas: arquitetura modular por feature, adapters de serviço sem
shell, autenticação Cloudflare Access, autorização fixa, agendamento com claims,
backend de energia mock-first, backup por APIs de filesystem, histórico
administrativo segmentado e tooling de deployment.

Entretanto, a qualificação declarada de `1.0.0-rc.1` não é sustentada pelo estado
integrado encontrado. Foram confirmados bloqueadores de funcionamento e de
integridade:

1. a unit systemd cria os roots de backup e event history com modo `0750`, mas os
   stores rejeitam qualquer bit de grupo; o primeiro append protegido falha;
2. uma primeira falha de reconstrução do backup deixa o store marcado como
   carregado e uma segunda leitura retorna estado vazio/ready;
3. a sequência de runs de backup entra em conflito depois de 101 execuções e o
   file store persiste antes de validar a transição em memória;
4. o segundo prune do event history produz uma retention ledger incompatível com
   o próprio verificador;
5. o catálogo de rotas é validado apenas internamente, sem reconciliação com as
   rotas Express e seus parsers reais;
6. replacement/rollback da configuração administrativa não executa o parser
   TypeScript real e tem janelas de publicação parcial;
7. contrato e evidência de release usam baseline antigo, placeholders e uma
   qualificação positiva apesar de gates não executados.

Os 198 arquivos de teste Node passam, mas as matrizes de release, browser
security, identity readiness, configuração gerenciada e falhas de event history
descritas nos documentos não existem com a abrangência declarada. A conclusão é:

```text
AUDIT RESULT:
- NOT READY FOR PHYSICAL QUALIFICATION
```

O resultado não decorre dos gates físicos deliberadamente pendentes. Ele decorre
de defeitos de software reproduzíveis e de evidência de release incompleta.

## Identificação da auditoria

| Item                      | Valor                                                                             |
| ------------------------- | --------------------------------------------------------------------------------- |
| Versão                    | `1.0.0-rc.1`                                                                      |
| Commit                    | `162191dae6415cc33aab4e30a2cb60be7845cb5f`                                        |
| Commit resumido           | `162191d feat: complete administrative hardening and v1 release candidate (#286)` |
| Branch de auditoria       | `audit/v1-rc-complete-review`                                                     |
| `origin/main` após fetch  | `162191dae6415cc33aab4e30a2cb60be7845cb5f`                                        |
| Relação com `origin/main` | `origin/main` é ancestral de `HEAD`; ambos são o mesmo commit                     |
| Working tree inicial      | limpo                                                                             |
| Data da auditoria         | 2026-08-02                                                                        |

Nenhum commit, push, merge, tag, release ou PR foi criado. Nenhum efeito de
systemd, Docker, PM2, RTC, D-Bus, helper real ou Cloudflare real foi executado.

## Escopo e metodologia

Foram lidos e correlacionados:

- 764 arquivos de projeto;
- 318 arquivos sob `src/`;
- 201 arquivos sob `tests/`, incluindo 198 arquivos `*.test.ts`;
- 53 arquivos sob `deployment/`;
- 93 arquivos sob `power-helper/`;
- 84 arquivos sob `docs/`, incluindo 25 ADRs, 46 documentos operacionais,
  2 contratos e 6 documentos de release;
- workflow de CI, lockfiles, manifests e evidências versionadas.

A auditoria combinou:

1. leitura dos documentos normativos;
2. rastreamento de imports, composição e registro HTTP;
3. revisão das fronteiras de domínio, aplicação, infraestrutura e delivery;
4. revisão de persistência, subprocessos, filesystem e deployment;
5. execução da validação Node;
6. testes diagnósticos em diretórios temporários;
7. comparação de declarações de release com testes, CI e contratos.

Os testes diagnósticos apenas usaram `/tmp` e fixtures controladas. Não foram
introduzidas correções.

## Classificação das fontes de verdade

| Fonte                       | Classificação                          | Observação                                                                                  |
| --------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------- |
| `docs/requirements.md`      | normativa, mas com contradição interna | contém 38 FR, 14 NFR e 12 SEC; a seção de escopo ainda lista CLI apesar do FR-037 deferi-la |
| `docs/adr/001` a `025`      | decisões aceitas                       | prevalecem sobre textos históricos quando tratam a mesma decisão                            |
| `docs/product-vision.md`    | visão Draft histórica                  | ainda promete CLI e backup lógico para a primeira versão estável                            |
| `docs/architecture.md`      | arquitetura normativa/evolutiva        | extensa e geralmente alinhada à estrutura implementada                                      |
| `docs/security-model.md`    | modelo de segurança normativo          | contém contratos mais fortes que parte da implementação atual                               |
| `docs/roadmap.md`           | planejamento e estado declarado        | declara RC qualificado, o que esta auditoria não confirmou                                  |
| `docs/contracts/`           | artefatos declarados como gerados      | o contrato administrativo versionado não é a serialização completa produzida pelo código    |
| `docs/release/`             | relatórios de entrega                  | são declarações, não evidência independente; alguns contêm resultados não executados        |
| `docs/operations/`          | runbooks                               | úteis para operação, sem substituir teste de integração                                     |
| `docs/agent-handoff.md`     | histórico de continuidade              | não foi tratado como fonte definitiva                                                       |
| código, composição e testes | estado executável                      | usados para confirmar ou refutar as declarações documentais                                 |

## Arquitetura atual

O código segue um monólito modular orientado a features:

- `domain`: modelos imutáveis e validadores;
- `application`: casos de uso, gates, planejamento e ports;
- `infrastructure`: filesystem, subprocessos, JWKS, mocks e stores;
- `http`: parsing, headers, admission e mapeamento de resposta;
- `composition` e `src/main.ts`: ligação entre as features e os entrypoints;
- `deployment/`: bundle, identidade, instalação, configuração e lifecycle em Go;
- `power-helper/`: helper privilegiado separado em Go.

Express permanece no delivery HTTP. Os adapters PM2/Docker/Compose usam
`execFile` com `shell: false`; o helper usa executable fixo. O perfil gerenciado
mantém backend de energia mock e efeitos reais desabilitados.

O principal problema arquitetural atual não é ausência de módulos, mas
reconciliação entre implementações duplicadas: catálogo versus handlers,
dashboard TypeScript versus strings embutidas versus assets Go, parser Go versus
parser TypeScript e contratos/evidências estáticos versus estado real.

## Diagramas dos fluxos encontrados

### Requisição administrativa

```text
listener 127.0.0.1
  -> envelope opcional em createApp (obrigatório pelo parser de produção)
  -> Host / Origin / Fetch Metadata
  -> handler app.all + validação do método
  -> admission compartilhada
  -> parser específico da rota
  -> autenticação/autorização
  -> gate específico
  -> capability
  -> resposta segura
```

O catálogo é validado antes do registro, mas não observa nem reconcilia a stack
Express real (`src/http/create-app.ts:87-142`).

### Autenticação e autorização

```text
CF-Access-Jwt-Assertion
  -> reader limitado
  -> header/payload JWT estritos
  -> JWKS HTTPS fixo e limitado
  -> RS256 + issuer + audience + tempo + subject UUID
  -> principal verificado
  -> assignments locais fixos
  -> operação -> uma permissão
  -> decisão
  -> evento de autorização
  -> capability protegida
```

Roles não são lidas dos claims. Não há sessão ou cookie do Atlas Manager.

### Controle de serviço

```text
serviceId HTTP
  -> catálogo registrado
  -> operation support
  -> gate global de mutação
  -> protected administration
  -> orquestração de dependências/readiness
  -> adapter mock | PM2 | Docker | Compose
  -> resultado imutável
  -> evento terminal
  -> reread pelo dashboard
```

Os executables e argumentos são controlados pelo projeto; o caller não fornece
comandos.

### Scheduler de disponibilidade

```text
policy + override
  -> cálculo de transições
  -> cursor persistente
  -> geração limitada de ocorrências
  -> claim persistente
  -> reconciliação por dependências
  -> controle de serviço
  -> avanço compare-and-set
  -> reconstrução
```

Os stores, loops e testes estão compostos em `src/main.ts:98-146` e
`src/main.ts:357-388`.

### Backup

```text
target registrado
  -> gate único
  -> started run
  -> mock | filesystem_tree
  -> candidate 0700
  -> streaming + SHA-256
  -> MANIFEST.json
  -> rename atômico
  -> terminal run
  -> retenção
  -> readiness de shutdown
```

O desenho está presente, mas a persistência de run e retenção possuem defeitos
confirmados descritos em `AUD-HIGH-002`, `AUD-HIGH-003` e `AUD-HIGH-004`.

### Histórico administrativo

```text
evento de domínio existente
  -> mutex local
  -> lock cross-process
  -> record v2 + previousRecordSha256
  -> active.jsonl
  -> transaction de rotação
  -> segmento + manifest + cadeia
  -> retention ledger
  -> export JSONL
  -> integrity verifier
```

A cadeia de records e a primeira retenção funcionam; o segundo anchor quebra a
verificação (`AUD-HIGH-005`).

### Configuração gerenciada

```text
input fixo no bundle
  -> parser Go estrito
  -> geração de environment
  -> journal
  -> candidate + rename
  -> state current/previous
  -> verify-installed
  -> replace-disabled | rollback-disabled
```

O parser TypeScript real não é invocado pelo executável Go e replacement não
executa verificação terminal completa (`AUD-HIGH-007`).

### Instalação e rollback

```text
bundle + MANIFEST + SHA256SUMS
  -> inspect-bundle
  -> install-disabled
  -> current symlink
  -> configure-disabled
  -> activate/deactivate
  -> upgrade-disabled
  -> rollback-disabled
  -> uninstall controlado
```

O tooling e os testes Go existem, mas Go não estava disponível para validação
local nesta auditoria.

### Power helper

```text
aplicação não privilegiada
  -> protocolo JSON de uma linha
  -> executable fixo
  -> startup/identidade/setuid checks
  -> allowlist de 5 operações
  -> lock
  -> RTC sysfs fixo | systemd-logind D-Bus fixo
  -> resposta limitada
```

O helper real não é chamado pelo RC. A fixture determinística de compatibilidade
passou; o código Go não foi recompilado localmente.

## Fluxos funcionais e conclusão

| Fluxo                       | Implementação                          | Integração                      | Testes                                       | Conclusão                                                              |
| --------------------------- | -------------------------------------- | ------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------- |
| Saúde do servidor           | completa                               | composta em `main`              | 4 arquivos                                   | implementado e validado em software                                    |
| Serviços registrados        | ampla                                  | HTTP e scheduler compostos      | 85 arquivos de service management            | implementado; sem evidência da matriz RC completa                      |
| Disponibilidade             | ampla                                  | cursor/claims/loop compostos    | 11 domain + integração em service management | implementado                                                           |
| Docker e Compose            | adapters sem shell                     | catálogo decide target          | testes de parse, execução e controle         | implementado em software; acesso físico ao socket pendente             |
| Power management            | planejamento, mock e helper boundary   | real effects gated              | 56 arquivos Node + 14 Go                     | mock qualificado; efeito real é gate físico                            |
| Backup                      | domínio, adapter, scheduler, retention | composto e no shutdown          | apenas 5 arquivos de teste dedicados         | implementado parcialmente; persistência/readiness/retention bloqueiam  |
| Event history               | v1/v2, lock, segment, export           | usado por administração         | 12 arquivos dedicados                        | implementado parcialmente; segundo prune e export/migração incompletos |
| Administração protegida     | auth, RBAC, admission, gates           | 41 descritores/rotas declarados | 13 arquivos HTTP                             | proteção base existe; catálogo/envelope não têm reconciliação/matriz   |
| Dashboard                   | shell e assets fechados                | strings HTTP são runtime real   | cobertura apenas superficial                 | parcialmente integrado; fontes e bundle divergem                       |
| Configuração administrativa | 7 actions Go                           | lifecycle disabled              | só parser input tem teste direto             | replacement/rollback não qualificados                                  |
| Deployment                  | amplo tooling Go                       | CI contém build/rehearsal       | 17 arquivos Go                               | não validado localmente; CI de release é insuficiente                  |
| Release RC                  | documentos e JSON estáticos            | CI checa existência             | sem rehearsal completo                       | qualificação não confirmada                                            |

## Divergências e módulos não integrados

1. `src/dashboard/main.ts` compila, mas não é importado nem servido. O runtime
   entrega strings em `src/http/administrative-dashboard-route.ts`; o bundle cria
   uma terceira versão em `deployment/internal/bundle/builder.go:359-391`.
2. `src/http/administrative-api-contract.ts` gera descriptors completos, mas
   `docs/contracts/atlas-manager-administrative-api.json` contém apenas IDs e um
   resumo.
3. `createApp` instala o envelope somente quando recebe
   `administrativePublicOrigin`; a composição de produção fornece o valor, mas
   testes e composições alternativas podem registrar `/admin` sem envelope.
4. `securityPostureReader` informa `reconciled: true` e feature counts
   hardcoded sem executar reconciliação (`src/http/create-administrative-runtime.ts:96-111`).
5. O parser Go de configuração duplica regras do parser TypeScript; não há bridge
   que execute o parser TypeScript durante install/replace/rollback.
6. A unit systemd e os stores discordam sobre os modos dos diretórios gerenciados.
7. Os relatórios de release declaram matrizes e rehearsals para os quais não
   existem testes ou geradores no repositório.

## Código morto ou sem uso confirmado

- `src/dashboard/main.ts`, `src/dashboard/index.html` e
  `src/dashboard/styles.css` não são usados pelo handler de produção.
- a primeira definição de `event-history.js` em
  `src/http/administrative-dashboard-route.ts:45-48` é sobrescrita por
  `SERVED_ASSETS` e nunca entregue;
- os assets de dashboard gerados pelo bundle são inventariados, porém o
  aplicativo servido usa assets embutidos no JavaScript compilado, não esses
  arquivos.

Não foram encontrados marcadores `TODO`, `FIXME`, `HACK` ou `XXX` no código
auditado.

## Qualidade arquitetural

### Pontos fortes

- strict TypeScript ativo e validação estática aprovada;
- modelos imutáveis e ports explícitos;
- adapters de subprocesso sem shell e com executables controlados;
- clocks, stores e mocks injetáveis em grande parte das features;
- bounded parsers e erros públicos próprios;
- claims/cursors persistentes para schedulers;
- helper privilegiado separado do processo Express;
- políticas mock-first e fail-closed para efeitos de energia.

### Riscos de manutenção

- `src/main.ts` concentra composição, políticas de ativação e lifecycle em mais
  de 400 linhas;
- contratos de segurança são duplicados entre catálogo e handlers;
- dashboard possui três representações;
- configuração administrativa possui parsers independentes em Go e TypeScript;
- relatórios determinísticos são estáticos, sem um release generator validado;
- há casts e non-null assertions concentrados nas rotas e power domain, embora o
  lint e typecheck passem.

## Testes e validação executada

| Comando                                  | Resultado                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------- |
| `node --version`                         | `v24.18.0`                                                                            |
| `npm --version`                          | `11.16.0`                                                                             |
| `npm ci`                                 | passou; 249 packages; audit geral indicou 1 vulnerabilidade alta de desenvolvimento   |
| `npm run format:check`                   | passou                                                                                |
| `npm run lint`                           | passou                                                                                |
| `npm run typecheck`                      | passou                                                                                |
| `npm test -- --maxWorkers=1`             | 198 files; 2.653 passed; 3 skipped                                                    |
| fixture Go controlada, teste direcionado | 12/12 passaram; os 3 skips foram exercitados                                          |
| `npm run build`                          | passou                                                                                |
| `npm audit --omit=dev`                   | 0 vulnerabilidades                                                                    |
| `npm audit --json`                       | 1 vulnerabilidade alta em `brace-expansion`, transitiva e fora do runtime de produção |
| Go deployment                            | não executado; `go`/`gofmt` indisponíveis                                             |
| Go power-helper                          | não executado; `go`/`gofmt` indisponíveis                                             |
| bundle duplo                             | não executado localmente; builder Go não foi recompilado nesta auditoria              |

O primeiro teste da fixture Go foi bloqueado pelo sandbox de subprocesso e
expirou. A mesma fixture controlada passou fora dessa restrição. Nenhum helper
real foi executado.

### Diagnósticos adicionais reproduzidos

- root `0750` de event history: `event_history_permissions_unsafe`;
- root `0750` de backup: `backup_run_history_parent_unsafe`;
- run de backup 102: `backup_sequence_conflict` após 101 sucessos;
- history corrupto: primeira reconstrução falha, segunda retorna zero runs;
- primeiro prune: `verified_with_retention`; segundo prune: `broken`;
- Host inválido `evil.example@atlas.example.com`: aceito pelo matcher atual.

## Documentação e release

As principais inconsistências são:

- `docs/product-vision.md:112-124` ainda inclui CLI e logical backups no sucesso
  da primeira versão;
- `docs/requirements.md:347-354` defere a CLI, mas
  `docs/requirements.md:541-560` volta a listá-la;
- o traceability report declara ranges inexistentes (`FR-001–FR-064`,
  `NFR-001–NFR-020`, `SEC-001–SEC-020`) em
  `docs/release/atlas-manager-v1-requirements-traceability.md:11-22`;
- o release contract aponta para o baseline anterior e contém strings
  `ci-generated-*` em campos SHA
  (`docs/contracts/atlas-manager-release-contract.json:4-16`);
- a evidência declara `qualified` apesar de Go e production audit estarem
  indisponíveis/não executados
  (`atlas-manager-v1-software-release-candidate-evidence.json:3-32`);
- o CI em `.github/workflows/ci.yml:230-237` verifica apenas versão, comprimento
  do catálogo e existência de documentos no gate final.

## Prontidão para qualificação física

### Gates físicos corretamente pendentes

- deployment no Lenovo ThinkCentre;
- Cloudflare Tunnel/Access real;
- identidade e grupos reais;
- helper instalado e hash/ownership;
- RTC e wake alarm reais;
- systemd-logind shutdown;
- rollback de efeitos reais.

### Remediações de software obrigatórias antes do drill

1. reconciliar modos systemd/stores e testar a unit real em sandbox;
2. corrigir persistência/readiness/sequência/retenção de backup;
3. corrigir retention ledger de event history e suas falhas múltiplas;
4. implementar reconciliação real do catálogo com Express e handlers;
5. tornar replace/rollback transacional e validado pelo parser TypeScript real;
6. regenerar contratos/evidências a partir do commit candidato, sem placeholders;
7. executar e registrar Go, bundle duplo e rehearsal duplo em ambiente reproduzível.

## Limitações da auditoria

- não houve ambiente Go local;
- nenhum bundle foi reconstruído com tooling Go recompilado do commit auditado;
- nenhum CI remoto foi tratado como substituto de validação local;
- Cloudflare, systemd, Docker, PM2, RTC e D-Bus reais não foram contatados;
- não houve teste de browser real; a análise do dashboard foi estática e por
  testes HTTP existentes;
- a revisão de licenças confirmou a inconsistência do inventário, mas não
  produziu um novo inventário, conforme a proibição de alterar contratos;
- não foi feita qualificação física, por design.

Os achados completos estão em [SECURITY_REVIEW.md](SECURITY_REVIEW.md), a matriz
de requisitos em [REQUIREMENTS_TRACEABILITY.md](REQUIREMENTS_TRACEABILITY.md) e
a ordem de correção em [REMEDIATION_PLAN.md](REMEDIATION_PLAN.md).
