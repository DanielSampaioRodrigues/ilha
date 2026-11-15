// Redefinições: quando o limite de uma IA volta (ex.: Gemini Pro toda terça às
// 18:32). Perto da data, o robô mostra um sinal verde: é hora de aproveitar,
// porque o que sobrar vai renovar.
import { ler, mudar, novoId, type Redefinicao } from "../../dados/armazem";
import { REPETE, faltaEscrito, paraISO, pertoDeRenovar, quandoEscrito } from "../../dados/datas";
import type { Contexto } from "../contexto";
import { ICONES } from "../icones";
import { NOMES_IA, seloDa } from "../selos";
import { aoClicar, cabecalho, confirmarAntes, escapar, html } from "../ui";

export function montarRedefinicoes(ctx: Contexto): HTMLElement {
  const dados = ler();
  const agora = new Date();

  const lista = [...dados.redefinicoes]
    .sort((a, b) => a.proxima.localeCompare(b.proxima))
    .map((r) => {
      const quando = new Date(r.proxima);
      const perto = pertoDeRenovar(r, agora);
      return `
      <div class="item">
        <span class="selo-caixa ${perto ? "perto" : ""}">${seloDa(r, 20)}</span>
        <div class="coluna">
          <span class="principal">${escapar(r.nome)}${perto ? ' · <span class="verde">aproveite</span>' : ""}</span>
          <span class="secundario">${faltaEscrito(quando, agora)} · ${quandoEscrito(quando, agora)} · ${REPETE[r.repete]}</span>
        </div>
        <button type="button" class="redondo" aria-label="Editar ${escapar(r.nome)}" data-acao="editar" data-id="${r.id}">${ICONES.lapis}</button>
        <button type="button" class="redondo" aria-label="Apagar ${escapar(r.nome)}" data-acao="apagar" data-id="${r.id}">${ICONES.lixeira}</button>
      </div>`;
    })
    .join("");

  const raiz = html(`
    <div class="estado aberta tela">
      ${cabecalho("Redefinições das IAs")}
      <p class="secundario">Quando o limite de uso volta. Perto da data, o símbolo da IA aparece ao lado do robô: passe o mouse para ver quanto falta e aproveite o que sobrou.</p>
      <section class="secao">
        ${lista || '<p class="vazio">Nenhuma ainda. Ex.: "Gemini Pro · limite semanal", toda terça às 18:32.</p>'}
        <button type="button" class="link" data-acao="nova">+ Nova redefinição</button>
        <form class="formulario" hidden>
          <label class="campo largo">Nome<input name="nome" required maxlength="60" placeholder="Ex.: Claude Max · limite semanal"></label>
          <label class="campo largo2">Próxima redefinição<input name="proxima" type="datetime-local" required></label>
          <label class="campo">Repete<select name="repete">
            ${Object.entries(REPETE).map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}
          </select></label>
          <label class="campo">Símbolo<select name="ia">
            <option value="auto">pelo nome</option>
            ${Object.entries(NOMES_IA).map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}
          </select></label>
          <label class="campo">Sinal no robô<select name="avisarDias">
            ${[0, 1, 2, 3].map((n) => `<option value="${n}">${n === 0 ? "sem sinal" : n === 1 ? "1 dia antes" : `${n} dias antes`}</option>`).join("")}
          </select></label>
          <div class="linha fim largo"><span class="espaco"></span><button type="button" class="botao" data-acao="cancelar">Cancelar</button><button type="submit" class="botao ciano">Salvar</button></div>
        </form>
      </section>
    </div>`);

  const form = raiz.querySelector<HTMLFormElement>("form")!;
  const campo = <T extends HTMLInputElement | HTMLSelectElement>(nome: string) =>
    form.querySelector<T>(`[name="${nome}"]`)!;
  let editando: string | null = null;

  const abrirForm = (r?: Redefinicao) => {
    editando = r?.id ?? null;
    const daquiUmaSemana = new Date(agora.getTime() + 7 * 86400000);
    campo("nome").value = r?.nome ?? "";
    campo("proxima").value = r?.proxima ?? `${paraISO(daquiUmaSemana)}T09:00`;
    campo("repete").value = r?.repete ?? "semanal";
    campo("avisarDias").value = String(r?.avisarDias ?? 2);
    campo("ia").value = r?.ia ?? "auto";
    form.hidden = false;
    campo("nome").focus();
  };

  aoClicar(raiz, "voltar", () => ctx.irPara("inicio"));
  aoClicar(raiz, "nova", () => abrirForm());
  aoClicar(raiz, "editar", (b) => abrirForm(dados.redefinicoes.find((r) => r.id === b.dataset.id)));
  aoClicar(raiz, "cancelar", () => (form.hidden = true));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const valores = {
      nome: String(f.get("nome")).trim(),
      proxima: String(f.get("proxima")),
      repete: String(f.get("repete")) as Redefinicao["repete"],
      avisarDias: Number(f.get("avisarDias")),
      ia: String(f.get("ia") ?? "auto") as Redefinicao["ia"],
    };
    mudar((d) => {
      const existente = d.redefinicoes.find((r) => r.id === editando);
      if (existente) Object.assign(existente, valores);
      else d.redefinicoes.push({ id: novoId(), ...valores });
    });
    ctx.renovar();
  });
  aoClicar(raiz, "apagar", (b) =>
    confirmarAntes(b, "Apagar?", () => {
      mudar((d) => (d.redefinicoes = d.redefinicoes.filter((r) => r.id !== b.dataset.id)));
      ctx.renovar();
    }),
  );
  return raiz;
}
