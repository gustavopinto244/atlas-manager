# GET /admin/security/status

## Resumo

Devolve um retrato ("postura") da configuração de segurança administrativa do "atlas": prontidão do provedor de identidade, se o catálogo de rotas está reconciliado, quais feature flags estão ativas, e um punhado de fatos arquiteturais fixos (sem sessão de aplicação, CORS desabilitado etc.). Existe para um operador confirmar rapidamente que a superfície administrativa está configurada como esperado, sem ter que inspecionar `.env` ou logs.

## Contrato

- **Método/Path**: `GET /admin/security/status`.
- **Arquivo de registro**: `src/http/administrative-security-status-route.ts` (`registerAdministrativeSecurityStatusRoute` → `handler`), catalogado em `src/http/administrative-route-security-catalog.ts` como `security.status.read` (operação `read_administrative_security_posture`, permissão `security.posture.read`, activationFlag `ADMINISTRATIVE_SECURITY_STATUS_HTTP_ENABLED`). Diferente da família de backups, esta rota tem seu **próprio arquivo de handler**, não compartilha `administrative-backups-route.ts`.
- **Middlewares em `/admin*`**: envelope de segurança (`createAdministrativeSecurityEnvelope`, `src/http/create-app.ts`).
- **Autenticação/Autorização**: Cloudflare Access + permissão `security.posture.read` — roles: `auditor`, `audit_operator`, `administrator`.
- **Parâmetros de rota**: nenhum.
- **Query string**: não aceita.
- **Corpo da requisição**: não aceito.
- **Formato da resposta** (200, `application/json`, teto de 64 KiB): `{ identityReadiness, routeCatalog: { reconciled, routeCount, routeIds }, activationFlags: { <FLAG>: boolean, ... }, featureCounts: { enabled, disabled }, loopbackBinding: boolean, noApplicationSession: true, corsDisabled: true, trustProxyDisabled: true, auditAvailable: boolean }`.
- **Códigos de status possíveis**:
  - `200` — sucesso.
  - `400 invalid_administrative_request` — query ou corpo presente.
  - `401 administrative_authentication_required` / `503 administrative_identity_unavailable`.
  - `403 administrative_authorization_denied`.
  - `405 method_not_allowed` — método diferente de GET (`Allow: GET`).
  - `414 uri_too_long`.
  - `429 administrative_request_limited` (`Retry-After: 1`).
  - `500 internal_error` — resposta acima de 64 KiB.
  - `503 administrative_security_status_unavailable` — fallback genérico (inclui o caso `securityPostureReader` não estar configurado na composição — ver Caminho da requisição).
  - `503 administrative_authorization_unavailable` / `authorization_audit_unavailable`.

## Caminho da requisição

- `handler(dependencies)` (`administrative-security-status-route.ts`) — headers de segurança, `admission.tryAdmit()` (429 se recusado). Encanamento de infraestrutura compartilhado.
- IIFE assíncrona dentro do handler: exige `GET` (405 caso contrário), valida tamanho da URL, rejeita query, valida ausência de corpo — encanamento de validação, tudo antes de tocar em autenticação.
- **Aqui está a lógica de negócio de verdade**, em duas camadas:
  1. `dependencies.createProtectedAdministration(reader).getAdministrativeSecurityPosture.execute()` — a capacidade `getAdministrativeSecurityPosture`, implementada em `src/access-control/composition/create-protected-administration.ts` (linhas ~428-435), passa primeiro por `runner.run("read_administrative_security_posture", ...)`: autentica o principal via Cloudflare Access, autoriza contra `security.posture.read`, audita a decisão — e só então invoca `input.securityPostureReader.execute()` (se não configurado, lança `Error("administrative_security_status_unavailable")`).
  2. O `securityPostureReader` real é construído na composição de topo, **não** neste módulo de access-control: `src/http/create-administrative-runtime.ts` (linhas ~246-269). É ali que o corpo da resposta é de fato montado: chama `cloudflareAuthentication.readIdentityProviderReadiness()` para `identityReadiness`; deriva `routeCatalog` cruzando `ADMINISTRATIVE_ROUTE_SECURITY_CATALOG` com as activation flags habilitadas nesta instância (`expectedAdministrativeRouteIds`, `administrative-route-security-catalog.ts`) e um booleano `reconciled` calculado na inicialização (`reconcileAdministrativeRouteRegistrations`); monta o mapa `activationFlags` (todas as flags conhecidas → habilitada ou não nesta instância) e `featureCounts`; e embute fatos estáticos da arquitetura (`loopbackBinding` a partir de `config.host`, `noApplicationSession`/`corsDisabled`/`trustProxyDisabled` sempre `true`, `auditAvailable` a partir de `eventHistory !== undefined`).
