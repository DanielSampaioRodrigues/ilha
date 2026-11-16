// Personagens em vetor (curvas lisas, sombras e brilhos), no lugar dos pixels.
// Usam as MESMAS expressões e animações da carinha de pixel: a carinha diz
// "olho aberto olhando para a direita", "olho feliz", "boca aberta"… e aqui
// cada personagem desenha isso do seu jeito (desenho, anime, punk, 3D).
//
// Área do desenho: x de -3 a 22, y de -4 a 10 (a mesma da carinha com acessório).
// Olho esquerdo centrado em (3, 3), direito em (15, 3); boca em volta de (9.5, 8.6).

export type OlhoSemantico =
  | { tipo: "aberto"; dx: number; dy: number }
  | { tipo: "fechado" }
  | { tipo: "feliz" }
  | { tipo: "pisca" }
  | { tipo: "coracao" }
  | { tipo: "arregalado" }
  | { tipo: "foco" };

type EstiloOlho = "desenho" | "anime" | "punk" | "bolinha" | "neon";

export interface PersonagemVetor {
  nome: string;
  jeito: string;
  estilo: EstiloOlho;
  /** Cor da boca e dos traços. */
  traco: string;
  /** Usa a cor de olhos escolhida pelo Dan? (senão, a cor própria) */
  corOlhos?: string;
  bochechas?: boolean;
  /** Corpo (atrás) e detalhes (na frente), em SVG. `u` = prefixo único para gradientes. */
  corpo: (u: string) => string;
  frente?: (u: string) => string;
}

const OLHO_E: [number, number] = [3, 3];
const OLHO_D: [number, number] = [15, 3];

