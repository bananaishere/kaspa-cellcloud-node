param(
    [Parameter(Mandatory)] [string]$InnoCompiler,
    [string]$NodeExe = (Get-Command node.exe).Source,
    [string]$CaddyExe = (Get-Command caddy.exe).Source,
    [Parameter(Mandatory)] [string]$NodeLicense,
    [string]$CaddyLicense = (Join-Path (Split-Path $CaddyExe) 'LICENSE'),
    [string]$MailKit
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$build = Join-Path $root ('.local/windows-build-' + [guid]::NewGuid().ToString('N'))
$payload = (New-Item -ItemType Directory (Join-Path $build 'payload') -Force).FullName
$app = (New-Item -ItemType Directory (Join-Path $payload 'app')).FullName
$runtime = (New-Item -ItemType Directory (Join-Path $payload 'runtime')).FullName

$nodeInfo = & $NodeExe -p 'process.platform + " " + process.arch + " " + process.versions.node.split(".")[0]'
if ($nodeInfo -ne 'win32 x64 24') { throw 'Use Node.js 24 for Windows x64.' }
Copy-Item -LiteralPath $NodeExe -Destination (Join-Path $runtime 'node.exe')
Copy-Item -LiteralPath $CaddyExe -Destination (Join-Path $runtime 'caddy.exe')
Copy-Item -LiteralPath $NodeLicense -Destination (Join-Path $runtime 'node-LICENSE.txt')
Copy-Item -LiteralPath $CaddyLicense -Destination (Join-Path $runtime 'caddy-LICENSE.txt')
foreach ($entry in 'lab','peer','protocol','scripts','src','vendor','viewer','package.json','pnpm-lock.yaml','LICENSE') {
    Copy-Item -LiteralPath (Join-Path $root $entry) -Destination $app -Recurse
}
$helper = (New-Item -ItemType Directory (Join-Path $app 'windows')).FullName
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'operator.mjs'),(Join-Path $PSScriptRoot 'mail.mjs') -Destination $helper

if (!$MailKit) {
    $MailKit = Join-Path $build 'kasmail-operator-testnet.zip'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://kasmail-cellcloud-nodes-bananalab360.vercel.app/kasmail-operator-testnet.zip' -OutFile $MailKit
}
$mailHash = '513d39463fa0519b891d0110f09aabb24e89a7d4a9e0efd877b00acd2bcbc835'
if ((Get-FileHash -LiteralPath $MailKit).Hash -ne $mailHash) { throw 'The k@sMail kit does not match the reviewed Testnet package.' }
$mailDirectory = Join-Path $app 'mail-kit'
Expand-Archive -LiteralPath $MailKit -DestinationPath $mailDirectory
& npm.cmd --prefix $mailDirectory ci --omit=dev --ignore-scripts --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Could not install the locked k@sMail dependencies.' }

& pnpm.cmd --dir $app install --prod --frozen-lockfile --ignore-scripts --config.node-linker=hoisted
if ($LASTEXITCODE -ne 0) { throw 'Could not install the locked runtime dependencies.' }
if (Get-ChildItem -LiteralPath $app -Recurse -Attributes ReparsePoint) { throw 'Packaging requires real files rather than junctions or links.' }

$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$desktop = Join-Path $payload 'CellCloudNode.exe'
$logo = Join-Path $PSScriptRoot 'assets/kaspa.png'
& $compiler /nologo /target:winexe /platform:x64 /reference:System.Web.Extensions.dll "/resource:$logo,CellCloud.NodeIcon.png" "/out:$desktop" (Join-Path $PSScriptRoot 'NodeWindow.cs')
if ($LASTEXITCODE -ne 0) { throw 'Could not compile the desktop assistant.' }

& $NodeExe (Join-Path $PSScriptRoot 'smoke.mjs') $payload $build
if ($LASTEXITCODE -ne 0) { throw 'The standalone payload failed its private node check.' }

& $InnoCompiler /Q "/DPayloadDir=$payload" "/O$build" (Join-Path $PSScriptRoot 'installer.iss')
if ($LASTEXITCODE -ne 0) { throw 'Could not compile the installer.' }
$installer = Join-Path $build 'CellCloud-Node-Testnet-Windows-x64.exe'
$hash = (Get-FileHash -LiteralPath $installer).Hash.ToLowerInvariant()
Set-Content -LiteralPath ($installer + '.sha256') -Encoding ascii -Value "$hash  CellCloud-Node-Testnet-Windows-x64.exe"
Write-Output $installer
