# Revisão de segurança — Atlas Manager 1.0.0-rc.1

## Resumo

O projeto tem fundamentos de segurança melhores que a média para seu estágio:
binding loopback, autenticação stateless por Cloudflare Access, autorização
project-owned, catálogos allowlisted, parsing estrito, ausência de shell,
confirmações específicas, gates fail-fast, auditoria antes do efeito, CSP e
perfil mock-only.

Ainda assim, o release candidate não deve avançar ao drill físico. Oito achados
de severidade alta comprometem disponibilidade administrativa, persistência,
integridade ou a validade da própria qualificação. Não foi identificada uma
vulnerabilidade crítica com exploração remota direta sem autenticação, e nenhum
segredo real foi encontrado.

## Modelo de confiança e superfície de ataque

```text
browser/cliente
  → ingress aprovado (ainda gate físico)
  → listener 127.0.0.1
  → Host/Origin/Fetch Metadata
  → admission
  → assertion Cloudflare Access
  → issuer/audience/RS256/tempo/subject
  → assignment local de roles
  → permission fixa
  → audit
  → gate/confirmação
  → capability allowlisted
```

Fronteiras privilegiadas:

- subprocessos PM2, Docker e Compose com executável fixo e `shell: false`;
- helper Linux setuid separado, com protocolo fechado;
- filesystem de backup e event history;
- tooling Go de deployment;
- JWKS HTTPS do tenant configurado;
- ingress Cloudflare, que não foi contatado nesta auditoria.

Forwarded headers não entram em autenticação/autorização e `trust proxy` continua
false. O aplicativo não cria sessão, cookie de autenticação ou role a partir do
JWT.

## Achados

### AUD-HIGH-001 — Modos da unit tornam backup e auditoria gerenciados inutilizáveis

- **Severidade:** Alta
- **Confiança:** Confirmado
- **Categoria:** Deployment / filesystem / disponibilidade
- **Componente:** systemd, backup persistence e event-history persistence
- **Arquivo e linha:** `deployment/internal/systemdunit/unit.go:24-25`;
  `src/event-history/infrastructure/file-segmented-administrative-event-history.ts:994-1001`;
  `src/event-history/infrastructure/file-segmented-administrative-event-history.ts:1063-1078`;
  `src/backup-management/infrastructure/file-backup-run-store.ts:89-96`
- **Descrição:** `StateDirectoryMode=0750` é aplicado aos roots
  `atlas-manager`, `atlas-manager-backups` e `atlas-manager-event-history`.
  Ambos os stores TypeScript rejeitam bits de grupo e exigem diretório privado
  equivalente a `0700`.
- **Evidência:** uma reprodução controlada em `/tmp` criou cada root com `0750`.
  O event store retornou `event_history_permissions_unsafe`; o backup store
  retornou `backup_run_history_parent_unsafe`.
- **Impacto:** o primeiro append de autorização falha e bloqueia toda mutação
  administrativa auditada; a persistência de backup também falha no perfil
  gerenciado.
- **Cenário de falha/abuso:** serviço ativa com health aparente, mas o operador
  não consegue executar operações protegidas. A inconsistência também incentiva
  afrouxamento manual inseguro de permissões.
- **Mitigação existente:** stores falham fechados e não adotam metadados
  inseguros.
- **Recomendação:** definir modos por diretório compatíveis com os parsers ou
  ajustar o contrato de segurança de forma única e documentada. Não usar um
  modo global incompatível.
- **Critério de aceite:** instalação systemd realista em sandbox produz roots
  aceitos; primeiro evento protegido e primeiro backup persistem; verificação da
  unit confirma modos exatos.
- **Testes da correção:** teste de integração unit→filesystem→parser, activation
  rehearsal e teste negativo para `0750` quando o contrato final for `0700`.
- **Esforço:** Médio
- **Momento:** Corrigir imediatamente

### AUD-HIGH-002 — Corrupção de run history falha aberta após a primeira leitura

- **Severidade:** Alta
- **Confiança:** Confirmado
- **Categoria:** Integridade / shutdown safety
- **Componente:** `FileBackupRunStore`
- **Arquivo e linha:** `src/backup-management/infrastructure/file-backup-run-store.ts:51-68`;
  `src/backup-management/composition/create-backup-management.ts:174-188`
- **Descrição:** `#loaded` é definido como `true` antes de o arquivo ser lido e
  reconstruído. Se a leitura/parsing falha, a próxima chamada retorna o store em
  memória vazio.
- **Evidência:** com JSONL inválido, a primeira chamada retornou
  `invalid_json`; a segunda retornou sucesso com zero runs.
- **Impacto:** estado corrompido pode ser reinterpretado como vazio. O reader de
  readiness de shutdown pode mudar de `unavailable` para `ready`.
- **Cenário de falha/abuso:** uma corrupção persistente é observada uma vez,
  depois uma preparação de shutdown deixa de ver runs interrompidas e aceita
  continuar.
- **Mitigação existente:** a primeira leitura falha e erros são bounded.
- **Recomendação:** marcar loaded somente após reconstrução integral bem-sucedida
  ou persistir estado terminal `failed` que continue falhando fechado.
