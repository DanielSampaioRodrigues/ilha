// Pedir música pelo nome: "toca Djavan", "coloca Oceano no Spotify".
// YouTube e YouTube Music: abre o primeiro resultado já tocando.
// Spotify e Deezer: abre a busca (sem conta de desenvolvedor não dá para dar play).
import { invoke } from "@tauri-apps/api/core";
import { ler } from "../dados/armazem";
import { abrirPrograma, listarProgramas } from "./sistema";
import { dentroDoApp } from "../ponte";

export type OndeTocar = "youtube-music" | "youtube" | "spotify" | "deezer";

export const NOMES_ONDE: Record<OndeTocar, string> = {
  "youtube-music": "YouTube Music",
  youtube: "YouTube",
  spotify: "Spotify",
  deezer: "Deezer",
};

/** Onde tocar: o escolhido nos Ajustes; senão o Spotify se estiver instalado; senão YouTube Music. */
export async function ondeTocar(): Promise<OndeTocar> {
  const escolhido = ler().config.musicaOnde;
  if (escolhido) return escolhido;
  const programas = await listarProgramas().catch(() => []);
  return programas.some((p) => p.nome.toLowerCase().includes("spotify")) ? "spotify" : "youtube-music";
}

/** Reconhece o serviço dito na frase ("no spotify"). */
export function servicoDito(texto: string): OndeTocar | null {
  if (/youtube music/.test(texto)) return "youtube-music";
  if (/youtube/.test(texto)) return "youtube";
  if (/spotify/.test(texto)) return "spotify";
  if (/deezer/.test(texto)) return "deezer";
  return null;
}

/** Toca (ou busca) e devolve a frase para a ilha responder. */
export async function tocarMusica(busca: string, onde?: OndeTocar): Promise<string> {
  const lugar = onde ?? (await ondeTocar());
  const q = encodeURIComponent(busca);
  if (lugar === "spotify") {
    await abrirPrograma(`spotify:search:${q}`).catch(() => abrirPrograma(`https://open.spotify.com/search/${q}`));
    return `Abri “${busca}” no Spotify. É só tocar o primeiro.`;
  }
  if (lugar === "deezer") {
    await abrirPrograma(`https://www.deezer.com/search/${q}`);
    return `Abri “${busca}” no Deezer.`;
  }
  const id = dentroDoApp ? await invoke<string | null>("primeiro_video", { busca }).catch(() => null) : null;
  const base = lugar === "youtube" ? "https://www.youtube.com" : "https://music.youtube.com";
  if (id) {
    await abrirPrograma(`${base}/watch?v=${id}`);
    return `Tocando “${busca}” no ${NOMES_ONDE[lugar]}.`;
  }
  await abrirPrograma(lugar === "youtube" ? `${base}/results?search_query=${q}` : `${base}/search?q=${q}`);
  return `Abri a busca de “${busca}” no ${NOMES_ONDE[lugar]}.`;
}
