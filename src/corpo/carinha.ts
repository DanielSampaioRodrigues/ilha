// A carinha do robô: olhos de pixel com bochechas, numa tela de 19 × 10
// "pixels". Cada olho ocupa 7 × 7 (colunas 0–6 e 12–18); a boca e as bochechas
// ficam nas linhas 8 e 9. Acessórios (chapéu, fones…) ficam em volta, numa
// área maior (de -3 a 21 na horizontal e de -4 a 9 na vertical).
//
// A aparência (cor dos olhos, bochechas, acessório) vem dos Ajustes do
// personagem; os olhos podem seguir o mouse e piscam/olham para os lados.

import { ler } from "../dados/armazem";
import { PERSONAGENS_VETOR, pintarVetor, type OlhoSemantico } from "./vetor";

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
  | "confuso"
  // Animadas: a ilha usa conforme o que o Dan está fazendo no computador.
  | "digitando"
  | "programando"
  | "desenhando"
  | "musica"
  | "lendo"
  | "chamada"
  | "assistindo"
  | "sonolento";

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
  digitando: "Digitando",
  programando: "Programando",
  desenhando: "Desenhando",
  musica: "Curtindo música",
  lendo: "Lendo",
  chamada: "Em chamada",
  assistindo: "Assistindo",
  sonolento: "Com sono",
};

/** Expressões que se mexem sozinhas (quadros de animação). */
export const ANIMADAS: Expressao[] = ["digitando", "programando", "desenhando", "musica", "lendo", "chamada", "assistindo", "sonolento"];

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
type Pixel = [number, number, string];

const LARANJA = "#FFA51F";
const ROSA_FORTE = "#FF5A8A";

// ---------- Olhos ----------

const CONTORNO: Ponto[] = [
  [2, 0], [3, 0], [4, 0], [1, 1], [5, 1], [0, 2], [6, 2], [0, 3], [6, 3],
  [0, 4], [6, 4], [1, 5], [5, 5], [2, 6], [3, 6], [4, 6],
];

export type EstiloOlhos = "redondos" | "grandes" | "pontinho" | "quadrados" | "ovais" | "tracinho";

export const NOMES_ESTILOS_OLHOS: Record<EstiloOlhos, string> = {
  redondos: "Redondos",
  grandes: "Grandões",
  pontinho: "Pontinho",
  quadrados: "Quadrados",
  ovais: "Ovais",
  tracinho: "Tracinho",
};

/** Estilo usado no desenho em andamento (cada carinha avisa antes de desenhar). */
let estiloOlhos: EstiloOlhos = "redondos";

const limitar = (v: number, de: number, ate: number) => Math.min(ate, Math.max(de, v));

/** Olho aberto no estilo escolhido, olhando para (dx, dy). */
function olhoAberto(dx = 0, dy = 0): Olho {
  switch (estiloOlhos) {
    case "grandes": {
      // Bolona cheia com um brilho que acompanha o olhar.
      const cheio = deTexto(["..xxx..", ".xxxxx.", "xxxxxxx", "xxxxxxx", "xxxxxxx", ".xxxxx.", "..xxx.."]);
      const bx = 2 + dx;
      const by = 2 + dy;
      return cheio.filter(([x, y]) => !((x === bx || x === bx + 1) && y === by) && !(x === bx && y === by + 1));
    }
    case "pontinho": {
      const cx = 3 + dx;
      const cy = 3 + dy;
      const p: Ponto[] = [];
      for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) p.push([x, y]);
      return p;
    }
    case "quadrados": {
      const borda: Ponto[] = [];
      for (let i = 1; i <= 5; i++) borda.push([i, 1], [i, 5], [1, i], [5, i]);
      const px = limitar(3 + dx, 2, 3);
      const py = limitar(3 + dy, 2, 3);
      return [...borda, [px, py], [px + 1, py], [px, py + 1], [px + 1, py + 1]];
    }
    case "ovais": {
      const contorno = deTexto(["..xxx..", ".x...x.", ".x...x.", ".x...x.", ".x...x.", ".x...x.", "..xxx.."]);
      const px = limitar(3 + dx, 2, 3);
      const py = limitar(2 + dy, 1, 3);
      return [...contorno, [px, py], [px + 1, py], [px, py + 1], [px + 1, py + 1], [px, py + 2], [px + 1, py + 2]];
    }
    case "tracinho": {
      const y = limitar(3 + dy, 2, 4);
      const p: Ponto[] = [];
      for (let x = 1 + dx; x <= 5 + dx; x++) p.push([x, y], [x, y + 1]);
      return p;
    }
    default:
      return olhoRedondo(dx, dy);
  }
}