- **Critério de aceite:** chamadas repetidas sobre o mesmo arquivo corrompido
  retornam `unavailable` sem fallback em memória.
- **Testes da correção:** duas ou mais leituras, concorrência de leitura e
  integração shutdown-readiness.
- **Esforço:** Pequeno
- **Momento:** Corrigir imediatamente

### AUD-HIGH-003 — Sequência de backup conflita depois de 101 runs e pode persistir transição inválida

- **Severidade:** Alta
- **Confiança:** Confirmado
- **Categoria:** Persistência / integridade
- **Componente:** backup coordinator e run stores
- **Arquivo e linha:** `src/backup-management/application/run-registered-backup.ts:66-70`;
  `src/backup-management/infrastructure/in-memory-backup-run-store.ts:44-78`;
  `src/backup-management/infrastructure/file-backup-run-store.ts:24-29`
- **Descrição:** a próxima sequência é calculada consultando somente as primeiras
  100 runs em ordem ascendente. Na 102ª execução, a sequência 101 é reutilizada.
  O file store grava no disco antes de validar a transição no store em memória.
- **Evidência:** reprodução in-memory: 101 runs completaram; a 102ª retornou
  `backup_sequence_conflict` com sequence 101.
- **Impacto:** o sistema deixa de operar após carga legítima e a implementação
  em arquivo pode acrescentar um registro inválido antes de detectar o conflito.
- **Cenário de falha/abuso:** uso normal, scheduler ou rehearsal com mais de 101
  runs corrompe a continuidade do journal.
- **Mitigação existente:** a reconstrução posterior detecta sequências inválidas.
- **Recomendação:** o store deve alocar/retornar a próxima sequência
  autoritativamente; validar transição antes do append durável.
- **Critério de aceite:** mais de 1.000 runs mantêm sequência contígua, inclusive
  após restart, sem escrita em caso de conflito.
- **Testes da correção:** boundary 99/100/101/102, restart, failure injection
  antes/depois de append.
- **Esforço:** Médio
- **Momento:** Corrigir imediatamente

### AUD-HIGH-004 — Retenção de backup viola o mínimo recente e ignora runs além de 100

- **Severidade:** Alta
- **Confiança:** Confirmado
- **Categoria:** Retenção / perda de dados
- **Componente:** backup retention
- **Arquivo e linha:** `src/backup-management/application/apply-registered-backup-retention.ts:61-68`;
  `src/backup-management/application/apply-registered-backup-retention.ts:79-88`
- **Descrição:** a seleção consulta no máximo 100 sucessos. Além disso, usa
  `index >= keepLastSuccessful || tooOld`; portanto um artifact dentro do
  conjunto `keepLastSuccessful` pode ser removido por idade.
- **Evidência:** a expressão contradiz o contrato de preservar ao menos a
  contagem configurada e a query bounded não pagina o universo gerenciado.
- **Impacto:** artifacts que o operador configurou para preservar podem ser
  apagados; artifacts antigos fora das primeiras 100 runs nunca são avaliados.
- **Cenário de falha/abuso:** política combinada count+age remove todos os
  backups antigos, inclusive o mínimo exigido.
- **Mitigação existente:** unknown/modified artifacts bloqueiam e não existe
  restore automático.
- **Recomendação:** calcular conjunto completo por paginação bounded/streaming e
  aplicar idade somente depois de reservar a contagem mínima mais recente.
- **Critério de aceite:** nenhuma política remove o mínimo; catálogos acima de
  100 são processados determinística e completamente.
- **Testes da correção:** count, age, combinado, >100, partial delete e unknown
  artifact.
- **Esforço:** Médio
- **Momento:** Corrigir imediatamente

### AUD-HIGH-005 — Segundo prune quebra a retention ledger do event history

- **Severidade:** Alta
- **Confiança:** Confirmado
- **Categoria:** Integridade de auditoria
- **Componente:** segmented event-history retention
- **Arquivo e linha:** `src/event-history/infrastructure/file-segmented-administrative-event-history.ts:538-570`;
  `src/event-history/infrastructure/file-segmented-administrative-event-history.ts:829-858`
- **Descrição:** ao escrever novo anchor, `previousRetentionRecordSha256` recebe
  SHA-256 dos bytes da ledger inteira. O verificador espera o
  `retentionRecordSha256` do record anterior.
- **Evidência:** reprodução controlada: primeiro prune resultou
  `verified_with_retention`; o segundo resultou `broken`.
- **Impacto:** retenção legítima torna o store indisponível, bloqueando reads,
  novos audits, export e operações administrativas.
- **Cenário de falha/abuso:** a segunda execução operacional normal de prune
  causa outage fail-closed da administração.
- **Mitigação existente:** verifier detecta o rompimento e não repara
  automaticamente.
- **Recomendação:** encadear pelo hash canônico do último record e validar a
  ledger antes de qualquer efeito.
- **Critério de aceite:** múltiplos prunes preservam chain e
  `verified_with_retention`; modificação de qualquer anchor continua detectada.