export const PERSONAGENS_VETOR: Record<string, PersonagemVetor> = {
  bolha: {
    nome: "Bolha",
    jeito: "Redondinha e brilhante, parece de brinquedo (estilo 3D).",
    estilo: "desenho",
    traco: "#5A1E05",
    corpo: (u) => `
      <defs>
        <radialGradient id="${u}g" cx="35%" cy="25%" r="80%">
          <stop offset="0" stop-color="#FFD39A"/><stop offset=".45" stop-color="#FF8A2A"/><stop offset="1" stop-color="#B83A08"/>
        </radialGradient>
      </defs>
      <ellipse cx="9" cy="3.4" rx="11.8" ry="6.4" fill="url(#${u}g)"/>
      <ellipse cx="2.6" cy="-1.3" rx="3.4" ry="1.1" fill="#fff" opacity=".55" transform="rotate(-18 2.6 -1.3)"/>`,
  },
  punk: {
    nome: "Punk",
    jeito: "Moicano rosa, delineado e atitude. Faz tudo no volume máximo.",
    estilo: "punk",
    traco: "#FF3EA5",
    corOlhos: "#7CFF6B",
    bochechas: false,
    corpo: (u) => `
      <defs>
        <linearGradient id="${u}g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#3A3446"/><stop offset="1" stop-color="#15121B"/>
        </linearGradient>
      </defs>
      <path d="M5 -1.4 L5.8 -4 L7 -1.6 L8 -4.2 L9.2 -1.6 L10.4 -4.2 L11.4 -1.6 L12.6 -4 L13.4 -1.4 Z" fill="#FF3EA5"/>
      <rect x="-1.6" y="-1.6" width="21.2" height="11.4" rx="4" fill="url(#${u}g)"/>
      <path d="M-1.6 2 h21.2" stroke="#000" stroke-opacity=".25" stroke-width=".3"/>`,
    frente: () => `<circle cx="19.9" cy="6.4" r=".9" fill="none" stroke="#C9D0D7" stroke-width=".35"/>
      <circle cx="13.6" cy="8.9" r=".35" fill="#C9D0D7"/>`,
  },
  anime: {
    nome: "Anime",
    jeito: "Olhos enormes e brilhantes, franjinha e muita animação.",
    estilo: "anime",
    traco: "#B5485A",
    corpo: (u) => `
      <defs>
        <linearGradient id="${u}p" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#FFEADD"/><stop offset="1" stop-color="#FFD2BC"/>
        </linearGradient>
        <linearGradient id="${u}c" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#8E9BFF"/><stop offset="1" stop-color="#5563E8"/>
        </linearGradient>
      </defs>
      <ellipse cx="9" cy="4.2" rx="11" ry="6" fill="url(#${u}p)"/>
      <path d="M-2.4 3 C-2.6 -4.2 20.6 -4.2 20.4 3 C18.6 -0.4 16 -0.6 14.4 0.6 C13 -1.2 10.6 -1 9.6 0.2 C8.4 -1.2 5.6 -1.2 4.6 0.4 C3 -0.8 -0.6 -0.4 -2.4 3 Z" fill="url(#${u}c)"/>
      <path d="M3 -2.2 C5 -3.2 8 -3.4 10 -3" stroke="#fff" stroke-opacity=".5" stroke-width=".45" fill="none" stroke-linecap="round"/>`,
  },
  gota: {
    nome: "Gotinha",
    jeito: "Fresquinha e transparente (estilo 3D). Sempre de bom humor.",
    estilo: "bolinha",
    traco: "#0B3A66",
    corOlhos: "#0B2440",
    corpo: (u) => `
      <defs>
        <radialGradient id="${u}g" cx="38%" cy="40%" r="75%">
          <stop offset="0" stop-color="#BDE7FF"/><stop offset=".55" stop-color="#4FB3FF"/><stop offset="1" stop-color="#1667C9"/>
        </radialGradient>
      </defs>
      <path d="M9 -4.2 C11.5 -1.6 21 0.4 21 4.8 C21 8.6 16 10.2 9 10.2 C2 10.2 -3 8.6 -3 4.8 C-3 0.4 6.5 -1.6 9 -4.2 Z" fill="url(#${u}g)"/>
      <ellipse cx="3" cy="1" rx="2.6" ry=".9" fill="#fff" opacity=".6" transform="rotate(-20 3 1)"/>
      <circle cx="18.2" cy="6.6" r=".7" fill="#fff" opacity=".5"/>`,
  },
  cubo: {
    nome: "Cubo",
    jeito: "Quadradão, organizado e cheio de lados (estilo 3D).",
    estilo: "bolinha",
    traco: "#0E3B24",
    corOlhos: "#0E2A1B",
    corpo: (u) => `
      <defs>
        <linearGradient id="${u}f" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#7BF0A8"/><stop offset="1" stop-color="#2FB868"/>
        </linearGradient>
      </defs>
      <path d="M-1.6 -1.2 L1.4 -4 L21.4 -4 L18.4 -1.2 Z" fill="#B8FFD2"/>
      <path d="M18.4 -1.2 L21.4 -4 L21.4 7 L18.4 9.8 Z" fill="#1E8A4B"/>
      <rect x="-1.6" y="-1.2" width="20" height="11" fill="url(#${u}f)"/>
      <path d="M-1.6 -1.2 h20" stroke="#fff" stroke-opacity=".6" stroke-width=".3"/>`,
  },
  astronauta: {
    nome: "Astronauta",
    jeito: "De capacete e tudo: explora o computador inteiro.",
    estilo: "neon",
    traco: "",
    bochechas: false,
    corpo: (u) => `
      <defs>
        <linearGradient id="${u}c" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#B9C2CC"/>
        </linearGradient>
        <linearGradient id="${u}v" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#1B2E4A"/><stop offset="1" stop-color="#05080F"/>
        </linearGradient>
      </defs>
      <rect x="-2.8" y="-3.4" width="23.6" height="13.2" rx="6" fill="url(#${u}c)"/>
      <rect x="-1" y="-1.6" width="20" height="9.6" rx="4.2" fill="url(#${u}v)" stroke="#FFC24D" stroke-width=".7"/>
      <circle cx="-1.9" cy="3.2" r="1.1" fill="#9AA3AD"/><circle cx="19.9" cy="3.2" r="1.1" fill="#9AA3AD"/>
      <rect x="6.6" y="-3.1" width="4.8" height="1.1" rx=".4" fill="#5C8BFF"/><circle cx="7.4" cy="-2.55" r=".3" fill="#fff"/>`,
    frente: () => `<path d="M0.6 -0.4 C2 -1.2 4.4 -1.4 6 -1.2" stroke="#fff" stroke-opacity=".55" stroke-width=".55" fill="none" stroke-linecap="round"/>
      <rect x="15.6" y="5.6" width="2.4" height=".5" rx=".25" fill="#fff" opacity=".25"/>`,
  },
};

