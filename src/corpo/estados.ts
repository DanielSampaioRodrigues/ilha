// O que aparece dentro da ilha em cada estado.
// Por enquanto os textos são exemplos (marcados como EXEMPLO): os dados de
// verdade (avisos, tarefas, música) entram nas próximas etapas da fase 1.

import { criarCarinha, type Expressao } from "./carinha";
import { ICONES } from "./icones";

export type NomeEstado =
  | "repouso"
  | "ouvindo"
  | "trabalhando"
  | "pronta"
  | "aviso"
  | "confirmacao"
  | "aberta";

export interface Contexto {
  /** Troca o estado da ilha. */
  ir(estado: NomeEstado): void;
  /** Volta para o estado de descanso (repouso ou aviso fixo). */
  fechar(): void;
  /** Marca o aviso fixo como pago. */
  pagarAviso(): void;
  temAviso: boolean;
  /** Relógios que são cancelados sozinhos quando o estado muda. */
  depois(fazer: () => void, ms: number): void;
  aCada(fazer: () => void, ms: number): void;
}

export interface Estado {
  largura: number;
  raio: number;
  /** Estados compactos abrem a ilha completa ao serem clicados. */
  compacto: boolean;
  montar(ctx: Contexto): HTMLElement;
}

const EXEMPLO = {
  aviso: { titulo: "Créditos do Claude", prazo: "em 3 dias", quando: "sexta, 20/11, às 21h" },
  fala: "“abre o InDesign e a pasta do livro novo…”",
  tarefa: { nome: "Organizando Downloads", total: 12 },
  pronta: { titulo: "Claude Code terminou a tarefa", detalhe: "Ilha · fase 1 · há 1 min" },
  apagar: ["relatorio-antigo.pdf", "foto (2).jpg", "setup-velho.exe"],
  musica: { nome: "[Nome da música]", artista: "[Artista] · Apple Music" },
};

const LANCADOR: { nome: string; letra: string; cor: string }[] = [
  { nome: "Claude", letra: "C", cor: "#D97757" },
  { nome: "ChatGPT", letra: "C", cor: "#E9ECEF" },
  { nome: "Gemini", letra: "G", cor: "#7BA7FF" },
  { nome: "Antigravity", letra: "A", cor: "#B78CFF" },
  { nome: "InDesign", letra: "I", cor: "#FF5A8A" },
  { nome: "DeepSeek", letra: "D", cor: "#5C8BFF" },
];

function html(codigo: string): HTMLElement {
  const modelo = document.createElement("template");
  modelo.innerHTML = codigo.trim();
  const elemento = modelo.content.firstElementChild as HTMLElement;
  // Troca cada <i data-carinha="..."> pela carinha de verdade.
  elemento.querySelectorAll<HTMLElement>("[data-carinha]").forEach((lugar) => {
    const expressao = lugar.dataset.carinha as Expressao;
    const tamanho = Number(lugar.dataset.tamanho ?? 2);
    lugar.replaceWith(criarCarinha(expressao, tamanho).elemento);
  });
  return elemento;
}

function aoClicar(raiz: HTMLElement, acao: string, fazer: () => void): void {
  raiz.querySelectorAll<HTMLElement>(`[data-acao="${acao}"]`).forEach((botao) =>
    botao.addEventListener("click", (e) => {
      e.stopPropagation();
      fazer();
    }),
  );
}

function saudacao(): string {
  const hora = new Date().getHours();
  if (hora < 5) return "Boa noite";
  if (hora < 12) return "Bom dia";
  if (hora < 18) return "Boa tarde";
  return "Boa noite";
}

