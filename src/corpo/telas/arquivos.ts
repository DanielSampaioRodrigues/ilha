// Arquivos soltos na ilha: "bolhas" com o que dá para fazer com eles.
// Arrastando um arquivo por cima, a ilha se abre e as bolhas aparecem; é só
// soltar o arquivo dentro de uma delas (ou clicar, depois de soltar fora).
// Imagens: diminuir, PDF, JPG, PNG. Documentos (PDF, Word…): fichamento,
// resumo, tópicos, perguntas de prova, explicar fácil e traduzir com a IA.
// Tudo é gravado ao lado do original, com nome novo (nada é apagado).
import { invoke } from "@tauri-apps/api/core";
import type { Contexto } from "../contexto";
import { ICONES } from "../icones";
import { cabecalho, escapar, html } from "../ui";
import { abrirCentral } from "../../maos/sistema";
import { dentroDoApp } from "../../ponte";

/** Os arquivos que chegaram por último (a tela copia daqui ao abrir). */
let soltos: string[] = [];
/** Algo está sendo feito (diminuir, PDF, renomear): não troca os arquivos nem a tela no meio. */
let ocupada = false;
export const arquivosOcupados = () => ocupada;
/** Guarda os arquivos novos; devolve se mudaram (aí a tela precisa ser montada de novo). */
export function receberArquivos(caminhos: string[]): boolean {
  if (ocupada) return false;
  const mudou = caminhos.length !== soltos.length || caminhos.some((c, i) => c !== soltos[i]);
  soltos = caminhos;
  return mudou;
}

