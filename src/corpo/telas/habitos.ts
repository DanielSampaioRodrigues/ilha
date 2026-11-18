// Hábitos do dia (água, leitura, exercício…) e o lembrete de pausa.
import { confeteEm } from "../festa";
import { ler, mudar, novoId } from "../../dados/armazem";
import { paraISO } from "../../dados/datas";
import type { Contexto } from "../contexto";
import { ICONES } from "../icones";
import { aoClicar, cabecalho, confirmarAntes, escapar, html } from "../ui";

export const hoje = () => paraISO(new Date());

export function montarHabitos(ctx: Contexto): HTMLElement {
  const dados = ler();
  const dia = hoje();
  const lista = dados.habitos
    .map((h) => {
      const feito = h.registros[dia] ?? 0;
      const pct = Math.min(100, (feito / Math.max(1, h.meta)) * 100);
      return `
      <div class="item">
        <div class="coluna">
          <span class="principal">${escapar(h.nome)} <span class="secundario">${feito}/${h.meta}${feito >= h.meta ? " · feito!" : ""}</span></span>
          <div class="barra"><div class="barra-cheia ${feito >= h.meta ? "completa" : ""}" style="width:${pct}%"></div></div>
        </div>
        <button type="button" class="redondo" aria-label="Menos ${escapar(h.nome)}" data-acao="menos" data-id="${h.id}">−</button>
        <button type="button" class="redondo claro" aria-label="Mais ${escapar(h.nome)}" data-acao="mais" data-id="${h.id}">+</button>
        <button type="button" class="redondo" aria-label="Apagar ${escapar(h.nome)}" data-acao="apagar" data-id="${h.id}">${ICONES.lixeira}</button>
      </div>`;
    })
    .join("");

  const pausas = [0, 30, 45, 60, 90]
    .map(
      (m) =>
        `<button type="button" class="segmento" role="radio" aria-checked="${dados.config.pausaACada === m}" data-acao="pausa" data-min="${m}">${m ? `${m} min` : "não"}</button>`,
    )
    .join("");

  const raiz = html(`
    <div class="estado aberta tela">
      ${cabecalho("Hábitos de hoje")}
      <section class="secao">
        ${lista || '<p class="vazio">Nenhum hábito. Adicione um abaixo.</p>'}
        <form class="linha novo-habito">
          <input class="entrada" name="nome" placeholder="Novo hábito (ex.: Alongar)" maxlength="40" required>
          <label class="campo-inline">vezes por dia <input type="number" name="meta" min="1" max="50" value="1"></label>
          <button type="submit" class="botao ciano">Adicionar</button>
        </form>
      </section>
      <section class="secao">
        <p class="titulo-secao">Lembrar de fazer uma pausa a cada</p>
        <div class="segmentos" role="radiogroup" aria-label="Pausa">${pausas}</div>
        <span class="secundario">A ilha avisa para levantar, alongar e beber água.</span>
      </section>
    </div>`);

  aoClicar(raiz, "voltar", () => ctx.irPara("inicio"));
  const somar = (id: string | undefined, n: number, botao?: HTMLElement) => {
    mudar((d) => {
      const h = d.habitos.find((x) => x.id === id);
      if (h) h.registros[dia] = Math.max(0, (h.registros[dia] ?? 0) + n);
      // Bateu a meta de hoje agora: festa!
      if (h && n > 0 && h.registros[dia] === h.meta) confeteEm(botao, 34);
    });
    ctx.renovar();
  };
  aoClicar(raiz, "mais", (b) => somar(b.dataset.id, 1, b));
  aoClicar(raiz, "menos", (b) => somar(b.dataset.id, -1));
  aoClicar(raiz, "apagar", (b) =>
    confirmarAntes(b, "Apagar?", () => {
      mudar((d) => (d.habitos = d.habitos.filter((h) => h.id !== b.dataset.id)));
      ctx.renovar();
    }),
  );
  aoClicar(raiz, "pausa", (b) => {
    mudar((d) => (d.config.pausaACada = Number(b.dataset.min)));
    ctx.renovar();
  });
  const form = raiz.querySelector<HTMLFormElement>(".novo-habito")!;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(form);
    mudar((d) =>
      d.habitos.push({ id: novoId(), nome: String(f.get("nome")).trim(), meta: Math.max(1, Number(f.get("meta"))), registros: {} }),
    );
    ctx.renovar();
  });
  return raiz;
}
