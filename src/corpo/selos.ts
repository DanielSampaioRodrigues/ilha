// Símbolos das IAs, para saber de relance qual modelo vai renovar.
// São desenhos simples inspirados nas cores de cada uma (não são os logotipos).
import type { Redefinicao } from "../dados/armazem";

export type TipoIA = "claude" | "chatgpt" | "gemini" | "deepseek" | "outra";

export const NOMES_IA: Record<TipoIA, string> = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  deepseek: "DeepSeek",
  outra: "Outra",
};

/** Descobre a IA pelo nome, se o Dan não escolheu. */
export function tipoDa(r: Pick<Redefinicao, "nome" | "ia">): TipoIA {
  if (r.ia && r.ia !== "auto") return r.ia;
  const nome = r.nome.toLowerCase();
  if (nome.includes("claude") || nome.includes("anthropic")) return "claude";
  if (nome.includes("chatgpt") || nome.includes("gpt") || nome.includes("codex") || nome.includes("openai")) return "chatgpt";
  if (nome.includes("gemini") || nome.includes("google")) return "gemini";
  if (nome.includes("deepseek")) return "deepseek";
  return "outra";
}

let contador = 0;

/** O símbolo em SVG, no tamanho pedido (px). */
export function selo(tipo: TipoIA, tamanho = 16, letra = "?"): string {
  const abrir = `<svg class="selo-ia" width="${tamanho}" height="${tamanho}" viewBox="0 0 24 24" aria-hidden="true">`;
  switch (tipo) {
    case "claude": {
      // Estrela de raios, laranja.
      const raios = Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4;
        return `<line x1="12" y1="12" x2="${(12 + 10 * Math.cos(a)).toFixed(1)}" y2="${(12 + 10 * Math.sin(a)).toFixed(1)}"/>`;
      }).join("");
      return `${abrir}<g stroke="#D97757" stroke-width="3.2" stroke-linecap="round">${raios}</g></svg>`;
    }
    case "chatgpt":
      // Três elipses entrelaçadas, branco.
      return `${abrir}<g fill="none" stroke="#F2F4F6" stroke-width="2">${[0, 60, 120]
        .map((g) => `<ellipse cx="12" cy="12" rx="9.5" ry="4.5" transform="rotate(${g} 12 12)"/>`)
        .join("")}</g></svg>`;
    case "gemini": {
      // Estrela de quatro pontas, azul para lilás.
      const id = `g${++contador}`;
      return `${abrir}<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4C8DFF"/><stop offset="1" stop-color="#B78CFF"/></linearGradient></defs><path fill="url(#${id})" d="M12 1c.8 5.8 5.2 10.2 11 11-5.8.8-10.2 5.2-11 11-.8-5.8-5.2-10.2-11-11C6.8 11.2 11.2 6.8 12 1z"/></svg>`;
    }
    case "deepseek":
      // Baleia, azul da DeepSeek.
      return `${abrir}<path fill="#4D6BFE" d="M2.5 12.5C3 8.5 8 7 12.5 8c3 .6 5.1 2.2 6.3 3.6l3-4.2c.8 1.4 1 3.2-.2 5 1.3.5 1.8 1.6 1.6 2.6-1.6-.4-2.8-.7-4-.4-1.8 3.4-5.7 5-9.7 4.4-4.3-.6-7.3-3.2-7-6.5z"/><circle cx="7" cy="12" r="1" fill="#fff"/><path d="M5 15.2c2.6 1.3 6 1.4 8.6.2" fill="none" stroke="#fff" stroke-width="1" stroke-linecap="round" opacity=".7"/></svg>`;
    default:
      return `${abrir}<circle cx="12" cy="12" r="11" fill="var(--ciano)"/><text x="12" y="16.5" text-anchor="middle" font-size="13" font-weight="700" fill="#0b0d10" font-family="Segoe UI, sans-serif">${letra}</text></svg>`;
  }
}

/** Símbolo de uma redefinição (a letra do nome entra quando é "outra"). */
export function seloDa(r: Pick<Redefinicao, "nome" | "ia">, tamanho = 16): string {
  return selo(tipoDa(r), tamanho, (r.nome.trim().charAt(0) || "?").toUpperCase().replace(/[<>&]/g, ""));
}

/** Selo de cada motor da conversa (o Antigravity é do Google, como o Gemini). */
export const SELO_MOTOR: Record<"deepseek" | "claude" | "codex" | "gemini" | "antigravity", TipoIA> = {
  deepseek: "deepseek",
  claude: "claude",
  codex: "chatgpt",
  gemini: "gemini",
  antigravity: "gemini",
};
