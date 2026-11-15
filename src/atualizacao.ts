// Atualização da própria Ilha: procura uma versão nova nos "Releases" do GitHub,
// baixa, instala e reabre. Só instala quando o Dan clica em "Atualizar".
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { dentroDoApp } from "./ponte";

export interface Novidade {
  versao: string;
  /** Baixa e instala. `aoProgredir` recebe de 0 a 1. A Ilha fecha e reabre sozinha. */
  instalar(aoProgredir: (fracao: number) => void): Promise<void>;
}

export async function versaoAtual(): Promise<string> {
  if (!dentroDoApp) return "teste";
  return getVersion();
}

/** Devolve a versão nova, ou null se a Ilha já está atualizada. Pode dar erro sem internet. */
export async function procurar(): Promise<Novidade | null> {
  if (!dentroDoApp) return null;
  const atualizacao = await check();
  if (!atualizacao) return null;
  return {
    versao: atualizacao.version,
    async instalar(aoProgredir) {
      let total = 0;
      let baixado = 0;
      await atualizacao.downloadAndInstall((evento) => {
        if (evento.event === "Started") total = evento.data.contentLength ?? 0;
        if (evento.event === "Progress") {
          baixado += evento.data.chunkLength;
          if (total > 0) aoProgredir(Math.min(1, baixado / total));
        }
      });
      // No Windows o instalador já fecha a Ilha; isto cobre os outros casos.
      await relaunch();
    },
  };
}
