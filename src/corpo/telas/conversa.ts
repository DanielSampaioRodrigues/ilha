// Conversa rápida dentro da própria ilha (sem abrir a Central).
// Quem responde é escolhido em cima (uma IA ou um perfil) e fica salvo.
// Pedidos simples (volume, timer, abrir programa, memória…) a ilha resolve
// sozinha, sem IA. "Continuar na Central" leva a conversa para lá.
import { emit } from "@tauri-apps/api/event";
import { ler, mudar, novoId } from "../../dados/armazem";
import type { Conversa } from "../../dados/conversas";
import { responder } from "../../dados/pedido";
import { abrirCentral, motoresDisponiveis, NOMES_MOTORES, ouvir, pararConversa, pararDeOuvir, type Motor } from "../../maos/sistema";
import { bip, calar, falar } from "../../maos/fala";
import { ouvir as aoEvento } from "../../ponte";
import { textoRico } from "../../central/texto-rico";
import { tentarComando } from "../comandos";
import type { Contexto } from "../contexto";
import { ICONES } from "../icones";
import { aoClicar, cabecalho, escapar, html } from "../ui";

const MOTORES: Motor[] = ["deepseek", "claude", "codex", "antigravity", "gemini"];

/** A conversa rápida atual (vive enquanto a ilha estiver ligada). */
let atual: Conversa | null = null;
let rodando = false;
let rascunho = "";
/** Ouvindo o microfone agora. */
let ouvindo = false;
/** O microfone já abriu de verdade (antes disso, o que se fala se perde). */
let microfoneAberto = false;
let aoAbrirMicrofone: () => void = () => {};
aoEvento("ilha:microfone-aberto", () => {
  // Só a janela que pediu para ouvir mostra e apita.
  if (!ouvindo) return;
  microfoneAberto = true;
  bip();
  aoAbrirMicrofone();
});
/** O microfone vermelho da ilha pediu para já abrir ouvindo. */
let ouvirAoAbrir = false;
let erroVoz = "";
/** Conversa contínua: o que fazer quando terminar de ler a resposta. */
let depoisDeFalar: (() => void) | null = null;
const DESPEDIDAS = /^(tchau|obrigad[oa]|valeu|pode parar|para de ouvir|chega|era isso|só isso)\b/i;

/** Abre a conversa já ouvindo (microfone vermelho da ilha). */
export function abrirOuvindo(): void {
  ouvirAoAbrir = true;
}
let aoMudar: () => void = () => {};
let disponiveis: Partial<Record<Motor, boolean>> = {};
motoresDisponiveis()
  .then((l) => l.forEach((m) => (disponiveis[m.motor] = m.encontrado)))
  .catch(() => {});

/** Quem responde, conforme Ajustes ("motor:deepseek" ou "perfil:<id>"). */
function nova(): Conversa {
  const d = ler();
  const [tipo, valor] = d.config.conversaRapida.split(":");
  const perfil = tipo === "perfil" ? d.perfis.find((p) => p.id === valor) : undefined;
  const motor = (perfil?.motor ?? (MOTORES.includes(valor as Motor) ? valor : "deepseek")) as Motor;
  return {
    id: `rapida-${novoId()}`,
    titulo: "",
    motor,
    sessao: null,
    projetoId: null,
    pasta: null,
    modo: perfil?.modo ?? "conversar",
    perfilId: perfil?.id ?? null,
    modelo: perfil?.modelo ?? "",
    esforco: perfil?.esforco ?? "",
    mcps: perfil ? [...perfil.mcps] : [],
    skills: perfil ? [...perfil.skills] : [],
    mensagens: [],
    criada: Date.now(),
    atualizada: Date.now(),
  };
}

function nomeDeQuem(): string {
  const d = ler();
  const [tipo, valor] = d.config.conversaRapida.split(":");
  if (tipo === "perfil") return d.perfis.find((p) => p.id === valor)?.nome ?? "DeepSeek";
  return NOMES_MOTORES[valor as Motor] ?? "DeepSeek";
}

async function enviar(texto: string, ctx: Contexto, porVoz = false): Promise<void> {
  // Uma de cada vez (ex.: algo ouvido enquanto uma mensagem digitada ainda roda).
  if (rodando || enviando) return;
  enviando = true;
  // Mandou algo: o recado antigo do microfone ("não ouvi nada") sai.
  erroVoz = "";
  try {
    await enviarAgora(texto, ctx, porVoz);
  } finally {
    enviando = false;
  }
}
let enviando = false;

