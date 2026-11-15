// Contas de datas: vencimento das assinaturas e textos como "em 3 dias".
import type { Assinatura, Redefinicao } from "./armazem";

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

export function quandoEscrito(d: Date, agora = new Date()): string {
  const dias = diasAte(d, agora);
  const dia = dias === 0 ? "hoje" : dias === 1 ? "amanhã" : diaEscrito(d);
  return `${dia}, às ${horaEscrita(d)}`;
}

/** Soma um período (dia, semana ou mês) a uma data. */
function somarPeriodo(d: Date, repete: Redefinicao["repete"]): Date {
  const n = new Date(d);
  if (repete === "diario") n.setDate(n.getDate() + 1);
  if (repete === "semanal") n.setDate(n.getDate() + 7);
  if (repete === "mensal") n.setMonth(n.getMonth() + 1);
  return n;
}

function paraDataHora(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${paraISO(d)}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Passou a hora de uma redefinição? Devolve a próxima data (ou null se ela
 * não se repete e deve sair da lista). Se ainda não passou, devolve a mesma.
 */
export function avancar(r: Redefinicao, agora = new Date()): string | null {
  let d = new Date(r.proxima);
  if (d > agora) return r.proxima;
  if (r.repete === "nao") return null;
  for (let i = 0; i < 1000 && d <= agora; i++) d = somarPeriodo(d, r.repete);
  return paraDataHora(d);
}

/** Está perto de renovar (dentro dos dias escolhidos)? */
export function pertoDeRenovar(r: Redefinicao, agora = new Date()): boolean {
  if (r.avisarDias <= 0) return false;
  const falta = new Date(r.proxima).getTime() - agora.getTime();
  return falta > 0 && falta <= r.avisarDias * DIA;
}

export function faltaEscrito(d: Date, agora = new Date()): string {
  const min = Math.round((d.getTime() - agora.getTime()) / 60000);
  if (min <= 0) return "agora";
  if (min < 60) return `em ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `em ${h} h`;
  const dias = diasAte(d, agora);
  return dias === 1 ? "amanhã" : `em ${dias} dias`;
}

export const REPETE: Record<Redefinicao["repete"], string> = {
  nao: "uma vez",
  diario: "todo dia",
  semanal: "toda semana",
  mensal: "todo mês",
};

/** "R$ 21,90" → 21.9 (null se não der para ler). */
export function valorEmNumero(texto: string): number | null {
  const limpo = texto.replace(/[^\d,.-]/g, "");
  if (!limpo) return null;
  const normal = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

export function haQuanto(d: Date, agora = new Date()): string {
  const min = Math.round((agora.getTime() - d.getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  return diaEscrito(d);
}
