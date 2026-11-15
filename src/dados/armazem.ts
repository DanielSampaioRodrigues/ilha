// Onde a ilha guarda o que o Dan cadastra: assinaturas, lembretes, apps,
// notas e ajustes. Fica num arquivo "dados.json" na pasta do app no PC
// (%APPDATA%\com.danielsampaio.ilha). Nada disso vai para a internet.
import { load, type Store } from "@tauri-apps/plugin-store";
import { dentroDoApp } from "../ponte";

export interface Assinatura {
  id: string;
  nome: string;
  valor: string;
  /** Dia do vencimento (1 a 31; em meses curtos vira o último dia). */
  dia: number;
  frequencia: "mensal" | "anual";
  /** Mês do vencimento (1 a 12), só para assinaturas anuais. */
  mes: number;
  /** Quantos dias antes começa o aviso laranja. */
  antecedencia: number;
  /** Vencimento (AAAA-MM-DD) já marcado como pago. */
  pagoAte: string | null;
}

/** Quando o limite de uma IA (ou outra coisa) volta/renova. */
export interface Redefinicao {
  id: string;
  nome: string;
  /** Próxima redefinição: AAAA-MM-DDTHH:MM, no horário do PC. */
  proxima: string;
  repete: "nao" | "diario" | "semanal" | "mensal";
  /** Quantos dias antes o robô mostra o sinal (0 = sem sinal). */
  avisarDias: number;
  /** Qual IA (para o símbolo). "auto" = descobre pelo nome. */
  ia?: "auto" | "claude" | "chatgpt" | "gemini" | "deepseek" | "outra";
}

export type ModoDiscreto = "desligado" | "automatico" | "sempre";

/** Versão antiga (até a 0.1.8): lembretes de uma vez só. */
interface LembreteAntigo {
  id: string;
  titulo: string;
  quando: string;
}

export interface AppLancador {
  id: string;
  nome: string;
  /** Caminho do programa/atalho no PC ou endereço de site (https://…). */
  caminho: string;
  cor: string;
}

export interface Nota {
  id: string;
  texto: string;
}

export interface Config {
  nome: string;
  /** Cor dos botões e destaques. */
  corDestaque: string;
  /** Ilha vira um risquinho em repouso (sempre, ou com navegador na frente). */
  modoDiscreto: ModoDiscreto;
  /** Já trocou os sites padrão pelos programas instalados com o mesmo nome. */
  appsConferidos: boolean;
  /** Atalho escolhido em Ajustes (null = o padrão). */
  atalho: string | null;
  focoMinutos: number;
  pausaMinutos: number;
}

export interface Dados {
  assinaturas: Assinatura[];
  redefinicoes: Redefinicao[];
  apps: AppLancador[];
  notas: Nota[];
  notaAtual: string | null;
  config: Config;
}

export const CORES = ["#D97757", "#E9ECEF", "#7BA7FF", "#B78CFF", "#FF5A8A", "#5C8BFF", "#5BE38F", "#FFD84D"];

export function novoId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function padrao(): Dados {
  return {
    assinaturas: [],
    redefinicoes: [],
    apps: [
      { id: novoId(), nome: "Claude", caminho: "https://claude.ai", cor: "#D97757" },
      { id: novoId(), nome: "ChatGPT", caminho: "https://chatgpt.com", cor: "#E9ECEF" },
      { id: novoId(), nome: "Gemini", caminho: "https://gemini.google.com", cor: "#7BA7FF" },
      { id: novoId(), nome: "DeepSeek", caminho: "https://chat.deepseek.com", cor: "#5C8BFF" },
    ],
    notas: [{ id: novoId(), texto: "" }],
    notaAtual: null,
    config: {
      nome: "Dan",
      corDestaque: "#3FE6EE",
      modoDiscreto: "desligado",
      appsConferidos: false,
      atalho: null,
      focoMinutos: 25,
      pausaMinutos: 5,
    },
  };
}

/** Junta o que foi salvo com o padrão (para versões novas com campos novos). */
function completar(salvo: (Partial<Dados> & { lembretes?: LembreteAntigo[] }) | null | undefined): Dados {
  const base = padrao();
  if (!salvo) return base;
  const { lembretes, ...resto } = salvo;
  // Lembretes antigos viram redefinições que não se repetem.
  const convertidos: Redefinicao[] = (lembretes ?? []).map((l) => ({
    id: l.id,
    nome: l.titulo,
    proxima: l.quando,
    repete: "nao",
    avisarDias: 0,
  }));
  return {
    ...base,
    ...resto,
    redefinicoes: [...(resto.redefinicoes ?? []), ...convertidos],
    config: { ...base.config, ...(resto.config ?? {}) },
    notas: resto.notas?.length ? resto.notas : base.notas,
  };
}

const CHAVE = "dados";
let dados: Dados = padrao();
let loja: Store | null = null;
let relogio = 0;

export async function carregar(): Promise<void> {
  try {
    if (dentroDoApp) {
      loja = await load("dados.json", { defaults: {}, autoSave: false });
      dados = completar(await loja.get<Dados>(CHAVE));
    } else {
      dados = completar(JSON.parse(localStorage.getItem("ilha-dados") ?? "null"));
    }
  } catch (erro) {
    console.error("Não consegui ler os dados salvos", erro);
    dados = padrao();
  }
}

export function ler(): Dados {
  return dados;
}

/** Muda os dados e salva logo em seguida (salvamento automático). */
export function mudar(fazer: (d: Dados) => void): void {
  fazer(dados);
  window.clearTimeout(relogio);
  relogio = window.setTimeout(salvar, 400);
}

async function salvar(): Promise<void> {
  try {
    if (loja) {
      await loja.set(CHAVE, dados);
      await loja.save();
    } else {
      localStorage.setItem("ilha-dados", JSON.stringify(dados));
    }
  } catch (erro) {
    console.error("Não consegui salvar", erro);
  }
}
