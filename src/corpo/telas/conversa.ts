// Conversa rápida dentro da própria ilha (sem abrir a Central).
// Quem responde é escolhido em cima (uma IA ou um perfil) e fica salvo.
// Pedidos simples (volume, timer, abrir programa, memória…) a ilha resolve
// sozinha, sem IA. "Continuar na Central" leva a conversa para lá.
import { emit } from "@tauri-apps/api/event";
import { ler, mudar, novoId } from "../../dados/armazem";
import type { Conversa } from "../../dados/conversas";
import { responder } from "../../dados/pedido";
import { guardarModelosExtras, modelosDe } from "../../dados/modelos";
import { abrirCentral, listarModelos, motoresDisponiveis, NOMES_MOTORES, ouvir, pararConversa, pararDeOuvir, type Motor } from "../../maos/sistema";
import { bip, calar, falar, falarEmPartes, frasesProntas } from "../../maos/fala";
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
/** Já gravou: o ouvido está transformando a fala em texto. */
let entendendo = false;
/** O que a nuvem já entendeu, enquanto a pessoa ainda fala. */
let aoVivo = "";
aoEvento<string>("ilha:ouvindo-texto", (t) => {
  if (!ouvindo) return;
  aoVivo = t;
  aoAbrirMicrofone();
});
aoEvento("ilha:entendendo", () => {
  if (!ouvindo) return;
  entendendo = true;
  aoAbrirMicrofone();
});
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
/** Pedido que veio junto com o nome ("Robozinho, que horas são?"). */
let pedidoAoAbrir = "";
export function abrirComPedido(texto: string): void {
  pedidoAoAbrir = texto;
}
/**
 * Chamou pelo nome: o ouvido da ilha já está ouvindo o pedido (no mesmo
 * microfone, sem esperar). Para de falar na hora (dá para interromper o robô
 * chamando o nome) e mostra "ouvindo"; o texto chega por "ilha:pedido-ouvido".
 */
