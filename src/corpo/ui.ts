// Pecinhas usadas por todas as telas da ilha.
import { criarCarinha, type Expressao } from "./carinha";

/** Protege textos digitados pelo Dan antes de colocar no HTML. */
export function escapar(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Cria o elemento a partir do HTML e troca cada <i data-carinha> pela carinha. */
export function html(codigo: string): HTMLElement {
  const modelo = document.createElement("template");
  modelo.innerHTML = codigo.trim();
  const elemento = modelo.content.firstElementChild as HTMLElement;
  elemento.querySelectorAll<HTMLElement>("[data-carinha]").forEach((lugar) => {
    const expressao = lugar.dataset.carinha as Expressao;
    const comAcessorio = lugar.hasAttribute("data-acessorio");
    lugar.replaceWith(criarCarinha(expressao, Number(lugar.dataset.tamanho ?? 2), comAcessorio).elemento);
  });
  return elemento;
}

/** Liga os botões com data-acao="..." a uma função (recebe o próprio botão). */
export function aoClicar(raiz: HTMLElement, acao: string, fazer: (botao: HTMLElement) => void): void {
  raiz.querySelectorAll<HTMLElement>(`[data-acao="${acao}"]`).forEach((botao) =>
    botao.addEventListener("click", (e) => {
      e.stopPropagation();
      fazer(botao);
    }),
  );
}

/**
 * Para o que não tem volta (apagar): o primeiro clique só pergunta,
 * o segundo confirma. Se não confirmar em 4 segundos, volta ao normal.
 */
export function confirmarAntes(botao: HTMLElement, pergunta: string, fazer: () => void): void {
  if (botao.dataset.confirmando) {
    fazer();
    return;
  }
  const original = botao.innerHTML;
  botao.dataset.confirmando = "1";
  botao.classList.add("vermelho");
  botao.textContent = pergunta;
  window.setTimeout(() => {
    if (!botao.isConnected) return;
    delete botao.dataset.confirmando;
    botao.classList.remove("vermelho");
    botao.innerHTML = original;
  }, 4000);
}

export const SETA_VOLTAR =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';

/** Topo das telas internas: botão voltar + título. */
export function cabecalho(titulo: string): string {
  return `
    <header class="linha cabecalho-tela">
      <button type="button" class="redondo" aria-label="Voltar" data-acao="voltar">${SETA_VOLTAR}</button>
      <span class="titulo-tela">${titulo}</span>
    </header>`;
}

/** Recado curto que aparece no lugar de um texto e depois volta. */
export function recadoTemporario(alvo: HTMLElement, texto: string, ms = 3000): void {
  const original = alvo.dataset.original ?? alvo.textContent ?? "";
  alvo.dataset.original = original;
  alvo.textContent = texto;
  alvo.classList.add("destaque");
  window.clearTimeout(Number(alvo.dataset.relogio ?? 0));
  alvo.dataset.relogio = String(
    window.setTimeout(() => {
      alvo.textContent = original;
      alvo.classList.remove("destaque");
    }, ms),
  );
}
