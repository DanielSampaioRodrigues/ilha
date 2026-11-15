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
  laranja até você clicar em **Paguei**. **Lembretes** avisam uma vez na hora marcada.
- **Notas** com abas, salvas sozinhas. **Foco**: cronômetro com pausa no fim.
- **Programas e sites**: o botão **Editar** na ilha aberta adiciona programas do PC
  ou endereços de sites.
- **Música**: o que estiver tocando no Windows (Apple Music, Spotify, navegador)
  aparece com capa e botões.
- **Aviso do Claude Code**: ligue em Ajustes; a ilha avisa quando ele termina ou
  espera você. Outros programas podem avisar com `ilha.exe --aviso "Título" --detalhe "texto"`.
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
- Checar o código só-Windows daqui: `cargo check --target x86_64-pc-windows-gnu`
  (precisa de `gcc-mingw-w64-x86-64`).
- `src/atualizacao.ts` — botão Atualizar (plugin updater do Tauri). As versões são
  assinadas com a chave do segredo `TAURI_SIGNING_PRIVATE_KEY`; a chave pública fica
  em `tauri.conf.json`. Se a chave privada se perder, gerar outra e reinstalar à mão.
- Testar a aparência sem Windows: `npm run dev` e abrir `http://localhost:1420`
  (aparecem botões para trocar de estado; `?estado=aberta` abre direto num estado).
