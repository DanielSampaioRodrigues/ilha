// Perfis (agentes): um nome + motor + modelo + nível de raciocínio +
// instruções + quais MCPs e skills ficam ligados. Ao começar uma conversa,
// escolher um perfil já deixa tudo pronto.
import { ler, mudar, novoId, type Perfil } from "../dados/armazem";
import { esforcosDe, guardarModelosExtras, modelosDe, nomeDoEsforco, nomeDoModelo } from "../dados/modelos";
import { listarModelos, NOMES_MOTORES, type Motor } from "../maos/sistema";
import { selo, SELO_MOTOR as SELO } from "../corpo/selos";
import { aoClicar, confirmarAntes, escapar, html } from "../corpo/ui";

let editando: string | null = null;
let rascunhoMotor: Motor = "claude";
const buscouModelos = new Set<Motor>();

export function montarPerfis(redesenhar: () => void): HTMLElement {
  const d = ler();
  const atual = d.perfis.find((p) => p.id === editando);
  const motor: Motor = atual?.motor ?? rascunhoMotor;
  const opcoes = (lista: { valor: string; nome: string }[], escolhido: string) =>
    lista.map((o) => `<option value="${escapar(o.valor)}" ${o.valor === escolhido ? "selected" : ""}>${escapar(o.nome)}</option>`).join("");
  const marcas = (lista: { id: string; nome: string; descricao: string }[], ligados: string[], grupo: string) =>
    lista.length
      ? lista
          .map(
            (x) => `
        <label class="marca-item"><input type="checkbox" name="${grupo}" value="${x.id}" ${ligados.includes(x.id) ? "checked" : ""}>
          <span class="coluna"><span class="principal">${escapar(x.nome)}</span><span class="secundario">${escapar(x.descricao)}</span></span></label>`,
          )
          .join("")
      : `<p class="secundario">Nenhum instalado. Veja em “MCPs e Skills”.</p>`;

  const raiz = html(`
    <div class="pagina">
      <header class="topo-pagina">
        <h1>Perfis</h1>
        <p class="secundario">Um perfil é como um agente: motor, modelo, jeito de pensar, instruções e ferramentas, tudo salvo junto. Ex.: “Editor do livro” (Claude, cuidadoso, com a skill de revisão).</p>
      </header>
      <div class="secao">
        ${
          d.perfis
            .map(
              (p) => `
          <div class="item">
            ${selo(SELO[p.motor], 20)}
            <div class="coluna">
              <span class="principal">${escapar(p.nome)}</span>
              <span class="secundario">${NOMES_MOTORES[p.motor]}${p.modelo ? ` · ${escapar(nomeDoModelo(p.motor, p.modelo))}` : ""}${p.esforco ? ` · raciocínio ${escapar(nomeDoEsforco(p.motor, p.esforco).toLowerCase())}` : ""} · ${p.mcps.length} MCP · ${p.skills.length} skill</span>
            </div>
            <button type="button" class="botao" data-acao="editar" data-id="${p.id}">Editar</button>
            <button type="button" class="botao" data-acao="apagar" data-id="${p.id}">Apagar</button>
          </div>`,
            )
            .join("") || '<p class="vazio">Nenhum perfil ainda.</p>'
        }
      </div>
      <form class="formulario-projeto form-perfil">
        <p class="titulo-secao">${atual ? `Editando “${escapar(atual.nome)}”` : "Novo perfil"}</p>
        <label class="campo">Nome<input name="nome" required maxlength="50" value="${escapar(atual?.nome ?? "")}" placeholder="ex.: Editor do livro"></label>
        <div class="grade-perfil">
          <label class="campo">Motor<select name="motor" class="entrada">${(Object.keys(NOMES_MOTORES) as Motor[])
            .map((m) => `<option value="${m}" ${m === motor ? "selected" : ""}>${NOMES_MOTORES[m]}</option>`)
            .join("")}</select></label>
          <label class="campo">Modelo<select name="modelo" class="entrada">${opcoes(modelosDe(motor, atual?.modelo), atual?.modelo ?? "")}</select></label>
          <label class="campo">Raciocínio<select name="esforco" class="entrada">${opcoes(esforcosDe(motor, atual?.esforco), atual?.esforco ?? "")}</select></label>
          ${
            motor === "deepseek" || motor === "antigravity"
              ? ""
              : `<label class="campo">Pode mexer em arquivos?<select name="modo" class="entrada">
                  <option value="conversar" ${atual?.modo !== "editar" ? "selected" : ""}>Não, só conversar e ler</option>
                  <option value="editar" ${atual?.modo === "editar" ? "selected" : ""}>Sim, pode editar</option>
                </select></label>`
          }
        </div>
        <label class="campo">Instruções<textarea name="instrucoes" rows="5" placeholder="Quem ele é e como deve trabalhar">${escapar(atual?.instrucoes ?? "")}</textarea></label>
        <div class="duas-colunas">
          <fieldset class="caixa-marcas"><legend class="titulo-secao">MCPs ligados</legend>${marcas(d.mcps.map((m) => ({ id: m.id, nome: m.nome, descricao: m.descricao })), atual?.mcps ?? [], "mcps")}</fieldset>
          <fieldset class="caixa-marcas"><legend class="titulo-secao">Skills ligadas</legend>${marcas(d.skills, atual?.skills ?? [], "skills")}</fieldset>
        </div>
        ${motor === "deepseek" || motor === "antigravity" ? `<p class="secundario">${NOMES_MOTORES[motor]} usa as skills como instruções; MCPs da ilha funcionam com Claude Code, Codex e Gemini CLI.</p>` : ""}
        ${motor === "gemini" ? '<p class="secundario">Atenção: desde junho de 2026 o Gemini CLI só funciona com chave paga da API do Gemini. Com a assinatura Google AI Pro, use o Antigravity.</p>' : ""}
        <div class="linha fim"><span class="espaco"></span>${atual ? '<button type="button" class="botao" data-acao="cancelar">Cancelar</button>' : ""}<button type="submit" class="botao ciano">Salvar perfil</button></div>
      </form>
    </div>`);

  // Antigravity e DeepSeek: a lista de modelos vem do próprio programa.
  if ((motor === "antigravity" || motor === "deepseek") && !buscouModelos.has(motor)) {
    buscouModelos.add(motor);
    listarModelos(motor)
      .then((l) => {
        if (!l.length) return;
        guardarModelosExtras(motor, l);
        if (raiz.isConnected) redesenhar();
      })
      .catch(() => {});
  }

  const form = raiz.querySelector<HTMLFormElement>(".form-perfil")!;
  form.querySelector<HTMLSelectElement>('[name="motor"]')!.addEventListener("change", (e) => {
    const novo = (e.target as HTMLSelectElement).value as Motor;
    if (atual) mudar((dd) => dd.perfis.forEach((p) => p.id === atual.id && ((p.motor = novo), (p.modelo = ""), (p.esforco = ""))));
    else rascunhoMotor = novo;
    redesenhar();
  });
  aoClicar(raiz, "editar", (b) => {
    editando = b.dataset.id ?? null;
    redesenhar();
  });
  aoClicar(raiz, "cancelar", () => {
    editando = null;
    redesenhar();
  });
  aoClicar(raiz, "apagar", (b) =>
    confirmarAntes(b, "Apagar?", () => {
      mudar((dd) => (dd.perfis = dd.perfis.filter((p) => p.id !== b.dataset.id)));
      redesenhar();
    }),
  );
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const valores: Omit<Perfil, "id"> = {
      nome: String(f.get("nome")).trim(),
      motor,
      modelo: String(f.get("modelo") ?? ""),
      esforco: String(f.get("esforco") ?? ""),
      modo: f.get("modo") === "editar" ? "editar" : "conversar",
      instrucoes: String(f.get("instrucoes") ?? "").trim(),
      mcps: f.getAll("mcps").map(String),
      skills: f.getAll("skills").map(String),
    };
    mudar((dd) => {
      const p = dd.perfis.find((x) => x.id === editando);
      if (p) Object.assign(p, valores);
      else dd.perfis.push({ id: novoId(), ...valores });
    });
    editando = null;
    redesenhar();
  });
  return raiz;
}
