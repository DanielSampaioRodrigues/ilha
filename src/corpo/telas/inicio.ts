// Tela inicial da ilha aberta.
import { ler, mudar } from "../../dados/armazem";
import { diaEscrito, faltaEscrito, haQuanto, paraISO, pendentes, pertoDeRenovar, prazo, quandoEscrito } from "../../dados/datas";
import {
  abrirCentral,
  abrirPrograma,
  atalhoLegivel,
  definirVolume,
  midiaAtual,
  midiaComando,
  traduzirTela,
  volumeAtual,
  type Midia,
} from "../../maos/sistema";
import { ordenar } from "./tarefas";
import { abrirComPedido, abrirOuvindo } from "./conversa";
import type { Contexto } from "../contexto";
import { seloDa } from "../selos";
import { ICONES } from "../icones";
import { confeteEm } from "../festa";
import { aoClicar, escapar, html, recadoTemporario } from "../ui";

/** Manhã, tarde ou noite: muda as cores da saudação. */
function periodo(): "manha" | "tarde" | "noite" {
  const hora = new Date().getHours();
  return hora >= 5 && hora < 12 ? "manha" : hora >= 12 && hora < 18 ? "tarde" : "noite";
}

/** "Quarta, 18 de novembro". */
function hojeEscrito(d: Date): string {
  const t = d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }).replace("-feira", "");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Um anel pequeno de progresso (0 a 1). */
function anel(fracao: number): string {
  const c = 2 * Math.PI * 7;
  return `<svg class="anel" viewBox="0 0 18 18" width="16" height="16" aria-hidden="true"><circle cx="9" cy="9" r="7" class="anel-fundo"/><circle cx="9" cy="9" r="7" class="anel-cheio" stroke-dasharray="${(c * Math.min(1, fracao)).toFixed(1)} ${c.toFixed(1)}"/></svg>`;
}

function saudacao(): string {
  const hora = new Date().getHours();
  if (hora < 5) return "Boa noite";
  if (hora < 12) return "Bom dia";
  if (hora < 18) return "Boa tarde";
  return "Boa noite";
}

