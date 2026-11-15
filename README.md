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

## Como usar (versão de teste)

- A ilha fica no topo central da tela principal, só com a carinha do robô.
- **Clique na carinha** ou aperte **Ctrl+Alt+Espaço** para abrir. **Esc** ou clicar
  fora fecha.
- O ícone perto do relógio tem o menu **Ver os estados (teste)** para ver como a
  ilha fica ouvindo, trabalhando, com tarefa pronta, com aviso e pedindo confirmação.
- Os dados que aparecem (avisos, tarefas, música) são exemplos. Nenhum botão mexe
  no computador ainda.

## Para o Claude: como o código está organizado

- `src/` — interface (TypeScript). `src/corpo/` desenha a ilha: forma e gota
  (`forma.ts`, `mola.ts`), carinha de pixel (`carinha.ts`), conteúdo de cada estado
  (`estados.ts`) e a orquestração (`ilha.ts`).
- `src-tauri/` — lado Rust. `src/corpo/janela.rs` posiciona a janela e deixa o
  clique atravessar a parte transparente; `src/corpo/bandeja.rs` é o ícone do relógio.
- `src/atualizacao.ts` — botão Atualizar (plugin updater do Tauri). As versões são
  assinadas com a chave do segredo `TAURI_SIGNING_PRIVATE_KEY`; a chave pública fica
  em `tauri.conf.json`. Se a chave privada se perder, gerar outra e reinstalar à mão.
- Testar a aparência sem Windows: `npm run dev` e abrir `http://localhost:1420`
  (aparecem botões para trocar de estado; `?estado=aberta` abre direto num estado).
