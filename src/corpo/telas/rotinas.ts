// Rotinas: vários passos com uma frase ("bom dia"), um botão ou num horário.
import { ler, mudar, novoId, type PassoRotina, type Rotina } from "../../dados/armazem";
import { MODELOS_DE_ROTINA, rodarRotina } from "../rotinas";
import type { Contexto } from "../contexto";
import { ICONES } from "../icones";
import { aoClicar, cabecalho, confirmarAntes, escapar, html } from "../ui";

const TIPOS: [PassoRotina["tipo"], string, string][] = [
  ["resumo", "Resumo do dia", "tarefas, contas e renovações de hoje"],
  ["abrir", "Abrir programa ou site", "ex.: Spotify, https://gmail.com"],
  ["comando", "Comando da ilha", "ex.: volume 30, foco 50, pausa a música"],
  ["falar", "Falar uma frase", "ex.: Bora trabalhar!"],
  ["perguntar", "Perguntar à IA", "ex.: me dê uma frase motivacional"],
  ["esperar", "Esperar (segundos)", "ex.: 5"],
];
const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

let editando: Rotina | null = null;
let saida = "";

export function montarRotinas(ctx: Contexto): HTMLElement {
  const d = ler();
  const r = editando;
  const raiz = html(`
    <div class="estado aberta tela">
      ${cabecalho(r ? (d.rotinas.some((x) => x.id === r.id) ? "Editar rotina" : "Nova rotina") : "Rotinas")}
      ${
        r
          ? `
      <form class="formulario form-rotina">
        <label class="campo">Nome<input name="nome" required maxlength="40" value="${escapar(r.nome)}" placeholder="ex.: Bom dia"></label>
        <label class="campo">Frases que disparam (separe com vírgula)<input name="frases" maxlength="200" value="${escapar(r.frases.join(", "))}" placeholder="ex.: bom dia, começar o dia"></label>
        <div class="linha">
          <label class="campo">Rodar sozinha às<input name="horario" type="time" value="${escapar(r.horario)}"></label>
          <div class="dias-rotina">${DIAS.map((n, i) => `<button type="button" class="chip pequeno-chip ${r.dias.includes(i) ? "ativo" : ""}" data-acao="dia" data-dia="${i}">${n}</button>`).join("")}</div>
        </div>
        <span class="secundario">Sem horário: roda quando você pede. Sem dias marcados: todos os dias.</span>
        <div class="item">
          <div class="coluna"><span class="principal">Ler o resultado em voz alta</span></div>
          <button type="button" class="chave" role="switch" aria-checked="${r.falar}" data-acao="falar-resultado" aria-label="Ler o resultado em voz alta"><span></span></button>
        </div>
        <p class="titulo-secao">Passos</p>
        <div class="passos-rotina">
          ${r.passos
            .map(
              (p, i) => `
            <div class="linha passo-rotina">
              <span class="numero-passo">${i + 1}</span>
              <select class="entrada" data-campo="tipo" data-i="${i}">${TIPOS.map(([v, n]) => `<option value="${v}" ${v === p.tipo ? "selected" : ""}>${n}</option>`).join("")}</select>
              ${p.tipo === "resumo" ? '<span class="secundario espaco">(nada a preencher)</span>' : `<input class="entrada" data-campo="valor" data-i="${i}" value="${escapar(p.valor)}" placeholder="${escapar(TIPOS.find(([v]) => v === p.tipo)?.[2] ?? "")}">`}
              <button type="button" class="redondo" aria-label="Subir" data-acao="subir" data-i="${i}" ${i === 0 ? "disabled" : ""}>↑</button>
              <button type="button" class="redondo" aria-label="Tirar" data-acao="tirar-passo" data-i="${i}">${ICONES.lixeira}</button>
            </div>`,
            )
            .join("") || '<p class="vazio">Nenhum passo ainda.</p>'}
        </div>
        <div class="linha"><button type="button" class="botao" data-acao="mais-passo">+ Passo</button></div>
        <div class="linha fim"><span class="espaco"></span><button type="button" class="botao" data-acao="cancelar">Cancelar</button><button type="submit" class="botao ciano">Salvar</button></div>
      </form>`
          : `
      <p class="secundario">Uma rotina faz várias coisas de uma vez. Diga ou escreva a frase dela na conversa (ex.: “bom dia”), aperte Rodar, ou deixe com horário.</p>
      <section class="secao">
        ${
          d.rotinas
            .map(
              (x) => `
          <div class="item">
            <div class="coluna">
              <span class="principal">${escapar(x.nome)}</span>
              <span class="secundario">${x.frases.length ? `“${escapar(x.frases.join("”, “"))}”` : "sem frase"}${x.horario ? ` · ${x.horario}${x.dias.length && x.dias.length < 7 ? ` (${x.dias.map((i) => DIAS[i]).join(", ")})` : ""}` : ""} · ${x.passos.length} passo(s)</span>
            </div>
            <button type="button" class="botao ciano" data-acao="rodar" data-id="${x.id}">Rodar</button>
            <button type="button" class="botao" data-acao="editar" data-id="${x.id}">Editar</button>
            <button type="button" class="redondo" aria-label="Apagar" data-acao="apagar" data-id="${x.id}">${ICONES.lixeira}</button>
          </div>`,
            )
            .join("") || '<p class="vazio">Nenhuma rotina ainda. Comece por um modelo:</p>'
        }
        <div class="linha modelos-rotina">
          ${MODELOS_DE_ROTINA.map((m, i) => `<button type="button" class="botao" data-acao="modelo" data-i="${i}">+ ${escapar(m.nome)}</button>`).join("")}
          <button type="button" class="botao" data-acao="nova">+ Em branco</button>
        </div>
        ${saida ? `<div class="saida-rotina">${escapar(saida).replace(/\n/g, "<br>")}</div>` : ""}
      </section>`
      }
    </div>`);

  aoClicar(raiz, "voltar", () => {
    if (editando) {
      editando = null;
      ctx.renovar();
    } else ctx.irPara("inicio");
  });

  if (!r) {
    aoClicar(raiz, "modelo", (b) => {
      editando = { id: novoId(), ...structuredClone(MODELOS_DE_ROTINA[Number(b.dataset.i)]) };
      ctx.renovar();
    });
    aoClicar(raiz, "nova", () => {
      editando = { id: novoId(), nome: "", frases: [], horario: "", dias: [], falar: false, passos: [] };
      ctx.renovar();
    });
    aoClicar(raiz, "editar", (b) => {
      const x = ler().rotinas.find((y) => y.id === b.dataset.id);
      if (x) editando = structuredClone(x);
      ctx.renovar();
    });
    aoClicar(raiz, "apagar", (b) =>
      confirmarAntes(b, "Apagar?", () => {
        mudar((dd) => (dd.rotinas = dd.rotinas.filter((x) => x.id !== b.dataset.id)));
        ctx.renovar();
      }),
    );
    aoClicar(raiz, "rodar", (b) => {
      const x = ler().rotinas.find((y) => y.id === b.dataset.id);
      if (!x) return;
      b.textContent = "Rodando…";
      (b as HTMLButtonElement).disabled = true;
      rodarRotina(x, ctx).then((t) => {
        saida = t;
        if (raiz.isConnected) ctx.renovar();
      });
    });
    return raiz;
  }

  // ---------- Editando ----------
  const form = raiz.querySelector<HTMLFormElement>(".form-rotina")!;
  // Guarda o que foi digitado antes de redesenhar.
  const lerCampos = () => {
    const f = new FormData(form);
    r.nome = String(f.get("nome") ?? "").trim();
    r.frases = String(f.get("frases") ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    r.horario = String(f.get("horario") ?? "");
    form.querySelectorAll<HTMLInputElement>('[data-campo="valor"]').forEach((c) => (r.passos[Number(c.dataset.i)].valor = c.value));
  };
  const refazer = () => {
    lerCampos();
    ctx.renovar();
  };
  form.querySelectorAll<HTMLSelectElement>('[data-campo="tipo"]').forEach((s) =>
    s.addEventListener("change", () => {
      lerCampos();
      r.passos[Number(s.dataset.i)] = { tipo: s.value as PassoRotina["tipo"], valor: "" };
      ctx.renovar();
    }),
  );
  aoClicar(raiz, "dia", (b) => {
    const dia = Number(b.dataset.dia);
    r.dias = r.dias.includes(dia) ? r.dias.filter((x) => x !== dia) : [...r.dias, dia].sort();
    refazer();
  });
  aoClicar(raiz, "falar-resultado", () => {
    r.falar = !r.falar;
    refazer();
  });
  aoClicar(raiz, "mais-passo", () => {
    lerCampos();
    r.passos.push({ tipo: "comando", valor: "" });
    ctx.renovar();
  });
  aoClicar(raiz, "tirar-passo", (b) => {
    lerCampos();
    r.passos.splice(Number(b.dataset.i), 1);
    ctx.renovar();
  });
  aoClicar(raiz, "subir", (b) => {
    lerCampos();
    const i = Number(b.dataset.i);
    [r.passos[i - 1], r.passos[i]] = [r.passos[i], r.passos[i - 1]];
    ctx.renovar();
  });
  aoClicar(raiz, "cancelar", () => {
    editando = null;
    ctx.renovar();
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    lerCampos();
    if (!r.nome) return;
    const salvo = { ...r, passos: r.passos.filter((p) => p.tipo === "resumo" || p.valor.trim()) };
    mudar((dd) => {
      const i = dd.rotinas.findIndex((x) => x.id === salvo.id);
      if (i >= 0) dd.rotinas[i] = salvo;
      else dd.rotinas.push(salvo);
    });
    editando = null;
    ctx.renovar();
  });
  return raiz;
}
