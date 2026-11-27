# CellCloud Node for Windows · Testnet-10

Use the x64 installer to run a fresh node in your Windows account. Node.js and
Caddy are included. The interface follows your Windows language (Portuguese or
English). Each mode has a separate storage directory and node identity. Existing
command-line nodes and community registrations are independent of this installer.
The right-hand guide has **Português** and **English** tabs. Open
**Step-by-step guide** for the public, private and mail walkthroughs.
The same guide is
[available in Portuguese](../docs/START_HERE.pt.md).

If you already run a node, use the **Existing node** tab or the
[instructions for an existing installation](../docs/PUBLIC_TESTNET.md#connect-an-existing-node).

## First run

1. Open **CellCloud Node (Testnet-10)** from Start. Pick **Private on this
   computer**, choose a folder and storage limit, and click **Start**.
2. Click **Check connection**. Use the displayed loopback address in your local
   CellCloud app. The private upload token remains in the local node folder.
3. While the node is running, minimize the window or click **X** to put it in the
   Windows notification area. Double-click the icon to reopen the window. The
   icon's menu includes **Stop node** and **Stop and exit**.
4. Optionally enable **Start when I sign into Windows** to start the node in the
   notification area at sign-in. Before updating, choose **Stop and exit**. An
   update or uninstall retains your data folder.

The desktop program manages one running node at a time. To keep a public and a
private node running on the same PC, use the program for one and the CLI for
the other, with separate data folders, identities and local ports.

## Public node, when you are ready

Choose **Public community node**, enter your own public hostname and review the
storage limit and public upload checkbox. The assistant starts Caddy with a
configuration for that hostname. You control DNS and external access to the HTTP
and HTTPS ports. No relay is configured. Check the endpoint from another network
before opening the prefilled GitHub registration. You review and submit the
registration yourself. For the separate mail service, use the k@sMail guide in
the app. [Public Testnet guide](../docs/PUBLIC_TESTNET.md)

When two or more compatible nodes are available, CellCloud can distribute
cells during a new public deployment. Enable wallet-authorized community
uploads to participate. Existing manually paired nodes keep their settings.

## Build

Use Windows x64, Node.js 24 x64, pnpm from `package.json`, the official Caddy
binary, .NET Framework and Inno Setup 6. Pass explicit runtime paths if needed.

```powershell
.\windows\build.ps1 -InnoCompiler 'C:\path\to\ISCC.exe' -NodeLicense 'C:\path\to\node\LICENSE'
```

The command prints the installer path and writes its SHA-256 alongside it.
The installer includes the pinned public k@sMail operator kit.
Use `-MailKit` to build from a copy of the same archive. The build verifies
the kit checksum before extracting it.

## Optional k@sMail

With a public node stopped, enable **k@sMail** and choose a different
local port from the file node. Start and select **Check k@sMail**, then
**Open mail registration**. The program configures `/kasmail/v1/` on the
existing HTTPS hostname and creates a separate mail identity and data
folder. Enable **Accept k@sMail on Cloudflare** to serve
`https://kasmail.ramalholab.workers.dev` on the same public route and local
mail port. Cloudflare uses a separate identity and storage folder. Existing
Vercel mailboxes still use their original identity and storage. With Cloudflare
enabled, the check and registration buttons refer to the Cloudflare profile.
The pilot still needs to approve that profile for delivery.

The test installer is unsigned. Keep local data, private configuration and
keys out of the release.
