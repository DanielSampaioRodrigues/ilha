// A carinha do robô: olhos de pixel com bochechas, numa tela de 19 × 10
// "pixels". Cada olho ocupa 7 × 7 (colunas 0–6 e 12–18); a boca e as bochechas
// ficam nas linhas 8 e 9. Acessórios (chapéu, fones…) ficam em volta, numa
// área maior (de -3 a 21 na horizontal e de -4 a 9 na vertical).
//
// A aparência (cor dos olhos, bochechas, acessório) vem dos Ajustes do
// personagem; os olhos podem seguir o mouse e piscam/olham para os lados.

import { ler } from "../dados/armazem";

export type Expressao =
  | "normal"
  | "ouvindo"
  | "foco"
  | "feliz"
  | "alerta"
  | "pensando"
  | "dormindo"
  | "surpreso"
  | "triste"
  | "apaixonado"
  | "piscadinha"
  | "rindo"
  | "confuso";

export const NOMES_EXPRESSOES: Record<Expressao, string> = {
  normal: "Repouso",
  ouvindo: "Ouvindo",
  foco: "Foco",
  feliz: "Feliz",
  alerta: "Alerta",
  pensando: "Pensando",
  dormindo: "Dormindo",
  surpreso: "Surpreso",
  triste: "Triste",
  apaixonado: "Apaixonado",
  piscadinha: "Piscadinha",
  rindo: "Rindo",
  confuso: "Confuso",
};

export type Acessorio = "nenhum" | "chapeu" | "coroa" | "laco" | "oculos" | "fones" | "antena";

export const NOMES_ACESSORIOS: Record<Acessorio, string> = {
  nenhum: "Nenhum",
  chapeu: "Chapéu de festa",
  coroa: "Coroa",
  laco: "Laço",
  oculos: "Óculos",
  fones: "Fones",
  antena: "Antena",
};

type Ponto = [number, number];
type Olho = Ponto[];

const LARANJA = "#FFA51F";
const ROSA_FORTE = "#FF5A8A";

// ---------- Olhos ----------

const CONTORNO: Ponto[] = [
  [2, 0], [3, 0], [4, 0], [1, 1], [5, 1], [0, 2], [6, 2], [0, 3], [6, 3],
  [0, 4], [6, 4], [1, 5], [5, 5], [2, 6], [3, 6], [4, 6],
];

/** Olho redondo com a pupila 3×3 (com um brilho) deslocada para onde olha. */
function olhoAberto(dx = 0, dy = 0): Olho {
  const pupila: Ponto[] = [];
  for (let y = 2; y <= 4; y++) {
    for (let x = 2; x <= 4; x++) {
      if (x === 2 && y === 2) continue; // brilho
      const px = Math.min(5, Math.max(1, x + dx));
      const py = Math.min(5, Math.max(1, y + dy));
      pupila.push([px, py]);
    }
  }
  return [...CONTORNO, ...pupila];
}

function deTexto(linhas: string[]): Olho {
  const pontos: Ponto[] = [];
  linhas.forEach((linha, y) => [...linha].forEach((c, x) => c === "x" && pontos.push([x, y])));
  return pontos;
}

const FECHADO: Olho = deTexto([".......", ".......", ".......", ".......", "x.....x", ".xxxxx.", "......."]);
const PISCANDO: Olho = deTexto([".......", ".......", ".......", ".xxxxx.", ".......", ".......", "......."]);
const FOCO: Olho = deTexto([".......", ".......", "xxxxxxx", "x..xxxx", "x..xxxx", "xxxxxxx", "......."]);
const FELIZ: Olho = deTexto([".......", ".......", "..xxx..", ".x...x.", "x.....x", ".......", "......."]);
const ARREGALADO: Olho = [...CONTORNO, [3, 3]];
const CORACAO: Olho = deTexto([".......", ".xx.xx.", "xxxxxxx", "xxxxxxx", ".xxxxx.", "..xxx..", "...x..."]);