- De volta ao handler HTTP: serializa o corpo, garante que não ultrapasse 64 KiB (`MAX_RESPONSE_BYTES` inline, diferente do teto de 256 KiB usado pela família de backups), responde 200.
- `mapError()` (mesmo arquivo) traduz qualquer erro não-`HttpError`/não-`AdministrativeAccessControlError` para `503 administrative_security_status_unavailable`.

## Funções-chave

- **`securityPostureReader.execute`** (fechamento em `src/http/create-administrative-runtime.ts`) — monta de fato o corpo da resposta; é aqui, não no handler HTTP nem no `access-control`, que a "postura de segurança" é definida e calculada.
- **`ExecuteProtectedAdministrativeOperation.run`** (`create-protected-administration.ts`) — autentica/autoriza/audita `read_administrative_security_posture` antes de permitir a leitura da postura.
- **`readIdentityProviderReadiness`** (na composição de autenticação Cloudflare, injetada em `cloudflareAuthentication`) — decide se o provedor de identidade (Cloudflare Access) está pronto para autenticar; é o único componente desta rota que faz uma checagem "viva" de uma dependência externa, os demais campos são cálculos sobre configuração já carregada em memória.
- **`expectedAdministrativeRouteIds` / `reconcileAdministrativeRouteRegistrations`** (`administrative-route-security-catalog.ts`) — a fonte de `routeCatalog.routeIds`/`routeCount`/`reconciled`; garantem que o que a rota reporta como "catálogo esperado" é derivado da mesma fonte de verdade que decide quais rotas são de fato registradas no Express.

## Erros e casos de borda

- Se a composição não injetar `securityPostureReader` (rota habilitada sem essa dependência montada corretamente), a chamada lança `Error("administrative_security_status_unavailable")` — mapeado para `503` com o mesmo código, então o sintoma observável não distingue "reader ausente por bug de composição" de qualquer outra falha interna.
- `identityReadiness` reflete o estado no momento da chamada — não há cache; cada requisição faz uma checagem nova do provedor de identidade.
- `activationFlags` sempre lista **todas** as flags conhecidas no catálogo (`ADMINISTRATIVE_ACTIVATION_FLAGS`), não só as habilitadas — inclui explicitamente as desabilitadas como `false`.
- Resposta acima de 64 KiB (teto local desta rota, mais apertado que o de 256 KiB usado pela família de backups) vira `500 internal_error` em vez de ser truncada — improvável de acontecer com o conjunto de campos atual, mas o comportamento existe.

## Observações

- Existe também uma ferramenta de manutenção via CLI (`src/maintenance/administrative-security.ts`, `runAdministrativeSecurityMaintenance`, com ações como `inspect`/`verify-configuration`/`verify-route-catalog`/`verify-identity`) que é uma via de acesso **separada** e mais profunda à mesma área de segurança administrativa — não é o que esta rota HTTP chama, mas um leitor apressado do código pode confundir as duas por causa dos nomes parecidos.
- O teto de resposta desta rota (64 KiB) é bem menor que o das rotas de backup (256 KiB) e do histórico de eventos (1 MiB) — não há um padrão único de "teto de resposta administrativa" documentado centralmente; cada rota define o seu próprio valor localmente.
