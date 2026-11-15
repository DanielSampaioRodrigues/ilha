// Tela inicial da ilha aberta.
import { ler, mudar } from "../../dados/armazem";
import { haQuanto, pendentes, prazo, diaEscrito, quandoLembrete, paraISO } from "../../dados/datas";
import { abrirPrograma, atalhoLegivel, midiaAtual, midiaComando, type Midia } from "../../maos/sistema";
import type { Contexto } from "../contexto";
import { ICONES } from "../icones";
import { aoClicar, escapar, html, recadoTemporario } from "../ui";

function saudacao(): string {
  const hora = new Date().getHours();
  if (hora < 5) return "Boa noite";
  if (hora < 12) return "Bom dia";
  if (hora < 18) return "Boa tarde";
  return "Boa noite";
}

const ENGRENAGEM =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';

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

  const recentes = ctx.notificacoes.slice(0, 3);
  const lembretes = [...dados.lembretes].sort((a, b) => a.quando.localeCompare(b.quando)).slice(0, 3);
  const agenda =
    recentes.length || lembretes.length
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
        ${lembretes
          .map(
            (l) => `
          <div class="item">
            <span class="ponto amarelo"></span>
            <div class="coluna">
              <span class="principal">${escapar(l.titulo)}</span>
              <span class="secundario">${quandoLembrete(l, agora)}</span>
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
        <button type="button" class="redondo" aria-label="Digitar" data-acao="em-breve">${ICONES.teclado}</button>
        <button type="button" class="redondo grande vermelho" aria-label="Falar" data-acao="em-breve">${ICONES.microfone}</button>
      </header>
      ${atualizacao}
      ${precisa}
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
      <div class="lancador">
        ${apps}
        <button type="button" class="app" data-acao="tela" data-tela="apps">
          <span class="app-icone tracejado">${ICONES.mais}</span><span class="app-nome">Editar</span>
        </button>
      </div>
      <footer class="linha">
        <button type="button" class="botao" data-acao="tela" data-tela="notas">${ICONES.notas}Notas</button>
        <button type="button" class="botao" data-acao="tela" data-tela="avisos">${ICONES.cartao}Assinaturas</button>
        <button type="button" class="botao" data-acao="tela" data-tela="foco">${ICONES.relogio}Foco</button>
        <button type="button" class="redondo" aria-label="Ajustes" data-acao="tela" data-tela="ajustes">${ENGRENAGEM}</button>
        <span class="espaco"></span>
        <span class="versao">versão ${escapar(ctx.versao)}</span>
      </footer>
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
