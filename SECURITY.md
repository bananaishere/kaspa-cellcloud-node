# Operator security

Start with Testnet-10 and non-essential test files. This is an experimental
storage runtime, without an independent production security audit.

- The node never needs your wallet seed or private spending key. It creates
  a separate storage identity on first start. Keep that identity and upload
  token private; share only the public endpoint and `nodeId`.
- Exact browser origins are an isolation rule, not authentication. Uploads
  additionally require the operator's grant. Public network enrolment and
  trustless operator rewards are not implemented.
- Use valid TLS for remote transport, explicit origins, pinned identities,
  storage quotas and an unprivileged operating-system account.
- Do not expose the data directory as static HTTP content or commit it.
  Review `.gitignore` and use a private configuration directory.
- Backups are not encrypted by the folder format. Store encrypted backups
  independently, and test restoration. Restored pending receipts cannot start
  another payment automatically.
- A second process must not share a live data directory. Remove a stale lock
  only after verifying the owning process has stopped.
- Node startup and `doctor` do not submit transactions. Any real wallet
  signature and explicit payment approval belongs to the user in the dApp.

The node can identify Mainnet but cannot accept Mainnet uploads/payments.
Do not bypass that protection by changing address prefixes or pool settings.
