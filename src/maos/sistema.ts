// Pedidos ao lado Rust e aos plugins do Tauri. Fora do app (navegador de
// teste) tudo responde com valores neutros.
import { Channel, invoke } from "@tauri-apps/api/core";
import { enquanto, segurarPor } from "./foco";
import { open } from "@tauri-apps/plugin-dialog";
import * as inicioAutomatico from "@tauri-apps/plugin-autostart";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { dentroDoApp } from "../ponte";

export interface Midia {
  titulo: string;
  artista: string;
  tocando: boolean;
  capa: string | null;
}

export interface AvisoExterno {
  titulo: string;
  detalhe: string;
}

async function pedir<T>(comando: string, dados?: Record<string, unknown>, foraDoApp?: T): Promise<T> {
  if (!dentroDoApp) return foraDoApp as T;
  return invoke<T>(comando, dados);
}

export const abrirPrograma = (caminho: string) => pedir<void>("abrir_programa", { caminho });
export const abrirRegistros = () => pedir<void>("abrir_registros");
export const midiaAtual = (comCapa: boolean) => pedir<Midia | null>("midia_atual", { comCapa }, null);
export const midiaComando = (acao: "alternar" | "proxima" | "anterior") => pedir<void>("midia_comando", { acao });
export const definirAtalho = (atalho: string) => pedir<string>("definir_atalho", { atalho }, atalho);
export const atalhoAtual = () => pedir<string | null>("atalho_atual", undefined, "Super+Alt+I");
export const avisoPendente = () => pedir<AvisoExterno | null>("aviso_pendente", undefined, null);
export interface ProgramaInstalado {
  nome: string;
  caminho: string;
}

export type ProgramaIA = "claude" | "codex" | "gemini";

export interface SituacaoAviso {
  programa: ProgramaIA;
  encontrado: boolean;
  ligado: boolean;
}

export interface JanelaAtiva {
  programa: string;
  noTopo: boolean;
}

/** Liga a observação do programa em primeiro plano (só no modo discreto automático). */
export const vigiarJanelas = (ligar: boolean) => pedir<void>("vigiar_janelas", { ligar });

/** Programas com abas no topo, onde a ilha atrapalharia. */
export const PROGRAMAS_COM_ABAS: Record<string, string> = {
  "chrome.exe": "Chrome",
  "msedge.exe": "Edge",
  "opera.exe": "Opera",
  "firefox.exe": "Firefox",
  "brave.exe": "Brave",
  "vivaldi.exe": "Vivaldi",
  "arc.exe": "Arc",
  "zen.exe": "Zen",
  "explorer.exe": "Explorador de Arquivos",
  "windowsterminal.exe": "Terminal",
  "code.exe": "VS Code",
  "cursor.exe": "Cursor",
};

export const listarProgramas = () => pedir<ProgramaInstalado[]>("listar_programas", undefined, []);
export const situacaoAvisos = () =>
  pedir<SituacaoAviso[]>("situacao_avisos", undefined, [
    { programa: "claude", encontrado: true, ligado: true },
    { programa: "codex", encontrado: true, ligado: false },
    { programa: "gemini", encontrado: false, ligado: false },
  ]);
export const mudarAviso = (programa: ProgramaIA, ligar: boolean) => pedir<void>("mudar_aviso", { programa, ligar });

export async function iniciaComWindows(): Promise<boolean> {
  return dentroDoApp ? inicioAutomatico.isEnabled() : false;
}

export async function definirInicioComWindows(ligar: boolean): Promise<void> {
  if (!dentroDoApp) return;
  if (ligar) await inicioAutomatico.enable();
  else await inicioAutomatico.disable();
}

/** Janela do Windows para escolher um programa. Devolve o caminho ou null. */
export async function escolherPrograma(): Promise<string | null> {
  if (!dentroDoApp) return null;
  const escolhido = await enquanto(open({
    title: "Escolha um programa ou atalho",
    multiple: false,
    directory: false,
    filters: [{ name: "Programas e atalhos", extensions: ["exe", "lnk", "url", "bat", "cmd", "appref-ms"] }],
  }));
  return typeof escolhido === "string" ? escolhido : null;
}

/** "Super+Alt+I" → "Win + Alt + I" */
export function atalhoLegivel(atalho: string | null): string {
  if (!atalho) return "nenhum";
  return atalho
    .split("+")
    .map((p) => ({ Super: "Win", Space: "Espaço", Ctrl: "Ctrl", Shift: "Shift", Alt: "Alt" })[p] ?? p)
    .join(" + ");
}

export interface Volume {
  nivel: number;
  mudo: boolean;
}