- **Testes da correção:** três ou mais prunes, reconstruction e attack matrix.
- **Esforço:** Pequeno
- **Momento:** Corrigir imediatamente

### AUD-HIGH-006 — Catálogo administrativo não é reconciliado com o runtime

- **Severidade:** Alta
- **Confiança:** Confirmado
- **Categoria:** Controle de acesso / garantia de release
- **Componente:** HTTP composition e route-security catalog
- **Arquivo e linha:** `src/http/create-app.ts:87-142`;
  `src/http/administrative-route-security-catalog.ts:58-74`;
  `src/http/administrative-route-security-catalog.ts:505-533`;
  `tests/http/administrative-route-security-catalog.test.ts:8-36`
- **Descrição:** startup chama apenas a validação interna do catálogo e depois
  registra handlers. Não compara a stack Express, método/path, flags,
  permission mapping efetivo, parser, gate ou headers. Os descriptors usam um
  body max genérico de 8192, enquanto handlers reais usam 512, 1024, 4096 e 8192. Rotas são registradas com `app.all` e validam método internamente.
- **Evidência:** o validator checa duplicidade e invariantes locais; o teste
  verifica tamanho/unicidade/campos não vazios. Não há reconciliation com
  Express. O security status retorna `reconciled: true` hardcoded em
  `src/http/create-administrative-runtime.ts:96-111`.
- **Impacto:** uma rota pode ser adicionada, removida ou protegida de modo
  diferente sem quebrar startup/CI; o contrato não prova a superfície real.
- **Cenário de falha/abuso:** refactor registra rota administrativa fora do
  catálogo ou com parser/gate divergente e o release gate continua verde.
- **Mitigação existente:** handlers atuais aplicam autenticação e autorização;
  não foi encontrada rota `/admin` deliberadamente pública.
- **Recomendação:** registrar rotas por descriptors ou capturar uma inventory
  tipada única usada para catálogo e Express; reconciliar policies reais.
- **Critério de aceite:** missing/extra/method/path/flag/parser/gate/op/permission
  mismatch impede listening; contrato é derivado da mesma inventory.
- **Testes da correção:** mutations artificiais em cada campo e route matrix
  completa.
- **Esforço:** Grande
- **Momento:** Corrigir imediatamente

### AUD-HIGH-007 — Replace/rollback administrativo não cumpre atomicidade nem validação TypeScript real

- **Severidade:** Alta
- **Confiança:** Confirmado
- **Categoria:** Configuração / recuperação de acesso
- **Componente:** deployment administrative configuration
- **Arquivo e linha:** `deployment/internal/administrativeconfiguration/configuration.go:287-327`;
  `deployment/internal/administrativeconfiguration/configuration.go:563-567`;
  `deployment/internal/administrativeconfiguration/input.go:94-182`;
  `deployment/internal/administrativeconfiguration/input.go:367-430`
- **Descrição:** replacement escreve previous, current e state em passos
  separados sem rollback transacional e sem `verifyInstalled` terminal. O
  `inputBytes` não participa da evidência; existe atribuição no-op de
  `PreviousSourceInputSHA256`. Rollback não usa o parser TypeScript real. O
  parser Go duplica regras.
- **Evidência:** não foi encontrado bridge/subprocess para o parser TypeScript;
  os únicos testes localizados para esse package cobrem dois cenários de input,
  não replace/rollback/failure windows.
- **Impacto:** falha intermediária pode deixar geração e metadata divergentes,
  causando lockout ou rollback não confiável.
- **Cenário de falha/abuso:** crash após substituir environment e antes de state
  expõe configuração nova sem geração coerente; rollback não prova que o app a
  aceitaria.
- **Mitigação existente:** lock, journal e serviço disabled/inactive são
  requeridos; estado desconhecido tende a falhar fechado.
- **Recomendação:** candidate generation fechada, validação pelo parser de
  produção, publicação atômica/journaled e verificação terminal; preservar
  hashes de input por geração.
- **Critério de aceite:** cada failure point reconstrói estado anterior ou
  `recovery_required`; replacement/rollback validam com o parser TypeScript e
  nunca ativam serviço.
- **Testes da correção:** matrix completa de candidate/state/publication/crash,
  parser rejection, modified generation e rollback.
- **Esforço:** Grande
- **Momento:** Corrigir imediatamente

### AUD-HIGH-008 — Evidência e gate de release não demonstram qualificação

- **Severidade:** Alta
- **Confiança:** Confirmado
- **Categoria:** Supply chain / release assurance
- **Componente:** contracts, evidence, traceability e CI
- **Arquivo e linha:** `docs/contracts/atlas-manager-release-contract.json:4-16`;
  `atlas-manager-v1-software-release-candidate-evidence.json:3-32`;
  `docs/release/atlas-manager-v1-requirements-traceability.md:11-22`;
  `.github/workflows/ci.yml:230-237`
- **Descrição:** contrato aponta baseline anterior e contém strings
  `ci-generated-*` no lugar de hashes. Evidence declara `qualified` mesmo com
  Go e production audit indisponíveis. A traceability referencia intervalos
  FR/NFR/SEC inexistentes em vez de cada requisito. O job final apenas confere
  versão, tamanho do catálogo e existência de arquivos.
