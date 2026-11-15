// Ponte entre a interface e o lado Rust (Tauri).
// Fora do app (no navegador, para testes) as chamadas são simplesmente ignoradas.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const dentroDoApp = "__TAURI_INTERNALS__" in window;

export interface Retangulo {
  x: number;
  y: number;
  largura: number;
  altura: number;
  /** Raio dos cantos de baixo. */
  raio: number;
}

/** Diz ao Rust onde a ilha está, para só essa parte receber cliques. */
export function informarArea(area: Retangulo): void {
  if (!dentroDoApp) return;
  invoke("definir_area", { area }).catch(() => {});
}

export function ouvir<T>(evento: string, fazer: (dados: T) => void): void {
  if (!dentroDoApp) return;
  listen<T>(evento, (e) => fazer(e.payload)).catch(() => {});
}

/** Chamado quando o Dan clica fora da ilha (a janela perde o foco). */
export function aoPerderFoco(fazer: () => void): void {
  if (!dentroDoApp) return;
  getCurrentWindow()
    .onFocusChanged(({ payload: focada }) => {
      if (!focada) fazer();
    })
    .catch(() => {});
}
