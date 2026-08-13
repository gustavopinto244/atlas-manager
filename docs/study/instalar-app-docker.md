# Como instalar um app em container Docker sob o Atlas Manager

Guia genérico do fluxo para colocar uma aplicação, rodando em um container
Docker, sob gerenciamento do Atlas Manager (start/stop/restart, status,
logs, agendamento e disponibilidade via CLI e dashboard).

Este documento descreve o fluxo em geral. Para um caso real, completo, com
decisões e problemas encontrados no caminho, veja
[`migracao-task-manager-docker.md`](migracao-task-manager-docker.md).

---

## 1. O que o Atlas Manager faz (e o que não faz)

O Atlas Manager **não builda nem sobe containers**. Ele só controla
containers que já existem e já estão rodando no host, via CLI `docker`
(`docker container start/stop/restart/inspect/stats/logs <alvo>`). Quem cria
a imagem, sobe o container e mantém o `docker-compose.yml` (ou equivalente)
é a própria aplicação/operador — o Atlas Manager entra depois, como camada
de gerenciamento por cima de um container que já existe.

Não há nenhum tipo de auto-discovery: nenhuma rede Docker especial, label ou
convenção de nome é lida automaticamente. O único vínculo entre o Atlas
Manager e o container real é um campo declarado manualmente no registro do
serviço: `externalResourceId` (ver §4).

---

## 2. Pré-requisitos

- Docker instalado e funcionando no host.
- O usuário de sistema que roda o processo do Atlas Manager (ex.:
  `atlas-manager`) precisa conseguir falar com o daemon Docker — normalmente
  isso significa estar no grupo `docker`:

  ```bash
  usermod -aG docker atlas-manager
  systemctl restart atlas-manager.service
  ```

  O restart é necessário para que o novo grupo suplementar seja aplicado ao
  processo. Sem isso, qualquer comando Docker do Atlas Manager falha.
- O binário `docker` precisa estar no `PATH` do processo do Atlas Manager.
  Os comandos são executados diretamente (`execFile("docker", [...])`, sem
  `shell` e sem `sudo` embutido) — o processo precisa ter permissão própria,
  não herdada de um shell interativo.
- A aplicação já containerizada e rodando de forma independente (passo 3).

---

## 3. Containerizar a aplicação

Se a aplicação ainda não roda em Docker, o primeiro passo é criar a imagem
e subir o container normalmente, sem nenhuma dependência do Atlas Manager
nessa etapa.

**`Dockerfile`** mínimo (exemplo para uma app Node):

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

**`.dockerignore`** — importante para não embutir segredos (`.env`,
credenciais) dentro da imagem:

```
node_modules
.git
.env
npm-debug.log
```

**`docker-compose.yml`** (ou `docker run` equivalente), com o container
escutando **só em loopback** no host, mapeado para a porta interna da
aplicação:

