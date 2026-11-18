// Pedidos simples que a ilha resolve sozinha, sem IA: mais rápido e grátis.
// Ex.: "volume 30", "abre o spotify", "timer 10 min pizza", "foco 25",
// "pausa a música", "copia meu pix", "guarda que meu CPF é…".
// Se nada combinar, devolve null e a mensagem vai para a IA.
import { ler, mudar, novoId } from "../dados/armazem";
import {
  abrirPrograma,
  copiar,
  definirVolume,
  listarProgramas,
  midiaComando,
  passear,
  traduzirTela,
  volumeAtual,
} from "../maos/sistema";
import type { Contexto } from "./contexto";

/** Sem acentos, minúsculo e sem espaços sobrando (para comparar). */
export const normalizar = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Tira a educação e os enfeites da fala, para os comandos simples entenderem
 * "pode abrir o gemini pra mim, por favor?" como "abrir o gemini".
 */
export function semCortesia(t: string): string {
  let r = t.replace(/[,?!.]/g, " ").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3; i++)
    r = r
      .replace(/^(?:ei|oi|ola|entao|por favor|por gentileza|tipo|agora|so|e)\s+/, "")
      .replace(/^(?:(?:voce|vc|tu) )?(?:pode|poderia|podia|consegue|conseguiria|da pra|dava pra|quero que (?:voce|vc) |preciso que (?:voce|vc) |queria que (?:voce|vc) |vai la e )\s*(?:me )?/, "")
      .replace(/\s+(?:por favor|pra mim|para mim|pra gente|ai|agora|ja|rapidinho|por gentileza|obrigado|obrigada)$/, "")
      .trim();
  return r;
}

function minutosDe(numero: string, unidade = "min"): number {
  const n = Number(numero.replace(",", "."));
  if (/^h/.test(unidade)) return n * 60;
  if (/^s/.test(unidade)) return Math.max(1, Math.round(n / 60));
  return n;
}

const UNIDADE = "(min|minutos?|m|h|horas?|s|seg|segundos?)?";

/** Guarda na memória (sem IA). Devolve o texto guardado ou null. */
export function pedidoDeMemoria(texto: string): string | null {
  const m = texto.match(/^\s*(?:guarda|guarde|lembra|lembre|anota|anote|memoriza|memorize)(?:-se)?\s+(?:que\s+|isso:?\s*|ai:?\s*|aí:?\s*)?([\s\S]+)$/i);
  if (!m) return null;
  // "lembra em 10 min de…" é timer, não memória.
  if (/^(em|daqui)\s+\d/i.test(m[1].trim())) return null;
  return m[1].trim().replace(/\s+/g, " ");
}

