// A agenda do Dan, seja ela da Apple (iCloud) ou do Google: um lugar só para
// ler compromissos e gravar os eventos da ilha. Quem usa a agenda (painel
// Hoje, pílula, IA, envio das assinaturas/tarefas) passa por aqui.
import { ler, type Dados } from "./armazem";
import { googleEnviar, googleEventos, icloudEnviar, icloudEventos, type EventoCalendario, type EventoLido } from "../maos/sistema";

export type ProvedorAgenda = "icloud" | "google";

export const provedorAgenda = (d: Dados = ler()): ProvedorAgenda => d.config.agenda ?? "icloud";

export const nomeDaAgenda = (d: Dados = ler()) => (provedorAgenda(d) === "google" ? "Google Agenda" : "Calendário da Apple");

/** Tem uma conta conectada (dá para ler)? */
export const agendaConectada = (d: Dados = ler()) => (provedorAgenda(d) === "google" ? !!d.config.googleEmail : !!d.config.icloudEmail);

/** A agenda escolhida para gravar ("" = ainda não escolheu). */
export function agendaEscolhida(d: Dados = ler()): { id: string; nome: string } {
  return provedorAgenda(d) === "google"
    ? { id: d.config.googleCalendario ?? "", nome: d.config.googleNomeCalendario ?? "" }
    : { id: d.config.icloudCalendario, nome: d.config.icloudNomeCalendario };
}

/** Uma "assinatura" da conta + agenda: se mudar no meio de um envio, o envio não é anotado. */
export const chaveDaAgenda = (d: Dados = ler()) =>
  `${provedorAgenda(d)}|${provedorAgenda(d) === "google" ? d.config.googleEmail : d.config.icloudEmail}|${agendaEscolhida(d).id}`;

/** Compromissos entre inicio e fim (UTC, "AAAAMMDDTHHMMSSZ"). */
export function lerEventos(inicio: string, fim: string): Promise<EventoLido[]> {
  const d = ler();
  if (!agendaConectada(d)) return Promise.resolve([]);
  return provedorAgenda(d) === "google" ? googleEventos(inicio, fim) : icloudEventos(d.config.icloudEmail, inicio, fim);
}

/** Grava e apaga eventos da ilha na agenda escolhida; devolve os uids que deram certo. */
export function gravarEventos(eventos: EventoCalendario[], apagar: string[]): Promise<string[]> {
  const d = ler();
  const { id } = agendaEscolhida(d);
  if (!agendaConectada(d) || !id) return Promise.reject(new Error(`Escolha a agenda em Ajustes › Calendário.`));
  if (provedorAgenda(d) === "google") {
    const fuso = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";
    return googleEnviar(id, eventos, apagar, fuso);
  }
  return icloudEnviar(d.config.icloudEmail, id, eventos, apagar);
}
