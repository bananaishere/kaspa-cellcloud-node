[Setup]
AppId=CellCloudNode.Windows.Testnet
AppName=CellCloud Node (Testnet-10)
AppVersion=0.2.0-testnet.14
AppPublisher=Kaspa CellCloud
DefaultDirName={localappdata}\Programs\CellCloud Node
PrivilegesRequired=lowest
AppMutex=Local\CellCloudNodeDesktop
ArchitecturesAllowed=x64compatible
DisableProgramGroupPage=yes
Compression=lzma2
SolidCompression=yes
OutputBaseFilename=CellCloud-Node-Testnet-Windows-x64

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"
Name: "pt"; MessagesFile: "compiler:Languages\Portuguese.isl"

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userprograms}\CellCloud Node (Testnet-10)"; Filename: "{app}\CellCloudNode.exe"

[Run]
Filename: "{app}\CellCloudNode.exe"; Description: "CellCloud Node"; Flags: nowait postinstall skipifsilent

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: none; ValueName: "CellCloudNode"; Flags: uninsdeletevalue