async function enviarAgora(texto: string, ctx: Contexto, porVoz: boolean): Promise<void> {
  calar();
  const c = (atual ??= nova());
  const responderEmVoz = (t: string) => {
    if (porVoz && ler().config.falarRespostas) falar(t, () => depoisDeFalar?.());
  };
  // "Tchau"/"obrigado" encerra a conversa contínua.
  if (porVoz && DESPEDIDAS.test(texto.trim())) {
    c.mensagens.push({ papel: "voce", texto, quando: Date.now() }, { papel: "robo", texto: "Até já! 👋", quando: Date.now(), local: true });
    aoMudar();
    if (ler().config.falarRespostas) falar("Até já!");
    return;
  }
  // Primeiro: dá para resolver sem IA?
  const local = await tentarComando(texto, ctx).catch((e) => `Não deu: ${e}`);
  if (local !== null) {
    c.mensagens.push({ papel: "voce", texto, quando: Date.now() }, { papel: "robo", texto: local, quando: Date.now(), local: true });
    if (!c.titulo) c.titulo = texto.slice(0, 60);
    aoMudar();
    responderEmVoz(local);
    return;
  }
  if (disponiveis[c.motor] === false) {
    c.mensagens.push(
      { papel: "voce", texto, quando: Date.now() },
      {
        papel: "robo",
        texto: "",
        quando: Date.now(),
        erro: c.motor === "deepseek" ? "Falta a chave da DeepSeek (Ajustes › Chaves de IA)." : `Não encontrei o ${NOMES_MOTORES[c.motor]} instalado.`,
      },
    );
    aoMudar();
    return;
  }
  rodando = true;
  const inicio = Date.now();
  const resposta = await responder(c, texto, [], () => aoMudar(), () => {
    emit("ilha:trabalho", { id: c.id, titulo: c.titulo, motor: c.motor }).catch(() => {});
  });
  rodando = false;
  aoMudar();
  if (!resposta.erro) responderEmVoz(resposta.texto);
  emit("ilha:trabalho-fim", {
    id: c.id,
    titulo: c.titulo,
    motor: c.motor,
    ok: !resposta.erro,
    segundos: Math.round((Date.now() - inicio) / 1000),
  }).catch(() => {});
}

