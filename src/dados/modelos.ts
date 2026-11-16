// Modelos e níveis de raciocínio de cada motor, com os nomes que a
// documentação oficial de cada um aceita (conferido em novembro de 2026).
// "" = deixar o programa escolher (o padrão dele).
//
// - Claude Code: apelidos "opus", "sonnet"… sempre apontam para a versão mais
//   nova da família, então nunca ficam velhos. Raciocínio: "--effort"
//   (a ilha passa pela variável CLAUDE_CODE_EFFORT_LEVEL).
// - Codex: não tem apelido "mais novo"; os nomes são os da família atual.
//   Raciocínio: model_reasoning_effort.
// - Gemini CLI: nomes da configuração oficial (geminicli.com, nov/2026).
//   Desde 18/06/2026 só funciona com chave paga da API do Gemini. O Gemini 4
//   não está no Gemini CLI (o Google manda usar o Antigravity para ele).
// - Antigravity CLI: a lista vem do próprio programa ("agy models"), que só
//   mostra o que a conta pode usar. A ilha junta as variações de esforço
//   (ex.: "-high") num modelo só e tira os que o Google está desligando.
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
    { valor: "auto", nome: "Automático (ele escolhe)" },
    { valor: "gemini-3.1-pro-preview", nome: "Gemini 3.1 Pro (o mais capaz)" },
    { valor: "gemini-3.8-flash", nome: "Gemini 3.8 Flash (rápido)" },
    { valor: "gemini-3.5-flash-lite", nome: "Gemini 3.5 Flash-Lite (o mais leve)" },
  ],
  // O resto vem do "agy models". O Orquestrador (Argon, plano Pro) divide o
  // trabalho entre vários agentes; tem configuração fixa (sem nível de raciocínio).
  antigravity: [PADRAO, { valor: "Orchestrator (Argon)", nome: "Orquestrador Argon (divide o trabalho entre agentes)" }],
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
  // Níveis da documentação do Antigravity ("Extra" é "xhigh"; só o Gemini 4 Hydrogen tem).
  antigravity: [
    PADRAO,
    { valor: "low", nome: "Baixo (rápido)" },
    { valor: "medium", nome: "Médio" },
    { valor: "high", nome: "Alto" },
    { valor: "xhigh", nome: "Extra (só no Gemini 4 Hydrogen)" },
  ],
  // Na conversa, a DeepSeek mostra duas escolhas: pensar ou não, e quanto.
  deepseek: [
    { valor: "", nome: "Pensa antes · alto" },
    { valor: "max", nome: "Pensa antes · máximo" },
    { valor: "none", nome: "Sem pensar (mais rápido)" },
  ],
};

/** Modelos que o programa/API informou (somados à lista acima). */
const extras: Partial<Record<Motor, string[]>> = {};

export function guardarModelosExtras(motor: Motor, lista: string[]): void {
  extras[motor] = motor === "antigravity" ? limparAntigravity(lista) : lista;
}

/** Modelos que o Google tira do Antigravity em 18/11/2026. */
const SAINDO = /^(claude-(sonnet|opus)-4[.-]6|gpt-oss-120b)/i;
const ESFORCO_NO_NOME = /-(low|medium|high|xhigh|extra|max|thinking)$/i;

/**
 * "agy models" lista o mesmo modelo várias vezes, um por nível de esforço
 * (ex.: gemini-3.8-flash-low, -high…). O nível já tem a escolha dele
 * ("Raciocínio"), então aqui fica um por modelo.
 */
export function limparAntigravity(lista: string[]): string[] {
  const unicos = [...new Set(lista)].filter((m) => !SAINDO.test(m));
  const grupos = new Map<string, string[]>();
  for (const m of unicos) {
    const base = m.replace(ESFORCO_NO_NOME, "");
    grupos.set(base, [...(grupos.get(base) ?? []), m]);
  }
  return [...grupos].map(([base, variacoes]) =>
    variacoes.includes(base) ? base : (variacoes.find((v) => /-high$/i.test(v)) ?? variacoes[0]),
  );
}

/** Nome bonito para um modelo do Antigravity (ex.: "claude-opus-5-5" → "Claude Opus 5.5"). */
export function nomeBonito(slug: string): string {
  const partes = slug.replace(ESFORCO_NO_NOME, "").split("-");
  const saida: string[] = [];
  for (const p of partes) {
    const anterior = saida[saida.length - 1];
    if (/^\d+(\.\d+)?$/.test(p) && anterior && /^\d+(\.\d+)?$/.test(anterior)) saida[saida.length - 1] = `${anterior}.${p}`;
    else saida.push(/^(gpt|oss)$/i.test(p) ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1));
  }
  const nome = saida.join(" ");
  const jeito: Record<string, string> = {
    carbon: " (o mais capaz · Ultra)",
    argon: " (muito capaz · Pro)",
    hydrogen: " (rápido)",
  };
  const chave = Object.keys(jeito).find((k) => slug.toLowerCase().includes(`gemini-4-${k}`));
  return nome + (chave ? jeito[chave] : "");
}

/** Lista para mostrar: a da documentação + o que o programa informou + o atual. */
export function modelosDe(motor: Motor, atual = ""): Opcao[] {
  const lista = [...MODELOS[motor]];
  for (const m of [...(extras[motor] ?? []), atual]) {
    // "deepseek-flash" já é o padrão ("").
    if (motor === "deepseek" && m === "deepseek-flash") continue;
    if (m && !lista.some((o) => o.valor === m)) lista.push({ valor: m, nome: motor === "antigravity" ? nomeBonito(m) : m });
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
