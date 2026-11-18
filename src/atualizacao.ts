// Atualização da própria Ilha: procura uma versão nova nos "Releases" do GitHub,
// baixa, confere a assinatura, instala e reabre. Só instala quando o Dan clica
// em "Atualizar".
//
// Caminho principal: o nosso (Rust, `procurar_versao`/`instalar_versao`), com
// tempo limite. O atualizador oficial do Tauri ficava "Procurando…" para
// sempre em alguns PCs; ele fica só de reserva, também com tempo limite.
import { Channel, invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { warn as registrarAviso } from "@tauri-apps/plugin-log";
import { dentroDoApp } from "./ponte";

export interface Novidade {
  versao: string;
  /** Baixa e instala. `aoProgredir` recebe de 0 a 1. A Ilha fecha e reabre sozinha. */
  instalar(aoProgredir: (fracao: number) => void): Promise<void>;
}

interface VersaoNova {
  versao: string;
  url: string;
  assinatura: string;
}

export async function versaoAtual(): Promise<string> {
  if (!dentroDoApp) return "teste";
  return getVersion();
}

function comLimite<T>(promessa: Promise<T>, ms: number, oQue: string): Promise<T> {
  return Promise.race([
    promessa,
    new Promise<T>((_, falhar) => window.setTimeout(() => falhar(new Error(`${oQue} demorou demais`)), ms)),
  ]);
}

async function peloCaminhoProprio(): Promise<Novidade | null> {
  const nova = await comLimite(invoke<VersaoNova | null>("procurar_versao"), 40_000, "procurar versão");
  if (!nova) return null;
  return {
    versao: nova.versao,
    async instalar(aoProgredir) {
      const andamento = new Channel<number>();
      andamento.onmessage = (p) => aoProgredir(p / 100);
      await invoke("instalar_versao", { versao: nova, andamento });
    },
  };
}

async function peloTauri(): Promise<Novidade | null> {
  const atualizacao = await comLimite(check({ timeout: 25_000 }), 30_000, "atualizador do Tauri");
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

/** Devolve a versão nova, ou null se a Ilha já está atualizada. Dá erro se nenhum caminho funcionar. */
export async function procurar(): Promise<Novidade | null> {
  if (!dentroDoApp) return null;
  try {
    return await peloCaminhoProprio();
  } catch (erro) {
    registrarAviso(`Atualização: caminho próprio falhou (${String(erro)}); tentando o do Tauri.`).catch(() => {});
    try {
      return await peloTauri();
    } catch (erro2) {
      registrarAviso(`Atualização: o do Tauri também falhou (${String(erro2)}).`).catch(() => {});
      throw erro2;
    }
  }
}
