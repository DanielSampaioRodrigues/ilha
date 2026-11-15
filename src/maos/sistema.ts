// Pedidos ao lado Rust e aos plugins do Tauri. Fora do app (navegador de
// teste) tudo responde com valores neutros.
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import * as inicioAutomatico from "@tauri-apps/plugin-autostart";
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
export const avisoClaudeLigado = () => pedir<boolean>("aviso_claude_ligado", undefined, false);
export const ligarAvisoClaude = () => pedir<void>("ligar_aviso_claude");

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