/** Olho redondo com a pupila 3×3 (com um brilho) deslocada para onde olha. */
function olhoRedondo(dx = 0, dy = 0): Olho {
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
  nenhuma: [[], []],
} as const;

interface Desenho {
  esquerdo: Olho;
  direito: Olho;
  boca: keyof typeof BOCAS;
  bochechas: boolean;
  /** Cor própria desta expressão (senão, a cor dos olhos escolhida). */
  cor?: string;
  /** Pixels a mais (cor "" = a cor dos olhos). */
  extras?: Pixel[];
  /** Empurra o desenho todo (balançar). */
  deslocar?: Ponto;
  /** Acessório que esta animação usa (fones na chamada, óculos programando). */
  acessorio?: Exclude<Acessorio, "nenhum">;
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

// ---------- Animações (quadros) ----------

const TECLA = "#3A4048";
const LUVA = "#E9ECEF";
const MEIO_FECHADO: Olho = deTexto([".......", ".......", ".......", ".......", "xxxxxxx", ".......", "......."]);
const NOTA: Ponto[] = [[1, 0], [2, 0], [1, 1], [1, 2], [0, 3], [1, 3]];

/** Teclado na linha de baixo e as mãozinhas batendo (esquerda/direita). */
function teclando(mao: number, esquerda: boolean): Pixel[] {
  const teclas = Array.from({ length: 11 }, (_, i) => [4 + i, 9, TECLA] as Pixel);
  const outra = esquerda ? 12 : 6;
  return [...teclas, [mao, 8, LUVA], [mao, 9, ""], [outra, 7, LUVA]];
}

function quadros(expressao: Expressao): { quadros: Desenho[]; ms: number } | null {
  const base = (o: Partial<Desenho>): Desenho => ({
    esquerdo: olhoAberto(0, 0),
    direito: olhoAberto(0, 0),
    boca: "nenhuma",
    bochechas: true,
    ...o,
  });
  switch (expressao) {
    case "digitando":
    case "programando": {
      const olhos = { esquerdo: olhoAberto(0, 1), direito: olhoAberto(0, 1) };
      const acessorio = expressao === "programando" ? ("oculos" as const) : undefined;
      return {
        ms: 140,
        quadros: [
          [6, true],
          [12, false],
          [7, true],
          [11, false],
          [5, true],
          [13, false],
        ].map(([mao, esq]) => base({ ...olhos, acessorio, extras: teclando(mao as number, esq as boolean) })),
      };
    }
    case "desenhando":
      return {
        ms: 260,
        quadros: [5, 6, 7, 8, 9, 10, 11, 12, 13].map((x) =>
          base({
            esquerdo: olhoAberto(x < 8 ? -1 : x > 10 ? 1 : 0, 1),
            direito: olhoAberto(x < 8 ? -1 : x > 10 ? 1 : 0, 1),
            extras: [
              ...Array.from({ length: x - 4 }, (_, i) => [5 + i, 9, ""] as Pixel),
              [x + 1, 8, "#FFD84D"],
              [x + 2, 7, "#FFD84D"],
            ],
          }),
        ),
      };
    case "musica":
      return {
        ms: 380,
        quadros: [
          base({ esquerdo: FELIZ, direito: FELIZ, boca: "sorriso", deslocar: [-1, 0], extras: NOTA.map(([x, y]) => [x + 8, y + 2, ""] as Pixel) }),
          base({ esquerdo: FELIZ, direito: FELIZ, boca: "sorriso", deslocar: [1, 0], extras: NOTA.map(([x, y]) => [x + 9, y + 1, ""] as Pixel) }),
        ],
      };
    case "lendo":
      return {
        ms: 480,
        quadros: (
          [
            [-1, 0],
            [0, 0],
            [1, 0],
            [-1, 1],
            [0, 1],
            [1, 1],
          ] as Ponto[]
        ).map(([dx, dy]) => base({ esquerdo: olhoAberto(dx, dy), direito: olhoAberto(dx, dy), boca: "pequena" })),
      };
    case "chamada":
      return {
        ms: 200,
        quadros: (["aberta", "pequena", "aberta", "reta", "pequena", "reta", "reta"] as const).map((boca) =>
          base({ boca, acessorio: "fones" }),
        ),
      };
    case "assistindo":
      return {
        ms: 700,
        quadros: [
          base({ esquerdo: ARREGALADO, direito: ARREGALADO, boca: "pequena" }),
          base({ esquerdo: ARREGALADO, direito: ARREGALADO, boca: "pequena" }),
          base({ esquerdo: ARREGALADO, direito: ARREGALADO, boca: "pequena" }),
          base({ esquerdo: ARREGALADO, direito: ARREGALADO, boca: "aberta" }),
          base({ esquerdo: PISCANDO, direito: PISCANDO, boca: "pequena" }),
        ],
      };
    case "sonolento": {
      const sono = base({ esquerdo: MEIO_FECHADO, direito: MEIO_FECHADO, boca: "reta" });
      const bocejo = base({ esquerdo: FECHADO, direito: FECHADO, boca: "susto" });
      return { ms: 700, quadros: [sono, sono, sono, sono, sono, bocejo, bocejo, sono, sono, sono] };
    }
    default:
      return null;
  }
}

// ---------- Personagens ----------
// Cada personagem é a mesma carinha (olhos e boca das 21 expressões) com o
// que é dele em volta: orelhas, bigodes, antenas… Desenhos próprios da ilha.

export type PersonagemId =
  | "robo"
  | "gato"
  | "urso"
  | "sapo"
  | "alien"
  | "fantasma"
  | "coelho"
  | "gelatina"
  | "nuvem"
  | "pinguim"
  | "coruja"
  | "tv"
  | "olhao"
  | "diabinho"
  | "peludo"
  | "morcego"
  | "polvo"
  | "zumbi"
  | "dragao"
  | "bolha"
  | "punk"
  | "anime"
  | "gota"
  | "cubo"
  | "astronauta";

interface Personagem {
  nome: string;
  jeito: string;
  /** Corpo, orelhas, bigodes… (desenhados por baixo dos olhos). */
  pixels: Pixel[];
  /** Por cima de tudo (ex.: presas e dentes por cima da boca). */
  frente?: Pixel[];
  /** Monstrinho (para agrupar na tela de escolha). */
  monstro?: boolean;
  /** Desenhado em vetor (curvas, sombras), não em pixels. */
  vetor?: boolean;
  /** Bocas diferentes (ex.: o "w" do gato no lugar do sorriso). */
  bocas?: Partial<Record<keyof typeof BOCAS, readonly [readonly number[], readonly number[]]>>;
  /** Boca desenhada pelo próprio personagem (ex.: bico). */
  boca?: (boca: keyof typeof BOCAS) => Pixel[];
  /** Olhos de cor própria (ex.: escuros num corpo colorido). */
  corOlhos?: string;
  /** Um olho só, no meio. */
  umOlho?: boolean;
  bochechas?: boolean;
}

/** Retângulos cheios: [x de, x até, y] por linha. */
function corpo(linhas: [number, number, number][], cor: string): Pixel[] {
  return linhas.flatMap(([de, ate, y]) => Array.from({ length: ate - de + 1 }, (_, i) => [de + i, y, cor] as Pixel));
}

const linhasCheias = (de: number, ate: number, y0: number, y1: number): [number, number, number][] =>
  Array.from({ length: y1 - y0 + 1 }, (_, i) => [de, ate, y0 + i] as [number, number, number]);

/** Bico: fechado ou aberto conforme a boca da expressão. */
function bico(cor: string): (b: keyof typeof BOCAS) => Pixel[] {
  return (b) =>
    b === "nenhuma"
      ? []
      : ["aberta", "grande", "susto"].includes(b)
        ? pontos([[8, 7], [9, 7], [10, 7], [8, 9], [9, 9], [10, 9]], cor)
        : pontos([[8, 7], [9, 7], [10, 7], [9, 8]], cor);
}

/** Espelha pixels da esquerda para a direita da carinha (19 de largura). */
function espelhar(pixels: Pixel[]): Pixel[] {
  return [...pixels, ...pixels.map(([x, y, c]) => [18 - x, y, c] as Pixel)];
}

function pontos(lista: Ponto[], cor: string): Pixel[] {
  return lista.map(([x, y]) => [x, y, cor] as Pixel);
}

const LARANJA_GATO = "#FFA51F";
const MARROM = "#C68A5A";
const VERDE_SAPO = "#5BE38F";
const LILAS = "#B78CFF";
const FANTASMA = "#C9D0D7";
const BRANCO = "#E9ECEF";
const ROSA = "#FF8FB4";

export const PERSONAGENS: Record<PersonagemId, Personagem> = {
  robo: { nome: "Robozinho", jeito: "O clássico: curioso e prestativo.", pixels: [] },
  gato: {
    nome: "Gato",
    jeito: "Independente, mas sempre de olho em tudo.",
    pixels: [
      ...espelhar(pontos([[0, -4], [0, -3], [1, -3], [0, -2], [2, -2], [0, -1], [1, -1], [2, -1], [3, -1]], LARANJA_GATO)),
      ...espelhar(pontos([[1, -2]], ROSA)),
      ...espelhar(pontos([[-3, 7], [-2, 7], [-3, 9], [-2, 9]], "#9AA3AD")),
      [9, 7, ROSA],
    ],
    bocas: { sorriso: [[7, 9, 11], [8, 10]], grande: [[7, 9, 11], [8, 9, 10]] },
  },
  urso: {
    nome: "Urso",
    jeito: "Calmo e abraçável. Nunca tem pressa.",
    pixels: [
      ...espelhar(pontos([[0, -4], [1, -4], [-1, -3], [2, -3], [-1, -2], [2, -2], [0, -1], [1, -1]], MARROM)),
      ...espelhar(pontos([[0, -3], [1, -3], [0, -2], [1, -2]], "#8B5A3C")),
      [8, 7, "#F2D2B0"],
      [9, 7, "#F2D2B0"],
      [10, 7, "#F2D2B0"],
    ],
  },
  sapo: {
    nome: "Sapo",
    jeito: "Animado: pula de tarefa em tarefa.",
    pixels: espelhar(pontos([[2, -2], [3, -2], [4, -2], [1, -1], [5, -1]], VERDE_SAPO)),
    bocas: {
      sorriso: [[4, 14], [5, 6, 7, 8, 9, 10, 11, 12, 13]],
      grande: [[4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], [5, 6, 7, 8, 9, 10, 11, 12, 13]],
    },
  },
  alien: {
    nome: "Alien",
    jeito: "Veio de muito longe só para te ajudar.",
    pixels: [
      ...espelhar(pontos([[5, -1], [4, -2]], LILAS)),
      ...espelhar(pontos([[2, -4], [3, -4], [2, -3], [3, -3]], VERDE_SAPO)),
      ...pontos([[9, 0], [8, 1], [10, 1], [9, 2]], LILAS),
      [9, 1, ""],
    ],
  },
  fantasma: {
    nome: "Fantasma",
    jeito: "Aparece quando você precisa (e some em tela cheia).",
    pixels: espelhar(
      pontos(
        [
          [3, -3], [4, -3], [5, -3], [6, -3], [7, -3], [8, -3], [9, -3],
          [1, -2], [2, -2],
          [0, -1],
          [-1, 0], [-1, 1], [-1, 2], [-1, 3], [-1, 4], [-1, 5], [-1, 6], [-1, 7], [-1, 8], [-1, 9],
          [-2, 9],
        ],
        FANTASMA,
      ),
    ),
  },
  coelho: {
    nome: "Coelho",
    jeito: "Rápido nas respostas, orelhas sempre em pé.",
    pixels: [
      ...espelhar(pontos([[2, -4], [3, -4], [2, -3], [3, -3], [2, -2], [3, -2], [2, -1], [3, -1]], BRANCO)),
      ...espelhar(pontos([[3, -3], [3, -2]], ROSA)),
      [9, 7, ROSA],
      [8, 9, BRANCO],
      [10, 9, BRANCO],
    ],
    bocas: { sorriso: [[8, 10], []] },
  },
  gelatina: {
    nome: "Gelatina",
    jeito: "Molenga e grudenta: não larga você por nada.",
    corOlhos: "#0B2A17",
    pixels: [
      ...corpo([[4, 14, -3], [1, 17, -2], [-1, 19, -1], ...linhasCheias(-2, 20, 0, 9)], "#5BE38F"),
      ...pontos([[1, -1], [0, 0], [0, 1]], "#C8FFD9"),
    ],
  },
  nuvem: {
    nome: "Nuvem",
    jeito: "Leve, tranquila e sempre por cima de tudo.",
    corOlhos: "#1A2230",
    pixels: corpo(
      [
        [3, 6, -4],
        [11, 15, -4],
        [1, 17, -3],
        [0, 18, -2],
        [-2, 20, -1],
        ...linhasCheias(-3, 21, 0, 7),
        [-2, 20, 8],
        [-1, 4, 9],
        [7, 11, 9],
        [14, 19, 9],
      ],
      "#E9ECEF",
    ),
  },
  pinguim: {
    nome: "Pinguim",
    jeito: "Elegante e organizado, de smoking o dia todo.",
    corOlhos: "#11161C",
    pixels: [
      ...corpo([[2, 16, -4], [0, 18, -3], [-1, 19, -2], [-2, 20, -1], ...linhasCheias(-2, 20, 0, 9)], "#3A4552"),
      ...corpo([[2, 16, -1], ...linhasCheias(0, 18, 0, 9)], "#F2F4F6"),
    ],
    boca: bico("#FFA51F"),
  },
  coruja: {
    nome: "Coruja",
    jeito: "Sábia e acordada até tarde com você.",
    bochechas: false,
    pixels: [
      ...espelhar(pontos([[0, -3], [1, -3], [1, -2]], "#C68A5A")),
      ...espelhar(
        pontos(
          [
            [1, -1], [2, -1], [3, -1], [4, -1], [5, -1],
            [0, 0], [6, 0], [-1, 1], [7, 1], [-1, 2], [7, 2], [-1, 3], [7, 3], [-1, 4], [7, 4], [-1, 5], [7, 5],
            [0, 6], [6, 6], [1, 7], [2, 7], [4, 7], [5, 7],
          ],
          "#FFA51F",
        ),
      ),
    ],
    boca: bico("#FFD84D"),
  },
  tv: {
    nome: "TV",
    jeito: "Retrô: sempre tem um canal novo de ideias.",
    pixels: [
      ...corpo(linhasCheias(-1, 19, -1, 9), "#122028"),
      ...corpo([[-2, 20, -2]], "#9AA3AD"),
      ...pontos(Array.from({ length: 12 }, (_, y) => [-2, y - 2] as Ponto), "#9AA3AD"),
      ...pontos(Array.from({ length: 12 }, (_, y) => [20, y - 2] as Ponto), "#9AA3AD"),
      ...pontos([[7, -3], [6, -4], [11, -3], [12, -4]], "#9AA3AD"),
      [21, 2, "#FFA51F"],
      [21, 5, "#FF5A8A"],
    ],
  },
  olhao: {
    nome: "Olhão",
    jeito: "Monstrinho de um olho só: não perde nenhum detalhe.",
    umOlho: true,
    corOlhos: "#F2F4F6",
    pixels: [
      ...espelhar(pontos([[3, -2], [2, -3], [2, -4]], "#D9C2FF")),
      ...corpo([[2, 16, -1], [0, 18, 0], ...linhasCheias(-1, 19, 1, 9)], "#7A4FD6"),
    ],
    bocas: {
      sorriso: [[5, 13], [6, 7, 8, 9, 10, 11, 12]],
      grande: [[5, 6, 7, 8, 9, 10, 11, 12, 13], [6, 8, 10, 12]],
    },
  },

  // ---------- Monstrinhos ----------
  diabinho: {
    nome: "Diabinho",
    jeito: "Arteiro, mas do bem: apronta só com as suas tarefas.",
    monstro: true,
    corOlhos: "#FFD84D",
    bochechas: false,
    pixels: [
      ...corpo([[1, 17, -2], [0, 18, -1], ...linhasCheias(-1, 19, 0, 9)], "#D93A3F"),
      ...espelhar(pontos([[1, -4], [1, -3], [2, -3], [2, -2]], "#FFD84D")),
    ],
    frente: pontos([[8, 9], [10, 9]], "#F2F4F6"),
  },
  peludo: {
    nome: "Peludo",
    jeito: "Grandão e fofo. Assusta só no tamanho.",
    monstro: true,
    corOlhos: "#0B1A2A",
    bochechas: false,
    pixels: [
      ...pontos([[1, -4], [4, -4], [7, -4], [10, -4], [13, -4], [16, -4]], "#4FB3FF"),
      ...corpo([[0, 18, -3], [-1, 19, -2], ...linhasCheias(-2, 20, -1, 9)], "#4FB3FF"),
      ...pontos([[-3, 0], [-3, 2], [-3, 4], [-3, 6], [-3, 8], [21, 1], [21, 3], [21, 5], [21, 7], [21, 9]], "#4FB3FF"),
      ...pontos([[2, -2], [15, -1], [-1, 7], [19, 5], [8, -2]], "#2E7FC2"),
    ],
    bocas: { sorriso: [[5, 6, 7, 8, 9, 10, 11, 12, 13], [6, 7, 8, 9, 10, 11, 12]], grande: [[5, 6, 7, 8, 9, 10, 11, 12, 13], [5, 6, 7, 8, 9, 10, 11, 12, 13]] },
    frente: pontos([[6, 8], [8, 8], [10, 8], [12, 8]], "#F2F4F6"),
  },
  morcego: {
    nome: "Morcego",
    jeito: "Fica acordado de noite e não perde um aviso.",
    monstro: true,
    corOlhos: "#FF5A8A",
    bochechas: false,
    pixels: [
      ...espelhar(pontos([[1, -4], [1, -3], [2, -3], [1, -2], [2, -2], [3, -2]], "#5B3A8C")),
      ...corpo([[0, 18, -1], ...linhasCheias(0, 18, 0, 9)], "#5B3A8C"),
      ...espelhar(
        pontos(
          [[-1, 1], [-2, 2], [-1, 2], [-3, 3], [-2, 3], [-1, 3], [-3, 4], [-1, 4], [-3, 5], [-2, 5], [-1, 5], [-1, 6]],
          "#3D2766",
        ),
      ),
    ],
    frente: pontos([[8, 9], [10, 9]], "#F2F4F6"),
  },
  polvo: {
    nome: "Polvo",
    jeito: "Oito braços para fazer oito coisas ao mesmo tempo.",
    monstro: true,
    corOlhos: "#3A0F24",
    bochechas: false,
    pixels: [
      ...corpo([[4, 14, -4], [1, 17, -3], [0, 18, -2], ...linhasCheias(-1, 19, -1, 9)], "#FF8FB4"),
      ...espelhar(pontos([[-2, 3], [-3, 4], [-3, 5], [-2, 6], [-2, 7], [-3, 8], [-3, 9]], "#FF8FB4")),
      ...pontos([[3, -2], [15, -3], [1, 8], [17, 2]], "#FFC2D6"),
    ],
  },
  zumbi: {
    nome: "Zumbi",
    jeito: "Lento, mas nunca desiste de uma tarefa.",
    monstro: true,
    corOlhos: "#22301C",
    bochechas: false,
    pixels: [
      ...corpo([[2, 7, -4], [10, 15, -4], [1, 17, -3]], "#3B4A33"),
      ...corpo(linhasCheias(-1, 19, -2, 9), "#7FA86A"),
      ...corpo([[5, 13, -1]], "#3B4A33"),
      ...pontos([[6, -2], [9, -2], [12, -2]], "#3B4A33"),
    ],
    bocas: { sorriso: [[7, 9, 11], [8, 10]] },
  },
  dragao: {
    nome: "Dragãozinho",
    jeito: "Pequeno, corajoso e solta faísca de ideias.",
    monstro: true,
    corOlhos: "#FFD84D",
    bochechas: false,
    pixels: [
      ...pontos([[5, -4], [4, -3], [5, -3], [6, -3], [9, -4], [8, -3], [9, -3], [10, -3], [13, -4], [12, -3], [13, -3], [14, -3]], "#FFA51F"),
      ...corpo([[0, 18, -2], ...linhasCheias(-1, 19, -1, 9)], "#2FBF9F"),
      ...espelhar(pontos([[-2, 1], [-3, 2], [-2, 2]], "#2FBF9F")),
    ],
    frente: pontos([[8, 7], [10, 7]], "#0E4A3D"),
  },

  // ---------- Estilo moderno (vetor) ----------
  ...(Object.fromEntries(
    Object.entries(PERSONAGENS_VETOR).map(([id, v]) => [id, { nome: v.nome, jeito: v.jeito, pixels: [], vetor: true }]),
  ) as unknown as Record<"bolha" | "punk" | "anime" | "gota" | "cubo" | "astronauta", Personagem>),
};

/** Traduz um olho de pixels para o que ele "quer dizer" (para os personagens em vetor). */
function semantico(olho: Olho): OlhoSemantico {
  if (olho === FECHADO) return { tipo: "fechado" };
  if (olho === FELIZ) return { tipo: "feliz" };
  if (olho === PISCANDO || olho === MEIO_FECHADO) return { tipo: "pisca" };
  if (olho === CORACAO) return { tipo: "coracao" };
  if (olho === ARREGALADO) return { tipo: "arregalado" };
  if (olho === FOCO) return { tipo: "foco" };
  // Olho aberto: para onde a pupila foi (o contorno é igual em volta).
  const contorno = new Set(CONTORNO.map(([x, y]) => `${x},${y}`));
  const pupila = olho.filter(([x, y]) => !contorno.has(`${x},${y}`));
  if (!pupila.length) return { tipo: "aberto", dx: 0, dy: 0 };
  const mx = pupila.reduce((a, [x]) => a + x, 0) / pupila.length;
  const my = pupila.reduce((a, [, y]) => a + y, 0) / pupila.length;
  return { tipo: "aberto", dx: Math.max(-1, Math.min(1, mx - 3.1)), dy: Math.max(-1, Math.min(1, my - 3.1)) };
}

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
  /** Muda sozinha conforme o que o Dan está fazendo (só a carinha da ilha fechada). */
  segueAtividade?: boolean;
}

