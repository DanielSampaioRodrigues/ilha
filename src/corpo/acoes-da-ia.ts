// O que as IAs (Claude Code, Codex) podem pedir à própria ilha pelas
// ferramentas "ilha_…" (servidor MCP da ilha, em permissao.rs). A ilha faz e
// devolve um texto curto com o resultado, que a IA usa na resposta.
import { invoke } from "@tauri-apps/api/core";
import { ler, mudar, novoId, type Dados } from "../dados/armazem";
import { diagnosticoPc, icloudEnviar, icloudEventos, limparTemporarios, type EventoLido } from "../maos/sistema";
import { normalizar, tentarComando } from "./comandos";
import type { Contexto, NomeTela } from "./contexto";
import { dicas } from "./telas/pc";
import { paraISO } from "../dados/datas";

export interface AcaoPedida {
  id: string;
  conversa: string;
  acao: string;
  entrada: Record<string, unknown>;
}

const TELAS_LIVRES: NomeTela[] = [
  "inicio", "tarefas", "notas", "habitos", "timers", "foco", "pc", "memoria", "rotinas",
  "calendario", "copiados", "textos", "apps", "tabela", "traducoes", "ajustes",
] as NomeTela[];

const n1 = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
// Dia local (os hábitos são anotados no dia daqui, não no de Londres).
const hoje = () => paraISO(new Date());

function lista(titulo: string, itens: string[]): string {
  return itens.length ? `${titulo}:\n${itens.map((i) => `- ${i}`).join("\n")}` : `${titulo}: nenhum(a).`;
}

function lerDados(oQue: string, d: Dados): string {
  switch (oQue) {
    case "tarefas":
      return lista(
        "Tarefas",
        d.tarefas.map(
          (t) =>
            `${t.feita ? "[feita] " : ""}${t.texto}${t.prioridade ? ` (${"!".repeat(t.prioridade)})` : ""}${t.quando ? ` — ${t.quando}` : ""}` +
            (t.subtarefas.length ? ` (subtarefas: ${t.subtarefas.map((s) => `${s.feita ? "✓ " : ""}${s.texto}`).join("; ")})` : ""),
        ),
      );
    case "notas":
      return lista("Notas", d.notas.filter((n) => n.texto.trim()).map((n) => n.texto.trim().slice(0, 2000)));
    case "habitos":
      return lista("Hábitos (hoje)", d.habitos.map((h) => `${h.nome}: ${h.registros[hoje()] ?? 0} de ${h.meta}`));
    case "assinaturas":
      return lista(
        "Assinaturas",
        d.assinaturas.map(
          (a) => `${a.nome}: ${a.valor}, ${a.frequencia === "anual" ? `anual, dia ${a.dia}/${a.mes}` : `todo dia ${a.dia}`}${a.pagoAte ? `, paga até ${a.pagoAte}` : ""}`,
        ),
      );
    case "memoria":
      return lista("Memória", d.memorias.map((m) => m.texto));
    case "rotinas":
      return lista(
        "Rotinas",
        d.rotinas.map((r) => `${r.nome}${r.frases.length ? ` (frases: ${r.frases.join(", ")})` : ""}${r.horario ? `, sozinha às ${r.horario}` : ""}`),
      );
    case "timers":
      return lista(
        "Timers ligados",
        d.timers.filter((t) => t.fim > Date.now()).map((t) => `${t.nome}: faltam ${Math.ceil((t.fim - Date.now()) / 60000)} min`),
      );
    case "textos":
      // Só os nomes: textos rápidos podem ter senhas e chaves.
      return lista("Textos rápidos (nomes; use ilha_fazer \"copia <nome>\" para copiar)", d.textos.map((t) => t.nome));
    case "apps":
      return lista("Apps do lançador", d.apps.map((a) => a.nome));
    default:
      return `Não conheço "${oQue}".`;
  }
}

