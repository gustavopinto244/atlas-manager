# Colocar um container no ar no Atlas

Procedimento de ponta a ponta para publicar uma aplicação no servidor: dos
arquivos de configuração do Docker, passando pela entrega por `git push` para
um repositório bare no servidor, até a URL pública respondendo.

Preencha conforme o caso: `<app>` é o nome da aplicação, `<port>` a porta que
ela vai ocupar no loopback do host, `<container-port>` a porta em que ela
escuta dentro do container, e `<domain>` o domínio público.

Os comandos são escritos para serem rodados **de dentro do servidor**, já
conectado por SSH. O único passo que roda na sua máquina é o `git push` do
§5.2, e está marcado como tal.

---

## 1. Escopo e premissas

**Premissa de entrada:** a aplicação já é totalmente operacional em
desenvolvimento. Ela builda, roda, e você sabe em qual porta ela escuta e de
quais variáveis de ambiente precisa. Nada aqui trata de escrever a aplicação.

**Ponto de chegada:** um container rodando, sobrevivendo a reboot, acessível
em `https://<domain>`.

Fora do escopo:

- escrever ou depurar a aplicação;
- pipeline de CI (o CI do repositório da app, quando existe, roda testes e
  lint — não é ele quem publica no servidor);
- TLS — o certificado é terminado no Cloudflare; dentro do host só trafega
  HTTP puro em loopback.

---

## 2. Panorama do fluxo

Dois caminhos distintos, que é fácil confundir. O **caminho do deploy** só
acontece quando você publica; o **caminho da requisição** acontece a cada
visita.

### Caminho do deploy

```
Máquina local (repositório da app)
   │  git push production main
   ▼
~/apps/<app>/repo.git          ← repositório bare: o ponto de entrega
   │  git --git-dir=repo.git --work-tree=app checkout -f main
   ▼
~/apps/<app>/app               ← work-tree: o build context do Docker
   │  docker compose -f compose.production.yaml up -d --build
   ▼
Imagem <app>:local  →  container <app>  →  127.0.0.1:<port>
```

### Caminho da requisição

```
Visitante
   │  HTTPS (TLS terminado aqui)
   ▼
Cloudflare Edge
   │  CF-Connecting-IP: <ip real>
   ▼
Cloudflare Tunnel (cloudflared, systemd, no próprio host)
   │  ingress: hostname → http://localhost:80
   ▼
nginx do host (127.0.0.1:80)
   │  server_name <domain>  →  proxy_pass http://127.0.0.1:<port>
   ▼
Docker (port-forward 127.0.0.1:<port> → container:<container-port>)
   ▼
container <app>
```

---

## 3. Layout no servidor

Cada aplicação vive em dois diretórios irmãos:

```
~/apps/<app>/
├── repo.git/   # repositório bare — recebe os pushes
└── app/        # work-tree — o que o Docker lê como build context
```

Por que separar em vez de ter um único clone:

- **um bare repo aceita push a qualquer momento.** Empurrar para o branch
  que está checado out em um repositório normal é recusado pelo git
  (`receive.denyCurrentBranch`), justamente porque sobrescreveria o
  working tree por baixo de quem estiver usando;
- **o work-tree fica descartável.** Ele é uma projeção de um commit: pode
  ser apagado e recriado com um `checkout -f`, sem perder histórico;
- **o histórico fica fora do build context.** Sem `.git` dentro de `app/`,
  o `docker build` não tem como acidentalmente empacotar o repositório
  inteiro na imagem.

---

## 4. Configuração do Docker no repositório da app

Estes arquivos moram no **repositório da aplicação**, não neste repositório,
e devem ser **commitados**. Se eles só existirem no servidor, o deploy deixa
de ser reproduzível — e some junto se o diretório se perder.

### 4.1 `Dockerfile`

Build multi-stage: um estágio compila, outro só serve o resultado. O exemplo
abaixo é de um front-end que builda para arquivos estáticos; a lógica vale
para qualquer runtime.

