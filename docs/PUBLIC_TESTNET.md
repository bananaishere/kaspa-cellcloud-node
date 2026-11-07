# Join the public Testnet

**New operator? [Open the four-step in-app guide](https://kaspacellcloud.vercel.app/?operator-guide=1#nodes).**

The guide has commands to copy, configuration downloads, expected results and a
public-only support summary. Choose Install and connect my node on the Nodes page
to reopen it. Read the detailed reference below only when you need extra help.

## The short version

1. **Install:** Git, Node.js 24, pnpm 11.25.0, then clone and verify this repository.
2. **Prepare your endpoint:** use your own public hostname and HTTPS access. The
   app generates cellcloud-node.json and Caddyfile; save both in the node folder.
   Copy an existing configuration before replacing it. Do not run init over the download.
3. **Start and check:** keep the node and Caddy running. Run doctor in another
   terminal. Expect reachable:true, signedHandshake:true and network:testnet-10.
4. **Register:** copy the public nodeId into the guide, review the profile and
   submit the GitHub registration. It can take about two minutes to appear.

Registration does not require a wallet or payment. Running the software alone does
not configure your DNS/router. Active status is a fresh response, not a retention
guarantee. Mainnet remains disabled.

## Quick examples

| What you see | What it means | What to do |
| --- | --- | --- |
| verified:true | Package bytes match the source manifest | Continue to setup |
| mainnetPayments:false | Mainnet payments are disabled | Correct for this test |
| reachable:true and signedHandshake:true | The configured endpoint answered a verified handshake | Compare its public nodeId with startup |
| identityPinned:false on first setup | expectedNodeId is not set yet | Compare the two IDs, then save it in expectedNodeId |
| Registered, not responding | The profile exists but this browser did not get a valid response | Check process, DNS, certificate and allowed origin |
| Node active | A recent identity check succeeded | Keep it running; arrange separate upload/copy tests |

## Detailed setup

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

## Common questions

### Do I need to buy a VPS?

No specific hosting company is required. Use a machine you control with enough
disk space and a reachable HTTPS endpoint. Home networks may require DNS and port
forwarding; CGNAT or blocked incoming connections require a different reachable
network or network arrangement. The app does not change those settings for you.

### Is this Kaspa mining?

No. This is separate CellCloud storage software. A Kaspa miner or RPC node does
not become a CellCloud storage node automatically.

### Will I earn KAS for starting it?

Automated operator rewards are not implemented. This is voluntary Testnet testing.
Do not join on the assumption of income or promise permanent storage.

### Why do I still see zero nodes?

A node must be registered publicly and respond to the browser's signed handshake.
Saving a profile only in your browser does not publish it. Check that you submitted
the GitHub issue and left it open. Allow about two minutes for discovery, then the
next 30-second availability check. A registry outage is shown separately.

### How do I ask for help safely?

Use Copy support summary in the in-app guide. Add your operating system and exact
error. The summary contains only the step, network, valid public endpoint and public
node ID. Never send a seed, private key, upload token, full configuration or backup.

## Guia rápido em português

[Abrir o guia dentro da app](https://kaspacellcloud.vercel.app/?operator-guide=1#nodes).
Tem quatro passos, comandos para copiar e os resultados esperados:

1. Instalar e verificar o programa.
2. Indicar o teu hostname público e descarregar os dois ficheiros de configuração.
3. Iniciar o nó e o Caddy, mantendo-os ligados, e executar o diagnóstico.
4. Registar nome, endereço público e nodeId; rever e publicar o formulário GitHub.

Sem hostname/HTTPS pronto, podes fazer a instalação e pedir ajuda no passo 2.
Não precisas de carteira nem de pagar para registar um nó. O espaço e o processo
pertencem à tua máquina. Os testes de leitura, retenção e replicação são posteriores
ao registo. Não confundas ativo com armazenamento garantido.
