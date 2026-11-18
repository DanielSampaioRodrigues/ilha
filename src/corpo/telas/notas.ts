// Notas com abas. Salva sozinho enquanto o Dan digita.
import { ler, mudar, novoId } from "../../dados/armazem";
import type { Contexto } from "../contexto";
import { aoClicar, cabecalho, confirmarAntes, escapar, html } from "../ui";
import { transformarTexto, type AcaoTexto } from "../../maos/sistema";

/** O texto antes da última mudança feita pela IA (para "Desfazer"). */
let antesDaIa: { id: string; texto: string } | null = null;

function tituloDa(texto: string): string {
  const primeira = texto.trim().split("\n")[0]?.trim() ?? "";
  if (!primeira) return "Nova nota";
  return primeira.length > 18 ? `${primeira.slice(0, 17)}…` : primeira;
}

export function montarNotas(ctx: Contexto): HTMLElement {
  const dados = ler();
  const atualId = dados.notas.some((n) => n.id === dados.notaAtual) ? dados.notaAtual : dados.notas[0].id;
  const atual = dados.notas.find((n) => n.id === atualId)!;

  const abas = dados.notas
    .map(
      (n) => `
      <button type="button" class="aba ${n.id === atualId ? "ativa" : ""}" data-acao="aba" data-id="${n.id}">${escapar(tituloDa(n.texto))}</button>`,
    )
    .join("");

  const raiz = html(`
    <div class="estado aberta tela">
      ${cabecalho("Notas")}
      <div class="abas">
        ${abas}
        <button type="button" class="aba nova" aria-label="Nova nota" data-acao="nova">+</button>
      </div>
      <textarea class="nota" spellcheck="true" placeholder="Escreva aqui. A primeira linha vira o nome da aba. Tudo é salvo sozinho."></textarea>
      <div class="linha ia-nota">
        <span class="secundario">IA:</span>
        ${(
          [
            ["corrigir", "Corrigir"],
            ["melhorar", "Melhorar"],
            ["resumir", "Resumir"],
            ["traduzir", "Traduzir"],
          ] as const
        )
          .map(([a, n]) => `<button type="button" class="chip" data-ia-nota="${a}">${n}</button>`)
          .join("")}
        <button type="button" class="chip desfazer-ia" data-acao="desfazer-ia" ${antesDaIa?.id === atualId ? "" : "hidden"}>Desfazer</button>
      </div>
      <div class="linha fim">
        <span class="secundario estado-salvo">Salvo</span>
        <span class="espaco"></span>
        <button type="button" class="botao" data-acao="apagar">Apagar esta nota</button>
      </div>
    </div>`);

  const campo = raiz.querySelector<HTMLTextAreaElement>(".nota")!;
  const salvo = raiz.querySelector<HTMLElement>(".estado-salvo")!;
  const abaAtual = raiz.querySelector<HTMLElement>(".aba.ativa")!;
  campo.value = atual.texto;
  let relogio = 0;
  campo.addEventListener("input", () => {
    salvo.textContent = "Salvando…";
    abaAtual.textContent = tituloDa(campo.value);
    mudar((d) => {
      const nota = d.notas.find((n) => n.id === atualId);
      if (nota) nota.texto = campo.value;
    });
    window.clearTimeout(relogio);
    relogio = window.setTimeout(() => (salvo.textContent = "Salvo"), 600);
  });
  window.setTimeout(() => campo.focus(), 250);

  aoClicar(raiz, "voltar", () => ctx.irPara("inicio"));
  // A IA (DeepSeek) mexe no texto da nota (ou só no trecho selecionado); "Desfazer" volta.
  const trocarTexto = (novo: string) => {
    campo.value = novo;
    campo.dispatchEvent(new Event("input"));
  };
  raiz.querySelectorAll<HTMLButtonElement>("[data-ia-nota]").forEach((b) =>
    b.addEventListener("click", async () => {
      const [ini, fim] = [campo.selectionStart, campo.selectionEnd];
      const trecho = fim > ini ? campo.value.slice(ini, fim) : campo.value;
      if (!trecho.trim()) return;
      const rotulo = b.textContent;
      raiz.querySelectorAll<HTMLButtonElement>("[data-ia-nota]").forEach((x) => (x.disabled = true));
      b.textContent = "…";
      try {
        const pronto = await transformarTexto(b.dataset.iaNota as AcaoTexto, trecho);
        antesDaIa = { id: atualId!, texto: campo.value };
        trocarTexto(fim > ini ? campo.value.slice(0, ini) + pronto + campo.value.slice(fim) : pronto);
        raiz.querySelector<HTMLElement>(".desfazer-ia")!.hidden = false;
      } catch (erro) {
        salvo.textContent = String(erro).slice(0, 90);
      } finally {
        b.textContent = rotulo;
        raiz.querySelectorAll<HTMLButtonElement>("[data-ia-nota]").forEach((x) => (x.disabled = false));
      }
    }),
  );
  aoClicar(raiz, "desfazer-ia", (b) => {
    if (antesDaIa?.id !== atualId) return;
    trocarTexto(antesDaIa.texto);
    antesDaIa = null;
    b.hidden = true;
  });
  aoClicar(raiz, "aba", (b) => {
    mudar((d) => (d.notaAtual = b.dataset.id ?? null));
    ctx.renovar();
  });
  aoClicar(raiz, "nova", () => {
    const id = novoId();
    mudar((d) => {
      d.notas.push({ id, texto: "" });
      d.notaAtual = id;
    });
    ctx.renovar();
  });
  aoClicar(raiz, "apagar", (b) =>
    confirmarAntes(b, "Apagar de vez?", () => {
      mudar((d) => {
        d.notas = d.notas.filter((n) => n.id !== atualId);
        if (!d.notas.length) d.notas.push({ id: novoId(), texto: "" });
        d.notaAtual = d.notas[0].id;
      });
      ctx.renovar();
    }),
  );
  return raiz;
}
