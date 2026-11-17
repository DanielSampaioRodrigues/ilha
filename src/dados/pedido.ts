// Monta o pedido para uma IA a partir de uma conversa e roda a resposta.
// Usado pela Central e pela conversa rápida da ilha, para as duas falarem
// com as IAs do mesmo jeito (instruções, perfil, skills, memória, MCPs).
import { ler, type Dados } from "./armazem";
import type { Conversa, MensagemConversa } from "./conversas";
import { conversar, type Motor } from "../maos/sistema";

/** Motores que recebem os MCPs da ilha. */
export const USAM_MCP: Motor[] = ["claude", "codex", "gemini"];

/** Instruções de base para a DeepSeek (os programas já têm as deles). */
export function sistemaPara(c: Conversa, d: Dados = ler()): string {
  const cfg = d.config;
  const projeto = d.projetos.find((p) => p.id === c.projetoId);
  const hoje = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return [
    `Você é ${cfg.nomeRobo}, o assistente pessoal de ${cfg.nome}, que mora numa ilha no topo da tela do computador dele.`,
    "Responda em português do Brasil, de forma direta, calorosa e sem enrolação. Use listas curtas quando ajudar.",
    `Hoje é ${hoje}.`,
    projeto?.instrucoes ? `Instruções do projeto "${projeto.nome}":\n${projeto.instrucoes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** O que o Dan pediu para lembrar, em forma de instrução. */
export function textoDaMemoria(d: Dados = ler()): string {
  if (!d.config.usarMemoria || !d.memorias.length) return "";
  return `Coisas que ${d.config.nome} pediu para você lembrar sobre ele:\n${d.memorias.map((m) => `- ${m.texto}`).join("\n")}`;
}

/** Instruções do perfil, das skills ligadas e a memória (vão para todos os motores). */
export function instrucoesExtras(c: Conversa, d: Dados = ler()): string {
  const perfil = d.perfis.find((p) => p.id === c.perfilId);
  const skills = d.skills.filter((s) => c.skills?.includes(s.id));
  // Conversa rápida da ilha: quase sempre por voz. A IA só recebe texto e, sem
  // isso, responde "não escuto áudio" e manda listas compridas para ler em voz alta.
  const voz = c.id.startsWith("rapida-")
    ? `Esta é a conversa rápida da Ilha, um assistente no computador de ${d.config.nome}. Muitas vezes ${d.config.nome} fala pelo microfone: a Ilha transforma a fala em texto (pode vir com pequenos erros de transcrição; entenda pelo sentido) e lê a sua resposta em voz alta, com o nome "${d.config.nomeRobo}". Então, sim, você está ouvindo pela Ilha. Responda curto, natural e do jeito que se fala (duas ou três frases quando der), sem listas, tabelas, código ou formatação, a não ser que peçam.`
    : "";
  return [
    voz,
    perfil?.instrucoes ? `Instruções do perfil "${perfil.nome}":\n${perfil.instrucoes}` : "",
    ...skills.map((s) => `Skill "${s.nome}"${s.descricao ? ` (${s.descricao})` : ""}:\n${s.instrucoes}`),
    textoDaMemoria(d),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Acrescenta a mensagem e a resposta (vazia) à conversa e conversa com a IA.
 * `aoComecar` roda logo depois de acrescentar (para salvar e avisar a ilha);
 * `aoMudar` a cada pedaço da resposta.
 */
export async function responder(
  c: Conversa,
  texto: string,
  anexos: string[],
  aoMudar: () => void,
  aoComecar: () => void = () => {},
): Promise<MensagemConversa> {
  const primeira = c.mensagens.length === 0;
  c.mensagens.push({ papel: "voce", texto, quando: Date.now(), anexos: anexos.length ? anexos : undefined });
  if (!c.titulo) c.titulo = texto.replace(/\s+/g, " ").slice(0, 60);
  const resposta: MensagemConversa = { papel: "robo", texto: "", quando: Date.now(), ferramentas: [] };
  c.mensagens.push(resposta);
  c.atualizada = Date.now();
  aoComecar();
  aoMudar();

  const d = ler();
  // Para os programas, as instruções do projeto vão junto da primeira mensagem.
  const projeto = d.projetos.find((p) => p.id === c.projetoId);
  let prompt =
    primeira && projeto?.instrucoes && c.motor !== "deepseek"
      ? `Instruções do projeto "${projeto.nome}":\n${projeto.instrucoes}\n\n---\n\n${texto}`
      : texto;
  // Perfil, skills e memória: DeepSeek e Claude Code recebem como instrução de
  // sistema a cada mensagem; os outros, junto da mensagem quando mudam (a sessão lembra).
  const extras = instrucoesExtras(c, d);
  const sistema = c.motor === "deepseek" ? [sistemaPara(c, d), extras].filter(Boolean).join("\n\n") : c.motor === "claude" ? extras : "";
  if (c.motor !== "deepseek" && c.motor !== "claude" && extras !== (c.instrucoesEnviadas ?? "")) {
    prompt = extras ? `${extras}\n\n---\n\n${prompt}` : prompt;
    c.instrucoesEnviadas = extras;
  }
  const mcps = USAM_MCP.includes(c.motor)
    ? d.mcps
        .filter((m) => c.mcps?.includes(m.id))
        .map((m) => ({ nome: m.nome, tipo: m.tipo, comando: m.comando, argumentos: m.argumentos, url: m.url, segredos: m.segredos }))
    : [];

  try {
    await conversar(
      {
        conversaId: c.id,
        motor: c.motor,
        // A conversa até antes desta mensagem (a nova vai em "prompt", com os anexos).
        mensagens: c.mensagens.slice(0, -2).slice(-30).map((m) => ({ papel: m.papel, texto: m.texto })),
        prompt,
        sessao: c.sessao,
        pasta: c.pasta,
        modo: c.modo,
        sistema,
        anexos,
        modelo: c.modelo ?? "",
        esforco: c.esforco ?? "",
        mcps,
        mcpsDaIlha: d.mcps.map((m) => m.nome),
      },
      (e) => {
        if (e.tipo === "sessao") c.sessao = e.id;
        if (e.tipo === "texto") resposta.texto += e.texto;
        if (e.tipo === "pensamento") resposta.pensamento = (resposta.pensamento ?? "") + e.texto;
        if (e.tipo === "ferramenta") resposta.ferramentas!.push({ nome: e.nome, detalhe: e.detalhe });
        if (e.tipo === "fim") {
          resposta.erro = e.erro;
          if (e.custo) c.custo = (c.custo ?? 0) + e.custo;
        }
        aoMudar();
      },
    );
  } catch (erro) {
    resposta.erro = String(erro);
  }
  c.atualizada = Date.now();
  return resposta;
}
