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
- Sem palavra de ativação (microfone sempre ligado é ruim no consultório).
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
- **Próximas etapas da fase 1:** tradução da tela; personagens do Robozinho (junto com escolher a cor dos olhos); ícones reais dos programas no lançador.
- **Defender:** a versão 0.1.4 foi bloqueada como "Cavalo de Troia" (alarme falso de programa novo sem assinatura digital). Restaurada pelo Dan. Falta enviar o alarme falso para a Microsoft e estudar assinatura digital.

## Pendências a conferir
- Termos de uso das assinaturas via CLI para uso pessoal.
- Se o app do Claude para desktop mostra sessões do Claude Code iniciadas pela ilha.
- Como detectar o fim de tarefa do DeepSeek Harness (notificação, janela ou processo).