export const volumeAtual = () => pedir<Volume | null>("volume_atual", undefined, { nivel: 40, mudo: false });
export const definirVolume = (nivel?: number, mudo?: boolean) => pedir<void>("definir_volume", { nivel, mudo });
export const esconderEmTelaCheia = (ligar: boolean) => pedir<void>("esconder_em_tela_cheia", { ligar });

export interface Diagnostico {
  processador: number;
  memoria_usada_gb: number;
  memoria_total_gb: number;
  disco_livre_gb: number;
  disco_total_gb: number;
  ligado_horas: number;
  temporarios_mb: number;
  pesados: { nome: string; memoria_mb: number }[];
}

export const diagnosticoPc = () =>
  pedir<Diagnostico | null>("diagnostico_pc", undefined, {
    processador: 23,
    memoria_usada_gb: 11.2,
    memoria_total_gb: 16,
    disco_livre_gb: 48,
    disco_total_gb: 476,
    ligado_horas: 81,
    temporarios_mb: 1840,
    pesados: [
      { nome: "chrome", memoria_mb: 3120 },
      { nome: "InDesign", memoria_mb: 1450 },
      { nome: "Claude", memoria_mb: 610 },
    ],
  });
export const limparTemporarios = () => pedir<number>("limpar_temporarios", undefined, 0);

/** Copia um texto para a área de transferência. */
export async function copiar(texto: string): Promise<void> {
  if (dentroDoApp) await writeText(texto);
  else await navigator.clipboard.writeText(texto);
}

// ---------- Chaves de IA (ficam no cofre do Windows; a interface nunca lê a chave) ----------

export const salvarChave = (provedor: string, chave: string) => pedir<void>("salvar_chave", { provedor, chave });
export const temChave = (provedor: string) => pedir<boolean>("tem_chave", { provedor }, false);
export const apagarChave = (provedor: string) => pedir<void>("apagar_chave", { provedor });
export const testarDeepseek = () => pedir<string>("testar_deepseek", undefined, "Funcionando! (teste)");

// ---------- Tradução da tela ----------

export interface LinhaLida {
  texto: string;
  x: number;
  y: number;
  largura: number;
  altura: number;
}

export interface Captura {
  imagem: string;
  largura: number;
  altura: number;
  linhas: LinhaLida[];
}

export const traduzirTela = () => pedir<void>("traduzir_tela");
export const capturaAtual = () => pedir<Captura | null>("captura_atual", undefined, null);
export const traduzirLinhas = (linhas: string[]) => pedir<string[]>("traduzir_linhas", { linhas }, linhas.map((l) => `[pt] ${l}`));
export const fecharTraducao = () => pedir<void>("fechar_traducao");

// ---------- Histórico das traduções ----------

export interface ItemTraducao {
  id: string;
  /** Segundos desde 1970. */
  data: string;
  programa: string;
  original: string;
  traducao: string;
}

export const salvarTraducao = (original: string, traducao: string, recorte: [number, number, number, number]) =>
  pedir<void>("salvar_traducao", { original, traducao, recorte });
export const listarTraducoes = () =>
  pedir<ItemTraducao[]>("listar_traducoes", undefined, [
    {
      id: "1",
      data: String(Math.floor(Date.now() / 1000) - 3600),
      programa: "chrome.exe",
      original: "Usage limits reset every Tuesday at 6:32 PM.",
      traducao: "Os limites de uso são redefinidos toda terça às 18:32.",
    },
    {
      id: "2",
      data: String(Math.floor(Date.now() / 1000) - 86400 * 2),
      programa: "InDesign.exe",
      original: "Package\nCollects all fonts and linked graphics.",
      traducao: "Empacotar\nReúne todas as fontes e imagens vinculadas.",
    },
  ]);
export const imagemTraducao = (id: string) => pedir<string | null>("imagem_traducao", { id }, null);
export const apagarTraducao = (id: string) => pedir<void>("apagar_traducao", { id });

/** "chrome.exe" → "Chrome"; desconhecido: o nome sem ".exe". */
export function nomeDoPrograma(exe: string): string {
  if (!exe) return "";
  return PROGRAMAS_COM_ABAS[exe.toLowerCase()] ?? exe.replace(/\.exe$/i, "");
}

// ---------- Central e conversa ----------

export type Motor = "deepseek" | "claude" | "codex" | "gemini" | "antigravity";

export const NOMES_MOTORES: Record<Motor, string> = {
  deepseek: "DeepSeek",
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
  antigravity: "Antigravity",
};

export type EventoMotor =
  | { tipo: "sessao"; id: string }
  | { tipo: "texto"; texto: string }
  | { tipo: "pensamento"; texto: string }
  | { tipo: "ferramenta"; nome: string; detalhe: string }
  | { tipo: "fim"; erro: string | null; custo: number | null };