- **Evidência:** requisitos reais terminam em FR-038, NFR-014 e SEC-012; o
  documento oficial afirma FR-001–064, NFR-001–020 e SEC-001–020. Não foi
  encontrado gerador/rehearsal que produza evidence duplo e determinístico.
- **Impacto:** a marca `qualified` não representa o código auditado e não é
  reprodutível por um revisor.
- **Cenário de falha/abuso:** um bundle diferente, testes ausentes ou contrato
  placeholder passam no gate e são apresentados como RC qualificado.
- **Mitigação existente:** validações Node comuns são extensas e passaram; o
  bundle possui tooling de manifest/checksum.
- **Recomendação:** gerar contracts/evidence do commit candidato, validar hashes,
  requisito por requisito, executar bundle/rehearsal duplos e falhar por
  placeholders/indisponibilidade.
- **Critério de aceite:** nenhuma string placeholder; todos os digests
  recalculáveis; dois bundles/evidences iguais; todos os gates requeridos
  executados e traceability completa.
- **Testes da correção:** tamper de cada digest/campo, versão/baseline mismatch,
  missing Must/license e differing builds.
- **Esforço:** Grande
- **Momento:** Corrigir imediatamente

### AUD-MED-001 — Validação de Host aceita sintaxe além de authority

- **Severidade:** Média
- **Confiança:** Confirmado
- **Categoria:** HTTP / defense in depth
- **Componente:** administrative public origin
- **Arquivo e linha:** `src/config/administrative-public-origin.ts:35-48`
- **Descrição:** o valor de `Host` é concatenado a `https://` e comparado por
  hostname/port, sem rejeitar explicitamente user-info, path, query ou fragment.
- **Evidência:** o matcher retornou true para
  `evil.example@atlas.example.com`, `atlas.example.com/path`,
  `atlas.example.com?x` e `atlas.example.com#x`.
- **Impacto:** a policy documentada é mais estrita que a aplicada; intermediários
  podem interpretar valores ambíguos de forma diferente.
- **Cenário de falha/abuso:** request com authority malformada alcança
  autenticação em vez de ser rejeitada no envelope.
- **Mitigação existente:** Access JWT e autorização continuam obrigatórios; sem
  sessão, wildcard CORS ou trust proxy.
- **Recomendação:** parser dedicado de authority com gramática fechada e
  comparação canônica.
- **Critério de aceite:** somente hostname[:port] exato aceita; todos os casos
  ambíguos rejeitam.
- **Testes da correção:** matriz Host/HTTP2 authority, controles, IDN e múltiplos
  headers.
- **Esforço:** Pequeno
- **Momento:** Corrigir antes da qualificação física

### AUD-MED-002 — Verificação e inventário de exports não cobrem toda a publicação

- **Severidade:** Média
- **Confiança:** Alta confiança
- **Categoria:** Event-history export
- **Componente:** segmented event-history store
- **Arquivo e linha:** `src/event-history/infrastructure/file-segmented-administrative-event-history.ts:606-613`;
  `src/event-history/infrastructure/file-segmented-administrative-event-history.ts:766-807`;
  `src/event-history/infrastructure/file-segmented-administrative-event-history.ts:955-975`
- **Descrição:** o footer é calculado a partir de bytes provisórios com hash
  vazio, mas o arquivo final não é integralmente parseado/verificado. A listagem
  parte de manifests e pode não detectar `.jsonl` órfão; o parser de metadata
  não prova que `exportId == contentSha256`.
- **Evidência:** fluxo e invariantes ausentes nos trechos citados; testes atuais
  não cobrem todos os unknown/orphan/collision states.
- **Impacto:** export modificado ou inventory assimétrica pode não bloquear
  list/prune conforme o contrato.
- **Cenário de falha/abuso:** arquivo órfão em exports não é classificado como
  unknown e retenção segue operando.
- **Mitigação existente:** download conhecido verifica content hash e usa
  filename derivado.
- **Recomendação:** inventory fechado de todos os entries, parser completo
  header/event/footer e igualdade content-derived ID.
- **Critério de aceite:** qualquer orphan, mismatch ou footer inválido bloqueia
  operação; export equivalente permanece determinístico.
- **Testes da correção:** orphan dos dois tipos, substituted manifest, footer e
  ID mismatch, concurrent prune/download.
- **Esforço:** Médio
- **Momento:** Corrigir antes da qualificação física

### AUD-MED-003 — Migração v1 não usa candidate store atômico e receipt é permissivo

- **Severidade:** Média
- **Confiança:** Confirmado
- **Categoria:** Event-history migration
- **Componente:** maintenance entrypoint
- **Arquivo e linha:** `src/maintenance/event-history.ts:63-150`;
  `src/maintenance/event-history.ts:93-103`
- **Descrição:** eventos são gravados diretamente no root v2 final, sem
  candidate root/publicação atômica. Receipt é lido com `JSON.parse` direto e
  validação parcial.
- **Evidência:** o código chama `target.record` durante a migração e não publica
  uma árvore candidata após verificação integral.
