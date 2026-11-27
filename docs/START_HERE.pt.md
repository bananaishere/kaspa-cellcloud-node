# Ligar um nó CellCloud na Testnet-10

[Abrir a página Nós](https://kaspacellcloud.vercel.app/?operator-guide=1#nodes) ·
[Versões no GitHub](https://github.com/bananaishere/kaspa-cellcloud-node/releases) ·
[Guide in English](PUBLIC_TESTNET.md)

## Escolher o tipo de nó

- **Público da comunidade.** O teu nó pode aparecer na app pública. Escolhes o
  espaço e se aceitas novos deploys. Precisas de um domínio que responda por
  WSS a partir de outra rede.
- **Privado neste computador.** Usas o nó com a app local. A configuração
  padrão usa loopback e dispensa domínio, portas públicas e registo. A
  localização do nó por si só não cifra ficheiros.

No Windows x64, usa o [instalador da Testnet-10](https://github.com/bananaishere/kaspa-cellcloud-node/releases/download/windows-testnet.10/CellCloud-Node-Testnet-0.2.0-testnet.10-Windows-x64.exe).

Para atualizar, fecha o programa e instala a nova versão sobre a anterior. Volta a usar a mesma pasta de dados e a mesma configuração para preservar a identidade pública. Com a opção **Aceitar uploads da comunidade por carteira**, o nó atualizado pode receber células de deploys repartidos. A CellCloud coordena esses envios quando encontra pelo menos dois nós compatíveis.
Inclui Node.js e Caddy. Se preferires não usar o instalador, o percurso
**Instalar por terminal** abaixo cobre Windows, Linux e macOS.

## Nó público no Windows

<details>
<summary>Mostrar instalação e registo no Windows</summary>

Segue esta instalação se ainda não tens um nó a correr. Se já o tens
instalado, passa diretamente a [Já tenho um nó](#já-tenho-um-nó).

1. Segue a secção [Domínio, portas do router e HTTPS](#domínio-portas-do-router-e-https).
   O instalador já inclui o Caddy e inicia-o com o nó público.
2. Abre CellCloud Node e escolhe **Público da comunidade**. Introduz nome,
   domínio e limite de espaço. Ativa **Aceitar uploads da comunidade por
   carteira** se quiseres receber novos deploys.
3. Usa **Iniciar → Verificar ligação**. Confirma o Node ID e o endereço WSS.
   Testa o domínio em dados móveis. Um 404 na raiz é normal se o certificado
   for válido. O endpoint do nó termina em `/peer`.
4. Usa **Abrir registo público** e submete a issue no GitHub com o prefixo
   `[Testnet node]`. Partilha apenas o perfil público. A app recolhe a issue
   aberta e verifica a identidade do nó automaticamente.
5. Confirma o estado em **Nós → Disponibilidade da rede → Consultar nós da comunidade**. **Ligado** significa
   identidade verificada. **Disponível para novos deploys** também exige
   uploads ativos e espaço livre. Mantém o programa ligado.

</details>

## Domínio, portas do router e HTTPS

<details>
<summary>Mostrar os passos de rede para um nó público</summary>

1. Aponta o domínio para o IPv4 público da ligação. Se esse IP muda, podes
   usar [DuckDNS](https://www.duckdns.org/install.jsp) ou outro serviço DDNS.
   Configura a atualização do IP e guarda o token em privado.
2. No Windows, executa `ipconfig` para ver o IPv4 local do PC na ligação
   ativa. Reserva esse endereço nas definições de DHCP do router.
3. No router, abre **Port Forwarding** ou **Encaminhamento de portas**.
   Cria duas regras TCP, uma de 80 externa para 80 interna e outra de 443
   externa para 443 interna. Nos campos início e fim, repete a mesma porta.
   Com um router, o destino é o IPv4 local do PC.
4. Com dois routers a fazer NAT, cria as duas regras em ambos. No router
   da operadora, o destino é o IP WAN do segundo router. No segundo, o
   destino é o IPv4 local do PC. Se não tens acesso ao primeiro router ou
   estás em CGNAT, pergunta à operadora se podes receber ligações de entrada.
5. Depois de iniciares o nó e o Caddy, abre o domínio por HTTPS nos dados
   móveis. Um 404 na raiz é normal se o certificado for válido. Usa a
   verificação do instalador ou o diagnóstico do terminal para testar WSS.

As portas predefinidas 8080 (ficheiros) e 8081 (k@sMail) ficam dentro do PC.
O Caddy recebe as ligações externas e encaminha-as para o serviço certo.

</details>

## Instalar por terminal

<details>
<summary>1. Instalar as ferramentas e descarregar o nó</summary>

Instala Git e Node.js 24. Se fores operar um nó público, instala também o
Caddy para o teu sistema. Abre um terminal novo e confirma as versões.

```sh
git --version
node --version
npm --version
npm install --global pnpm@11.25.0
pnpm --version
```

Descarrega o código e instala as dependências bloqueadas do projeto:

```sh
git clone https://github.com/bananaishere/kaspa-cellcloud-node.git
cd kaspa-cellcloud-node
pnpm install --frozen-lockfile --ignore-scripts
pnpm verify
```

Usa um pacote que passe a verificação. Se aparecer `RELEASE_CONTENT_MISMATCH`,
confirma que estás a usar os ficheiros da mesma versão e comunica o erro.
Mantém o terminal na pasta `kaspa-cellcloud-node` para os passos seguintes.

[Git](https://git-scm.com/downloads) · [Node.js](https://nodejs.org/en/download) · [Caddy](https://caddyserver.com/docs/install)

</details>

<details>
<summary>2. Configurar um nó público ou privado</summary>

**Público:** segue os passos de [domínio e router](#domínio-portas-do-router-e-https).
Na app, abre **Nós → Ligar um nó público → Instalar um
nó novo → Instalar por terminal**. No passo do endereço público, indica o
domínio, o espaço e se queres aceitar uploads. Descarrega
`cellcloud-node.json` e `Caddyfile` para a pasta do repositório. Se já
existirem, guarda uma cópia antes de editar.

**Privado:** cria apenas a configuração local. Este modo usa loopback e
dispensa domínio, Caddy, encaminhamento e GitHub.

```sh
node bin/cellcloud-node.mjs init --out cellcloud-node.json
```

</details>

<details>
<summary>3. Iniciar, verificar e confirmar a identidade</summary>

Na pasta do nó, valida a configuração e inicia o serviço:

```sh
node bin/cellcloud-node.mjs check --config cellcloud-node.json
node bin/cellcloud-node.mjs start --config cellcloud-node.json
```

Para um nó público, inicia o Caddy num segundo terminal, na mesma pasta:

```sh
caddy run --adapter caddyfile --config Caddyfile
```

Mantém esses terminais abertos. Abre outro para o diagnóstico:

```sh
node bin/cellcloud-node.mjs doctor --config cellcloud-node.json
```

Espera por `reachable: true`, `signedHandshake: true` e pela rede
`testnet-10`. Compara o `nodeId` com o mostrado quando iniciaste o nó.
Se `identityPinned` estiver a `false`, guarda o Node ID em
`expectedNodeId` no JSON e reinicia só o nó. Para o público, confirma
também o HTTPS a partir de outra rede.

</details>

<details>
<summary>4. Ligar à app e testar</summary>

**Público:** abre **Nós → Ligar um nó público → Já tenho um nó**, usa o
nome, endereço WSS e Node ID, e submete o registo no GitHub. A app verifica
o estado em **Disponibilidade da rede → Consultar nós da comunidade**.
Se ativaste uploads por carteira, testa um ficheiro pequeno na Testnet-10.

**Privado:** abre a app local no mesmo PC, liga a carteira Testnet-10 e
usa **Nós → O meu nó privado**. Introduz o endereço mostrado pelo
diagnóstico, confirma o Node ID e autoriza o upload com o token indicado
pelo processo em `uploadTokenFile`. Guarda o token em privado.

</details>

## Já tenho um nó

<details>
<summary>Mostrar verificação e registo do nó existente</summary>

1. Mantém o serviço a correr. No programa, usa **Verificar ligação**. No
   terminal, usa `node bin/cellcloud-node.mjs doctor --config cellcloud-node.json`,
   substituindo o caminho pelo ficheiro usado pelo teu serviço. Confirma
   Testnet-10, WSS e Node ID.
2. Se o perfil já estiver registado, consulta **Nós → Disponibilidade da rede**.
   Se ainda não estiver, usa **Ligar um nó público → Já tenho um nó** e
   prepara o registo com o nome, WSS e Node ID existentes.
3. Se estiver disponível só para leitura e quiseres receber deploys, ativa
   **Aceitar uploads da comunidade por carteira** no programa, ou
   `publicUploads.enabled` no JSON, e reinicia o serviço.

O registo e a ativação de uploads usam a identidade e a pasta de dados
existentes. Guarda as chaves e os tokens contigo.

</details>

## Nó privado no Windows

<details>
<summary>Mostrar os passos para o nó privado</summary>

1. Escolhe **Privado neste computador**, define pasta e limite de espaço e usa
   **Iniciar → Verificar ligação**.
2. Na app local, liga uma carteira Testnet-10. Em **Nós → O meu nó privado**,
   introduz o endereço e confirma o Node ID.
3. Usa **Pasta do nó** no programa e procura
   `private-testnet/storage/testnet-10/upload-token.private.json`. Cola o
   valor do token no campo de autorização de upload da app local. Guarda o
   token e as chaves contigo.

Para atualizar o programa, para o nó, fecha a janela e instala na mesma
pasta. Conserva o diretório de dados para manter a identidade e o conteúdo.

### Correr os dois modos no mesmo computador

Usa a instalação Windows para o nó público. Na pasta do repositório do nó,
com o percurso por terminal já instalado, cria um nó privado separado na
porta 8082:

```powershell
node bin/cellcloud-node.mjs init --out .local/private-8082/node.json --port 8082
node bin/cellcloud-node.mjs start --config .local/private-8082/node.json
```

O nó privado usa `ws://127.0.0.1:8082/peer`. A pasta de configuração separada
mantém os dados e a identidade separados dos do nó público. Só o nó público
precisa do domínio, do Caddy e do encaminhamento de portas.

</details>

## Replicação manual de ficheiros

<details>
<summary>Mostrar o ensaio de replicação</summary>

Este ensaio é opcional. Combina a troca de publicações públicas confirmadas
com outro operador. Cada um adiciona o endereço WSS e o Node ID do outro.

1. No Windows, usa **Parar → Replicação → Adicionar nó → Guardar → Iniciar**.
   No terminal, adiciona o vizinho a `peers` no JSON usado pelo serviço e
   reinicia-o.
2. Com o nó ligado, abre **Replicação**, cola o ID do manifesto e usa
   **Verificar cópia**. Espera pela confirmação assinada. O estado geral
   pode continuar pendente por outras publicações.
3. Usa um link que inclua os dois nós, para o nó de origem e abre o link numa
   sessão limpa. Volta a iniciar o nó e confirma que os dois comunicam.
   Reutiliza a publicação e o pagamento existentes.

Se o RPC não encontrar um cabeçalho antigo, mantém o registo pendente até
verificar o pagamento num wRPC Testnet-10 sincronizado, indexado e com o
histórico necessário. Configura-o em **Replicação → RPC Kaspa Testnet-10**
com o nó parado, ou em `rpcUrl` no JSON.

</details>

## Serviço de correio k@sMail

<details>
<summary>Ativar e registar no programa Windows</summary>

1. Para o nó e seleciona **Público da comunidade**. Ativa **k@sMail** e usa
   a porta local predefinida 8081 se estiver livre. Os ficheiros usam 8080
   por defeito.
2. Usa **Iniciar → Verificar k@sMail**. O programa configura a rota
   `/kasmail/v1/` no mesmo domínio HTTPS, reutiliza as regras TCP 80 e 443
   do router e guarda o correio noutra pasta.
3. Usa **Abrir registo de correio** e submete a issue. A aprovação do perfil
   de correio no piloto é um passo separado.

</details>

<details>
<summary>Instalar e registar o correio por terminal</summary>

1. Descarrega o [pacote de operador de correio](https://kasmail-cellcloud-nodes-bananalab360.vercel.app/kasmail-operator-testnet.zip)
   e segue o README para iniciar o serviço. Pode correr na mesma máquina.
2. Verifica o endereço público HTTPS terminado em `/kasmail/v1/`.
3. Submete o perfil público numa issue com o prefixo `[Testnet mail]`, num
   bloco de código `json`. Confirma depois a disponibilidade em **Nós**.
   O perfil de correio passa por verificação antes de entrar no piloto.

O correio tem instalação, identidade e configuração próprias. O registo
do nó de ficheiros e o seu emparelhamento não ativam o serviço de correio.

</details>
