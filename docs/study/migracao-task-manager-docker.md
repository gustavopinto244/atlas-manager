# Migração do task-manager: PM2 → Docker (Atlas Manager)

Registro da migração do `task-manager` de PM2 para um container Docker
gerenciado pelo Atlas Manager, publicado em `task.gustavopinto.dev.br`.
A migração também serviu como teste real das funções Docker do Atlas
Manager contra um serviço de produção.

Servidor: Atlas (Ubuntu). Todas as mudanças foram feitas via SSH,
diretamente no host.

---

## 1. Estado anterior × estado final

|                           | Antes (PM2)                                                                                  | Depois (Docker)                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Processo                  | `node server.js` via PM2, `PM2_HOME=/var/lib/pm2-task-manager`                               | Container `task-manager-docker` (imagem `app-task-manager`, `node:26-alpine`)                                  |
| Porta local               | `127.0.0.1:3001` (bind interno do processo)                                                  | `127.0.0.1:3002` → `3001` dentro do container                                                                  |
| Runtime Node              | 26.5.0 via nvm (processo do usuário `guga`)                                                  | `node:26-alpine` (mesma major version)                                                                         |
| Gerenciado por            | `pm2-guga.service` (systemd) → PM2 God Daemon                                                | Atlas Manager, adapter `docker`, via `docker` CLI                                                              |
| Registro no Atlas Manager | `REGISTERED_SERVICES_JSON`, `managementAdapter: "pm2"`, `externalResourceId: "task-manager"` | mesmo `id: "task-manager"`, `managementAdapter: "docker"`, `externalResourceId: "task-manager-docker"`         |
| Exposição pública         | Só `gustavopinto.dev.br` (apex), via `sites-available/task-manager-project`                  | `task.gustavopinto.dev.br`, via novo vhost `sites-available/task-manager-docker`; apex não foi tocado (ver §7) |
| Sessões                   | `connect-mongo`, armazenadas no MongoDB Atlas (externo)                                      | Inalterado — mesmo `CONNECTION_STRING`                                                                         |
| Dados em disco            | Nenhum além do código-fonte                                                                  | Nenhum — nenhum volume Docker foi criado                                                                       |
| Logs                      | `/var/lib/pm2-task-manager/logs/task-manager-{out,error}.log`                                | `docker logs task-manager-docker` (driver padrão do Docker)                                                    |

---

## 2. Passo a passo

### 2.1 Reconhecimento (somente leitura)

Nenhuma mudança nesta etapa. Descobertas relevantes:

- Não existe `ecosystem.config.js` — o processo PM2 foi iniciado com um
  `pm2 start` direto, sem arquivo de configuração.
- `PM2_HOME=/var/lib/pm2-task-manager` é uma variável de ambiente
  customizada; sem ela, `pm2 list` do usuário `guga` mostra uma lista
  vazia (usa `~/.pm2` por padrão), o que pode confundir quem inspecionar
  o servidor sem saber disso.
- Nenhum dado persistente em disco além do banco externo — sessões vão
  para o MongoDB via `connect-mongo`.
- `REGISTERED_SERVICES_JSON` **já tinha** uma entrada para
  `task-manager` via adapter `pm2` — o Atlas Manager já gerenciava o
  processo antes desta migração, algo que não estava explícito no
  pedido inicial.
- O usuário de sistema `atlas-manager` **não** estava no grupo `docker`
  — nenhuma função Docker do Atlas Manager funcionaria sem esse ajuste.
- O vhost nginx do apex (`gustavopinto.dev.br`) já apontava para a
  porta 3001 do PM2 — não era um placeholder reservado para portfólio,
  como a premissa inicial da tarefa assumia.

### 2.2 Desligar o PM2 (antes de o Docker existir)

Por pedido explícito (contrariando a intenção original de fazer os dois
coexistirem), o processo PM2 foi parado e excluído **antes** do
container existir:

```bash
export PM2_HOME=/var/lib/pm2-task-manager
pm2 stop task-manager
pm2 delete task-manager
pm2 save --force   # necessário: "pm2 save" sozinho recusa salvar lista vazia
```

