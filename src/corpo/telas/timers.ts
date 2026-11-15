// Timers com nome (ex.: "Macarrão · 10 min") e cronômetro.
import { ler, mudar } from "../../dados/armazem";
import type { Contexto } from "../contexto";
import { aoClicar, cabecalho, escapar, html } from "../ui";

// O cronômetro vive enquanto a ilha estiver ligada.
const cronometro = { inicio: 0, acumulado: 0, rodando: false };

function formatar(ms: number, comDecimos = false): string {
  const total = Math.max(0, ms);
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  const base = h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
  return comDecimos ? `${base}.${Math.floor((total % 1000) / 100)}` : base;
}

export function montarTimers(ctx: Contexto): HTMLElement {
  const timers = [...ler().timers].sort((a, b) => a.fim - b.fim);
  const raiz = html(`
    <div class="estado aberta tela">
      ${cabecalho("Timers")}
      <section class="secao">
        ${timers
          .map(
            (t) => `
          <div class="item">
            <div class="coluna"><span class="principal">${escapar(t.nome)}</span><span class="secundario">${t.minutos} min</span></div>
            <span class="tempo grande" data-fim="${t.fim}">--:--</span>
            <button type="button" class="botao" data-acao="cancelar" data-id="${t.id}">Cancelar</button>
          </div>`,
          )
          .join("")}
        <form class="formulario novo-timer">
          <label class="campo largo2">Nome<input name="nome" maxlength="40" placeholder="Ex.: Macarrão" value="Timer"></label>
          <label class="campo">Minutos<input name="minutos" type="number" min="1" max="600" value="10" required></label>
          <div class="linha largo chips">
            ${[1, 5, 10, 15, 30, 60].map((m) => `<button type="button" class="chip" data-acao="rapido" data-min="${m}">${m} min</button>`).join("")}
            <span class="espaco"></span>
            <button type="submit" class="botao ciano">Começar</button>
          </div>
        </form>
      </section>
      <section class="secao">
        <p class="titulo-secao">Cronômetro</p>
        <div class="item">
          <span class="tempo gigante cronometro">0:00.0</span>
          <span class="espaco"></span>
          <button type="button" class="botao" data-acao="zerar">Zerar</button>
          <button type="button" class="botao ciano" data-acao="crono">${cronometro.rodando ? "Pausar" : "Iniciar"}</button>
        </div>
      </section>
    </div>`);

  aoClicar(raiz, "voltar", () => ctx.irPara("inicio"));
  const atualizar = () => {
    raiz.querySelectorAll<HTMLElement>("[data-fim]").forEach((el) => (el.textContent = formatar(Number(el.dataset.fim) - Date.now())));
    const decorrido = cronometro.acumulado + (cronometro.rodando ? Date.now() - cronometro.inicio : 0);
    raiz.querySelector<HTMLElement>(".cronometro")!.textContent = formatar(decorrido, true);
  };
  atualizar();
  ctx.aCada(atualizar, 100);

  const form = raiz.querySelector<HTMLFormElement>(".novo-timer")!;
  const comecar = (minutos: number) => {
    const nome = String(new FormData(form).get("nome") ?? "").trim() || "Timer";
    ctx.comecarTimer(nome, minutos);
    ctx.renovar();
  };
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    comecar(Math.max(1, Number(new FormData(form).get("minutos"))));
  });
  aoClicar(raiz, "rapido", (b) => comecar(Number(b.dataset.min)));
  aoClicar(raiz, "cancelar", (b) => {
    mudar((d) => (d.timers = d.timers.filter((t) => t.id !== b.dataset.id)));
    ctx.renovar();
  });
  aoClicar(raiz, "crono", (b) => {
    if (cronometro.rodando) {
      cronometro.acumulado += Date.now() - cronometro.inicio;
      cronometro.rodando = false;
    } else {
      cronometro.inicio = Date.now();
      cronometro.rodando = true;
    }
    b.textContent = cronometro.rodando ? "Pausar" : "Iniciar";
  });
  aoClicar(raiz, "zerar", () => {
    cronometro.acumulado = 0;
    cronometro.inicio = Date.now();
    atualizar();
  });
  return raiz;
}