export interface Aparencia {
  corOlhos: string;
  corBochechas: string;
  acessorio: Acessorio;
  personagem: PersonagemId;
  estiloOlhos: EstiloOlhos;
}

function aparenciaSalva(): Aparencia {
  const c = ler().config;
  return { corOlhos: c.corOlhos, corBochechas: c.corBochechas, acessorio: c.acessorio, personagem: c.personagem ?? "robo", estiloOlhos: c.estiloOlhos ?? "redondos" };
}

export class Carinha {
  readonly elemento: SVGSVGElement;
  private expressao: Expressao;
  private olhar: Ponto = [0, 0];
  private relogio = 0;
  private animacao = 0;
  private quadro = 0;

  constructor(expressao: Expressao, private readonly opcoes: OpcoesCarinha = {}) {
    this.expressao = expressao;
    this.elemento = document.createElementNS(SVG, "svg");
    this.elemento.setAttribute("shape-rendering", "crispEdges");
    this.elemento.setAttribute("aria-hidden", "true");
    this.elemento.classList.add("carinha");
    this.desenhar();
    vivas.add(this);
    this.agendarPiscada();
    this.animar();
  }

  get atual(): Expressao {
    return this.expressao;
  }

  get segueAtividade(): boolean {
    return !!this.opcoes.segueAtividade;
  }

