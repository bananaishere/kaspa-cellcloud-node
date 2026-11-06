# Repositório separado do nó CellCloud

## Duas peças

- `kaspacellcloud`: dApp React, carteira, viewer e experiência do utilizador.
- `kaspa-cellcloud-node`: daemon Node.js instalado pelo operador, armazenamento,
  verificação dos pagamentos/autoria, replicação e ferramentas de diagnóstico.

O nó não contém React, dados reais, tokens ou identidades do laboratório. Não é
um minerador nem um nó RPC Kaspa. Instalar não liga automaticamente outros peers
nem ativa remuneração. A admissão de uploads ainda exige o token do operador.
Mainnet continua desativada para uploads/pagamentos nos dois projetos.

## Preparação reproduzível

Na raiz da dApp, depois de fazer commit de qualquer alteração ao motor:

```sh
node scripts/export-node.mjs ../kaspa-cellcloud-node
```

O destino tem de ser uma pasta separada e inexistente. Não sobrescreve um
repositório existente nem copia o diretório da dApp inteiro. O exportador calcula
o grafo de imports do runtime e dos testes selecionados, verifica que os módulos
coincidem com HEAD e preserva os paths relativos. Inclui apenas dependências
permitidas e o SDK Kaspa com hashes/licença/proveniência verificados.

O pacote inclui CLI `bin/cellcloud-node.mjs`, configuração, backup, diagnóstico,
README, orientações de segurança, testes do nó e workflow CI sem credenciais.
`SOURCE_MANIFEST.json` identifica o commit de origem e os hashes dos ficheiros.
Não há fork independente das regras de preços, assinaturas ou pagamentos.

Na nova pasta:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
node bin/cellcloud-node.mjs init --out cellcloud-node.json
node bin/cellcloud-node.mjs check --config cellcloud-node.json
node bin/cellcloud-node.mjs start --config cellcloud-node.json
```

A configuração de exemplo usa loopback e uma pasta nova; não altera os nós da
dApp. As chaves/token são criados apenas no primeiro arranque real. Para ligar
o nó à dApp, indicar na página Nós o endpoint e a identidade pública fixada;
autorizar escrita com o token privado. Para vizinhos, configurar autorização
mútua por identidade. Acesso remoto requer transporte/origins válidos e ensaio.

## Publicação e manutenção

O nome proposto no GitHub é `bananaishere/kaspa-cellcloud-node`. A pasta local
foi preparada separadamente; não foi criado nem publicado um repositório remoto
nesta etapa. Não colocar na UI um link GitHub inexistente. Quando o repositório
for criado, acrescentar o link na página Nós e testar a instalação de um clone.

O pacote usa `private:true` para evitar npm publish acidental e `UNLICENSED`
porque a licença do código próprio ainda não foi escolhida. Não se atribuiu
uma licença open source em nome do titular; o SDK mantém a licença ISC incluída.

Antes de uma release, exportar para uma pasta nova, validar o diff, instalar
com lockfile, executar os testes e conferir SOURCE_MANIFEST. Publicar tags
compatíveis com a versão do protocolo da dApp. Não há sincronização automática
bidirecional: integrar e rever alterações ao motor no projeto de origem antes
da exportação seguinte. Não copiar ficheiros privados entre os repositórios.

Validação desta preparação: instalação offline com lockfile, só três dependências
de runtime, 22 testes no pacote autónomo, CLI help/init/check sem criar nós ou
pedidos de pagamento. Dois testes adicionais verificam a seleção de ficheiros,
hashes, SDK, exclusão do frontend/dados privados e recusa de sobrescrita.