```dockerfile
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build


FROM nginx:alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/ /usr/share/nginx/html/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1/ || exit 1
```

O que importa aqui:

- **`COPY package*.json` antes de `COPY . .`** — as camadas do Docker são
  cacheadas em ordem. Copiando só os manifests primeiro, o `npm ci` (o passo
  caro) só reexecuta quando as dependências mudam, não a cada alteração de
  código.
- **O estágio `runtime` não herda nada do `build`** além do que é copiado
  explicitamente com `--from=build`. Node, npm e `node_modules` ficam para
  trás — a diferença entre uma imagem final na casa de 100 MB e uma de 300 MB
  carregando o toolchain inteiro.
- **`HEALTHCHECK`** é o que faz `docker ps` mostrar `(healthy)` em vez de só
  `Up`. Sem ele, "o container está de pé" e "a aplicação responde" viram a
  mesma informação — e não são.
- **`EXPOSE` é documentação**, não publicação. Quem decide o que é alcançável
  a partir do host é o `ports:` do compose.

Para uma aplicação que serve a si mesma (um servidor Node, por exemplo), o
estágio `runtime` é o próprio runtime da linguagem e o final vira
`CMD ["node", "server.js"]` — o resto do raciocínio é idêntico.

### 4.2 `.dockerignore`

Define o que **não** entra no build context enviado ao daemon do Docker.

```
node_modules
dist
.git
.github
.vscode
.idea
*.log
.env
.env.*
Dockerfile*
compose*.yaml
compose*.yml
README.md
```

Por que cada grupo:

- **`node_modules` e `dist`** — são recriados dentro da imagem pelo `npm ci`
  e pelo `npm run build`. Copiá-los de fora não só desperdiça tempo como
  arrisca embarcar binários compilados para a arquitetura errada.
- **`.env` e `.env.*`** — o motivo mais importante. Sem essa linha, um
  `COPY . .` embute os segredos **dentro da imagem**, onde qualquer um com
  acesso ao registry ou ao arquivo de imagem consegue lê-los. Segredo entra
  em tempo de execução (`env_file`), nunca em tempo de build.
- **`.git`** — evita empacotar o histórico inteiro. No layout deste
  documento `app/` nem tem `.git`, mas a linha é barata e cobre o caso de
  quem usa a variante do §5.3(b).

Cuidado com o inverso: tudo o que o `Dockerfile` copia precisa **ficar de
fora** desta lista. `nginx.conf`, por exemplo, é copiado para o estágio
`runtime` — ignorá-lo faria o build falhar. `Dockerfile*` e `compose*` podem
ser ignorados justamente porque nada dentro da imagem os lê.

### 4.3 `nginx.conf` (apenas para front-end estático)

Este é o nginx **de dentro do container**, que serve os arquivos buildados.
Não confundir com o nginx do host (§7.1), que é o proxy reverso.

```nginx
server {
    listen 80;
    listen [::]:80;

    server_name _;
    server_tokens off;

    root /usr/share/nginx/html;
    index index.html;

    location /assets/ {
        try_files $uri =404;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location / {
        try_files $uri $uri/ $uri/index.html =404;
        add_header Cache-Control "no-cache";
    }

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types
        text/css
        application/javascript
        application/json
        image/svg+xml;
}
```

- **`server_name _;`** — catch-all. Quem decide qual domínio chega até aqui
  é o vhost do host; dentro do container não há disputa de nomes.
- **Duas políticas de cache opostas, de propósito.** Os arquivos em
  `/assets/` têm hash no nome (bundlers modernos geram `index-a1b2c3.js`):
  mudou o conteúdo, mudou o nome, então podem ser `immutable` por um ano. O
  `index.html` **não** tem hash — se ele for cacheado, o navegador continua
  pedindo os assets antigos depois de um deploy. Daí `no-cache` na rota
  genérica.
