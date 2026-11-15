// Lançador: escolher quais programas e sites aparecem na ilha.
import { CORES, ler, mudar, novoId } from "../../dados/armazem";
import { escolherPrograma } from "../../maos/sistema";
import type { Contexto } from "../contexto";
import { aoClicar, cabecalho, confirmarAntes, escapar, html } from "../ui";

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
          <span class="secundario caminho">${escapar(app.caminho)}</span>
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
        <button type="button" class="botao ciano" data-acao="programa">Adicionar programa…</button>
        <button type="button" class="botao" data-acao="abrir-site">Adicionar site</button>
        <span class="secundario aviso-apps"></span>
      </div>
      <form class="formulario" hidden>
        <label class="campo">Nome<input name="nome" required maxlength="30" placeholder="Ex.: Canva"></label>
        <label class="campo largo2">Endereço<input name="endereco" required placeholder="https://www.canva.com"></label>
        <div class="linha fim largo"><span class="espaco"></span><button type="button" class="botao" data-acao="fechar-site">Cancelar</button><button type="submit" class="botao ciano">Salvar</button></div>
      </form>
    </div>`);

  const adicionar = (nome: string, caminho: string) => {
    mudar((d) => d.apps.push({ id: novoId(), nome, caminho, cor: CORES[d.apps.length % CORES.length] }));
    ctx.renovar();
  };

  aoClicar(raiz, "voltar", () => ctx.irPara("inicio"));
  aoClicar(raiz, "programa", () => {
    ctx
      .segurarAberta(escolherPrograma())
      .then((caminho) => {
        if (caminho) adicionar(nomeDoArquivo(caminho), caminho);
      })
      .catch(() => {});
  });
  const form = raiz.querySelector<HTMLFormElement>("form")!;
  aoClicar(raiz, "abrir-site", () => {
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
