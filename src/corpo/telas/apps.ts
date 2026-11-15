// Lançador: escolher quais programas e sites aparecem na ilha.
import { CORES, ler, mudar, novoId } from "../../dados/armazem";
import { escolherPrograma, listarProgramas, type ProgramaInstalado } from "../../maos/sistema";
import type { Contexto } from "../contexto";
import { aoClicar, cabecalho, confirmarAntes, escapar, html } from "../ui";

// A lista de programas instalados demora um pouco: guarda depois da primeira vez.
let instalados: Promise<ProgramaInstalado[]> | null = null;

function onde(caminho: string): string {
  if (caminho.startsWith("app:")) return "programa instalado";
  if (/^https?:/i.test(caminho)) return `site · ${caminho.replace(/^https?:\/\//i, "")}`;
  return caminho;
}

function nomeDoArquivo(caminho: string): string {
  const arquivo = caminho.split(/[\\/]/).pop() ?? caminho;
  return arquivo.replace(/\.(exe|lnk|url|bat|cmd|appref-ms)$/i, "");
}

export function montarApps(ctx: Contexto): HTMLElement {
  const dados = ler();
  const lista = dados.apps
    .map(
      (app, i) => `
      <div class="item">
        <span class="app-icone pequeno" style="color:${app.cor}">${escapar(app.nome.charAt(0).toUpperCase())}</span>
        <div class="coluna">
          <span class="principal">${escapar(app.nome)}</span>
          <span class="secundario caminho">${escapar(onde(app.caminho))}</span>
        </div>
        <button type="button" class="redondo" aria-label="Subir" data-acao="subir" data-i="${i}" ${i === 0 ? "disabled" : ""}>↑</button>
        <button type="button" class="botao" data-acao="tirar" data-id="${app.id}">Tirar</button>
      </div>`,
    )
    .join("");

  const raiz = html(`
    <div class="estado aberta tela">
      ${cabecalho("Programas e sites da ilha")}
      <p class="secundario">Os 7 primeiros aparecem na ilha aberta.</p>
      <div class="secao">${lista || '<p class="vazio">Nenhum programa ainda.</p>'}</div>
      <div class="linha">
        <button type="button" class="botao ciano" data-acao="abrir-lista">Adicionar programa</button>
        <button type="button" class="botao" data-acao="abrir-site">Adicionar site</button>
      </div>
      <div class="seletor" hidden>
        <input class="entrada" type="search" placeholder="Procurar programa (ex.: ChatGPT, InDesign)" aria-label="Procurar programa">
        <div class="lista-programas"><p class="secundario">Carregando a lista do menu Iniciar…</p></div>
        <div class="linha"><span class="secundario">Não está na lista?</span><button type="button" class="link" data-acao="programa">Escolher o arquivo…</button></div>
      </div>
      <form class="formulario" hidden>
        <label class="campo">Nome<input name="nome" required maxlength="30" placeholder="Ex.: Canva"></label>
        <label class="campo largo2">Endereço<input name="endereco" required placeholder="https://www.canva.com"></label>
        <div class="linha fim largo"><span class="espaco"></span><button type="button" class="botao" data-acao="fechar-site">Cancelar</button><button type="submit" class="botao ciano">Salvar</button></div>
      </form>
    </div>`);

  const form = raiz.querySelector<HTMLFormElement>("form")!;
  const adicionar = (nome: string, caminho: string) => {
    mudar((d) => d.apps.push({ id: novoId(), nome, caminho, cor: CORES[d.apps.length % CORES.length] }));
    ctx.renovar();
  };

  aoClicar(raiz, "voltar", () => ctx.irPara("inicio"));

  // Lista dos programas instalados, com busca.
  const seletor = raiz.querySelector<HTMLElement>(".seletor")!;
  const busca = seletor.querySelector<HTMLInputElement>("input")!;
  const listaProgramas = seletor.querySelector<HTMLElement>(".lista-programas")!;
  let todos: ProgramaInstalado[] = [];
  const desenharLista = () => {
    const termo = busca.value.trim().toLowerCase();
    const achados = todos.filter((p) => p.nome.toLowerCase().includes(termo)).slice(0, 60);
    listaProgramas.innerHTML = achados.length
      ? achados
          .map((p) => `<button type="button" class="opcao" data-i="${todos.indexOf(p)}" tabindex="0">${escapar(p.nome)}</button>`)
          .join("")
      : `<p class="secundario">${todos.length ? "Nada com esse nome." : "Não consegui ler a lista. Use “Escolher o arquivo…”."}</p>`;
  };
  listaProgramas.addEventListener("click", (e) => {
    const botao = (e.target as HTMLElement).closest<HTMLElement>(".opcao");
    if (!botao) return;
    e.stopPropagation();
    const p = todos[Number(botao.dataset.i)];
    if (p) adicionar(p.nome, p.caminho);
  });
  busca.addEventListener("input", desenharLista);
  aoClicar(raiz, "abrir-lista", () => {
    seletor.hidden = false;
    form.hidden = true;
    busca.focus();
    instalados ??= listarProgramas();
    instalados
      .then((lista) => {
        todos = lista;
        desenharLista();
      })
      .catch(() => {
        instalados = null;
        desenharLista();
      });
  });

  aoClicar(raiz, "programa", () => {
    ctx
      .segurarAberta(escolherPrograma())
      .then((caminho) => {
        if (caminho) adicionar(nomeDoArquivo(caminho), caminho);
      })
      .catch(() => {});
  });
  aoClicar(raiz, "abrir-site", () => {
    seletor.hidden = true;
    form.hidden = false;
    form.querySelector("input")?.focus();
  });
  aoClicar(raiz, "fechar-site", () => (form.hidden = true));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(form);
    let endereco = String(f.get("endereco")).trim();
    if (!/^https?:\/\//i.test(endereco)) endereco = `https://${endereco}`;
    adicionar(String(f.get("nome")).trim(), endereco);
  });
  aoClicar(raiz, "subir", (b) => {
    const i = Number(b.dataset.i);
    mudar((d) => d.apps.splice(i - 1, 0, ...d.apps.splice(i, 1)));
    ctx.renovar();
  });
  aoClicar(raiz, "tirar", (b) =>
    confirmarAntes(b, "Tirar?", () => {
      mudar((d) => (d.apps = d.apps.filter((a) => a.id !== b.dataset.id)));
      ctx.renovar();
    }),
  );
  return raiz;
}
