// Contas de datas: vencimento das assinaturas e textos como "em 3 dias".
import type { Assinatura, Lembrete } from "./armazem";

const DIA = 24 * 60 * 60 * 1000;
const SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
export const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function inicioDoDia(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dataNoMes(ano: number, mes: number, dia: number): Date {
  const ultimo = new Date(ano, mes + 1, 0).getDate();
  return new Date(ano, mes, Math.min(dia, ultimo));
}

export function paraISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function deISO(texto: string): Date {
  const [a, m, d] = texto.split("-").map(Number);
  return new Date(a, m - 1, d);
}

/** Primeiro vencimento ainda não pago. */
export function vencimento(a: Assinatura, hoje = new Date()): Date {
  const desde = a.pagoAte ? new Date(deISO(a.pagoAte).getTime() + DIA) : inicioDoDia(hoje);
  let ano = desde.getFullYear();
  let mes = a.frequencia === "anual" ? a.mes - 1 : desde.getMonth();
  for (let i = 0; i < 400; i++) {
    const candidato = dataNoMes(ano, mes, a.dia);
    if (candidato >= desde) return candidato;
    if (a.frequencia === "anual") ano++;
    else if (++mes > 11) {
      mes = 0;
      ano++;
    }
  }
  return desde;
}

export function diasAte(data: Date, hoje = new Date()): number {
  return Math.round((inicioDoDia(data).getTime() - inicioDoDia(hoje).getTime()) / DIA);
}

export interface Situacao {
  vence: Date;
  dias: number;
  pendente: boolean;
}

export function situacao(a: Assinatura, hoje = new Date()): Situacao {
  const vence = vencimento(a, hoje);
  const dias = diasAte(vence, hoje);
  return { vence, dias, pendente: dias <= a.antecedencia };
}

/** Assinaturas que precisam de atenção, da mais urgente para a menos. */
export function pendentes(lista: Assinatura[], hoje = new Date()): (Assinatura & Situacao)[] {
  return lista
    .map((a) => ({ ...a, ...situacao(a, hoje) }))
    .filter((a) => a.pendente)
    .sort((x, y) => x.dias - y.dias);
}

export function prazo(dias: number): string {
  if (dias < -1) return `atrasada há ${-dias} dias`;
  if (dias === -1) return "venceu ontem";
  if (dias === 0) return "vence hoje";
  if (dias === 1) return "amanhã";
  return `em ${dias} dias`;
}

export function diaEscrito(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${SEMANA[d.getDay()]}, ${p(d.getDate())}/${p(d.getMonth() + 1)}`;
}

export function horaEscrita(d: Date): string {
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function quandoLembrete(l: Lembrete, agora = new Date()): string {
  const d = new Date(l.quando);
  const dias = diasAte(d, agora);
  const dia = dias === 0 ? "hoje" : dias === 1 ? "amanhã" : diaEscrito(d);
  return `${dia}, às ${horaEscrita(d)}`;
}

export function haQuanto(d: Date, agora = new Date()): string {
  const min = Math.round((agora.getTime() - d.getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  return diaEscrito(d);
}
