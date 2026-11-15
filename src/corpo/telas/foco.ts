// Foco e pausas: um cronômetro que fica na própria ilha.
import { ler, mudar } from "../../dados/armazem";
import type { Contexto } from "../contexto";
import { aoClicar, cabecalho, html } from "../ui";

const FOCOS = [25, 50, 90];
const PAUSAS = [5, 10, 15];

export function montarFoco(ctx: Contexto): HTMLElement {
  const { focoMinutos, pausaMinutos } = ler().config;
  // Opções prontas + um campo para qualquer tempo (1 a 240 min).
  const opcoes = (lista: number[], escolhido: number, grupo: string) =>
    lista
      .map(
        (m) =>
          `<button type="button" class="chip ${m === escolhido ? "ativo" : ""}" data-acao="escolher" data-grupo="${grupo}" data-min="${m}">${m} min</button>`,
      )
      .join("") +
    `<label class="chip campo-chip ${lista.includes(escolhido) ? "" : "ativo"}">outro:
      <input type="number" min="1" max="240" data-grupo="${grupo}" value="${lista.includes(escolhido) ? "" : escolhido}" placeholder="—" aria-label="Outro tempo em minutos"> min</label>`;

  const ativo = ctx.foco
    ? `
      <div class="item">
        <span class="ponto ciano"></span>
        <div class="coluna">
          <span class="principal">${ctx.foco.tipo === "foco" ? "Foco em andamento" : "Pausa em andamento"}</span>
          <span class="secundario">termina às ${new Date(ctx.foco.fim).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
        <button type="button" class="botao" data-acao="parar">Parar</button>
      </div>`
    : "";

  const raiz = html(`
    <div class="estado aberta tela">
      ${cabecalho("Foco e pausas")}
      ${ativo}
      <section class="secao">
        <p class="titulo-secao">Tempo de foco</p>
        <div class="linha chips">${opcoes(FOCOS, focoMinutos, "foco")}</div>
      </section>
      <section class="secao">
        <p class="titulo-secao">Pausa depois</p>
        <div class="linha chips">${opcoes(PAUSAS, pausaMinutos, "pausa")}</div>
      </section>
      <p class="secundario">Durante o foco, a ilha mostra o tempo que falta. No fim, ela avisa e oferece a pausa.</p>
      <div class="linha fim">
        <span class="espaco"></span>
        <button type="button" class="botao" data-acao="pausa-agora">Só uma pausa</button>
        <button type="button" class="botao ciano" data-acao="comecar">Começar foco</button>
      </div>
    </div>`);

  aoClicar(raiz, "voltar", () => ctx.irPara("inicio"));
  aoClicar(raiz, "escolher", (b) => {
    const minutos = Number(b.dataset.min);
    mudar((d) => {
      if (b.dataset.grupo === "foco") d.config.focoMinutos = minutos;
      else d.config.pausaMinutos = minutos;
    });
    ctx.renovar();
  });
  raiz.querySelectorAll<HTMLInputElement>(".campo-chip input").forEach((campo) =>
    campo.addEventListener("change", () => {
      const minutos = Math.round(Number(campo.value));
      if (!(minutos >= 1 && minutos <= 240)) return;
      mudar((d) => {
        if (campo.dataset.grupo === "foco") d.config.focoMinutos = minutos;
        else d.config.pausaMinutos = minutos;
      });
      ctx.renovar();
    }),
  );
  aoClicar(raiz, "comecar", () => ctx.comecarFoco("foco", ler().config.focoMinutos));
  aoClicar(raiz, "pausa-agora", () => ctx.comecarFoco("pausa", ler().config.pausaMinutos));
  aoClicar(raiz, "parar", () => {
    ctx.pararFoco();
    ctx.renovar();
  });
  return raiz;
}