// ---------- Olhos ----------

function coracao(cx: number, cy: number, cor: string): string {
  return `<path d="M${cx} ${cy + 2.2} C${cx - 3.4} ${cy - 0.2} ${cx - 2.2} ${cy - 3} ${cx} ${cy - 1.2} C${cx + 2.2} ${cy - 3} ${cx + 3.4} ${cy - 0.2} ${cx} ${cy + 2.2} Z" fill="${cor}"/>`;
}

function olho(estilo: EstiloOlho, o: OlhoSemantico, [cx, cy]: [number, number], cor: string, traco: string, u: string): string {
  const linha = traco || cor;
  const arco = (sobe: boolean) =>
    `<path d="M${cx - 2.4} ${cy + (sobe ? 0.8 : -0.4)} Q${cx} ${cy + (sobe ? -2 : 2.2)} ${cx + 2.4} ${cy + (sobe ? 0.8 : -0.4)}" stroke="${linha}" stroke-width=".75" fill="none" stroke-linecap="round"/>`;
  switch (o.tipo) {
    case "feliz":
      return arco(true);
    case "fechado":
      return arco(false);
    case "pisca":
      return `<path d="M${cx - 2.4} ${cy + 0.6} H${cx + 2.4}" stroke="${linha}" stroke-width=".75" stroke-linecap="round"/>`;
    case "foco":
      return `<path d="M${cx - 2.4} ${cy - 0.2} L${cx + 2.4} ${cy + 0.4}" stroke="${linha}" stroke-width=".75" stroke-linecap="round"/><circle cx="${cx}" cy="${cy + 1}" r=".9" fill="${linha}"/>`;
    case "coracao":
      return coracao(cx, cy, "#FF5A8A");
    default:
      break;
  }
  const arregalado = o.tipo === "arregalado";
  const dx = o.tipo === "aberto" ? o.dx : 0;
  const dy = o.tipo === "aberto" ? o.dy : 0;
  switch (estilo) {
    case "desenho": {
      const r = arregalado ? 1 : 1.35;
      return `<ellipse cx="${cx}" cy="${cy}" rx="2.6" ry="2.9" fill="#fff"/>
        <circle cx="${cx + dx * 0.9}" cy="${cy + dy * 0.9 + 0.2}" r="${r}" fill="${linha}"/>
        <circle cx="${cx + dx * 0.9 - 0.45}" cy="${cy + dy * 0.9 - 0.3}" r=".42" fill="#fff"/>`;
    }
    case "anime": {
      const ry = arregalado ? 2.2 : 2.9;
      return `<defs><linearGradient id="${u}i" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1B1F4A"/><stop offset="1" stop-color="${cor}"/></linearGradient></defs>
        <ellipse cx="${cx + dx * 0.4}" cy="${cy + dy * 0.4}" rx="1.9" ry="${ry}" fill="url(#${u}i)"/>
        <path d="M${cx - 2.4} ${cy - 2.6} Q${cx} ${cy - 3.8} ${cx + 2.4} ${cy - 2.4}" stroke="#2A2340" stroke-width=".55" fill="none" stroke-linecap="round"/>
        <circle cx="${cx + dx * 0.4 - 0.6}" cy="${cy + dy * 0.4 - 1.1}" r=".75" fill="#fff"/>
        <circle cx="${cx + dx * 0.4 + 0.7}" cy="${cy + dy * 0.4 + 1}" r=".35" fill="#fff"/>`;
    }
    case "punk": {
      const r = arregalado ? 0.7 : 1.1;
      return `<path d="M${cx - 2.6} ${cy + 0.3} Q${cx} ${cy - 2.6} ${cx + 2.6} ${cy + 0.3} Q${cx} ${cy + 2.4} ${cx - 2.6} ${cy + 0.3} Z" fill="#fff"/>
        <circle cx="${cx + dx * 0.8}" cy="${cy + dy * 0.5 + 0.1}" r="${r}" fill="${cor}"/>
        <circle cx="${cx + dx * 0.8}" cy="${cy + dy * 0.5 + 0.1}" r="${r * 0.45}" fill="#000"/>
        <path d="M${cx - 2.8} ${cy + 0.2} Q${cx} ${cy - 2.9} ${cx + 2.8} ${cy + 0.1} L${cx + 3.6} ${cy - 0.9}" stroke="#000" stroke-width=".6" fill="none" stroke-linecap="round"/>`;
    }
    case "bolinha": {
      const r = arregalado ? 1 : 1.7;
      return `<circle cx="${cx + dx * 0.7}" cy="${cy + dy * 0.7}" r="${r}" fill="${cor}"/>
        <circle cx="${cx + dx * 0.7 - 0.6}" cy="${cy + dy * 0.7 - 0.6}" r=".5" fill="#fff" opacity=".9"/>`;
    }
    case "neon": {
      const r = arregalado ? 1 : 1.9;
      return `<circle cx="${cx + dx * 0.8}" cy="${cy + dy * 0.8}" r="${r}" fill="${cor}" filter="url(#${u}n)"/>
        <circle cx="${cx + dx * 0.8}" cy="${cy + dy * 0.8}" r="${r * 0.55}" fill="#fff" opacity=".85"/>`;
    }
  }
}