  /** Expressões animadas trocam de quadro sozinhas. */
  private animar(): void {
    window.clearInterval(this.animacao);
    estiloOlhos = this.estiloDosOlhos();
    const anim = quadros(this.expressao);
    if (!anim) return;
    this.quadro = 0;
    this.animacao = window.setInterval(() => {
      if (!this.elemento.isConnected) {
        // Ainda não entrou na tela: espera; saiu de vez: para.
        if (this.foiMostrada || performance.now() - this.criada > 10_000) this.parar();
        return;
      }
      this.foiMostrada = true;
      this.quadro = (this.quadro + 1) % anim.quadros.length;
      this.pintar(anim.quadros[this.quadro]);
    }, anim.ms);
  }
  private foiMostrada = false;
  private readonly criada = performance.now();

  /** Personagens em vetor desenham os olhos do jeito deles (a partir do redondo). */
  private estiloDosOlhos(): EstiloOlhos {
    const ap = this.aparencia();
    return this.opcoes.comAcessorio && PERSONAGENS[ap.personagem]?.vetor ? "redondos" : (ap.estiloOlhos ?? "redondos");
  }

  private aparencia(): Aparencia {
    return { ...aparenciaSalva(), ...this.opcoes.aparencia };
  }

  /** Troca a expressão com uma piscada rápida no meio (fica mais suave). */
  mudar(expressao: Expressao): void {
    if (expressao === this.expressao) return;
    this.expressao = expressao;
    window.clearInterval(this.animacao);
    this.desenharOlhos(PISCANDO);
    window.setTimeout(() => {
      this.desenhar();
      this.animar();
    }, 90);
  }

