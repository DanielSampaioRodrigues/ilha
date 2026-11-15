// Tela inicial da ilha aberta.
import { ler, mudar } from "../../dados/armazem";
import { diaEscrito, faltaEscrito, haQuanto, paraISO, pendentes, pertoDeRenovar, prazo, quandoEscrito } from "../../dados/datas";
import {
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
import type { Contexto } from "../contexto";
import { seloDa } from "../selos";
import { ICONES } from "../icones";
import { aoClicar, escapar, html, recadoTemporario } from "../ui";

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
        <img src="/robozinho.png" alt="" class="cabeca" width="52" height="52">
        <div class="coluna">
          <span class="saudacao">${saudacao()}, ${escapar(dados.config.nome || "Dan")}</span>
          <span class="secundario subtitulo">${ctx.atalho ? `${atalhoLegivel(ctx.atalho)} abre e fecha a ilha` : "Clique na carinha para abrir a ilha"}</span>
        </div>
        <button type="button" class="redondo" aria-label="Traduzir a tela" title="Traduzir a tela (Win+Alt+T)" data-acao="traduzir">${ICONES.traduzir}</button>
        <button type="button" class="redondo" aria-label="Digitar" data-acao="em-breve">${ICONES.teclado}</button>
        <button type="button" class="redondo grande vermelho" aria-label="Falar" data-acao="em-breve">${ICONES.microfone}</button>
      </header>
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
            ["pc", ICONES.pc, "Meu PC"],
            ["ajustes", ICONES.ajustes, "Ajustes"],
          ] as const
        )
          .map(([tela, icone, nome]) => `<button type="button" class="atalho-tela" data-acao="tela" data-tela="${tela}">${icone}<span>${nome}</span></button>`)
          .join("")}
      </nav>
    </div>`);

  const subtitulo = raiz.querySelector<HTMLElement>(".subtitulo")!;
  const recado = (texto: string, ms?: number) => recadoTemporario(subtitulo, texto, ms);
  if (ctx.mensagem) recado(ctx.mensagem, 5000);

  aoClicar(raiz, "em-breve", () => recado("Voz e conversa chegam nas próximas fases."));
  aoClicar(raiz, "tela", (b) => ctx.irPara(b.dataset.tela as never));
  aoClicar(raiz, "paguei", (b) => {
    mudar((d) => {
      const a = d.assinaturas.find((x) => x.id === b.dataset.id);
      const u = urgentes.find((x) => x.id === b.dataset.id);
      if (a && u) a.pagoAte = paraISO(u.vence);
    });
    ctx.renovar();
  });
  aoClicar(raiz, "traduzir", () => {
    ctx.fechar();
    traduzirTela().catch((erro) => recado(String(erro)));
  });

  aoClicar(raiz, "concluir", (b) => {
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
    if (m.capa) capa.innerHTML = `<img src="${m.capa}" alt="">`;
  };
  const conferir = async () => {
    try {
      const m = await midiaAtual(false);
      const chave = m ? `${m.titulo}|${m.artista}` : "";
      if (m && chave !== ultimo) {
        ultimo = chave;
        capa.innerHTML = ICONES.musica;
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
