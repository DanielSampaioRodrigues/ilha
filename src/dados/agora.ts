// O que está acontecendo agora, para as pílulas da tela inicial: o tempo na
// cidade do Dan e o próximo compromisso do Calendário da Apple de hoje.
// Guardado por alguns minutos, para não buscar de novo a cada vez que a
// ilha abre.
import { invoke } from "@tauri-apps/api/core";
import { ler } from "./armazem";
import { dataDoIcs, utc } from "../corpo/acoes-da-ia";
import { icloudEventos } from "../maos/sistema";
import { dentroDoApp } from "../ponte";

export interface Tempo {
  cidade: string;
  temperatura: number;
  codigo: number;
  dia: boolean;
}

export interface Compromisso {
  titulo: string;
  quando: Date;
  diaInteiro: boolean;
  local: string;
}

const guardado = new Map<string, { ate: number; valor: unknown }>();

async function comCache<T>(chave: string, minutos: number, buscar: () => Promise<T>): Promise<T> {
  const g = guardado.get(chave);
  if (g && g.ate > Date.now()) return g.valor as T;
  const valor = await buscar();
  guardado.set(chave, { ate: Date.now() + minutos * 60_000, valor });
  return valor;
}

export function tempoAgora(): Promise<Tempo | null> {
  const cidade = ler().config.cidade?.trim();
  if (!cidade) return Promise.resolve(null);
  if (!dentroDoApp) return Promise.resolve({ cidade, temperatura: 29, codigo: 2, dia: true });
  return comCache(`tempo:${cidade}`, 20, () => invoke<Tempo | null>("tempo_agora", { cidade }).catch(() => null));
}

/** O próximo compromisso de hoje (que ainda não acabou de começar há mais de 15 min). */
export function proximoCompromisso(): Promise<Compromisso | null> {
  const email = ler().config.icloudEmail;
  if (!email) return Promise.resolve(null);
  return comCache(`agenda:${email}`, 10, async () => {
    const agora = new Date();
    const fimDoDia = new Date(agora);
    fimDoDia.setHours(23, 59, 59, 0);
    const eventos = await icloudEventos(email, utc(new Date(agora.getTime() - 15 * 60_000)), utc(fimDoDia)).catch(() => []);
    const lidos = eventos
      .map((e) => ({ e, d: dataDoIcs(e.inicio) }))
      .filter((x): x is { e: (typeof eventos)[number]; d: { quando: Date; diaInteiro: boolean } } => !!x.d)
      .filter((x) => !x.d.diaInteiro)
      .sort((a, b) => a.d.quando.getTime() - b.d.quando.getTime());
    const p = lidos[0];
    return p ? { titulo: p.e.titulo || "Compromisso", quando: p.d.quando, diaInteiro: false, local: p.e.local } : null;
  });
}

/** Desenho e nome do tempo a partir do código WMO. */
export function jeitoDoTempo(codigo: number, dia: boolean): { nome: string; icone: string } {
  const svg = (c: string) =>
    `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${c}</svg>`;
  const sol = svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>');
  const lua = svg('<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>');
  const nuvem = svg('<path d="M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 18z"/>');
  const chuva = svg('<path d="M7 15h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 15z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>');
  const raio = svg('<path d="M7 14h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 14z"/><path d="m12 15-2 4h4l-2 4"/>');
  if (codigo === 0) return { nome: dia ? "Céu limpo" : "Noite limpa", icone: dia ? sol : lua };
  if (codigo <= 3) return { nome: codigo === 3 ? "Nublado" : "Algumas nuvens", icone: codigo === 3 ? nuvem : dia ? sol : lua };
  if (codigo === 45 || codigo === 48) return { nome: "Neblina", icone: nuvem };
  if (codigo >= 95) return { nome: "Trovoada", icone: raio };
  if (codigo >= 51 && codigo <= 82) return { nome: codigo <= 57 ? "Garoa" : codigo >= 80 ? "Pancadas de chuva" : "Chuva", icone: chuva };
  return { nome: "Nublado", icone: nuvem };
}