- **Impacto:** crash pode deixar v2 parcial no local final, exigindo recuperação
  manual e impedindo tentativa limpa.
- **Cenário de falha/abuso:** interrupção no evento N cria store parcial que já
  existe, enquanto v1 preservado precisa de decisão manual não prevista.
- **Mitigação existente:** v1 é preservado, confirmação é exata e startup não
  migra automaticamente.
- **Recomendação:** candidate root no mesmo filesystem, verifier completo,
  receipt estrito e rename final.
- **Critério de aceite:** cada crash pré-publicação deixa v1 intacto e nenhum v2
  final; pós-publicação produz store totalmente verificado.
- **Testes da correção:** fault injection por etapa, changing source, repeated
  unchanged e receipt unknown fields.
- **Esforço:** Médio
- **Momento:** Corrigir antes da qualificação física

### AUD-MED-004 — Dashboard entregue diverge das fontes e não implementa o produto declarado

- **Severidade:** Média
- **Confiança:** Confirmado
- **Categoria:** Frontend / segurança de UI
- **Componente:** dashboard assets e bundle
- **Arquivo e linha:** `src/http/administrative-dashboard-route.ts:30-66`;
  `src/dashboard/main.ts:1`;
  `deployment/internal/bundle/builder.go:359-391`;
  `tests/http/administrative-control-plane-route.test.ts:215-257`
- **Descrição:** runtime serve strings minificadas no route; `src/dashboard/*`
  não é a fonte servida; o builder Go cria outra inventory. O JavaScript runtime
  carrega basicamente overview/services/history, deixa disponibilidade
  incompleta e não oferece as operações de backup/event-history/security
  declaradas. Há um asset inicial com confirmações hardcoded que é sobrescrito
  por outro map, formando código morto perigoso.
- **Evidência:** testes verificam 200/CSP/texto, não comportamento em browser,
  safe DOM, clear confirmation, role controls ou authoritative reread.
- **Impacto:** operador não recebe a superfície prometida e três fontes podem
  divergir em segurança/CSP/assets.
- **Cenário de falha/abuso:** correção feita em `src/dashboard/main.ts` não chega
  ao bundle; regressão de DOM passa sem teste.
- **Mitigação existente:** assets são fechados, protegidos, sem CDN; código
  servido usa `textContent` e CSP.
- **Recomendação:** uma fonte compilada determinística, inventário compartilhado
  e testes DOM/browser do fluxo completo.
- **Critério de aceite:** todas as sections declaradas funcionam por capability,
  sem optimistic update/storage/unsafe DOM, e o mesmo digest chega ao bundle.
- **Testes da correção:** browser matrix, keyboard/a11y, confirmations, escaping,
  rereads e bundle digest.
- **Esforço:** Grande
- **Momento:** Corrigir antes da qualificação física

### AUD-MED-005 — Readiness de identidade não representa cache e status é hardcoded

- **Severidade:** Média
- **Confiança:** Confirmado
- **Categoria:** Authentication observability
- **Componente:** Cloudflare composition e security status
- **Arquivo e linha:** `src/authentication/domain/administrative-identity-readiness.ts:1-20`;
  `src/authentication/composition/create-cloudflare-access-authentication.ts:87-103`;
  `src/http/create-administrative-runtime.ts:96-111`
- **Descrição:** o domínio declara `ready_with_cached_keys`, métricas de cache e
  timestamps, mas a composition retorna apenas ready/unavailable/misconfigured.
  O security status contém catalog reconciliation, feature counts, loopback e
  audit como constantes.
- **Evidência:** não há teste de `ready_with_cached_keys`; status não lê estado
  real.
- **Impacto:** outage com cache válido não é distinguido e o dashboard pode
  exibir postura positiva não observada.
- **Cenário de falha/abuso:** JWKS indisponível durante rotação é reportado de
  modo impreciso, levando a decisão operacional errada.
- **Mitigação existente:** verifier JWT real mantém issuer/audience/RS256 e
  falha fechado.
- **Recomendação:** readiness derivada do cache/client real e status composto de
  readers observáveis, nunca constantes de sucesso.
- **Critério de aceite:** cada outcome é alcançável e testado; resposta não
  expõe keys/config.
- **Testes da correção:** fresh, overlap, cached outage, expired cache, malformed
  JWKS e catalog mismatch.
- **Esforço:** Médio
- **Momento:** Corrigir antes da qualificação física

### AUD-MED-006 — Inventário de dependências/licenças não é completo

- **Severidade:** Média
- **Confiança:** Confirmado
- **Categoria:** Supply chain
- **Componente:** release dependency inventory
- **Arquivo e linha:** `docs/release/atlas-manager-production-dependencies.json:1-34`;
  `.github/workflows/ci.yml:230-237`
- **Descrição:** o documento lista somente quatro dependências diretas, embora
  `npm ls --omit=dev --all --json` reporte 84 packages de produção. O CI não
  valida fechamento transitivo ou licenças.
- **Evidência:** comparação local do lockfile com o documento.
- **Impacto:** revisão de licença e supply chain omite código efetivamente
  instalado em produção.
