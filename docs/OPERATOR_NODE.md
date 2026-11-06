# Operar um peer CellCloud

O pacote autónomo está em [kaspa-cellcloud-node](https://github.com/bananaishere/kaspa-cellcloud-node),
com primeira versão experimental `v0.2.0-testnet.1`. A preparação é descrita em
[NODE_REPOSITORY.md](NODE_REPOSITORY.md). Os comandos abaixo continuam compatíveis com o código partilhado;
no pacote autónomo também existe a CLI `node bin/cellcloud-node.mjs`.

Etapa de preparação local, 5 novembro 2026. O runtime está no mesmo projeto que
o frontend, em `peer/cli.mjs`. Não cria uma rede pública automaticamente, não é
um nó RPC da Kaspa nem um minerador e não paga recompensas aos operadores.
Mainnet mantém apenas leitura/identificação de rede; uploads e pagamentos reais
continuam bloqueados. Não foi provisionado servidor, DNS, porta pública ou túnel.

## Arranque simples em Testnet-10

Pré-requisitos: Node.js 24 e pnpm na versão indicada em `package.json`. No projeto:

```text
pnpm install --frozen-lockfile
node scripts/prepare-peer-config.mjs --out ./cellcloud-node.json
pnpm peer-node --config ./cellcloud-node.json --check-config
pnpm peer-node --config ./cellcloud-node.json
```

A página **Nós → Operar um nó CellCloud** também descarrega esse modelo. Se
descarregares o JSON, não executes o gerador sobre o mesmo ficheiro: começa em
`--check-config`. O gerador recusa substituir uma configuração existente.

O modelo escuta apenas em `127.0.0.1:8080`, com um diretório novo
`.local/cellcloud-node` e quota de 1 GiB. Os dados/logs ficam numa pasta ignorada
pelo Git por defeito. Não altera os peers do laboratório em 6091/6092.
As células codificadas ocupam até 3× o conteúdo por réplica; uma quota de 1 GiB
não equivale a admitir uploads de 1 GiB. O nó tem de permanecer ligado.

`--check-config` valida os campos, origens, rede, quotas, paths, transporte e
ficheiros TLS quando declarados. Não cria diretórios de armazenamento, identidade,
token, listeners ou ligações RPC. Aprovar a configuração não prova conectividade.

No primeiro arranque real são criados `identity.private.json` e
`upload-token.private.json` no diretório de dados. O log mostra a identidade pública
e o caminho do token, nunca os seus valores privados. Guarda backups privados
destes ficheiros e dos dados. Não os coloques no GitHub nem nos links de conteúdo.

Depois do arranque, guarda o `nodeId` público no campo `expectedNodeId` do JSON.
As ligações de diagnóstico seguintes exigirão essa identidade. Reiniciar preserva
identidade, token, células, recibos e histórico. Um segundo processo com o mesmo
diretório é recusado. Nunca apagues `node.lock` sem confirmar que o PID já terminou.

## Diagnóstico só de leitura

Com o nó ligado:

```text
pnpm peer-node --config ./cellcloud-node.json --doctor
```

O comando liga ao `publicUrl` configurado (ou endereço de escuta local), verifica
o hello assinado, a rede e a identidade esperada quando existe. Com identidade
fixada consulta também o estado público da replicação. Sem `expectedNodeId`, o
relatório indica `identityPinned:false` e não trata o primeiro contacto como
aprovação do operador. Confere a identidade por um canal independente.

Não lê o token de upload nem a chave privada de armazenamento, não inicia outro
nó e não pede assinatura, upload, UTXOs, pagamento ou envio. Não testa o RPC Kaspa:
`rpcChecked:false` é explícito. `wanProven:false` mantém-se mesmo com WSS, porque
uma chamada a partir da máquina do operador não comprova alcance noutra rede.

## Campos e configuração externa em espera

Os paths relativos são resolvidos contra a pasta do JSON, não contra a shell.
Não é permitido misturar `--config` com flags de execução; existe uma única fonte
de configuração. Os comandos antigos sem `--config` continuam suportados.

| Campo | Função |
| --- | --- |
| `network` | `testnet-10` ou `mainnet`; pagamentos Mainnet continuam desativados |
| `host`, `port` | Endereço e porta de escuta; padrão só loopback |
| `data`, `quotaBytes` | Diretório próprio e quota dos bytes guardados |
| `origins` | Origens exatas autorizadas do frontend; não é autenticação |
| `viewerOrigins` | Templates de origens isoladas por publicação |
| `peers` | Até três vizinhos, cada um com `url` e `nodeId` fixado |
| `rpcUrl` | wRPC próprio, ou vazio para o resolver já existente |
| `publicUrl` | Endereço de ligação anunciado pelo operador, terminado em `/peer` |
| `expectedNodeId` | Identidade pública esperada; `null` só no primeiro arranque |
| `tls` | `null` ou `{certFile,keyFile}` com paths de certificado/chave TLS |
| `reverseProxyTls` | TLS terminado num proxy do operador; exige `publicUrl` WSS |
| `logFile` | Log sanitizado; não pode ficar dentro do namespace de células/recibos |
| `syncIntervalMs`, `repairIntervalMs` | Intervalos da reconciliação e reparação |

Para uma máquina externa, preparar uma cópia separada do JSON. Não reutilizar os
volumes/identidades do laboratório. Definir a origem HTTPS exata da Vercel e um
viewer HTTPS isolado, um endpoint WSS alcançável e certificados válidos. Pode usar
TLS direto ou `reverseProxyTls:true`; não ambos. Binds fora do loopback sem TLS
ou proxy TLS explícito são recusados na configuração nova. Os valores configurados
não abrem firewalls, criam DNS nem instalam certificados.

Esta fase não instala uma CA no computador nem aceita certificados inválidos.
Não foi feito um ensaio TLS/WAN real; a validação TLS local recusa ficheiros
inválidos e pares de configuração incoerentes. Quando existir a máquina externa,
validar o handshake a partir de outro computador/rede, transferir conteúdo de
teste e repetir a perda/reconexão do processo antes de o anunciar como acessível.

## Entrar na rede e limites atuais

O operador partilha apenas endereço e identidade pública. Em Nós pode usar
**Copiar endereço e identidade** depois de ligar ao peer. Esse perfil não inclui
o token. A identidade assinada demonstra controlo da chave; não prova honestidade
do operador, retenção permanente ou disponibilidade futura.

A admissão de uploads ainda usa o token privado de operador. O registo público e a descoberta automática de disponibilidade estão descritos
em [PUBLIC_TESTNET.md](PUBLIC_TESTNET.md). Esse registo não autoriza uploads ou
replicação e não implementa remuneração, retenção contratual ou PoR.
Enviar 95% para a pool não distribui automaticamente KAS aos peers. Não anunciar
ganhos nem aceitar ficheiros únicos de terceiros com base nesta preparação.

## Estado do laboratório

Foram preparadas configurações privadas de diagnóstico em
`.local/operator-standby/lab-a.json` e `lab-b.json`, apontando para os peers já
existentes. Os dois responderam com as identidades esperadas e um vizinho cada.
Nenhum recibo, ficheiro ou autorização existente foi alterado; não houve pagamento.
O modelo novo em `.local/operator-standby/node.json` passou a validação e continua
em espera, sem armazenamento ou identidade criada e sem processo na porta 8080.

Regressão completa: **190 testes aprovados**, com build concluída. A interface
foi verificada em PT/EN e nos temas escuro/claro, incluindo a geração do modelo.
Os cinco novos testes automáticos cobrem configuração inválida, exposição remota em texto claro,
paths/origins, quotas, token indevido, não sobrescrita, validação sem efeitos de
arranque, hello assinado, outra rede/identidade, CLI com diretório temporário,
diagnóstico sem token e recusa de segundo processo. Esses ensaios não substituem
um nó noutra máquina ou rede.
