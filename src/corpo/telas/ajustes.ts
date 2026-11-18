// Ajustes: nome, cor, atalho, iniciar com o Windows, avisos dos programas de IA.
// Tudo que liga/desliga usa o mesmo interruptor: à direita, verde/cor = ligado.
import { agendaEscolhida, nomeDaAgenda } from "../../dados/agenda";
import { ler, mudar, type ModoDiscreto } from "../../dados/armazem";
import { arcoIris } from "./personagem";
import { aoCarregarVozes, erroVozNatural, falar, vozesEmPortugues } from "../../maos/fala";
import {
  abrirPrograma,
  abrirRegistros,
  apagarChave,
  salvarChave,
  temChave,
  testarDeepseek,
  atalhoLegivel,
  definirAtalho,
  definirInicioComWindows,
  esconderEmTelaCheia,
  iniciaComWindows,
  mudarAviso,
  PROGRAMAS_COM_ABAS,
  situacaoAvisos,
  type ProgramaIA,
  type SituacaoAviso, atenderPeloNome, aquecerKokoro, baixarOuvido, definirEspera, escolherOuvido, estadoKokoro, prepararKokoro, testarOuvido, conferirVoz, consertarVoz, estadoChamado, estadoOuvido, vozesNaturais, type EstadoChamado, type EstadoOuvido, type EstadoVoz } from "../../maos/sistema";
import { aplicarCor, CORES_DESTAQUE } from "../tema";
import type { Contexto } from "../contexto";
import { procurar, type Novidade } from "../../atualizacao";
import { ajustarMicrofoneComEco } from "../../maos/microfone-eco";
import { ATALHOS_DITADO, ATALHO_DITADO_PADRAO } from "../../dados/dicionario";
import { aoClicar, cabecalho, escapar, html, recadoTemporario } from "../ui";

const TECLAS = [
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
  ..."0123456789".split(""),
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
  "Space",
];

const NOMES: Record<ProgramaIA, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
};

/** Um interruptor (liga/desliga) com texto de situação embaixo do título. */
function interruptor(id: string, titulo: string): string {
  return `
    <div class="item" data-chave="${id}">
      <div class="coluna">
        <span class="principal">${titulo}</span>
        <span class="secundario situacao">Conferindo…</span>
      </div>
      <button type="button" class="chave" role="switch" aria-checked="false" aria-label="${titulo}" disabled><span></span></button>
    </div>`;
}

