// Projetos: uma pasta liberada + instruções próprias, iguais para todos os
// motores (ex.: "Livro novo" → pasta do InDesign + "responda como editor").
import { open } from "@tauri-apps/plugin-dialog";
import { enquanto } from "../maos/foco";
import { ler, mudar, novoId, type Projeto } from "../dados/armazem";
import { dentroDoApp } from "../ponte";
import { aoClicar, confirmarAntes, escapar, html } from "../corpo/ui";

let editando: string | null = null;

export function montarProjetos(redesenhar: () => void): HTMLElement {
  const projetos = ler().projetos;
  const atual = projetos.find((p) => p.id === editando);
  const raiz = html(`
    <div class="pagina">
      <header class="topo-pagina">
        <h1>Projetos</h1>
        <p class="secundario">Cada projeto é uma pasta e as instruções que os motores devem seguir nela. Ao começar uma conversa, escolha o projeto.</p>
      </header>
      <div class="secao">
        ${
          projetos
            .map(
              (p) => `
          <div class="item">
            <div class="coluna">
              <span class="principal">${escapar(p.nome)}</span>
              <span class="secundario caminho">${escapar(p.pasta)}</span>
            </div>
            <button type="button" class="botao" data-acao="editar" data-id="${p.id}">Editar</button>
            <button type="button" class="botao" data-acao="apagar" data-id="${p.id}">Apagar</button>
          </div>`,
            )
            .join("") || '<p class="vazio">Nenhum projeto ainda.</p>'
        }
      </div>
      <form class="formulario-projeto">
        <p class="titulo-secao">${atual ? `Editando “${escapar(atual.nome)}”` : "Novo projeto"}</p>
        <label class="campo">Nome<input name="nome" required maxlength="60" value="${escapar(atual?.nome ?? "")}" placeholder="Ex.: Livro novo"></label>
        <label class="campo">Pasta
          <span class="linha"><input name="pasta" required value="${escapar(atual?.pasta ?? "")}" placeholder="C:\\Users\\voce\\Documents\\Livro"><button type="button" class="botao" data-acao="escolher">Escolher…</button></span>
        </label>
        <label class="campo">Instruções (opcional)<textarea name="instrucoes" rows="5" placeholder="Ex.: É um livro de psicologia para leigos. Responda como um editor cuidadoso, em português do Brasil.">${escapar(atual?.instrucoes ?? "")}</textarea></label>
        <div class="linha fim"><span class="espaco"></span>${atual ? '<button type="button" class="botao" data-acao="cancelar">Cancelar</button>' : ""}<button type="submit" class="botao ciano">Salvar</button></div>
      </form>
    </div>`);

  const form = raiz.querySelector<HTMLFormElement>("form")!;
  aoClicar(raiz, "escolher", () => {
    if (!dentroDoApp) return;
    enquanto(open({ directory: true, multiple: false, title: "Escolha a pasta do projeto" }))
      .then((p) => {
        if (typeof p === "string") form.querySelector<HTMLInputElement>('[name="pasta"]')!.value = p;
      })
      .catch(() => {});
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
      mudar((d) => (d.projetos = d.projetos.filter((p) => p.id !== b.dataset.id)));
      redesenhar();
    }),
  );
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const valores: Omit<Projeto, "id"> = {
      nome: String(f.get("nome")).trim(),
      pasta: String(f.get("pasta")).trim(),
      instrucoes: String(f.get("instrucoes") ?? "").trim(),
    };
    mudar((d) => {
      const p = d.projetos.find((x) => x.id === editando);
      if (p) Object.assign(p, valores);
      else d.projetos.push({ id: novoId(), ...valores });
    });
    editando = null;
    redesenhar();
  });
  return raiz;
}