```yaml
services:
  minha-app:
    build: .
    container_name: minha-app-docker
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

Dois pontos que costumam pegar quem containeriza pela primeira vez:

- **`HOST=0.0.0.0` dentro do container**: se a aplicação faz bind só em
  `127.0.0.1` por padrão, o `-p host:porta` do Docker não alcança o
  processo — o port-forward entra pela interface de rede do container, não
  pelo loopback interno dele. Isso não enfraquece a exposição: quem decide
  o que é alcançável de fora do host continua sendo o
  `127.0.0.1:porta:porta` do lado do host.
- **Escolha de porta**: se a aplicação já ocupava uma porta antes (ex.:
  rodando via PM2) e algum vhost de proxy reverso já aponta para essa porta,
  prefira uma porta nova para o container em vez de reaproveitar a antiga —
  isso evita que o container passe a responder silenciosamente no lugar do
  processo antigo, sem nenhuma mudança de configuração visível.

---

## 4. Nome do container = `externalResourceId`

O Atlas Manager identifica o container pelo campo `externalResourceId` do
registro do serviço (§5), usado literalmente como argumento posicional em
todos os comandos Docker (`node-docker-container-control-executor.ts` e
correlatos, em `src/service-management/infrastructure/`):

```bash
docker container start   <externalResourceId>
docker container stop    <externalResourceId>
docker container restart <externalResourceId>
docker container inspect <externalResourceId>
docker container stats   <externalResourceId>
docker container logs    <externalResourceId>
```

Por isso, `container_name` no `docker-compose.yml` (ou o `--name` no
`docker run`) precisa ser **fixo e estável** — o Atlas Manager não segue
renomeações nem recria o vínculo sozinho.

---

## 5. Registrar o serviço no Atlas Manager

O registro é feito pela variável de ambiente `REGISTERED_SERVICES_JSON`
(lida em
`src/service-management/infrastructure/environment-registered-service-catalog.ts`),
um array JSON com um objeto por serviço. Limites: até 65.536 bytes no total
e até 100 serviços.

Campos obrigatórios de cada entrada
(`CreateRegisteredServiceInput`, em
`src/service-management/domain/registered-service.ts`):

| Campo                 | Descrição                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| `id`                   | Identificador lógico do serviço no Atlas Manager (usado na CLI, ex.: `atlas services status <id>`). |
| `displayName`          | Nome amigável, exibido no dashboard.                                                           |
| `managementAdapter`    | `"docker"` para um único container (existe também `"docker-compose"` para quem gerencia via compose, e `"pm2"` para processos PM2). |
| `externalResourceId`   | Nome (ou ID) exato do container Docker — ver §4.                                               |
| `supportedOperations`  | Subconjunto de `["readStatus", "readLogs", "start", "stop", "restart"]`.                       |
| `availabilityPolicy`   | Política de disponibilidade agendada do serviço (ex.: `{ "mode": "manual" }`).                 |

Campos opcionais: `managementConfiguration`, `dependencies`,
`readinessPolicy`. Só os campos da lista de obrigatórios + opcionais são
aceitos — qualquer campo fora dessa lista invalida a entrada inteira.

Exemplo de entrada:

```json
{
  "id": "minha-app",
  "displayName": "Minha App",
  "managementAdapter": "docker",
  "externalResourceId": "minha-app-docker",
  "supportedOperations": ["readStatus", "readLogs", "start", "stop", "restart"],
  "availabilityPolicy": { "mode": "manual" }
}
```

Nota sobre `readinessPolicy`: o modo `"health"` (checagem de saúde via
Docker) só é aceito quando `managementAdapter` é `"docker"` ou
`"docker-compose"` — para `"pm2"` ou `"mock"` essa validação rejeita a
entrada.

Depois de editar `REGISTERED_SERVICES_JSON` (normalmente em
`/etc/atlas-manager/atlas-manager.env`), reinicie o serviço do Atlas Manager
para que a nova configuração seja carregada:

```bash
systemctl restart atlas-manager.service
```

---

## 6. Exposição pública (opcional)

Se a aplicação precisa ser acessível de fora do host, isso é uma
configuração de proxy reverso (nginx, Caddy, etc.) **independente** do
Atlas Manager — ele não participa do caminho de tráfego HTTP da aplicação,
só controla o container por fora. Veja a seção 2.5 e o diagrama de caminho
da requisição em
[`migracao-task-manager-docker.md`](migracao-task-manager-docker.md#4-caminho-da-requisição)
para um exemplo completo com nginx + Cloudflare Tunnel.

---

## 7. Verificar que funcionou

Com o serviço registrado e o Atlas Manager reiniciado, valide pela CLI:

```bash
atlas services list                    # deve listar o novo id, managementKind: docker
atlas services status <id>             # status refletindo o container real (running/stopped)
atlas services logs <id>               # stdout/stderr do "docker container logs"
atlas services restart <id>            # reinicia o container de verdade
atlas services stop <id>               # para o container
atlas services start <id>              # sobe o container de novo
```

Confirme cruzando com `docker ps` / `docker ps -a` no host, se necessário.

---

## 8. Referência

- Caso real, completo, com decisões e problemas encontrados:
  [`migracao-task-manager-docker.md`](migracao-task-manager-docker.md).
- Schema de registro: `src/service-management/domain/registered-service.ts`.
- Leitura da variável de ambiente:
  `src/service-management/infrastructure/environment-registered-service-catalog.ts`.
- Execução dos comandos Docker:
  `src/service-management/infrastructure/node-docker-container-control-executor.ts`,
  `docker-service-controller.ts`,
  `node-docker-container-inspect-executor.ts`,
  `node-docker-container-stats-executor.ts`.
