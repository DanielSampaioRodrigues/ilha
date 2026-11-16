// Modelos e níveis de raciocínio de cada motor, com os nomes que a
// documentação oficial de cada um aceita (conferido em novembro de 2026).
// "" = deixar o programa escolher (o padrão dele).
//
// - Claude Code: apelidos "opus", "sonnet"… sempre apontam para a versão mais
//   nova da família, então nunca ficam velhos. Raciocínio: "--effort"
//   (a ilha passa pela variável CLAUDE_CODE_EFFORT_LEVEL).
// - Codex: não tem apelido "mais novo"; os nomes são os da família atual.
//   Raciocínio: model_reasoning_effort.
// - Gemini CLI: apelidos auto/pro/flash/flash-lite. Desde 18/06/2026 só
//   funciona com chave paga da API do Gemini (não com o login do Google AI Pro).
// - Antigravity CLI: a lista vem do próprio programa ("agy models").
// - DeepSeek: "deepseek-chat"/"deepseek-reasoner" foram desligados em
//   24/07/2026; os atuais vêm da API. Pensa antes de responder por padrão.
import type { Motor } from "../maos/sistema";

export interface Opcao {
  valor: string;
  nome: string;
}

const PADRAO: Opcao = { valor: "", nome: "Padrão do programa" };

export const MODELOS: Record<Motor, Opcao[]> = {
  claude: [
    PADRAO,
    { valor: "opus", nome: "Opus (o mais novo)" },
    { valor: "sonnet", nome: "Sonnet (o mais novo)" },
    { valor: "haiku", nome: "Haiku (o mais novo, rápido)" },
    { valor: "fable", nome: "Fable (o mais novo)" },
    { valor: "opusplan", nome: "Opus para planejar, Sonnet para fazer" },
    { valor: "opus[1m]", nome: "Opus com memória de 1 milhão" },
    { valor: "sonnet[1m]", nome: "Sonnet com memória de 1 milhão" },
  ],
  codex: [
    PADRAO,
    { valor: "gpt-6-astra", nome: "GPT-6 Astra (o mais capaz)" },
    { valor: "gpt-6.1-sol", nome: "GPT-6.1 Sol (quase o Astra, mais barato)" },
    { valor: "gpt-6.1-terra", nome: "GPT-6.1 Terra (rápido e eficiente)" },
    { valor: "gpt-6-luna", nome: "GPT-6 Luna (o mais econômico)" },
  ],
  gemini: [
    PADRAO,
    { valor: "auto", nome: "Automático" },
    { valor: "pro", nome: "Pro (o mais capaz)" },
    { valor: "flash", nome: "Flash (rápido)" },
    { valor: "flash-lite", nome: "Flash-Lite (o mais leve)" },
  ],
  antigravity: [PADRAO],
  deepseek: [
    { valor: "", nome: "deepseek-flash (rápido, lê imagens)" },
    { valor: "deepseek-v4-pro", nome: "deepseek-v4-pro (o mais capaz)" },
  ],
};

export const ESFORCOS: Record<Motor, Opcao[]> = {
  claude: [
    PADRAO,
    { valor: "low", nome: "Baixo (rápido)" },
    { valor: "medium", nome: "Médio" },
    { valor: "high", nome: "Alto" },
    { valor: "xhigh", nome: "Muito alto" },
    { valor: "max", nome: "Máximo" },
  ],
  codex: [
    PADRAO,
    { valor: "low", nome: "Baixo (rápido)" },
    { valor: "medium", nome: "Médio" },
    { valor: "high", nome: "Alto" },
    { valor: "xhigh", nome: "Muito alto" },
    { valor: "max", nome: "Máximo" },
    { valor: "ultra", nome: "Ultra" },
  ],
  // O Gemini CLI não tem opção de raciocínio na linha de comando.
  gemini: [PADRAO],
  antigravity: [
    PADRAO,
    { valor: "low", nome: "Baixo (rápido)" },
    { valor: "medium", nome: "Médio" },
    { valor: "high", nome: "Alto" },
    { valor: "xhigh", nome: "Muito alto" },
    { valor: "max", nome: "Máximo" },
  ],
  deepseek: [
    { valor: "", nome: "Padrão (pensa antes)" },
    { valor: "none", nome: "Sem pensar (mais rápido)" },
    { valor: "low", nome: "Baixo" },
    { valor: "high", nome: "Alto" },
    { valor: "max", nome: "Máximo" },
  ],
};

/** Modelos que o programa/API informou (somados à lista acima). */
const extras: Partial<Record<Motor, string[]>> = {};

export function guardarModelosExtras(motor: Motor, lista: string[]): void {
  extras[motor] = lista;
}

/** Lista para mostrar: a da documentação + o que o programa informou + o atual. */
export function modelosDe(motor: Motor, atual = ""): Opcao[] {
  const lista = [...MODELOS[motor]];
  for (const m of [...(extras[motor] ?? []), atual]) {
    // "deepseek-flash" já é o padrão ("").
    if (motor === "deepseek" && m === "deepseek-flash") continue;
    if (m && !lista.some((o) => o.valor === m)) lista.push({ valor: m, nome: m });
  }
  return lista;
}

export function esforcosDe(motor: Motor, atual = ""): Opcao[] {
  const lista = [...ESFORCOS[motor]];
  if (atual && !lista.some((o) => o.valor === atual)) lista.push({ valor: atual, nome: atual });
  return lista;
}

export const nomeDoModelo = (motor: Motor, valor: string) =>
  modelosDe(motor, valor).find((o) => o.valor === valor)?.nome ?? valor;
export const nomeDoEsforco = (motor: Motor, valor: string) =>
  esforcosDe(motor, valor).find((o) => o.valor === valor)?.nome ?? valor;
