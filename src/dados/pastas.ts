// Pastas que o Dan usa: a ilha lembra das que abriu (e das fixadas) para
// achar de novo na hora e para contar às IAs onde elas ficam.
import { ler, mudar, type Dados, type PastaConhecida } from "./armazem";
import { abrirPrograma, procurarPastas, type PastaAchada } from "../maos/sistema";

const NUMEROS: Record<string, string> = {
  um: "1", uma: "1", dois: "2", duas: "2", tres: "3", quatro: "4", cinco: "5", seis: "6", sete: "7", oito: "8", nove: "9", dez: "10",
  ii: "2", iii: "3", iv: "4", vi: "6", vii: "7", viii: "8", ix: "9",
};
const VAZIAS = new Set(["a", "o", "as", "os", "de", "do", "da", "dos", "das", "e", "pasta", "minha", "meu"]);

function palavras(t: string): string[] {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((p) => p && !VAZIAS.has(p))
    .map((p) => NUMEROS[p] ?? p);
}

/** Nome da pasta a partir do caminho. */
export const nomeDaPasta = (caminho: string) => caminho.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || caminho;

/** As que a IA deve conhecer: fixadas primeiro, depois as mais usadas (até 15). */
export function pastasConhecidas(d: Dados = ler()): PastaConhecida[] {
  return [...(d.config.pastas ?? [])].sort((a, b) => Number(!!b.fixa) - Number(!!a.fixa) || b.usos - a.usos || b.ultima - a.ultima).slice(0, 15);
}

/** Anota que a pasta foi usada (entra na lista sozinha). */
export function usarPasta(caminho: string, fixar = false): void {
  mudar((d) => {
    const lista = (d.config.pastas ??= []);
    const achada = lista.find((p) => p.caminho.toLowerCase() === caminho.toLowerCase());
    if (achada) {
      achada.usos += fixar ? 0 : 1;
      achada.ultima = Date.now();
      if (fixar) achada.fixa = true;
    } else {
      lista.push({ nome: nomeDaPasta(caminho), caminho, usos: fixar ? 0 : 1, fixa: fixar || undefined, ultima: Date.now() });
    }
    // Não deixa crescer sem fim: guarda as 40 mais importantes.
    if (lista.length > 40) d.config.pastas = pastasOrdenadas(lista).slice(0, 40);
  });
}

function pastasOrdenadas(lista: PastaConhecida[]): PastaConhecida[] {
  return [...lista].sort((a, b) => Number(!!b.fixa) - Number(!!a.fixa) || b.usos - a.usos || b.ultima - a.ultima);
}

/** Uma das pastas conhecidas com esse nome (todas as palavras pedidas no nome). */
function conhecidaPorNome(nome: string): PastaConhecida | null {
  const pedido = palavras(nome);
  if (!pedido.length) return null;
  const combina = (q: string, f: string) => q === f || (q.length >= 4 && f.length >= 4 && (q.startsWith(f) || f.startsWith(q)));
  const candidatas = pastasOrdenadas(ler().config.pastas ?? []).filter((p) => {
    const da = palavras(p.nome);
    return pedido.every((q) => da.some((f) => combina(q, f)));
  });
  // A de nome mais curto (mais exata) primeiro.
  return candidatas.sort((a, b) => palavras(a.nome).length - palavras(b.nome).length)[0] ?? null;
}

/** Acha a pasta pelo nome falado: primeiro as conhecidas, depois em todos os discos. */
export async function acharPasta(nome: string): Promise<{ melhor: PastaAchada | null; outras: PastaAchada[] }> {
  const conhecida = conhecidaPorNome(nome);
  if (conhecida) return { melhor: { caminho: conhecida.caminho, nome: conhecida.nome, nota: 100 }, outras: [] };
  const achadas = await procurarPastas(nome);
  const melhor = achadas[0] && achadas[0].nota >= 70 ? achadas[0] : null;
  return { melhor, outras: achadas.filter((a) => a !== melhor) };
}

/** Abre no Explorador e lembra dela. */
export async function abrirPasta(caminho: string): Promise<void> {
  await abrirPrograma(caminho);
  usarPasta(caminho);
}