export interface PedidoConversa {
  conversaId: string;
  motor: Motor;
  mensagens: { papel: string; texto: string }[];
  prompt: string;
  sessao: string | null;
  pasta: string | null;
  modo: "conversar" | "editar";
  sistema: string;
  anexos: string[];
  /** "" = o padrão do programa. */
  modelo: string;
  esforco: string;
  /** Servidores MCP da ilha ligados nesta conversa. */
  mcps: { nome: string; tipo: string; comando: string; argumentos: string[]; url: string; segredos: string[] }[];
  /** Nomes de todos os MCPs da ilha (para deixar de fora os não escolhidos). */
  mcpsDaIlha: string[];
}

export const abrirCentral = (tela?: string, anexos?: string[], conversa?: unknown) =>
  pedir<void>("abrir_central", { tela: tela ?? null, anexos: anexos ?? null, conversa: conversa ?? null });
export const telaInicialCentral = () =>
  pedir<{ tela: string | null; anexos: string[]; conversa: unknown }>("tela_inicial_central", undefined, {
    tela: null,
    anexos: [],
    conversa: null,
  });
export const motoresDisponiveis = () =>
  pedir<{ motor: Motor; encontrado: boolean }[]>("motores_disponiveis", undefined, [
    { motor: "deepseek", encontrado: true },
    { motor: "claude", encontrado: true },
    { motor: "codex", encontrado: true },
    { motor: "gemini", encontrado: false },
    { motor: "antigravity", encontrado: true },
  ]);
/** Modelos que o programa/API informa (Antigravity e DeepSeek). */
export const listarModelos = (motor: Motor) =>
  pedir<string[]>("listar_modelos", { motor }, motor === "antigravity" ? ["gemini-3.8-flash-medium", "gemini-4-hydrogen-high"] : []);
/** Abre a digitação por voz do Windows (Win + H) na caixa com o cursor. */
export const ditado = () => {
  // O painel de ditado do Windows pode tirar o foco por um tempo.
  segurarPor(15000);
  return pedir<void>("ditado");
};
/** Esconde a ilha grande (ela continua viva por trás, terminando conversas). */
export const esconderCentral = () => pedir<void>("esconder_central");
/** Liga/desliga a carinha perceber o que o Dan faz (digitação, programa na frente). */
export const perceberAtividade = (ligar: boolean) => pedir<void>("perceber_atividade", { ligar });
/** Central como janela comum (true) ou como ilha grande (false). */
export const modoJanelaCentral = (janela: boolean) => pedir<void>("modo_central", { janela });

/** Janela do Windows para escolher arquivos para anexar. */
export async function escolherArquivos(): Promise<string[]> {
  if (!dentroDoApp) return [];
  const escolhidos = await enquanto(open({ title: "Anexar arquivos", multiple: true, directory: false }));
  return Array.isArray(escolhidos) ? escolhidos : typeof escolhidos === "string" ? [escolhidos] : [];
}

export const pararConversa = (conversaId: string) => pedir<void>("parar_conversa", { conversaId });
export const abrirNoTerminal = (motor: Motor, sessao: string | null, pasta: string | null) =>
  pedir<void>("abrir_no_terminal", { motor, sessao, pasta });

/** Conversa com um motor; a resposta chega aos poucos em "aoEvento". */
export async function conversar(pedido: PedidoConversa, aoEvento: (e: EventoMotor) => void): Promise<void> {
  if (!dentroDoApp) {
    // Navegador de teste: finge uma resposta escrevendo aos poucos.
    aoEvento({ tipo: "sessao", id: "teste-123" });
    if (pedido.esforco && pedido.esforco !== "none") aoEvento({ tipo: "pensamento", texto: "Pensando em como responder de um jeito curto e claro…" });
    if (pedido.motor !== "deepseek") aoEvento({ tipo: "ferramenta", nome: "Read", detalhe: "PLANO.md" });
    const resposta = `Resposta de teste do **${NOMES_MOTORES[pedido.motor]}** para: “${pedido.prompt.slice(0, 60)}”.\n\n- primeiro ponto\n- segundo ponto\n\n\`\`\`\nexemplo de código\n\`\`\``;
    for (const pedaco of resposta.match(/.{1,12}/gs) ?? []) {
      await new Promise((r) => setTimeout(r, 40));
      aoEvento({ tipo: "texto", texto: pedaco });
    }
    aoEvento({ tipo: "fim", erro: null, custo: null });
    return;
  }
  const canal = new Channel<EventoMotor>();
  canal.onmessage = aoEvento;
  await invoke("conversar", { pedido, canal });
}

// ---------- Chaves dos MCPs (cofre do Windows) ----------

export const salvarSegredoMcp = (servidor: string, nome: string, valor: string) =>
  pedir<void>("salvar_segredo_mcp", { servidor, nome, valor });
export const temSegredoMcp = (servidor: string, nome: string) =>
  pedir<boolean>("tem_segredo_mcp", { servidor, nome }, false);
