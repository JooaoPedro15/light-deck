# Light Deck

**Navegador multi-conta leve para jogos idle de navegador.** Roda várias contas ao mesmo tempo, cada uma com login separado, gastando o mínimo de CPU e GPU. Funciona em **Windows e macOS**.

> Procurando uma alternativa leve ao IdleDeck, um "idle deck" / "idle board" que não pese no PC, ou um jeito de deixar vários jogos idle abertos em segundo plano? É para isso que o Light Deck existe.

## Por que "Light"?

Deixar vários jogos idle abertos costuma comer o processador inteiro, mesmo com a janela escondida. O Light Deck foi feito em volta de uma ideia: **o que você não está vendo não precisa ser desenhado**.

- **Conta fora da tela não desenha nada.** Zero trabalho de GPU; os timers do jogo continuam, mas no ritmo de segundo plano do navegador (cerca de 1 vez por segundo).
- **Janela na bandeja ou minimizada = todas as contas em modo econômico.** Os jogos seguem rodando, o PC fica livre.
- **Conta parada = zero CPU e memória devolvida.**
- **Sem miniaturas, sem animações na interface, sem timers à toa.**
- **Economia por conta.** Algum jogo progride devagar em segundo plano? Botão direito na conta → desmarque "Economizar quando oculta" só para ela.
- **Medidor no topo.** CPU e RAM totais do app e CPU de cada conta, para você ver quem está pesando.

## Recursos

- Várias contas do mesmo jogo, cada uma com sessão isolada (cookies, login e cache separados)
- Grupos para organizar os jogos
- Modo **Foco** (uma conta na tela, o mais econômico) e modo **Grade** (todas as contas do grupo lado a lado)
- Silenciar por conta ou tudo de uma vez
- Fechar para a bandeja e iniciar junto com o sistema
- Windows e macOS com o mesmo código

## Como instalar

### Jeito fácil: baixar o instalador

1. Abra a página de **[Releases](https://github.com/JooaoPedro15/light-deck/releases/latest)**.
2. Em **Assets**, baixe o arquivo do seu sistema:
   - **Windows**: `Light-Deck-Setup-x.y.z.exe`
   - **Mac com chip Apple (M1, M2, M3...)**: `Light-Deck-x.y.z-arm64.dmg`
   - **Mac com Intel**: `Light-Deck-x.y.z-x64.dmg`
3. Abra o arquivo baixado.

**Windows:** se aparecer "O Windows protegeu o computador", clique em **Mais informações → Executar assim mesmo**. O aviso aparece porque o app ainda não tem assinatura digital paga; não é vírus. O app instala sozinho e cria atalho na área de trabalho.

**Mac:** arraste o Light Deck para **Aplicativos**. Na primeira vez, clique com o **botão direito** no app → **Abrir** → **Abrir**. Se o Mac disser que o app "está danificado", rode no Terminal:

```bash
xattr -cr "/Applications/Light Deck.app"
```

### Jeito avançado: rodar pelo código

São 3 comandos.

### 1. Instale o que precisa

- [Node.js](https://nodejs.org) versão 20 ou mais nova (o instalador já traz o `npm`)
- [Git](https://git-scm.com/downloads)

### 2. Baixe o projeto

```bash
git clone https://github.com/JooaoPedro15/light-deck.git
```

```bash
cd light-deck
```

### 3. Instale e abra

```bash
npm install
```

```bash
npm start
```

Vale igual para Windows (PowerShell ou Prompt) e macOS (Terminal).

## Como usar

1. Clique em **+ Conta**, cole o endereço do jogo e dê um nome.
2. Faça login na página do jogo. O login fica salvo só naquela conta.
3. Repita para cada conta. Use **+ Grupo** para separar por jogo.
4. Clique numa conta para vê-la. **Botão direito** abre as opções: parar, recarregar, silenciar, economia, editar, remover.
5. Feche a janela: o app vai para a bandeja e os jogos continuam rodando leves.

## Dicas para gastar ainda menos

- Prefira o modo **Foco**: só uma conta é desenhada.
- Deixe o app na bandeja quando não estiver olhando.
- Pare as contas que não precisa agora (bolinha cinza = parada).

## Desenvolvimento

Rodar os testes:

```bash
npm test
```

Gerar o instalador do sistema em que você está (sai na pasta `dist`):

```bash
npm run dist
```

No Windows gera um `.exe`; no macOS gera um `.dmg`. O instalador do Mac só pode ser gerado em um Mac, ou pelo GitHub Actions (aba **Actions → Instaladores → Run workflow**), que gera os dois.

Feito com [Electron](https://www.electronjs.org), JavaScript puro, sem framework.

| Pasta | O que tem |
| --- | --- |
| `src/main` | Processo principal: janela, bandeja, contas, configuração |
| `src/preload` | Ponte segura entre a interface e o processo principal |
| `src/renderer` | Interface (HTML, CSS, JS) |
| `test` | Testes |

## Aviso

Projeto independente, escrito do zero, **sem vínculo com o IdleDeck** nem com os jogos citados. Confira as regras de cada jogo antes de usar várias contas.

## Licença

[MIT](LICENSE): pode usar, copiar e modificar à vontade.

Gostou? Deixe uma estrela no repositório, ajuda outras pessoas a encontrarem.
