// A ilha grande fecha sozinha quando perde o foco (como a ilha). Mas janelas
// do Windows abertas por ela (escolher arquivo, ditado) também tiram o foco;
// enquanto elas estão abertas, a ilha grande não deve fechar.
let abertos = 0;
let ate = 0;

/** Não fechar por perder o foco durante os próximos `ms`. */
export function segurarPor(ms: number): void {
  ate = Math.max(ate, Date.now() + ms);
}

/** Não fechar enquanto esta janela do Windows estiver aberta. */
export async function enquanto<T>(p: Promise<T>): Promise<T> {
  abertos++;
  try {
    return await p;
  } finally {
    abertos--;
    segurarPor(800);
  }
}

export const focoSeguro = () => abertos > 0 || Date.now() < ate;