  /** Para onde olhar: -1, 0 ou 1 na horizontal e na vertical. */
  olharPara(dx: number, dy: number): void {
    const novo: Ponto = [Math.sign(dx), Math.sign(dy)];
    if (novo[0] === this.olhar[0] && novo[1] === this.olhar[1]) return;
    this.olhar = novo;
    this.desenhar();
  }

  private desenharOlhos(olho: Olho): void {
    estiloOlhos = this.estiloDosOlhos();
    const anim = quadros(this.expressao);
    const atual = anim ? anim.quadros[this.quadro % anim.quadros.length] : desenho(this.expressao, this.olhar);
    const d = { ...atual, esquerdo: olho, direito: olho };
    this.pintar(d);
  }

  private desenhar(): void {
    estiloOlhos = this.estiloDosOlhos();
    const anim = quadros(this.expressao);
    this.pintar(anim ? anim.quadros[this.quadro % anim.quadros.length] : desenho(this.expressao, this.olhar));
  }

  /** Área do desenho: maior quando há acessório (chapéu, fones…). */
  private enquadrar(comExtra: boolean): void {
    const tamanho = this.opcoes.tamanho ?? 2;
    const [x, y, w, h] = comExtra ? [-3, -4, 25, 14] : [0, 0, 19, 10];
    const caixa = `${x} ${y} ${w} ${h}`;
    if (this.elemento.getAttribute("viewBox") === caixa) return;
    this.elemento.setAttribute("viewBox", caixa);
    this.elemento.setAttribute("width", String(w * tamanho));
    this.elemento.setAttribute("height", String(h * tamanho));
  }

