// O que aparece dentro da ilha em cada estado.
// "ouvindo", "trabalhando" e "confirmacao" ainda são de teste (dados de
// exemplo): ganham vida nas fases 2 e 3, com a voz e os motores de IA.

import { ler } from "../dados/armazem";
import { faltaEscrito, pendentes, pertoDeRenovar, prazo, quandoEscrito } from "../dados/datas";
import { seloDa } from "./selos";
import { ICONES } from "./icones";
import { Carinha } from "./carinha";
import { TELAS } from "./telas";
import { aoClicar, escapar, html } from "./ui";
import type { Contexto, NomeEstado } from "./contexto";

export interface Estado {
  largura: number;
  raio: number;
  /** Curvinha dos ombros (padrão 14). */
  ombro?: number;
  /** Estados compactos abrem a ilha completa ao serem clicados. */
  compacto: boolean;
  montar(ctx: Contexto): HTMLElement;
}

const EXEMPLO = {
  fala: "“abre o InDesign e a pasta do livro novo…”",
  tarefa: { nome: "Organizando Downloads", total: 12 },
  apagar: ["relatorio-antigo.pdf", "foto (2).jpg", "setup-velho.exe"],
};

function relogio(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(total / 60);
  const seg = total % 60;
  return `${min}:${String(seg).padStart(2, "0")}`;
}

/** Redefinições perto de renovar, da mais próxima para a mais distante. */
export function renovandoEmBreve() {
  return ler()
    .redefinicoes.filter((r) => pertoDeRenovar(r))
    .sort((a, b) => a.proxima.localeCompare(b.proxima));
}

export function temSinalVerde(): boolean {
  return renovandoEmBreve().length > 0;
}

