// Pedidos ao lado Rust e aos plugins do Tauri. Fora do app (navegador de
// teste) tudo responde com valores neutros.
import { invoke } from "@tauri-apps/api/core";
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
  const escolhido = await open({
    title: "Escolha um programa ou atalho",
    multiple: false,
    directory: false,
    filters: [{ name: "Programas e atalhos", extensions: ["exe", "lnk", "url", "bat", "cmd", "appref-ms"] }],
  });
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