Isso deixou a porta 3001 livre e o apex `gustavopinto.dev.br` respondendo
502 (esperado e aceito — ver §7) até o restante da migração terminar.
O `pm2-guga.service` (systemd) não foi desabilitado — só o processo
`task-manager` saiu da lista gerenciada pelo PM2.

### 2.3 Containerização

Arquivos criados em `/home/guga/apps/task-manager-project/app/`
(repositório do próprio task-manager, separado deste):

**`Dockerfile`**

```dockerfile
FROM node:26-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
USER node
EXPOSE 3001
CMD ["node", "server.js"]
```

**`.dockerignore`** (evita embutir `.env` — com a connection string do
Mongo — dentro da imagem):

```
node_modules
.git
.env
npm-debug.log
```

**`docker-compose.yml`**

```yaml
services:
  task-manager:
    build: .
    container_name: task-manager-docker
    restart: unless-stopped
    env_file:
      - .env
    environment:
      - PORT=3001
      - HOST=0.0.0.0
    ports:
      - "127.0.0.1:3002:3001"
```

```bash
docker compose build
docker compose up -d
```

### 2.4 Registro no Atlas Manager

Backup de `/etc/atlas-manager/atlas-manager.env` antes de editar
(`atlas-manager.env.backup-20260811-220841`). A entrada `pm2` existente
em `REGISTERED_SERVICES_JSON` foi **substituída** (mesmo `id`) por uma
entrada `docker`:

```json
{
  "id": "task-manager",
  "displayName": "Task Manager",
  "managementAdapter": "docker",
  "externalResourceId": "task-manager-docker",
  "supportedOperations": ["readStatus", "readLogs", "start", "stop", "restart"],
  "availabilityPolicy": { "mode": "manual" }
}
```

O usuário de sistema `atlas-manager` foi adicionado ao grupo `docker`
(`usermod -aG docker atlas-manager`), e o serviço foi reiniciado
(`systemctl restart atlas-manager.service`) para que o novo grupo
suplementar e a nova config fossem aplicados.

### 2.5 Exposição em `task.gustavopinto.dev.br`

Novo arquivo `/etc/nginx/sites-available/task-manager-docker`:

```nginx
server {
    listen 127.0.0.1:80;
    listen [::1]:80;
    server_name task.gustavopinto.dev.br;

    set_real_ip_from 127.0.0.1;
    real_ip_header CF-Connecting-IP;

    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/task-manager-docker /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx   # nunca "restart"
```

O vhost do apex (`sites-available/task-manager-project`) **não foi
tocado**.

> Nota posterior (13/08/2026): aquele arquivo não existe mais como vhost
> ativo. Ele continha o apex e o admin no mesmo lugar e foi dividido em
> `sites-available/portfolio` e `sites-available/atlas-manager`, um por
> domínio. Ver `deploy-container-no-atlas.md` §11.

---

## 3. Decisões e porquês

- **Porta 3002, não 3001**: mesmo com o PM2 já removido (liberando a
  3001), optei por uma porta diferente porque o vhost do apex — que não
  devia ser tocado — continua fisicamente apontando para `3001`.
  Reaproveitar essa porta para o Docker faria o apex silenciosamente
  passar a servir o novo container sem nenhuma mudança de config
  visível, o que seria uma decisão de produto (o que fica no apex), não
  uma decisão técnica de infraestrutura.
- **`HOST=0.0.0.0` dentro do container**: o `server.js` do task-manager
  usa `process.env.HOST || '127.0.0.1'` como bind. Sem essa variável, o
  processo escuta só no loopback _interno_ do container — que o
  `docker run -p 127.0.0.1:3002:3001` do host **não alcança** (o
  port-forward do Docker entra pela interface de rede do container, não
  pelo loopback dele). Isso não enfraquece a exposição: quem decide o
  que é alcançável de fora continua sendo o `-p 127.0.0.1:...` do lado
  do host, que segue restrito a loopback.
- **Sem volumes**: confirmado na Fase 1 que não há nada em disco além do
  código — sessões vivem no MongoDB Atlas via `connect-mongo`.
