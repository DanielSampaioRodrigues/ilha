// Quem executa as rotinas: passo a passo, juntando o que cada um responde.
import { ler, type Dados, type Rotina } from "../dados/armazem";
import { paraISO, pendentes, pertoDeRenovar, prazo } from "../dados/datas";
import { responder } from "../dados/pedido";
import { abrirPrograma, type Motor } from "../maos/sistema";
import { falar } from "../maos/fala";
import { normalizar, tentarComando } from "./comandos";
import type { Contexto } from "./contexto";

const espera = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

/** O resumo do dia: data, tarefas, contas que vencem e IAs que renovam. */
export function resumoDoDia(d: Dados = ler(), agora = new Date()): string {
  const hora = agora.getHours();
  const ola = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
  const partes = [`${ola}, ${d.config.nome}! Hoje é ${agora.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}.`];
  const hoje = paraISO(agora);
  const tarefas = d.tarefas.filter((t) => !t.feita && t.quando && t.quando.slice(0, 10) <= hoje);
  const importantes = d.tarefas.filter((t) => !t.feita && t.prioridade >= 2 && !tarefas.includes(t));
  const lista = [...tarefas, ...importantes].slice(0, 5);
  if (lista.length) partes.push(`Para hoje: ${lista.map((t) => t.texto).join("; ")}.`);
  else partes.push("Nenhuma tarefa marcada para hoje.");
  const contas = pendentes(d.assinaturas, agora);
  if (contas.length) partes.push(`Contas: ${contas.map((a) => `${a.nome} ${prazo(a.dias)}`).join("; ")}.`);
  const renovam = d.redefinicoes.filter((r) => pertoDeRenovar(r, agora));
  if (renovam.length) partes.push(`Renovam em breve: ${renovam.map((r) => r.nome).join(", ")}.`);
  return partes.join(" ");
}

/** A rotina que essa frase dispara, se houver. */
export function rotinaDaFrase(texto: string, d: Dados = ler()): Rotina | undefined {
  const t = normalizar(texto);
  return d.rotinas.find((r) => r.frases.some((f) => normalizar(f) === t) || normalizar(r.nome) === t);
}

/** Pergunta rápida à IA da conversa rápida (resposta curta, sem guardar conversa). */
async function perguntarAIA(pergunta: string): Promise<string> {
  const d = ler();
  const [tipo, valor] = d.config.conversaRapida.split(":");
  const perfil = tipo === "perfil" ? d.perfis.find((p) => p.id === valor) : undefined;
  const motor = (perfil?.motor ?? (tipo === "motor" ? valor : "deepseek")) as Motor;
  const c = {
    id: `rotina-${Date.now()}`,
    titulo: "Rotina",
    motor,
    sessao: null,
    projetoId: null,
    pasta: null,
    modo: "conversar" as const,
    perfilId: perfil?.id ?? null,
    modelo: perfil?.modelo ?? "",
    esforco: perfil?.esforco ?? "",
    mcps: perfil?.mcps ?? [],
    skills: perfil?.skills ?? [],
    mensagens: [],
    criada: Date.now(),
    atualizada: Date.now(),
  };
  const r = await responder(c, `${pergunta}\n\n(Responda curto, em até 3 frases.)`, [], () => {});
  return r.erro ? `Não consegui perguntar: ${r.erro}` : r.texto.trim();
}

/** Roda a rotina e devolve o que cada passo respondeu. */
export async function rodarRotina(r: Rotina, ctx: Contexto, aoPasso: (texto: string) => void = () => {}): Promise<string> {
  const saidas: string[] = [];
  for (const p of r.passos) {
    let saida = "";
    try {
      switch (p.tipo) {
        case "resumo":
          saida = resumoDoDia();
          break;
        case "abrir":
          if (/^https?:\/\//i.test(p.valor.trim())) {
            await abrirPrograma(p.valor.trim());
            saida = "";
          } else {
            saida = (await tentarComando(`abre ${p.valor}`, ctx)) ?? `Não achei “${p.valor}”.`;
            if (/^Abrindo/.test(saida)) saida = "";
          }
          break;
        case "comando":
          saida = (await tentarComando(p.valor, ctx)) ?? `Não entendi o comando “${p.valor}”.`;
          break;
        case "falar":
          saida = p.valor;
          break;
        case "perguntar":
          saida = await perguntarAIA(p.valor);
          break;
        case "esperar":
          await espera(Math.min(600, Math.max(1, Number(p.valor) || 1)) * 1000);
          break;
      }
    } catch (e) {
      saida = `Um passo falhou: ${e}`;
    }
    if (saida) {
      saidas.push(saida);
      aoPasso(saida);
    }
  }
  const tudo = saidas.join("\n\n") || `Rotina “${r.nome}” feita.`;
  if (r.falar) falar(tudo);
  return tudo;
}

/** Rotinas com horário que devem rodar agora (e ainda não rodaram hoje). */
export function rotinasDaHora(d: Dados = ler(), agora = new Date()): Rotina[] {
  const hhmm = `${String(agora.getHours()).padStart(2, "0")}:${String(agora.getMinutes()).padStart(2, "0")}`;
  const hoje = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}-${String(agora.getDate()).padStart(2, "0")}`;
  return d.rotinas.filter(
    (r) => r.horario && r.horario <= hhmm && r.ultimaVez !== hoje && (!r.dias.length || r.dias.includes(agora.getDay())) && hhmmMais(r.horario, 30) > hhmm,
  );
}

/** "HH:MM" mais n minutos (para rodar só perto do horário, não horas depois). */
function hhmmMais(h: string, n: number): string {
  const [a, b] = h.split(":").map(Number);
  const total = Math.min(23 * 60 + 59, a * 60 + b + n);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Modelos prontos para começar. */
export const MODELOS_DE_ROTINA: Omit<Rotina, "id">[] = [
  {
    nome: "Bom dia",
    frases: ["bom dia", "começar o dia"],
    horario: "",
    dias: [],
    falar: true,
    passos: [{ tipo: "resumo", valor: "" }],
  },
  {
    nome: "Hora do foco",
    frases: ["hora do foco", "vamos trabalhar"],
    horario: "",
    dias: [],
    falar: false,
    passos: [
      { tipo: "comando", valor: "volume 20" },
      { tipo: "comando", valor: "pausa a música" },
      { tipo: "comando", valor: "foco 50" },
    ],
  },
  {
    nome: "Fim do dia",
    frases: ["fim do dia", "boa noite"],
    horario: "",
    dias: [1, 2, 3, 4, 5],
    falar: true,
    passos: [
      { tipo: "resumo", valor: "" },
      { tipo: "falar", valor: "Bom descanso! Amanhã a gente continua." },
    ],
  },
];
