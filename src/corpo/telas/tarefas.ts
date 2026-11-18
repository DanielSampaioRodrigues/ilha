// Lista de tarefas: prioridade (!, !!, !!!), data opcional e subtarefas.
import { confeteEm } from "../festa";
import { ler, mudar, novoId, type Tarefa } from "../../dados/armazem";
import { diasAte, diaEscrito, horaEscrita } from "../../dados/datas";
import type { Contexto } from "../contexto";
import { ICONES } from "../icones";
import { aoClicar, cabecalho, confirmarAntes, escapar, html } from "../ui";

// Qual tarefa está aberta para ver as subtarefas (fica entre redesenhos).
let aberta: string | null = null;

function quandoTarefa(t: Tarefa, agora = new Date()): { texto: string; atrasada: boolean } | null {
  if (!t.quando) return null;
  const d = new Date(t.quando.length > 10 ? t.quando : `${t.quando}T23:59`);
  const dias = diasAte(d, agora);
  const atrasada = d < agora && !t.feita;
  const dia = dias === 0 ? "hoje" : dias === 1 ? "amanhã" : dias === -1 ? "ontem" : diaEscrito(d);
  return { texto: t.quando.length > 10 ? `${dia}, ${horaEscrita(d)}` : dia, atrasada };
}

/** Pendentes primeiro: mais importantes, depois as com data mais próxima. */
export function ordenar(lista: Tarefa[]): Tarefa[] {
  return [...lista].sort(
    (a, b) =>
      Number(a.feita) - Number(b.feita) ||
      b.prioridade - a.prioridade ||
      (a.quando ?? "9999").localeCompare(b.quando ?? "9999"),
  );
}

