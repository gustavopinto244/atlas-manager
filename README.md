# Atlas Manager

## O que é

Atlas Manager é uma aplicação auto-hospedada para monitorar, administrar e
automatizar o servidor de homelab Atlas. Ela reúne informações de saúde do
host e operações administrativas controladas para os serviços cadastrados.

## Como funciona

O Atlas Manager é executado no host Atlas como o serviço de sistema
`atlas-manager.service`. A aplicação expõe uma interface HTTP/API e recebe sua
configuração de um arquivo próprio. O processo principal não executa como root;
quando uma função privilegiada for aplicável, ela permanece separada do
processo principal por uma fronteira operacional específica.

## Como usar

Os comandos abaixo são para a instalação no host Atlas. Execute-os no próprio
host ou em uma sessão SSH autorizada.

### Status do Atlas Manager

```bash
systemctl status atlas-manager.service --no-pager
```

Para verificar se o serviço está habilitado para iniciar com o sistema e se
está ativo neste momento:

```bash
systemctl is-enabled atlas-manager.service
systemctl is-active atlas-manager.service
```

### Iniciar

```bash
sudo systemctl start atlas-manager.service
```

### Parar

```bash
sudo systemctl stop atlas-manager.service
```

### Reiniciar

```bash
sudo systemctl restart atlas-manager.service
```

### Logs

```bash
journalctl -u atlas-manager.service
```

Para acompanhar novos registros:

```bash
journalctl -fu atlas-manager.service
```

### Health check

O serviço HTTP disponibiliza dois checks locais:

```bash
curl --fail http://127.0.0.1:3000/health/live
curl --fail http://127.0.0.1:3000/health/server
```

`/health/live` confirma que o processo HTTP está respondendo. `/health/server`
retorna as métricas de saúde do host coletadas pela aplicação.

### Interface / acesso HTTP

O listener padrão usa `127.0.0.1:3000`. No Atlas, os health checks podem ser
acessados localmente nos endereços acima. As rotas administrativas e o painel,
quando habilitados na configuração da instalação, ficam sob `/admin`.

No Vega, o serviço pode ser acessado em
[`https://gustavopinto.dev.br`](https://gustavopinto.dev.br). O acesso passa
pelo Cloudflare Tunnel e pelo Nginx do Atlas, que encaminha as requisições para
o listener local do Atlas Manager.

## Aplicações e serviços no host Atlas

A inspeção operacional confirmou os componentes abaixo. PM2 não está instalado
no Atlas neste momento.

| Aplicação/serviço | Gerenciado por                    | Função                                      |
| ----------------- | --------------------------------- | ------------------------------------------- |
| Atlas Manager     | systemd (`atlas-manager.service`) | Aplicação principal e API HTTP              |
| Nginx             | systemd (`nginx.service`)         | Proxy reverso local para o Atlas Manager    |
| Cloudflare Tunnel | systemd (`cloudflared.service`)   | Acesso do Vega ao endpoint público do Atlas |

## Configuração

O unit do systemd lê a configuração em:

```text
/etc/atlas-manager/atlas-manager.env
```

Os valores mais comuns são `HOST`, `PORT` e `LOG_LEVEL`. A instalação padrão
usa `HOST=127.0.0.1` e `PORT=3000`. Revise o arquivo de configuração antes de
alterar recursos administrativos ou serviços cadastrados.

## Documentação adicional

- [Visão do produto](docs/product-vision.md)
- [Requisitos](docs/requirements.md)
- [Arquitetura](docs/architecture.md)
- [Decisões de arquitetura](docs/adr/)
- [Ciclo de vida do serviço](docs/operations/atlas-manager-service-lifecycle.md)
