// Dicionário: palavras que o ouvido costuma errar. Uma por linha:
//   Arcano
//   Claude Code = cloud code, clode code
// À esquerda, como deve ficar; depois do "=", como ele escreve errado.
import { ler } from "./armazem";
import { definirDicionario, definirDitado, type PalavraDicionario } from "../maos/sistema";

export function lerDicionario(texto: string): PalavraDicionario[] {
  return texto
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter((linha) => linha && !linha.startsWith("#"))
    .map((linha) => {
      const [certo, errados = ""] = linha.split("=");
      return {
        certo: certo.trim(),
        errados: errados
          .split(",")
          .map((e) => e.trim())
          .filter(Boolean),
      };
    })
    .filter((p) => p.certo);
}

export const ATALHO_DITADO_PADRAO = "Ctrl+Shift+Space";
export const ATALHOS_DITADO = ["Ctrl+Shift+Space", "Ctrl+Alt+Space", "Ctrl+Shift+D", "Super+Alt+D", "F9"];

/** Manda para o Rust o dicionário e o atalho do ditado (ao ligar e quando mudam). */
export async function aplicarDitado(): Promise<string | null> {
  const c = ler().config;
  await definirDicionario(lerDicionario(c.dicionario ?? "")).catch(() => {});
  if (c.ditadoLigado === false) return definirDitado(false, "").catch(() => null);
  const preferido = c.atalhoDitado || ATALHO_DITADO_PADRAO;
  // Se o escolhido estiver ocupado (ex.: o atalho da ilha), tenta os outros.
  for (const atalho of [preferido, ...ATALHOS_DITADO.filter((a) => a !== preferido)]) {
    const ok = await definirDitado(true, atalho).catch(() => null);
    if (ok) return ok;
  }
  return null;
}
