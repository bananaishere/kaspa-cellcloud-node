using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
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
        using (var mutex = new System.Threading.Mutex(true, @"Local\CellCloudNodeDesktop", out first))
        using (var showRequest = new System.Threading.EventWaitHandle(false, System.Threading.EventResetMode.AutoReset, @"Local\CellCloudNodeDesktop.Show")) {
            if (first) Application.Run(new NodeWindow(Array.IndexOf(args, "--start") >= 0, showRequest));
            else showRequest.Set();
        }
    }
}

sealed class NodeWindow : Form {
    const string Guide = "https://kaspacellcloud.vercel.app/?operator-guide=1#nodes";
    const string Repository = "https://github.com/bananaishere/kaspa-cellcloud-node";
    static readonly Color Canvas = Color.FromArgb(208, 222, 218), Ink = Color.FromArgb(20, 43, 41);
    static readonly Color Surface = Color.FromArgb(231, 239, 236), GuideSurface = Color.FromArgb(218, 232, 227);
    static readonly Color Input = Color.FromArgb(246, 250, 248), ButtonSurface = Color.FromArgb(224, 235, 231);
    static readonly Color Muted = Color.FromArgb(70, 92, 87), Teal = Color.FromArgb(23, 96, 84);
    static readonly Color Mint = Color.FromArgb(110, 199, 185), Rule = Color.FromArgb(164, 189, 181);
    readonly bool pt = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "pt";
    readonly string home, settings;
    readonly JavaScriptSerializer json = new JavaScriptSerializer();
    readonly ComboBox mode = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList };
    readonly TextBox name = new TextBox(), domain = new TextBox(), folder = new TextBox();
    readonly NumericUpDown quota = new NumericUpDown { Minimum = 1, Maximum = 1024, Value = 1 };
    readonly NumericUpDown port = new NumericUpDown { Minimum = 1024, Maximum = 65535, Value = 8080 };
    readonly NumericUpDown mailPort = new NumericUpDown { Minimum = 1024, Maximum = 65535, Value = 8081 };
    readonly CheckBox uploads = new CheckBox { AutoSize = true }, startup = new CheckBox { AutoSize = true };
    readonly CheckBox mailEnabled = new CheckBox { AutoSize = true };
    readonly CheckBox mailCloudflare = new CheckBox { AutoSize = true, Checked = true };
    readonly Button start = new Button(), stop = new Button(), check = new Button(), register = new Button();
    readonly Button checkMail = new Button(), registerMail = new Button();
    readonly FlowLayoutPanel mailActions = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, Margin = Padding.Empty };
    readonly Button moveToTray = new Button();
    readonly Label status = new Label { AutoSize = true, MaximumSize = new Size(520, 0) };
    readonly Label connectionBadge = new Label();
    readonly TextBox details = new TextBox { ReadOnly = true, Multiline = true, ScrollBars = ScrollBars.Vertical, Height = 62 };
    readonly NotifyIcon tray = new NotifyIcon();
    readonly ContextMenuStrip trayMenu = new ContextMenuStrip();
    readonly ToolStripMenuItem trayStop = new ToolStripMenuItem(), trayExit = new ToolStripMenuItem();
    readonly Timer showTimer = new Timer { Interval = 250 };
    readonly Icon brandIcon;
    readonly Image brandImage;
    Process node, proxy;
    string payload, publicProfile, mailProfile;
    bool working, closing;

    string L(string portuguese, string english) { return pt ? portuguese : english; }

    [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr handle);

    public NodeWindow(bool autoStart, System.Threading.EventWaitHandle showRequest, string payloadDirectory=null, string settingsFile=null) {
        home = payloadDirectory ?? AppDomain.CurrentDomain.BaseDirectory;
        settings = settingsFile ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CellCloudNode", "desktop.json");
        Text = "CellCloud Node · Testnet-10";
        ClientSize = new Size(1020, 685);
        MinimumSize = new Size(850, 575);
        BackColor = Canvas;
        ForeColor = Ink;
        Font = new Font("Segoe UI", 10);
        StartPosition = FormStartPosition.CenterScreen;
        using (var stream = typeof(NodeWindow).Assembly.GetManifestResourceStream("CellCloud.NodeIcon.png")) {
            if (stream != null) using(var original = Image.FromStream(stream)) brandImage = new Bitmap(original);
        }
        brandIcon = CreateBrandIcon(brandImage);
        Icon = brandIcon ?? SystemIcons.Application;
        var frame = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(14), ColumnCount = 2, RowCount = 2 };
        frame.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        frame.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 318));
        frame.RowStyles.Add(new RowStyle(SizeType.Absolute, 77));
        frame.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        Controls.Add(frame);
        var header = BuildHeader();
        frame.Controls.Add(header, 0, 0);
        frame.SetColumnSpan(header, 2);
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(18), Margin = new Padding(0, 0, 12, 0), ColumnCount = 2, AutoScroll = true, BackColor = Surface };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 175));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        frame.Controls.Add(layout, 0, 1);
        frame.Controls.Add(BuildSideGuide(), 1, 1);
        var title = new Label { Text = L("Configuração do nó", "Node settings"), AutoSize = true, Font = new Font(Font.FontFamily, 16, FontStyle.Bold), Margin = new Padding(0, 0, 0, 12) };
        Full(layout, title);
        mode.Items.AddRange(new object[] { L("Privado neste computador", "Private on this computer"), L("Público da comunidade", "Public community node") });
        mode.SelectedIndex = 0;
        Row(layout, L("Tipo de nó", "Node type"), mode);
        Row(layout, L("Nome público", "Public name"), name);
        Row(layout, L("Domínio público", "Public hostname"), domain);
        folder.Text = Path.Combine(Path.GetDirectoryName(settings), "data");
        foreach(var field in new Control[] { mode, name, domain, folder, quota, port, mailPort, details }) field.BackColor = Input;
        var browse = new Button { Text = L("Escolher…", "Browse…"), Dock = DockStyle.Right };
        StyleButton(browse, false);
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
        mailCloudflare.Text = L("Aceitar o k@sMail no Cloudflare", "Accept k@sMail on Cloudflare");
        Full(layout, mailCloudflare);
        Row(layout, L("Porta local do correio", "Local mail port"), mailPort);
        Full(layout, startup);
        var actions = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, Margin = new Padding(0, 6, 0, 0) };
        foreach(var button in new[] { start, stop, check, register }) { StyleButton(button, button == start); actions.Controls.Add(button); }
        start.Text = L("Iniciar", "Start"); stop.Text = L("Parar", "Stop");
        check.Text = L("Verificar ligação", "Check connection"); register.Text = L("Abrir registo público", "Open public registration");
        Full(layout, actions);
        checkMail.Text = L("Verificar k@sMail", "Check k@sMail");
        registerMail.Text = L("Abrir registo de correio", "Open mail registration");
        foreach (var button in new[] { checkMail, registerMail }) { StyleButton(button, false); mailActions.Controls.Add(button); }
        Full(layout, mailActions);
        status.ForeColor = Muted;
        status.Margin = new Padding(0, 10, 0, 8);
        Full(layout, status);
        Full(layout, details);
        var utilities = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, Margin = new Padding(0, 7, 0, 0) };
        var logs = new Button { Text = L("Pasta do nó", "Node folder") };
        logs.Click += (s, e) => { if (Directory.Exists(folder.Text)) Open(folder.Text); };
        moveToTray.Text = L("Minimizar junto ao relógio", "Minimize to tray");
        foreach(var button in new[] { logs, moveToTray }) { StyleButton(button, false); utilities.Controls.Add(button); }
        Full(layout, utilities);
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
        moveToTray.Click += (s,e) => HideInTray();
        SetUpTray();
        if(showRequest!=null){
            showTimer.Tick += (s,e) => { if(showRequest.WaitOne(0)) RestoreFromTray(); };
            showTimer.Start();
        }
        RefreshButtons();
        if (autoStart) Shown += async (s, e) => { await Run(StartNode); if(node!=null) HideInTray(); };
    }

    static Icon CreateBrandIcon(Image image) {
        if (image == null) return null;
        using (var bitmap = new Bitmap(image, new Size(32, 32))) {
            var handle = bitmap.GetHicon();
            try { using(var icon = System.Drawing.Icon.FromHandle(handle)) return (Icon)icon.Clone(); }
            finally { DestroyIcon(handle); }
        }
    }

    Control BuildHeader() {
        var header = new TableLayoutPanel {
            Dock = DockStyle.Fill, Margin = new Padding(0, 0, 0, 12), Padding = new Padding(14, 6, 14, 6),
            ColumnCount = 3, RowCount = 1, BackColor = Color.FromArgb(16, 50, 45)
        };
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 56));
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        header.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        header.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        header.Controls.Add(new PictureBox { Image = brandImage, SizeMode = PictureBoxSizeMode.Zoom, Size = new Size(40, 40), Anchor = AnchorStyles.Left }, 0, 0);
        var identity = new FlowLayoutPanel { AutoSize = true, WrapContents = false, FlowDirection = FlowDirection.TopDown, Anchor = AnchorStyles.Left };
        identity.Controls.Add(new Label { Text = "CellCloud Node", ForeColor = Color.White, AutoSize = true, Font = new Font(Font.FontFamily, 16, FontStyle.Bold), Margin = Padding.Empty });
        identity.Controls.Add(new Label { Text = "Kaspa Testnet-10", ForeColor = Mint, AutoSize = true, Margin = new Padding(1, 1, 0, 0) });
        header.Controls.Add(identity, 1, 0);
        connectionBadge.AutoSize = true;
        connectionBadge.Padding = new Padding(10, 5, 10, 5);
        connectionBadge.Anchor = AnchorStyles.Right;
        header.Controls.Add(connectionBadge, 2, 0);
        return header;
    }

    Control BuildSideGuide() {
        var area = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 4, BackColor = GuideSurface, Padding = new Padding(14), Margin = Padding.Empty };
        area.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        area.RowStyles.Add(new RowStyle(SizeType.Absolute, 36));
        area.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        area.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
        area.RowStyles.Add(new RowStyle(SizeType.Absolute, 39));
        area.Controls.Add(new Label { Text = L("Como funciona", "How it works"), AutoSize = true, Font = new Font(Font.FontFamily, 14, FontStyle.Bold), Margin = new Padding(0, 0, 0, 8) }, 0, 0);
        var tabs = new TabControl { Dock = DockStyle.Fill, Margin = Padding.Empty, AccessibleName = L("Idioma da ajuda", "Help language") };
        tabs.TabPages.Add(SideGuidePage(true));
        tabs.TabPages.Add(SideGuidePage(false));
        tabs.SelectedIndex = pt ? 0 : 1;
        area.Controls.Add(tabs, 0, 1);
        var guide = new Button { Text = L("Guia passo a passo", "Step-by-step guide"), Dock = DockStyle.Fill, Margin = new Padding(0, 7, 0, 0) };
        StyleButton(guide, true);
        guide.Click += (s,e) => ShowWalkthrough();
        area.Controls.Add(guide, 0, 2);
        var website = new Button { Text = L("Abrir página Nós ↗", "Open Nodes page ↗"), Dock = DockStyle.Fill, Margin = new Padding(0, 5, 0, 0) };
        StyleButton(website, false);
        website.Click += (s,e) => Open(Guide);
        area.Controls.Add(website, 0, 3);
        return area;
    }

    TabPage SideGuidePage(bool portuguese) {
        var panel = new TabPage(portuguese ? "Português" : "English") { AutoScroll = true, BackColor = Surface };
        var content = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 1, Padding = new Padding(10, 10, 6, 4) };
        content.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        panel.Controls.Add(content);
        var items = portuguese ? new[,] {
            {"Escolher o modo", "Um nó privado guarda ficheiros neste PC. Um nó público partilha espaço com a comunidade."},
            {"Ligar e verificar", "Para um nó público, configura o domínio e as portas 80 e 443. Verifica a ligação antes de registar."},
            {"Receber deploys", "Ativa os uploads por carteira. As células são repartidas automaticamente se houver dois nós compatíveis ou mais."},
            {"Deixar o nó ligado", "Fecha a janela e usa o ícone junto ao relógio para voltar a abrir, parar ou sair."}
        } : new[,] {
            {"Choose a mode", "A private node stores files on this PC. A public node shares storage with the community."},
            {"Start and check", "For a public node, set up your hostname and ports 80 and 443. Check the connection before registering."},
            {"Accept deployments", "Enable wallet-authorized uploads. CellCloud distributes cells when at least two compatible nodes are available."},
            {"Keep the node running", "Close the window and use the icon by the clock to reopen, stop or exit."}
        };
        for(var index = 0; index < items.GetLength(0); index++) {
            content.Controls.Add(new Label { Text = items[index,0], AutoSize = true, Font = new Font(Font.FontFamily, 10, FontStyle.Bold), ForeColor = Teal, Margin = new Padding(0, 2, 0, 4) });
            content.Controls.Add(new Label { Text = items[index,1], AutoSize = true, MaximumSize = new Size(238,0), ForeColor = Muted, Margin = new Padding(0, 0, 0, 10) });
        }
        return panel;
    }

    static void StyleButton(Button button, bool primary) {
        button.AutoSize = true;
        button.MinimumSize = new Size(0, 32);
        button.Padding = new Padding(7, 2, 7, 2);
        button.FlatStyle = FlatStyle.Flat;
        button.UseVisualStyleBackColor = false;
        button.BackColor = primary ? Teal : ButtonSurface;
        button.ForeColor = primary ? Color.White : Ink;
        button.FlatAppearance.BorderColor = primary ? Teal : Rule;
        button.FlatAppearance.MouseOverBackColor = primary ? Color.FromArgb(30, 112, 98) : Canvas;
        button.FlatAppearance.MouseDownBackColor = primary ? Color.FromArgb(16, 76, 67) : GuideSurface;
    }

    void SetUpTray() {
        tray.Icon = Icon;
        tray.ContextMenuStrip = trayMenu;
        tray.Visible = true;
        trayMenu.Items.Add(L("Abrir CellCloud Node", "Open CellCloud Node"), null, (s,e)=>RestoreFromTray());
        trayMenu.Items.Add(new ToolStripSeparator());
        trayStop.Text = L("Parar nó", "Stop node");
        trayStop.Click += async (s,e)=>await Run(StopNode);
        trayMenu.Items.Add(trayStop);
        trayExit.Text = L("Parar e sair", "Stop and exit");
        trayExit.Click += async (s,e)=>await ExitFromTray();
        trayMenu.Items.Add(trayExit);
        tray.DoubleClick += (s,e)=>RestoreFromTray();
        Resize += (s,e)=>{ if(WindowState==FormWindowState.Minimized) HideInTray(); };
    }

    void HideInTray() {
        Hide();
    }

    void RestoreFromTray() {
        Show();
        if(WindowState==FormWindowState.Minimized)WindowState=FormWindowState.Normal;
        Activate();
    }

    async Task ExitFromTray() {
        if(working)return;
        if(node!=null)await Run(StopNode);
        if(node!=null){RestoreFromTray();return;}
        closing=true;
        Close();
    }

    protected override void OnFormClosing(FormClosingEventArgs args) {
        if(!closing&&args.CloseReason==CloseReason.UserClosing&&(node!=null||working)){
            args.Cancel=true;
            HideInTray();
        }
        base.OnFormClosing(args);
    }

    protected override void OnFormClosed(FormClosedEventArgs args) {
        showTimer.Dispose();
        tray.Visible=false;
        tray.Dispose();
        trayMenu.Dispose();
        if(node!=null)try{node.StandardInput.Close();}catch(InvalidOperationException){}
        Cleanup();
        if(brandIcon!=null)brandIcon.Dispose();
        if(brandImage!=null)brandImage.Dispose();
        base.OnFormClosed(args);
    }

    void PostNodeEvent(Action action) {
        if(!IsHandleCreated||IsDisposed||Disposing)return;
        try{BeginInvoke(action);}catch(InvalidOperationException){}
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
            GuidePage(tabs, "k@sMail", L(
                "1. Com o nó parado, ativa k@sMail e escolhe se aceitas o endereço do Cloudflare. A porta local do correio tem de ser diferente da dos ficheiros.\r\n\r\n2. Usa Iniciar → Verificar k@sMail. Para o Cloudflare, o programa verifica uma identidade de correio separada. As caixas existentes na Vercel continuam a usar a identidade anterior.\r\n\r\n3. Usa Abrir registo de correio e submete apenas o perfil público no GitHub. Aguarda a aprovação da identidade no piloto.",
                "1. With the node stopped, enable k@sMail and choose whether to accept the Cloudflare address. The local mail port must differ from the file port.\r\n\r\n2. Select Start → Check k@sMail. For Cloudflare, the program checks a separate mail identity. Existing Vercel mailboxes keep using the previous identity.\r\n\r\n3. Choose Open mail registration and submit only the public profile on GitHub. Wait for identity approval in the pilot."), Guide);
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
            mailCloudflare.Checked = values.ContainsKey("mailCloudflare") && (bool)values["mailCloudflare"];
            if (values.ContainsKey("mailPort")) mailPort.Value = Convert.ToDecimal(values["mailPort"]);
        } catch { status.Text = L("Confirma os dados da configuração.", "Review your configuration."); }
    }

    void RefreshButtons() {
        bool idle = !working && node == null;
        foreach (var control in new Control[] { mode, folder.Parent, quota, port }) control.Enabled = idle;
        foreach (var control in new Control[] { name, domain, uploads }) control.Enabled = idle && mode.SelectedIndex == 1;
        start.Enabled = idle; stop.Enabled = check.Enabled = !working && node != null;
        register.Enabled = !working && node != null && publicProfile != null;
        mailEnabled.Enabled = idle && mode.SelectedIndex == 1;
        mailCloudflare.Visible = mode.SelectedIndex == 1 && mailEnabled.Checked;
        mailCloudflare.Enabled = idle;
        mailPort.Enabled = mailEnabled.Enabled && mailEnabled.Checked;
        mailActions.Visible = mode.SelectedIndex == 1 && mailEnabled.Checked;
        checkMail.Enabled = !working && node != null;
        registerMail.Enabled = !working && node != null && mailProfile != null;
        trayStop.Enabled = !working && node != null;
        trayExit.Enabled = !working;
        var state = working ? L("A processar", "Working") : node == null ? L("Nó parado", "Node stopped") : L("Em execução", "Running");
        connectionBadge.Text = state;
        connectionBadge.BackColor = !working && node != null ? Mint : Color.FromArgb(44, 76, 69);
        connectionBadge.ForeColor = !working && node != null ? Ink : Color.White;
        tray.Text = "CellCloud Node · " + state;
    }

    async Task Run(Func<Task> action) {
        if(working)return;
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
            {"mailEnabled", mode.SelectedIndex == 1 && mailEnabled.Checked}, {"mailPort", (int)mailPort.Value},
            {"mailCloudflare", mailCloudflare.Checked}
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
            if (e.Data != null && e.Data.Contains("\"event\":\"listening\"")) PostNodeEvent(() => {
                if (node == child && !working) status.Text = L("Nó a funcionar neste computador.", "Node running on this computer.");
            });
        };
        child.ErrorDataReceived += (s,e) => {
            if (e.Data != null) PostNodeEvent(() => { if (node == child) details.AppendText(e.Data + Environment.NewLine); });
        };
        child.Exited += (s,e) => PostNodeEvent(() => {
            if (node != child || working) return;
            Cleanup();
            status.Text = L("Nó parado. Consulta os detalhes se o arranque falhou.", "Node stopped. Check the details if startup failed.");
            RefreshButtons();
        });
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
                    if (e.Data != null && e.Data.Contains("\"level\":\"error\"")) PostNodeEvent(() => { if (node == child) details.AppendText(e.Data + Environment.NewLine); });
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
