# Rastreabilidade de requisitos — Atlas Manager 1.0.0-rc.1

## Método e legenda

Esta matriz confronta o requisito normativo com código, composição, entrega,
testes e documentação operacional. A presença de um tipo ou teste isolado não
foi considerada integração. As linhas são do commit
`162191dae6415cc33aab4e30a2cb60be7845cb5f`.

Status usados:

- **Implementado e validado**: código composto e testes locais relevantes
  passaram;
- **Implementado parcialmente**: parte material existe, mas há uma lacuna
  integrada ou defeito confirmado;
- **Gate físico pendente**: software existe, mas a aceitação requer o Atlas real;
- **Escopo deferido explicitamente**: retirada aceita do release candidate;
- **Não aplicável**: a arquitetura atual não possui a superfície;
- **Não foi possível confirmar**: depende de ferramenta ou ambiente indisponível.

Os IDs `AUD-*` remetem ao [SECURITY_REVIEW.md](SECURITY_REVIEW.md).

## Requisitos funcionais

<!-- prettier-ignore -->
| ID | Requisito e origem | Implementação e composição | Status | Evidência e testes | Documentação / divergência / ação |
| --- | --- | --- | --- | --- | --- |
| FR-001 | Estado geral do servidor (`docs/requirements.md:36`) | `src/server-health/`, composition root e rotas de health | Implementado e validado | `src/http/health-route.ts`; testes server-health e HTTP no conjunto de 198 arquivos aprovado | Runbooks de health; manter |
| FR-002 | CPU, memória, disco, uptime e sensores (`:42`) | Collector Linux e mapper seguro de health | Implementado e validado | `src/server-health/infrastructure/`; testes de collector/response | Sensores indisponíveis degradam com estado explícito |
| FR-003 | Estado dos serviços registrados (`:49`) | Catálogo, leitores e API administrativa | Implementado e validado | `src/service-management/`; `src/http/administrative-services-route.ts`; testes service-management/HTTP | Alvos vêm do catálogo |
| FR-004 | Dependências externas selecionadas, Should (`:55`) | Não foi encontrada capability composta para internet, DNS ou disponibilidade pública | Não implementado | Busca por composição e testes não encontrou fluxo ponta a ponta | Planejar somente com endpoints allowlisted e sem SSRF (`AUD-INFO-001`) |
| FR-005 | Catálogo de serviços (`:64`) | Catálogo imutável validado no parser de configuração | Implementado e validado | `src/service-management/domain/`; testes de catálogo/composição | Manter catálogo como única origem de targets |
| FR-006 | Status por serviço (`:71`) | Capability e adapters isolados | Implementado e validado | `src/service-management/`; testes mock, PM2, Docker e Compose | Resposta pública é mapeada |
| FR-007 | Start/stop/restart autorizado (`:77`) | Protected administration, gate e orchestration | Implementado e validado | `src/http/administrative-services-route.ts`; testes de confirmação, autorização e ordem | Não chama adapters no HTTP |
| FR-008 | Drivers mock e PM2, Docker/systemd incrementais (`:84`) | Mock, PM2, Docker e Compose implementados; systemd não é target genérico | Implementado e validado | `src/service-management/infrastructure/`; testes de subprocessos | Sem shell e com executáveis fixos |
| FR-009 | Targets de serviço restritos (`:97`) | IDs resolvidos apenas no catálogo | Implementado e validado | Catálogo e rotas de serviço; testes de ID desconhecido | Nenhum recurso externo é aceito via HTTP |
| FR-010 | Modos always/scheduled/manual/disabled (`:106`) | Modelo de disponibilidade | Implementado e validado | `src/service-scheduling/`; testes de políticas | Vocabulário canônico |
| FR-011 | Janelas semanais (`:118`) | Parser e domínio semanal | Implementado e validado | Testes de sobreposição, adjacência e limites | Manter um único parser |
| FR-012 | Timezone explícito (`:125`) | Timezone validado; perfil usa America/Sao_Paulo | Implementado e validado | Config/parser e testes scheduling | Sem relógio escolhido pelo caller |
| FR-013 | Overrides temporários (`:133`) | Políticas e API de disponibilidade | Implementado e validado | `src/http/administrative-service-availability-route.ts`; testes | Reread autoritativo |
| FR-014 | Prevenção de execução duplicada (`:146`) | Claims/cursor persistentes no scheduler de serviços | Implementado e validado | `src/service-scheduling/`; testes de reconstruction/conflict | Sem retry ilimitado |
| FR-015 | Resposta/página de indisponibilidade, Should (`:153`) | Não foi encontrada entrega HTTP pública de maintenance response | Não implementado | Ausência confirmada em composição/rotas | Backlog explícito (`AUD-INFO-002`) |
| FR-016 | Status Docker/Compose allowlisted (`:162`) | Adapters Docker e Compose | Implementado e validado | `src/service-management/infrastructure/`; testes de parse e limites | Docker real não foi acessado |
| FR-017 | Controle Docker/Compose autorizado (`:172`) | Capability compartilhada de serviço | Implementado e validado | Testes de supported operations e subprocess arguments | Shell desabilitado |
| FR-018 | Schedule para recursos Docker (`:179`) | Schedule se aplica ao serviço registrado, independentemente do adapter | Implementado e validado | Testes scheduling + orchestration | Boa reutilização do modelo |
| FR-019 | Health, uptime, image e recursos Docker (`:185`) | Mapper disponibiliza metadados allowlisted quando adapter suporta | Implementado e validado | Testes de Docker status | Não expõe socket/path |
| FR-020 | Logs Docker limitados, Could (`:192`) | Não há rota de log genérica | Escopo deferido explicitamente | Nenhuma entrega declarada | Não é blocker |
| FR-021 | Dependências e ordem (`:198`) | Grafo validado e orchestration dependency-aware | Implementado e validado | Testes de ciclos, ordem, readiness e partial result | Contrato preservado |
| FR-022 | RTC real quando suportado (`:222`) | Protocolo/helper existe, mas RTC real não foi qualificado | Gate físico pendente | `power-helper/`; testes Go não executados localmente | Exige drill físico; não executar no RC |
| FR-023 | Operações de energia mock (`:229`) | Backend mock e gates de efeito | Implementado e validado | `src/power-management/`; testes Node | Perfil gerenciado mantém efeitos desabilitados |
| FR-024 | Agendar wake alarm (`:236`) | Planner e helper boundary existem; efeito real não qualificado | Gate físico pendente | Testes mock/protocolo; helper não executado | Certificação RTC separada |
| FR-025 | Shutdown coordenado (`:242`) | Readiness e preparação existem | Implementado parcialmente | `src/power-management/`; backup readiness usa store afetado por `AUD-HIGH-002` | Corrigir fail-open antes do drill |
| FR-026 | Schedule da máquina (`:255`) | Planejamento e scheduler existem, lifecycle desabilitado no perfil | Implementado e validado | Testes de machine scheduler | Efeitos reais continuam off |
| FR-027 | Schedules de serviço/máquina independentes (`:261`) | Domínios e composições distintos | Implementado e validado | Testes de interação/readiness | Sem scheduler automático de energia no perfil |
| FR-028 | Sources de backup aprovados (`:271`) | Catálogo mock/filesystem_tree | Implementado parcialmente | `src/backup-management/domain/`; testes; defeitos integrados `AUD-HIGH-001/003` | Modelo correto, operação gerenciada não confiável |
| FR-029 | Backup manual autorizado (`:277`) | API protegida e coordinator | Implementado parcialmente | Testes HTTP/application passam; 102ª run corrompe sequência (`AUD-HIGH-003`) | Bloquear release até correção |
| FR-030 | Backup agendado (`:283`) | Claims, cursor e tick | Implementado parcialmente | Testes scheduler passam; store/sequence afetam durabilidade | Revalidar alto volume e restart |
| FR-031 | Metadados de backup (`:289`) | Started/terminal JSONL e manifest SHA-256 | Implementado parcialmente | File store e filesystem adapter; reconstrução pode falhar aberta (`AUD-HIGH-002`) | Corrigir estado de load |
| FR-032 | Retenção configurável, Should (`:302`) | Capability e política count/age | Implementado parcialmente | `apply-registered-backup-retention.ts:61-85`; limite 100 e OR viola mínimo (`AUD-HIGH-004`) | Corrigir seleção e testar >100 |
| FR-033 | Histórico operacional (`:310`) | Event model, store v2, segmentos, retenção e export | Implementado parcialmente | Testes passam, mas segundo prune quebra ledger (`AUD-HIGH-005`) e export/migração têm lacunas (`AUD-MED-002/003`) | Não qualificar até integridade corrigida |
| FR-034 | Resultado e duração de tarefas (`:326`) | Eventos e resultados registram timestamps/resultados em vários schedulers | Implementado parcialmente | Testes por feature; não há contrato unificado que prove duração de toda task | Completar rastreabilidade por tarefa |
| FR-035 | API administrativa (`:334`) | Rotas protegidas e catálogo | Implementado parcialmente | Testes HTTP passam; catálogo não reconcilia runtime (`AUD-HIGH-006`) e Host é permissivo (`AUD-MED-001`) | Implementar reconciliação real |
| FR-036 | Dashboard, Should (`:340`) | Shell/assets protegidos e views básicas | Implementado parcialmente | `administrative-dashboard-route.ts`; assets divergentes e controles incompletos (`AUD-MED-004`) | Teste browser e uma única fonte de assets |
| FR-037 | CLI geral, Should (`:347`) | Explicitamente deferida; somente entrypoints estreitos | Escopo deferido explicitamente | ADR-025 e requirements | Sem contradição normativa atual, embora product vision histórico diverja |
| FR-038 | Endpoint de health (`:356`) | `/health/live` e server health | Implementado e validado | Rotas/testes HTTP | Fora do catálogo `/admin` por desenho |

