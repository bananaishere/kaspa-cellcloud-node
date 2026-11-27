# Kaspa CellCloud Node

**EXPERIMENTAL · TESTNET-10 ONLY · MAINNET PAYMENTS DISABLED**

Release: **v0.2.0-testnet.5**. Use tKAS and non-essential test files only.

Standalone Testnet-10 storage daemon for CellCloud operators. This repository
contains the node runtime, shared protocol, Kaspa WASM bindings and node tests.
It does not contain the React dApp, browser wallet extensions or laboratory data.

## Join the public Testnet

**[Start here — four-step guide in the app](https://kaspacellcloud.vercel.app/?operator-guide=1#nodes)** · **[Detailed guide and troubleshooting](docs/PUBLIC_TESTNET.md)**

**[Guia passo a passo em português](docs/START_HERE.pt.md)** · **[Windows installer guide](windows/README.md)** · **[Releases](https://github.com/bananaishere/kaspa-cellcloud-node/releases)**

**[Download the Windows x64 test installer](https://github.com/bananaishere/kaspa-cellcloud-node/releases/download/windows-testnet.13/CellCloud-Node-Testnet-0.2.0-testnet.13-Windows-x64.exe)** ·
[Release notes and SHA-256](https://github.com/bananaishere/kaspa-cellcloud-node/releases/tag/windows-testnet.13)

Run the node on your own machine. For a public node, configure a reachable WSS endpoint and register its profile once through the app or this repository's issue form. For private use, connect through the local app. The app
automatically collects registrations and checks which nodes are active. You do not
use the app creator's computer. A profile contains no upload token or private key.

## Public wallet uploads (no shared token)

Version **v0.2.0-testnet.4** adds opt-in wallet admission. Existing installations
remain private until their operator enables it. Follow the [one-time activation
and update instructions](docs/PUBLIC_TESTNET.md#public-wallet-uploads-no-shared-token).
Never publish your private upload token.

## Install and run

Requirements: Node.js **24.x**, and the pnpm version in `package.json`.

```sh
git clone https://github.com/bananaishere/kaspa-cellcloud-node.git
cd kaspa-cellcloud-node
pnpm install --frozen-lockfile --ignore-scripts
pnpm verify
node bin/cellcloud-node.mjs init --out cellcloud-node.json
node bin/cellcloud-node.mjs check --config cellcloud-node.json
node bin/cellcloud-node.mjs start --config cellcloud-node.json
```

`init` creates configuration only, refuses to overwrite an existing file and
does not create an identity or open a port. The default node listens only on
`127.0.0.1:8080`, with a new data directory and a 1 GiB disk quota.
Stop it with Ctrl+C. Restarting uses the same directory and identity.

## Connect it to the dApp

- **Public node:** Open **Nodes → Connect a public node** and complete the guide.
  Start the node behind a reachable WSS endpoint, pin its public `nodeId`
  in `expectedNodeId`, and register the public profile on GitHub.
  To accept public deployments, enable `publicUploads.enabled` in the node config.
  The dApp automatically selects a compatible node in **Deploy**. Users can
  authorize storage with KasWare, Kastle or Kaspire on Testnet-10.
- **Private node:** In the local app on your computer, connect your Testnet-10 wallet
  and open **Nodes → My private node**. Enter the local endpoint, check its
  identity and authorize with your private upload token. Keep the token private.
- **Replication:** Configure mutually pinned `peers` in each operator's config.
  Public registration helps the app discover nodes. It does not grant replication trust.

The node must stay online. A localhost address works only on its computer.
For remote access, use a reachable WSS endpoint with valid TLS, exact allowed
frontend origins and publication-isolated viewer origins. Installation does not
configure DNS, NAT, firewall ports or certificates and does not enrol the node
in a public network. See [operator configuration](docs/OPERATOR_NODE.md).

## Diagnostic and backup

```sh
node bin/cellcloud-node.mjs doctor --config cellcloud-node.json
node bin/cellcloud-node.mjs backup .local/cellcloud-node .local/private-backup-new
node bin/cellcloud-node.mjs restore .local/private-backup-new .local/private-restore-new
pnpm test
```

The template resolves paths relative to the configuration file. Use the actual
resolved `data` path shown by `check` if you move or edit that configuration.

`doctor` verifies the signed handshake, network and pinned identity without
reading wallet funds, uploading or submitting a payment. Restores go only into
a new directory and remain payment-verification-only until reconciled. A backup
contains private identity, grants and signed receipts: keep it private, encrypted
outside this repository. Never run a restored copy alongside its original as
if they had separate identities.

## What is implemented

- Disk storage of 128 KiB cells, Merkle checks, RS 10/30 reconstruction and quotas.
- Signed node identity, authenticated operator uploads and pinned peer replication.
- Independent Testnet payment verification and author-signed CREATE/UPDATE/ROLLBACK.
- Persistent receipts, restart recovery, fork rejection and private backups.

Mainnet uploads/payments remain disabled. Testnet support is not proof of a
production-ready public network. Kaspa RPC nodes/miners do not automatically
store CellCloud cells. Files are stored by CellCloud operators, not inside Kaspa
L1 blocks. Sending a payment to the configured pool does not automatically pay
operators. Operator remuneration, retention contracts and a
complete Proof of Retrievability incentive protocol are not provided here.

## Provenance and release status

`SOURCE_MANIFEST.json` identifies the source commit and SHA-256 of exported
files. The CLI runs the same source modules as the dApp repository, preserving
relative paths for the shared engine. No separate fork of payment rules is used.
`pnpm verify` checks the recorded bytes; it is not independent authentication
of a release. Git attributes preserve those bytes across Windows/Linux checkouts.

This is an experimental Testnet release. `private:true` prevents accidental npm
publication; it does not change the public GitHub repository. CellCloud's own
exported code is licensed under [MIT](LICENSE). The bundled Kaspa SDK retains
its ISC licence and provenance files under `vendor/kaspa`.

The same repository is intended to support both networks when Mainnet is ready.
For now Mainnet storage/payment operations remain blocked. Separate networks
must use separate operator configurations, data directories and peer links;
running both on one computer also requires separate listening ports. Changing
the network string does not enable Mainnet payments.

Read [SECURITY.md](SECURITY.md) before operating a node.