- **Sem rede Docker customizada nem labels**: o Atlas Manager não faz
  nenhum tipo de auto-discovery (nem por label, nem por rede, nem por
  prefixo de nome) — o único vínculo entre o Atlas Manager e o
  container é o `externalResourceId` (`task-manager-docker`) declarado
  manualmente em `REGISTERED_SERVICES_JSON`, usado literalmente como
  argumento posicional em `docker container inspect/stats/logs/start/
stop/restart <target>`. Por isso o nome do container só precisa ser
  fixo e estável — não precisa de rede nem label nenhuma.
- **Mesmo `id` (`task-manager`) na troca do registro**: manter uma
  entrada `pm2` apontando para um processo que não existe mais não
  serviria a nada; reaproveitar o `id` evita duas entradas concorrentes
  para "o mesmo" serviço lógico.
- **`X-Forwarded-Proto https` fixo (não `$scheme`)**: o TLS é terminado
  no Cloudflare — o nginx local só fala HTTP puro na porta 80.
  `$scheme` sempre resolveria para `http`, o que faria a aplicação
  gerar URLs incorretas caso dependa desse header.
- **`real_ip_header CF-Connecting-IP` + `set_real_ip_from 127.0.0.1`**:
  quem conecta no nginx é sempre o `cloudflared` local (loopback); o IP
  real do visitante chega no header `CF-Connecting-IP`, que o
  `real_ip_header` promove para `$remote_addr`/logs.

---

## 4. Caminho da requisição

```
Visitante
   │  HTTPS (TLS terminado aqui)
   ▼
Cloudflare Edge
   │  CF-Connecting-IP: <ip real>
   ▼
Cloudflare Tunnel (cloudflared, systemd, no próprio Atlas)
   │  ingress rule: hostname → http://localhost:80
   ▼
nginx (127.0.0.1:80)
   │  server_name task.gustavopinto.dev.br
   │  real_ip_header promove CF-Connecting-IP
   │  proxy_pass → http://127.0.0.1:3002
   ▼
Docker (port-forward 127.0.0.1:3002 → container:3001)
   ▼
task-manager-docker (node:26-alpine, HOST=0.0.0.0, PORT=3001)
   │
   ▼
MongoDB Atlas (externo, via CONNECTION_STRING)
```

O Atlas Manager fica **fora** desse caminho de requisição — ele só
controla o container por fora (`docker container start/stop/restart/
logs/inspect`), nunca fica no meio do tráfego HTTP da aplicação.

---

## 5. Rollback para PM2

Não existe `ecosystem.config.js` nem um `dump.pm2` antigo para
restaurar (foi sobrescrito por `pm2 save --force` com uma lista vazia).
Recriar o processo exige um `pm2 start` manual equivalente ao original:

```bash
export PM2_HOME=/var/lib/pm2-task-manager
cd /home/guga/apps/task-manager-project/app
docker compose down          # libera a porta 3001 se for reusá-la, opcional
pm2 start server.js --name task-manager
pm2 save --force
```

Depois de recriado, reverter o registro do Atlas Manager
(`/etc/atlas-manager/atlas-manager.env`, restaurar o backup
`atlas-manager.env.backup-20260811-220841` ou editar
`REGISTERED_SERVICES_JSON` de volta para `managementAdapter: "pm2"`,
`externalResourceId: "task-manager"`) e reiniciar
`atlas-manager.service`.

O container Docker pode continuar existindo em paralelo (porta 3002)
sem interferir no PM2 (porta 3001) — as duas formas não competem por
porta nem por qualquer outro recurso exclusivo.

---

## 6. Resultado da Fase 4 — funções Docker do Atlas via CLI

Todos os comandos testados contra `task-manager` (adapter `docker`),
autenticados via `ATLAS_BASE_URL=https://admin.gustavopinto.dev.br`
(caminho real, através do Cloudflare) mais um par
`CF_ACCESS_CLIENT_ID`/`CF_ACCESS_CLIENT_SECRET` (Cloudflare Access
service token).

| Comando                               | Esperado                                                 | Real                                                                                 |
| ------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `atlas services list`                 | Lista incluindo `task-manager`, `managementKind: docker` | ✅ Igual ao esperado                                                                 |
| `atlas services status task-manager`  | Status `running`, refletindo o container real            | ✅ Igual ao esperado                                                                 |
| `atlas services logs task-manager`    | Linhas de stdout/stderr do `docker container logs`       | ✅ Retornou exatamente as linhas de boot (`Database connected`, `Server running...`) |
| `atlas services restart task-manager` | `result: completed`, container reiniciado de verdade     | ✅ Confirmado via `docker ps` (uptime resetado)                                      |
| `atlas services stop task-manager`    | `result: completed`, container parado                    | ✅ Confirmado via `docker ps -a` (`Exited (137)`)                                    |
| `atlas services start task-manager`   | `result: completed`, container rodando de novo           | ✅ Confirmado via `docker ps`                                                        |

