# Ilha — plano do projeto

Evolução do Robozinho (mascote de IA em PowerShell) para um app instalável no Windows em forma de **ilha dinâmica** no topo central da tela, com efeito de gota, que funciona como central de IA e copiloto do computador.

Rascunho visual (Design): https://claude.ai/artifact/L1YSV2mpHdq1jUw1gTC9Xp

## Decisões já tomadas

### Plataforma e tecnologia
- Windows primeiro. Mac só quando o Dan comprar um (no Mac, a ilha abraça o notch).
- Integração no Órbita fica para bem depois, como funcionalidade extra (não no lançamento do Órbita, para não sobrecarregar quem chega).
- App em **Tauri 2** (Rust + interface web em TypeScript): leve para ficar ligado o dia todo.
- O GitHub Actions gera o instalador para Windows a cada atualização; o Dan só baixa e instala.
- Código organizado como motor reutilizável: **cérebro** (agentes/provedores), **mãos** (ferramentas), **corpo** (ilha e personagens).
- Commits sempre no nome do Dan.

### Visual
- Ilha preta presa ao topo da tela, com "ombros" côncavos e efeito de gota ao abrir/fechar.
- A carinha é a tela do robô: olhos de pixel azul-ciano (#3FE6EE) com bochechas rosadas; expressões: normal, ouvindo, foco, feliz, alerta (laranja).
- Cabeça do robô vermelho aparece quando a ilha abre. Personagens atuais continuam disponíveis.
- Estados: repouso, ouvindo, trabalhando (com botão Parar), tarefa pronta, aviso fixo (laranja até marcar como pago), confirmação, aberta.

### Ativação
- **Segurar para falar**: segura a tecla/botão, fala, solta e ele age. **Toque** abre caixa para digitar.
- Botão físico dedicado no Ulanzi D200 ou Keydial.
- **Nome do robô = palavra de ativação:** cada pessoa escolhe o nome do robô (Ajustes › Nome do robô; o Dan ainda vai decidir o dele). Falou o nome, ele atende e mostra que está ouvindo (estado "ouvindo": carinha atenta e ondinha de som). Como o nome é livre, o reconhecimento precisa aceitar qualquer palavra: ouvir trechos curtos com o Whisper local e procurar o nome.
- **Palavra de ativação opcional** (decisão revista em 16/11/2026): o Dan quer poder chamar o robô pelo nome, estilo Alexa (produtividade e acessibilidade). Fica em Ajustes para ligar/desligar; reconhecimento da palavra feito no próprio PC (o áudio não sai do computador). Desligar no atendimento (provavelmente outro PC só para atender, a partir de 2027).
- Toda função tem botão **e** comando de voz.
- Transcrição de voz local (Whisper na GTX 1660): grátis e o áudio não sai do PC.

### Permissões
- Acesso total ao computador. Faz tudo sozinho, exceto pedir confirmação (clique ou "sim" falado) para:
  apagar arquivos, enviar mensagem/e-mail, pagar/comprar, publicar, mudar configurações do Windows, fechar programa com trabalho não salvo. Lista editável.
- Pedidos de confirmação só valem vindos do Dan; texto lido em páginas/PDFs nunca autoriza nada.
- Histórico de tudo que ele fez.
- Preferir ações diretas (apps, arquivos, APIs, MCPs); controle de tela só como último recurso.

### Motores (quem faz o trabalho)
- Usar as **assinaturas** via programas oficiais: Claude Code (Claude Max), Codex (ChatGPT), Gemini CLI (conta Google). Confirmar os termos de uso pessoal antes de montar.
- Também APIs com chave: Anthropic (Sonnet), DeepSeek e outros provedores, como no Órbita e no Escuta.
- Configuração: **tarefas rápidas** (padrão DeepSeek API) e **tarefas pesadas** (padrão Claude Code). Trocável a qualquer momento (ex.: gastar créditos acumulados antes de renovar).
- Botão "Passar para…" troca de motor no meio da conversa enviando um resumo.

### Conversa falada (estilo Alexa)
- O robô **dialoga**: ouve (Whisper local), pensa com uma IA rápida e barata pela API (padrão DeepSeek; os CLIs ficam para tarefas pesadas, porque demoram a começar) e responde em voz.
- Voz da resposta: começar com as vozes do Windows (grátis); depois testar vozes locais melhores (Piper) e, se valer, vozes da internet.
- Precisa: começar a responder em ~2 s, poder interromper a fala, não ouvir a própria voz (cancelamento de eco) e lembrar do contexto da conversa.

### Conversa, projetos e histórico
- Tela de conversa completa; arrastar imagens, PDFs e pastas para a ilha. Sem limite próprio de tamanho: para os CLIs, passa o caminho do arquivo; para APIs, divide em partes.
- Histórico separado por Claude Code, Codex e Gemini; botão Continuar (retoma a mesma sessão) e Abrir no terminal.
- Projetos = pasta liberada + instruções próprias, mantidas iguais para os três motores.
- Pastas liberadas configuráveis.
- MCPs: instala uma vez e configura nos três motores. Skills nativas no Claude Code; nos outros, convertidas em instruções.
- Conectores da nuvem do claude.ai (Gmail, Drive, Magnific, Adobe) não vêm junto; precisam de MCP local equivalente.

### Avisos de outros programas
- Claude Code: ganchos de fim de tarefa avisam a ilha (feito: `ilha.exe --aviso claude-code`).
- Codex e Gemini CLI usados fora da ilha (no terminal) também devem avisar: Codex pela opção `notify` do `config.toml`; Gemini CLI pelos ganchos dele (conferir o que a versão atual oferece). Todos chamam o mesmo `ilha.exe --aviso`. Quando os motores rodarem dentro da ilha (fase 2), ela mesma sabe quando terminam.
- Programas que mostram notificação do Windows: a ilha lê e mostra.
- DeepSeek Harness: só avisar quando terminar (ele já usa API; não precisa ser motor).

### Tradução da tela
- Botão ou voz ("traduz a tela"): print só do monitor onde está o mouse; tradução aparece por cima do texto, no mesmo lugar (estilo Google Lens); Esc fecha.
- Variações: traduzir só um trecho (arrastar retângulo); copiar tradução.
- OCR do próprio Windows (local); só o texto vai para tradução. Imagens com pouco texto podem ir para uma IA com visão.
- Histórico dos prints com imagem, original, tradução, data e programa; busca por texto.

### O que vem do Robozinho
- Avisos de redefinição (cadastro manual), assinaturas com "Paguei", notas com abas e autosalvamento, foco, pausas, personagens, lançador de apps.
- Mídia: tocar/pausar/pular/capa via controles de mídia do Windows (feito). Funciona com qualquer player que aparece no controle de volume do Windows (Apple Music, Spotify, navegador), sem ligar conta nenhuma.
- Pedir música, artista ou playlist pelo nome (voz, fase 3): o Apple Music não tem API aberta no Windows. Caminhos a testar: abrir a busca do Apple Music já com o nome, ou controlar o app pela tela como último recurso. Para comercializar: Spotify (API oficial, exige Premium) e outros serviços.

## Fases
1. Ilha com efeito de gota + tudo que o Robozinho já faz + avisos de tarefa pronta + **tradução da tela** (botão).
2. Conversa com os três motores, projetos e histórico.
3. Arrastar arquivos, voz (segurar para falar) e controle do computador com níveis de permissão.
4. Gerenciador de MCPs e skills.
5. Depois: motor dentro do Órbita; versão Mac.

## Andamento
- **Fase 1, etapa 1 (feita):** app Tauri com a janela da ilha no topo central, clique que atravessa a parte transparente, efeito de gota ao abrir/fechar, carinha de pixel (pisca e olha para os lados), todos os estados com dados de exemplo, ícone na bandeja com menu de teste, atalho Ctrl+Alt+Espaço, instalador pelo GitHub Actions.
- **Atualização pelo próprio app (feita):** a ilha procura versão nova nos Releases do GitHub e mostra o botão "Atualizar". Repositório público para isso funcionar sem senha e para o GitHub Actions não ter custo.
- **Fase 1, etapa 2 (feita):** assinaturas com "Paguei" e aviso laranja, lembretes de redefinição, notas com abas, foco e pausas, lançador de programas e sites, música do Windows, aviso do Claude Code (ganchos Stop e Notification), iniciar com o Windows, atalho Win+Alt+I configurável (Ctrl+Alt+Espaço é do Claude), registro de erros.
- **Fase 1, etapa 3 (feita):** redefinições das IAs (repete todo dia/semana/mês, sinal verde no robô 1–3 dias antes, aviso "renovou"); lembretes antigos viraram redefinições; assinaturas editáveis e tabela com total por mês; foco com tempo livre; lançador lista os programas instalados (menu Iniciar, inclusive Microsoft Store) e troca os sites padrão pelo app com o mesmo nome; avisos de fim de tarefa também do Codex (`notify`) e do Gemini CLI (ganchos AfterAgent e Notification; conferir na prática); Ajustes com interruptores iguais e cor de destaque.
- **Fase 1, etapa 4 (feita):** modo discreto (desligado/automático/sempre): em repouso a ilha vira um risquinho; no automático, só quando um navegador, o Explorador, o Terminal ou o VS Code está na frente e encostado no topo; passar o mouse faz crescer. Redefinições mostram o símbolo da IA ao lado do robô; passar o mouse mostra o modelo e quanto falta.
- **Fase 1, etapa 5 (feita):** música tocando e volume aparecendo na ilha fechada; controle de volume na ilha aberta; timers com nome (com alarme) e cronômetro; lista de tarefas com prioridade, data e etapas; hábitos do dia e lembrete de pausa; textos rápidos (copiar com um clique) e gerador de senha; Meu PC (diagnóstico, dicas, limpar temporários com confirmação, aviso de PC pesado); esconder em tela cheia; nome do robô; grade de atalhos na ilha aberta; avisos do Codex/Gemini com um clique só (e conserto do Codex com "notify" vazio).
- Histórico do que foi copiado: o Windows já tem (Win+V); por isso a ilha ficou só com os textos rápidos.
- **Fase 1, etapa 6 (feita):** tradução da tela (Win+Alt+T, botão na ilha ou menu do ícone): print do monitor onde está o mouse, OCR do Windows (prefere inglês), tradução pela DeepSeek, texto traduzido por cima no mesmo lugar, "só um trecho", ver original, copiar, Esc fecha. Cofre de chaves de IA (Gerenciador de Credenciais do Windows; a interface nunca lê a chave). Codex: a ilha entra na frente do "notify" que o app do Codex já usa (computer-use) e repassa o aviso para ele.
- Tradução começa **escolhendo um trecho** (arrastar um retângulo; é o uso de 95% das vezes); "Tela inteira" fica num botão. Só o trecho vai para a IA (mais rápido e barato).
- **Provedores de tradução (versão comercial):** a pessoa escolhe a chave: DeepSeek, Gemini (tem cota grátis), ChatGPT/OpenAI, Groq (tem cota grátis) ou DeepL (plano grátis de 500 mil caracteres/mês). Os quatro primeiros falam o mesmo "formato" de API; o DeepL precisa de um adaptador próprio.
- **Fase 1, etapa 7 (feita):** histórico das traduções (recorte do print, original, tradução, data e programa; busca; copiar; apagar; até 300) na tela Traduções. Personagem: 13 expressões, olhos seguem o mouse, mosquinha quando parado, cochilo com "zzz" depois de 5 min de mouse parado, respiração e troca de expressão com piscada; cor dos olhos e das bochechas, 6 acessórios de pixel, escolher robô vermelho ou carinha na ilha aberta. Grade de atalhos 4×3.
- **Falta na tradução:** tradução por IA com visão para imagens com pouco texto.
- **Fase 1 praticamente fechada.** Pendências pequenas: ícones reais dos programas no lançador; personagens extras (outros modelos de robô).
- **Fase 2, parte 1 (feita):** Central (janela grande com menu lateral; reaproveita as telas da ilha; dados sincronizados entre janelas). Conversa com DeepSeek (API, resposta ao vivo) e com Claude Code, Codex e Gemini CLI pelos programas oficiais (pergunta pelo stdin, respostas em JSON, sessão guardada para continuar, Parar, Abrir no terminal, Passar para…). Projetos (pasta + instruções). Histórico separado por motor (filtro). A ilha mostra "trabalhando" com Parar e avisa quando a IA termina; "Digitar" abre a conversa.
- **Modos dos programas:** "só conversar e ler" (Claude: plan; Codex: sandbox somente leitura; Gemini: padrão) e "pode editar arquivos" (Claude: acceptEdits; Codex: workspace-write; Gemini: auto_edit). Comandos no computador ficam bloqueados até a fase 3 (confirmação pelo Dan dentro da ilha).
- **Termos de uso:** os três são os programas oficiais, usados no modo "sem tela" que eles mesmos documentam, com a conta do próprio Dan — uso pessoal normal.
- **Próximo (fase 2, parte 2):** escolher motor rápido/pesado padrão em Ajustes; anexar arquivos e imagens na conversa; memória ("guardar algo importante"); conversa rápida dentro da própria ilha.
- **Defender:** a versão 0.1.4 foi bloqueada como "Cavalo de Troia" (alarme falso de programa novo sem assinatura digital). Restaurada pelo Dan. Falta enviar o alarme falso para a Microsoft e estudar assinatura digital.

## Ideias vistas no Kobi (concorrente, 16/11/2026)
Produto vendido por R$ 89,90 (pagamento único), Windows e Mac. Inspirar nas ideias, não copiar visual nem nome.
- **Rápidas (fase 1):** volume na ilha; timers com nome e cronômetro; histórico do que foi copiado e "textos rápidos" (ex.: "copia meu PIX"); gerador de senha; esconder sozinha em jogo/vídeo em tela cheia; hábitos (água, leitura, exercício) e lembrete de pausa; aviso de PC pesado e "como está meu PC"; lista de tarefas com prioridade e subtarefas; música tocando aparecendo na própria ilha fechada (nome + barrinhas).
- **Personagem:** mais expressões (13) e animações quando parado (cochilar, brincar); cor, olhos e acessórios.
- **Fase 2:** "Central" em janela grande com menu lateral (conversa, memória, tarefas, ajustes) — a ilha fica para o rápido; comandos simples resolvidos sem IA (volume, abrir app, timer), mais rápidos e grátis; plano grátis de reserva (Gemini/Groq) quando a assinatura bater no limite; botão "testar esta IA"; memória ("guardar algo importante").
- **Fase 3:** ações com confirmação **e desfazer** (ex.: organizar a área de trabalho); "modo só executar" (sem falar); interromper a qualquer momento.
- **Calendário:** primeiro o **Calendário da Apple (iCloud)**: a ilha grava os eventos direto na conta (com senha de app do Apple ID guardada no cofre do Windows), com alerta, para tocar no iPhone. Assinaturas, redefinições, tarefas com data e lembretes do robô vão para lá. Depois: Google Agenda (versão comercial) e uma agenda própria dentro da Central.
- **Personagens:** vários modelos de robô, animações mais fluidas (respiração, piscar suave, transições entre expressões).
- **Meu PC (scanner):** diagnóstico (processador, memória, disco, programas pesados, programas que abrem com o Windows, temporários) e correções simples sempre com confirmação; nada de "limpador de registro" (mais estraga que ajuda).
- **Outras ideias do Claude:** resumo do dia ao ligar o PC (pagamentos, redefinições, tarefas, agenda); "modo atendimento" com um clique (silencia avisos, desliga microfone, pausa música); ditado em qualquer campo de texto (fala → texto onde está o cursor, com o Whisper local); ações sobre o texto copiado (traduzir, corrigir, resumir); arrastar arquivo para a ilha para converter PDF, comprimir imagem ou renomear em lote; rotinas ("modo trabalho": abre InDesign, a pasta do livro e uma playlist); uso das assinaturas de IA (quanto falta do limite), junto das redefinições.
- Microfone sempre ligado: vira opção (ver Ativação).
- IA grátis de reserva: o Dan não precisa (usa as assinaturas e APIs); só pensar nisso para a versão comercial.

## Pendências a conferir
- Termos de uso das assinaturas via CLI para uso pessoal.
- Se o app do Claude para desktop mostra sessões do Claude Code iniciadas pela ilha.
- Como detectar o fim de tarefa do DeepSeek Harness (notificação, janela ou processo).
