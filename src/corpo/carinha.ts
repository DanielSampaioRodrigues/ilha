// A carinha do robô: olhos de pixel ciano com bochechas rosadas.
// A tela tem 19 × 10 "pixels"; cada olho ocupa 7 × 7 (colunas 0–6 e 12–18),
// a boca e as bochechas ficam nas duas linhas de baixo.

export type Expressao = "normal" | "ouvindo" | "foco" | "feliz" | "alerta";

const CIANO = "#3FE6EE";
const ROSA = "#FF8FB4";
const LARANJA = "#FFA51F";

type Olho = readonly string[];

const OLHOS: Record<string, Olho> = {
  normal: ["..xxx..", ".x...x.", "x..xx.x", "x.xxx.x", "x.xxx.x", ".x...x.", "..xxx.."],
  esquerda: ["..xxx..", ".x...x.", "x.xx..x", "xxxx..x", "xxxx..x", ".x...x.", "..xxx.."],
  direita: ["..xxx..", ".x...x.", "x...xxx", "x..xxxx", "x..xxxx", ".x...x.", "..xxx.."],
  piscando: [".......", ".......", ".......", ".xxxxx.", ".......", ".......", "......."],
  ouvindo: ["..xxx..", ".x.xx.x", "x.xxx.x", "x.xxx.x", "x.....x", ".x...x.", "..xxx.."],
  foco: [".......", ".......", "xxxxxxx", "x..xxxx", "x..xxxx", "xxxxxxx", "......."],
  feliz: [".......", ".......", "..xxx..", ".x...x.", "x.....x", ".......", "......."],
  alerta: ["..xxx..", ".x...x.", "x.....x", "x..x..x", "x.....x", ".x...x.", "..xxx.."],
};

// Boca: colunas acesas na linha 8 e na linha 9.
const BOCAS = {
  sorriso: [[6, 12], [7, 8, 9, 10, 11]],
  aberta: [[8, 9, 10], [8, 9, 10]],
  reta: [[], [8, 9, 10]],
  susto: [[8, 9, 10], [7, 11]],
} as const;

interface Desenho {
  olho: Olho;
  boca: keyof typeof BOCAS;
  bochechas: boolean;
  cor: string;
}

const EXPRESSOES: Record<Expressao, Omit<Desenho, "olho"> & { olho: keyof typeof OLHOS }> = {
  normal: { olho: "normal", boca: "sorriso", bochechas: true, cor: CIANO },
  ouvindo: { olho: "ouvindo", boca: "aberta", bochechas: true, cor: CIANO },
  foco: { olho: "foco", boca: "reta", bochechas: true, cor: CIANO },
  feliz: { olho: "feliz", boca: "sorriso", bochechas: true, cor: CIANO },
  alerta: { olho: "alerta", boca: "susto", bochechas: false, cor: LARANJA },
};

const SVG = "http://www.w3.org/2000/svg";

function desenhar(svg: SVGSVGElement, d: Desenho): void {
  const pixels: string[] = [];
  const acender = (x: number, y: number, cor: string) =>
    pixels.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${cor}"/>`);

  d.olho.forEach((linha, y) => {
    [...linha].forEach((c, x) => {
      if (c === "x") {
        acender(x, y, d.cor);
        acender(x + 12, y, d.cor);
      }
    });
  });
  const [linha8, linha9] = BOCAS[d.boca];
  linha8.forEach((x) => acender(x, 8, d.cor));
  linha9.forEach((x) => acender(x, 9, d.cor));
  if (d.bochechas) [0, 1, 17, 18].forEach((x) => acender(x, 8, ROSA));

  svg.innerHTML = pixels.join("");
  svg.style.setProperty("--brilho", d.cor);
}

export interface Carinha {
  elemento: SVGSVGElement;
}

/**
 * Cria a carinha. Na expressão normal ela pisca e olha para os lados de vez
 * em quando; as animações param sozinhas quando a carinha sai da tela.
 */
export function criarCarinha(expressao: Expressao, tamanhoPixel = 2): Carinha {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 19 10");
  svg.setAttribute("width", String(19 * tamanhoPixel));
  svg.setAttribute("height", String(10 * tamanhoPixel));
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("carinha");

  const base = EXPRESSOES[expressao];
  const comOlho = (olho: keyof typeof OLHOS): Desenho => ({ ...base, olho: OLHOS[olho] });
  desenhar(svg, comOlho(base.olho));

  if (expressao === "normal" || expressao === "ouvindo") {
    const aleatorio = (min: number, max: number) => min + Math.random() * (max - min);
    const agendar = () => {
      window.setTimeout(() => {
        if (!svg.isConnected) return;
        const olharDeLado = expressao === "normal" && Math.random() < 0.3;
        if (olharDeLado) {
          desenhar(svg, comOlho(Math.random() < 0.5 ? "esquerda" : "direita"));
          window.setTimeout(() => desenhar(svg, comOlho(base.olho)), aleatorio(900, 1600));
        } else {
          desenhar(svg, comOlho("piscando"));
          window.setTimeout(() => desenhar(svg, comOlho(base.olho)), 130);
        }
        agendar();
      }, aleatorio(2500, 6000));
    };
    agendar();
  }

  return { elemento: svg };
}
