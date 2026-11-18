// Temas: o "clima" de cores da ilha e da Central (a ilha continua preta; muda
// o brilho, os gradientes, os ícones e o fundo animado da Central).
// - "personagem" (padrão): as cores acompanham o personagem escolhido.
// - "aurora": a cor de destaque que o Dan escolher (como era antes).
// - Os outros: combinações prontas.
import { ler, type Config } from "../dados/armazem";

export const CORES_DESTAQUE = [
  { nome: "Ciano", cor: "#3FE6EE" },
  { nome: "Verde", cor: "#5BE38F" },
  { nome: "Azul", cor: "#7BA7FF" },
  { nome: "Lilás", cor: "#B78CFF" },
  { nome: "Rosa", cor: "#FF8FB4" },
  { nome: "Amarelo", cor: "#FFD84D" },
];

export interface Paleta {
  /** Cor principal, a segunda e a terceira (gradientes e fundo animado). */
  cores: [string, string, string];
  /** Fundo da Central. */
  fundo: string;
  /** Força do fundo animado (1 = normal). */
  aurora: number;
  /** Quanto os ícones ficam coloridos (1 = normal; 0,25 = quase cinza). */
  croma: number;
  /** Tema especial, com enfeites próprios (ex.: "neuro" = infinito colorido da neurodiversidade). */
  especial?: "neuro" | "elas";
}

export interface Tema {
  id: string;
  nome: string;
  descricao: string;
  paleta?: Paleta;
}

export const TEMAS: Tema[] = [
  { id: "personagem", nome: "Combinar com o personagem", descricao: "As cores mudam junto com quem mora na ilha." },
  { id: "aurora", nome: "Aurora", descricao: "A sua cor de destaque, com vizinhas no círculo de cores." },
  { id: "por-do-sol", nome: "Pôr do sol", descricao: "Laranja, rosa e dourado.", paleta: { cores: ["#FF8A5C", "#FF5E9C", "#FFD166"], fundo: "#0D0709", aurora: 1.1, croma: 1 } },
  { id: "oceano", nome: "Oceano", descricao: "Azuis e verde-água.", paleta: { cores: ["#3FC8FF", "#4F7DFF", "#2EE6C8"], fundo: "#050A12", aurora: 1, croma: 1 } },
  { id: "floresta", nome: "Floresta", descricao: "Verdes e limão.", paleta: { cores: ["#5FD38D", "#B5E655", "#2FB7A0"], fundo: "#060B08", aurora: 0.9, croma: 0.9 } },
  { id: "neon", nome: "Neon", descricao: "Rosa e ciano bem fortes, estilo cyberpunk.", paleta: { cores: ["#FF2FD6", "#2FF3FF", "#8A5BFF"], fundo: "#07040D", aurora: 1.5, croma: 1.15 } },
  { id: "grafite", nome: "Grafite", descricao: "Sóbrio, quase sem cor.", paleta: { cores: ["#C9D1D9", "#8B98A5", "#E6E6E6"], fundo: "#08090B", aurora: 0.35, croma: 0.25 } },
  {
    id: "elas",
    nome: "Elas ✊",
    descricao: "Roxo, verde e dourado: as cores históricas do movimento das mulheres e a coroa. É o tema da Dandara.",
    paleta: { cores: ["#B07CFF", "#3DDC97", "#FFC94D"], fundo: "#08060C", aurora: 1.15, croma: 1.05, especial: "elas" },
  },
  {
    id: "neurodiversidade",
    nome: "Neurodiversidade ∞",
    descricao: "O infinito colorido, símbolo da neurodiversidade. É o tema do Téo.",
    paleta: { cores: ["#2EC4B6", "#FFCF56", "#FF8FAB"], fundo: "#06080A", aurora: 1.15, croma: 1.05, especial: "neuro" },
  },
];

/** As cores de cada personagem ilustrado (os de pixel usam a cor de destaque). */
const DO_PERSONAGEM: Record<string, [string, string, string]> = {
  broto: ["#5EE6B0", "#B8F26D", "#4FC3F7"],
  faisca: ["#FF3D9A", "#FF7A45", "#9B5CFF"],
  mimi: ["#C69CFF", "#7FF0D0", "#FF9AD5"],
  bolota: ["#FFA04D", "#FFD166", "#FF6B6B"],
  lata: ["#4FD1C5", "#E0915A", "#F6C453"],
  neon: ["#41E6FF", "#A46BFF", "#FF4FD8"],
  cosmo: ["#6EC8FF", "#FF9F43", "#B6A4FF"],
  massinha: ["#47A8FF", "#FFA24C", "#7EF0C6"],
  boing: ["#FFD23F", "#FF8F3D", "#8BE36B"],
  dobra: ["#FF8A3D", "#FFD29A", "#FF5D73"],
  // Téo: o tema especial da neurodiversidade (abaixo).
  teo: ["#2EC4B6", "#FFCF56", "#FF8FAB"],
  dandara: ["#B07CFF", "#3DDC97", "#FFC94D"],
  nimbo: ["#8FD3FF", "#FFB3E6", "#B8F2A0"],
};

/** A paleta que vale agora (null = a da cor de destaque, com as vizinhas calculadas). */
export function paletaAtual(c: Config = ler().config): Paleta | null {
  const tema = c.tema ?? "personagem";
  if (tema === "personagem") {
    if (c.personagem === "teo") return TEMAS.find((t) => t.id === "neurodiversidade")!.paleta!;
    if (c.personagem === "dandara") return TEMAS.find((t) => t.id === "elas")!.paleta!;
    const cores = DO_PERSONAGEM[c.personagem];
    return cores ? { cores, fundo: "#06070A", aurora: 1, croma: 1 } : null;
  }
  return TEMAS.find((t) => t.id === tema)?.paleta ?? null;
}

/** As três cores para mostrar a amostra de um tema. */
export function amostraDoTema(t: Tema, c: Config = ler().config): [string, string, string] | null {
  if (t.paleta) return t.paleta.cores;
  if (t.id === "personagem") return DO_PERSONAGEM[c.personagem] ?? null;
  return null;
}

/** Aplica o tema (ou a cor de destaque) nesta janela. */
export function aplicarTema(c: Config = ler().config): void {
  const raiz = document.documentElement.style;
  const p = paletaAtual(c);
  // Enfeites do tema especial e o "visual calmo" (menos movimento e brilho).
  document.documentElement.dataset.especial = p?.especial ?? "";
  document.documentElement.classList.toggle("visual-calmo", !!c.visualCalmo);
  if (p) {
    raiz.setProperty("--ciano", p.cores[0]);
    raiz.setProperty("--tema-2", p.cores[1]);
    raiz.setProperty("--tema-3", p.cores[2]);
    raiz.setProperty("--fundo-central", p.fundo);
    raiz.setProperty("--aurora-forca", String(p.aurora));
    raiz.setProperty("--croma", String(p.croma));
  } else {
    raiz.setProperty("--ciano", c.corDestaque);
    for (const v of ["--tema-2", "--tema-3", "--fundo-central", "--aurora-forca", "--croma"]) raiz.removeProperty(v);
  }
}

/** Nome antigo: aplicar a cor = aplicar o tema inteiro (que já inclui a cor de destaque). */
export function aplicarCor(_cor?: string): void {
  aplicarTema();
}