// ---------- Bocas (colunas acesas nas linhas 8 e 9) ----------

const BOCAS = {
  sorriso: [[6, 12], [7, 8, 9, 10, 11]],
  aberta: [[8, 9, 10], [8, 9, 10]],
  reta: [[], [8, 9, 10]],
  pequena: [[], [9, 10]],
  susto: [[8, 9, 10], [7, 11]],
  triste: [[7, 8, 9, 10, 11], [6, 12]],
  grande: [[6, 7, 8, 9, 10, 11, 12], [7, 8, 9, 10, 11]],
  zigue: [[7, 9, 11], [8, 10]],
} as const;

interface Desenho {
  esquerdo: Olho;
  direito: Olho;
  boca: keyof typeof BOCAS;
  bochechas: boolean;
  /** Cor própria desta expressão (senão, a cor dos olhos escolhida). */
  cor?: string;
}

function desenho(expressao: Expressao, olhar: Ponto): Desenho {
  const [dx, dy] = olhar;
  switch (expressao) {
    case "ouvindo":
      return { esquerdo: olhoAberto(dx, -1), direito: olhoAberto(dx, -1), boca: "aberta", bochechas: true };
    case "foco":
      return { esquerdo: FOCO, direito: FOCO, boca: "reta", bochechas: true };
    case "feliz":
      return { esquerdo: FELIZ, direito: FELIZ, boca: "sorriso", bochechas: true };
    case "alerta":
      return { esquerdo: ARREGALADO, direito: ARREGALADO, boca: "susto", bochechas: false, cor: LARANJA };
    case "pensando":
      return { esquerdo: olhoAberto(1, -1), direito: olhoAberto(1, -1), boca: "pequena", bochechas: true };
    case "dormindo":
      return { esquerdo: FECHADO, direito: FECHADO, boca: "reta", bochechas: true };
    case "surpreso":
      return { esquerdo: ARREGALADO, direito: ARREGALADO, boca: "aberta", bochechas: true };
    case "triste":
      return { esquerdo: olhoAberto(0, 1), direito: olhoAberto(0, 1), boca: "triste", bochechas: false };
    case "apaixonado":
      return { esquerdo: CORACAO, direito: CORACAO, boca: "sorriso", bochechas: true, cor: ROSA_FORTE };
    case "piscadinha":
      return { esquerdo: olhoAberto(dx, dy), direito: FECHADO, boca: "sorriso", bochechas: true };
    case "rindo":
      return { esquerdo: FELIZ, direito: FELIZ, boca: "grande", bochechas: true };
    case "confuso":
      return { esquerdo: olhoAberto(0, 0), direito: olhoAberto(1, -1), boca: "zigue", bochechas: false };
    default:
      return { esquerdo: olhoAberto(dx, dy), direito: olhoAberto(dx, dy), boca: "sorriso", bochechas: true };
  }
}

// ---------- Acessórios: [x, y, cor] ----------

type Pixel = [number, number, string];

function linha(y: number, de: number, ate: number, cor: string): Pixel[] {
  return Array.from({ length: ate - de + 1 }, (_, i) => [de + i, y, cor] as Pixel);
}