- **`try_files $uri $uri/ $uri/index.html =404`** — o que faz uma rota como
  `/sobre` funcionar quando o build emitiu `sobre/index.html`.

### 4.4 `compose.production.yaml`

```yaml
name: <app>

services:
  <app>:
    build:
      context: .
      dockerfile: Dockerfile
    image: <app>:local
    container_name: <app>
    restart: unless-stopped
    ports:
      - "127.0.0.1:<port>:<container-port>"
```

Campo a campo:

- **`name:`** — nomeia o projeto Compose. Sem ele o projeto herda o nome do
  diretório, e como todo mundo aqui mora em `.../app/`, dois projetos
  distintos apareceriam ambos como `app` em `docker compose ls`.
- **`container_name:` fixo** — não é cosmético. Esse nome costuma ser o
  **único vínculo** entre o container e qualquer coisa que o gerencie de fora
  (§8): ele vira argumento posicional em
  `docker container inspect/stats/logs/start/stop/restart`.
- **`image: <app>:local`** — dá um nome estável à imagem construída. Sem
  isso ela sai como `<projeto>-<serviço>`, e cada rebuild deixa a anterior
  pendurada como `<none>`.
- **`restart: unless-stopped`** — é o que faz o container voltar depois de um
  reboot do host. `always` também voltaria, mas ressuscitaria até um
  container que você parou de propósito.
- **`ports: "127.0.0.1:<port>:<container-port>"`** — o prefixo `127.0.0.1:`
  é a linha de segurança. Sem ele, o Docker publica em `0.0.0.0` e (por
  escrever direto no `iptables`) **contorna o UFW**: a aplicação fica
  exposta na rede local sem nenhuma regra de firewall aparecer alterada.

### 4.5 Escolher a porta

Antes de fixar a porta, veja o que já está ocupado:

```bash
ss -ltnp
```

Vale conferir também os vhosts existentes (§7.0): uma porta pode estar livre
**agora** e ainda assim ser o destino de um `proxy_pass` de algum vhost.
Nesse caso, ocupá-la faz aquele domínio passar a servir a sua aplicação sem
que nenhuma configuração de nginx mude. Dependendo do caso isso é justamente
o que você quer (§7.0) ou um acidente silencioso.

### 4.6 Aplicações com segredos

Se a app precisa de variáveis de ambiente sensíveis, o `.env` fica **no
servidor**, dentro de `app/`, fora do git e fora da imagem:

```yaml
services:
  <app>:
    env_file:
      - .env
    environment:
      - PORT=<container-port>
      - HOST=0.0.0.0
```

Como o `.env` não é rastreado pelo git, ele **sobrevive** ao
`git checkout -f` de cada deploy (§5.3) — o `-f` sobrescreve arquivos
versionados, não remove os que o git não conhece.

O `HOST=0.0.0.0` merece atenção: muitas aplicações fazem bind em `127.0.0.1`
por padrão, e dentro do container isso significa o loopback **do container**,
que o port-forward do host não alcança (o encaminhamento entra pela interface
de rede do container). Isso não afrouxa nada: quem controla a exposição
continua sendo o `127.0.0.1:` do lado do host.

---

## 5. Deploy por git

### 5.1 Criar o repositório bare (uma vez por aplicação)

```bash
mkdir -p ~/apps/<app>/app
git init --bare ~/apps/<app>/repo.git
```

`--bare` cria um repositório sem work-tree: só os objetos, refs e hooks. É
o que o torna um destino de push válido.

### 5.2 Remote de produção — **na sua máquina**

Este é o único passo que não roda no servidor. No repositório da aplicação,
na sua máquina local:

```bash
git remote add production <host>:apps/<app>/repo.git
git remote -v
git push production main
```

Sobre a URL `<host>:apps/<app>/repo.git`:

- **`<host>`** pode ser um alias do seu `~/.ssh/config` (com `HostName`,
  `User` e `IdentityFile`), e o git herda essa configuração inteira — não há
  credencial nenhuma para configurar no git.
