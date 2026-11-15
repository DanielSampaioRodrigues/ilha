// A Central: janela grande com menu lateral. A conversa com os motores mora
// aqui; as outras telas (tarefas, notas, assinaturas…) são as mesmas da ilha.
import "./central.css";
import { emit, listen } from "@tauri-apps/api/event";
import { aoMudarDeFora, carregar, ler } from "../dados/armazem";
import { carregarConversas } from "../dados/conversas";
import { atalhoAtual, telaInicialCentral, type Midia } from "../maos/sistema";
import { aplicarCor } from "../corpo/tema";
import { versaoAtual } from "../atualizacao";
import { TELAS } from "../corpo/telas";
import { ICONES } from "../corpo/icones";
import { Carinha } from "../corpo/carinha";
import type { Contexto, NomeTela } from "../corpo/contexto";
import { dentroDoApp } from "../ponte";
import { comecarNova, montarConversa, pararPeloId } from "./conversa";
import { montarProjetos } from "./projetos";

type Secao = "conversa" | "projetos" | Exclude<NomeTela, "inicio" | "apps">;

const MENU: [Secao, string, string][] = [
  ["conversa", ICONES.teclado, "Conversa"],
  ["projetos", ICONES.pasta, "Projetos"],
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

export async function iniciarCentral(): Promise<void> {
  document.body.classList.add("modo-central");
  await Promise.all([carregar(), carregarConversas()]);
  aplicarCor(ler().config.corDestaque);

  const palco = document.getElementById("palco")!;
  palco.innerHTML = `
    <div class="central">
      <nav class="menu-central" aria-label="Seções">
        <div class="marca"><span class="marca-carinha"></span><span class="principal nome-robo"></span></div>
        <div class="itens-menu">${MENU.map(
          ([id, icone, nome]) => `<button type="button" class="item-menu" data-secao="${id}">${icone}<span>${nome}</span></button>`,
        ).join("")}</div>
      </nav>
      <main class="conteudo-central"></main>
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
    irPara: (t) => ir(t === "inicio" ? "conversa" : (t as Secao)),
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

  const mostrar = () => {
    limpar();
    palco.querySelectorAll<HTMLElement>(".item-menu").forEach((b) => b.classList.toggle("ativo", b.dataset.secao === secao));
    if (secao === "conversa") {
      conteudo.replaceChildren(conversaEl);
      return;
    }
    if (secao === "projetos") {
      conteudo.replaceChildren(montarProjetos(mostrar));
      return;
    }
    const pagina = document.createElement("div");
    pagina.className = "pagina pagina-tela";
    pagina.append(TELAS[secao].montar(contexto()));
    conteudo.replaceChildren(pagina);
  };

  const ir = (s: Secao) => {
    secao = MENU.some(([id]) => id === s) ? s : "conversa";
    mostrar();
  };

  palco.querySelectorAll<HTMLElement>(".item-menu").forEach((b) =>
    b.addEventListener("click", () => ir(b.dataset.secao as Secao)),
  );

  // Outra janela mudou os dados: redesenha (menos a conversa e as notas, para não atrapalhar quem digita).
  aoMudarDeFora(() => {
    aplicarCor(ler().config.corDestaque);
    desenharMarca();
    if (secao !== "conversa" && secao !== "notas") mostrar();
  });

  if (dentroDoApp) {
    await listen<string>("central:tela", (e) => {
      ir(e.payload as Secao);
      if (e.payload === "conversa") comecarNova();
    });
    await listen<{ id: string }>("central:parar", (e) => pararPeloId(e.payload.id));
  }
  const inicial = (await telaInicialCentral().catch(() => null)) ?? new URLSearchParams(location.search).get("secao");
  ir((inicial as Secao) ?? "conversa");
}
