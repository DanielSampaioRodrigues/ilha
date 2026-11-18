// A Central ("ilha grande"): a ilha cresce do topo num painel largo com menu
// lateral. A conversa com os motores mora aqui; as outras telas (tarefas,
// notas, assinaturas…) são as mesmas da ilha. Fecha com Esc, com o × ou ao
// clicar fora (a não ser que esteja presa com o alfinete); fechar só esconde,
// então as conversas continuam rodando e a ilha pequena avisa quando terminam.
import "./central.css";
import "./tema.css";
import { emit, listen } from "@tauri-apps/api/event";
import { aoMudarDeFora, carregar, ler, mudar } from "../dados/armazem";
import { carregarConversas } from "../dados/conversas";
import { atalhoAtual, esconderCentral, janelaDaFrente, modoJanelaCentral, responderPermissao, telaInicialCentral, type Midia } from "../maos/sistema";
import { oQueQuer } from "../corpo/estados";
import { conversas } from "../dados/conversas";
import { escapar } from "../corpo/ui";
import type { Pergunta } from "../corpo/contexto";
import { focoSeguro } from "../maos/foco";
import { aplicarCor } from "../corpo/tema";
import { versaoAtual } from "../atualizacao";
import { TELAS } from "../corpo/telas";
import { ICONES } from "../corpo/icones";
import { Carinha } from "../corpo/carinha";
import type { Contexto, NomeTela } from "../corpo/contexto";
import { dentroDoApp } from "../ponte";
import { abrirConversa, anexar, comecarNova, enviarPronto, importarConversa, montarConversa, pararPeloId } from "./conversa";
import { montarHoje } from "./hoje";
import type { Conversa } from "../dados/conversas";
import { montarProjetos } from "./projetos";
import { montarPerfis } from "./perfis";
import { montarFerramentas } from "./ferramentas";

type Secao = "hoje" | "conversa" | "projetos" | "perfis" | "ferramentas" | Exclude<NomeTela, "inicio" | "apps" | "conversa">;

const MENU: [Secao, string, string][] = [
  ["hoje", ICONES.relogio, "Hoje"],
  ["conversa", ICONES.teclado, "Conversa"],
  ["perfis", ICONES.personagem, "Perfis"],
  ["ferramentas", ICONES.ajustes, "MCPs e Skills"],
  ["projetos", ICONES.pasta, "Projetos"],
  ["memoria", ICONES.memoria, "Memória"],
  ["calendario", ICONES.calendario, "Calendário"],
  ["copiados", ICONES.copiar, "Copiados"],
  ["rotinas", ICONES.raio, "Rotinas"],
  ["tarefas", ICONES.tarefas, "Tarefas"],
  ["notas", ICONES.notas, "Notas"],
  ["avisos", ICONES.cartao, "Assinaturas"],
  ["redefinicoes", ICONES.renovar, "Redefinições"],
  ["habitos", ICONES.habitos, "Hábitos"],
  ["timers", ICONES.timer, "Timers"],
  ["foco", ICONES.relogio, "Foco"],
  ["textos", ICONES.textos, "Textos"],
  ["traducoes", ICONES.traduzir, "Traduções"],
  ["personagem", ICONES.personagem, "Personagem"],
  ["pc", ICONES.pc, "Meu PC"],
  ["ajustes", ICONES.ajustes, "Ajustes"],
];

/** O menu em grupos (fica mais fácil de achar); Ajustes fica embaixo, sempre à vista. */
const GRUPOS: [string, Secao[]][] = [
  ["IAs", ["conversa", "perfis", "ferramentas", "projetos", "memoria"]],
  ["Organização", ["calendario", "tarefas", "notas", "rotinas", "habitos", "timers", "foco"]],
  ["Contas", ["avisos", "redefinicoes"]],
  ["Ferramentas", ["copiados", "textos", "traducoes", "pc"]],
  ["Ilha", ["personagem"]],
];

function botaoMenu(id: Secao): string {
  const item = MENU.find(([s]) => s === id);
  if (!item) return "";
  const [, icone, nome] = item;
  // Cada item com a sua cor (como os ícones da ilha).
  const giro = (MENU.indexOf(item) * 360) / MENU.length;
  return `<button type="button" class="item-menu" data-secao="${id}" style="--giro:${giro.toFixed(0)}">${icone}<span>${nome}</span></button>`;
}