- **`apps/<app>/repo.git`** é relativo ao home do usuário SSH. A forma
  absoluta equivalente é `ssh://<user>@<host>/home/<user>/apps/<app>/repo.git`.
- **`production`** é só um nome de remote. `origin` continua apontando para
  onde já apontava; os dois convivem, e ficam explícitos em `git remote -v` —
  que é o ponto: dá para ver de relance que aquele repositório tem um destino
  de produção próprio, separado do host de código.

O push para um bare nunca esbarra em `receive.denyCurrentBranch`, porque não
existe work-tree para ser sobrescrito.

### 5.3 Publicar o commit em `app/`

De volta ao servidor. O push atualizou `repo.git`, e **nada mais**. O `app/`
continua no commit anterior até ser atualizado explicitamente. Há duas
formas.

#### (a) Checkout a partir do bare — recomendada

```bash
git --git-dir="$HOME/apps/<app>/repo.git" \
    --work-tree="$HOME/apps/<app>/app" \
    checkout -f main
```

`--git-dir` diz onde está o histórico, `--work-tree` diz onde materializar
os arquivos. O `app/` fica sendo um diretório comum, **sem `.git`** — não é
um repositório, é a projeção de um commit.

Dois efeitos colaterais que confundem quem inspeciona o servidor depois:

- aparece um arquivo `index` **dentro do `repo.git`** — é o índice do git
  para esse work-tree, criado pelo primeiro checkout. Um bare "puro" não tem
  esse arquivo;
- aparece um `logs/HEAD` com entradas do tipo
  `checkout: moving from main to main`.

Ambos são esperados nesse arranjo.

O `-f` descarta modificações locais em arquivos versionados. Arquivos não
rastreados (o `.env`, por exemplo) são preservados.

Para conferir o estado a qualquer momento:

```bash
git --git-dir="$HOME/apps/<app>/repo.git" \
    --work-tree="$HOME/apps/<app>/app" \
    status --porcelain
```

Saída vazia = o `app/` bate exatamente com o commit.

#### (b) `app/` como clone, com remote apontando para o bare

Aqui `app/` **é** um repositório completo, com um remote local apontando para
o bare irmão:

```bash
# configuração (uma vez)
git -C ~/apps/<app>/app remote add production "$HOME/apps/<app>/repo.git"

# a cada deploy
git -C ~/apps/<app>/app pull production main
```

Repare que a URL do remote é um **caminho de arquivo**, não SSH: os dois
diretórios estão na mesma máquina.

Quando faz sentido: se você precisa editar e commitar **no servidor**, ou
quer `git log`/`git diff` disponíveis dentro de `app/`.

O custo é real. Como `app/` é um repositório de verdade, ele acumula estado
próprio, e um `git pull` pode conflitar com ele. O sintoma típico é um
`status` assim depois de alguém ter mexido direto no servidor:

```
## master
 M server.js
?? .dockerignore
?? Dockerfile
?? docker-compose.yml
```

Quando isso acontece, a configuração de deploy passa a existir **apenas
ali**, sem commit e sem backup. Na variante (a) isso é impossível por
construção: o que não estiver commitado simplesmente não chega ao servidor.

### 5.4 Automatizar com um hook `post-receive`

Para o checkout e o build acontecerem sozinhos a cada push, crie
`repo.git/hooks/post-receive`:

```sh
#!/bin/sh
set -e

GIT_REPO="$HOME/apps/<app>/repo.git"
APP_DIR="$HOME/apps/<app>/app"
BRANCH=main

while read -r _old _new ref; do
    [ "$ref" = "refs/heads/$BRANCH" ] || continue

    git --git-dir="$GIT_REPO" --work-tree="$APP_DIR" checkout -f "$BRANCH"
    cd "$APP_DIR"
    docker compose -f compose.production.yaml up -d --build
done
```

```bash
chmod +x ~/apps/<app>/repo.git/hooks/post-receive
```