const ACESSORIOS: Record<Exclude<Acessorio, "nenhum">, Pixel[]> = {
  chapeu: [
    [9, -4, "#F2F4F6"],
    ...linha(-3, 8, 10, "#E5484D"),
    ...linha(-2, 7, 11, "#FFD84D"),
    ...linha(-1, 6, 12, "#E5484D"),
  ],
  coroa: [
    [5, -3, "#FFD84D"], [9, -3, "#FFD84D"], [13, -3, "#FFD84D"],
    [5, -2, "#FFD84D"], [6, -2, "#FFD84D"], [8, -2, "#FFD84D"], [9, -2, "#FF4D4D"], [10, -2, "#FFD84D"], [12, -2, "#FFD84D"], [13, -2, "#FFD84D"],
    ...linha(-1, 5, 13, "#FFD84D"),
  ],
  laco: [
    [14, -3, ROSA_FORTE], [15, -3, ROSA_FORTE], [17, -3, ROSA_FORTE], [18, -3, ROSA_FORTE],
    [14, -2, ROSA_FORTE], [15, -2, ROSA_FORTE], [16, -2, "#B8124F"], [17, -2, ROSA_FORTE], [18, -2, ROSA_FORTE],
    [14, -1, ROSA_FORTE], [15, -1, ROSA_FORTE], [17, -1, ROSA_FORTE], [18, -1, ROSA_FORTE],
  ],
  oculos: [
    ...linha(-1, -1, 7, "#E9ECEF"),
    ...linha(-1, 11, 19, "#E9ECEF"),
    ...linha(2, 7, 11, "#E9ECEF"),
    [-1, 0, "#E9ECEF"], [-1, 1, "#E9ECEF"], [19, 0, "#E9ECEF"], [19, 1, "#E9ECEF"],
  ],
  fones: [
    ...linha(-3, 1, 17, "#9AA3AD"),
    [0, -2, "#9AA3AD"], [18, -2, "#9AA3AD"], [-1, -1, "#9AA3AD"], [19, -1, "#9AA3AD"], [-1, 0, "#9AA3AD"], [19, 0, "#9AA3AD"],
    ...[1, 2, 3, 4, 5].flatMap((y) => [[-3, y, "#5C8BFF"], [-2, y, "#5C8BFF"], [20, y, "#5C8BFF"], [21, y, "#5C8BFF"]] as Pixel[]),
  ],
  antena: [[9, -1, "#9AA3AD"], [9, -2, "#9AA3AD"], [9, -3, "#9AA3AD"], [8, -4, "#FF4D4D"], [9, -4, "#FF4D4D"], [10, -4, "#FF4D4D"]],
};

// ---------- A carinha ----------

const SVG = "http://www.w3.org/2000/svg";
const vivas = new Set<Carinha>();

export interface OpcoesCarinha {
  /** Tamanho de cada "pixel" em px. */
  tamanho?: number;
  /** Mostrar o acessório escolhido (só onde o personagem aparece "de corpo inteiro"). */
  comAcessorio?: boolean;
  /** Para a prévia nos Ajustes: aparência sem precisar salvar. */
  aparencia?: Partial<Aparencia>;
}

export interface Aparencia {
  corOlhos: string;
  corBochechas: string;
  acessorio: Acessorio;
}

function aparenciaSalva(): Aparencia {
  const c = ler().config;
  return { corOlhos: c.corOlhos, corBochechas: c.corBochechas, acessorio: c.acessorio };
}

export class Carinha {
  readonly elemento: SVGSVGElement;
  private expressao: Expressao;
  private olhar: Ponto = [0, 0];
  private relogio = 0;

  constructor(expressao: Expressao, private readonly opcoes: OpcoesCarinha = {}) {
    this.expressao = expressao;
    const { acessorio } = this.aparencia();
    const extra = opcoes.comAcessorio && acessorio !== "nenhum";
    const tamanho = opcoes.tamanho ?? 2;
    const [x, y, w, h] = extra ? [-3, -4, 25, 14] : [0, 0, 19, 10];
    this.elemento = document.createElementNS(SVG, "svg");
    this.elemento.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
    this.elemento.setAttribute("width", String(w * tamanho));
    this.elemento.setAttribute("height", String(h * tamanho));
    this.elemento.setAttribute("shape-rendering", "crispEdges");
    this.elemento.setAttribute("aria-hidden", "true");
    this.elemento.classList.add("carinha");
    this.desenhar();
    vivas.add(this);
    if (expressao === "normal" || expressao === "ouvindo") this.agendarPiscada();
  }

  private aparencia(): Aparencia {
    return { ...aparenciaSalva(), ...this.opcoes.aparencia };
  }

