# Kaspa CellCloud Node

**EXPERIMENTAL · TESTNET-10 ONLY · MAINNET PAYMENTS DISABLED**

Release: **v0.2.0-testnet.1**. Use tKAS and non-essential test files only.

Standalone Testnet-10 storage daemon for CellCloud operators. This repository
contains the node runtime, shared protocol, Kaspa WASM bindings and node tests.
It does not contain the React dApp, browser wallet extensions or laboratory data.

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

1. Start the node and obtain its public `nodeId` from the startup log. Set
   `expectedNodeId` in `cellcloud-node.json` to that value.
2. In CellCloud **Nodes**, enter its endpoint, e.g.
   `ws://127.0.0.1:8080/peer`, and pin the same public node ID.
3. For uploads, authorise the node with the private upload token from the data
   directory. The startup log prints its file path, never the token itself.
   Read-only viewers do not require that token.
4. For replication, configure mutually pinned `peers` in each operator's config.
   A neighbour is not discovered or authorised merely by installing this program.

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
operators. Public discovery, operator remuneration, retention contracts and a
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
