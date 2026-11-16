# Ilha

Central de IA e copiloto do computador, em forma de ilha no topo da tela.
As decisões do projeto estão em [PLANO.md](PLANO.md).

## Como instalar

1. Baixe o `Ilha_..._x64-setup.exe` da versão mais nova em **Releases**
   (ou, para versões de teste fora do `main`: **Actions** › execução › **Artifacts**).
2. Abra o `.exe`. Como o instalador ainda não tem assinatura digital, o Windows
   pode mostrar "O Windows protegeu o computador": clique em **Mais informações** ›
   **Executar assim mesmo**.

## Como atualizar

Só a primeira instalação é manual. Depois, a Ilha procura versão nova sozinha (ao
ligar e a cada 6 horas); quando houver, aparece **Nova versão da Ilha › Atualizar**
na ilha aberta. Também dá para pedir pelo menu do ícone: **Procurar atualização**.

## Como usar

- A ilha fica no topo central da tela principal, só com a carinha do robô.
- **Clique na carinha** ou aperte **Win + Alt + I** para abrir. **Esc** volta/fecha;
  clicar fora fecha. O atalho pode ser trocado em **Ajustes** (engrenagem).
- **Assinaturas**: cadastre o dia do vencimento; alguns dias antes a ilha fica
  laranja até você clicar em **Paguei**. **Ver tabela** mostra tudo e o total por mês.
- **Redefinições**: quando o limite de uma IA volta (todo dia, semana ou mês). Perto
  da data, o **símbolo da IA** aparece ao lado do robô; passe o mouse para ver o
  modelo e quanto falta.
- **Modo discreto** (Ajustes): em repouso a ilha vira um risquinho para não tampar
  as abas. "Automático" faz isso só com navegador (e afins) na frente.
- **Notas** com abas, salvas sozinhas. **Foco**: cronômetro com pausa no fim.
- **Tarefas** (prioridade, data, etapas), **Timers** com nome e cronômetro,
  **Hábitos** (água, leitura…) com lembrete de pausa, **Textos rápidos** (PIX,
  endereço) e gerador de senha, **Meu PC** (como está o computador e limpeza).
- A ilha fechada mostra a **música tocando** e o **volume** quando ele muda, e some
  em jogos/vídeos em **tela cheia**.
- **Programas e sites**: o botão **Editar** na ilha aberta adiciona programas do PC
  ou endereços de sites.
- **Música**: o que estiver tocando no Windows (Apple Music, Spotify, navegador)
  aparece com capa e botões.
- **Avisos do Claude Code, Codex e Gemini CLI**: ligue em Ajustes; a ilha avisa
  quando eles terminam (ou esperam você). Outros programas podem avisar com `ilha.exe --aviso "Título" --detalhe "texto"`.
- **Traduzir a tela**: **Win + Alt + T** (ou o botão na ilha aberta) e arraste um
  retângulo em volta do texto; a tradução aparece por cima, no mesmo lugar. O botão
  **Tela inteira** traduz tudo; **Esc** fecha. Precisa da chave da
  DeepSeek em Ajustes › Chaves de IA.
- **Traduções**: histórico com busca de tudo que foi traduzido.
- **Conversa rápida** (botão de teclado na ilha aberta): fale com a IA ou perfil que
  escolher sem abrir a Central. Pedidos simples ela resolve sozinha, sem IA: "volume 30",
  "timer 10 min pizza", "me lembra em 20 min de ligar", "foco", "pausa a música",
  "abre o spotify", "copia meu pix", "que horas são". **"Guarda que…"** salva na
  **Memória**, que vai junto para todas as IAs (tela Memória, ícone de cérebro).
- **Falar com a IA**: aperte o **microfone vermelho** na ilha aberta e fale; ela
  responde e lê a resposta em voz alta (escolha a voz em Ajustes › Voz). Usa o
  reconhecimento de fala do Windows: se aparecer erro, ligue "Reconhecimento de fala
  online" em Configurações › Privacidade e segurança › Fala.