function linhaTarefa(t: Tarefa): string {
  const q = quandoTarefa(t);
  const feitas = t.subtarefas.filter((s) => s.feita).length;
  const marcas = t.prioridade ? `<span class="prioridade">${"!".repeat(t.prioridade)}</span>` : "";
  const detalhes = [
    q ? `<span class="${q.atrasada ? "atrasada" : ""}">${q.atrasada ? "atrasada · " : ""}${q.texto}</span>` : "",
    t.subtarefas.length ? `${feitas}/${t.subtarefas.length} etapas` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const sub =
    aberta === t.id
      ? `
      <div class="subtarefas">
        ${t.subtarefas
          .map(
            (s) => `
          <label class="sub ${s.feita ? "feita" : ""}">
            <input type="checkbox" data-sub="${s.id}" data-tarefa="${t.id}" ${s.feita ? "checked" : ""}>${escapar(s.texto)}
          </label>`,
          )
          .join("")}
        <input class="entrada nova-sub" data-tarefa="${t.id}" placeholder="Nova etapa e Enter" maxlength="100">
        <div class="linha">
          <label class="campo-inline">Data <input type="datetime-local" data-data="${t.id}" value="${t.quando && t.quando.length > 10 ? t.quando : t.quando ? `${t.quando}T09:00` : ""}"></label>
          <span class="espaco"></span>
          <button type="button" class="botao" data-acao="apagar" data-id="${t.id}">Apagar</button>
        </div>
      </div>`
      : "";
  return `
    <div class="item tarefa ${t.feita ? "feita" : ""}" data-id="${t.id}">
      <button type="button" class="circulo" aria-label="${t.feita ? "Desmarcar" : "Concluir"} ${escapar(t.texto)}" data-acao="feita" data-id="${t.id}">${t.feita ? ICONES.certo : ""}</button>
      <button type="button" class="coluna texto-tarefa" data-acao="abrir" data-id="${t.id}">
        <span class="principal">${marcas}${escapar(t.texto)}</span>
        ${detalhes ? `<span class="secundario">${detalhes}</span>` : ""}
      </button>
    </div>${sub}`;
}

export function montarTarefas(ctx: Contexto): HTMLElement {
  const lista = ordenar(ler().tarefas);
  const pendentes = lista.filter((t) => !t.feita);
  const feitas = lista.filter((t) => t.feita);

  const raiz = html(`
    <div class="estado aberta tela">
      ${cabecalho(`Tarefas · ${pendentes.length}`)}
      <form class="linha nova-tarefa">
        <input class="entrada" name="texto" placeholder="Nova tarefa e Enter" maxlength="120" autocomplete="off">
        <div class="segmentos pequeno" role="radiogroup" aria-label="Importância">
          ${[0, 1, 2, 3].map((p) => `<button type="button" class="segmento" role="radio" aria-checked="${p === 0}" data-prioridade="${p}">${p ? "!".repeat(p) : "—"}</button>`).join("")}
        </div>
      </form>
      <div class="secao">${pendentes.map(linhaTarefa).join("") || '<p class="vazio">Nada pendente. Toque no círculo para concluir; na tarefa, para ver etapas e data.</p>'}</div>
      ${
        feitas.length
          ? `<details class="secao concluidas"><summary class="titulo-secao">Concluídas · ${feitas.length}</summary>${feitas.map(linhaTarefa).join("")}
             <button type="button" class="link" data-acao="limpar">Apagar concluídas</button></details>`
          : ""
      }
    </div>`);

  aoClicar(raiz, "voltar", () => ctx.irPara("inicio"));

  let prioridade = 0;
  raiz.querySelectorAll<HTMLElement>("[data-prioridade]").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      prioridade = Number(b.dataset.prioridade);
      raiz.querySelectorAll("[data-prioridade]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
    }),
  );
  const form = raiz.querySelector<HTMLFormElement>(".nova-tarefa")!;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const texto = String(new FormData(form).get("texto") ?? "").trim();
    if (!texto) return;
    mudar((d) => d.tarefas.push({ id: novoId(), texto, prioridade, quando: null, feita: false, subtarefas: [] }));
    ctx.renovar();
    window.setTimeout(() => document.querySelector<HTMLInputElement>('.nova-tarefa input[name="texto"]')?.focus(), 50);
  });

  const achar = (d: { tarefas: Tarefa[] }, id?: string) => d.tarefas.find((t) => t.id === id);
  aoClicar(raiz, "feita", (b) => {
    mudar((d) => {
      const t = achar(d, b.dataset.id);
      if (t) t.feita = !t.feita;
      if (t?.feita) confeteEm(b);
    });
    ctx.renovar();
  });
  aoClicar(raiz, "abrir", (b) => {
    aberta = aberta === b.dataset.id ? null : (b.dataset.id ?? null);
    ctx.renovar();
  });
  raiz.querySelectorAll<HTMLInputElement>("[data-sub]").forEach((c) =>
    c.addEventListener("change", () => {
      mudar((d) => {
        const s = achar(d, c.dataset.tarefa)?.subtarefas.find((x) => x.id === c.dataset.sub);
        if (s) s.feita = c.checked;
      });
      ctx.renovar();
    }),
  );
  raiz.querySelectorAll<HTMLInputElement>(".nova-sub").forEach((c) =>
    c.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || !c.value.trim()) return;
      e.preventDefault();
      mudar((d) => achar(d, c.dataset.tarefa)?.subtarefas.push({ id: novoId(), texto: c.value.trim(), feita: false }));
      ctx.renovar();
      window.setTimeout(() => document.querySelector<HTMLInputElement>(".nova-sub")?.focus(), 50);
    }),
  );
  raiz.querySelectorAll<HTMLInputElement>("[data-data]").forEach((c) =>
    c.addEventListener("change", () => {
      mudar((d) => {
        const t = achar(d, c.dataset.data);
        if (t) t.quando = c.value || null;
      });
      ctx.renovar();
    }),
  );
  aoClicar(raiz, "apagar", (b) =>
    confirmarAntes(b, "Apagar de vez?", () => {
      mudar((d) => (d.tarefas = d.tarefas.filter((t) => t.id !== b.dataset.id)));
      aberta = null;
      ctx.renovar();
    }),
  );
  aoClicar(raiz, "limpar", (b) =>
    confirmarAntes(b, "Apagar todas as concluídas?", () => {
      mudar((d) => (d.tarefas = d.tarefas.filter((t) => !t.feita)));
      ctx.renovar();
    }),
  );
  return raiz;
}
