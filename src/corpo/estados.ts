// O que aparece dentro da ilha em cada estado.
// "ouvindo", "trabalhando" e "confirmacao" ainda são de teste (dados de
// exemplo): ganham vida nas fases 2 e 3, com a voz e os motores de IA.

import { ler } from "../dados/armazem";
import { faltaEscrito, pendentes, pertoDeRenovar, prazo, quandoEscrito } from "../dados/datas";
import { seloDa } from "./selos";
import { ICONES } from "./icones";
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
    montar: () => {
      const selos = renovandoEmBreve()
        .slice(0, 2)
        .map((r) => seloDa(r, 14))
        .join("");
      return html(`<div class="estado repouso"><i data-carinha="normal"></i>${selos ? `<span class="sinal-ia">${selos}</span>` : ""}</div>`);
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
        if (feitos === total) ctx.depois(() => ctx.fechar(), 600);
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

  foco: {
    largura: 300,
    raio: 22,
    compacto: true,
    montar: (ctx) => {
      const pausa = ctx.foco?.tipo === "pausa";
      const raiz = html(`
        <div class="estado aviso">
          <i data-carinha="${pausa ? "feliz" : "foco"}"></i>
          <span class="principal">${pausa ? "Pausa" : "Foco"}</span>
          <span class="espaco"></span>
          <span class="tempo">--:--</span>
        </div>`);
      const tempo = raiz.querySelector<HTMLElement>(".tempo")!;
      const atualizar = () => {
        if (ctx.foco) tempo.textContent = relogio(ctx.foco.fim - Date.now());
      };
      atualizar();
      ctx.aCada(atualizar, 1000);
      return raiz;
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

