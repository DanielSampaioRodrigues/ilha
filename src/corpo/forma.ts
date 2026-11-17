// Desenho da ilha: um corpo preto preso ao topo, com "ombros" côncavos
// (a curvinha que liga a ilha à borda da tela) e cantos de baixo redondos.
// "gota" empurra o meio da borda de baixo para baixo, como líquido escorrendo.

export const OMBRO = 14;
const OMBRO_PADRAO = OMBRO;

export interface Forma {
  largura: number;
  altura: number;
  raio: number;
  gota: number;
  /** Tamanho da curvinha dos ombros (menor no modo discreto). */
  ombro?: number;
}

const n = (v: number) => v.toFixed(2);

/**
 * `aberto`: sem a linha de cima (a que encosta na borda da tela) e sem fechar
 * o desenho. É o caminho do brilho colorido: só o contorno de fora brilha.
 */
export function caminho(f: Forma, centro: number, aberto = false): string {
  const OMBRO = Math.max(1, f.ombro ?? OMBRO_PADRAO);
  const largura = Math.max(f.largura, 8);
  const altura = Math.max(f.altura, OMBRO + 2);
  const raio = Math.max(0, Math.min(f.raio, altura - OMBRO, largura / 2));
  // A borda de baixo pode subir um pouco (ao recolher), mas sem cruzar os lados.
  const gota = Math.max(f.gota, -(altura - OMBRO - raio) * 0.5);

  const x0 = centro - largura / 2 - OMBRO;
  const x1 = centro - largura / 2;
  const x2 = centro + largura / 2;
  const x3 = centro + largura / 2 + OMBRO;

  const inicioBase = x2 - raio;
  const fimBase = x1 + raio;
  const vao = inicioBase - fimBase;
  // Com os pontos de controle 4/3 abaixo, o ponto mais fundo fica exatamente em "gota".
  const fundo = altura + (gota * 4) / 3;

  return [
    ...(aberto ? [`M ${n(x3)} 0`] : [`M ${n(x0)} 0`, `H ${n(x3)}`]),
    `A ${n(OMBRO)} ${n(OMBRO)} 0 0 0 ${n(x2)} ${n(OMBRO)}`,
    `V ${n(altura - raio)}`,
    `A ${n(raio)} ${n(raio)} 0 0 1 ${n(inicioBase)} ${n(altura)}`,
    `C ${n(inicioBase - vao * 0.2)} ${n(fundo)} ${n(fimBase + vao * 0.2)} ${n(fundo)} ${n(fimBase)} ${n(altura)}`,
    `A ${n(raio)} ${n(raio)} 0 0 1 ${n(x1)} ${n(altura - raio)}`,
    `V ${n(OMBRO)}`,
    `A ${n(OMBRO)} ${n(OMBRO)} 0 0 0 ${n(x0)} 0`,
    ...(aberto ? [] : ["Z"]),
  ].join(" ");
}
