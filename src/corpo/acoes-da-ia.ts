// O que as IAs (Claude Code, Codex) podem pedir à própria ilha pelas
// ferramentas "ilha_…" (servidor MCP da ilha, em permissao.rs). A ilha faz e
// devolve um texto curto com o resultado, que a IA usa na resposta.
import { invoke } from "@tauri-apps/api/core";
import { ler, mudar, novoId, type Dados } from "../dados/armazem";
import { diagnosticoPc, limparTemporarios } from "../maos/sistema";
import { normalizar, tentarComando } from "./comandos";
import type { Contexto, NomeTela } from "./contexto";
import { dicas } from "./telas/pc";

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
const hoje = () => new Date().toISOString().slice(0, 10);

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
      const pendentes = ler().tarefas.filter((t) => !t.feita);
      const achada = pendentes.find((t) => normalizar(t.texto) === alvo) ?? pendentes.find((t) => normalizar(t.texto).includes(alvo) || alvo.includes(normalizar(t.texto)));
      if (!achada) return `Não achei tarefa pendente parecida com "${texto}".`;
      mudar((d) => {
        const t = d.tarefas.find((x) => x.id === achada.id);
        if (t) t.feita = true;
      });
      ctx.renovar();
      return `Marquei como feita: "${achada.texto}".`;
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