### O que falhou / bloqueou no caminho

- **CLI sem credenciais não funciona nem localmente no próprio Atlas**:
  `http://127.0.0.1:3000` (porta interna do Atlas Manager) sempre bate
  na validação de `Host` do envelope de segurança
  (`administrative_host_rejected`, mapeado para `infrastructure_
unavailable` genérico pelo CLI), porque o `Host` que o `fetch` monta a
  partir de `ATLAS_BASE_URL` nunca bate com `ADMINISTRATIVE_PUBLIC_
ORIGIN` (`admin.gustavopinto.dev.br`, sem porta). Não existe nenhuma
  opção de CLI para sobrescrever o header `Host` separadamente da URL de
  conexão — a única forma de o CLI funcionar é indo pelo caminho real
  (`https://admin.gustavopinto.dev.br`, através do Cloudflare).
- **Um Cloudflare Access service token válido não implica identidade
  reconhecida pelo Atlas Manager**: o primeiro token criado teve o
  secret perdido antes de ser anotado; um segundo token foi criado, mas
  mesmo aceito pelo Cloudflare Access (`CF-Access-*` presente), o Atlas
  Manager respondeu `administrative_access_denied` até o novo
  `clientId` ser explicitamente adicionado a
  `ADMINISTRATIVE_SERVICE_TOKEN_PRINCIPALS`. Isso é o comportamento
  documentado do ADR-034 funcionando como projetado — não é um bug —
  mas é uma fricção operacional real que qualquer pessoa testando o CLI
  pela primeira vez vai encontrar.
- **`atlas services status` não expõe CPU/memória/uptime** — só o
  `status` (`running`/`stopped`/etc.). Ver gap correspondente na Fase 5
  (rota `/resources` sem comando de CLI).

---

## 7. Resultado da Fase 5 — auditoria rotas × CLI (domínio `services`)

Escopo: as 15 rotas de `/admin/services/*` (as únicas relevantes a
Docker/serviços registrados) do `ADMINISTRATIVE_ROUTE_SECURITY_CATALOG`,
cruzadas com `src/cli/http-transport.ts` e `src/cli/command-tree.ts`.

