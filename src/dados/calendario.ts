// O que vai para o Calendário da Apple: vencimentos das assinaturas,
// redefinições das IAs e tarefas com data — com alerta, para tocar no iPhone.
// Só manda o que mudou (cada evento tem uma "impressão digital") e apaga do
// calendário o que sumiu da ilha. Só mexe nos eventos criados pela ilha.
import { ler, mudar, type Dados } from "./armazem";
import { paraISO, vencimento } from "./datas";
import { icloudEnviar, type EventoCalendario } from "../maos/sistema";

const NOVE_DA_MANHA = 9 * 60;

/** Minutos antes do início (dia inteiro começa à meia-noite): "n dias antes, às 9h". */
const diasAntesAs9 = (dias: number) => dias * 1440 - NOVE_DA_MANHA;

export function eventosDesejados(d: Dados, hoje = new Date()): EventoCalendario[] {
  const itens = d.config.calendarioItens;
  const lista: EventoCalendario[] = [];
  if (itens.assinaturas) {
    for (const a of d.assinaturas) {
      lista.push({
        uid: `ilha-assinatura-${a.id}`.replace(/[^A-Za-z0-9-]/g, ""),
        titulo: `💳 ${a.nome} vence${a.valor ? ` (${a.valor})` : ""}`,
        notas: "Lembrete da Ilha. Quando pagar, marque “Paguei” na ilha.",
        inicio: paraISO(vencimento(a, hoje)),
        repete: a.frequencia === "anual" ? "anual" : "mensal",
        alertaMinutos: diasAntesAs9(a.antecedencia),
      });
    }
  }
  if (itens.redefinicoes) {
    for (const r of d.redefinicoes) {
      lista.push({
        uid: `ilha-redefinicao-${r.id}`.replace(/[^A-Za-z0-9-]/g, ""),
        titulo: `🔄 ${r.nome} renova`,
        notas: "O limite desta IA volta. Lembrete da Ilha.",
        inicio: r.proxima,
        repete: r.repete === "nao" ? "nao" : r.repete,
        alertaMinutos: r.proxima.includes("T") ? 0 : -NOVE_DA_MANHA,
      });
    }
  }
  if (itens.tarefas) {
    for (const t of d.tarefas.filter((x) => !x.feita && x.quando)) {
      lista.push({
        uid: `ilha-tarefa-${t.id}`.replace(/[^A-Za-z0-9-]/g, ""),
        titulo: `✅ ${t.texto}`,
        notas: t.subtarefas?.length ? t.subtarefas.map((s) => `${s.feita ? "✓" : "•"} ${s.texto}`).join("\n") : "",
        inicio: t.quando!,
        repete: "nao",
        alertaMinutos: t.quando!.includes("T") ? 0 : -NOVE_DA_MANHA,
      });
    }
  }
  return lista;
}

const impressao = (e: EventoCalendario) => JSON.stringify(e);

let ultimoErro = "";
let ultimaVez = 0;
let enviando = false;

export const situacaoCalendario = () => ({ ultimoErro, ultimaVez, enviando });

/** Manda para o iCloud o que mudou. Devolve quantos eventos foram mexidos. */
export async function sincronizarCalendario(): Promise<number> {
  const d = ler();
  const { icloudEmail: email, icloudCalendario: calendario } = d.config;
  if (!email || !calendario || enviando) return 0;
  const desejados = eventosDesejados(d);
  const enviados = d.config.calendarioEnviados;
  const mudados = desejados.filter((e) => enviados[e.uid] !== impressao(e));
  const apagar = Object.keys(enviados).filter((uid) => !desejados.some((e) => e.uid === uid));
  if (!mudados.length && !apagar.length) return 0;
  enviando = true;
  try {
    const feitos = new Set(await icloudEnviar(email, calendario, mudados, apagar));
    mudar((dd) => {
      const novo = { ...dd.config.calendarioEnviados };
      for (const e of mudados) if (feitos.has(e.uid)) novo[e.uid] = impressao(e);
      for (const uid of apagar) if (feitos.has(uid)) delete novo[uid];
      dd.config.calendarioEnviados = novo;
    });
    ultimoErro = feitos.size < mudados.length + apagar.length ? "Alguns eventos não foram gravados; tento de novo depois." : "";
    ultimaVez = Date.now();
    return feitos.size;
  } catch (e) {
    ultimoErro = String(e);
    return 0;
  } finally {
    enviando = false;
  }
}

/** Liga o envio automático (na janela da ilha): logo depois de ligar e a cada
 * minuto confere se algo mudou (só usa a internet quando mudou). */
export function sincronizarSempre(): void {
  window.setTimeout(() => void sincronizarCalendario(), 20_000);
  window.setInterval(() => void sincronizarCalendario(), 60_000);
}
