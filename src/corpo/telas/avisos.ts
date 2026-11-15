// Tela de assinaturas (com "Paguei") e lembretes de redefinição.
import { ler, mudar, novoId } from "../../dados/armazem";
import { MESES, diaEscrito, paraISO, prazo, quandoLembrete, situacao } from "../../dados/datas";
import type { Contexto } from "../contexto";
import { aoClicar, cabecalho, confirmarAntes, escapar, html } from "../ui";

const LIXEIRA =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>';

export function montarAvisos(ctx: Contexto): HTMLElement {
  const dados = ler();
  const agora = new Date();

  const assinaturas = dados.assinaturas
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
        <button type="button" class="redondo" aria-label="Apagar ${escapar(a.nome)}" data-acao="apagar-assinatura" data-id="${a.id}">${LIXEIRA}</button>
      </div>`,
    )
    .join("");

  const lembretes = [...dados.lembretes]
    .sort((a, b) => a.quando.localeCompare(b.quando))
    .map(
      (l) => `
      <div class="item">
        <span class="ponto amarelo"></span>
        <div class="coluna">
          <span class="principal">${escapar(l.titulo)}</span>
          <span class="secundario">${quandoLembrete(l, agora)}</span>
        </div>
        <button type="button" class="redondo" aria-label="Apagar ${escapar(l.titulo)}" data-acao="apagar-lembrete" data-id="${l.id}">${LIXEIRA}</button>
      </div>`,
    )
    .join("");

  const opcoesMes = MESES.map((m, i) => `<option value="${i + 1}" ${i === agora.getMonth() ? "selected" : ""}>${m}</option>`).join("");
  const amanha = new Date(agora.getTime() + 86400000);
  amanha.setHours(9, 0, 0, 0);
  const padraoLembrete = `${paraISO(amanha)}T09:00`;

  const raiz = html(`
    <div class="estado aberta tela">
      ${cabecalho("Assinaturas e lembretes")}

      <section class="secao">
        <div class="entre"><p class="titulo-secao">Assinaturas</p><button type="button" class="link" data-acao="abrir-form" data-form="assinatura">+ Nova assinatura</button></div>
        ${assinaturas || '<p class="vazio">Nenhuma assinatura ainda. O aviso laranja aparece alguns dias antes de cada vencimento e fica até você marcar "Paguei".</p>'}
        <form class="formulario" data-form="assinatura" hidden>
          <label class="campo largo">Nome<input name="nome" required maxlength="60" placeholder="Ex.: Créditos do Claude"></label>
          <label class="campo">Valor<input name="valor" maxlength="20" placeholder="R$ 110"></label>
          <label class="campo">Vence todo dia<input name="dia" type="number" min="1" max="31" value="${agora.getDate()}" required></label>
          <label class="campo">Repete<select name="frequencia"><option value="mensal">todo mês</option><option value="anual">todo ano</option></select></label>
          <label class="campo so-anual" hidden>Mês<select name="mes">${opcoesMes}</select></label>
          <label class="campo">Avisar quantos dias antes<input name="antecedencia" type="number" min="0" max="30" value="3" required></label>
          <div class="linha fim largo"><span class="espaco"></span><button type="button" class="botao" data-acao="fechar-form">Cancelar</button><button type="submit" class="botao ciano">Salvar</button></div>
        </form>
      </section>

      <section class="secao">
        <div class="entre"><p class="titulo-secao">Lembretes</p><button type="button" class="link" data-acao="abrir-form" data-form="lembrete">+ Novo lembrete</button></div>
        ${lembretes || '<p class="vazio">Para avisos de uma vez só, como "o limite do Gemini volta terça às 18:32".</p>'}
        <form class="formulario" data-form="lembrete" hidden>
          <label class="campo largo">O que lembrar<input name="titulo" required maxlength="80" placeholder="Ex.: Limite do Gemini Pro voltou"></label>
          <label class="campo largo">Quando<input name="quando" type="datetime-local" value="${padraoLembrete}" required></label>
          <div class="linha fim largo"><span class="espaco"></span><button type="button" class="botao" data-acao="fechar-form">Cancelar</button><button type="submit" class="botao ciano">Salvar</button></div>
        </form>
      </section>
    </div>`);

  aoClicar(raiz, "voltar", () => ctx.irPara("inicio"));

  const formularios = raiz.querySelectorAll<HTMLFormElement>("form.formulario");
  aoClicar(raiz, "abrir-form", (b) => {
    formularios.forEach((f) => (f.hidden = f.dataset.form !== b.dataset.form));
    raiz.querySelector<HTMLInputElement>(`form[data-form="${b.dataset.form}"] input`)?.focus();
  });
  aoClicar(raiz, "fechar-form", () => formularios.forEach((f) => (f.hidden = true)));

  const formAssinatura = raiz.querySelector<HTMLFormElement>('form[data-form="assinatura"]')!;
  const frequencia = formAssinatura.querySelector<HTMLSelectElement>('[name="frequencia"]')!;
  frequencia.addEventListener("change", () => {
    formAssinatura.querySelector<HTMLElement>(".so-anual")!.hidden = frequencia.value !== "anual";
  });
  formAssinatura.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(formAssinatura);
    mudar((d) =>
      d.assinaturas.push({
        id: novoId(),
        nome: String(f.get("nome")).trim(),
        valor: String(f.get("valor") ?? "").trim(),
        dia: Math.min(31, Math.max(1, Number(f.get("dia")))),
        frequencia: f.get("frequencia") === "anual" ? "anual" : "mensal",
        mes: Number(f.get("mes") ?? 1),
        antecedencia: Math.max(0, Number(f.get("antecedencia"))),
        pagoAte: null,
      }),
    );
    ctx.renovar();
  });

  const formLembrete = raiz.querySelector<HTMLFormElement>('form[data-form="lembrete"]')!;
  formLembrete.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(formLembrete);
    mudar((d) =>
      d.lembretes.push({ id: novoId(), titulo: String(f.get("titulo")).trim(), quando: String(f.get("quando")) }),
    );
    ctx.renovar();
  });

  aoClicar(raiz, "paguei", (b) => {
    mudar((d) => {
      const a = d.assinaturas.find((x) => x.id === b.dataset.id);
      if (a) a.pagoAte = paraISO(situacao(a).vence);
    });
    ctx.renovar();
  });
  aoClicar(raiz, "apagar-assinatura", (b) =>
    confirmarAntes(b, "Apagar?", () => {
      mudar((d) => (d.assinaturas = d.assinaturas.filter((x) => x.id !== b.dataset.id)));
      ctx.renovar();
    }),
  );
  aoClicar(raiz, "apagar-lembrete", (b) =>
    confirmarAntes(b, "Apagar?", () => {
      mudar((d) => (d.lembretes = d.lembretes.filter((x) => x.id !== b.dataset.id)));
      ctx.renovar();
    }),
  );

  return raiz;
}