export const ESTADOS: Record<NomeEstado, Estado> = {
  repouso: {
    largura: 190,
    raio: 20,
    compacto: true,
    montar: () =>
      html(`<div class="estado repouso"><i data-carinha="normal"></i></div>`),
  },

  ouvindo: {
    largura: 440,
    raio: 24,
    compacto: false,
    montar: (ctx) => {
      const barras = Array.from({ length: 14 }, (_, i) => `<span style="--i:${i}"></span>`).join("");
      const raiz = html(`
        <div class="estado compacto">
          <i data-carinha="ouvindo"></i>
          <div class="coluna">
            <span class="rotulo"><span class="ponto gravando"></span>Ouvindo</span>
            <span class="secundario fala">${EXEMPLO.fala}</span>
          </div>
          <div class="onda" aria-hidden="true">${barras}</div>
        </div>`);
      // No teste, "solta o botão" depois de alguns segundos.
      ctx.depois(() => ctx.ir("trabalhando"), 4000);
      return raiz;
    },
  },

  trabalhando: {
    largura: 480,
    raio: 24,
    compacto: false,
    montar: (ctx) => {
      const { nome, total } = EXEMPLO.tarefa;
      const raiz = html(`
        <div class="estado compacto">
          <i data-carinha="foco"></i>
          <div class="coluna">
            <div class="entre"><span class="principal">${nome}</span><span class="secundario contagem">0 de ${total}</span></div>
            <div class="barra"><div class="barra-cheia"></div></div>
          </div>
          <button type="button" class="botao" data-acao="parar">Parar</button>
        </div>`);
      const contagem = raiz.querySelector<HTMLElement>(".contagem")!;
      const cheia = raiz.querySelector<HTMLElement>(".barra-cheia")!;
      let feitos = 0;
      ctx.aCada(() => {
        feitos = Math.min(total, feitos + 1);
        contagem.textContent = `${feitos} de ${total}`;
        cheia.style.width = `${(feitos / total) * 100}%`;
        if (feitos === total) ctx.depois(() => ctx.ir("pronta"), 600);
      }, 700);
      aoClicar(raiz, "parar", () => ctx.fechar());
      return raiz;
    },
  },

  pronta: {
    largura: 480,
    raio: 24,
    compacto: true,
    montar: (ctx) => {
      const raiz = html(`
        <div class="estado compacto">
          <i data-carinha="feliz"></i>
          <div class="coluna">
            <span class="principal">${EXEMPLO.pronta.titulo}</span>
            <span class="secundario">${EXEMPLO.pronta.detalhe}</span>
          </div>
          <button type="button" class="botao ciano" data-acao="abrir">Abrir</button>
        </div>`);
      aoClicar(raiz, "abrir", () => ctx.ir("aberta"));
      ctx.depois(() => ctx.fechar(), 12000);
      return raiz;
    },
  },

  aviso: {
    largura: 380,
    raio: 22,
    compacto: true,
    montar: () =>
      html(`
        <div class="estado aviso">
          <i data-carinha="alerta"></i>
          <span class="principal">${EXEMPLO.aviso.titulo}</span>
          <span class="espaco"></span>
          <span class="selo">${EXEMPLO.aviso.prazo}</span>
        </div>`),
  },

  confirmacao: {
    largura: 480,
    raio: 26,
    compacto: false,
    montar: (ctx) => {
      const arquivos = EXEMPLO.apagar
        .map((nome) => `<li>${ICONES.arquivo}<span>${nome}</span></li>`)
        .join("");
      const raiz = html(`
        <div class="estado confirmacao">
          <div class="linha">
            <i data-carinha="alerta"></i>
            <span class="principal">Vou apagar ${EXEMPLO.apagar.length} arquivos de Downloads</span>
          </div>
          <ul class="arquivos">${arquivos}</ul>
          <div class="linha fim">
            <span class="secundario">Ou diga “sim” para confirmar.</span>
            <span class="espaco"></span>
            <button type="button" class="botao" data-acao="cancelar">Cancelar</button>
            <button type="button" class="botao vermelho" data-acao="confirmar">Apagar</button>
          </div>
        </div>`);
      // Teste: nenhum arquivo é apagado de verdade.
      aoClicar(raiz, "cancelar", () => ctx.fechar());
      aoClicar(raiz, "confirmar", () => ctx.fechar());
      return raiz;
    },
  },

  aberta: {
    largura: 620,
    raio: 32,
    compacto: false,
    montar: (ctx) => {
      const lancador = LANCADOR.map(
        (app) => `
          <button type="button" class="app" data-acao="em-breve">
            <span class="app-icone" style="color:${app.cor}">${app.letra}</span>${app.nome}
          </button>`,
      ).join("");

      const aviso = ctx.temAviso
        ? `
          <section class="secao">
            <p class="titulo-secao laranja">Precisa de você</p>
            <div class="item">
              <span class="ponto laranja"></span>
              <div class="coluna">
                <span class="principal">${EXEMPLO.aviso.titulo} vencem ${EXEMPLO.aviso.prazo}</span>
                <span class="secundario">${EXEMPLO.aviso.quando}</span>
              </div>
              <button type="button" class="botao" data-acao="paguei">Paguei</button>
            </div>
          </section>`
        : "";

      const raiz = html(`
        <div class="estado aberta">
          <header class="linha">
            <img src="/robozinho.png" alt="Robozinho" class="cabeca" width="52" height="52">
            <div class="coluna">
              <span class="saudacao">${saudacao()}, Dan</span>
              <span class="secundario subtitulo">Segure o botão para falar · toque para digitar</span>
            </div>
            <button type="button" class="redondo" aria-label="Digitar" data-acao="em-breve">${ICONES.teclado}</button>
            <button type="button" class="redondo grande vermelho" aria-label="Falar" data-acao="falar">${ICONES.microfone}</button>
          </header>
          ${aviso}
          <section class="secao">
            <p class="titulo-secao">Tarefas</p>
            <div class="item">
              <span class="verde">${ICONES.certo}</span>
              <div class="coluna">
                <span class="principal">Claude Code terminou</span>
                <span class="secundario">Ilha · fase 1</span>
              </div>
              <button type="button" class="botao ciano" data-acao="em-breve">Abrir</button>
            </div>
            <div class="item">
              <span class="ponto ciano"></span>
              <div class="coluna">
                <span class="principal">DeepSeek Harness trabalhando</span>
                <span class="secundario">começou há 12 min</span>
              </div>
              <span class="secundario">acompanhando</span>
            </div>
          </section>
          <div class="item">
            <span class="capa">${ICONES.musica}</span>
            <div class="coluna">
              <span class="principal">${EXEMPLO.musica.nome}</span>
              <span class="secundario">${EXEMPLO.musica.artista}</span>
            </div>
            <button type="button" class="redondo" aria-label="Anterior" data-acao="em-breve">${ICONES.anterior}</button>
            <button type="button" class="redondo claro" aria-label="Pausar" data-acao="em-breve">${ICONES.pausar}</button>
            <button type="button" class="redondo" aria-label="Próxima" data-acao="em-breve">${ICONES.proxima}</button>
          </div>
          <div class="lancador">
            ${lancador}
            <button type="button" class="app" data-acao="em-breve">
              <span class="app-icone tracejado">${ICONES.mais}</span>Mais
            </button>
          </div>
          <footer class="linha">
            <button type="button" class="botao" data-acao="em-breve">${ICONES.notas}Notas</button>
            <button type="button" class="botao" data-acao="em-breve">${ICONES.cartao}Assinaturas</button>
            <button type="button" class="botao" data-acao="em-breve">${ICONES.relogio}Foco</button>
            <span class="espaco"></span>
            <span class="versao">versão de teste · dados de exemplo</span>
          </footer>
        </div>`);

      const subtitulo = raiz.querySelector<HTMLElement>(".subtitulo")!;
      const textoOriginal = subtitulo.textContent ?? "";
      let relogio = 0;
      aoClicar(raiz, "em-breve", () => {
        subtitulo.textContent = "Isso chega numa das próximas versões.";
        subtitulo.classList.add("destaque");
        window.clearTimeout(relogio);
        relogio = window.setTimeout(() => {
          subtitulo.textContent = textoOriginal;
          subtitulo.classList.remove("destaque");
        }, 2500);
      });
      aoClicar(raiz, "falar", () => ctx.ir("ouvindo"));
      aoClicar(raiz, "paguei", () => ctx.pagarAviso());
      return raiz;
    },
  },
};
