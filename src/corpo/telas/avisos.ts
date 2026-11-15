// Assinaturas: o que precisa ser pago. A ilha fica laranja alguns dias antes
// de cada vencimento, até o Dan clicar em "Paguei".
import { ler, mudar, novoId, type Assinatura } from "../../dados/armazem";
import { MESES, diaEscrito, paraISO, prazo, situacao } from "../../dados/datas";
import type { Contexto } from "../contexto";
import { ICONES } from "../icones";
import { aoClicar, cabecalho, confirmarAntes, escapar, html } from "../ui";

export function montarAvisos(ctx: Contexto): HTMLElement {
  const dados = ler();
  const agora = new Date();

  const lista = dados.assinaturas
    .map((a) => ({ a, s: situacao(a, agora) }))
    .sort((x, y) => x.s.dias - y.s.dias)
    .map(
      ({ a, s }) => `
      <div class="item">
        <span class="ponto ${s.pendente ? "laranja" : "apagado"}"></span>
        <div class="coluna">
          <span class="principal">${escapar(a.nome)}${a.valor ? ` · ${escapar(a.valor)}` : ""}</span>
          <span class="secundario">${diaEscrito(s.vence)} · ${prazo(s.dias)} · ${a.frequencia === "anual" ? `todo ano em ${MESES[a.mes - 1]}` : `todo dia ${a.dia}`}</span>
        </div>
        ${s.pendente ? `<button type="button" class="botao" data-acao="paguei" data-id="${a.id}">Paguei</button>` : ""}
        <button type="button" class="redondo" aria-label="Editar ${escapar(a.nome)}" data-acao="editar" data-id="${a.id}">${ICONES.lapis}</button>
        <button type="button" class="redondo" aria-label="Apagar ${escapar(a.nome)}" data-acao="apagar" data-id="${a.id}">${ICONES.lixeira}</button>
      </div>`,
    )
    .join("");

  const opcoesMes = MESES.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("");

  const raiz = html(`
    <div class="estado aberta tela">
      ${cabecalho("Assinaturas")}
      <div class="linha">
        <span class="secundario">A ilha fica laranja antes do vencimento, até você marcar "Paguei".</span>
        <span class="espaco"></span>
        <button type="button" class="botao" data-acao="tabela">${ICONES.tabela}Ver tabela</button>
      </div>
      <section class="secao">
        ${lista || '<p class="vazio">Nenhuma assinatura ainda.</p>'}
        <button type="button" class="link" data-acao="nova">+ Nova assinatura</button>
        <form class="formulario" hidden>
          <label class="campo largo">Nome<input name="nome" required maxlength="60" placeholder="Ex.: Claude Max"></label>
          <label class="campo">Valor<input name="valor" maxlength="20" placeholder="R$ 110"></label>
          <label class="campo">Vence todo dia<input name="dia" type="number" min="1" max="31" required></label>
          <label class="campo">Repete<select name="frequencia"><option value="mensal">todo mês</option><option value="anual">todo ano</option></select></label>
          <label class="campo so-anual" hidden>Mês<select name="mes">${opcoesMes}</select></label>
          <label class="campo">Avisar quantos dias antes<select name="antecedencia">
            ${[0, 1, 2, 3, 5, 7].map((n) => `<option value="${n}">${n === 0 ? "só no dia" : n === 1 ? "1 dia" : `${n} dias`}</option>`).join("")}
          </select></label>
          <div class="linha fim largo"><span class="espaco"></span><button type="button" class="botao" data-acao="cancelar">Cancelar</button><button type="submit" class="botao ciano">Salvar</button></div>
        </form>
      </section>
    </div>`);

  const form = raiz.querySelector<HTMLFormElement>("form")!;
  const campo = <T extends HTMLElement>(nome: string) => form.querySelector<T>(`[name="${nome}"]`)!;
  const frequencia = campo<HTMLSelectElement>("frequencia");
  const mostrarMes = () => (form.querySelector<HTMLElement>(".so-anual")!.hidden = frequencia.value !== "anual");
  frequencia.addEventListener("change", mostrarMes);
  let editando: string | null = null;

  const abrirForm = (a?: Assinatura) => {
    editando = a?.id ?? null;
    campo<HTMLInputElement>("nome").value = a?.nome ?? "";
    campo<HTMLInputElement>("valor").value = a?.valor ?? "";
    campo<HTMLInputElement>("dia").value = String(a?.dia ?? agora.getDate());
    frequencia.value = a?.frequencia ?? "mensal";
    campo<HTMLSelectElement>("mes").value = String(a?.mes ?? agora.getMonth() + 1);
    campo<HTMLSelectElement>("antecedencia").value = String(a?.antecedencia ?? 3);
    mostrarMes();
    form.hidden = false;
    campo<HTMLInputElement>("nome").focus();
  };

  aoClicar(raiz, "voltar", () => ctx.irPara("inicio"));
  aoClicar(raiz, "tabela", () => ctx.irPara("tabela"));
  aoClicar(raiz, "nova", () => abrirForm());
  aoClicar(raiz, "editar", (b) => abrirForm(dados.assinaturas.find((a) => a.id === b.dataset.id)));
  aoClicar(raiz, "cancelar", () => (form.hidden = true));

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const valores = {
      nome: String(f.get("nome")).trim(),
      valor: String(f.get("valor") ?? "").trim(),
      dia: Math.min(31, Math.max(1, Number(f.get("dia")))),
      frequencia: (f.get("frequencia") === "anual" ? "anual" : "mensal") as Assinatura["frequencia"],
      mes: Number(f.get("mes") ?? 1),
      antecedencia: Math.max(0, Number(f.get("antecedencia"))),
    };
    mudar((d) => {
      const existente = d.assinaturas.find((a) => a.id === editando);
      if (existente) Object.assign(existente, valores);
      else d.assinaturas.push({ id: novoId(), pagoAte: null, ...valores });
    });
    ctx.renovar();
  });

  aoClicar(raiz, "paguei", (b) => {
    mudar((d) => {
      const a = d.assinaturas.find((x) => x.id === b.dataset.id);
      if (a) a.pagoAte = paraISO(situacao(a).vence);
    });
    ctx.renovar();
  });
  aoClicar(raiz, "apagar", (b) =>
    confirmarAntes(b, "Apagar?", () => {
      mudar((d) => (d.assinaturas = d.assinaturas.filter((x) => x.id !== b.dataset.id)));
      ctx.renovar();
    }),
  );
  return raiz;
}