const IMAGEM = /\.(jpe?g|png|webp|bmp|gif)$/i;
const DOCUMENTO = /\.(pdf|docx|odt|rtf|txt|md)$/i;
const nome = (c: string) => c.split(/[\\/]/).pop() ?? c;
const pasta = (c: string) => c.replace(/[\\/][^\\/]*$/, "");
const extensao = (c: string) => (c.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toUpperCase();

const svg = (corpo: string) =>
  `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${corpo}</svg>`;

/** Ícones das bolhas. */
const DESENHOS = {
  diminuir: svg('<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>'),
  pdf: svg('<path d="M8 3h7l4 4v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M15 3v4h4"/><path d="M3 8v11a3 3 0 0 0 3 3"/>'),
  jpg: svg('<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>'),
  png: svg('<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m3 15 5-5 4 4M14 12l2-2 5 5"/><circle cx="16.5" cy="7.5" r="1"/>'),
  renomear: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/><path d="M14 20h6"/>'),
  conversa: svg('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z"/>'),
  fichamento: svg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7 9h10M7 12.5h10M7 16h6"/>'),
  resumo: svg('<path d="M4 6h16M4 11h12M4 16h8"/><path d="m17 15 2 2 3-4"/>'),
  topicos: svg('<circle cx="5" cy="6" r="1.3"/><circle cx="5" cy="12" r="1.3"/><circle cx="5" cy="18" r="1.3"/><path d="M9.5 6H20M9.5 12H20M9.5 18H20"/>'),
  perguntas: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14"/><path d="M12 17.3v.2"/>'),
  explicar: svg('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z"/>'),
  traduzir: svg('<path d="M4 5h8M8 3v2c0 4-2 7-5 9"/><path d="M6 9c1 2 3 4 6 5"/><path d="m13 21 4-10 4 10M14.5 17.5h5"/>'),
} as const;

type Acao = keyof typeof DESENHOS;

/** O que pedir à IA para cada documento (em português, começando com um título). */
const PEDIDOS: Partial<Record<Acao, (lista: string) => string>> = {
  fichamento: (l) =>
    `Faça um fichamento acadêmico ${l}, no padrão usado nas faculdades brasileiras. Comece com um título "# Fichamento – (título do texto)". Depois: 1) **Referência** no formato da ABNT (com o que der para saber do arquivo); 2) **Ideia central**; 3) **Principais argumentos e conceitos**, em tópicos; 4) **Citações importantes**, entre aspas e com a página quando houver; 5) **Comentário crítico** breve. Não invente nada que não esteja no texto.`,
  resumo: (l) =>
    `Faça um resumo claro e fiel ${l}, em português, em poucos parágrafos, sem inventar nada que não esteja no texto. Comece com um título "# Resumo – (título do texto)".`,
  topicos: (l) =>
    `Transforme ${l.replace(/^d/, "")} em tópicos organizados para estudar rápido: títulos com "##" para cada parte e, dentro, tópicos curtos com "-". Comece com "# Tópicos – (título do texto)". Em português.`,
  perguntas: (l) =>
    `Crie 10 perguntas de prova sobre o conteúdo ${l}, misturando perguntas diretas e de reflexão, cada uma com a resposta logo abaixo. Comece com "# Perguntas de prova – (título do texto)". Em português.`,
  explicar: (l) =>
    `Explique o conteúdo ${l} em linguagem bem simples, como para alguém que nunca estudou o assunto, com exemplos do dia a dia. Comece com "# Explicando – (título do texto)". Em português.`,
  traduzir: (l) =>
    `Traduza o conteúdo ${l} para o português do Brasil, mantendo a organização (títulos, listas e parágrafos). Comece com "# Tradução – (título do texto)".`,
};

interface Bolha {
  acao: Acao;
  nome: string;
  dica: string;
  grupo: string;
}

/** As bolhas que fazem sentido para estes arquivos. */
function bolhasPara(caminhos: string[]): Bolha[] {
  const imagens = caminhos.filter((c) => IMAGEM.test(c)).length;
  const documentos = caminhos.filter((c) => DOCUMENTO.test(c)).length;
  const lista: Bolha[] = [];
  if (documentos) {
    const g = "Estudar com a IA";
    lista.push(
      { acao: "fichamento", nome: "Fichamento", dica: "referência ABNT, ideias e citações", grupo: g },
      { acao: "resumo", nome: "Resumo", dica: "o essencial em poucos parágrafos", grupo: g },
      { acao: "topicos", nome: "Tópicos", dica: "para estudar rápido", grupo: g },
      { acao: "perguntas", nome: "Perguntas", dica: "10 perguntas de prova com resposta", grupo: g },
      { acao: "explicar", nome: "Explicar fácil", dica: "em linguagem simples", grupo: g },
      { acao: "traduzir", nome: "Traduzir", dica: "para o português", grupo: g },
    );
  }
  if (imagens) {
    const g = imagens > 1 ? "Imagens" : "Imagem";
    lista.push(
      { acao: "diminuir", nome: "Diminuir", dica: "até 1920 px, JPG leve", grupo: g },
      { acao: "pdf", nome: imagens > 1 ? "Juntar PDF" : "Virar PDF", dica: "uma imagem por página", grupo: g },
      { acao: "jpg", nome: "Para JPG", dica: "mais leve", grupo: g },
      { acao: "png", nome: "Para PNG", dica: "sem perder qualidade", grupo: g },
    );
  }
  // Renomear e Conversar entram na última fileira (sem um grupo só para eles).
  const g = lista.at(-1)?.grupo ?? "Mais";
  if (caminhos.length > 1) lista.push({ acao: "renomear", nome: "Renomear", dica: "“Viagem 01”, “Viagem 02”…", grupo: g });
  lista.push({ acao: "conversa", nome: "Conversar", dica: "abre a conversa com a IA", grupo: g });
  return lista;
}

/** A tela montada agora (as funções de arrastar falam com ela). */
let telaAtual: { raiz: HTMLElement; fazer: (acao: Acao, de?: { x: number; y: number }) => void } | null = null;

/** O arquivo está sendo arrastado por cima de (x, y): acende a bolha embaixo dele. */
export function arrastarSobre(x: number | null, y = 0): void {
  if (!telaAtual?.raiz.isConnected) return;
  const alvo = x === null ? null : bolhaEm(x, y);
  telaAtual.raiz.querySelectorAll(".portal").forEach((p) => p.classList.toggle("alvo", p === alvo));
  telaAtual.raiz.classList.toggle("mirando", !!alvo);
}

/** Soltou em (x, y): se foi numa bolha, já faz. Devolve se fez alguma coisa. */
export function soltarEm(x: number, y: number): boolean {
  if (!telaAtual?.raiz.isConnected) return false;
  const alvo = bolhaEm(x, y);
  arrastarSobre(null);
  if (!alvo) return false;
  telaAtual.fazer(alvo.dataset.portal as Acao, { x, y });
  return true;
}

function bolhaEm(x: number, y: number): HTMLElement | null {
  return document.elementFromPoint(x, y)?.closest<HTMLElement>(".portal:not(:disabled)") ?? null;
}

/** Um "arquivinho" voa de onde foi solto até dentro da bolha. */
function voarPara(bolha: HTMLElement, de: { x: number; y: number }): void {
  const destino = bolha.querySelector(".bolha-portal")!.getBoundingClientRect();
  const voador = document.createElement("span");
  voador.className = "voador";
  voador.innerHTML = ICONES.arquivo;
  voador.style.left = `${de.x - 14}px`;
  voador.style.top = `${de.y - 14}px`;
  document.body.append(voador);
  const dx = destino.left + destino.width / 2 - de.x;
  const dy = destino.top + destino.height / 2 - de.y;
  voador
    .animate(
      [
        { transform: "translate(0, 0) scale(1) rotate(0)", opacity: 1 },
        { transform: `translate(${dx * 0.6}px, ${dy * 0.6 - 30}px) scale(0.9) rotate(-160deg)`, opacity: 1, offset: 0.6 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.1) rotate(-320deg)`, opacity: 0 },
      ],
      { duration: 520, easing: "cubic-bezier(.5,0,.6,1)" },
    )
    .finished.finally(() => voador.remove());
}

export function montarArquivos(ctx: Contexto): HTMLElement {
  // Cópia só desta tela: um arraste novo (ou cancelado) não muda o que ela vai usar.
  let meus = [...soltos];
  const imagens = () => meus.filter((c) => IMAGEM.test(c));
  const documentos = () => meus.filter((c) => DOCUMENTO.test(c));
  const bolhas = bolhasPara(meus);
  const grupos = [...new Set(bolhas.map((b) => b.grupo))];
  const arrastando = document.body.classList.contains("soltando");
  let indice = 0;
  const raiz = html(`
    <div class="estado aberta tela tela-soltar">
      ${cabecalho(meus.length === 1 ? "1 arquivo" : `${meus.length} arquivos`)}
      <div class="chips-soltos">
        ${meus
          .slice(0, 4)
          .map((c) => `<span class="chip-solto" title="${escapar(c)}"><b>${escapar(extensao(c) || "ARQ")}</b>${escapar(nome(c))}</span>`)
          .join("")}
        ${meus.length > 4 ? `<span class="chip-solto mais">+${meus.length - 4}</span>` : ""}
      </div>
      <p class="dica-soltar">${arrastando ? "Solte dentro de uma bolha" : "O que eu faço com isso?"}</p>
      ${grupos
        .map(
          (g) => `
        <div class="grupo-portais">
          <span class="nome-grupo">${g}</span>
          <div class="portais">
            ${bolhas
              .filter((b) => b.grupo === g)
              .map(
                (b) => `
              <button type="button" class="portal" data-portal="${b.acao}" style="--i:${indice++}" title="${escapar(b.dica)}">
                <span class="bolha-portal">${DESENHOS[b.acao]}</span>
                <span class="nome-portal">${b.nome}</span>
              </button>`,
              )
              .join("")}
          </div>
        </div>`,
        )
        .join("")}
      <form class="linha renomear-form" hidden>
        <input class="entrada" name="base" maxlength="60" placeholder="Nome (ex.: Viagem Recife)" aria-label="Nome base">
        <button type="submit" class="botao ciano">Renomear</button>
      </form>
      <p class="secundario resultado-arquivos" aria-live="polite"></p>
      <div class="linha fim"><button type="button" class="botao" data-acao="abrir-pasta-resultado" hidden>Abrir a pasta</button></div>
    </div>`);
  // Cada grupo com sua faixa de cores (vizinhas da cor de destaque).
  raiz.querySelectorAll<HTMLElement>(".portal").forEach((p, i) => p.style.setProperty("--giro", String((i * 360) / Math.max(6, bolhas.length))));

  const resultado = raiz.querySelector<HTMLElement>(".resultado-arquivos")!;
  const abrirPastaBotao = raiz.querySelector<HTMLButtonElement>('[data-acao="abrir-pasta-resultado"]')!;
  const portais = [...raiz.querySelectorAll<HTMLButtonElement>(".portal")];
  let ultimaPasta = "";

  const trabalhar = async (bolha: HTMLElement, rotulo: string, acao: () => Promise<string[]>) => {
    ocupada = true;
    portais.forEach((b) => (b.disabled = true));
    bolha.classList.add("trabalhando");
    resultado.textContent = `${rotulo}…`;
    try {
      const feitos = await acao();
      ultimaPasta = feitos[0] ? pasta(feitos[0]) : "";
      resultado.textContent = feitos.length === 1 ? `Pronto: ${nome(feitos[0])}` : `Pronto: ${feitos.length} arquivos.`;
      abrirPastaBotao.hidden = !ultimaPasta;
      bolha.classList.add("feito");
    } catch (e) {
      resultado.textContent = String(e);
    } finally {
      ocupada = false;
      bolha.classList.remove("trabalhando");
      portais.forEach((b) => (b.disabled = false));
    }
  };
  const chamar = <T,>(comando: string, args: Record<string, unknown>) =>
    dentroDoApp ? invoke<T>(comando, args) : Promise.reject("Só funciona no app.");

  const fazer = (acao: Acao, de?: { x: number; y: number }) => {
    const bolha = raiz.querySelector<HTMLElement>(`[data-portal="${acao}"]`);
    if (!bolha) return;
    // A bolha "engole" o arquivo.
    bolha.classList.remove("engolindo");
    void bolha.offsetWidth;
    bolha.classList.add("engolindo");
    if (de) voarPara(bolha, de);
    const pedido = PEDIDOS[acao];
    if (pedido) {
      const docs = documentos();
      const lista = docs.length > 1 ? "destes documentos" : "deste documento";
      abrirCentral("conversa", docs, undefined, pedido(lista)).catch(() => {});
      resultado.textContent = "Abri na Central: a IA já está fazendo. Lá dá para salvar em Word.";
      window.setTimeout(() => raiz.isConnected && ctx.fechar(), 1600);
      return;
    }
    if (acao === "diminuir") void trabalhar(bolha, "Diminuindo", () => chamar<string[]>("diminuir_imagens", { caminhos: imagens() }));
    else if (acao === "pdf") void trabalhar(bolha, "Montando o PDF", async () => [await chamar<string>("imagens_para_pdf", { caminhos: imagens() })]);
    else if (acao === "jpg" || acao === "png")
      void trabalhar(bolha, "Convertendo", () => chamar<string[]>("converter_imagens", { caminhos: imagens(), formato: acao }));
    else if (acao === "renomear") {
      form.hidden = false;
      form.querySelector("input")?.focus();
    } else if (acao === "conversa") {
      abrirCentral("conversa-atual", meus).catch(() => {});
      ctx.fechar();
    }
  };
  telaAtual = { raiz, fazer };

  raiz.querySelector('[data-acao="voltar"]')?.addEventListener("click", () => ctx.irPara("inicio"));
  for (const p of portais) p.addEventListener("click", () => fazer(p.dataset.portal as Acao));
  const form = raiz.querySelector<HTMLFormElement>(".renomear-form")!;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const base = String(new FormData(form).get("base") ?? "").trim();
    if (!base) return;
    const bolha = raiz.querySelector<HTMLElement>('[data-portal="renomear"]')!;
    void trabalhar(bolha, "Renomeando", async () => {
      const novos = await chamar<string[]>("renomear_em_sequencia", { caminhos: meus, base });
      // Daqui para frente, as outras bolhas usam os nomes novos.
      meus = novos;
      soltos = novos;
      return novos;
    });
  });
  abrirPastaBotao.addEventListener("click", () => {
    if (ultimaPasta) invoke("abrir_pasta", { caminho: ultimaPasta }).catch(() => {});
  });
  return raiz;
}
