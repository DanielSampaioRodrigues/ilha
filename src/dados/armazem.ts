// Onde a ilha guarda o que o Dan cadastra: assinaturas, lembretes, apps,
// notas e ajustes. Fica num arquivo "dados.json" na pasta do app no PC
// (%APPDATA%\com.danielsampaio.ilha). Nada disso vai para a internet.
import { emit, listen } from "@tauri-apps/api/event";
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

export interface Subtarefa {
  id: string;
  texto: string;
  feita: boolean;
}

export interface Tarefa {
  id: string;
  texto: string;
  /** 0 = normal, 1 a 3 = importante (!, !!, !!!). */
  prioridade: number;
  /** Data (AAAA-MM-DD) ou data e hora (AAAA-MM-DDTHH:MM), opcional. */
  quando: string | null;
  feita: boolean;
  subtarefas: Subtarefa[];
}

export interface Habito {
  id: string;
  nome: string;
  /** Quantas vezes por dia (ex.: 8 copos de água). */
  meta: number;
  /** Quantas vezes em cada dia (AAAA-MM-DD → número). */
  registros: Record<string, number>;
}

export interface TextoRapido {
  id: string;
  nome: string;
  texto: string;
}

export interface Timer {
  id: string;
  nome: string;
  /** Quando termina (milissegundos desde 1970). */
  fim: number;
  minutos: number;
}

export interface Nota {
  id: string;
  texto: string;
}

export interface Config {
  nome: string;
  /** Aparência do personagem. */
  corOlhos: string;
  corBochechas: string;
  acessorio: "nenhum" | "chapeu" | "coroa" | "laco" | "oculos" | "fones" | "antena";
  /** Na ilha aberta: a cabeça do robô vermelho ou a carinha de pixel grande. */
  cabecaAberta: "robo" | "carinha";
  olhosSeguemMouse: boolean;
  /** Brincadeiras quando parado (pegar uma mosquinha…). */
  brincadeiras: boolean;
  /** Cochilar quando o mouse fica parado por 5 minutos. */
  cochilar: boolean;
  /** Nome do robô: é a palavra que vai chamá-lo quando a voz chegar (fase 3). */
  nomeRobo: string;
  /** Cor dos botões e destaques. */
  corDestaque: string;
  /** Ilha vira um risquinho em repouso (sempre, ou com navegador na frente). */
  modoDiscreto: ModoDiscreto;
  /** Mostrar a música que está tocando na ilha fechada. */
  musicaNaIlha: boolean;
  /** Esconder a ilha em jogos, vídeos e apresentações em tela cheia. */
  esconderTelaCheia: boolean;
  /** Lembrar de fazer uma pausa a cada X minutos (0 = não lembrar). */
  pausaACada: number;
  /** Já trocou os sites padrão pelos programas instalados com o mesmo nome. */
  appsConferidos: boolean;
  /** Atalho escolhido em Ajustes (null = o padrão). */
  atalho: string | null;
  focoMinutos: number;
  pausaMinutos: number;
}

export interface Projeto {
  id: string;
  nome: string;
  /** Pasta onde os motores trabalham. */
  pasta: string;
  /** Instruções próprias, iguais para todos os motores. */
  instrucoes: string;
}

export interface Dados {
  assinaturas: Assinatura[];
  redefinicoes: Redefinicao[];
  apps: AppLancador[];
  notas: Nota[];
  notaAtual: string | null;
  tarefas: Tarefa[];
  habitos: Habito[];
  textos: TextoRapido[];
  timers: Timer[];
  projetos: Projeto[];
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
    tarefas: [],
    habitos: [
      { id: novoId(), nome: "Água (copos)", meta: 8, registros: {} },
      { id: novoId(), nome: "Leitura", meta: 1, registros: {} },
      { id: novoId(), nome: "Exercício", meta: 1, registros: {} },
    ],
    textos: [],
    timers: [],
    projetos: [],
    config: {
      nome: "Dan",
      corOlhos: "#3FE6EE",
      corBochechas: "#FF8FB4",
      acessorio: "nenhum",
      cabecaAberta: "robo",
      olhosSeguemMouse: true,
      brincadeiras: true,
      cochilar: true,
      nomeRobo: "Robozinho",
      corDestaque: "#3FE6EE",
      modoDiscreto: "desligado",
      musicaNaIlha: true,
      esconderTelaCheia: true,
      pausaACada: 0,
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
let pendente = false;

// Várias janelas (ilha, Central) usam os mesmos dados: quem muda avisa as outras.
const ORIGEM = Math.random().toString(36).slice(2);
const ouvintes = new Set<() => void>();

/** Chamado quando outra janela mudou os dados. */
export function aoMudarDeFora(fazer: () => void): void {
  ouvintes.add(fazer);
}

export async function carregar(): Promise<void> {
  try {
    if (dentroDoApp) {
      loja = await load("dados.json", { defaults: {}, autoSave: false });
      dados = completar(await loja.get<Dados>(CHAVE));
      await listen<{ origem: string; dados: Dados }>("dados:mudaram", (e) => {
        if (e.payload.origem === ORIGEM) return;
        dados = completar(e.payload.dados);
        ouvintes.forEach((f) => f());
      });
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
  pendente = true;
  window.clearTimeout(relogio);
  relogio = window.setTimeout(salvar, 400);
}

// Se a ilha for fechada logo depois de uma mudança, salva na hora.
window.addEventListener("pagehide", () => {
  if (!pendente) return;
  window.clearTimeout(relogio);
  void salvar();
});

async function salvar(): Promise<void> {
  pendente = false;
  try {
    if (loja) {
      await loja.set(CHAVE, dados);
      await loja.save();
      await emit("dados:mudaram", { origem: ORIGEM, dados });
    } else {
      localStorage.setItem("ilha-dados", JSON.stringify(dados));
    }
  } catch (erro) {
    console.error("Não consegui salvar", erro);
  }
}