## Requisitos não funcionais

<!-- prettier-ignore -->
| ID | Requisito e origem | Implementação e composição | Status | Evidência e testes | Documentação / divergência / ação |
| --- | --- | --- | --- | --- | --- |
| NFR-001 | Linux no ThinkCentre (`docs/requirements.md:365`) | Bundle Linux amd64 e systemd existem; hardware não foi usado | Gate físico pendente | Deployment code; Go não disponível localmente | Drill físico separado |
| NFR-002 | TypeScript strict (`:372`) | `strict` e interfaces tipadas | Implementado e validado | `tsconfig.json`; typecheck passou | Casts foram revisados por risco, não por presença |
| NFR-003 | Modular monolith feature-first (`:379`) | Features com domain/application/infrastructure e composition | Implementado e validado | `src/*`; architecture docs | Composition roots cresceram, mas boundary geral existe |
| NFR-004 | Integrações testáveis (`:385`) | Ports/adapters e fixtures | Implementado e validado | 198 test files; helper fixture 12/12 | Go local ainda não confirmado |
| NFR-005 | Mocks antes de drivers perigosos (`:392`) | Power e backup mock; adapters testáveis | Implementado e validado | Testes mock e perfil gerenciado | Perfil real permanece desabilitado |
| NFR-006 | Falha scheduled não derruba app (`:399`) | Ticks retornam bounded failures e lifecycles supervisionados | Implementado e validado | Testes scheduler | Sem retry ilimitado identificado |
| NFR-007 | Idempotência/claims (`:405`) | Claims persistentes em service/power/backup | Implementado parcialmente | Testes de duplicate occurrence; backup store/sequence reduz garantia (`AUD-HIGH-003`) | Revalidar após correção |
| NFR-008 | Logs estruturados (`:412`) | Pino e eventos estruturados | Implementado parcialmente | `src/logging/`; correlation ID só chega à resposta (`AUD-LOW-001`) | Propagar para logs críticos |
| NFR-009 | Documentação (`:419`) | Extensa documentação, ADRs e runbooks | Implementado parcialmente | `docs/`; release evidence e product vision divergem (`AUD-HIGH-008`, `AUD-LOW-003`) | Reconciliar fontes |
| NFR-010 | Lint/test/build (`:425`) | Scripts e CI | Implementado e validado | format, lint, typecheck, test e build passaram | Release gate específico é insuficiente |
| NFR-011 | Rollback de deployment (`:431`) | Tooling Go implementa rollback | Não foi possível confirmar | `deployment/`; Go indisponível; CI declara testes | Executar Go e rehearsal recompilado |
| NFR-012 | Bind local (`:438`) | Parser e profile fixam 127.0.0.1 | Implementado e validado | Config tests/composition | trust proxy false |
| NFR-013 | Entregas incrementais (`:445`) | ADRs/issues/módulos versionados | Implementado e validado | histórico e docs de releases | RC atual ainda não satisfaz gate de qualificação |
| NFR-014 | Degradação controlada, Should (`:451`) | Erros bounded e reads independentes em várias features | Implementado parcialmente | Testes degraded overview; event/backup fail-closed correto em intenção, mas backup reconstrói vazio após falha (`AUD-HIGH-002`) | Corrigir sem criar fallback inseguro |

