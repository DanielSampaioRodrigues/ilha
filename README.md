# Ilha

Central de IA e copiloto do computador, em forma de ilha no topo da tela.
As decisões do projeto estão em [PLANO.md](PLANO.md).

## Como instalar

1. No GitHub, abra **Actions** › a execução mais recente de "Instalador do Windows" ›
   em **Artifacts**, baixe `Ilha-instalador-windows` (vem em .zip).
   Quando o código estiver no ramo `main`, o instalador também aparece em **Releases**.
2. Abra o `.exe`. Como o instalador ainda não tem assinatura digital, o Windows
   pode mostrar "O Windows protegeu o computador": clique em **Mais informações** ›
   **Executar assim mesmo**.

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
- Testar a aparência sem Windows: `npm run dev` e abrir `http://localhost:1420`
  (aparecem botões para trocar de estado; `?estado=aberta` abre direto num estado).