let esperandoPedido = false;
/** Quando o Dan apertou Parar por último (resultados de antes disso são descartados). */
let paradoAgora = 0;
let pedidoOuvido: { texto?: string; erro?: string } | null = null;
let aoChegarPedido: () => void = () => {};
export function abrirEsperandoPedido(etapa: "ouvindo" | "entendendo"): void {
  calar();
  esperandoPedido = true;
  pedidoOuvido = null;
  ouvindo = true;
  aoVivo = "";
  // O microfone já está aberto (é o mesmo que ouviu o nome): pode falar.
  microfoneAberto = true;
  entendendo = etapa === "entendendo";
  erroVoz = "";
  if (!entendendo) bip();
  aoAbrirMicrofone();
}
aoEvento<{ texto?: string; erro?: string }>("ilha:pedido-ouvido", (r) => {
  if (!esperandoPedido) return;
  pedidoOuvido = r;
  aoChegarPedido();
});
let aoMudar: () => void = () => {};
const modelosBuscados = new Set<Motor>();
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
    modelo: perfil?.modelo ?? d.config.modelosRapida?.[motor] ?? "",
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
  // Pode ter sido instalado depois de a ilha ligar: confere de novo antes de reclamar.
  if (disponiveis[c.motor] === false) {
    await motoresDisponiveis()
      .then((l) => l.forEach((m) => (disponiveis[m.motor] = m.encontrado)))
      .catch(() => {});
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
  // Por voz: fala frase por frase, conforme a resposta chega (não espera acabar).
  const voz = porVoz && ler().config.falarRespostas ? falarEmPartes(() => depoisDeFalar?.()) : null;
  let falado = 0;
  const falarNovas = (final: boolean) => {
    const robo = c.mensagens[c.mensagens.length - 1];
    if (!voz || robo?.papel !== "robo") return;
    if (final) {
      voz.parte(robo.texto.slice(falado));
      falado = robo.texto.length;
      return;
    }
    const { frases, ate } = frasesProntas(robo.texto, falado);
    if (frases) {
      voz.parte(frases);
      falado = ate;
    }
  };
  const resposta = await responder(
    c,
    texto,
    [],
    () => {
      aoMudar();
      falarNovas(false);
    },
    () => {
      emit("ilha:trabalho", { id: c.id, titulo: c.titulo, motor: c.motor }).catch(() => {});
    },
  );
  rodando = false;
  aoMudar();
  if (voz) {
    if (!resposta.erro) falarNovas(true);
    voz.fim();
  }
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
        <label class="secundario campo-modelo-rapida">Modelo
          <select class="entrada curta2" data-campo="modelo-rapida" aria-label="Modelo"></select>
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
  const seletorModelo = raiz.querySelector<HTMLSelectElement>('[data-campo="modelo-rapida"]')!;

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
    seletorModelo.disabled = rodando;
    raiz.querySelector<HTMLElement>(".rapida-ouvindo")!.hidden = !ouvindo;
    raiz.querySelector<HTMLElement>(".texto-ouvindo")!.textContent = aoVivo
      ? `“${aoVivo}”`
      : entendendo
        ? "Entendendo o que você disse…"
        : microfoneAberto
          ? "Pode falar!"
          : "Abrindo o microfone… espere o bip";
    raiz.querySelector<HTMLElement>(".rapida-ouvindo .ponto")!.classList.toggle("esperando", !microfoneAberto);
    document.body.classList.toggle("ouvindo-voz", ouvindo);
    const erro = raiz.querySelector<HTMLElement>(".rapida-erro-voz")!;
    erro.hidden = !erroVoz;
    erro.textContent = erroVoz;
    raiz.querySelector<HTMLButtonElement>('[data-acao="falar"]')!.disabled = ouvindo || rodando;
  };
  aoMudar = desenhar;
  desenhar();

  // Modelo: a lista de cada IA (a mesma da Central). Num perfil, vale o modelo do perfil.
  const motorEscolhido = (): { motor: Motor; perfil: boolean } => {
    const [tipo, valor] = ler().config.conversaRapida.split(":");
    if (tipo === "perfil") {
      const p = ler().perfis.find((x) => x.id === valor);
      return { motor: (p?.motor ?? "deepseek") as Motor, perfil: true };
    }
    return { motor: (MOTORES.includes(valor as Motor) ? valor : "deepseek") as Motor, perfil: false };
  };
  const desenharModelos = () => {
    const { motor, perfil } = motorEscolhido();
    const atualModelo = atual?.modelo ?? (perfil ? "" : (ler().config.modelosRapida?.[motor] ?? ""));
    seletorModelo.innerHTML = modelosDe(motor, atualModelo)
      .map((o) => `<option value="${escapar(o.valor)}" ${o.valor === atualModelo ? "selected" : ""}>${escapar(o.nome)}</option>`)
      .join("");
    seletorModelo.closest<HTMLElement>(".campo-modelo-rapida")!.hidden = perfil;
    // Antigravity e DeepSeek: a lista vem do próprio programa/API (uma vez).
    if ((motor === "antigravity" || motor === "deepseek") && !modelosBuscados.has(motor)) {
      modelosBuscados.add(motor);
      listarModelos(motor)
        .then((l) => {
          if (!l.length) return;
          guardarModelosExtras(motor, l);
          if (raiz.isConnected) desenharModelos();
        })
        .catch(() => {});
    }
  };
  desenharModelos();
  seletorModelo.addEventListener("change", () => {
    const { motor } = motorEscolhido();
    const valor = seletorModelo.value;
    mudar((dd) => (dd.config.modelosRapida = { ...(dd.config.modelosRapida ?? {}), [motor]: valor }));
    // Vale a partir da próxima mensagem desta conversa.
    if (atual) atual.modelo = valor;
  });
  seletor.addEventListener("change", () => {
    mudar((dd) => (dd.config.conversaRapida = seletor.value));
    // Trocar quem responde começa outra conversa.
    if (atual?.mensagens.length) atual = null;
    desenharModelos();
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
    const comecou = Date.now();
    calar();
    ouvindo = true;
    microfoneAberto = false;
    entendendo = false;
    aoVivo = "";
    aoAbrirMicrofone = () => raiz.isConnected && desenhar();
    erroVoz = "";
    desenhar();
    try {
      const texto = (await ouvir()).trim();
      ouvindo = false;
      // Apertou Parar enquanto ouvia/entendia: descarta.
      if (paradoAgora > comecou) return desenhar();
      if (texto) await enviar(texto, ctx, true);
      // Silêncio na conversa contínua: só para de ouvir, sem erro.
      else if (!continuando) erroVoz = "Não ouvi nada. Aperte o microfone e fale de novo.";
    } catch (e) {
      ouvindo = false;
      if (paradoAgora > comecou) return desenhar();
      // Silêncio na conversa contínua: só para de ouvir, sem erro.
      if (!(continuando && /não chegou som|nenhuma palavra/.test(String(e)))) erroVoz = String(e);
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
    // Para na hora (inclusive o "entendendo"): nada do que foi ouvido é mandado.
    ouvindo = false;
    entendendo = false;
    esperandoPedido = false;
    pedidoOuvido = null;
    paradoAgora = Date.now();
    desenhar();
  });
  // Pedido ouvido depois do nome: manda (ou mostra o erro).
  const tratarPedido = () => {
    const r = pedidoOuvido;
    if (!r) return;
    pedidoOuvido = null;
    esperandoPedido = false;
    ouvindo = false;
    const texto = r.texto?.trim() ?? "";
    if (texto) void enviar(texto, ctx, true).then(desenhar);
    else if (r.erro) erroVoz = r.erro;
    desenhar();
  };
  aoChegarPedido = () => {
    if (raiz.isConnected) tratarPedido();
  };
  if (esperandoPedido) {
    aoAbrirMicrofone = () => raiz.isConnected && desenhar();
    window.setTimeout(tratarPedido, 0);
  }
  if (pedidoAoAbrir) {
    const texto = pedidoAoAbrir;
    pedidoAoAbrir = "";
    ouvirAoAbrir = false;
    window.setTimeout(() => void enviar(texto, ctx, true).then(desenhar), 150);
  } else if (ouvirAoAbrir) {
    ouvirAoAbrir = false;
    window.setTimeout(() => void escutar(), 150);
  }
  window.setTimeout(() => {
    ajustar();
    campo.focus();
  }, 60);
  return raiz;
}