- **Chamar pelo nome** (opcional, Ajustes › Voz): diga o nome do robô e ele abre
  ouvindo o pedido.
- **"Posso?"**: com o Claude Code em "pode editar arquivos", quando ele quer rodar um
  comando (ou algo que precisa de permissão), a ilha mostra o pedido com **Não** e
  **Sim, pode**. Sem resposta em 10 minutos, fica "não".
- **A carinha percebe o que você faz**: digita junto, dança com música, assiste vídeo,
  põe fones em chamada, desenha quando você está num programa de design. Desliga em
  Personagem › "Perceber o que estou fazendo".
- **Personagem**: escolha quem mora na ilha (13: Robozinho, Gato, Urso, Sapo, Alien,
  Fantasma, Coelho, Gelatina, Nuvem, Pinguim, Coruja, TV, Olhão), 21 expressões, cor dos olhos e das bochechas, acessórios, olhos que
  seguem o mouse, mosquinha e cochilo quando parado.
- **Central** (botão de painel na ilha aberta, ou menu do ícone › Abrir a Central): a ilha
  cresce do topo num painel grande (sem janela a mais na barra de tarefas). Fecha com
  **Esc**, no **×** ou clicando fora; o **alfinete** deixa ela presa aberta enquanto
  você mexe em outro programa. O botão **Soltar como janela** vira uma janela comum
  (com moldura e na barra de tarefas); **Juntar de volta à ilha** desfaz. Tem a **Conversa** (DeepSeek, Claude Code, Codex, Antigravity, Gemini CLI),
  **Perfis**, **MCPs e Skills**, **Projetos** e todas as outras telas. A ilha mostra
  quando uma IA está trabalhando e avisa quando termina.
- Na conversa: escolha **modelo** e **raciocínio**, ligue **MCPs e skills** só naquela
  conversa (ou mude depois em **Ajustes** no topo dela), **anexe** arquivos (clipe ou
  arrastando para a Central ou para a ilha) e use o **ditado** (microfone). Um
  **perfil** guarda tudo isso junto, como um agente pronto.
- Se algo der errado: menu do ícone › **Abrir registro de erros**.
- "Ouvindo", "trabalhando" e "confirmação" ainda são de teste (menu do ícone ›
  **Ver os estados**); chegam de verdade nas fases 2 e 3.

## Para o Claude: como o código está organizado

- `src/` — interface (TypeScript). `src/corpo/` desenha a ilha: forma e gota
  (`forma.ts`, `mola.ts`), carinha de pixel (`carinha.ts`), estados compactos
  (`estados.ts`), telas da ilha aberta (`telas/`) e a orquestração (`ilha.ts`).
  `src/dados/` guarda assinaturas, lembretes, apps, notas e ajustes (plugin store,
  arquivo dados.json). `src/maos/sistema.ts` chama o lado Rust.
- `src-tauri/` — lado Rust. `corpo/janela.rs` posiciona a janela e deixa o clique
  atravessar o que não é preto; `corpo/bandeja.rs` é o ícone do relógio;
  `corpo/atalho.rs` o atalho global; `corpo/avisos.rs` o `--aviso`; `maos/` abre
  programas, lê a música do Windows e liga o gancho do Claude Code.
- Comando do Tauri que cria janela precisa ser `async`: no Windows, criar janela
  num comando comum trava tudo (janela branca que não fecha).
- Checar o código só-Windows daqui: `cargo check --target x86_64-pc-windows-gnu`
  (precisa de `gcc-mingw-w64-x86-64`).
- `src/atualizacao.ts` — botão Atualizar (plugin updater do Tauri). As versões são
  assinadas com a chave do segredo `TAURI_SIGNING_PRIVATE_KEY`; a chave pública fica
  em `tauri.conf.json`. Se a chave privada se perder, gerar outra e reinstalar à mão.
- Testar a aparência sem Windows: `npm run dev` e abrir `http://localhost:1420`
  (aparecem botões para trocar de estado; `?estado=aberta` abre direto num estado).
