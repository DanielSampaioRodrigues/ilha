// Ajustes: nome, cor, atalho, iniciar com o Windows, avisos dos programas de IA.
// Tudo que liga/desliga usa o mesmo interruptor: à direita, verde/cor = ligado.
import { ler, mudar, type ModoDiscreto } from "../../dados/armazem";
import { aoCarregarVozes, falar, vozesEmPortugues } from "../../maos/fala";
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
  type SituacaoAviso, atenderPeloNome } from "../../maos/sistema";
import { aplicarCor, CORES_DESTAQUE } from "../tema";
import type { Contexto } from "../contexto";
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
  ).join("");

  const raiz = html(`
    <div class="estado aberta tela">
      ${cabecalho("Ajustes")}

      <section class="secao">
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
          <div class="coluna"><span class="principal">Cor de destaque</span><span class="secundario">Botões e marcações. Os olhos do robô ficam com os personagens.</span></div>
          <div class="linha amostras">${cores}</div>
        </div>
      </section>

      <section class="secao">
        <p class="titulo-secao">Calendário da Apple</p>
        <div class="item">
          <div class="coluna"><span class="principal">Assinaturas, renovações e tarefas no iPhone</span><span class="secundario">${dados.config.icloudCalendario ? `Mandando para “${escapar(dados.config.icloudNomeCalendario)}”.` : "Conecte o iCloud para a ilha colocar tudo no seu calendário."}</span></div>
          <button type="button" class="botao" data-acao="tela-calendario">${dados.config.icloudCalendario ? "Abrir" : "Conectar"}</button>
        </div>
      </section>

      <section class="secao">
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
          <div class="coluna"><span class="principal">Atender quando eu chamar pelo nome</span><span class="secundario">Diga “${escapar(dados.config.nomeRobo)}” (ou “ei ${escapar(dados.config.nomeRobo)}”) e ele abre ouvindo. Deixa o microfone sempre ligado; o nome é reconhecido no próprio PC.</span></div>
          <button type="button" class="chave" role="switch" aria-checked="${dados.config.atenderPeloNome}" aria-label="Atender quando eu chamar pelo nome" data-acao="atender-nome"><span></span></button>
        </div>
        <div class="item">
          <div class="coluna"><span class="principal">Voz</span><span class="secundario">As do Windows. As “Natural” soam melhor (Configurações › Hora e idioma › Fala › Adicionar vozes).</span></div>
          <select class="entrada curta2 escolha-voz" aria-label="Voz"><option value="">Automática</option></select>
          <button type="button" class="botao" data-acao="testar-voz">Ouvir</button>
        </div>
      </section>

      <section class="secao">
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

      <section class="secao">
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

      <section class="secao">
        <p class="titulo-secao">Computador</p>
        ${interruptor("windows", "Abrir a ilha quando o Windows ligar")}
        ${interruptor("telacheia", "Esconder em jogos, vídeos e apresentações em tela cheia")}
        ${interruptor("musica", "Mostrar a música tocando na ilha fechada")}
      </section>

      <section class="secao">
        <p class="titulo-secao">Avisar quando terminar</p>
        ${interruptor("claude", NOMES.claude)}
        ${interruptor("codex", NOMES.codex)}
        ${interruptor("gemini", NOMES.gemini)}
      </section>

      <section class="secao">
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
      </section>

      <section class="secao">
        <p class="titulo-secao">Sobre</p>
        <div class="item">
          <div class="coluna"><span class="principal">Ilha versão ${escapar(ctx.versao)}</span><span class="secundario">Procura versões novas sozinha a cada 6 horas.</span></div>
          <button type="button" class="botao" data-acao="procurar">Procurar agora</button>
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
  const nomeRobo = raiz.querySelector<HTMLInputElement>('[name="nomeRobo"]')!;
  nomeRobo.addEventListener("input", () => {
    mudar((d) => (d.config.nomeRobo = nomeRobo.value.trim() || "Robozinho"));
    const c = ler().config;
    if (c.atenderPeloNome) atenderPeloNome(true, c.nomeRobo).catch(() => {});
  });

  // Cor
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
  });
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
  aoClicar(raiz, "testar-voz", () => falar(`Oi, ${ler().config.nome}! Eu sou ${ler().config.nomeRobo}. É assim que eu falo.`));

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
    raiz.querySelectorAll(".segmento").forEach((s) => s.setAttribute("aria-checked", String(s === b)));
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

  aoClicar(raiz, "procurar", () => ctx.procurarAtualizacao());
  aoClicar(raiz, "registros", () => {
    abrirRegistros().catch(() => {});
  });
  return raiz;
}