  /** Troca a expressão com uma piscada rápida no meio (fica mais suave). */
  mudar(expressao: Expressao): void {
    if (expressao === this.expressao) return;
    this.expressao = expressao;
    this.desenharOlhos(PISCANDO);
    window.setTimeout(() => this.desenhar(), 90);
  }

  /** Para onde olhar: -1, 0 ou 1 na horizontal e na vertical. */
  olharPara(dx: number, dy: number): void {
    const novo: Ponto = [Math.sign(dx), Math.sign(dy)];
    if (novo[0] === this.olhar[0] && novo[1] === this.olhar[1]) return;
    this.olhar = novo;
    this.desenhar();
  }

  private desenharOlhos(olho: Olho): void {
    const d = { ...desenho(this.expressao, this.olhar), esquerdo: olho, direito: olho };
    this.pintar(d);
  }

  private desenhar(): void {
    if (!this.elemento.isConnected && this.elemento.childNodes.length) {
      vivas.delete(this);
    }
    this.pintar(desenho(this.expressao, this.olhar));
  }

  private pintar(d: Desenho): void {
    const ap = this.aparencia();
    const cor = d.cor ?? ap.corOlhos;
    const pixels: string[] = [];
    const acender = (x: number, y: number, c: string) =>
      pixels.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`);
    d.esquerdo.forEach(([x, y]) => acender(x, y, cor));
    d.direito.forEach(([x, y]) => acender(x + 12, y, cor));
    const [l8, l9] = BOCAS[d.boca];
    l8.forEach((x) => acender(x, 8, cor));
    l9.forEach((x) => acender(x, 9, cor));
    if (d.bochechas && ap.corBochechas !== "nenhuma") [0, 1, 17, 18].forEach((x) => acender(x, 8, ap.corBochechas));
    if (this.opcoes.comAcessorio && ap.acessorio !== "nenhum") {
      ACESSORIOS[ap.acessorio].forEach(([x, y, c]) => acender(x, y, c));
    }
    this.elemento.innerHTML = pixels.join("");
    this.elemento.style.setProperty("--brilho", cor);
  }

  /** Pisca e, às vezes, olha para o lado (se não estiver seguindo o mouse). */
  private agendarPiscada(): void {
    const espera = 2500 + Math.random() * 3500;
    this.relogio = window.setTimeout(() => {
      if (!this.elemento.isConnected) {
        vivas.delete(this);
        return;
      }
      if (this.expressao === "normal" || this.expressao === "ouvindo") {
        const seguindo = ler().config.olhosSeguemMouse && (this.olhar[0] !== 0 || this.olhar[1] !== 0);
        if (!seguindo && this.expressao === "normal" && Math.random() < 0.25) {
          const lado: Ponto = [Math.random() < 0.5 ? -1 : 1, 0];
          const antes = this.olhar;
          this.olhar = lado;
          this.desenhar();
          window.setTimeout(() => {
            this.olhar = antes;
            this.desenhar();
          }, 900 + Math.random() * 700);
        } else {
          this.desenharOlhos(PISCANDO);
          window.setTimeout(() => this.desenhar(), 130);
        }
      }
      this.agendarPiscada();
    }, espera);
  }

  parar(): void {
    window.clearTimeout(this.relogio);
    vivas.delete(this);
  }
}

/** Avisa todas as carinhas na tela para onde o mouse está (olhos seguem o mouse). */
export function olharTodas(dx: number, dy: number): void {
  for (const c of [...vivas]) {
    if (!c.elemento.isConnected) {
      c.parar();
      continue;
    }
    c.olharPara(dx, dy);
  }
}

/** Atalho usado pelas telas: cria e devolve só o desenho. */
export function criarCarinha(expressao: Expressao, tamanhoPixel = 2, comAcessorio = false): Carinha {
  return new Carinha(expressao, { tamanho: tamanhoPixel, comAcessorio });
}