export async function iniciarCentral(): Promise<void> {
  document.body.classList.add("modo-central");
  if (!dentroDoApp) document.body.classList.add("navegador");
  await Promise.all([carregar(), carregarConversas()]);
  aplicarCor(ler().config.corDestaque);

  const palco = document.getElementById("palco")!;
  palco.innerHTML = `
    <div class="ilha-grande">
    <div class="central">
      <nav class="menu-central" aria-label="Seções">
        <div class="marca">
          <span class="marca-carinha"></span><span class="principal nome-robo"></span>
          <span class="espaco"></span>
          <span class="controles-grande">
          <button type="button" class="botao-icone soltar"></button>
          <button type="button" class="botao-icone alfinete" aria-pressed="false" title="Prender aberta (não fecha ao clicar fora)" aria-label="Prender aberta">${ICONES.alfinete}</button>
          <button type="button" class="botao-icone fechar-grande" title="Fechar (Esc)" aria-label="Fechar">${ICONES.fechar}</button>
          </span>
        </div>
        <div class="itens-menu">${botaoMenu("hoje")}${GRUPOS.map(
          ([titulo, itens]) => `<p class="grupo-menu">${titulo}</p>${itens.map(botaoMenu).join("")}`,
        ).join("")}</div>
        <div class="rodape-menu">${botaoMenu("ajustes")}</div>
      </nav>
      <main class="conteudo-central"></main>
    </div>
    <div class="perguntas-central" aria-live="assertive"></div>
    </div>`;
  const conteudo = palco.querySelector<HTMLElement>(".conteudo-central")!;
  const marca = palco.querySelector<HTMLElement>(".marca-carinha")!;
  const nomeRobo = palco.querySelector<HTMLElement>(".nome-robo")!;
  const desenharMarca = () => {
    marca.replaceChildren(new Carinha("normal", { tamanho: 2, comAcessorio: true }).elemento);
    nomeRobo.textContent = ler().config.nomeRobo;
  };
  desenharMarca();

  let secao: Secao = "conversa";
  let relogios: number[] = [];
  let versao = "";
  let atalho: string | null = null;
  versaoAtual().then((v) => (versao = v));
  atalhoAtual()
    .then((a) => (atalho = a))
    .catch(() => {});
  const conversaEl = montarConversa();

  const limpar = () => {
    relogios.forEach((r) => {
      window.clearTimeout(r);
      window.clearInterval(r);
    });
    relogios = [];
  };

  // As telas da ilha pedem um "contexto"; aqui ele manda recados para a ilha.
  const contexto = (): Contexto => ({
    tela: secao as NomeTela,
    ir: () => {},
    fechar: () => {},
    irPara: (t) => ir(t === "inicio" ? "hoje" : (t as Secao)),
    renovar: () => mostrar(),
    segurarAberta: (p) => p,
    depois: (f, ms) => relogios.push(window.setTimeout(f, ms)),
    aCada: (f, ms) => relogios.push(window.setInterval(f, ms)),
    versao,
    atalho,
    definirAtalhoAtual: (a) => {
      atalho = a;
      emit("ilha:atalho", a).catch(() => {});
    },
    novidade: null,
    procurarAtualizacao: () => emit("ilha:procurar-atualizacao").catch(() => {}),
    mensagem: null,
    notificacoes: [],
    notificacao: null,
    foco: null,
    dormindo: false,
    musica: null as Midia | null,
    volume: null,
    comecarFoco: (tipo, minutos) => emit("ilha:comecar-foco", { tipo, minutos }).catch(() => {}),
    pararFoco: () => emit("ilha:parar-foco").catch(() => {}),
    comecarTimer: (nome, minutos) => emit("ilha:comecar-timer", { nome, minutos }).catch(() => {}),
    definirModoDiscreto: (modo) => emit("ilha:modo-discreto", modo).catch(() => {}),
  });

  const mostrar = (animar = true) => {
    limpar();
    palco.querySelectorAll<HTMLElement>(".item-menu").forEach((b) => b.classList.toggle("ativo", b.dataset.secao === secao));
    if (secao === "hoje") {
      const pagina = document.createElement("div");
      pagina.className = "pagina pagina-hoje";
      pagina.append(
        montarHoje(
          {
            ir: (s) => ir(s as Secao),
            abrirConversa: (id) => {
              ir("conversa");
              abrirConversa(id);
            },
            novaConversa: () => {
              ir("conversa");
              comecarNova();
            },
            renovar: () => {
              const rolagem = conteudo.querySelector(".pagina-hoje")?.scrollTop ?? 0;
              mostrar(false);
              const nova = conteudo.querySelector(".pagina-hoje");
              if (nova) nova.scrollTop = rolagem;
            },
          },
          animar,
        ),
      );
      conteudo.replaceChildren(pagina);
      return;
    }
    if (secao === "conversa") {
      conteudo.replaceChildren(conversaEl);
      return;
    }
    if (secao === "projetos") {
      conteudo.replaceChildren(montarProjetos(mostrar));
      return;
    }
    if (secao === "perfis") {
      conteudo.replaceChildren(montarPerfis(mostrar));
      return;
    }
    if (secao === "ferramentas") {
      conteudo.replaceChildren(montarFerramentas(mostrar));
      return;
    }
    const pagina = document.createElement("div");
    pagina.className = "pagina pagina-tela";
    pagina.append(TELAS[secao].montar(contexto()));
    conteudo.replaceChildren(pagina);
  };

  const ir = (s: Secao) => {
    secao = MENU.some(([id]) => id === s) ? s : "hoje";
    // A Central volta nesta tela da próxima vez.
    try {
      localStorage.setItem("ilha-central-secao", secao);
    } catch {
      /* sem problema */
    }
    mostrar();
  };

  palco.querySelectorAll<HTMLElement>(".item-menu").forEach((b) =>
    b.addEventListener("click", () => ir(b.dataset.secao as Secao)),
  );
  // Luz que segue o mouse nos cartões (o tema.css desenha onde --mx/--my mandam).
  palco.addEventListener(
    "pointermove",
    (e) => {
      const cartao = (e.target as HTMLElement).closest?.<HTMLElement>(".item, .cartao-motor");
      if (!cartao) return;
      const r = cartao.getBoundingClientRect();
      cartao.style.setProperty("--mx", `${e.clientX - r.left}px`);
      cartao.style.setProperty("--my", `${e.clientY - r.top}px`);
    },
    { passive: true },
  );

  // Outra janela mudou os dados: redesenha (menos a conversa e as notas, para não atrapalhar quem digita).
  aoMudarDeFora(() => {
    aplicarCor(ler().config.corDestaque);
    desenharMarca();
    if (secao !== "conversa" && secao !== "notas") mostrar(false);
  });

  // ---------- Abrir e fechar como a ilha ----------
  const grande = palco.querySelector<HTMLElement>(".ilha-grande")!;
  const alfinete = palco.querySelector<HTMLButtonElement>(".alfinete")!;
  const soltar = palco.querySelector<HTMLButtonElement>(".soltar")!;
  let presa = false;
  // Solta (janela comum) ou junta (ilha grande); a escolha fica salva.
  let janela = ler().config.centralModo === "janela";
  const aplicarModo = () => {
    document.body.classList.toggle("central-janela", janela);
    soltar.innerHTML = janela ? ICONES.juntar : ICONES.soltar;
    soltar.title = janela ? "Juntar de volta à ilha" : "Soltar como janela";
    soltar.setAttribute("aria-label", soltar.title);
  };
  aplicarModo();
  if (janela) modoJanelaCentral(true).catch(() => {});
  let fechando = 0;
  const abrir = () => {
    window.clearTimeout(fechando);
    grande.classList.remove("crescida");
    void grande.offsetWidth; // recomeça a animação
    grande.classList.add("crescida");
  };
  const fechar = () => {
    if (janela) {
      esconderCentral().catch(() => {});
      return;
    }
    if (!grande.classList.contains("crescida")) return;
    grande.classList.remove("crescida");
    fechando = window.setTimeout(() => esconderCentral().catch(() => {}), 260);
  };
  alfinete.addEventListener("click", () => {
    presa = !presa;
    alfinete.setAttribute("aria-pressed", String(presa));
  });
  palco.querySelector(".fechar-grande")!.addEventListener("click", fechar);
  soltar.addEventListener("click", () => {
    janela = !janela;
    mudar((d) => (d.config.centralModo = janela ? "janela" : "ilha"));
    aplicarModo();
    modoJanelaCentral(janela).catch(() => {});
    if (!janela) abrir();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    // Esc fecha primeiro um menu aberto; depois, a ilha grande.
    const menu = palco.querySelector<HTMLDetailsElement>("details[open]");
    if (menu) menu.open = false;
    else if (!janela) fechar();
  });
  requestAnimationFrame(abrir);

  if (dentroDoApp) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    // O × da janela (ou Alt+F4) só esconde: as conversas continuam rodando.
    await getCurrentWindow().onCloseRequested((e) => {
      e.preventDefault();
      esconderCentral().catch(() => {});
    });
    const esta = getCurrentWindow();
    // Uma janela "intrusa" (terminal que um programa abriu sozinho) pegou o
    // foco: a Central espera ela sumir e pega o foco de volta. Se o Dan foi
    // para outra janela de verdade (ou a intrusa ficou aberta), aí fecha.
    let vigia = 0;
    const vigiarIntrusa = (intrusa: number) => {
      window.clearInterval(vigia);
      const inicio = Date.now();
      vigia = window.setInterval(async () => {
        if (document.hasFocus() || presa) return window.clearInterval(vigia);
        const f = await janelaDaFrente(intrusa).catch(() => null);
        if (!f || document.hasFocus()) return window.clearInterval(vigia);
        if (f.id === intrusa && f.anterior_existe) {
          if (Date.now() - inicio > 6000) {
            window.clearInterval(vigia);
            fechar();
          }
          return;
        }
        window.clearInterval(vigia);
        // A intrusa sumiu (o Windows passa o foco para qualquer janela) ou veio outra intrusa: volta.
        if (!f.anterior_existe || f.intrusa || f.id === 0) esta.setFocus().catch(() => {});
        else fechar();
      }, 250);
    };
    await esta.onFocusChanged(async ({ payload: comFoco }) => {
      if (comFoco || presa || janela) return;
      // Pergunta na hora: o terminal intruso pode piscar e sumir bem rápido.
      const agora = await janelaDaFrente().catch(() => null);
      if (agora?.intrusa) return vigiarIntrusa(agora.id);
      // Um instante de folga: janelas do Windows abertas daqui roubam o foco.
      window.setTimeout(async () => {
        if (presa || focoSeguro() || document.hasFocus()) return;
        const f = await janelaDaFrente().catch(() => null);
        if (document.hasFocus()) return;
        if (f?.intrusa) vigiarIntrusa(f.id);
        else fechar();
      }, 150);
    });
    await listen("central:abrir", abrir);
    // "Posso?" de uma IA: aparece aqui também (a ilha pequena pode estar coberta).
    const caixaPerguntas = palco.querySelector<HTMLElement>(".perguntas-central")!;
    await listen<Pergunta>("ilha:permissao", (e) => {
      const p = e.payload;
      const c = conversas().find((x) => x.id === p.conversa);
      const cartao = document.createElement("div");
      cartao.className = "pergunta-central";
      cartao.dataset.id = p.id;
      cartao.innerHTML = `
        <div class="coluna">
          <span class="principal">${escapar(c ? `${c.titulo || "Conversa"}: ` : "")}a IA quer ${escapar(oQueQuer(p.ferramenta))}</span>
          <pre class="detalhe-pergunta">${escapar(p.detalhe)}</pre>
        </div>
        <div class="linha">
          <button type="button" class="botao" data-resposta="nao">Não</button>
          <button type="button" class="botao ciano" data-resposta="sim">Sim, pode</button>
        </div>`;
      cartao.querySelectorAll<HTMLButtonElement>("[data-resposta]").forEach((b) =>
        b.addEventListener("click", () => {
          responderPermissao(p.id, b.dataset.resposta === "sim").catch(() => {});
          cartao.remove();
        }),
      );
      caixaPerguntas.append(cartao);
    });
    await listen<string>("ilha:permissao-fim", (e) => caixaPerguntas.querySelector(`[data-id="${CSS.escape(e.payload)}"]`)?.remove());
    await listen<string>("central:tela", (e) => {
      ir(e.payload as Secao);
      if (e.payload === "conversa") comecarNova();
    });
    await listen<{ id: string }>("central:parar", (e) => pararPeloId(e.payload.id));
    await listen<Conversa>("central:importar", (e) => {
      ir("conversa");
      importarConversa(e.payload);
    });
    // Pedido pronto vindo da ilha (ex.: fichamento de um PDF): conversa nova, já enviada.
    await listen<{ texto: string; anexos: string[] }>("central:enviar", (e) => {
      ir("conversa");
      enviarPronto(e.payload.texto, e.payload.anexos);
    });
    // Arquivos arrastados para a ilha chegam aqui.
    await listen<string[]>("central:anexar", (e) => {
      ir("conversa");
      anexar(e.payload);
    });
    // Arrastar arquivos para a janela da Central: anexa à conversa.
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    await getCurrentWebview().onDragDropEvent((e) => {
      const tipo = e.payload.type;
      document.body.classList.toggle("soltando", tipo === "enter" || tipo === "over");
      if (tipo === "drop") {
        ir("conversa");
        anexar(e.payload.paths);
      }
    });
  }
  const pedido = await telaInicialCentral().catch(() => ({ tela: null, anexos: [] as string[], conversa: null, mensagem: null }));
  let lembrada: string | null = null;
  try {
    lembrada = localStorage.getItem("ilha-central-secao");
  } catch {
    /* sem problema */
  }
  const inicial = pedido.tela ?? new URLSearchParams(location.search).get("secao") ?? lembrada;
  ir((inicial as Secao) ?? "hoje");
  // Primeira abertura (ilha recém-instalada): boas-vindas guiadas por cima.
  if (inicial === "boas-vindas" || ler().config.boasVindasFeita === false) {
    import("./boas-vindas").then((m) => m.mostrarBoasVindas(palco, () => ir("hoje")));
  }
  if (pedido.mensagem) enviarPronto(pedido.mensagem, pedido.anexos);
  else if (pedido.anexos.length) anexar(pedido.anexos);
  if (pedido.conversa) importarConversa(pedido.conversa as Conversa);
}