Pontos não óbvios:

- **`--git-dir`/`--work-tree` explícitos são obrigatórios.** Dentro de um
  hook, o git exporta `GIT_DIR` no ambiente; sem sobrescrever, qualquer
  comando git rodado depois do `cd` continuaria mirando o bare.
- **O hook lê a lista de refs pelo stdin** (`<old> <new> <ref>`, uma linha
  por ref). O `while read` é o que evita reagir a um push de branch
  qualquer.
- **O hook roda como o usuário do SSH**, que precisa estar no grupo
  `docker`.
- **O push fica bloqueado até o build terminar**, com a saída do Docker
  aparecendo no terminal de quem empurrou. É a maior vantagem (você vê o
  erro na hora) e a maior desvantagem (um build lento prende o terminal).

---

## 6. Subir o container

```bash
cd ~/apps/<app>/app
docker compose -f compose.production.yaml up -d --build
```

- `--build` reconstrói a imagem antes de subir. Sem ele o Compose reaproveita
  a imagem existente e o deploy não muda nada;
- `-d` roda em background;
- o Compose já para e recria o container antigo — não é preciso `down` antes.

Conferir:

```bash
docker ps --filter name=<app>
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:<port>/
```

Espere `Up ... (healthy)` e `200`. Se o status ficar em `health: starting`
por muito tempo ou virar `unhealthy`, o `HEALTHCHECK` está falhando dentro
do container — `docker compose -f compose.production.yaml logs` mostra o
motivo.

Neste ponto a aplicação está no ar **no loopback do servidor** e mais nada. O
resto é exposição.

---

## 7. Expor publicamente

### 7.0 Quando a exposição já existe

Antes de escrever qualquer configuração, verifique se o caminho público já
não está pronto:

```bash
grep -Rn "proxy_pass" /etc/nginx/sites-enabled/
```

A saída é o mapa de portas do servidor:

```
sites-enabled/<app-a>:11:  proxy_pass http://127.0.0.1:3000;
sites-enabled/<app-b>:11:  proxy_pass http://127.0.0.1:3001;
sites-enabled/<app-c>:10:  proxy_pass http://127.0.0.1:3002;
```

Um arquivo por domínio, com o nome do arquivo igual ao serviço — é o que faz
essa saída ser lida como um mapa. Vale manter assim: para o nginx o nome do
arquivo não significa nada (§7.1), mas para quem lê, significa tudo.

**Use `-R`, não `-r`.** Tudo em `sites-enabled/` é symlink, e o `-r` do grep
não segue symlinks encontrados na recursão — ele devolve exit code 1 e
nenhuma linha, exatamente como se não houvesse vhost nenhum configurado. O
`-R` segue.

Se algum vhost já aponta para uma porta que ninguém está usando, **essa porta
é o deploy inteiro**. Publicar o container nela coloca o domínio no ar sem
`sudo`, sem `nginx -t`, sem reload e sem painel do Cloudflare. É o que
acontece quando um domínio já esteve no ar servindo outra coisa naquela
porta: ele fica devolvendo 502 até alguém voltar a escutar ali.

O outro lado dessa moeda é a armadilha do §4.5: uma porta "livre" pode ser o
destino de um vhost esquecido, e ocupá-la publica sua aplicação em um domínio
que você não escolheu. É a mesma mecânica — muda só se o resultado era o que
você queria.

### 7.1 nginx do host (proxy reverso) — domínio novo

Um arquivo por domínio em `/etc/nginx/sites-available/`, habilitado por
symlink em `sites-enabled/`:

```nginx
server {
    listen 127.0.0.1:80;
    listen [::1]:80;
    server_name <domain>;

    set_real_ip_from 127.0.0.1;
    set_real_ip_from ::1;
    real_ip_header CF-Connecting-IP;

    location / {
        proxy_pass http://127.0.0.1:<port>;
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
sudo ln -s /etc/nginx/sites-available/<app> /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

O que importa:

- **`listen 127.0.0.1:80`** — o nginx não escuta em interface externa
  nenhuma. Quem conecta nele é sempre o `cloudflared` local.
- **`nginx -t` antes, `reload` (nunca `restart`)** — o `-t` valida a sintaxe
  com o processo no ar; o `reload` troca a configuração sem derrubar
  conexão, enquanto `restart` derruba **todos** os sites do servidor por
  alguns instantes.
- **`X-Forwarded-Proto https` fixo, não `$scheme`** — o TLS morre no
  Cloudflare, então `$scheme` sempre resolveria para `http` e a aplicação
  geraria URLs erradas se confiar nesse header.
- **`set_real_ip_from` + `real_ip_header CF-Connecting-IP`** — sem isso, todo
  visitante aparece nos logs como `127.0.0.1`, que é o `cloudflared`. O IP
  real vem no header `CF-Connecting-IP`, e essas duas diretivas o promovem a
  `$remote_addr`. A diferença no `access.log`:

```
# sem real_ip
127.0.0.1   - - [13/Aug/2026:06:39:16] "GET / HTTP/1.1" 200

# com real_ip
2001:db8::1 - - [13/Aug/2026:07:28:24] "GET / HTTP/1.1" 200
```

**O nome do arquivo não significa nada para o nginx.** Um arquivo pode conter
vários `server` blocks e servir domínios que o nome não sugere; quem decide o
roteamento é só o `server_name`. Um arquivo por domínio, com nome igual ao do
serviço, é convenção para humanos — e é justamente por ser só convenção que
ela se degrada sozinha se ninguém mantiver.

### 7.2 Cloudflare Tunnel

O túnel roda como serviço systemd no próprio host e é o único caminho de
entrada — o servidor não tem porta aberta para a internet.

DNS:

```bash
cloudflared tunnel route dns <tunnel-id> <domain>
```

**A armadilha:** se o túnel for **gerenciado remotamente**, o
`credentials-file` local é um token de conector, e o `ingress` efetivo vem do
painel do Cloudflare, não do arquivo local. Editar
`/etc/cloudflared/config.yml` para acrescentar um hostname é
**silenciosamente ignorado**.

Um sintoma de que o arquivo local não manda: entradas duplicadas ou
inconsistentes no `ingress` dele que o `cloudflared` rejeitaria na validação
se de fato as estivesse usando.

O hostname precisa ser adicionado pelo painel:

> **Zero Trust → Networks → Tunnels → (o túnel) → Public Hostname → Add a
> public hostname**
>
> `<domain>` → `HTTP` → `localhost:80`

O destino é sempre `localhost:80` — o nginx do host — e não a porta do
container. É o `server_name` do vhost que separa um domínio do outro.

**A distinção é útil para diagnosticar:**

| O que você vê                 | Onde está o problema                           |
| ----------------------------- | ---------------------------------------------- |
| Erro de DNS                   | o registro DNS não existe                      |
| Erro 1033 / 404 do Cloudflare | falta o Public Hostname no painel              |
| 502 / 504                     | chegou no nginx; a porta de destino está vazia |
| 200                           | caminho completo funcionando                   |

Um 502, portanto, é boa notícia disfarçada: significa que DNS, túnel e nginx
já estão certos e só falta a aplicação escutando na porta.

---

## 8. Registrar no gerenciador de serviços (opcional)

Se o host tem um gerenciador que expõe status, logs e controle
(start/stop/restart) por dashboard ou CLI, registrar o container ali é o que
separa "está no ar" de "é operável sem SSH". Nem toda app precisa: para um
site estático que nunca é parado, o registro adiciona configuração sem
adicionar capacidade.

O padrão costuma ser declarar, na configuração do gerenciador, um id, um nome
legível, o tipo de adapter (`docker`) e **o nome do container**.

Três coisas que valem para qualquer gerenciador desse tipo:

- **O nome do container é o único vínculo.** Não há auto-discovery por label,
  rede ou prefixo: o nome declarado vira argumento posicional dos comandos
  `docker container …`. Se ele não bater com um container existente, o
  gerenciador simplesmente não encontra nada — e o erro raramente diz isso
  com clareza.
- **O usuário do gerenciador precisa enxergar o socket do Docker**, o que se
  resolve por grupo, não por `sudo` (uma regra de sudo que permita `docker`
  equivale a root irrestrito, porque `docker run` monta o filesystem do
  host):

  ```bash
  sudo usermod -aG docker <usuário-do-gerenciador>
  sudo systemctl restart <serviço-do-gerenciador>
  ```

  O `restart` é necessário por dois motivos: recarregar a configuração e
  adquirir o novo grupo suplementar — grupos são resolvidos na criação do
  processo, então o `usermod` sozinho não afeta um processo já rodando.

- **Valide a configuração antes de aplicar, e saiba o que acontece se ela
  estiver errada.** Se a unit do gerenciador tiver `Restart=no`, uma
  configuração inválida não derruba e recupera: o serviço fica no chão até
  alguém entrar por SSH. Faça backup antes, cheque `is-active` depois, e
  restaure automaticamente se não subir.

**Como confirmar que o registro pegou, sem credencial nenhuma.** Se o
gerenciador tem dashboard web atrás do mesmo nginx, o `access.log` mostra o
que o dashboard pediu — e ele só pede detalhes de um serviço que veio na
listagem:

```bash
grep -o "GET /admin/services[^ ]*" /var/log/nginx/access.log | sort | uniq -c
```

```
      4 GET /admin/services
      3 GET /admin/services/<app>/resources
