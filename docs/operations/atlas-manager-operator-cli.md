# Atlas Manager operator CLI package

The repository produces a small, reinstallable npm archive for the official
`atlas` CLI. It contains only the compiled CLI, the MIT license, and its
installation README; it does not contain the server, credentials, Cloudflare
Access assertions, or power helper.

Build it after the pinned application build:

```sh
source "$HOME/.nvm/nvm.sh"
nvm use 24.18.0
npm run build
npm run package:operator
```

The output is under `dist/operator-package/`:

- `atlas-manager-operator-cli-<version>.tgz` is the installable archive;
- `SHA256SUMS` binds the archive to its digest.

Install or reinstall on an operator workstation with:

```sh
npm install --global ./atlas-manager-operator-cli-<version>.tgz
atlas --help
```

The package requires Node.js 24 and communicates with the already protected
administrative HTTP boundary. It never fabricates Cloudflare Access headers or
turns an unauthenticated endpoint into an administrative endpoint. Commands
that are not implemented in the application command tree remain unavailable;
the package does not create shell aliases for them.

To remove the client:

```sh
npm uninstall --global @atlas-manager/operator-cli
```