async function verificarPc(): Promise<string> {
  const d = await diagnosticoPc();
  if (!d) return "Não consegui ler o estado do PC agora.";
  const pesados = d.pesados.slice(0, 5).map((p) => `${p.nome} (${n1(p.memoria_mb / 1024)} GB)`).join(", ");
  return [
    `Processador: ${Math.round(d.processador)}% em uso.`,
    `Memória: ${n1(d.memoria_usada_gb)} de ${n1(d.memoria_total_gb)} GB em uso.`,
    `Disco: ${n1(d.disco_livre_gb)} GB livres de ${n1(d.disco_total_gb)} GB.`,
    `Arquivos temporários: ${n1(d.temporarios_mb / 1024)} GB.`,
    `Ligado há ${Math.round(d.ligado_horas)} horas.`,
    pesados ? `Mais pesados: ${pesados}.` : "",
    `Dicas: ${dicas(d).join(" ")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------- Agenda (Calendário da Apple) ----------

/** Data local "AAAA-MM-DD" → começo do dia em UTC no formato do CalDAV. */
export function utc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** "20261118T170000Z" | "20261118T170000" | "20261118" → Date local (e se é dia inteiro). */
export function dataDoIcs(t: string): { quando: Date; diaInteiro: boolean } | null {
  const m = t.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, a, me, di, h, mi, s, z] = m;
  if (!h) return { quando: new Date(+a, +me - 1, +di), diaInteiro: true };
  const quando = z ? new Date(Date.UTC(+a, +me - 1, +di, +h, +mi, +s)) : new Date(+a, +me - 1, +di, +h, +mi, +s);
  return { quando, diaInteiro: false };
}

function linhaDoEvento(e: EventoLido): string {
  const ini = dataDoIcs(e.inicio);
  if (!ini) return e.titulo;
  const dia = ini.quando.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
  const hora = (d: Date) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const fim = dataDoIcs(e.fim);
  const horario = ini.diaInteiro ? "dia inteiro" : fim && !fim.diaInteiro ? `${hora(ini.quando)}–${hora(fim.quando)}` : hora(ini.quando);
  return `${dia} ${horario}: ${e.titulo || "(sem título)"}${e.local ? ` (${e.local})` : ""} [${e.calendario}]`;
}

async function lerAgenda(de?: string, ate?: string): Promise<string> {
  const email = ler().config.icloudEmail;
  if (!email) return "O Calendário da Apple não está conectado na ilha (Ajustes › Calendário da Apple).";
  const dia = (t?: string) => (t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? new Date(`${t}T00:00:00`) : null);
  const inicio = dia(de) ?? new Date(new Date().setHours(0, 0, 0, 0));
  const ultimo = dia(ate) ?? new Date(inicio.getTime() + 7 * 86_400_000);
  // "até" inclui o dia inteiro; no máximo 62 dias de uma vez.
  const fim = new Date(Math.min(ultimo.getTime() + 86_400_000, inicio.getTime() + 62 * 86_400_000));
  const eventos = await icloudEventos(email, utc(inicio), utc(fim));
  const periodo = `${inicio.toLocaleDateString("pt-BR")} a ${new Date(fim.getTime() - 1).toLocaleDateString("pt-BR")}`;
  if (!eventos.length) return `Nenhum compromisso no Calendário da Apple de ${periodo}.`;
  return `Compromissos de ${periodo} (Calendário da Apple):\n${eventos.map((e) => `- ${linhaDoEvento(e)}`).join("\n")}`;
}

async function criarNaAgenda(e: Record<string, unknown>): Promise<string> {
  const { icloudEmail: email, icloudCalendario: calendario } = ler().config;
  if (!email) return "O Calendário da Apple não está conectado na ilha (Ajustes › Calendário da Apple).";
  if (!calendario) return "Falta escolher, em Ajustes › Calendário da Apple › Calendário, em qual agenda a ilha grava.";
  const titulo = String(e.titulo ?? "").trim();
  const inicio = String(e.inicio ?? "").trim();
  if (!titulo || !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(inicio)) return "Faltou o título ou a data (AAAA-MM-DD ou AAAA-MM-DDTHH:MM).";
  const diaInteiro = !inicio.includes("T");
  const alerta = typeof e.alerta_minutos === "number" ? e.alerta_minutos : diaInteiro ? -540 : 15;
  const feitos = await icloudEnviar(email, calendario, [
    {
      uid: `ilha-ia-${novoId()}`.replace(/[^A-Za-z0-9-]/g, ""),
      titulo,
      notas: String(e.notas ?? ""),
      inicio,
      repete: "nao",
      alertaMinutos: alerta,
      duracaoMinutos: typeof e.duracao_minutos === "number" ? e.duracao_minutos : 60,
    },
  ], []);
  return feitos.length ? `Criei no Calendário da Apple: "${titulo}" em ${inicio.replace("T", " às ")}.` : "Não consegui gravar no Calendário da Apple.";
}

export async function executarAcao(a: AcaoPedida, ctx: Contexto): Promise<string> {
  const e = a.entrada ?? {};
  const texto = String(e.texto ?? e.pedido ?? "").trim();
  switch (a.acao) {
    case "ilha_fazer": {
      if (!texto) return "Faltou o pedido.";
      const r = await tentarComando(texto, ctx);
      return r ?? `A ilha não reconheceu "${texto}". Use frases curtas como "volume 30", "timer 10 min pizza", "foco 25", "abre o spotify" ou a frase de uma rotina.`;
    }
    case "ilha_verificar_pc":
      return verificarPc();
    case "ilha_limpar_temporarios": {
      const mb = await limparTemporarios();
      return `Pronto: liberei ${n1(mb / 1024)} GB de arquivos temporários.`;
    }
    case "ilha_ler":
      return lerDados(String(e.o_que ?? ""), ler());
    case "ilha_anotar": {
      if (!texto) return "Faltou o texto.";
      const tipo = String(e.tipo ?? "");
      if (tipo === "tarefa") mudar((d) => d.tarefas.push({ id: novoId(), texto, prioridade: 0, quando: null, feita: false, subtarefas: [] }));
      else if (tipo === "nota") mudar((d) => d.notas.push({ id: novoId(), texto }));
      else if (tipo === "memoria") mudar((d) => d.memorias.push({ id: novoId(), texto, criada: Date.now() }));
      else return `Não sei guardar "${tipo}".`;
      ctx.renovar();
      return `Guardei ${tipo === "memoria" ? "na memória" : `a ${tipo}`}: "${texto}".`;
    }
    case "ilha_concluir_tarefa": {
      const alvo = normalizar(texto);
      if (!alvo) return "Faltou dizer qual tarefa.";
      const pendentes = ler().tarefas.filter((t) => !t.feita && normalizar(t.texto));
      const achada = pendentes.find((t) => normalizar(t.texto) === alvo) ?? pendentes.find((t) => normalizar(t.texto).includes(alvo) || alvo.includes(normalizar(t.texto)));
      if (!achada) return `Não achei tarefa pendente parecida com "${texto}".`;
      mudar((d) => {
        const t = d.tarefas.find((x) => x.id === achada.id);
        if (t) t.feita = true;
      });
      ctx.renovar();
      return `Marquei como feita: "${achada.texto}".`;
    }
    case "ilha_agenda":
      return lerAgenda(e.de as string | undefined, e.ate as string | undefined);
    case "ilha_agenda_criar":
      return criarNaAgenda(e);
    case "ilha_achar_pasta": {
      const { acharPasta, pastasConhecidas } = await import("../dados/pastas");
      const { melhor, outras } = await acharPasta(texto || String(e.nome ?? ""));
      const lista = [melhor, ...outras].filter(Boolean).map((p) => `- ${p!.caminho}${p === melhor ? " (a mais provável)" : ""}`);
      if (lista.length) return `Pastas achadas:\n${lista.join("\n")}`;
      const conhecidas = pastasConhecidas().map((p) => `- ${p.caminho}`);
      return `Não achei pasta com esse nome nos discos.${conhecidas.length ? ` Pastas que o Dan usa:\n${conhecidas.join("\n")}` : ""}`;
    }
    case "ilha_abrir_pasta": {
      const { acharPasta, abrirPasta } = await import("../dados/pastas");
      let caminho = String(e.caminho ?? "").trim();
      if (!caminho) {
        const { melhor } = await acharPasta(String(e.nome ?? texto));
        if (!melhor) return "Não achei essa pasta. Use ilha_achar_pasta para ver as parecidas.";
        caminho = melhor.caminho;
      }
      await abrirPasta(caminho);
      return `Abri no Explorador: ${caminho}`;
    }
    case "ilha_abrir_tela": {
      const tela = String(e.tela ?? "") as NomeTela;
      if (!TELAS_LIVRES.includes(tela)) return `Não conheço a tela "${tela}".`;
      ctx.irPara(tela);
      return `Abri a tela ${tela}.`;
    }
    default:
      return `Ação desconhecida: ${a.acao}.`;
  }
}

export function responderAcao(id: string, resultado: string): Promise<void> {
  return invoke("responder_acao", { id, resultado });
}