## Requisitos de segurança

<!-- prettier-ignore -->
| ID | Requisito e origem | Implementação e composição | Status | Evidência e testes | Documentação / divergência / ação |
| --- | --- | --- | --- | --- | --- |
| SEC-001 | Express sem root (`docs/requirements.md:460`) | Unit usa `User=atlas-manager` | Implementado e validado | `deployment/internal/systemdunit/unit.go`; teste textual | Identidade física ainda precisa de verificação |
| SEC-002 | Menor privilégio (`:466`) | Hardening systemd e adapters limitados | Implementado parcialmente | Unit tem ProtectSystem; `StateDirectoryMode=0750` conflita com stores (`AUD-HIGH-001`) | Corrigir modos; helper/grupo são gate físico |
| SEC-003 | Sem comandos arbitrários (`:473`) | `execFile`/spawn com shell false, executáveis e args controlados | Implementado e validado | Revisão de subprocess adapters e testes | Nenhum endpoint de comando genérico |
| SEC-004 | Allowlists (`:480`) | Catálogos de serviços/backup e helper protocol fixo | Implementado e validado | Testes unknown IDs/actions | Nenhum path de backup por HTTP |
| SEC-005 | Validar toda entrada (`:487`) | Parsers estritos e body limits | Implementado parcialmente | Cobertura ampla; Host aceita sintaxe extra e migration receipt usa parse permissivo (`AUD-MED-001/003`) | Fechar entradas discrepantes |
| SEC-006 | Segredos fora de Git/log (`:494`) | Config fixa e suppression de assertions/confirmations | Implementado e validado | Varreduras por padrões não encontraram segredo real | Manter scan CI |
| SEC-007 | Docker socket restrito (`:500`) | Express usa subprocess adapter allowlisted, não socket irrestrito | Gate físico pendente | Código não abre socket diretamente | Permissões reais do host só no drill |
| SEC-008 | Credenciais DB restritas (`:507`) | Aplicação não executa queries DB; DBs são serviços Docker | Não aplicável | Nenhuma camada SQL/NoSQL da aplicação | Se health DB for adicionado, criar credenciais read-only |
| SEC-009 | AuthN/AuthZ administrativa (`:514`) | Cloudflare JWT + roles/permissions project-owned | Implementado parcialmente | Testes auth passam; catálogo/runtime e browser matrix incompletos (`AUD-HIGH-006`) | Corrigir antes de exposição |
| SEC-010 | Audit trail (`:521`) | Authorization/start/terminal events | Implementado parcialmente | Event store falha com unit gerenciada e retention chain quebra (`AUD-HIGH-001/005`) | Bloqueador de segurança/reliability |
| SEC-011 | Confirmação destrutiva (`:527`) | Confirmações exatas e body parsers estritos | Implementado e validado | Testes de confirmações; catálogo declara policies | Catálogo deve reconciliar parser real |
| SEC-012 | Ingress protegido (`:534`) | Loopback, public origin, Access e no CORS | Gate físico pendente | Software parcialmente validado; Host permissivo (`AUD-MED-001`) | Tunnel/Access reais são drill separado |