export function montarConversaRapida(ctx: Contexto): HTMLElement {
  const d = ler();
  const opcoes = [
    ...MOTORES.map((m) => [`motor:${m}`, NOMES_MOTORES[m]]),
    ...d.perfis.map((p) => [`perfil:${p.id}`, `Perfil: ${p.nome}`]),
  ]
    .map(([v, n]) => `<option value="${escapar(v)}" ${v === d.config.conversaRapida ? "selected" : ""}>${escapar(n)}</option>`)
    .join("");
  const raiz = html(`
    <div class="estado aberta tela tela-rapida">
      ${cabecalho("Conversa")}
      <div class="linha quem-responde">
        <label class="secundario">Quem responde
          <select class="entrada curta2" aria-label="Quem responde">${opcoes}</select>
        </label>
        <span class="espaco"></span>
        <button type="button" class="redondo" data-acao="memoria" aria-label="Memória" title="O que eu guardei de você">${ICONES.memoria}</button>
        <button type="button" class="botao" data-acao="nova" title="Começar outra conversa">Nova</button>
        <button type="button" class="botao" data-acao="central" title="Levar esta conversa para a Central">Abrir na Central</button>
      </div>
      <div class="rapida-mensagens" aria-live="polite"></div>
      <div class="linha rapida-ouvindo" hidden>
        <span class="ponto gravando"></span><span class="principal texto-ouvindo">Abrindo o microfone… espere o bip</span>
        <span class="espaco"></span>
        <button type="button" class="botao" data-acao="parar-ouvir">Parar</button>
      </div>
      <p class="erro-msg rapida-erro-voz" hidden></p>
      <form class="linha rapida-compositor">
        <button type="button" class="redondo vermelho" aria-label="Falar" title="Falar: eu ouço, respondo e leio a resposta" data-acao="falar">${ICONES.microfone}</button>
        <textarea class="entrada" rows="1" placeholder="Pergunte ou peça: “volume 30”, “timer 10 min”…" aria-label="Mensagem">${escapar(rascunho)}</textarea>
        <button type="submit" class="botao ciano enviar-rapida">Enviar</button>
      </form>
    </div>`);

  const lista = raiz.querySelector<HTMLElement>(".rapida-mensagens")!;
  const campo = raiz.querySelector("textarea")!;
  const form = raiz.querySelector<HTMLFormElement>(".rapida-compositor")!;
  const botaoEnviar = raiz.querySelector<HTMLButtonElement>(".enviar-rapida")!;
  const seletor = raiz.querySelector<HTMLSelectElement>(".quem-responde select")!;

  const desenhar = () => {
    const msgs = atual?.mensagens ?? [];
    lista.innerHTML = msgs.length
      ? msgs
          .map((m, i) => {
            if (m.papel === "voce") return `<div class="rapida-bolha voce">${escapar(m.texto).replace(/\n/g, "<br>")}</div>`;
            const ativa = rodando && i === msgs.length - 1;
            const corpo = m.texto ? textoRico(m.texto) : ativa ? '<span class="rapida-pensando"><i></i><i></i><i></i></span>' : "";
            const erro = m.erro && m.erro !== "Parado." ? `<p class="erro-msg">${escapar(m.erro)}</p>` : "";
            const ferramentas = m.ferramentas?.length ? `<p class="secundario">${m.ferramentas.length} ação(ões) feitas</p>` : "";
            return `<div class="rapida-bolha robo">${ferramentas}<div class="md">${corpo}</div>${erro}</div>`;
          })
          .join("")
      : `<p class="secundario rapida-vazio">Fale com ${escapar(nomeDeQuem())}. Pedidos simples (volume, timer, foco, abrir programa, copiar texto, “guarda que…”) eu resolvo na hora, sem IA.</p>`;
    lista.scrollTop = lista.scrollHeight;
    botaoEnviar.textContent = rodando ? "Parar" : "Enviar";
    botaoEnviar.classList.toggle("ciano", !rodando);
    raiz.querySelector<HTMLButtonElement>('[data-acao="central"]')!.disabled = rodando || !atual?.mensagens.length;
    seletor.disabled = rodando;
    raiz.querySelector<HTMLElement>(".rapida-ouvindo")!.hidden = !ouvindo;
    raiz.querySelector<HTMLElement>(".texto-ouvindo")!.textContent = microfoneAberto ? "Pode falar!" : "Abrindo o microfone… espere o bip";
    raiz.querySelector<HTMLElement>(".rapida-ouvindo .ponto")!.classList.toggle("esperando", !microfoneAberto);
    document.body.classList.toggle("ouvindo-voz", ouvindo);
    const erro = raiz.querySelector<HTMLElement>(".rapida-erro-voz")!;
    erro.hidden = !erroVoz;
    erro.textContent = erroVoz;
    raiz.querySelector<HTMLButtonElement>('[data-acao="falar"]')!.disabled = ouvindo || rodando;
  };
  aoMudar = desenhar;
  desenhar();

  seletor.addEventListener("change", () => {
    mudar((dd) => (dd.config.conversaRapida = seletor.value));
    // Trocar quem responde começa outra conversa.
    if (atual?.mensagens.length) atual = null;
    desenhar();
  });
  const ajustar = () => {
    campo.style.height = "auto";
    campo.style.height = `${Math.min(120, campo.scrollHeight)}px`;
  };
  campo.addEventListener("input", () => {
    rascunho = campo.value;
    ajustar();
  });
  campo.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (rodando) {
      if (atual) pararConversa(atual.id).catch(() => {});
      return;
    }
    const texto = campo.value.trim();
    if (!texto) return;
    campo.value = rascunho = "";
    ajustar();
    enviar(texto, ctx).catch(() => {});
  });
  aoClicar(raiz, "voltar", () => ctx.irPara("inicio"));
  aoClicar(raiz, "memoria", () => ctx.irPara("memoria"));
  aoClicar(raiz, "nova", () => {
    if (rodando) return;
    atual = null;
    desenhar();
    campo.focus();
  });
  aoClicar(raiz, "central", () => {
    if (!atual || rodando) return;
    const c = atual;
    atual = null;
    ctx.fechar();
    abrirCentral("conversa", [], c).catch(() => {});
  });
  // Falar: ouve uma frase, manda, e lê a resposta em voz alta.
  const escutar = async (continuando = false) => {
    if (ouvindo || rodando) return;
    calar();
    ouvindo = true;
    microfoneAberto = false;
    aoAbrirMicrofone = () => raiz.isConnected && desenhar();
    erroVoz = "";
    desenhar();
    try {
      const texto = (await ouvir()).trim();
      ouvindo = false;
      if (texto) await enviar(texto, ctx, true);
      // Silêncio na conversa contínua: só para de ouvir, sem erro.
      else if (!continuando) erroVoz = "Não ouvi nada. Aperte o microfone e fale de novo.";
    } catch (e) {
      ouvindo = false;
      erroVoz = String(e);
    }
    desenhar();
  };
  aoClicar(raiz, "falar", () => void escutar());
  // Conversa contínua: terminou de ler a resposta, volta a ouvir (se ainda aberta).
  depoisDeFalar = () => {
    if (ler().config.conversaContinua && raiz.isConnected && !ouvindo && !rodando) void escutar(true);
  };
  aoClicar(raiz, "parar-ouvir", () => {
    pararDeOuvir().catch(() => {});
  });
  if (ouvirAoAbrir) {
    ouvirAoAbrir = false;
    window.setTimeout(() => void escutar(), 150);
  }
  window.setTimeout(() => {
    ajustar();
    campo.focus();
  }, 60);
  return raiz;
}
