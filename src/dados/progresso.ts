// Progresso ao longo dos dias: sequência de dias seguidos de cada hábito e o
// tempo de foco por dia (para o gráfico da semana).
import { ler, mudar, type Habito } from "./armazem";
import { paraISO } from "./datas";

/** Os últimos n dias (AAAA-MM-DD), do mais antigo até hoje. */
export function ultimosDias(n: number, hoje = new Date()): string[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(hoje);
    d.setDate(d.getDate() - (n - 1 - i));
    return paraISO(d);
  });
}

const cumpriu = (h: Habito, dia: string) => (h.registros[dia] ?? 0) >= Math.max(1, h.meta);

/**
 * Dias seguidos cumprindo o hábito. Conta até hoje se hoje já foi cumprido;
 * senão, até ontem (o dia ainda não acabou: a sequência não "quebra" de manhã).
 */
export function sequencia(h: Habito, hoje = new Date()): number {
  const d = new Date(hoje);
  if (!cumpriu(h, paraISO(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (cumpriu(h, paraISO(d)) && n < 3650) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

/** Os últimos 7 dias do hábito: 1 = cumpriu, entre 0 e 1 = fez uma parte, 0 = nada. */
export function semanaDoHabito(h: Habito, hoje = new Date()): number[] {
  return ultimosDias(7, hoje).map((dia) => Math.min(1, (h.registros[dia] ?? 0) / Math.max(1, h.meta)));
}

/** Soma minutos de foco no dia de hoje (chamado quando um foco acaba ou é parado). */
export function registrarFoco(minutos: number, quando = new Date()): void {
  const m = Math.round(minutos);
  if (m < 1) return;
  const dia = paraISO(quando);
  mudar((d) => {
    const h = { ...(d.focoHistorico ?? {}) };
    h[dia] = (h[dia] ?? 0) + m;
    // Guarda só os últimos ~120 dias.
    const limite = ultimosDias(120, quando)[0];
    for (const k of Object.keys(h)) if (k < limite) delete h[k];
    d.focoHistorico = h;
  });
}

/** Minutos de foco de cada um dos últimos 7 dias. */
export function semanaDeFoco(hoje = new Date()): { dia: string; minutos: number }[] {
  const h = ler().focoHistorico ?? {};
  return ultimosDias(7, hoje).map((dia) => ({ dia, minutos: h[dia] ?? 0 }));
}

/** "1h20" ou "45 min". */
export function duracaoEscrita(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

/** Barrinhas da semana de foco (HTML), com a letra do dia embaixo; hoje em destaque. */
export function graficoFoco(hoje = new Date()): string {
  const semana = semanaDeFoco(hoje);
  const maior = Math.max(25, ...semana.map((s) => s.minutos));
  const letras = ["D", "S", "T", "Q", "Q", "S", "S"];
  return `<div class="grafico-foco" role="img" aria-label="Minutos de foco nos últimos 7 dias">${semana
    .map((s, i) => {
      const [a, m, d] = s.dia.split("-").map(Number);
      const letra = letras[new Date(a, m - 1, d).getDay()];
      const altura = s.minutos ? Math.max(8, Math.round((s.minutos / maior) * 100)) : 4;
      return `<span class="coluna-foco ${i === 6 ? "dia-atual" : ""}" title="${s.minutos ? duracaoEscrita(s.minutos) : "sem foco"}"><i style="height:${altura}%"></i><b>${letra}</b></span>`;
    })
    .join("")}</div>`;
}

/** "Hoje: 50 min · semana: 3h20". */
export function resumoFoco(hoje = new Date()): string {
  const semana = semanaDeFoco(hoje);
  const total = semana.reduce((n, s) => n + s.minutos, 0);
  const hojeMin = semana[6].minutos;
  return `Hoje: ${hojeMin ? duracaoEscrita(hojeMin) : "nada ainda"} · semana: ${total ? duracaoEscrita(total) : "0 min"}`;
}