- **Cenário de falha/abuso:** dependência transitiva muda licença/integridade e o
  release gate não percebe.
- **Mitigação existente:** package-lock possui integrities; o audit npm sem
  dependências de desenvolvimento retornou zero vulnerabilidades.
- **Recomendação:** gerar inventário transitivo canônico offline do lockfile,
  com licença/integrity e falha para metadata ausente.
- **Critério de aceite:** inventário fecha exatamente a árvore production e CI
  detecta add/remove/license unknown.
- **Testes da correção:** fixtures de transitive, optional, peer, missing
  license e deterministic ordering.
- **Esforço:** Médio
- **Momento:** Corrigir antes da qualificação física

### AUD-MED-007 — Matrizes de browser, release e configuration lifecycle não existem de forma executável

- **Severidade:** Média
- **Confiança:** Alta confiança
- **Categoria:** Test assurance
- **Componente:** tests e CI
- **Arquivo e linha:** `.github/workflows/ci.yml:230-237`;
  `tests/http/administrative-route-security-catalog.test.ts:8-36`;
  `deployment/internal/administrativeconfiguration/input_test.go:1`
- **Descrição:** não foram encontrados testes que percorram cada rota do
  catálogo, Host/Origin/Fetch Metadata/forwarded spoofing, replace/rollback
  failure matrix ou rehearsal completo duplo.
- **Evidência:** 198 test files Node passam, mas somente 13 arquivos HTTP foram
  identificados; o catálogo test só verifica forma; configuration Go possui
  testes de input, não lifecycle.
- **Impacto:** os defeitos confirmados chegaram ao RC apesar de suite ampla.
- **Cenário de falha/abuso:** policy ou recovery muda sem que CI exercite a
  negação/atomicidade real.
- **Mitigação existente:** bons testes unitários por feature e fixtures
  determinísticas.
- **Recomendação:** adicionar matrizes data-driven e rehearsal compilado a
  partir do mesmo commit.
- **Critério de aceite:** cada descriptor tem casos disabled/auth/role/bounds/
  confirmation/gate/audit/headers/replay; lifecycle tem failure injection.
- **Testes da correção:** a própria matrix, com mutation tests de catalog e
  evidence.
- **Esforço:** Grande
- **Momento:** Corrigir antes da qualificação física

### AUD-LOW-001 — Correlation ID não é propagado a logs/auditoria

- **Severidade:** Baixa
- **Confiança:** Confirmado
- **Categoria:** Observabilidade
- **Componente:** administrative HTTP
- **Arquivo e linha:** `src/http/administrative-http.ts:9-12`;
  `src/http/error-handler.ts:29-36`
- **Descrição:** UUID interno é retornado no header, mas não aparece em outros
  usos no source e o logger de erro não o inclui.
- **Evidência:** referência única à geração/header; nenhum vínculo com logs.
- **Impacto:** investigação não correlaciona resposta do operador com falha
  interna.
- **Cenário de falha/abuso:** incidente multi-request exige inferência por
  timestamp.
- **Mitigação existente:** attempt IDs de domínio e logs estruturados existem.
- **Recomendação:** request-scoped context bounded, sem aceitar ID do caller.
- **Critério de aceite:** response, logs e coordenação de audit segura compartilham
  o correlation ID sem usá-lo para auth/idempotência.
- **Testes da correção:** sucesso/erro/concurrency e caller spoof.
- **Esforço:** Pequeno
- **Momento:** Planejar para a próxima versão

### AUD-LOW-002 — Fetch Metadata destination não tem política semântica

- **Severidade:** Baixa
- **Confiança:** Confirmado
- **Categoria:** Browser security
- **Componente:** security envelope
- **Arquivo e linha:** `src/http/administrative-security-envelope.ts:47-82`
- **Descrição:** `Sec-Fetch-Dest` é lido e verificado sintaticamente, mas não
  diferencia destinos compatíveis com navigation, assets e API.
- **Evidência:** branch rejeita malformed/cross-site, sem allowlist por route.
- **Impacto:** defense-in-depth é menos estrita que a documentação sugere.
- **Cenário de falha/abuso:** contexto browser estranho passa ao auth, embora não
  o substitua.
- **Mitigação existente:** same-origin, JSON não simples, Access e CSP.
- **Recomendação:** policy por categoria de resposta no catálogo.
- **Critério de aceite:** shell/assets/API aceitam apenas combinações previstas.
- **Testes da correção:** navigate/script/style/empty/cors/no-cors matrix.
- **Esforço:** Pequeno
- **Momento:** Corrigir antes de produção estável

### AUD-LOW-003 — Documentos normativos e históricos ainda se contradizem

- **Severidade:** Baixa
- **Confiança:** Confirmado
- **Categoria:** Governance
- **Componente:** product vision, requirements e README
- **Arquivo e linha:** `docs/product-vision.md:112-124`;
  `docs/requirements.md:347-354`; `docs/requirements.md:541-560`
- **Descrição:** product vision/initial scope ainda sugerem CLI e backups
  lógicos, enquanto ADR-023/025 e FR-037 os deferem.
