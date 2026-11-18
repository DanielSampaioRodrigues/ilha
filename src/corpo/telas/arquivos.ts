// Arquivos soltos na ilha: o que dá para fazer com eles na hora.
// Tudo é gravado ao lado do original, com nome novo (nada é apagado).
import { invoke } from "@tauri-apps/api/core";
import type { Contexto } from "../contexto";
import { ICONES } from "../icones";
import { aoClicar, cabecalho, escapar, html } from "../ui";
import { abrirCentral } from "../../maos/sistema";
import { dentroDoApp } from "../../ponte";

/** Os arquivos que chegaram por último (a tela lê daqui). */
let soltos: string[] = [];
export function receberArquivos(caminhos: string[]): void {
  soltos = caminhos;
}

const IMAGEM = /\.(jpe?g|png|webp|bmp|gif)$/i;
const nome = (c: string) => c.split(/[\\/]/).pop() ?? c;
const pasta = (c: string) => c.replace(/[\\/][^\\/]*$/, "");

export function montarArquivos(ctx: Contexto): HTMLElement {
  const imagens = soltos.filter((c) => IMAGEM.test(c));
  const raiz = html(`
    <div class="estado aberta tela">
      ${cabecalho(soltos.length === 1 ? "1 arquivo" : `${soltos.length} arquivos`)}
      <div class="secao lista-soltos">
        ${soltos
          .slice(0, 6)
          .map((c) => `<div class="item"><span class="icone-arquivo">${ICONES.arquivo}</span><span class="principal">${escapar(nome(c))}</span></div>`)
          .join("")}
        ${soltos.length > 6 ? `<p class="secundario">e mais ${soltos.length - 6}…</p>` : ""}
      </div>
      <div class="grade-acoes-arquivo">
        ${
          imagens.length
            ? `
        <button type="button" class="cartao-acao" data-acao="diminuir"><strong>Diminuir</strong><span>${imagens.length > 1 ? "as imagens" : "a imagem"} (até 1920 px, JPG leve)</span></button>
        <button type="button" class="cartao-acao" data-acao="pdf"><strong>Juntar em PDF</strong><span>uma imagem por página</span></button>
        <button type="button" class="cartao-acao" data-acao="jpg"><strong>Converter para JPG</strong><span>mais leve</span></button>
        <button type="button" class="cartao-acao" data-acao="png"><strong>Converter para PNG</strong><span>sem perder qualidade</span></button>`
            : ""
        }
        ${soltos.length > 1 ? `<button type="button" class="cartao-acao" data-acao="renomear"><strong>Renomear em sequência</strong><span>“Viagem 01”, “Viagem 02”…</span></button>` : ""}
        <button type="button" class="cartao-acao" data-acao="conversa"><strong>Mandar para a IA</strong><span>abre a conversa com ${soltos.length > 1 ? "eles" : "ele"} anexado${soltos.length > 1 ? "s" : ""}</span></button>
      </div>
      <form class="linha renomear-form" hidden>
        <input class="entrada" name="base" maxlength="60" placeholder="Nome (ex.: Viagem Recife)" aria-label="Nome base">
        <button type="submit" class="botao ciano">Renomear</button>
      </form>
      <p class="secundario resultado-arquivos" aria-live="polite">${imagens.length || soltos.length > 1 ? "Os novos arquivos ficam ao lado dos originais." : ""}</p>
      <div class="linha fim"><button type="button" class="botao" data-acao="abrir-pasta-resultado" hidden>Abrir a pasta</button></div>
    </div>`);

  const resultado = raiz.querySelector<HTMLElement>(".resultado-arquivos")!;
  const abrirPastaBotao = raiz.querySelector<HTMLButtonElement>('[data-acao="abrir-pasta-resultado"]')!;
  let ultimaPasta = "";
  const fazer = async (rotulo: string, acao: () => Promise<string[]>) => {
    raiz.querySelectorAll<HTMLButtonElement>(".cartao-acao").forEach((b) => (b.disabled = true));
    resultado.textContent = `${rotulo}…`;
    try {
      const feitos = await acao();
      ultimaPasta = feitos[0] ? pasta(feitos[0]) : "";
      resultado.textContent = feitos.length === 1 ? `Pronto: ${nome(feitos[0])}` : `Pronto: ${feitos.length} arquivos.`;
      abrirPastaBotao.hidden = !ultimaPasta;
    } catch (e) {
      resultado.textContent = String(e);
    } finally {
      raiz.querySelectorAll<HTMLButtonElement>(".cartao-acao").forEach((b) => (b.disabled = false));
    }
  };
  const chamar = <T,>(comando: string, args: Record<string, unknown>) =>
    dentroDoApp ? invoke<T>(comando, args) : Promise.reject("Só funciona no app.");

  aoClicar(raiz, "voltar", () => ctx.irPara("inicio"));
  aoClicar(raiz, "diminuir", () => fazer("Diminuindo", () => chamar<string[]>("diminuir_imagens", { caminhos: imagens })));
  aoClicar(raiz, "pdf", () => fazer("Montando o PDF", async () => [await chamar<string>("imagens_para_pdf", { caminhos: imagens })]));
  aoClicar(raiz, "jpg", () => fazer("Convertendo", () => chamar<string[]>("converter_imagens", { caminhos: imagens, formato: "jpg" })));
  aoClicar(raiz, "png", () => fazer("Convertendo", () => chamar<string[]>("converter_imagens", { caminhos: imagens, formato: "png" })));
  aoClicar(raiz, "conversa", () => {
    abrirCentral("conversa-atual", soltos).catch(() => {});
    ctx.fechar();
  });
  const form = raiz.querySelector<HTMLFormElement>(".renomear-form")!;
  aoClicar(raiz, "renomear", () => {
    form.hidden = false;
    form.querySelector("input")?.focus();
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const base = String(new FormData(form).get("base") ?? "").trim();
    if (!base) return;
    void fazer("Renomeando", async () => {
      const novos = await chamar<string[]>("renomear_em_sequencia", { caminhos: soltos, base });
      soltos = novos;
      return novos;
    });
  });
  aoClicar(raiz, "abrir-pasta-resultado", () => {
    if (ultimaPasta) invoke("abrir_pasta", { caminho: ultimaPasta }).catch(() => {});
  });
  return raiz;
}