```

Chamadas ao serviço novo voltando `200` provam duas coisas de uma vez: ele
entrou no catálogo, e o adapter está mesmo alcançando o container — rotas de
recurso leem CPU e memória via `docker stats`, então um nome de container
errado não responderia `200`.

---

## 9. Verificação end-to-end

Cada comando isola uma camada. Rodando na ordem, o primeiro que falhar
aponta onde o problema está.

| Comando                                                                              | Esperado         | Prova que…                              |
| ------------------------------------------------------------------------------------ | ---------------- | --------------------------------------- |
| `git --git-dir=…/repo.git --work-tree=…/app status --porcelain`                      | saída vazia      | o `app/` bate com o commit publicado    |
| `docker ps --filter name=<app>`                                                      | `Up … (healthy)` | o container subiu e o healthcheck passa |
| `curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:<port>/`                 | `200`            | o port-forward e a app respondem        |
| `curl -sS -o /dev/null -w "%{http_code}\n" -H "Host: <domain>" http://127.0.0.1:80/` | `200`            | o vhost do nginx casa com o domínio     |
| `curl -sS -o /dev/null -w "%{http_code}\n" https://<domain>/`                        | `200`            | DNS, Cloudflare e o túnel estão de pé   |
| `docker compose -f compose.production.yaml logs --tail 20`                           | sem erro         | a app não está falhando em silêncio     |

O `-H "Host: <domain>"` é o teste que mais economiza tempo: ele fala com o
nginx local fingindo ser o domínio real. Se esse passo dá `200` mas a URL
pública não, o problema está do lado do Cloudflare (DNS ou Public Hostname),
não no servidor.

Cuidado ao interpretar o resultado quando a app tem autenticação na frente:
um `401` ou `302` no lugar de `200` pode ser o comportamento correto. Capture
o código **antes** de mexer em qualquer coisa e compare com ele, em vez de
esperar `200` de tudo.

---

## 10. Redeploy e rollback

### Redeploy

```bash
# 1. na sua máquina
git push production main

# 2. no servidor
git --git-dir="$HOME/apps/<app>/repo.git" \
    --work-tree="$HOME/apps/<app>/app" \
    checkout -f main
cd ~/apps/<app>/app
docker compose -f compose.production.yaml up -d --build
```

