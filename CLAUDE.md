# Instruções para o Claude neste repositório

- Responder sempre em português. O Dan não programa: o código fica todo com o Claude; explique decisões em linguagem simples.
- Antes de começar, leia `PLANO.md`: ali estão todas as decisões já tomadas.
- Commits sempre no nome do Dan (autor Daniel Sampaio Rodrigues), nunca com outro autor.
- App alvo: Windows (Tauri 2 + TypeScript). Instalador gerado pelo GitHub Actions.
- Ações que não têm volta (apagar, enviar, pagar, publicar, mudar configurações do sistema) sempre passam pela confirmação do Dan dentro do app.
- Chaves de API, senhas e tokens nunca entram no código nem em commits (o repositório é público): ficam guardados só no PC do Dan, no cofre de senhas do Windows.
- Quando o Dan precisar fazer algo no site do GitHub, explicar passo a passo e de forma didática: onde clicar, o que vai aparecer na tela e o que é normal acontecer.
- O Dan autorizou (15/11/2026) enviar direto para o ramo `main`, sem pull request: cada envio ao `main` vira uma versão nova que a ilha instalada oferece no botão "Atualizar". Só enviar ao `main` código que compila e foi conferido.