// ---------- Bocas ----------

function boca(nome: string, cor: string): string {
  const t = `stroke="${cor}" stroke-width=".7" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  switch (nome) {
    case "sorriso":
      return `<path d="M7 8 Q9.5 10.4 12 8" ${t}/>`;
    case "aberta":
      return `<ellipse cx="9.5" cy="8.8" rx="1.3" ry="1" fill="${cor}"/>`;
    case "reta":
      return `<path d="M8 9 H11" ${t}/>`;
    case "pequena":
      return `<path d="M8.8 9 H10.2" ${t}/>`;
    case "susto":
      return `<ellipse cx="9.5" cy="8.8" rx=".9" ry="1.2" fill="${cor}"/>`;
    case "triste":
      return `<path d="M7.4 9.8 Q9.5 7.8 11.6 9.8" ${t}/>`;
    case "grande":
      return `<path d="M6.8 7.8 Q9.5 11.4 12.2 7.8 Z" fill="${cor}"/><path d="M8 9.4 Q9.5 10.2 11 9.4" stroke="#FF8FB4" stroke-width=".5" fill="none"/>`;
    case "zigue":
      return `<path d="M7 9 L8 8.2 L9 9 L10 8.2 L11 9 L12 8.2" ${t}/>`;
    default:
      return "";
  }
}

let contador = 0;

/** Desenha o personagem vetorial com a expressão já traduzida. */
export function pintarVetor(
  p: PersonagemVetor,
  olhos: [OlhoSemantico, OlhoSemantico | null],
  nomeBoca: string,
  bochechas: boolean,
  corOlhosDoDan: string,
  corBochechas: string,
  extras: string,
  deslocar: [number, number],
): string {
  const u = `v${++contador}`;
  const cor = p.corOlhos ?? corOlhosDoDan;
  const traco = p.traco || cor;
  const defsNeon = p.estilo === "neon" ? `<defs><filter id="${u}n" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation=".45"/></filter></defs>` : "";
  const [e, d] = olhos;
  const rosto = [
    olho(p.estilo, e, d ? OLHO_E : [9, 3], cor, p.traco, `${u}e`),
    d ? olho(p.estilo, d, OLHO_D, cor, p.traco, `${u}d`) : "",
    boca(nomeBoca, traco),
    bochechas && p.bochechas !== false && corBochechas !== "nenhuma"
      ? `<ellipse cx="0.6" cy="7.6" rx="1.4" ry=".7" fill="${corBochechas}" opacity=".7"/><ellipse cx="17.4" cy="7.6" rx="1.4" ry=".7" fill="${corBochechas}" opacity=".7"/>`
      : "",
  ].join("");
  return `${defsNeon}<g transform="translate(${deslocar[0]} ${deslocar[1]})">${p.corpo(u)}${rosto}${p.frente?.(u) ?? ""}${extras}</g>`;
}