## ADRs aceitos

<!-- prettier-ignore -->
| ADR | Decisão principal | Implementação encontrada | Status / ação |
| --- | --- | --- | --- |
| ADR-001 a ADR-006 | Monólito modular, config, health e adapters iniciais | Estrutura e compositions coerentes | Implementado e validado |
| ADR-007 a ADR-012 | Serviços, Docker/Compose, schedule e dependencies | Features compostas, allowlists e testes | Implementado e validado |
| ADR-013 a ADR-018 | Power planning, helper boundary e auditoria | Mock-first e helper separado | Software implementado; efeitos reais são gate físico |
| ADR-019 a ADR-021 | Deployment e mock activation | Tooling Go e bundle existem | Não foi possível confirmar localmente sem Go |
| ADR-022 | Control plane/dashboard mock-only | APIs e dashboard protegidos | Implementado parcialmente (`AUD-HIGH-006`, `AUD-MED-004`) |
| ADR-023 | Backup registrado/local | Domínio, store, scheduler, retention | Implementado parcialmente (`AUD-HIGH-001` a `004`) |
| ADR-024 | Event history v2 | Segmentos, lock, retention, export, maintenance | Implementado parcialmente (`AUD-HIGH-005`, `AUD-MED-002/003`) |
| ADR-025 | Security envelope e RC | Origin, catálogo, status, release docs | Implementado de forma diferente do planejado (`AUD-HIGH-006/008`) |