  private pintar(d: Desenho): void {
    const ap = this.aparencia();
    // O personagem só aparece "de corpo inteiro" (com acessório); nos outros
    // lugares fica a carinha simples.
    const personagem = this.opcoes.comAcessorio ? (PERSONAGENS[ap.personagem] ?? PERSONAGENS.robo) : PERSONAGENS.robo;
    if (personagem.vetor) {
      this.enquadrar(true);
      this.elemento.setAttribute("shape-rendering", "geometricPrecision");
      const corV = d.cor ?? ap.corOlhos;
      const quadrado = (x: number, y: number, c: string) => `<rect x="${x}" y="${y}" width="1" height="1" rx=".3" fill="${c || corV}"/>`;
      const acessorio = d.acessorio ?? (ap.acessorio !== "nenhum" ? ap.acessorio : null);
      const extras = [
        ...(acessorio ? ACESSORIOS[acessorio] : []).map(([x, y, c]) => quadrado(x, y, c)),
        ...(d.extras ?? []).map(([x, y, c]) => quadrado(x, y, c)),
      ].join("");
      this.elemento.innerHTML = pintarVetor(
        PERSONAGENS_VETOR[ap.personagem],
        [semantico(d.esquerdo), semantico(d.direito)],
        d.boca,
        d.bochechas,
        corV,
        ap.corBochechas,
        extras,
        d.deslocar ?? [0, 0],
      );
      this.elemento.style.setProperty("--brilho", "transparent");
      return;
    }
    this.elemento.setAttribute("shape-rendering", "crispEdges");
    this.enquadrar(!!this.opcoes.comAcessorio && (ap.acessorio !== "nenhum" || !!d.acessorio || personagem.pixels.length > 0));
    const cor = d.cor ?? personagem.corOlhos ?? ap.corOlhos;
    const pixels: string[] = [];
    const [mx, my] = d.deslocar ?? [0, 0];
    const acender = (x: number, y: number, c: string) =>
      pixels.push(`<rect x="${x + mx}" y="${y + my}" width="1" height="1" fill="${c || cor}"/>`);
    // O que é do personagem (orelhas, bigodes…) vem primeiro, por baixo.
    personagem.pixels.forEach(([x, y, c]) => acender(x, y, c));
    if (personagem.umOlho) {
      d.esquerdo.forEach(([x, y]) => acender(x + 6, y, cor));
    } else {
      d.esquerdo.forEach(([x, y]) => acender(x, y, cor));
      d.direito.forEach(([x, y]) => acender(x + 12, y, cor));
    }
    if (personagem.boca) {
      personagem.boca(d.boca).forEach(([x, y, c]) => acender(x, y, c));
    } else {
      const [l8, l9] = personagem.bocas?.[d.boca] ?? BOCAS[d.boca];
      l8.forEach((x) => acender(x, 8, cor));
      l9.forEach((x) => acender(x, 9, cor));
    }
    personagem.frente?.forEach(([x, y, c]) => acender(x, y, c));
    if (d.bochechas && personagem.bochechas !== false && ap.corBochechas !== "nenhuma") [0, 1, 17, 18].forEach((x) => acender(x, 8, ap.corBochechas));
    if (this.opcoes.comAcessorio) {
      // A animação pode trocar o acessório (ex.: fones numa chamada).
      const acessorio = d.acessorio ?? (ap.acessorio !== "nenhum" ? ap.acessorio : null);
      if (acessorio) ACESSORIOS[acessorio].forEach(([x, y, c]) => acender(x, y, c));
    }
    d.extras?.forEach(([x, y, c]) => acender(x, y, c));
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
        // (as animadas piscam nos próprios quadros)
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
    window.clearInterval(this.animacao);
    vivas.delete(this);
  }
}

/** A ilha percebeu outra atividade: troca a carinha da ilha fechada. */
export function mudarAtividade(expressao: Expressao): void {
  for (const c of [...vivas]) {
    if (c.segueAtividade && c.elemento.isConnected) c.mudar(expressao);
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