export function montarAjustes(ctx: Contexto): HTMLElement {
  const dados = ler();
  const partes = (ctx.atalho ?? "Super+Alt+I").split("+");
  const tecla = partes[partes.length - 1];
  const tem = (m: string) => (partes.includes(m) ? "checked" : "");
  const opcoesTecla = TECLAS.map(
    (t) => `<option value="${t}" ${t === tecla ? "selected" : ""}>${t === "Space" ? "Espaço" : t}</option>`,
  ).join("");
  const cores = CORES_DESTAQUE.map(
    (c) =>
      `<button type="button" class="amostra ${c.cor === dados.config.corDestaque ? "ativa" : ""}" style="background:${c.cor}" aria-label="${c.nome}" title="${c.nome}" data-acao="cor" data-cor="${c.cor}"></button>`,
  ).join("") + arcoIris(dados.config.corDestaque, "destaque", CORES_DESTAQUE.some((c) => c.cor.toLowerCase() === dados.config.corDestaque.toLowerCase()));

  const raiz = html(`
    <div class="estado aberta tela">
      ${cabecalho("Ajustes")}
      <div class="segmentos abas-ajustes" role="tablist" aria-label="Partes dos ajustes">
        <button type="button" class="segmento" role="tab" data-acao="aba-ajustes" data-aba="geral">Geral</button>
        <button type="button" class="segmento" role="tab" data-acao="aba-ajustes" data-aba="voz">Voz</button>
        <button type="button" class="segmento" role="tab" data-acao="aba-ajustes" data-aba="ias">IAs e chaves</button>
        <button type="button" class="segmento" role="tab" data-acao="aba-ajustes" data-aba="sobre">Sobre</button>
      </div>

      <section class="secao" data-aba="geral">
        <p class="titulo-secao">Você</p>
        <div class="item">
          <div class="coluna"><span class="principal">Nome do robô</span><span class="secundario">Como ele se apresenta. Dá para chamar por esse nome (veja Voz, abaixo).</span></div>
          <input class="entrada curta2" name="nomeRobo" maxlength="20" value="${escapar(dados.config.nomeRobo)}" aria-label="Nome do robô">
        </div>
        <div class="item">
          <div class="coluna"><span class="principal">Como a ilha te chama</span></div>
          <input class="entrada curta2" name="nome" maxlength="30" value="${escapar(dados.config.nome)}" aria-label="Seu nome">
        </div>
        <div class="item">
          <div class="coluna"><span class="principal">Sua cidade</span><span class="secundario">Para mostrar o tempo agora na tela inicial. Em branco, não mostra.</span></div>
          <input class="entrada curta2" name="cidade" maxlength="60" value="${escapar(dados.config.cidade ?? "")}" placeholder="Ex.: Recife" aria-label="Sua cidade">
        </div>
        <div class="item">
          <div class="coluna"><span class="principal">Cor de destaque</span><span class="secundario">Botões e marcações. Os olhos do robô ficam com os personagens.</span></div>
          <div class="linha amostras">${cores}</div>
        </div>
      </section>

      <section class="secao" data-aba="geral">
        <p class="titulo-secao">Agenda</p>
        <div class="item">
          <div class="coluna"><span class="principal">Calendário da Apple ou Google Agenda</span><span class="secundario">${agendaEscolhida(dados).id ? `${nomeDaAgenda(dados)}: mandando para “${escapar(agendaEscolhida(dados).nome)}”.` : "Conecte sua agenda: a ilha lê seus compromissos e coloca lá vencimentos, renovações e tarefas com data."}</span></div>
          <button type="button" class="botao" data-acao="tela-calendario">${agendaEscolhida(dados).id ? "Abrir" : "Conectar"}</button>
        </div>
      </section>

      <section class="secao" data-aba="voz">
        <p class="titulo-secao">Voz</p>
        <div class="item">
          <div class="coluna"><span class="principal">Ler a resposta em voz alta</span><span class="secundario">Quando você pergunta falando (microfone vermelho).</span></div>
          <button type="button" class="chave" role="switch" aria-checked="${dados.config.falarRespostas}" aria-label="Ler a resposta em voz alta" data-acao="falar-respostas"><span></span></button>
        </div>
        <div class="item">
          <div class="coluna"><span class="principal">Continuar ouvindo depois de responder</span><span class="secundario">Conversa seguida, como numa assistente de voz. Para com silêncio ou com “tchau”/“obrigado”.</span></div>
          <button type="button" class="chave" role="switch" aria-checked="${dados.config.conversaContinua}" aria-label="Continuar ouvindo depois de responder" data-acao="conversa-continua"><span></span></button>
        </div>
        <div class="item">
          <div class="coluna"><span class="principal">Ouvido da ilha</span><span class="secundario situacao-ouvido">Conferindo…</span></div>
          <button type="button" class="botao" data-acao="baixar-ouvido" hidden>Tentar de novo</button>
        </div>
        <div class="item coluna-item">
          <div class="linha">
            <div class="coluna"><span class="principal">Testar o ouvido</span><span class="secundario resultado-teste-ouvido">Clique em Testar, espere o bip e fale uma frase. Mostra o microfone usado, o volume, o que ele entendeu e quanto demorou.</span></div>
            <button type="button" class="botao" data-acao="testar-ouvido">Testar</button>
          </div>
        </div>
        <div class="item coluna-item">
          <div class="coluna"><span class="principal">Jeito de entender</span><span class="secundario">No PC, rápido: grátis e sem internet. No PC, mais preciso: entende melhor frases difíceis, mas demora mais. Na nuvem: entende enquanto você fala (o mais rápido), pela ElevenLabs; gasta uns centavos por hora de fala e só o que vem depois do nome sai do PC. Sem internet, volta para o PC sozinho.</span><span class="secundario aviso-nuvem" hidden></span></div>
          <div class="segmentos" role="radiogroup" aria-label="Jeito de entender">
            <button type="button" class="segmento" role="radio" aria-checked="${!dados.config.ouvidoNuvem && !dados.config.ouvidoPreciso}" data-acao="ouvido-jeito" data-jeito="rapido">No PC, rápido</button>
            <button type="button" class="segmento" role="radio" aria-checked="${!dados.config.ouvidoNuvem && !!dados.config.ouvidoPreciso}" data-acao="ouvido-jeito" data-jeito="preciso">No PC, preciso</button>
            <button type="button" class="segmento" role="radio" aria-checked="${!!dados.config.ouvidoNuvem}" data-acao="ouvido-jeito" data-jeito="nuvem">Na nuvem</button>
          </div>
        </div>
        <div class="item">
          <div class="coluna"><span class="principal">Atender quando eu chamar pelo nome</span><span class="secundario">Diga “${escapar(dados.config.nomeRobo)}” (ou “${escapar(dados.config.nomeRobo)}, que horas são?”) e ele responde, com a ilha aberta ou fechada. O microfone fica ligado, mas tudo é entendido no próprio PC: nada sai do computador e só o que vem depois do nome vira pedido.</span></div>
          <button type="button" class="chave" role="switch" aria-checked="${dados.config.atenderPeloNome}" aria-label="Atender quando eu chamar pelo nome" data-acao="atender-nome"><span></span></button>
        </div>
        <div class="item">
          <div class="coluna"><span class="principal">Esperar eu terminar de falar</span><span class="secundario">Quanto silêncio encerra o pedido. “Com calma” é melhor para quem pausa para pensar; “Rápido” responde antes. Frases que param no meio (“abre a pasta do…”) sempre esperam o resto.</span></div>
          <div class="segmentos" role="radiogroup" aria-label="Esperar eu terminar de falar">
            ${[
              [900, "Rápido"],
              [1400, "Normal"],
              [2200, "Com calma"],
            ]
              .map(([ms, nome]) => `<button type="button" class="segmento" role="radio" aria-checked="${(dados.config.esperaFala ?? 1400) === ms}" data-acao="espera-fala" data-ms="${ms}">${nome}</button>`)
              .join("")}
          </div>
        </div>
        <div class="item">
          <div class="coluna"><span class="principal">Ditado em qualquer lugar</span><span class="secundario situacao-ditado">Em qualquer programa: aperte o atalho, fale, e aperte de novo para colar o texto onde está o cursor. Esc cancela.</span></div>
          <select class="entrada escolha-atalho-ditado" style="min-width: 200px" aria-label="Atalho do ditado">
            ${ATALHOS_DITADO.map((a) => `<option value="${a}" ${(dados.config.atalhoDitado || ATALHO_DITADO_PADRAO) === a ? "selected" : ""}>${atalhoLegivel(a)}</option>`).join("")}
          </select>
          <button type="button" class="chave" role="switch" aria-checked="${dados.config.ditadoLigado !== false}" aria-label="Ditado em qualquer lugar" data-acao="ditado-ligado"><span></span></button>
        </div>
        <div class="item coluna-item">
          <div class="coluna"><span class="principal">Dicionário</span><span class="secundario">Palavras que o ouvido costuma errar (nomes, clientes, siglas). Uma por linha. Se ele escreve de um jeito errado conhecido, ponha depois do “=”: <code>Claude Code = cloud code, clode code</code>. Vale para o ditado e para os pedidos.</span></div>
          <textarea class="entrada dicionario" rows="5" spellcheck="false" placeholder="Arcano&#10;Aleph&#10;Claude Code = cloud code, clode code">${escapar(dados.config.dicionario ?? "")}</textarea>
          <div class="linha"><span class="secundario resposta-dicionario"></span><span class="espaco"></span><button type="button" class="botao ciano" data-acao="salvar-dicionario">Salvar</button></div>
        </div>
        <div class="item">
          <div class="coluna"><span class="principal">Interromper sem fone</span><span class="secundario">Usa o cancelamento de eco das chamadas de vídeo: a voz do robô que sai na caixa de som é tirada do que o microfone ouve, então dá para chamar “${escapar(dados.config.nomeRobo)}” e interromper mesmo sem fone. Funciona melhor com a voz natural. Se não der certo no seu PC, desligue.</span></div>
          <button type="button" class="chave" role="switch" aria-checked="${dados.config.microfoneComEco !== false}" aria-label="Interromper sem fone" data-acao="microfone-eco"><span></span></button>
        </div>
        <div class="item">
          <div class="coluna"><span class="principal">Voz natural</span><span class="secundario">Voz humana, bem menos robótica. Se der erro, ele usa a voz do Windows.</span></div>
          <button type="button" class="chave" role="switch" aria-checked="${!!dados.config.vozNatural}" aria-label="Voz natural" data-acao="voz-natural"><span></span></button>
        </div>
        <div class="item linha-motor-voz" ${dados.config.vozNatural ? "" : "hidden"}>
          <div class="coluna"><span class="principal">De onde vem a voz</span><span class="secundario">Kokoro: grátis, feita no próprio PC, sem internet (baixa ~145 MB uma vez). ElevenLabs: a mais expressiva, paga, precisa da chave (em Chaves de IA, abaixo).</span></div>
          <div class="segmentos" role="radiogroup" aria-label="De onde vem a voz">
            <button type="button" class="segmento" role="radio" aria-checked="${(dados.config.vozMotor ?? "kokoro") === "kokoro"}" data-acao="motor-voz" data-motor="kokoro">Kokoro (grátis)</button>
            <button type="button" class="segmento" role="radio" aria-checked="${dados.config.vozMotor === "elevenlabs"}" data-acao="motor-voz" data-motor="elevenlabs">ElevenLabs</button>
          </div>
        </div>
        <div class="item linha-voz-kokoro" ${dados.config.vozNatural && (dados.config.vozMotor ?? "kokoro") === "kokoro" ? "" : "hidden"}>
          <div class="coluna"><span class="principal">Qual voz</span><span class="secundario situacao-kokoro">Conferindo…</span></div>
          <select class="entrada curta2 escolha-voz-kokoro" aria-label="Voz da Kokoro">
            <option value="dora" ${(dados.config.vozKokoro ?? "dora") === "dora" ? "selected" : ""}>Dora (feminina)</option>
            <option value="alex" ${dados.config.vozKokoro === "alex" ? "selected" : ""}>Alex (masculina)</option>
            <option value="santa" ${dados.config.vozKokoro === "santa" ? "selected" : ""}>Santa (masculina)</option>
          </select>
          <button type="button" class="botao" data-acao="testar-voz">Ouvir</button>
          <button type="button" class="botao" data-acao="baixar-kokoro" hidden>Tentar de novo</button>
        </div>
        <div class="item linha-voz-natural" ${dados.config.vozNatural && dados.config.vozMotor === "elevenlabs" ? "" : "hidden"}>
          <div class="coluna"><span class="principal">Qual voz</span><span class="secundario situacao-vozes-naturais">Carregando as vozes…</span></div>
          <select class="entrada curta2 escolha-voz-natural" aria-label="Voz da ElevenLabs"></select>
          <select class="entrada curta2 escolha-modelo-natural" aria-label="Qualidade">
            <option value="eleven_multilingual_v2">Natural</option>
            <option value="eleven_flash_v2_5">Econômica (rende o dobro)</option>
            <option value="eleven_v4_turbo">Mais expressiva</option>
          </select>
          <button type="button" class="botao" data-acao="testar-voz">Ouvir</button>
        </div>
        <div class="item">
          <div class="coluna"><span class="principal">Voz do Windows</span><span class="secundario">Usada sem a voz natural (ou se ela falhar). As “Natural” soam melhor (Configurações › Hora e idioma › Fala › Adicionar vozes).</span></div>
          <select class="entrada curta2 escolha-voz" aria-label="Voz"><option value="">Automática</option></select>
          <button type="button" class="botao" data-acao="testar-voz">Ouvir</button>
        </div>
        <div class="item coluna-item">
          <div class="linha linha-cheia">
            <div class="coluna"><span class="principal">Conferir a voz</span><span class="secundario">Vê se está tudo certo para ele ouvir você (microfone, permissão e o ouvido da ilha) e conserta o que faltar, sempre perguntando antes.</span></div>
            <button type="button" class="botao" data-acao="conferir-voz">Conferir</button>
          </div>
          <div class="lista-voz" aria-live="polite"></div>
        </div>
      </section>

      <section class="secao" data-aba="geral">
        <p class="titulo-secao">Modo discreto</p>
        <div class="item coluna-item">
          <span class="secundario">A ilha em repouso vira um risquinho no topo, para não tampar abas. Passe o mouse nele para ela crescer.</span>
          <div class="segmentos" role="radiogroup" aria-label="Modo discreto">
            ${(
              [
                ["desligado", "Desligado"],
                ["automatico", "Automático"],
                ["sempre", "Sempre"],
              ] as [ModoDiscreto, string][]
            )
              .map(
                ([v, t]) =>
                  `<button type="button" role="radio" class="segmento" aria-checked="${dados.config.modoDiscreto === v}" data-acao="discreto" data-modo="${v}">${t}</button>`,
              )
              .join("")}
          </div>
          <span class="secundario explica-discreto"></span>
        </div>
      </section>

      <section class="secao" data-aba="geral">
        <p class="titulo-secao">Atalho para abrir e fechar</p>
        <div class="item coluna-item">
          <span class="secundario">Agora: <strong class="atalho-atual">${atalhoLegivel(ctx.atalho)}</strong></span>
          <div class="linha atalho">
            <label class="marca"><input type="checkbox" name="Ctrl" ${tem("Ctrl")}>Ctrl</label>
            <label class="marca"><input type="checkbox" name="Alt" ${tem("Alt")}>Alt</label>
            <label class="marca"><input type="checkbox" name="Shift" ${tem("Shift")}>Shift</label>
            <label class="marca"><input type="checkbox" name="Super" ${tem("Super")}>Win</label>
            <span>+</span>
            <select name="tecla" class="entrada curta" aria-label="Tecla">${opcoesTecla}</select>
            <span class="espaco"></span>
            <button type="button" class="botao ciano" data-acao="atalho">Usar este</button>
          </div>
          <span class="secundario resposta-atalho">Combinações com a tecla Win quase nunca são usadas por outros programas.</span>
        </div>
      </section>

      <section class="secao" data-aba="geral">
        <p class="titulo-secao">Música</p>
        <div class="item">
          <div class="coluna"><span class="principal">Onde tocar o que eu pedir</span><span class="secundario">“Toca Djavan”, “coloca Oceano no Spotify”. No YouTube e no YouTube Music já começa tocando; no Apple Music abre a música certa (falta só o play); no Spotify e no Deezer abre a busca. Automático: Spotify ou Apple Music se estiver instalado, senão YouTube Music.</span></div>
          <select class="entrada curta2 escolha-musica" aria-label="Onde tocar música">
            ${[
              ["", "Automático"],
              ["spotify", "Spotify"],
              ["youtube-music", "YouTube Music"],
              ["youtube", "YouTube"],
              ["apple-music", "Apple Music"],
              ["deezer", "Deezer"],
            ]
              .map(([v, n]) => `<option value="${v}" ${(dados.config.musicaOnde ?? "") === v ? "selected" : ""}>${n}</option>`)
              .join("")}
          </select>
        </div>
      </section>

      <section class="secao" data-aba="geral">
        <p class="titulo-secao">Computador</p>
        ${interruptor("windows", "Abrir a ilha quando o Windows ligar")}
        ${interruptor("telacheia", "Esconder em jogos, vídeos e apresentações em tela cheia")}
        ${interruptor("musica", "Mostrar a música tocando na ilha fechada")}
        ${interruptor("somfesta", "Som de comemoração (junto com o confete)")}
      </section>

      <section class="secao" data-aba="ias">
        <p class="titulo-secao">Avisar quando terminar</p>
        ${interruptor("claude", NOMES.claude)}
        ${interruptor("codex", NOMES.codex)}
        ${interruptor("gemini", NOMES.gemini)}
      </section>

      <section class="secao" data-aba="ias">
        <p class="titulo-secao">Chaves de IA</p>
        <div class="item coluna-item chave-deepseek">
          <div class="linha">
            <div class="coluna">
              <span class="principal">DeepSeek</span>
              <span class="secundario situacao-chave">Conferindo…</span>
            </div>
            <button type="button" class="botao" data-acao="testar-chave" hidden>Testar</button>
            <button type="button" class="botao" data-acao="apagar-chave" hidden>Apagar</button>
          </div>
          <form class="linha form-chave">
            <input class="entrada" type="password" name="chave" placeholder="Cole aqui a chave (começa com sk-)" autocomplete="off" spellcheck="false" aria-label="Chave da DeepSeek">
            <button type="submit" class="botao ciano">Guardar</button>
          </form>
          <span class="secundario">Usada na tradução da tela e, depois, na conversa. Fica no cofre de senhas do Windows. <button type="button" class="link" data-acao="como-chave">Como pegar a chave</button></span>
        </div>
        <div class="item coluna-item chave-elevenlabs">
          <div class="linha">
            <div class="coluna">
              <span class="principal">ElevenLabs (voz natural)</span>
              <span class="secundario situacao-chave-el">Conferindo…</span>
            </div>
            <button type="button" class="botao" data-acao="testar-chave-el" hidden>Testar</button>
            <button type="button" class="botao" data-acao="apagar-chave-el" hidden>Apagar</button>
          </div>
          <form class="linha form-chave-el">
            <input class="entrada" type="password" name="chave" placeholder="Cole aqui a chave da ElevenLabs" autocomplete="off" spellcheck="false" aria-label="Chave da ElevenLabs">
            <button type="submit" class="botao ciano">Guardar</button>
          </form>
          <span class="secundario">Usada para ele falar com voz natural. Fica no cofre de senhas do Windows. <button type="button" class="link" data-acao="como-chave-el">Como pegar a chave</button></span>
        </div>
      </section>

      <section class="secao" data-aba="sobre">
        <p class="titulo-secao">Sobre</p>
        <div class="item">
          <div class="coluna"><span class="principal">Ilha versão ${escapar(ctx.versao)}</span><span class="secundario recado-atualizacao">Procura versões novas sozinha a cada 6 horas.</span></div>
          <button type="button" class="botao botao-atualizacao" data-acao="procurar">Procurar agora</button>
        </div>
        <div class="item">
          <div class="coluna"><span class="principal">Registro de erros</span><span class="secundario">Se algo der errado, mande esse arquivo para o Claude.</span></div>
          <button type="button" class="botao" data-acao="registros">Abrir pasta</button>
        </div>
      </section>
    </div>`);

  aoClicar(raiz, "voltar", () => ctx.irPara("inicio"));

  // Nome
  const nome = raiz.querySelector<HTMLInputElement>('[name="nome"]')!;
  nome.addEventListener("input", () => mudar((d) => (d.config.nome = nome.value.trim() || "Dan")));
  const cidade = raiz.querySelector<HTMLInputElement>('[name="cidade"]')!;
  cidade.addEventListener("change", () => mudar((d) => (d.config.cidade = cidade.value.trim() || undefined)));
  const nomeRobo = raiz.querySelector<HTMLInputElement>('[name="nomeRobo"]')!;
  nomeRobo.addEventListener("input", () => {
    mudar((d) => (d.config.nomeRobo = nomeRobo.value.trim() || "Robozinho"));
    const c = ler().config;
    if (c.atenderPeloNome) atenderPeloNome(true, c.nomeRobo).catch(() => {});
  });

  // Cor
  raiz.querySelector<HTMLInputElement>('input[data-cor-livre="destaque"]')?.addEventListener("change", (e) => {
    const cor = (e.target as HTMLInputElement).value;
    mudar((d) => (d.config.corDestaque = cor));
    aplicarCor(cor);
    ctx.renovar();
  });
  aoClicar(raiz, "cor", (b) => {
    const cor = b.dataset.cor!;
    mudar((d) => (d.config.corDestaque = cor));
    aplicarCor(cor);
    raiz.querySelectorAll(".amostra").forEach((a) => a.classList.toggle("ativa", a === b));
  });

  aoClicar(raiz, "tela-calendario", () => ctx.irPara("calendario"));

  // Voz
  aoClicar(raiz, "falar-respostas", (b) => {
    const ligado = !ler().config.falarRespostas;
    mudar((d) => (d.config.falarRespostas = ligado));
    b.setAttribute("aria-checked", String(ligado));
  });
  aoClicar(raiz, "conversa-continua", (b) => {
    const ligado = !ler().config.conversaContinua;
    mudar((d) => (d.config.conversaContinua = ligado));
    b.setAttribute("aria-checked", String(ligado));
  });
  aoClicar(raiz, "atender-nome", (b) => {
    const ligado = !ler().config.atenderPeloNome;
    mudar((d) => (d.config.atenderPeloNome = ligado));
    b.setAttribute("aria-checked", String(ligado));
    atenderPeloNome(ligado, ler().config.nomeRobo).catch(() => {});
    ajustarMicrofoneComEco();
  });
  raiz.querySelector<HTMLSelectElement>(".escolha-musica")!.addEventListener("change", (e) => {
    const v = (e.target as HTMLSelectElement).value as "" | "youtube-music" | "youtube" | "spotify" | "deezer" | "apple-music";
    mudar((d) => (d.config.musicaOnde = v || undefined));
  });
  aoClicar(raiz, "espera-fala", (b) => {
    const ms = Number(b.dataset.ms) || 1400;
    mudar((d) => (d.config.esperaFala = ms));
    raiz.querySelectorAll('[data-acao="espera-fala"]').forEach((s) => s.setAttribute("aria-checked", String(s === b)));
    definirEspera(ms).catch(() => {});
  });
  // Ditado em qualquer lugar e dicionário.
  const situacaoDitado = raiz.querySelector<HTMLElement>(".situacao-ditado")!;
  const escolhaAtalhoDitado = raiz.querySelector<HTMLSelectElement>(".escolha-atalho-ditado")!;
  const explicarDitado = (registrado: string | null) => {
    const c = ler().config;
    if (c.ditadoLigado === false) situacaoDitado.textContent = "Desligado.";
    else if (!registrado) situacaoDitado.textContent = "Nenhum desses atalhos está livre agora; escolha outro.";
    else {
      situacaoDitado.textContent = `Em qualquer programa: aperte ${atalhoLegivel(registrado)}, fale, e aperte de novo para colar onde está o cursor. Esc cancela.`;
      if (registrado !== escolhaAtalhoDitado.value) escolhaAtalhoDitado.value = registrado;
    }
  };
  const aplicarEExplicar = () => import("../../dados/dicionario").then((m) => m.aplicarDitado()).then(explicarDitado);
  void aplicarEExplicar();
  aoClicar(raiz, "ditado-ligado", (b) => {
    const ligado = ler().config.ditadoLigado === false;
    mudar((d) => (d.config.ditadoLigado = ligado));
    b.setAttribute("aria-checked", String(ligado));
    void aplicarEExplicar();
  });
  escolhaAtalhoDitado.addEventListener("change", () => {
    mudar((d) => (d.config.atalhoDitado = escolhaAtalhoDitado.value));
    void aplicarEExplicar();
  });
  aoClicar(raiz, "salvar-dicionario", () => {
    const texto = raiz.querySelector<HTMLTextAreaElement>(".dicionario")!.value;
    mudar((d) => (d.config.dicionario = texto));
    void aplicarEExplicar();
    import("../../dados/dicionario").then((m) => {
      const n = m.lerDicionario(texto).length;
      recadoTemporario(raiz.querySelector<HTMLElement>(".resposta-dicionario")!, n ? `Pronto: ${n} palavra(s).` : "Dicionário vazio.");
    });
  });
  aoClicar(raiz, "microfone-eco", (b) => {
    const ligado = ler().config.microfoneComEco === false;
    mudar((d) => (d.config.microfoneComEco = ligado));
    b.setAttribute("aria-checked", String(ligado));
    ajustarMicrofoneComEco();
  });
  // Voz natural (ElevenLabs)
  const linhaNatural = raiz.querySelector<HTMLElement>(".linha-voz-natural")!;
  const escolhaNatural = raiz.querySelector<HTMLSelectElement>(".escolha-voz-natural")!;
  const escolhaModelo = raiz.querySelector<HTMLSelectElement>(".escolha-modelo-natural")!;
  const situacaoVozes = raiz.querySelector<HTMLElement>(".situacao-vozes-naturais")!;
  escolhaModelo.value = ler().config.modeloElevenlabs || "eleven_multilingual_v2";
  const carregarVozesNaturais = () => {
    situacaoVozes.textContent = "Carregando as vozes…";
    vozesNaturais()
      .then((lista) => {
        const atual = ler().config.vozElevenlabs ?? "";
        escolhaNatural.innerHTML =
          '<option value="">Padrão (Sarah)</option>' +
          lista.map((v) => `<option value="${escapar(v.id)}" ${v.id === atual ? "selected" : ""}>${escapar(v.nome)}${v.descricao ? ` · ${escapar(v.descricao)}` : ""}</option>`).join("");
        situacaoVozes.textContent = lista.length ? "Todas falam português; cada uma tem um jeito." : "Escolha a voz e toque em Ouvir.";
      })
      .catch((erro: unknown) => (situacaoVozes.textContent = String(erro)));
  };
  // Kokoro: voz grátis no PC (baixa sozinha na primeira vez).
  const linhaMotor = raiz.querySelector<HTMLElement>(".linha-motor-voz")!;
  const linhaKokoro = raiz.querySelector<HTMLElement>(".linha-voz-kokoro")!;
  const situacaoKokoro = raiz.querySelector<HTMLElement>(".situacao-kokoro")!;
  const botaoBaixarKokoro = raiz.querySelector<HTMLButtonElement>('[data-acao="baixar-kokoro"]')!;
  const usaKokoro = () => (ler().config.vozMotor ?? "kokoro") === "kokoro";
  const mostrarVoz = () => {
    const c = ler().config;
    linhaMotor.hidden = !c.vozNatural;
    linhaKokoro.hidden = !(c.vozNatural && usaKokoro());
    linhaNatural.hidden = !(c.vozNatural && !usaKokoro());
    raiz.querySelectorAll<HTMLElement>('[data-acao="motor-voz"]').forEach((s) => s.setAttribute("aria-checked", String(s.dataset.motor === (c.vozMotor ?? "kokoro"))));
  };
  let acompanhando = 0;
  const acompanharKokoro = () => {
    window.clearInterval(acompanhando);
    const olhar = () =>
      estadoKokoro()
        .then((e) => {
          botaoBaixarKokoro.hidden = !(e.erro && !e.baixando && !e.pronta);
          if (e.pronta) {
            situacaoKokoro.textContent = "Pronta, no seu PC. As três falam português do Brasil.";
            window.clearInterval(acompanhando);
          } else if (e.baixando) {
            const mb = (n: number) => Math.round(n / 1_000_000);
            situacaoKokoro.textContent = `Baixando a voz: ${mb(e.baixado)} de ${mb(e.total)} MB. Enquanto isso, fala a voz do Windows.`;
          } else if (e.erro) {
            situacaoKokoro.textContent = e.erro;
            window.clearInterval(acompanhando);
          } else {
            situacaoKokoro.textContent = "Preparando…";
          }
        })
        .catch(() => {});
    olhar();
    acompanhando = window.setInterval(() => {
      if (!raiz.isConnected) return window.clearInterval(acompanhando);
      olhar();
    }, 1000);
  };
  const ligarKokoro = () => {
    prepararKokoro()
      .then(() => aquecerKokoro())
      .catch(() => {});
    acompanharKokoro();
  };
  if (ler().config.vozNatural) {
    if (usaKokoro()) acompanharKokoro();
    else carregarVozesNaturais();
  }
  aoClicar(raiz, "voz-natural", (b) => {
    const ligado = !ler().config.vozNatural;
    mudar((d) => (d.config.vozNatural = ligado));
    b.setAttribute("aria-checked", String(ligado));
    mostrarVoz();
    if (ligado && usaKokoro()) ligarKokoro();
    else if (ligado) carregarVozesNaturais();
  });
  aoClicar(raiz, "motor-voz", (b) => {
    const motor = b.dataset.motor === "elevenlabs" ? "elevenlabs" : "kokoro";
    mudar((d) => (d.config.vozMotor = motor));
    mostrarVoz();
    if (motor === "kokoro") ligarKokoro();
    else carregarVozesNaturais();
  });
  aoClicar(raiz, "baixar-kokoro", () => ligarKokoro());
  raiz.querySelector<HTMLSelectElement>(".escolha-voz-kokoro")!.addEventListener("change", (e) => {
    const voz = (e.target as HTMLSelectElement).value as "dora" | "alex" | "santa";
    mudar((d) => (d.config.vozKokoro = voz));
  });
  escolhaNatural.addEventListener("change", () => mudar((d) => (d.config.vozElevenlabs = escolhaNatural.value)));
  escolhaModelo.addEventListener("change", () => mudar((d) => (d.config.modeloElevenlabs = escolhaModelo.value)));

  const escolhaVoz = raiz.querySelector<HTMLSelectElement>(".escolha-voz")!;
  aoCarregarVozes(() => {
    const atual = ler().config.voz;
    escolhaVoz.innerHTML =
      '<option value="">Automática</option>' +
      vozesEmPortugues()
        .map((v) => `<option value="${escapar(v.voiceURI)}" ${v.voiceURI === atual ? "selected" : ""}>${escapar(v.name.replace(/^Microsoft /, ""))}</option>`)
        .join("");
  });
  escolhaVoz.addEventListener("change", () => mudar((d) => (d.config.voz = escolhaVoz.value)));
  aoClicar(raiz, "testar-voz", () =>
    falar(`Oi, ${ler().config.nome}! Eu sou ${ler().config.nomeRobo}. É assim que eu falo.`, () => {
      // A voz natural falhou e caiu na do Windows: mostra o porquê.
      if (ler().config.vozNatural && erroVozNatural) (usaKokoro() ? situacaoKokoro : situacaoVozes).textContent = erroVozNatural;
    }),
  );

  // Conferir a voz: cada item mostra ✓ ou o que falta, com "Consertar" (que pergunta antes).
  const listaVoz = raiz.querySelector<HTMLElement>(".lista-voz")!;
  type ItemVoz = { ok: boolean | null; texto: string; falta?: string; conserto?: string; explica?: string; botao?: string; nota?: string };
  let chamado: EstadoChamado = { ligado: false, escutando: false, erro: null, ouviu: null };
  /** O ouvido da ilha (Whisper) está instalado. */
  let ouvidoPronto = false;
  /** Texto do andamento da instalação do ouvido (para o "Conferir a voz"). */
  let situacaoOuvido = "";
  const itemChamado = (): ItemVoz => {
    const nome = ler().config.nomeRobo;
    if (!ler().config.atenderPeloNome)
      return {
        ok: false,
        texto: `Atender quando chamar “${nome}”`,
        falta: "Está desligado.",
        conserto: "ligar_chamado",
        botao: "Ligar",
        explica: `Vou ligar “Atender quando eu chamar pelo nome”: o microfone fica ligado ouvindo só “${nome}” (e “ei ${nome}”), reconhecido no próprio computador.`,
      };
    return {
      ok: chamado.escutando,
      texto: `Ouvindo o nome “${nome}”`,
      falta: chamado.erro ?? "Ainda não começou a ouvir. Espere uns segundos e confira de novo.",
      nota: chamado.ouviu ? `Última coisa que ouviu: ${chamado.ouviu}` : chamado.escutando ? "Diga o nome agora e confira de novo para ver se ele ouviu." : undefined,
    };
  };
  const itensVoz = (e: EstadoVoz): ItemVoz[] => [
    // O reconhecimento de fala do Windows não entra mais: ele não funciona num
    // programa comum como a ilha. Quem ouve é o ouvido da ilha (Whisper, no PC).
    { ok: e.microfone, texto: "Microfone ligado", falta: "Não achei microfone. Ligue um microfone ou um fone com microfone." },
    e.microfone_bloqueado_no_pc
      ? {
          ok: false,
          texto: "Microfone liberado",
          falta: "O microfone está bloqueado para o computador inteiro. Só dá para liberar nas Configurações do Windows.",
          conserto: "abrir_microfone",
          explica: "Vou abrir as Configurações do Windows na página do microfone. Ligue “Acesso ao microfone” e “Permitir que aplicativos da área de trabalho acessem o microfone”.",
          botao: "Abrir Configurações",
        }
      : {
          ok: e.microfone_liberado,
          texto: "Microfone liberado para a ilha",
          falta: "O Windows não deixa programas usarem o microfone.",
          conserto: "microfone",
          explica: "Vou liberar o microfone para os programas do computador, nas configurações de privacidade do Windows.",
        },
    ouvidoPronto
      ? { ok: true, texto: "Ouvido da ilha pronto (entende no próprio PC)" }
      : { ok: false, texto: "Ouvido da ilha", falta: situacaoOuvido || "Preparando sozinho. Quando terminar, a ilha avisa." },
    itemChamado(),
  ];
  const desenharVoz = (e: EstadoVoz, recado = "") => {
    const itens = itensVoz(e);
    const tudoCerto = itens.every((i) => i.ok);
    listaVoz.innerHTML =
      itens
        .map(
          (i, n) => `
        <div class="item-voz ${i.ok ? "certo" : i.ok === null ? "duvida" : "falta"}">
          <span class="marca-voz" aria-hidden="true">${i.ok ? "✓" : i.ok === null ? "?" : "✕"}</span>
          <div class="coluna"><span>${escapar(i.texto)}</span>${i.ok ? "" : `<span class="secundario">${escapar(i.ok === null ? "Não consegui conferir." : (i.falta ?? ""))}</span>`}${i.nota ? `<span class="secundario">${escapar(i.nota)}</span>` : ""}</div>
          ${!i.ok && i.conserto ? `<button type="button" class="botao" data-acao="consertar-voz" data-n="${n}">${escapar(i.botao ?? "Consertar")}</button>` : ""}
        </div>`,
        )
        .join("") +
      `<p class="secundario recado-voz">${escapar(recado || (tudoCerto ? "Tudo certo. Se ainda não ouvir, feche e abra a ilha." : ""))}</p>`;
    listaVoz.querySelectorAll<HTMLElement>('[data-acao="consertar-voz"]').forEach((b) =>
      b.addEventListener("click", () => {
        const item = itens[Number(b.dataset.n)];
        // Mexe no Windows: pergunta antes (o que vai acontecer e por quê).
        const linha = b.closest<HTMLElement>(".item-voz")!;
        linha.insertAdjacentHTML(
          "afterend",
          `<div class="confirma-voz"><p>${escapar(item.explica ?? "")}</p><div class="linha"><button type="button" class="botao ciano" data-sim>Sim, pode</button><button type="button" class="botao" data-nao>Agora não</button></div></div>`,
        );
        b.remove();
        const caixa = linha.nextElementSibling as HTMLElement;
        caixa.querySelector("[data-nao]")!.addEventListener("click", () => desenharVoz(e));
        caixa.querySelector("[data-sim]")!.addEventListener("click", async () => {
          caixa.innerHTML = `<p>${item.conserto === "pacote" ? "Baixando e instalando… pode levar alguns minutos. Pode continuar usando o computador." : "Mudando…"}</p>`;
          try {
            if (item.conserto === "ligar_chamado") {
              mudar((d) => (d.config.atenderPeloNome = true));
              raiz.querySelector('[data-acao="atender-nome"]')?.setAttribute("aria-checked", "true");
              await atenderPeloNome(true, ler().config.nomeRobo);
              await new Promise((r) => setTimeout(r, 2500));
              chamado = await estadoChamado();
              desenharVoz(await conferirVoz(), "Ligado. Diga o nome e confira de novo.");
              return;
            }
            await consertarVoz(item.conserto!);
            desenharVoz(
              await conferirVoz(),
              item.conserto === "pacote"
                ? "Pacote instalado. Feche e abra a ilha para ele começar a usar."
                : item.conserto === "idioma_pt"
                  ? "Pronto: português em primeiro, com o seu teclado. Na página Fala que abri, escolha Português (Brasil) em “Idioma de fala” e depois confira de novo."
                  : "Pronto.",
            );
          } catch (erro) {
            desenharVoz(await conferirVoz(), String(erro));
          }
        });
      }),
    );
  };
  // Ouvido da ilha (Whisper no PC): baixa sozinho; aqui só mostra como está.
  {
    const situacao = raiz.querySelector<HTMLElement>(".situacao-ouvido")!;
    const tentar = raiz.querySelector<HTMLButtonElement>('[data-acao="baixar-ouvido"]')!;
    const mb = (n: number) => `${Math.round(n / 1_000_000)} MB`;
    const mostrar = (e: EstadoOuvido) => {
      ouvidoPronto = e.pequeno && e.bom;
      tentar.hidden = !(e.erro && !e.baixando);
      if (e.pequeno && e.bom)
        situacao.textContent = `Pronto. Entende o que você fala no próprio PC, sem internet, com a ilha aberta ou fechada.${
          e.ultimo_ms
            ? e.pela_nuvem
              ? ` O último pedido (fala de ${(e.fala_ms / 1000).toFixed(1).replace(".", ",")} s) foi entendido na nuvem, ${(e.ultimo_ms / 1000).toFixed(1).replace(".", ",")} s depois de você parar de falar.`
              : ` O último pedido (fala de ${(e.fala_ms / 1000).toFixed(1).replace(".", ",")} s) foi entendido no PC em ${(e.ultimo_ms / 1000).toFixed(1).replace(".", ",")} s, usando ${e.nucleos} núcleos.`
            : ""
        }`;
      else if (e.baixando)
        situacao.textContent = `Preparando sozinho (${mb(e.baixado)} de ${mb(e.total)})… Quando terminar, a ilha avisa e a voz passa a funcionar. Pode continuar usando o computador.`;
      else if (e.erro) situacao.textContent = e.erro;
      else situacao.textContent = "Vai se preparar sozinho em instantes (uma vez só; as atualizações não baixam de novo).";
      if (ler().config.ouvidoNuvem && e.erro_nuvem) situacao.textContent += ` A nuvem falhou da última vez (${e.erro_nuvem}); entendi no PC.`;
      situacaoOuvido = situacao.textContent ?? "";
    };
    const atualizar = () => estadoOuvido().then(mostrar).catch(() => {});
    atualizar();
    const vigia = window.setInterval(() => (raiz.isConnected ? atualizar() : window.clearInterval(vigia)), 1500);
    const avisoNuvem = raiz.querySelector<HTMLElement>(".aviso-nuvem")!;
    const conferirChaveNuvem = () => {
      if (!ler().config.ouvidoNuvem) return void (avisoNuvem.hidden = true);
      temChave("elevenlabs")
        .then((tem) => {
          avisoNuvem.hidden = tem;
          avisoNuvem.textContent = "Falta guardar a chave da ElevenLabs (em Chaves de IA, mais abaixo). Até lá, ele entende no PC.";
        })
        .catch(() => {});
    };
    conferirChaveNuvem();
    aoClicar(raiz, "ouvido-jeito", (b) => {
      const jeito = b.dataset.jeito;
      const preciso = jeito === "preciso";
      const nuvem = jeito === "nuvem";
      mudar((d) => {
        d.config.ouvidoPreciso = preciso;
        d.config.ouvidoNuvem = nuvem;
      });
      raiz.querySelectorAll<HTMLElement>('[data-acao="ouvido-jeito"]').forEach((x) => x.setAttribute("aria-checked", String(x === b)));
      // Se o modelo escolhido ainda não foi baixado, a ilha baixa (a voz espera terminar).
      escolherOuvido(preciso, nuvem).catch(() => {});
      conferirChaveNuvem();
      window.setTimeout(atualizar, 500);
    });
    tentar.addEventListener("click", () => {
      tentar.hidden = true;
      situacao.textContent = "Tentando de novo…";
      baixarOuvido().catch(() => {}).finally(atualizar);
      window.setTimeout(atualizar, 800);
    });
  }

  // Teste do ouvido: microfone usado, volume, o que entendeu e quanto demorou.
  {
    const resultado = raiz.querySelector<HTMLElement>(".resultado-teste-ouvido")!;
    const fmt = (ms: number) => `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
    aoClicar(raiz, "testar-ouvido", (b) => {
      b.setAttribute("disabled", "");
      resultado.textContent = "Ouvindo… fale uma frase depois do bip.";
      testarOuvido()
        .then((t) => {
          const volume =
            t.pico < 0.02 ? "quase nada (o microfone certo está escolhido no Windows?)" : t.pico < 0.1 ? "baixo (fale mais perto)" : t.pico > 0.95 ? "alto demais (estourando)" : "bom";
          resultado.textContent = !t.fala_ms
            ? `Microfone: ${t.microfone || "?"}. Não chegou voz em 8 s. Volume ${volume}.`
            : `Microfone: ${t.microfone || "?"}. Volume ${volume}. Entendeu: “${t.texto || "(nada)"}” em ${fmt(t.ms)} ${t.pela_nuvem ? "na nuvem" : "no PC"}, para uma fala de ${fmt(t.fala_ms)}.${t.erro_nuvem && ler().config.ouvidoNuvem ? ` A nuvem falhou: ${t.erro_nuvem}.` : ""}`;
        })
        .catch((e) => (resultado.textContent = String(e)))
        .finally(() => b.removeAttribute("disabled"));
    });
  }

  aoClicar(raiz, "conferir-voz", async () => {
    listaVoz.innerHTML = '<p class="secundario">Conferindo…</p>';
    chamado = await estadoChamado();
    desenharVoz(await conferirVoz());
  });

  // Modo discreto
  const explica = raiz.querySelector<HTMLElement>(".explica-discreto")!;
  const textoDiscreto: Record<ModoDiscreto, string> = {
    desligado: "A ilha fica sempre do tamanho normal.",
    automatico: `Vira risquinho quando um destes estiver na frente, encostado no topo: ${Object.values(PROGRAMAS_COM_ABAS).join(", ")}.`,
    sempre: "Em repouso, a ilha é sempre um risquinho.",
  };
  explica.textContent = textoDiscreto[dados.config.modoDiscreto];
  aoClicar(raiz, "discreto", (b) => {
    const modo = b.dataset.modo as ModoDiscreto;
    mudar((d) => (d.config.modoDiscreto = modo));
    ctx.definirModoDiscreto(modo);
    raiz.querySelectorAll('[data-acao="discreto"]').forEach((s) => s.setAttribute("aria-checked", String(s === b)));
    explica.textContent = textoDiscreto[modo];
  });

  // Atalho
  const resposta = raiz.querySelector<HTMLElement>(".resposta-atalho")!;
  aoClicar(raiz, "atalho", () => {
    const mods = ["Ctrl", "Alt", "Shift", "Super"].filter(
      (m) => raiz.querySelector<HTMLInputElement>(`input[name="${m}"]`)!.checked,
    );
    if (!mods.length) {
      recadoTemporario(resposta, "Escolha pelo menos uma tecla entre Ctrl, Alt, Shift e Win.");
      return;
    }
    const escolhido = [...mods, raiz.querySelector<HTMLSelectElement>('[name="tecla"]')!.value].join("+");
    definirAtalho(escolhido)
      .then((registrado) => {
        ctx.definirAtalhoAtual(registrado);
        mudar((d) => (d.config.atalho = registrado));
        raiz.querySelector<HTMLElement>(".atalho-atual")!.textContent = atalhoLegivel(registrado);
        recadoTemporario(resposta, "Pronto! Esse é o atalho agora.");
      })
      .catch((erro: unknown) => recadoTemporario(resposta, String(erro), 5000));
  });

  // Interruptores
  const chave = (id: string) => {
    const item = raiz.querySelector<HTMLElement>(`[data-chave="${id}"]`)!;
    return {
      botao: item.querySelector<HTMLButtonElement>(".chave")!,
      situacao: item.querySelector<HTMLElement>(".situacao")!,
    };
  };
  const mostrarChave = (id: string, ligado: boolean, texto: string, habilitado = true) => {
    const { botao, situacao } = chave(id);
    botao.setAttribute("aria-checked", String(ligado));
    botao.disabled = !habilitado;
    delete botao.dataset.confirmando;
    botao.classList.remove("confirmando");
    situacao.textContent = texto;
  };

  // Iniciar com o Windows (só mexe na lista de inicialização do Windows; não precisa confirmar)
  const textoWindows = (ligado: boolean) =>
    ligado ? "Ligado: a ilha abre sozinha quando você liga o computador." : "Desligado.";
  iniciaComWindows()
    .then((ligado) => mostrarChave("windows", ligado, textoWindows(ligado)))
    .catch(() => mostrarChave("windows", false, textoWindows(false)));
  chave("windows").botao.addEventListener("click", (e) => {
    e.stopPropagation();
    const ligar = chave("windows").botao.getAttribute("aria-checked") !== "true";
    chave("windows").botao.disabled = true;
    definirInicioComWindows(ligar)
      .then(() => mostrarChave("windows", ligar, textoWindows(ligar)))
      .catch(() => mostrarChave("windows", !ligar, "Não consegui mudar agora."));
  });

  // Opções simples da ilha (salvas na hora).
  const opcaoSimples = (id: string, ligado: boolean, textos: [string, string], salvar: (v: boolean) => void) => {
    mostrarChave(id, ligado, textos[ligado ? 0 : 1]);
    chave(id).botao.addEventListener("click", (e) => {
      e.stopPropagation();
      const novo = chave(id).botao.getAttribute("aria-checked") !== "true";
      salvar(novo);
      mostrarChave(id, novo, textos[novo ? 0 : 1]);
    });
  };
  opcaoSimples("telacheia", dados.config.esconderTelaCheia, ["Ligado: some e volta sozinha.", "Desligado."], (v) => {
    mudar((d) => (d.config.esconderTelaCheia = v));
    esconderEmTelaCheia(v).catch(() => {});
  });
  opcaoSimples("musica", dados.config.musicaNaIlha, ["Ligado: nome da música e barrinhas na ilha.", "Desligado."], (v) => {
    mudar((d) => (d.config.musicaNaIlha = v));
  });
  opcaoSimples("somfesta", dados.config.somFesta !== false, ["Ligado: um “plim” curtinho ao concluir tarefas e metas.", "Desligado: só o confete."], (v) => {
    mudar((d) => (d.config.somFesta = v));
  });

  // Avisos dos programas de IA. Ligar coloca uma linha na configuração do
  // programa ("quando terminar, chame a ilha"); desligar tira. Dá para desfazer
  // e guardamos cópia do arquivo, então um clique basta.
  const textoAviso = (s: SituacaoAviso) =>
    !s.encontrado
      ? `Não encontrei o ${NOMES[s.programa]} neste computador.`
      : s.ligado
        ? "Ligado: a ilha avisa quando ele termina. Para isso, há uma linha na configuração dele (guardei cópia do original)."
        : "Desligado.";
  const situacoes = new Map<ProgramaIA, SituacaoAviso>();
  situacaoAvisos()
    .then((lista) =>
      lista.forEach((s) => {
        situacoes.set(s.programa, s);
        mostrarChave(s.programa, s.ligado, textoAviso(s), s.encontrado);
      }),
    )
    .catch(() => {});
  for (const programa of ["claude", "codex", "gemini"] as ProgramaIA[]) {
    const { botao } = chave(programa);
    botao.addEventListener("click", (e) => {
      e.stopPropagation();
      const atual = situacoes.get(programa);
      if (!atual) return;
      const ligar = !atual.ligado;
      botao.disabled = true;
      mudarAviso(programa, ligar)
        .then(() => {
          const novo = { ...atual, ligado: ligar };
          situacoes.set(programa, novo);
          mostrarChave(programa, ligar, textoAviso(novo));
        })
        .catch((erro: unknown) => mostrarChave(programa, atual.ligado, String(erro)));
    });
  }

  // Chave da DeepSeek: a interface só manda guardar/apagar; ler, só o Rust.
  const situacaoChave = raiz.querySelector<HTMLElement>(".situacao-chave")!;
  const botaoTestar = raiz.querySelector<HTMLElement>('[data-acao="testar-chave"]')!;
  const botaoApagar = raiz.querySelector<HTMLElement>('[data-acao="apagar-chave"]')!;
  const formChave = raiz.querySelector<HTMLFormElement>(".form-chave")!;
  const mostrarChaveIA = (tem: boolean, texto?: string) => {
    situacaoChave.textContent = texto ?? (tem ? "Chave guardada." : "Nenhuma chave guardada.");
    botaoTestar.hidden = !tem;
    botaoApagar.hidden = !tem;
    formChave.hidden = tem;
  };
  temChave("deepseek").then((t) => mostrarChaveIA(t)).catch(() => mostrarChaveIA(false));
  formChave.addEventListener("submit", (e) => {
    e.preventDefault();
    const campo = formChave.querySelector<HTMLInputElement>("input")!;
    salvarChave("deepseek", campo.value)
      .then(() => {
        campo.value = "";
        mostrarChaveIA(true, "Chave guardada. Testando…");
        return testarDeepseek();
      })
      .then((r) => mostrarChaveIA(true, `Chave guardada. ${r}`))
      .catch((erro: unknown) => mostrarChaveIA(true, String(erro)));
  });
  aoClicar(raiz, "testar-chave", () => {
    situacaoChave.textContent = "Testando…";
    testarDeepseek()
      .then((r) => (situacaoChave.textContent = r))
      .catch((erro: unknown) => (situacaoChave.textContent = String(erro)));
  });
  aoClicar(raiz, "apagar-chave", () => {
    apagarChave("deepseek")
      .then(() => mostrarChaveIA(false, "Chave apagada."))
      .catch(() => {});
  });
  aoClicar(raiz, "como-chave", () => {
    abrirPrograma("https://platform.deepseek.com/api_keys").catch(() => {});
  });

  // Chave da ElevenLabs (voz natural)
  const situacaoEl = raiz.querySelector<HTMLElement>(".situacao-chave-el")!;
  const formEl = raiz.querySelector<HTMLFormElement>(".form-chave-el")!;
  const botaoTestarEl = raiz.querySelector<HTMLButtonElement>('[data-acao="testar-chave-el"]')!;
  const botaoApagarEl = raiz.querySelector<HTMLButtonElement>('[data-acao="apagar-chave-el"]')!;
  const mostrarChaveEl = (tem: boolean, texto?: string) => {
    situacaoEl.textContent = texto ?? (tem ? "Chave guardada." : "Nenhuma chave guardada.");
    botaoTestarEl.hidden = !tem;
    botaoApagarEl.hidden = !tem;
    formEl.hidden = tem;
  };
  const testarEl = () =>
    vozesNaturais().then((lista) => `Funcionando: ${lista.length} vozes disponíveis.`);
  temChave("elevenlabs").then((t) => mostrarChaveEl(t)).catch(() => mostrarChaveEl(false));
  formEl.addEventListener("submit", (e) => {
    e.preventDefault();
    const campo = formEl.querySelector<HTMLInputElement>("input")!;
    salvarChave("elevenlabs", campo.value)
      .then(() => {
        campo.value = "";
        mostrarChaveEl(true, "Chave guardada. Testando…");
        return testarEl();
      })
      .then((r) => {
        mostrarChaveEl(true, `Chave guardada. ${r}`);
        if (ler().config.vozNatural) carregarVozesNaturais();
      })
      .catch((erro: unknown) => mostrarChaveEl(true, String(erro)));
  });
  aoClicar(raiz, "testar-chave-el", () => {
    situacaoEl.textContent = "Testando…";
    testarEl()
      .then((r) => (situacaoEl.textContent = r))
      .catch((erro: unknown) => (situacaoEl.textContent = String(erro)));
  });
  aoClicar(raiz, "apagar-chave-el", () => {
    apagarChave("elevenlabs")
      .then(() => mostrarChaveEl(false, "Chave apagada."))
      .catch(() => {});
  });
  aoClicar(raiz, "como-chave-el", () => {
    abrirPrograma("https://elevenlabs.io/app/settings/api-keys").catch(() => {});
  });

  // Procura e atualiza aqui mesmo (na Central, a ilha pequena fica escondida atrás).
  {
    const botao = raiz.querySelector<HTMLButtonElement>(".botao-atualizacao")!;
    const recado = raiz.querySelector<HTMLElement>(".recado-atualizacao")!;
    let achada: Novidade | null = null;
    botao.addEventListener("click", async () => {
      botao.disabled = true;
      if (achada) {
        const novidade = achada;
        recado.textContent = "Baixando a versão nova… a ilha fecha e reabre sozinha.";
        try {
          await novidade.instalar((f) => (recado.textContent = `Baixando ${Math.round(f * 100)}%… a ilha fecha e reabre sozinha.`));
        } catch {
          recado.textContent = "Não consegui instalar agora. Tente de novo daqui a pouco.";
          botao.disabled = false;
        }
        return;
      }
      botao.textContent = "Procurando…";
      try {
        achada = await procurar();
        if (achada) {
          recado.textContent = `Saiu a versão ${achada.versao}.`;
          botao.textContent = "Atualizar agora";
          botao.classList.add("ciano");
        } else {
          recado.textContent = `Você já tem a versão mais nova (${ctx.versao}).`;
          botao.textContent = "Procurar agora";
        }
      } catch {
        recado.textContent = "Não consegui procurar agora. Confira a internet e tente de novo.";
        botao.textContent = "Procurar agora";
      }
      botao.disabled = false;
    });
  }
  aoClicar(raiz, "registros", () => {
    abrirRegistros().catch(() => {});
  });
  // Abas: mostra só uma parte dos ajustes de cada vez (lembra a última).
  const mostrarAba = (aba: string) => {
    raiz.querySelectorAll<HTMLElement>("section[data-aba]").forEach((sec) => (sec.hidden = sec.dataset.aba !== aba));
    raiz.querySelectorAll<HTMLElement>('[data-acao="aba-ajustes"]').forEach((b) => {
      b.setAttribute("aria-selected", String(b.dataset.aba === aba));
      b.setAttribute("aria-checked", String(b.dataset.aba === aba));
    });
    try {
      localStorage.setItem("ilha-aba-ajustes", aba);
    } catch {
      // sem guardar: tudo bem
    }
  };
  let abaInicial = "geral";
  try {
    abaInicial = localStorage.getItem("ilha-aba-ajustes") || "geral";
  } catch {
    // sem guardar: começa em Geral
  }
  mostrarAba(["geral", "voz", "ias", "sobre"].includes(abaInicial) ? abaInicial : "geral");
  aoClicar(raiz, "aba-ajustes", (b) => mostrarAba(b.dataset.aba ?? "geral"));
  return raiz;
}