- **Evidência:** textos coexistem sem marcação uniforme de histórico/superseded.
- **Impacto:** auditor e mantenedor podem adotar escopo incorreto.
- **Cenário de falha/abuso:** roadmap futuro é tratado como requisito Must do RC.
- **Mitigação existente:** ADRs mais recentes resolvem explicitamente o escopo.
- **Recomendação:** marcar documentos históricos e apontar precedência.
- **Critério de aceite:** nenhuma seção de initial release contradiz ADR aceito.
- **Testes da correção:** docs consistency checker.
- **Esforço:** Pequeno
- **Momento:** Corrigir antes de produção estável

### AUD-LOW-004 — Actions e toolchain não estão fixados por digest/patch exato

- **Severidade:** Baixa
- **Confiança:** Confirmado
- **Categoria:** CI supply chain
- **Componente:** GitHub Actions e bundle builder
- **Arquivo e linha:** `.github/workflows/ci.yml:25-30`;
  `.github/workflows/ci.yml:137-141`;
  `deployment/internal/bundle/builder.go:23-25`;
  `deployment/internal/bundle/builder.go:214`
- **Descrição:** Actions usam tags `@v4/@v5` e setup-node `24`, enquanto o
  contrato de bundle reivindica runtime pinado.
- **Evidência:** workflows não usam commit SHA e Node não fixa 24.18.0.
- **Impacto:** rebuild futuro pode usar action/runtime diferente sem mudança no
  repo.
- **Cenário de falha/abuso:** tag de Action ou versão 24.x muda comportamento do
  release gate.
- **Mitigação existente:** lockfile e runtime local explícito na evidência.
- **Recomendação:** pin de Actions por SHA e Node/npm por versão exata.
- **Critério de aceite:** CI imprime e valida versões exatas e renovate process
  revisa updates.
- **Testes da correção:** CI lint e deliberate version mismatch.
- **Esforço:** Pequeno
- **Momento:** Corrigir antes de produção estável

### AUD-INFO-001 — Checks de dependência externa permanecem opcionais e ausentes

- **Severidade:** Informativa
- **Confiança:** Confirmado
- **Categoria:** Escopo funcional
- **Componente:** server health
- **Arquivo e linha:** `docs/requirements.md:55-62`
- **Descrição:** FR-004 é Should e não possui fluxo composto.
- **Evidência:** nenhum reader/route/test integrado foi localizado.
- **Impacto:** Atlas não reporta internet/DNS/public-app health.
- **Cenário de falha/abuso:** falha externa exige monitoramento separado.
- **Mitigação existente:** health local funciona.
- **Recomendação:** backlog, com destinations fixos e SSRF protection.
- **Critério de aceite:** checks allowlisted e bounded.
- **Testes da correção:** timeout, DNS failure, allowlist e SSRF.
- **Esforço:** Médio
- **Momento:** Adicionar ao backlog

### AUD-INFO-002 — Maintenance response de serviço indisponível não foi entregue

- **Severidade:** Informativa
- **Confiança:** Confirmado
- **Categoria:** Escopo funcional
- **Componente:** availability
- **Arquivo e linha:** `docs/requirements.md:153-159`
- **Descrição:** FR-015 é Should e não há resposta/página pública composta.
- **Evidência:** nenhum route/adapter integrado foi encontrado.
- **Impacto:** consumidores externos não recebem explicação project-owned.
- **Cenário de falha/abuso:** indisponibilidade intencional parece outage.
- **Mitigação existente:** dashboard administrativo mostra intent.
- **Recomendação:** backlog separado do control plane.
- **Critério de aceite:** resposta segura sem revelar schedule interno.
- **Testes da correção:** available/unavailable e cache.
- **Esforço:** Médio
- **Momento:** Adicionar ao backlog

### AUD-INFO-003 — Efeitos físicos permanecem corretamente não qualificados

- **Severidade:** Informativa
- **Confiança:** Confirmado
- **Categoria:** Physical gate
- **Componente:** ingress, systemd, helper, RTC e shutdown
- **Arquivo e linha:** `docs/roadmap.md`; `docs/release/atlas-manager-1.0.0-rc.1.md`
- **Descrição:** deployment físico, Tunnel/Access real, helper, RTC, wake e
  shutdown não foram executados e são gates separados.
- **Evidência:** perfil gerenciado mantém backend mock/effects/scheduler
  desabilitados; auditoria não tocou recursos reais.
- **Impacto:** não se pode declarar stable physical release.
- **Cenário de falha/abuso:** nenhum; é boundary intencional.
- **Mitigação existente:** docs e gates de configuração.
- **Recomendação:** executar apenas após remediações de software, com aprovação e
  rollback físico.
- **Critério de aceite:** runbook físico separado, observação humana e evidence.
- **Testes da correção:** não aplicável nesta auditoria.
- **Esforço:** Grande
- **Momento:** Corrigir antes de produção estável

## Revisão por camada

### Autenticação

