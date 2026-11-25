using System;
using System.Collections.Generic;
using System.Collections;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

static class Program {
    [STAThread]
    static void Main(string[] args) {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        bool first;
        using (var mutex = new System.Threading.Mutex(true, @"Local\CellCloudNodeDesktop", out first)) {
            if (first) Application.Run(new NodeWindow(Array.IndexOf(args, "--start") >= 0));
        }
    }
}

sealed class NodeWindow : Form {
    const string Guide = "https://kaspacellcloud.vercel.app/?operator-guide=1#nodes";
    const string Repository = "https://github.com/bananaishere/kaspa-cellcloud-node";
    readonly bool pt = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "pt";
    readonly string home = AppDomain.CurrentDomain.BaseDirectory;
    readonly string settings = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CellCloudNode", "desktop.json");
    readonly JavaScriptSerializer json = new JavaScriptSerializer();
    readonly ComboBox mode = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList };
    readonly TextBox name = new TextBox(), domain = new TextBox(), folder = new TextBox();
    readonly NumericUpDown quota = new NumericUpDown { Minimum = 1, Maximum = 1024, Value = 1 };
    readonly NumericUpDown port = new NumericUpDown { Minimum = 1024, Maximum = 65535, Value = 8080 };
    readonly NumericUpDown mailPort = new NumericUpDown { Minimum = 1024, Maximum = 65535, Value = 8081 };
    readonly CheckBox uploads = new CheckBox { AutoSize = true }, startup = new CheckBox { AutoSize = true };
    readonly CheckBox mailEnabled = new CheckBox { AutoSize = true };
    readonly Button start = new Button(), stop = new Button(), check = new Button(), register = new Button();
    readonly Button replication = new Button();
    readonly Button checkMail = new Button(), registerMail = new Button();
    readonly Label status = new Label { AutoSize = true, MaximumSize = new Size(520, 0) };
    readonly TextBox details = new TextBox { ReadOnly = true, Multiline = true, ScrollBars = ScrollBars.Vertical, Height = 82 };
    Process node, proxy;
    string payload, publicProfile, mailProfile;
    bool working, closing;

    string L(string portuguese, string english) { return pt ? portuguese : english; }

    public NodeWindow(bool autoStart) {
        Text = "CellCloud Node · Testnet-10";
        ClientSize = new Size(650, 600);
        MinimumSize = new Size(625, 565);
        Font = new Font("Segoe UI", 10);
        StartPosition = FormStartPosition.CenterScreen;
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(20), ColumnCount = 2, AutoScroll = true };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 175));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        Controls.Add(layout);
        var title = new Label { Text = L("Configurar o teu nó", "Set up your node"), AutoSize = true, Font = new Font(Font.FontFamily, 19, FontStyle.Bold), Margin = new Padding(0, 0, 0, 12) };
        Full(layout, title);
        mode.Items.AddRange(new object[] { L("Privado neste computador", "Private on this computer"), L("Público da comunidade", "Public community node") });
        mode.SelectedIndex = 0;
        Row(layout, L("Tipo de nó", "Node type"), mode);
        Row(layout, L("Nome público", "Public name"), name);
        Row(layout, L("Domínio público", "Public hostname"), domain);
        folder.Text = Path.Combine(Path.GetDirectoryName(settings), "data");
        var browse = new Button { Text = L("Escolher…", "Browse…"), AutoSize = true, Dock = DockStyle.Right };
        browse.Click += (s, e) => { using(var dialog = new FolderBrowserDialog()) if(dialog.ShowDialog(this) == DialogResult.OK) folder.Text = dialog.SelectedPath; };
        var folderRow = new Panel { Height = 32 };
        folder.Dock = DockStyle.Fill;
        folderRow.Controls.Add(folder);
        folderRow.Controls.Add(browse);
        Row(layout, L("Pasta de dados", "Data folder"), folderRow);
        Row(layout, L("Espaço máximo (GiB)", "Storage limit (GiB)"), quota);
        Row(layout, L("Porta local", "Local port"), port);
        uploads.Text = L("Aceitar uploads da comunidade por carteira", "Accept wallet-authorized community uploads");
        startup.Text = L("Iniciar ao entrar no Windows", "Start when I sign into Windows");
        Full(layout, uploads);
        mailEnabled.Text = L("Ativar nó de correio k@sMail (opcional)", "Enable k@sMail node (optional)");
        Full(layout, mailEnabled);
        Row(layout, L("Porta local do correio", "Local mail port"), mailPort);
        Full(layout, startup);
        var actions = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill };
        foreach(var button in new[] { start, stop, check, register }) { button.AutoSize = true; actions.Controls.Add(button); }
        start.Text = L("Iniciar", "Start"); stop.Text = L("Parar", "Stop");
        check.Text = L("Verificar ligação", "Check connection"); register.Text = L("Abrir registo público", "Open public registration");
        Full(layout, actions);
        replication.Text = L("Replicação…", "Replication…");
        checkMail.Text = L("Verificar k@sMail", "Check k@sMail");
        registerMail.Text = L("Abrir registo de correio", "Open mail registration");
        var extraActions = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill };
        foreach (var button in new[] { replication, checkMail, registerMail }) { button.AutoSize = true; extraActions.Controls.Add(button); }
        Full(layout, extraActions);
        Full(layout, status);
        Full(layout, details);
        var links = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill };
        AddLink(links, L("Guia CellCloud", "CellCloud guide"), Guide);
        var walkthrough = new LinkLabel { AutoSize = true, Text = L("Passo a passo", "Step-by-step guide"), Margin = new Padding(3, 8, 14, 0) };
        walkthrough.LinkClicked += (s, e) => ShowWalkthrough();
        links.Controls.Add(walkthrough);
        AddLink(links, L("Configurar k@sMail", "Set up k@sMail"), Repository + "/blob/main/docs/PUBLIC_TESTNET.md");
        var logs = new LinkLabel { AutoSize = true, Text = L("Pasta do nó", "Node folder") };
        logs.LinkClicked += (s, e) => { if (Directory.Exists(folder.Text)) Open(folder.Text); };
        links.Controls.Add(logs);
        Full(layout, links);
        status.Text = L("Nó parado.", "Node stopped.");
        LoadSettings();
        using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run")) startup.Checked = key != null && key.GetValue("CellCloudNode") != null;
        startup.CheckedChanged += (s, e) => {
            using (var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run")) {
                if (startup.Checked) key.SetValue("CellCloudNode", Quote(Application.ExecutablePath) + " --start");
                else key.DeleteValue("CellCloudNode", false);
            }
        };
        mode.SelectedIndexChanged += (s, e) => RefreshButtons();
        mailEnabled.CheckedChanged += (s, e) => RefreshButtons();
        start.Click += async (s, e) => await Run(StartNode);
        stop.Click += async (s, e) => await Run(StopNode);
        check.Click += async (s, e) => await Run(CheckNode);
        register.Click += (s, e) => Register();
        checkMail.Click += async (s,e) => await Run(CheckMailNode);
        registerMail.Click += (s,e) => RegisterMailNode();
        replication.Click += async (s, e) => await Run(ManageReplication);
        FormClosing += async (s, e) => {
            if (closing || (node == null && !working)) return;
            e.Cancel = true;
            if (working) return;
            await Run(StopNode);
            if (node == null) { closing = true; Close(); }
        };
        RefreshButtons();
        if (autoStart) Shown += async (s, e) => await Run(StartNode);
    }

    void Full(TableLayoutPanel panel, Control control) {
        int row = panel.RowCount++;
        panel.Controls.Add(control, 0, row);
        panel.SetColumnSpan(control, 2);
        if (control is TextBox) control.Dock = DockStyle.Fill;
    }

    void Row(TableLayoutPanel panel, string label, Control field) {
        int row = panel.RowCount++;
        panel.Controls.Add(new Label { Text = label, AutoSize = true, Anchor = AnchorStyles.Left }, 0, row);
        field.Dock = DockStyle.Fill;
        panel.Controls.Add(field, 1, row);
    }

    static void Open(string target) { Process.Start(new ProcessStartInfo(target) { UseShellExecute = true }); }
    static string Quote(string value) { return "\"" + value + "\""; }

    void AddLink(FlowLayoutPanel panel, string title, string target) {
        var link = new LinkLabel { Text = title, AutoSize = true, Margin = new Padding(3, 8, 14, 0) };
        link.LinkClicked += (s, e) => Open(target);
        panel.Controls.Add(link);
    }

    void ShowWalkthrough() {
        using (var dialog = new Form { Text = L("Guia do operador · Testnet-10", "Operator guide · Testnet-10"),
            StartPosition = FormStartPosition.CenterParent, ClientSize = new Size(640,330), MinimumSize = new Size(590,335), Font = Font }) {
            var tabs = new TabControl { Dock = DockStyle.Fill };
            dialog.Controls.Add(tabs);
            GuidePage(tabs, L("Novo nó público", "New public node"), L(
                "1. Aponta o domínio para o teu IP público. Encaminha TCP 80 e 443 para o PC. Com dois routers, encaminha do primeiro para o IP WAN do segundo e do segundo para o PC. A porta 8080 fica local.\r\n\r\n" +
                "2. Escolhe Público da comunidade. Preenche nome, domínio e espaço. Marca Aceitar uploads da comunidade por carteira se quiseres receber deploys.\r\n\r\n" +
                "3. Usa Iniciar → Verificar ligação. Abre o domínio com dados móveis. Um 404 na raiz é normal se o HTTPS funcionar sem aviso. Em CGNAT, confirma com a operadora se a linha pode receber ligações públicas.\r\n\r\n" +
                "4. Usa Abrir registo público, submete o perfil público no GitHub e confirma o estado na página Nós. Mantém o programa ligado.",
                "1. Point the hostname at your public IP. Forward TCP 80 and 443 to the PC. With two routers, forward to the second router’s WAN IP first, then to the PC. Port 8080 stays local.\r\n\r\n" +
                "2. Choose Public community node. Set the name, hostname and storage limit. Enable wallet-authorized community uploads if you want to accept deployments.\r\n\r\n" +
                "3. Use Start → Check connection. Open the hostname over mobile data. A 404 at the root is expected if HTTPS works without a warning. If your line uses CGNAT, ask your ISP about public connections.\r\n\r\n" +
                "4. Use Open public registration, submit the public profile on GitHub and check the Nodes page. Keep the program running."), Guide);
            GuidePage(tabs, L("Já tenho um nó", "Existing node"), L(
                "1. No nó que já tens, usa Verificar ligação. Se o serviço corre no terminal, usa doctor com o ficheiro de configuração que ele já usa. Confirma a Testnet-10, o endereço WSS e o Node ID.\r\n\r\n" +
                "2. Se já registaste o nó, consulta o seu estado na página Nós, em Disponibilidade da rede. Para o primeiro registo, abre Ligar um nó público → Já tenho um nó e usa os dados públicos atuais.\r\n\r\n" +
                "3. Se quiseres aceitar deploys, ativa os uploads por carteira na configuração do teu nó e reinicia o serviço. Conserva a pasta de dados e a identidade. Uma instalação por terminal pode continuar a ser gerida por terminal.",
                "1. Use Check connection on the node you already run. If it runs in a terminal, use doctor with your service’s existing config file. Confirm Testnet-10, the WSS address and Node ID.\r\n\r\n" +
                "2. If your node is already registered, check it under Network availability. If this is the first registration, open Connect a public node → I already run a node and enter its current public details.\r\n\r\n" +
                "3. To accept deployments, enable wallet-authorized uploads in your node’s settings and restart the service. Keep the data folder and identity. A CLI installation can still be managed from the terminal."), Guide);
            GuidePage(tabs, L("Privado", "Private"), L(
                "1. Escolhe Privado neste computador. Define a pasta e o espaço.\r\n\r\n2. Usa Iniciar → Verificar ligação. Na app local, liga a carteira Testnet-10 e abre Nós → O meu nó privado. Confirma o endereço e o Node ID.\r\n\r\n3. Para autorizar uploads, abre Pasta do nó e procura private-testnet/storage/testnet-10/upload-token.private.json. Usa o token apenas na app local. Este modo funciona neste computador sem registo público.\r\n\r\nPara correr os dois modos em simultâneo, usa o programa para o nó público e o terminal para o privado. Usa pastas, Node IDs e portas diferentes.",
                "1. Choose Private on this computer. Set the folder and storage limit.\r\n\r\n2. Use Start → Check connection. In the local app, connect your Testnet-10 wallet and open Nodes → My private node. Verify the address and Node ID.\r\n\r\n3. To authorize uploads, open Node folder and find private-testnet/storage/testnet-10/upload-token.private.json. Use the token only in the local app. This mode works on this computer without public registration.\r\n\r\nTo run both modes at once, use the program for the public node and a terminal for the private node. Use separate folders, Node IDs and ports."), Guide);
            GuidePage(tabs, L("Replicação", "Replication"), L(
                "Este é um teste opcional. Combina-o com o outro operador. Cada um adiciona o endereço WSS e o Node ID do outro. Isto pode sincronizar outras publicações públicas confirmadas.\r\n\r\nUsa Parar → Replicação → Adicionar nó → Guardar → Iniciar. Depois abre Replicação, cola o ID do manifesto e usa Verificar cópia. Só testa uma falha depois de confirmares a cópia e preparares um link com ambos os nós.\r\n\r\nSe o RPC não encontrar um cabeçalho antigo, confirma se tens um RPC Testnet-10 sincronizado que retenha o histórico necessário. O campo avançado em Replicação permite indicar esse endereço.",
                "This is an optional test. Agree with the other operator. Each adds the other’s WSS address and Node ID. This can sync other confirmed public publications.\r\n\r\nUse Stop → Replication → Add peer → Save → Start. Then open Replication, paste the manifest ID and use Verify copy. Test an outage only after confirming the copy and preparing a link with both nodes.\r\n\r\nIf the RPC cannot find an old header, use a synced Testnet-10 RPC that retains the required history. The advanced Replication field can set that endpoint."), Guide);
            GuidePage(tabs, "k@sMail", L(
                "1. Com o nó parado, escolhe Público da comunidade e marca Ativar nó de correio k@sMail. A porta do correio tem de ser diferente da porta de ficheiros.\r\n\r\n2. Usa Iniciar → Verificar k@sMail. O programa cria a identidade de correio e verifica o endereço HTTPS /kasmail/v1/.\r\n\r\n3. Usa Abrir registo de correio e submete apenas o perfil público no GitHub. Aguarda a aprovação da identidade no piloto. A pasta de correio local contém dados privados.",
                "1. With the node stopped, choose Public community node and enable k@sMail. Use a different local port from the file node.\r\n\r\n2. Select Start → Check k@sMail. The program creates the mail identity and checks the /kasmail/v1/ HTTPS endpoint.\r\n\r\n3. Choose Open mail registration and submit only the public profile on GitHub. Wait for identity approval in the pilot. Keep the local mail folder private."), Guide);
            dialog.ShowDialog(this);
        }
    }

    void GuidePage(TabControl tabs, string title, string copy, string link) {
        var page = new TabPage(title) { Padding = new Padding(12) };
        var text = new TextBox { Text = copy, Multiline = true, ReadOnly = true, Dock = DockStyle.Fill, ScrollBars = ScrollBars.Vertical };
        var more = new LinkLabel { Text = L("Abrir página Nós", "Open the Nodes page"), Dock = DockStyle.Bottom, Height = 24 };
        more.LinkClicked += (s, e) => Open(link);
        page.Controls.Add(text);
        page.Controls.Add(more);
        tabs.TabPages.Add(page);
    }

    void LoadSettings() {
        if (!File.Exists(settings)) return;
        try {
            var values = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(settings));
            mode.SelectedIndex = (bool)values["isPublic"] ? 1 : 0;
            name.Text = (string)values["name"]; domain.Text = (string)values["hostname"];
            folder.Text = (string)values["folder"]; quota.Value = Convert.ToDecimal(values["quotaGiB"]);
            port.Value = Convert.ToDecimal(values["port"]); uploads.Checked = (bool)values["uploads"];
            if (values.ContainsKey("mailEnabled")) mailEnabled.Checked = (bool)values["mailEnabled"];
            if (values.ContainsKey("mailPort")) mailPort.Value = Convert.ToDecimal(values["mailPort"]);
        } catch { status.Text = L("Confirma os dados da configuração.", "Review your configuration."); }
    }

    void RefreshButtons() {
        bool idle = !working && node == null;
        foreach (var control in new Control[] { mode, folder.Parent, quota, port }) control.Enabled = idle;
        foreach (var control in new Control[] { name, domain, uploads }) control.Enabled = idle && mode.SelectedIndex == 1;
        start.Enabled = idle; stop.Enabled = check.Enabled = !working && node != null;
        register.Enabled = !working && node != null && publicProfile != null;
        replication.Enabled = !working && mode.SelectedIndex == 1;
        mailEnabled.Enabled = idle && mode.SelectedIndex == 1;
        mailPort.Enabled = mailEnabled.Enabled && mailEnabled.Checked;
        checkMail.Visible = registerMail.Visible = mode.SelectedIndex == 1 && mailEnabled.Checked;
        checkMail.Enabled = !working && node != null;
        registerMail.Enabled = !working && node != null && mailProfile != null;
    }

    async Task Run(Func<Task> action) {
        working = true;
        RefreshButtons();
        try { await action(); }
        catch (Exception error) { status.Text = L("Não foi possível concluir. Consulta os detalhes.", "Could not finish. Check the details."); details.Text = error.Message; }
        finally {
            if (node != null && node.HasExited) Cleanup();
            working = false;
            RefreshButtons();
        }
    }

    Process Helper(string command) {
        return Process.Start(new ProcessStartInfo(Path.Combine(home,"runtime","node.exe"), Quote(Path.Combine(home,"app","windows","operator.mjs")) + " " + command) {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true,
            RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
        });
    }

    void Send(Process process, string request) {
        var bytes = Encoding.UTF8.GetBytes(request + "\n");
        process.StandardInput.BaseStream.Write(bytes,0,bytes.Length);
        process.StandardInput.BaseStream.Flush();
    }

    async Task<Dictionary<string, object>> Request(string command, string request = null) {
        using (var process = Helper(command)) {
            var output = process.StandardOutput.ReadToEndAsync();
            var errors = process.StandardError.ReadToEndAsync();
            Send(process, request ?? payload);
            process.StandardInput.Close();
            await Task.WhenAll(output,errors);
            process.WaitForExit();
            if (process.ExitCode != 0) throw new InvalidOperationException(errors.Result);
            return json.Deserialize<Dictionary<string, object>>(output.Result);
        }
    }

    Dictionary<string, object> NodeSettings() {
        return new Dictionary<string, object> {
            {"isPublic", mode.SelectedIndex == 1}, {"name", name.Text.Trim()}, {"hostname", domain.Text.Trim().ToLowerInvariant()},
            {"folder", folder.Text.Trim()}, {"quotaGiB", (int)quota.Value}, {"port", (int)port.Value}, {"uploads", uploads.Checked},
            {"mailEnabled", mode.SelectedIndex == 1 && mailEnabled.Checked}, {"mailPort", (int)mailPort.Value}
        };
    }

    async Task StartNode() {
        bool isPublic = mode.SelectedIndex == 1;
        payload = json.Serialize(NodeSettings());
        var prepared = await Request("prepare");
        Directory.CreateDirectory(Path.GetDirectoryName(settings));
        File.WriteAllText(settings,payload);
        status.Text = L("A iniciar…", "Starting…");
        details.Text = "";
        var child = Helper("start");
        node = child;
        child.OutputDataReceived += (s,e) => {
            if (e.Data != null && e.Data.Contains("\"event\":\"listening\"")) BeginInvoke(new Action(() => {
                if (node == child && !working) status.Text = L("Nó a funcionar neste computador.", "Node running on this computer.");
            }));
        };
        child.ErrorDataReceived += (s,e) => {
            if (e.Data != null) BeginInvoke(new Action(() => { if (node == child) details.AppendText(e.Data + Environment.NewLine); }));
        };
        child.Exited += (s,e) => BeginInvoke(new Action(() => {
            if (node != child || working) return;
            Cleanup();
            status.Text = L("Nó parado. Consulta os detalhes se o arranque falhou.", "Node stopped. Check the details if startup failed.");
            RefreshButtons();
        }));
        child.EnableRaisingEvents = true;
        child.BeginOutputReadLine();
        child.BeginErrorReadLine();
        Exception failure = null;
        try {
            Send(child, payload);
            if (isPublic) {
                string state = (string)prepared["state"];
                var info = new ProcessStartInfo(Path.Combine(home,"runtime","caddy.exe"), "run --adapter caddyfile --config " + Quote(Path.Combine(state,"Caddyfile"))) {
                    UseShellExecute = false, CreateNoWindow = true, RedirectStandardError = true
                };
                info.EnvironmentVariables["XDG_DATA_HOME"] = Path.Combine(state,"tls");
                info.EnvironmentVariables["XDG_CONFIG_HOME"] = Path.Combine(state,"proxy-config");
                proxy = Process.Start(info);
                proxy.ErrorDataReceived += (s,e) => {
                    if (e.Data != null && e.Data.Contains("\"level\":\"error\"")) BeginInvoke(new Action(() => { if (node == child) details.AppendText(e.Data + Environment.NewLine); }));
                };
                proxy.BeginErrorReadLine();
            }
            if (child.HasExited) throw new InvalidOperationException(L("O nó terminou durante o arranque.", "The node exited during startup."));
            status.Text = L("A iniciar. Usa Verificar ligação para confirmar.", "Starting. Use Check connection to confirm.");
        } catch (Exception error) { failure = error; }
        if (failure != null) {
            await StopNode();
            throw new InvalidOperationException(failure.Message, failure);
        }
    }

    async Task StopNode() {
        if (node != null && !node.HasExited) {
            var child = node;
            child.StandardInput.Close();
            if (!await Task.Run(() => child.WaitForExit(15000))) throw new InvalidOperationException(L("O nó ainda está a terminar. Tenta novamente.", "The node is still stopping. Try again."));
        }
        Cleanup();
        status.Text = L("Nó parado.", "Node stopped.");
    }

    void Cleanup() {
        publicProfile = null;
        mailProfile = null;
        if (proxy != null) {
            try { if (!proxy.HasExited) proxy.Kill(); } catch (InvalidOperationException) { }
            proxy.Dispose();
            proxy = null;
        }
        if (node != null) { node.Dispose(); node = null; }
    }

    async Task CheckNode() {
        publicProfile = null;
        var report = await Request("diagnose");
        var profile = (Dictionary<string, object>)report["profile"];
        details.Text = (string)profile["url"] + Environment.NewLine + "Node ID: " + (string)profile["nodeId"];
        if (mode.SelectedIndex == 0) {
            status.Text = L("Nó privado ligado e identidade verificada. Usa este endereço na app local.", "Private node connected and identity verified. Use this address in the local app.");
        } else if ((bool)report["publicReachable"]) {
            status.Text = L("WSS verificado deste computador. Confirma também noutra rede antes de registar.", "WSS verified from this computer. Check from another network before registering.");
            publicProfile = json.Serialize(profile);
        } else {
            status.Text = L("Nó ligado neste PC. WSS ainda inacessível daqui. Confirma DNS, certificado, portas e router.", "Node running on this PC. WSS is not yet reachable from here. Check DNS, certificate, ports and router.");
        }
        var sync = report["replication"] as Dictionary<string, object>;
        if (sync != null) foreach (Dictionary<string, object> entry in (IEnumerable)sync["peers"]) {
            bool online = entry.ContainsKey("online") && (bool)entry["online"];
            bool pending = entry.ContainsKey("pending") && (bool)entry["pending"];
            string state = online ? (pending ? L("sincronização pendente", "sync pending") : L("sincronização em dia", "in sync")) : L("a aguardar ligação", "waiting for connection");
            details.AppendText(Environment.NewLine + entry["url"] + " · " + state);
        }
    }

    async Task ManageReplication() {
        var request = NodeSettings();
        var saved = await Request("replica-settings", json.Serialize(request));
        bool running = node != null;
        using (var dialog = new Form { Text = L("Replicação Testnet-10", "Testnet-10 replication"), StartPosition = FormStartPosition.CenterParent,
            ClientSize = new Size(690, 340), MinimumSize = new Size(630, 375), Font = Font, MinimizeBox = false, MaximizeBox = false }) {
            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(16), ColumnCount = 1, AutoScroll = true };
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            dialog.Controls.Add(layout);
            string help = running ? L("Para editar os nós, para primeiro o serviço. Para verificar uma publicação, cola o ID do manifesto abaixo.", "Stop the service before editing peers. Paste a manifest ID below to verify a copy.") :
                L("Adiciona apenas nós com o acordo dos operadores. Cada operador tem de adicionar o outro. A sincronização abrange publicações públicas já confirmadas, dentro dos limites do nó.",
                  "Add only peers whose operators agree. Each operator must add the other. Synchronization includes already confirmed public publications, within the node limits.");
            Full(layout, new Label { Text = help, AutoSize = true, MaximumSize = new Size(575, 0), Margin = new Padding(0,0,0,8) });
            var grid = new DataGridView { Dock = DockStyle.Fill, Height = 130, AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill,
                AllowUserToAddRows = false, AllowUserToDeleteRows = false, RowHeadersVisible = false, ReadOnly = running,
                SelectionMode = DataGridViewSelectionMode.FullRowSelect, MultiSelect = false };
            grid.Columns.Add("url", L("Endereço WSS", "WSS address"));
            grid.Columns.Add("nodeId", "Node ID");
            foreach (Dictionary<string, object> entry in (IEnumerable)saved["peers"]) grid.Rows.Add(entry["url"], entry["nodeId"]);
            Full(layout, grid);
            var feedback = new Label { AutoSize = true, MaximumSize = new Size(575, 0) };
            var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true };
            bool pending = false;
            dialog.FormClosing += (s, e) => e.Cancel = pending;
            if (running) {
                Full(layout, new Label { Text = L("ID do manifesto", "Manifest ID"), AutoSize = true });
                var manifest = new TextBox { MaxLength = 64 };
                Full(layout, manifest);
                var verify = new Button { Text = L("Verificar cópia", "Verify copy"), AutoSize = true };
                buttons.Controls.Add(verify);
                verify.Click += async (s, e) => {
                    pending = true;
                    verify.Enabled = false;
                    feedback.Text = L("A verificar…", "Checking…");
                    try {
                        request["manifestId"] = manifest.Text.Trim().ToLowerInvariant();
                        var result = await Request("replica-copy", json.Serialize(request));
                        feedback.Text = String.Format(L("Cópias com verificação assinada recente: {0} / {1}.", "Copies with a recent signed verification: {0} / {1}."), result["verified"], result["configured"]);
                    } catch (Exception error) {
                        feedback.Text = error.Message.Contains("MANIFEST_ID_REQUIRED") ? L("Introduz o ID completo do manifesto (64 caracteres).", "Enter the full manifest ID (64 characters).") :
                            L("Não foi possível verificar a publicação neste nó. Confirma o manifesto e o estado do pagamento.", "Could not verify the publication on this node. Check the manifest and payment status.");
                    } finally { pending = false; verify.Enabled = true; }
                };
            } else {
                Full(layout, new Label { Text = L("RPC Kaspa Testnet-10 (opcional, avançado)", "Kaspa Testnet-10 RPC (optional, advanced)"), AutoSize = true });
                var rpc = new TextBox { Text = (string)saved["rpcUrl"], MaxLength = 1024, AccessibleName = "RPC Testnet-10" };
                Full(layout, rpc);
                var add = new Button { Text = L("Adicionar nó", "Add peer"), AutoSize = true };
                var remove = new Button { Text = L("Remover da lista", "Remove from list"), AutoSize = true };
                var save = new Button { Text = L("Guardar", "Save"), AutoSize = true };
                buttons.Controls.AddRange(new Control[] { add, remove, save });
                add.Click += (s, e) => {
                    if (grid.Rows.Count >= 3) { feedback.Text = L("O limite é de três nós.", "The limit is three peers."); return; }
                    grid.CurrentCell = grid.Rows[grid.Rows.Add()].Cells[0];
                    grid.BeginEdit(true);
                };
                remove.Click += (s, e) => { if (grid.CurrentRow != null) grid.Rows.Remove(grid.CurrentRow); };
                save.Click += async (s, e) => {
                    grid.EndEdit();
                    var peers = new List<object>();
                    foreach (DataGridViewRow row in grid.Rows) peers.Add(new {
                        url = Convert.ToString(row.Cells[0].Value).Trim(), nodeId = Convert.ToString(row.Cells[1].Value).Trim().ToLowerInvariant()
                    });
                    pending = true;
                    grid.Enabled = buttons.Enabled = false;
                    bool success = false;
                    try {
                        request["peers"] = peers;
                        request["rpcUrl"] = rpc.Text.Trim();
                        await Request("save-replica-settings", json.Serialize(request));
                        status.Text = L("Replicação guardada. Inicia o nó para aplicar a configuração.", "Replication saved. Start the node to apply the settings.");
                        success = true;
                    } catch (Exception error) {
                        feedback.Text = L("Confirma os endereços wss://…/peer e os IDs de 64 caracteres. A lista não aceita duplicados nem o próprio nó.",
                            "Check the wss://…/peer addresses and 64-character IDs. Duplicates and this node are not allowed.");
                        if (error.Message.Contains("EPERM") || error.Message.Contains("EACCES"))
                            feedback.Text = L("Não foi possível escrever na pasta de dados.", "Could not write to the data folder.");
                        if (error.Message.Contains("INVALID_OPERATOR_RPC"))
                            feedback.Text = L("Usa um endereço WSS válido para o RPC, ou deixa o campo vazio.", "Enter a valid RPC WSS address or leave the field blank.");
                    } finally { pending = false; grid.Enabled = buttons.Enabled = true; }
                    if (success) dialog.Close();
                };
            }
            Full(layout, buttons);
            Full(layout, feedback);
            dialog.ShowDialog(this);
        }
    }

    void Register() {
        if (MessageBox.Show(this, L("O GitHub vai receber apenas o perfil público. Já confirmaste a ligação noutra rede?", "Only the public profile will be sent to GitHub. Did you verify the connection from another network?"),
            Text, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
        var title = "[Testnet node] " + name.Text.Trim();
        var body = "CellCloud Testnet-10 node candidate\n\nPublic profile\n\n```json\n" + publicProfile + "\n```\n";
        Open(Repository + "/issues/new?title=" + Uri.EscapeDataString(title) + "&body=" + Uri.EscapeDataString(body));
    }

    async Task CheckMailNode() {
        mailProfile = null;
        var result = await Request("check-mail");
        if ((bool)result["publicReachable"]) {
            var profile = (Dictionary<string, object>)result["profile"];
            mailProfile = json.Serialize(profile);
            status.Text = L("Correio HTTPS verificado. Podes abrir o registo de correio no GitHub.", "Mail HTTPS verified. You can open the mail registration on GitHub.");
            details.Text = (string)profile["url"] + Environment.NewLine + "Mail ID: " + (string)profile["id"];
        } else {
            status.Text = (bool)result["localReady"] ?
                L("Correio ligado no PC. A verificação HTTPS ainda não passou.", "Mail is running on this PC. The HTTPS check has not passed yet.") :
                L("O correio ainda não respondeu na porta local. Confirma a porta e volta a verificar.", "Mail has not responded on its local port. Check the port and retry.");
        }
    }

    void RegisterMailNode() {
        if (mailProfile == null) return;
        var title = "[Testnet mail] " + name.Text.Trim();
        var body = "k@sMail Testnet-10 public profile\n\n```json\n" + mailProfile + "\n```\n";
        Open(Repository + "/issues/new?title=" + Uri.EscapeDataString(title) + "&body=" + Uri.EscapeDataString(body));
    }
}