export const ESTADOS: Record<NomeEstado, Estado> = {
  repouso: {
    largura: 190,
    raio: 20,
    compacto: true,
    // Símbolo da IA ao lado da carinha: o limite dela renova em breve.
    // Passar o mouse mostra qual modelo e quanto falta (estado "renovacao").
    // Parado, o robô brinca (pega uma mosquinha) ou cochila.
    montar: (ctx) => {
      const selos = renovandoEmBreve()
        .slice(0, 2)
        .map((r) => seloDa(r, 14))
        .join("");
      const raiz = html(`<div class="estado repouso">${selos ? `<span class="sinal-ia">${selos}</span>` : ""}</div>`);
      const carinha = new Carinha(ctx.dormindo ? "dormindo" : (ctx.atividade ?? "normal"), {
        comAcessorio: true,
        segueAtividade: !ctx.dormindo,
      });
      raiz.prepend(carinha.elemento);
      if (ctx.dormindo) {
        raiz.insertAdjacentHTML("beforeend", '<span class="zzz" aria-hidden="true"><i>z</i><i>z</i><i>z</i></span>');
        return raiz;
      }
      if (ler().config.brincadeiras) {
        // De vez em quando passa uma mosquinha; os olhos acompanham.
        const mosquinha = () => {
          if (!raiz.isConnected || Math.random() < 0.5) return;
          const mosca = document.createElement("span");
          mosca.className = "mosca";
          raiz.append(mosca);
          const largura = raiz.offsetWidth;
          const inicio = performance.now();
          const voar = (agora: number) => {
            const t = (agora - inicio) / 5000;
            if (t >= 1 || !mosca.isConnected) {
              mosca.remove();
              carinha.olharPara(0, 0);
              return;
            }
            const x = largura * (0.1 + 0.8 * (0.5 + 0.5 * Math.sin(t * Math.PI * 3)));
            const y = 6 + 8 * Math.abs(Math.sin(t * Math.PI * 7));
            mosca.style.transform = `translate(${x}px, ${y}px)`;
            const centro = largura / 2;
            carinha.olharPara(x < centro - 30 ? -1 : x > centro + 30 ? 1 : 0, 0);
            requestAnimationFrame(voar);
          };
          requestAnimationFrame(voar);
        };
        ctx.aCada(mosquinha, 60_000);
      }
      return raiz;
    },
  },

  renovacao: {
    largura: 400,
    raio: 22,
    compacto: true,
    montar: () => {
      const agora = new Date();
      const linhas = renovandoEmBreve()
        .map((r) => {
          const quando = new Date(r.proxima);
          return `
          <div class="linha linha-renova">
            ${seloDa(r, 22)}
            <div class="coluna">
              <span class="principal">${escapar(r.nome)} renova ${faltaEscrito(quando, agora)}</span>
              <span class="secundario">${quandoEscrito(quando, agora)} · aproveite o que sobrou</span>
            </div>
          </div>`;
        })
        .join("");
      return html(`<div class="estado compacto renovacao">${linhas || '<span class="secundario">Nada renovando em breve.</span>'}</div>`);
    },
  },

  discreto: {
    largura: 120,
    raio: 4,
    ombro: 4,
    compacto: true,
    // Só um risquinho; a faixa colorida no meio diz se há algo (laranja = pagar,
    // verde = IA renovando, cor de destaque = foco).
    montar: (ctx) => {
      const cor = ctx.foco
        ? "destaque"
        : pendentes(ler().assinaturas).length
          ? "laranja"
          : temSinalVerde()
            ? "verde"
            : "";
      return html(`<div class="estado discreto">${cor ? `<span class="faixa ${cor}"></span>` : ""}</div>`);
    },
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
      ctx.depois(() => ctx.ir("trabalhando"), 4000);
      return raiz;
    },
  },

  // Uma IA trabalhando numa conversa da Central (ou o exemplo do menu de teste).
  trabalhando: {
    largura: 480,
    raio: 24,
    compacto: true,
    montar: (ctx) => {
      const t = ctx.trabalho;
      if (!t) {
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
          if (feitos === total) ctx.depois(() => ctx.fechar(), 600);
        }, 700);
        aoClicar(raiz, "parar", () => ctx.fechar());
        return raiz;
      }
      const nomes: Record<string, string> = { deepseek: "DeepSeek", claude: "Claude Code", codex: "Codex", gemini: "Gemini", antigravity: "Antigravity" };
      const raiz = html(`
        <div class="estado compacto">
          <i data-carinha="pensando"></i>
          <div class="coluna">
            <span class="principal">${escapar(t.titulo || "Pensando…")}</span>
            <span class="secundario">${nomes[t.motor] ?? t.motor} · <span class="tempo-trabalho">0:00</span></span>
          </div>
          <button type="button" class="botao" data-acao="parar">Parar</button>
        </div>`);
      const tempo = raiz.querySelector<HTMLElement>(".tempo-trabalho")!;
      const atualizar = () => (tempo.textContent = relogio(Date.now() - t.inicio));
      atualizar();
      ctx.aCada(atualizar, 1000);
      aoClicar(raiz, "parar", () => {
        import("../maos/sistema").then((m) => m.pararConversa(t.id)).catch(() => {});
      });
      return raiz;
    },
  },

  pronta: {
    largura: 480,
    raio: 24,
    compacto: true,
    montar: (ctx) => {
      const n = ctx.notificacao ?? {
        titulo: "Claude Code terminou",
        detalhe: "ilha",
        expressao: "feliz" as const,
        botao: undefined,
      };
      const botao = n.botao
        ? `<button type="button" class="botao ciano" data-acao="botao">${escapar(n.botao.texto)}</button>`
        : "";
      const raiz = html(`
        <div class="estado compacto">
          <i data-carinha="${n.expressao ?? "feliz"}"></i>
          <div class="coluna">
            <span class="principal">${escapar(n.titulo)}</span>
            <span class="secundario">${escapar(n.detalhe || "agora")}</span>
          </div>
          ${botao}
        </div>`);
      aoClicar(raiz, "botao", () => n.botao?.fazer());
      ctx.depois(() => ctx.fechar(), 12000);
      return raiz;
    },
  },

  aviso: {
    largura: 380,
    raio: 22,
    compacto: true,
    montar: () => {
      const urgente = pendentes(ler().assinaturas)[0];
      const nome = urgente ? urgente.nome : "Créditos do Claude";
      const quando = urgente ? prazo(urgente.dias) : "em 3 dias";
      return html(`
        <div class="estado aviso">
          <i data-carinha="alerta"></i>
          <span class="principal">${escapar(nome)}</span>
          <span class="espaco"></span>
          <span class="selo">${quando}</span>
        </div>`);
    },
  },

  // Foco, pausa ou timer rodando: mostra o que termina primeiro.
  foco: {
    largura: 300,
    raio: 22,
    compacto: true,
    montar: (ctx) => {
      const opcoes = [
        ...(ctx.foco ? [{ nome: ctx.foco.tipo === "pausa" ? "Pausa" : "Foco", fim: ctx.foco.fim, cara: ctx.foco.tipo === "pausa" ? "feliz" : "foco" }] : []),
        ...ler().timers.map((t) => ({ nome: t.nome, fim: t.fim, cara: "normal" })),
      ].sort((a, b) => a.fim - b.fim);
      const atual = opcoes[0] ?? { nome: "Foco", fim: Date.now(), cara: "foco" };
      const mais = opcoes.length > 1 ? `<span class="secundario">+${opcoes.length - 1}</span>` : "";
      const raiz = html(`
        <div class="estado aviso">
          <i data-carinha="${atual.cara}"></i>
          <span class="principal">${escapar(atual.nome)}</span>
          ${mais}
          <span class="espaco"></span>
          <span class="tempo">--:--</span>
        </div>`);
      const tempo = raiz.querySelector<HTMLElement>(".tempo")!;
      const atualizar = () => (tempo.textContent = relogio(atual.fim - Date.now()));
      atualizar();
      ctx.aCada(atualizar, 1000);
      return raiz;
    },
  },

  // Música tocando, como uma "atividade ao vivo" na ilha fechada.
  musica: {
    largura: 300,
    raio: 20,
    compacto: true,
    montar: (ctx) => {
      const m = ctx.musica;
      return html(`
        <div class="estado aviso musica-viva">
          <i data-carinha="${ler().config.perceberAtividade ? "musica" : "feliz"}"></i>
          <span class="barrinhas" aria-hidden="true"><span></span><span></span><span></span><span></span></span>
          <span class="principal">${escapar(m?.titulo ?? "")}</span>
        </div>`);
    },
  },

  // Aviso rápido quando o volume muda.
  volume: {
    largura: 300,
    raio: 20,
    compacto: false,
    montar: (ctx) => {
      const v = ctx.volume ?? { nivel: 0, mudo: false };
      const nivel = v.mudo ? 0 : v.nivel;
      return html(`
        <div class="estado aviso">
          <span class="icone-volume">${v.mudo || nivel === 0 ? ICONES.mudo : ICONES.som}</span>
          <div class="barra volume-barra"><div class="barra-cheia" style="width:${nivel}%"></div></div>
          <span class="tempo">${v.mudo ? "mudo" : `${nivel}%`}</span>
        </div>`);
    },
  },

  confirmacao: {
    largura: 480,
    raio: 26,
    compacto: false,
    montar: (ctx) => {
      const arquivos = EXEMPLO.apagar.map((nome) => `<li>${ICONES.arquivo}<span>${nome}</span></li>`).join("");
      const raiz = html(`
        <div class="estado confirmacao">
          <div class="linha">
            <i data-carinha="alerta"></i>
            <span class="principal">Vou apagar ${EXEMPLO.apagar.length} arquivos de Downloads</span>
          </div>
          <ul class="arquivos">${arquivos}</ul>
          <div class="linha fim">
            <span class="secundario">Teste: nada é apagado de verdade.</span>
            <span class="espaco"></span>
            <button type="button" class="botao" data-acao="cancelar">Cancelar</button>
            <button type="button" class="botao vermelho" data-acao="confirmar">Apagar</button>
          </div>
        </div>`);
      aoClicar(raiz, "cancelar", () => ctx.fechar());
      aoClicar(raiz, "confirmar", () => ctx.fechar());
      return raiz;
    },
  },

  aberta: {
    largura: 620,
    raio: 32,
    compacto: false,
    // A tela de dentro (início, notas, ajustes…) vem de ./telas.
    montar: (ctx) => TELAS[ctx.tela].montar(ctx),
  },
};