export async function tentarComando(texto: string, ctx: Contexto): Promise<string | null> {
  const t = normalizar(texto);
  const d = ler();

  // Rotinas: a frase de uma rotina roda todos os passos dela.
  const { rotinaDaFrase, rodarRotina } = await import("./rotinas");
  const rotina = rotinaDaFrase(texto, d);
  if (rotina) return rodarRotina(rotina, ctx);

  // Lembrete com tempo: "me lembra em 10 min de tirar a pizza".
  let m = t.match(new RegExp(`^(?:me )?(?:avisa|lembra|lembre)(?: me)? (?:em|daqui a?) (\\d+(?:[.,]\\d+)?) ?${UNIDADE}(?: (?:de|para|pra|que) (.+))?$`));
  if (m) {
    const minutos = minutosDe(m[1], m[2]);
    const nome = (m[3] ?? "Lembrete").replace(/^./, (c) => c.toUpperCase());
    ctx.comecarTimer(nome, minutos);
    return `Combinado: aviso em ${minutos} min (${nome}).`;
  }

  // Memória.
  const memoria = pedidoDeMemoria(texto);
  if (memoria) {
    mudar((dd) => dd.memorias.push({ id: novoId(), texto: memoria, criada: Date.now() }));
    return `Guardei: “${memoria}”. Vou lembrar disso nas conversas.`;
  }
  if (/^(o que voce (lembra|sabe) de mim|minhas memorias|mostra (a|as) memorias?)$/.test(t)) {
    if (!d.memorias.length) return "Ainda não guardei nada. Diga, por exemplo: “guarda que meu aniversário é 3 de maio”.";
    return `O que eu lembro:\n${d.memorias.map((x) => `- ${x.texto}`).join("\n")}`;
  }

  // Volume.
  m = t.match(/^(?:volume|som)(?: (?:em|para|pra|no))? (\d{1,3}) ?%?$/);
  if (m) {
    const nivel = Math.min(100, Number(m[1]));
    await definirVolume(nivel, false);
    return `Volume em ${nivel}%.`;
  }
  if (/^(aumenta|sobe|aumentar|subir)( o)? (volume|som)$/.test(t) || /^(abaixa|diminui|baixa|abaixar|diminuir)( o)? (volume|som)$/.test(t)) {
    const v = await volumeAtual();
    const nivel = Math.max(0, Math.min(100, (v?.nivel ?? 50) + (/^(aumenta|sobe)/.test(t) ? 10 : -10)));
    await definirVolume(nivel, false);
    return `Volume em ${nivel}%.`;
  }
  if (/^(muta|mudo|silencia|silenciar|tira o som)$/.test(t)) {
    await definirVolume(undefined, true);
    return "Som desligado.";
  }
  if (/^(tira o mudo|desmuta|liga o som|volta o som)$/.test(t)) {
    await definirVolume(undefined, false);
    return "Som de volta.";
  }

  // Música.
  if (/^(pausa|pausar|para|parar)( a)? (musica|som)$|^(toca|tocar|continua|play)( a)?( musica)?$/.test(t)) {
    await midiaComando("alternar");
    return "Feito.";
  }
  if (/^(proxima|pula|pular|passa)( a)?( musica)?$/.test(t)) {
    await midiaComando("proxima");
    return "Próxima música.";
  }
  if (/^(anterior|volta a musica|musica anterior)$/.test(t)) {
    await midiaComando("anterior");
    return "Música anterior.";
  }

  // Timer: "timer 10 min pizza", "timer de 5 minutos".
  m = t.match(new RegExp(`^(?:timer|alarme|cronometro|temporizador)(?: de)? (\\d+(?:[.,]\\d+)?) ?${UNIDADE}(?: (?:para|pra|de|do|da) )?(.*)$`));
  if (m) {
    const minutos = minutosDe(m[1], m[2]);
    const nome = (m[3] || "Timer").replace(/^./, (c) => c.toUpperCase());
    ctx.comecarTimer(nome, minutos);
    return `Timer de ${minutos} min ligado (${nome}).`;
  }

  // Foco: "foco", "foco 50", "começa o foco".
  m = t.match(/^(?:modo foco|foco|comeca o foco|comecar foco|inicia o foco)(?: de)?(?: (\d+))?(?: ?min(?:utos)?)?$/);
  if (m) {
    const minutos = m[1] ? Number(m[1]) : d.config.focoMinutos;
    ctx.comecarFoco("foco", minutos);
    return `Foco de ${minutos} min. Bom trabalho!`;
  }

  // Traduzir a tela.
  if (/^tradu(z|zir|za|ção)( a| da)? tela$/.test(t)) {
    ctx.fechar();
    await traduzirTela();
    return "Arraste em volta do texto para traduzir.";
  }

  // Copiar um texto rápido: "copia meu pix".
  m = t.match(/^(?:copia|copiar|copie)(?: o| a| meu| minha)* (.+)$/);
  if (m) {
    const alvo = m[1];
    const achado = d.textos.find((x) => normalizar(x.nome).includes(alvo) || alvo.includes(normalizar(x.nome)));
    if (achado) {
      await copiar(achado.texto);
      return `Copiei “${achado.nome}”. É só colar com Ctrl+V.`;
    }
  }

  // Abrir programa ou site: "abre o spotify".
  m = semCortesia(t).match(/^(?:abre|abrir|abra|abri|abriu|inicia|iniciar|executa|executar|roda|rodar)(?: o| a| os| as| no| na)? (.+)$/);
  if (m) {
    const alvo = m[1];
    const app = d.apps.find((a) => normalizar(a.nome) === alvo) ?? d.apps.find((a) => normalizar(a.nome).includes(alvo));
    if (app) {
      await abrirPrograma(app.caminho);
      return `Abrindo ${app.nome}.`;
    }
    const programas = await listarProgramas().catch(() => []);
    const programa =
      programas.find((p) => normalizar(p.nome) === alvo) ?? programas.find((p) => normalizar(p.nome).startsWith(alvo)) ?? programas.find((p) => normalizar(p.nome).includes(alvo));
    if (programa) {
      await abrirPrograma(programa.caminho);
      return `Abrindo ${programa.nome}.`;
    }
    // Não achou: deixa a IA responder.
  }

  // Passear.
  if (/^(vai |va )?(passear|dar uma volta|da uma volta|passeia)$/.test(t)) {
    ctx.fechar();
    await passear();
    return "Fui dar uma volta! Já volto. 🚶";
  }

  // Hora e data.
  if (/^(que horas sao|que hora e|horas)$/.test(t)) {
    return `Agora são ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.`;
  }
  if (/^(que dia e hoje|qual a data de hoje|que dia e)$/.test(t)) {
    return `Hoje é ${new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}.`;
  }
  return null;
}