- O modelo real é Cloudflare Access JWT stateless.
- Algoritmo aceito: RS256; issuer e audience são exatos.
- Claims temporais e subject UUID humano são validados.
- JWKS possui HTTPS, timeout, tamanho e quantidade de keys bounded, cache e
  refresh único para `kid` desconhecido.
- Roles não vêm de claims.
- Assertions não são persistidas, retornadas ou armazenadas no browser.
- A lacuna é de readiness/observabilidade (`AUD-MED-005`), não de substituição
  da verificação criptográfica.

### Autorização

Roles e permissions são vocabulários fechados; principal autenticado sem
assignment é negado. Protected administration resolve operação→permission,
registra a decisão e propaga actor verificado. Não foi encontrada escalada
horizontal por caller-selected actor. O dashboard não é boundary de
autorização. O risco sistêmico é o catálogo não provar o runtime
(`AUD-HIGH-006`).

### HTTP, injection e browser

- Body parsers são bounded e rejeitam media type/compression/unknown fields e,
  onde aplicável, duplicate keys.
- Não há CORS grants, application session ou auth cookie.
- CSP, frame denial, no-store e nosniff estão presentes.
- `trust proxy` é false e forwarded headers não são inputs de auth.
- Não há SQL/NoSQL injection porque não existe query layer da aplicação.
- Não foi encontrado command injection, open redirect ou template engine.
- Host parsing precisa fechamento (`AUD-MED-001`); a browser matrix não existe
  (`AUD-MED-007`).

### Filesystem

Backup e event-history validam root, ownership/mode, symlink, hard link, tipos,
candidate e rename. O filesystem backup usa APIs Node e hashing streaming, não
tar/rsync/cp. Há atenção a TOCTOU e source mutation. As falhas principais são o
contrato de mode da unit, estado loaded do backup, retenção e migração
(`AUD-HIGH-001` a `005`, `AUD-MED-002/003`).

### Subprocessos e helper Linux

Adapters revisados usam executáveis fixos, argumentos derivados de catálogo,
`shell: false`, bounds e timeouts. Não foi encontrada API de comando
arbitrário. O helper possui protocolo fechado para RTC/D-Bus e não foi
executado. A fixture controlada compilada existente passou 12/12 quando
executada fora das restrições de subprocesso do sandbox. Go source não foi
compilado localmente.

### Backup

Não aceita source/destination via HTTP, não segue symlink, rejeita hard link e
special files, limita tamanho/profundidade, detecta source mutation, escreve
manifest e publica candidato por rename. Não há restore ou download. Os
achados `AUD-HIGH-001` a `004` impedem considerar metadata/retention confiáveis.

### Event history

Há record/segment SHA-256 chains, lock cross-processo, owner token, stale-lock
recovery explícita, transaction journal, retention anchors e exports. O ADR
corretamente não reivindica autenticidade externa ou non-repudiation. A segunda
retenção quebra a própria chain e export/migration não fecham todos os
invariantes.

### Dashboard

Shell/assets são protegidos e inventory é fechada; sem CDN, storage, cookies ou
unsafe HTML no asset servido. CSP e clickjacking headers existem. Contudo, a
entrega funcional e os testes de browser são muito menores que a documentação
e existem três fontes de asset (`AUD-MED-004`).

### Segredos

Varreduras por private keys, JWTs, Cloudflare tokens, API keys, passwords,
database URLs, cookies/client secrets e SSH keys não encontraram material com
aparência de segredo real. Exemplos usam placeholders. Nenhum valor sensível é
reproduzido neste relatório.

### Cadeia de suprimentos e CI

`package-lock.json` possui integrities e não foram encontradas dependências Git
de produção. `npm audit --omit=dev` retornou zero. O audit completo encontrou
uma vulnerabilidade High em `brace-expansion` 4.0.0–5.0.7, no grafo de
desenvolvimento/build; não foi demonstrada alcançabilidade em runtime.
Inventário/licenças e release gate são insuficientes (`AUD-HIGH-008`,
`AUD-MED-006/007`). Actions não estão pinadas por SHA.

### Deployment

A unit declara usuário/grupo não root, ProtectSystem strict, PrivateTmp e paths
gerenciados. Não concede `ReadWritePaths=/`. A escolha de grupo do helper e
setuid requer qualificação física. O conflito `0750` é blocker imediato.
Install/upgrade/rollback/uninstall são implementados em Go, mas Go estava
indisponível e não foram validados localmente.

## Riscos manuais e gates físicos

Mesmo após as correções, exigem validação manual aprovada:

1. owner/group/modes reais criados por systemd;
2. Cloudflare Tunnel, Access policy e public origin;
3. identidade do processo e grupos;
4. instalação do helper, parent directories e setuid;
5. RTC read/write e firmware wake;
6. logind shutdown e uncertain acceptance;
7. deactivation/rollback sob falha de energia;
8. capacidade de disco e backup de origem física.

## Conclusão

Não há base para afirmar comprometimento imediato nem exposição administrativa
sem autenticação. Há, porém, defeitos confirmados que quebram disponibilidade,
fail-closed de shutdown, integridade de backup/auditoria e confiabilidade da
qualificação. A postura adequada é remediar e repetir a qualificação de software
antes de qualquer drill físico.
