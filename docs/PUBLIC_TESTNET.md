# Join the public Testnet

The public app is **https://kaspacellcloud.vercel.app/#nodes**. Operators run their
own CellCloud storage processes. The app creator's computer is not a public node.
Mainnet uploads and payments remain disabled. Operation is voluntary; automated
operator rewards are not implemented.

## 1. Install the node

Install Node.js 24 and pnpm at the version in `package.json`, then:

```sh
git clone https://github.com/bananaishere/kaspa-cellcloud-node.git
cd kaspa-cellcloud-node
pnpm install --frozen-lockfile --ignore-scripts
pnpm verify
node bin/cellcloud-node.mjs init --out cellcloud-node.json
```

## 2. Make your endpoint reachable

Use a hostname you control, pointing to the machine running your node. It can be
your own computer or a host you operate. DNS, incoming connections and HTTPS must
work from other networks. A `localhost` address cannot be registered publicly.

Edit `cellcloud-node.json`, keeping the generated storage paths and quotas:

```json
{
  "network": "testnet-10",
  "host": "127.0.0.1",
  "port": 8080,
  "origins": ["https://kaspacellcloud.vercel.app"],
  "publicUrl": "wss://YOUR-HOSTNAME/peer",
  "reverseProxyTls": true,
  "tls": null
}
```

These are fields to change in the generated file, **not a complete replacement**.
Replace `YOUR-HOSTNAME`. For example, an operator using [Caddy](https://caddyserver.com/docs/quick-starts/https)
can proxy the local process with this Caddyfile:

```caddyfile
YOUR-HOSTNAME {
    reverse_proxy 127.0.0.1:8080
}
```

Use your hostname, allow the incoming ports needed by your HTTPS setup, and run
Caddy following its official installation instructions. WebSocket upgrades are
handled by the reverse proxy. Do not disable certificate validation or publish
the node's private key or upload token. Direct node TLS is also supported; see
[operator configuration](OPERATOR_NODE.md).

## 3. Start and check

```sh
node bin/cellcloud-node.mjs check --config cellcloud-node.json
node bin/cellcloud-node.mjs start --config cellcloud-node.json
```

The startup log shows the public `nodeId`. Copy it into `expectedNodeId` in the
configuration, then use a second terminal:

```sh
node bin/cellcloud-node.mjs doctor --config cellcloud-node.json
```

Keep the process running. A successful local diagnostic is not proof that another
network can reach it; the public app performs its own signed handshake.

## 4. Register once

Open the app's **Nodes → Register my node**. Enter your display name, WSS endpoint
and public `nodeId`. Save the profile, review the public-only confirmation and
use **Publish registration on GitHub**. Submit the resulting issue.

Alternatively use the repository's **Issues → New issue → Register Testnet node**
and paste the public JSON profile:

```json
{
  "version": 1,
  "networkId": "testnet-10",
  "name": "My community node",
  "url": "wss://YOUR-HOSTNAME/peer",
  "nodeId": "YOUR-64-CHARACTER-PUBLIC-NODE-ID"
}
```

Only these five fields are accepted. Never include seeds, private identity files,
upload tokens, passwords, backups or logs. No transaction or wallet is required
to register a node. This repository is public: the profile is public too.

## 5. Automatic visibility

Visitors' browsers collect open `[Testnet node]` registrations roughly every two
minutes, and check node availability every 30 seconds while the app is visible.
The app verifies the pinned node identity before marking it active. Closing the
registration removes this discovery entry on the next successful registry refresh;
already known neighbours may still advertise that node.

Registration is discovery, not a storage trust grant. It does not authorize
replication, uploads or payments. Uploads currently require the operator's private
upload authorization, shared privately with intended testers. Never put that code
in the issue. A node can be active for reads without accepting writes.

For serving app/site URLs, a separate publication-isolated HTTPS viewer is still
required; the node must allow its exact viewer origin templates. An entry marked
active proves a recent handshake, not retention or a completed external deployment.

The GitHub feed is an initial public contact channel, not a storage server. Known
nodes and their signed neighbour announcements can still be checked if that feed
is temporarily unavailable. Limits or feed outages are displayed separately from
node availability. The initial directory also remains available as another contact
source. Keep your node configuration and data backed up privately.

## Em português

Instala e inicia o nó na tua máquina, configura um endereço **WSS público** com
certificado válido e autoriza a origem `https://kaspacellcloud.vercel.app`. Na app,
abre **Nós → Registar o meu nó**, preenche nome, endereço e identidade pública e
publica o formulário no GitHub. A app recolhe o registo automaticamente e verifica
se o nó responde. Mantém o programa ligado. Não publiques o token, chaves ou backups.