Com o hook do §5.4 instalado, o passo 2 desaparece.

### Rollback

Deploy é `checkout` de um commit — voltar é apontar para outro:

```bash
git --git-dir="$HOME/apps/<app>/repo.git" \
    --work-tree="$HOME/apps/<app>/app" \
    checkout -f <sha-anterior>
cd ~/apps/<app>/app
docker compose -f compose.production.yaml up -d --build
```

O `<sha-anterior>` sai de
`git --git-dir="$HOME/apps/<app>/repo.git" log --oneline -10`. Como o
`checkout` é por SHA e não por branch, o `app/` fica em detached HEAD — o que
é irrelevante aqui, já que ele nunca é usado para commitar. O próximo
`checkout -f main` volta para a ponta.

Tirar do ar sem apagar nada:

```bash
cd ~/apps/<app>/app
docker compose -f compose.production.yaml down
```

---

## 11. Armadilhas conhecidas

- **`ports` sem o prefixo `127.0.0.1:`** — o Docker publica em `0.0.0.0` e
  escreve direto no `iptables`, passando por cima do UFW. A aplicação fica
  exposta na rede local e o firewall não acusa nada.
- **App que faz bind em `127.0.0.1` dentro do container** — o port-forward
  entra pela interface de rede do container, não pelo loopback dele. O
  container sobe, o `curl` do host dá connection reset. Solução:
  `HOST=0.0.0.0` no `environment`.
- **`.env` sem entrada no `.dockerignore`** — os segredos vão para dentro da
  imagem, em uma camada, onde continuam legíveis mesmo que o arquivo seja
  removido depois.
- **Porta que parece livre mas é destino de um `proxy_pass`** — ocupar a
  porta faz um domínio existente passar a servir a aplicação nova, sem
  nenhuma mudança visível de configuração. Confira os vhosts, não só o
  `ss -ltnp`.
- **`systemctl restart nginx` em vez de `reload`** — derruba todos os sites
  do servidor, não só o que você mexeu. E sempre `nginx -t` antes.
- **`X-Forwarded-Proto $scheme`** — atrás do Cloudflare isso sempre resolve
  para `http`, porque o TLS já terminou. Fixe em `https`.
- **Editar o `ingress` de `/etc/cloudflared/config.yml`** — em um túnel
  gerenciado remotamente, é ignorado sem erro nenhum. O hostname sai do
  painel Zero Trust.
- **Usuário de serviço fora do grupo `docker`** — nenhuma operação de
  container funciona, e o erro reportado raramente aponta para permissão. E
  não basta o `usermod`: sem reiniciar o serviço, o processo continua com os
  grupos antigos.
- **`docker compose up -d` sem `--build`** — reaproveita a imagem existente.
  O deploy "termina com sucesso" e a versão no ar continua a mesma.
- **Esquecer que o `checkout` é um passo separado** — o `git push` atualiza
  só o `repo.git`. Sem o `checkout -f`, o `app/` (e portanto o build) fica
  no commit anterior.
- **`grep -r` em `sites-enabled/`** — tudo ali é symlink e o `-r` não os
  segue: sai exit code 1 e nenhuma linha, indistinguível de "não há vhost
  configurado". Use `-R` (§7.0).
- **Confiar no nome do arquivo de vhost** — para o nginx ele não significa
  nada; quem roteia é o `server_name`.
- **Editar configuração de um serviço com `Restart=no`** — um erro de
  sintaxe não derruba e recupera: fica no chão até alguém entrar por SSH.
  Backup antes, `is-active` depois, restauração automática se não subir.
- **Conceder comandos de manipulação de arquivo via `sudoers` NOPASSWD** —
  `install`, `cp`, `ln`, `rm`, `tee` e `sed` equivalem a root quando passam
  por `sudo`, porque conseguem escrever em `/etc/sudoers.d`. Uma lista
  "fechada" que inclua qualquer um deles não está fechada.