export function montarInicio(ctx: Contexto): HTMLElement {
  const dados = ler();
  const agora = new Date();

  const atualizacao = ctx.novidade
    ? `
      <div class="item">
        <span class="ponto ciano"></span>
        <div class="coluna">
          <span class="principal">Nova versão da Ilha</span>
          <span class="secundario progresso-atualizacao">${ctx.novidade.versao} · instala e reabre sozinha</span>
        </div>
        <button type="button" class="botao ciano" data-acao="atualizar">Atualizar</button>
      </div>`
    : "";

  const urgentes = pendentes(dados.assinaturas, agora);
  const precisa = urgentes.length
    ? `
      <section class="secao">
        <p class="titulo-secao laranja">Precisa de você</p>
        ${urgentes
          .map(
            (a) => `
          <div class="item">
            <span class="ponto laranja"></span>
            <div class="coluna">
              <span class="principal">${escapar(a.nome)} · ${prazo(a.dias)}</span>
              <span class="secundario">${diaEscrito(a.vence)}${a.valor ? ` · ${escapar(a.valor)}` : ""}</span>
            </div>
            <button type="button" class="botao" data-acao="paguei" data-id="${a.id}">Paguei</button>
          </div>`,
          )
          .join("")}
      </section>`
    : "";

  const renovam = dados.redefinicoes
    .filter((r) => pertoDeRenovar(r, agora))
    .sort((a, b) => a.proxima.localeCompare(b.proxima));
  const secaoRenovam = renovam.length
    ? `
      <section class="secao">
        <p class="titulo-secao verde">Renovam em breve · aproveite</p>
        ${renovam
          .map((r) => {
            const quando = new Date(r.proxima);
            return `
          <div class="item">
            <span class="selo-caixa perto">${seloDa(r, 20)}</span>
            <div class="coluna">
              <span class="principal">${escapar(r.nome)} · renova ${faltaEscrito(quando, agora)}</span>
              <span class="secundario">${quandoEscrito(quando, agora)}</span>
            </div>
          </div>`;
          })
          .join("")}
      </section>`
    : "";

  // Tarefas para hoje (ou atrasadas) e as mais importantes.
  const fimDeHoje = `${paraISO(agora)}T23:59`;
  const paraHoje = ordenar(dados.tarefas)
    .filter((t) => !t.feita && ((t.quando && t.quando <= fimDeHoje) || t.prioridade >= 2))
    .slice(0, 3);
  const secaoTarefas = paraHoje.length
    ? `
      <section class="secao">
        <p class="titulo-secao">Tarefas de hoje</p>
        ${paraHoje
          .map(
            (t) => `
          <div class="item">
            <button type="button" class="circulo" aria-label="Concluir ${escapar(t.texto)}" data-acao="concluir" data-id="${t.id}"></button>
            <div class="coluna"><span class="principal">${t.prioridade ? `<span class="prioridade">${"!".repeat(t.prioridade)}</span>` : ""}${escapar(t.texto)}</span></div>
          </div>`,
          )
          .join("")}
      </section>`
    : "";

  const recentes = ctx.notificacoes.slice(0, 3);
  const agenda = recentes.length
    ? `
      <section class="secao">
        <p class="titulo-secao">Avisos</p>
        ${recentes
          .map(
            (n) => `
          <div class="item">
            <span class="verde">${ICONES.certo}</span>
            <div class="coluna">
              <span class="principal">${escapar(n.titulo)}</span>
              <span class="secundario">${escapar([n.detalhe, haQuanto(n.quando, agora)].filter(Boolean).join(" · "))}</span>
            </div>
          </div>`,
          )
          .join("")}
      </section>`
    : "";

  // Pílulas vivas: hábitos de hoje e timers correndo (tocar leva à tela).
  const dia = paraISO(agora);
  const metaHabitos = dados.habitos.reduce((n, h) => n + h.meta, 0);
  const feitosHabitos = dados.habitos.reduce((n, h) => n + Math.min(h.meta, h.registros[dia] ?? 0), 0);
  const timer = [...dados.timers].sort((a, b) => a.fim - b.fim)[0];
  const pilulas = [
    metaHabitos
      ? `<button type="button" class="pilula" data-acao="tela" data-tela="habitos">${anel(feitosHabitos / metaHabitos)}Hábitos ${feitosHabitos}/${metaHabitos}</button>`
      : "",
    timer
      ? `<button type="button" class="pilula" data-acao="tela" data-tela="timers">${ICONES.timer}${escapar(timer.nome)} · ${Math.max(1, Math.ceil((timer.fim - agora.getTime()) / 60_000))} min</button>`
      : "",
    paraHoje.length ? `<button type="button" class="pilula" data-acao="tela" data-tela="tarefas">${ICONES.tarefas}${paraHoje.length === 3 ? "3+" : paraHoje.length} para hoje</button>` : "",
  ].join("");

  const apps = dados.apps
    .slice(0, 7)
    .map(
      (app) => `
      <button type="button" class="app" data-acao="lancar" data-id="${app.id}" title="${escapar(app.caminho)}">
        <span class="app-icone" style="color:${app.cor}">${escapar(app.nome.charAt(0).toUpperCase())}</span>
        <span class="app-nome">${escapar(app.nome)}</span>
      </button>`,
    )
    .join("");

  const raiz = html(`
    <div class="estado aberta">
      <header class="linha">
        ${dados.config.cabecaAberta === "carinha" ? '<span class="cabeca-carinha"><i data-carinha="feliz" data-tamanho="3" data-acessorio></i></span>' : '<img src="/robozinho.png" alt="" class="cabeca" width="52" height="52">'}
        <div class="coluna">
          <span class="saudacao" data-periodo="${periodo()}">${saudacao()}, ${escapar(dados.config.nome || "Dan")}</span>
          <span class="secundario subtitulo" title="${ctx.atalho ? `${atalhoLegivel(ctx.atalho)} abre e fecha a ilha` : "Clique na carinha para abrir a ilha"}">${hojeEscrito(agora)}</span>
        </div>
        <button type="button" class="redondo" aria-label="Traduzir a tela" title="Traduzir a tela (Win+Alt+T)" data-acao="traduzir">${ICONES.traduzir}</button>
        <button type="button" class="redondo" aria-label="Abrir a Central" title="Abrir a Central (ilha grande)" data-acao="central">${ICONES.central}</button>
        <button type="button" class="redondo" aria-label="Conversar" title="Conversar aqui na ilha" data-acao="digitar">${ICONES.teclado}</button>
        <button type="button" class="redondo grande vermelho" aria-label="Falar" title="Falar com a IA" data-acao="falar">${ICONES.microfone}</button>
      </header>
      <div class="busca-rapida" hidden>
        ${ICONES.raio}
        <input class="entrada-busca" aria-label="Buscar uma ferramenta ou pedir algo à IA" autocomplete="off" spellcheck="false">
        <span class="dica-busca"></span>
      </div>
      ${pilulas ? `<div class="pilulas">${pilulas}</div>` : ""}
      ${atualizacao}
      ${precisa}
      ${secaoTarefas}
      ${secaoRenovam}
      ${agenda}
      <div class="item musica" hidden>
        <span class="capa">${ICONES.musica}</span>
        <div class="coluna">
          <span class="principal musica-titulo"></span>
          <span class="secundario musica-artista"></span>
        </div>
        <button type="button" class="redondo" aria-label="Anterior" data-acao="anterior">${ICONES.anterior}</button>
        <button type="button" class="redondo claro" aria-label="Tocar ou pausar" data-acao="alternar">${ICONES.pausar}</button>
        <button type="button" class="redondo" aria-label="Próxima" data-acao="proxima">${ICONES.proxima}</button>
      </div>
      <div class="item volume-item">
        <button type="button" class="redondo" aria-label="Silenciar" data-acao="mudo">${ICONES.som}</button>
        <input type="range" class="deslizante" min="0" max="100" step="1" value="50" aria-label="Volume">
        <span class="secundario volume-num">—</span>
      </div>
      <div class="lancador">
        ${apps}
        <button type="button" class="app" data-acao="tela" data-tela="apps">
          <span class="app-icone tracejado">${ICONES.mais}</span><span class="app-nome">Editar</span>
        </button>
      </div>
      <nav class="atalhos" aria-label="Atalhos">
        ${(
          [
            ["tarefas", ICONES.tarefas, "Tarefas"],
            ["notas", ICONES.notas, "Notas"],
            ["avisos", ICONES.cartao, "Assinaturas"],
            ["redefinicoes", ICONES.renovar, "Redefinições"],
            ["foco", ICONES.relogio, "Foco"],
            ["timers", ICONES.timer, "Timers"],
            ["habitos", ICONES.habitos, "Hábitos"],
            ["textos", ICONES.textos, "Textos"],
            ["traducoes", ICONES.traduzir, "Traduções"],
            ["personagem", ICONES.personagem, "Personagem"],
            ["copiados", ICONES.copiar, "Copiados"],
            ["rotinas", ICONES.raio, "Rotinas"],
            ["memoria", ICONES.memoria, "Memória"],
            ["calendario", ICONES.calendario, "Calendário"],
            ["pc", ICONES.pc, "Meu PC"],
            ["ajustes", ICONES.ajustes, "Ajustes"],
          ] as const
        )
          .map(
            ([tela, icone, nome], i) =>
              `<button type="button" class="atalho-tela" data-acao="tela" data-tela="${tela}" style="--giro:${i * 22.5};--i:${i}" title="${nome}"><span class="icone-atalho">${icone}</span><span class="nome-atalho">${nome}</span></button>`,
          )
          .join("")}
      </nav>
    </div>`);

  const subtitulo = raiz.querySelector<HTMLElement>(".subtitulo")!;
  const recado = (texto: string, ms?: number) => recadoTemporario(subtitulo, texto, ms);
  if (ctx.mensagem) recado(ctx.mensagem, 5000);

  // Começou a digitar na tela inicial: busca as ferramentas e os programas
  // na hora; Enter abre o primeiro, ou manda o texto para a IA.
  const busca = raiz.querySelector<HTMLElement>(".busca-rapida")!;
  const campoBusca = busca.querySelector<HTMLInputElement>("input")!;
  const dicaBusca = busca.querySelector<HTMLElement>(".dica-busca")!;
  const semAcento = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const candidatos = [...raiz.querySelectorAll<HTMLElement>(".atalho-tela, .lancador .app")];
  let primeiro: HTMLElement | null = null;
  const filtrar = () => {
    const q = semAcento(campoBusca.value);
    primeiro = null;
    for (const c of candidatos) {
      const nome = semAcento(c.textContent ?? "");
      const bate = !q || nome.includes(q);
      c.classList.toggle("fora-da-busca", !bate);
      c.classList.remove("primeiro-da-busca");
      if (q && bate && !primeiro) primeiro = c;
    }
    primeiro?.classList.add("primeiro-da-busca");
    raiz.classList.toggle("buscando", !!q);
    dicaBusca.textContent = !q ? "" : primeiro ? `Enter abre ${primeiro.textContent?.trim()}` : "Enter pergunta à IA";
  };
  const fecharBusca = () => {
    campoBusca.value = "";
    busca.hidden = true;
    filtrar();
  };
  campoBusca.addEventListener("input", () => (campoBusca.value ? filtrar() : fecharBusca()));
  campoBusca.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      fecharBusca();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const texto = campoBusca.value.trim();
      if (!texto) return;
      if (primeiro) primeiro.click();
      else {
        abrirComPedido(texto);
        ctx.irPara("conversa");
      }
    }
  });
  const aoDigitar = (e: KeyboardEvent) => {
    if (!raiz.isConnected) return document.removeEventListener("keydown", aoDigitar);
    const alvo = e.target as HTMLElement;
    if (e.ctrlKey || e.altKey || e.metaKey || e.key.length !== 1 || /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName) || alvo.isContentEditable) return;
    busca.hidden = false;
    campoBusca.focus();
  };
  document.addEventListener("keydown", aoDigitar);

  // Brincadeira: clicar no personagem faz ele dar um pulinho (com confete).
  const cabeca = raiz.querySelector<HTMLElement>(".cabeca-carinha, .cabeca");
  cabeca?.addEventListener("click", () => {
    cabeca.classList.remove("pulinho");
    void cabeca.offsetWidth;
    cabeca.classList.add("pulinho");
    window.setTimeout(() => confeteEm(cabeca, 14), 220);
  });

  aoClicar(raiz, "falar", () => {
    abrirOuvindo();
    ctx.irPara("conversa");
  });
  aoClicar(raiz, "tela", (b) => ctx.irPara(b.dataset.tela as never));
  aoClicar(raiz, "paguei", (b) => {
    mudar((d) => {
      const a = d.assinaturas.find((x) => x.id === b.dataset.id);
      const u = urgentes.find((x) => x.id === b.dataset.id);
      if (a && u) a.pagoAte = paraISO(u.vence);
    });
    ctx.renovar();
  });
  aoClicar(raiz, "digitar", () => ctx.irPara("conversa"));
  aoClicar(raiz, "central", () => {
    ctx.fechar();
    // Sem tela: a Central volta onde o Dan deixou.
    abrirCentral().catch(() => {});
  });

  aoClicar(raiz, "traduzir", () => {
    ctx.fechar();
    traduzirTela().catch((erro) => recado(String(erro)));
  });

  aoClicar(raiz, "concluir", (b) => {
    confeteEm(b);
    mudar((d) => {
      const t = d.tarefas.find((x) => x.id === b.dataset.id);
      if (t) t.feita = true;
    });
    ctx.renovar();
  });

  // Volume do Windows.
  const deslizante = raiz.querySelector<HTMLInputElement>(".deslizante")!;
  const numero = raiz.querySelector<HTMLElement>(".volume-num")!;
  const botaoMudo = raiz.querySelector<HTMLElement>('[data-acao="mudo"]')!;
  let mudo = false;
  const mostrarVolume = (nivel: number, estaMudo: boolean) => {
    mudo = estaMudo;
    deslizante.value = String(nivel);
    numero.textContent = estaMudo ? "mudo" : `${nivel}%`;
    botaoMudo.innerHTML = estaMudo ? ICONES.mudo : ICONES.som;
    deslizante.style.setProperty("--nivel", `${estaMudo ? 0 : nivel}%`);
  };
  volumeAtual()
    .then((v) => (v ? mostrarVolume(v.nivel, v.mudo) : (raiz.querySelector<HTMLElement>(".volume-item")!.hidden = true)))
    .catch(() => {});
  deslizante.addEventListener("input", () => {
    const nivel = Number(deslizante.value);
    mostrarVolume(nivel, false);
    definirVolume(nivel, false).catch(() => {});
  });
  aoClicar(raiz, "mudo", () => {
    mostrarVolume(Number(deslizante.value), !mudo);
    definirVolume(undefined, mudo).catch(() => {});
  });

  aoClicar(raiz, "lancar", (b) => {
    const app = dados.apps.find((x) => x.id === b.dataset.id);
    if (!app) return;
    abrirPrograma(app.caminho)
      .then(() => ctx.fechar())
      .catch((erro) => recado(String(erro)));
  });

  const novidade = ctx.novidade;
  aoClicar(raiz, "atualizar", (botao) => {
    if (!novidade) return;
    const progresso = raiz.querySelector<HTMLElement>(".progresso-atualizacao")!;
    (botao as HTMLButtonElement).disabled = true;
    botao.textContent = "Baixando…";
    novidade
      .instalar((fracao) => {
        progresso.textContent = `${novidade.versao} · ${Math.round(fracao * 100)}% baixado`;
      })
      .catch(() => {
        (botao as HTMLButtonElement).disabled = false;
        botao.textContent = "Tentar de novo";
        progresso.textContent = "Não consegui atualizar agora. Confira a internet.";
      });
  });

  // Música: confere a cada 2 segundos o que está tocando no Windows.
  const musica = raiz.querySelector<HTMLElement>(".musica")!;
  const titulo = raiz.querySelector<HTMLElement>(".musica-titulo")!;
  const artista = raiz.querySelector<HTMLElement>(".musica-artista")!;
  const capa = raiz.querySelector<HTMLElement>(".capa")!;
  const botaoTocar = raiz.querySelector<HTMLElement>('[data-acao="alternar"]')!;
  let ultimo = "";
  const mostrar = (m: Midia | null) => {
    musica.hidden = !m;
    if (!m) return;
    titulo.textContent = m.titulo;
    artista.textContent = m.artista || "tocando agora";
    botaoTocar.innerHTML = m.tocando ? ICONES.pausar : ICONES.tocar;
    botaoTocar.setAttribute("aria-label", m.tocando ? "Pausar" : "Tocar");
    if (m.capa) {
      capa.innerHTML = `<img src="${m.capa}" alt="">`;
      // A capa do disco, borrada, vira o fundo do cartão da música.
      musica.style.setProperty("--capa", `url("${m.capa}")`);
      musica.classList.add("com-capa");
    }
  };
  const conferir = async () => {
    try {
      const m = await midiaAtual(false);
      const chave = m ? `${m.titulo}|${m.artista}` : "";
      if (m && chave !== ultimo) {
        ultimo = chave;
        capa.innerHTML = ICONES.musica;
        musica.classList.remove("com-capa");
        mostrar((await midiaAtual(true)) ?? m);
      } else {
        if (!m) ultimo = "";
        mostrar(m);
      }
    } catch {
      musica.hidden = true;
    }
  };
  conferir();
  ctx.aCada(conferir, 2000);
  for (const acao of ["alternar", "proxima", "anterior"] as const) {
    aoClicar(raiz, acao, () => {
      midiaComando(acao)
        .catch(() => {})
        .finally(() => window.setTimeout(conferir, 400));
    });
  }

  return raiz;
}
