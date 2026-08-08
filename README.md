# Atlas Manager

## What it is

Atlas Manager is a self-hosted application for monitoring, managing, and
automating the Atlas homelab server. It brings together host health information
and controlled administrative operations for registered services.

## How it works

Atlas Manager runs on the Atlas host as the `atlas-manager.service` system
service. It exposes an HTTP/API interface and has its own configuration file.
The main process does not run as root; where applicable, privileged functions
remain separated from the main process through a dedicated operational boundary.

## How to use it

The commands below operate the installed application on the Atlas host. Run
them directly on the host or through an authorized SSH session.

### Atlas Manager status

```bash
systemctl status atlas-manager.service --no-pager
```

To check whether the service starts with the system and whether it is currently
active:

```bash
systemctl is-enabled atlas-manager.service
systemctl is-active atlas-manager.service
```

### Start

```bash
sudo systemctl start atlas-manager.service
```

### Stop

```bash
sudo systemctl stop atlas-manager.service
```

### Restart

```bash
sudo systemctl restart atlas-manager.service
```

### Logs

```bash
journalctl -u atlas-manager.service
```

To follow new log entries:

```bash
journalctl -fu atlas-manager.service
```

### Health checks

The HTTP service provides two local checks:

```bash
curl --fail http://127.0.0.1:3000/health/live
curl --fail http://127.0.0.1:3000/health/server
```

`/health/live` confirms that the HTTP process is responding. `/health/server`
returns host health metrics collected by the application.

### HTTP interface and access

The default listener uses `127.0.0.1:3000`. On Atlas, the health checks are
available locally at the addresses above. Administrative APIs remain under
`/admin/*`. The canonical dashboard, when enabled in the installed
configuration, is `https://admin.gustavopinto.dev.br/`; its assets are under
`/assets/*`.

From the Internet, the administrative flow is Cloudflare Access → Cloudflare
Tunnel → Nginx loopback → Atlas Manager `127.0.0.1:3000`. The dedicated
administrative hostname must use its own Cloudflare Access application and
policy. The primary domain may continue serving non-administrative endpoints.

## Applications and services on Atlas

Operational inspection confirmed the components below. PM2 is not installed on
Atlas at this time.

| Application/service | Managed by                        | Purpose                                  |
| ------------------- | --------------------------------- | ---------------------------------------- |
| Atlas Manager       | systemd (`atlas-manager.service`) | Main application and HTTP API            |
| Nginx               | systemd (`nginx.service`)         | Local reverse proxy for Atlas Manager    |
| Cloudflare Tunnel   | systemd (`cloudflared.service`)   | Vega access to the Atlas public endpoint |

## Configuration

The systemd unit reads its configuration from:

```text
/etc/atlas-manager/atlas-manager.env
```

Common settings are `HOST`, `PORT`, and `LOG_LEVEL`. The standard installation
uses `HOST=127.0.0.1` and `PORT=3000`. Review the configuration file before
changing administrative features or registered services.

## Additional documentation

- [Product vision](docs/product-vision.md)
- [Requirements](docs/requirements.md)
- [Architecture](docs/architecture.md)
- [Architecture decisions](docs/adr/)
- [Service lifecycle](docs/operations/atlas-manager-service-lifecycle.md)