## Contratos, bundle e qualificação de release

<!-- prettier-ignore -->
| Item | Declaração | Status | Evidência / ação |
| --- | --- | --- | --- |
| Catálogo de rotas | Todo `/admin` reconciliado ao runtime | Implementado parcialmente | Validação só interna em `administrative-route-security-catalog.ts:505-533`; runtime em `create-app.ts:87-142` (`AUD-HIGH-006`) |
| Contrato administrativo | Gerado canonicamente do catálogo | Implementado de forma diferente do planejado | Arquivo estático reduzido diverge do serializer `administrative-api-contract.ts:7-34` |
| Bundle fechado | MANIFEST/SHA256 e reprodutibilidade | Não foi possível confirmar | Tooling Go existe; bundle duplo não foi reconstruído |
| Contrato de release | Digests canônicos do candidato | Não implementado de forma confiável | Placeholders e baseline antigo em `docs/contracts/atlas-manager-release-contract.json:4-16` |
| Evidência de RC | Resultado `qualified` reproduzível | Não implementado de forma confiável | Evidence declara sucesso com checks indisponíveis; CI não gera rehearsal (`AUD-HIGH-008`) |
| Dependências/licenças | Inventário completo de produção | Implementado parcialmente | Documento tem quatro diretas; npm reporta 84 packages de produção (`AUD-MED-006`) |
| Traceability oficial | Todo Must individualmente mapeado | Implementado de forma diferente do planejado | Documento oficial usa intervalos inexistentes e não mapeia requisito por requisito (`AUD-HIGH-008`) |

## Limites aceitos e gates físicos

<!-- prettier-ignore -->
| Item | Classificação | Justificativa |
| --- | --- | --- |
| Login/senha/sessão local | Não aplicável | Modelo normativo é assertion stateless do Cloudflare Access |
| CLI administrativa genérica | Escopo deferido explicitamente | ADR-025 e FR-037 |
| Restore, backup remoto e lógico | Escopo deferido explicitamente | ADR-023 e roadmap |
| SIEM, signing e trusted timestamp | Escopo deferido explicitamente | ADR-024 não reivindica autenticidade externa |
| Atlas físico, Tunnel/Access real | Gate físico pendente | O RC é software-only |
| Instalação do helper, RTC/wake/shutdown reais | Gate físico pendente | Exige aprovação separada e não foi executado |
| SQL/NoSQL injection | Não aplicável | Não há camada de consulta a banco da aplicação |

## Conclusão de rastreabilidade

Os requisitos centrais têm implementação ampla, mas os Must relacionados a
backup durável, auditoria, API protegida e qualificação reproduzível não estão
todos em estado “Implementado e validado”. A matriz, portanto, não sustenta o
resultado `qualified` registrado nos artefatos atuais. As correções de
`AUD-HIGH-001` a `AUD-HIGH-008`, seguidas de Go, bundle duplo e rehearsal duplo,
são pré-condições para avançar à qualificação física.
