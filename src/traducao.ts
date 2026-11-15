// Janela da tradução da tela: o print congelado e, por cima de cada linha,
// o texto traduzido no mesmo lugar. Esc fecha. Dá para traduzir só um trecho
// (arrastando um retângulo), ver o original e copiar a tradução.
import { capturaAtual, copiar, fecharTraducao, traduzirLinhas, type Captura } from "./maos/sistema";
import { escapar } from "./corpo/ui";

const EXEMPLO: Captura = {
  imagem: "",
  largura: 1440,
  altura: 900,
  linhas: [
    { texto: "Welcome back! Your subscription renews on December 3.", x: 120, y: 160, largura: 620, altura: 30 },
    { texto: "Manage billing", x: 120, y: 214, largura: 170, altura: 24 },
    { texto: "Usage limits reset every Tuesday at 6:32 PM.", x: 120, y: 260, largura: 520, altura: 24 },
  ],
};

export async function iniciarTraducao(): Promise<void> {
  document.body.classList.add("modo-traducao");
  const palco = document.getElementById("palco")!;
  const fechar = () => fecharTraducao().catch(() => window.close());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") fechar();
  });

  const doNavegador = !("__TAURI_INTERNALS__" in window);
  const c = (await capturaAtual().catch(() => null)) ?? (doNavegador ? EXEMPLO : null);
  if (!c) {
    fechar();
    return;
  }

  palco.innerHTML = `
    ${c.imagem ? `<img class="print" src="${c.imagem}" alt="">` : '<div class="print vazio-print"></div>'}
    <div class="caixas"></div>
    <div class="selecao" hidden></div>
    <div class="barra-traducao">
      <span class="estado-traducao">Traduzindo ${c.linhas.length} linhas…</span>
      <button type="button" class="botao" data-acao="trecho">Só um trecho</button>
      <button type="button" class="botao" data-acao="original">Ver original</button>
      <button type="button" class="botao ciano" data-acao="copiar">Copiar tradução</button>
      <button type="button" class="botao" data-acao="fechar">Fechar (Esc)</button>
    </div>`;

  const estado = palco.querySelector<HTMLElement>(".estado-traducao")!;
  const caixas = palco.querySelector<HTMLElement>(".caixas")!;
  const botao = (acao: string) => palco.querySelector<HTMLButtonElement>(`[data-acao="${acao}"]`)!;
  botao("fechar").addEventListener("click", fechar);

  if (!c.linhas.length) {
    estado.textContent = "Não encontrei texto nesta tela.";
    return;
  }

  // Imagem em pixels físicos; a janela em pixels da tela do Windows.
  const escala = window.innerWidth / c.largura;
  let traducoes: string[] = [];
  let visiveis = c.linhas.map(() => true);

  const desenhar = () => {
    caixas.innerHTML = c.linhas
      .map((l, i) =>
        visiveis[i] && traducoes[i]
          ? `<div class="caixa" title="${escapar(l.texto)}" style="left:${l.x * escala}px;top:${l.y * escala}px;min-width:${l.largura * escala}px;height:${l.altura * escala}px;font-size:${Math.max(10, l.altura * escala * 0.78)}px">${escapar(traducoes[i])}</div>`
          : "",
      )
      .join("");
    // Encolhe a letra quando a tradução fica maior que a linha original.
    caixas.querySelectorAll<HTMLElement>(".caixa").forEach((caixa) => {
      const limite = parseFloat(caixa.style.minWidth) * 1.25;
      let tamanho = parseFloat(caixa.style.fontSize);
      while (caixa.scrollWidth > limite && tamanho > 9) {
        tamanho -= 1;
        caixa.style.fontSize = `${tamanho}px`;
      }
    });
  };

  try {
    traducoes = await traduzirLinhas(c.linhas.map((l) => l.texto));
    estado.textContent = "Pronto. Passe o mouse num texto para ver o original.";
    desenhar();
  } catch (erro) {
    estado.textContent = String(erro);
    estado.classList.add("erro");
    return;
  }

  // Ver original: esconde/mostra as traduções.
  botao("original").addEventListener("click", () => {
    const escondido = caixas.hidden;
    caixas.hidden = !escondido;
    botao("original").textContent = escondido ? "Ver original" : "Ver tradução";
  });

  botao("copiar").addEventListener("click", () => {
    const texto = traducoes.filter((_, i) => visiveis[i]).join("\n");
    copiar(texto)
      .then(() => (estado.textContent = "Tradução copiada."))
      .catch(() => (estado.textContent = "Não consegui copiar."));
  });

  // Só um trecho: arrastar um retângulo; ficam só as linhas dentro dele.
  const selecao = palco.querySelector<HTMLElement>(".selecao")!;
  let escolhendo = false;
  let inicio: { x: number; y: number } | null = null;
  botao("trecho").addEventListener("click", () => {
    escolhendo = true;
    document.body.classList.add("escolhendo");
    estado.textContent = "Arraste um retângulo em volta do trecho.";
  });
  palco.addEventListener("mousedown", (e) => {
    if (!escolhendo || (e.target as HTMLElement).closest(".barra-traducao")) return;
    inicio = { x: e.clientX, y: e.clientY };
    selecao.hidden = false;
  });
  palco.addEventListener("mousemove", (e) => {
    if (!inicio) return;
    const x = Math.min(inicio.x, e.clientX);
    const y = Math.min(inicio.y, e.clientY);
    Object.assign(selecao.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${Math.abs(e.clientX - inicio.x)}px`,
      height: `${Math.abs(e.clientY - inicio.y)}px`,
    });
  });
  palco.addEventListener("mouseup", (e) => {
    if (!inicio) return;
    const [x0, x1] = [Math.min(inicio.x, e.clientX), Math.max(inicio.x, e.clientX)].map((v) => v / escala);
    const [y0, y1] = [Math.min(inicio.y, e.clientY), Math.max(inicio.y, e.clientY)].map((v) => v / escala);
    inicio = null;
    escolhendo = false;
    selecao.hidden = true;
    document.body.classList.remove("escolhendo");
    visiveis = c.linhas.map((l) => l.x < x1 && l.x + l.largura > x0 && l.y < y1 && l.y + l.altura > y0);
    const quantas = visiveis.filter(Boolean).length;
    estado.textContent = quantas ? `${quantas} linhas no trecho.` : "Nenhum texto no trecho. Tente de novo.";
    if (!quantas) visiveis = c.linhas.map(() => true);
    desenhar();
  });
}