| Rota                                           | Comando CLI                                               | Status                                                                                                                                                                 |
| ---------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /admin/services`                          | `services list`                                           | OK                                                                                                                                                                     |
| `GET /admin/services/:id`                      | `services status`                                         | OK                                                                                                                                                                     |
| `GET /admin/services/:id/logs`                 | `services logs`                                           | OK                                                                                                                                                                     |
| `GET /admin/services/:id/resources`            | **nenhum**                                                | **Órfã** — rota existe na API (CPU/mem/uptime via `docker stats`), sem nenhum comando de CLI                                                                           |
| `POST /admin/services/:id/actions/start`       | `services start`                                          | OK                                                                                                                                                                     |
| `POST /admin/services/:id/actions/stop`        | `services stop`                                           | OK                                                                                                                                                                     |
| `POST /admin/services/:id/actions/restart`     | `services restart`                                        | OK                                                                                                                                                                     |
| `GET /admin/services/:id/availability`         | **nenhum**                                                | **Órfã** — leitura da disponibilidade efetiva + override manual, sem equivalente direto no CLI                                                                         |
| `PUT /admin/services/:id/availability`         | **nenhum**                                                | **Órfã** — não há como setar um override manual de disponibilidade via CLI                                                                                             |
| `DELETE /admin/services/:id/availability`      | **nenhum**                                                | **Órfã** — não há como remover um override manual via CLI                                                                                                              |
| `GET /admin/services/:id/availability/preview` | `services schedule preview` (**sem** `--policy`)          | Parcial — funciona, mas o nome do comando (`schedule preview`) não deixa claro que, sem `--policy`, ele na verdade lê `/availability/preview`, não `/schedule/preview` |
| `GET /admin/services/:id/schedule`             | `services schedule show`                                  | OK                                                                                                                                                                     |
| `PUT /admin/services/:id/schedule`             | `services schedule set` / `always` / `manual` / `disable` | OK                                                                                                                                                                     |
| `DELETE /admin/services/:id/schedule`          | `services schedule remove`                                | OK                                                                                                                                                                     |
| `GET /admin/services/:id/schedule/preview`     | `services schedule preview` (**com** `--policy`)          | OK                                                                                                                                                                     |

**Resumo**: 4 rotas órfãs (`resources`, e as 3 variantes de
`availability` sem preview), 1 rota coberta de forma ambígua
(`availability/preview`, escondida dentro de `schedule preview`), 10
rotas com cobertura direta e clara. Nenhum comando do CLI aponta para
uma rota inexistente (nenhum "CLI órfão" na direção contrária).

`/availability` (override manual + leitura efetiva) e `/schedule`
(política recorrente persistida) são conceitos relacionados mas
distintos no domínio — a ausência de comandos de CLI para `/availability`
fora do preview parece uma lacuna real, não uma omissão intencional,
já que o dashboard web expõe os três verbos normalmente.

---

## 8. Pendências

- **Trocar a senha de sudo do usuário `guga`** — vazou de forma legível
  durante a depuração do parsing de `~/.env.operator` nesta sessão.
- **Decidir o destino do apex `gustavopinto.dev.br`** — hoje aponta
  para a porta 3001 (PM2, removido), retornando 502. Não foi tocado por
  instrução explícita, mas segue quebrado até uma decisão (portfólio,
  redirecionar para `task.gustavopinto.dev.br`, ou apontar para a porta
  3002 do Docker).
- **Service tokens Cloudflare Access criados durante os testes**
  (`112455d1a9050bf3ba16fa8ec74ef931.access`, cujo secret se perdeu, e
  `e85ee8b7f638d1550fcd2b62897f11e6.access`, usado nos testes da Fase 4) — por decisão do operador, ficam ativos para uso em testes
  futuros do CLI, sem revogação por enquanto.
- ~~**Falta o último passo do lado Cloudflare: adicionar o Public
  Hostname `task.gustavopinto.dev.br` pelo painel Zero Trust.**~~
  **Resolvido** — verificado em 13/08/2026:
  `https://task.gustavopinto.dev.br` responde `200`. O registro do
  diagnóstico original fica abaixo, porque a armadilha do túnel gerenciado
  remotamente continua valendo para o próximo hostname. O
  registro DNS já foi criado (`cloudflared tunnel route dns
eeb35f4f-979c-49fd-9ef3-75a04ca96928 task.gustavopinto.dev.br`,
  confirmado propagado — resolve para os mesmos IPs anycast de
  `admin.gustavopinto.dev.br`). Mas esse túnel é **gerenciado
  remotamente** pelo Cloudflare: o `credentials-file` em
  `/home/guga/.cloudflared/` é um token de conector (não uma chave de
  túnel local), e o log do `cloudflared` na inicialização mostra que
  ele carrega o `ingress` de um lugar diferente do
  `/etc/cloudflared/config.yml` local — uma edição feita nesse arquivo
  durante esta sessão (adicionando a entrada de `task.gustavopinto.
dev.br`) foi **silenciosamente ignorada** e depois revertida, porque
  não tinha efeito nenhum. Para essa rota funcionar, é preciso entrar
  em **Zero Trust → Networks → Tunnels → (o túnel) → Public Hostname →
  Add a public hostname**, preenchendo `task.gustavopinto.dev.br` →
  `HTTP` → `localhost:80` (mesmo destino dos outros dois hostnames já
  configurados lá). Isso não pode ser feito por mim — exige acesso ao
  painel, que não tenho.
- **Rotas órfãs da Fase 5** (`/resources` e `/availability` sem
  preview) — ficam documentadas aqui; nenhuma mudança de código foi
  feita, conforme regra geral da tarefa.
- **`src/service-management/domain/docker-container-details.ts`** foi
  removido numa sessão anterior por falta de uso — não afeta esta
  migração, mencionado aqui só para contexto de quem for ler o histórico
  do repositório.
