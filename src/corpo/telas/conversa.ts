// Conversa rápida dentro da própria ilha (sem abrir a Central).
// Quem responde é escolhido em cima (uma IA ou um perfil) e fica salvo.
// Pedidos simples (volume, timer, abrir programa, memória…) a ilha resolve
// sozinha, sem IA. "Continuar na Central" leva a conversa para lá.
import { emit } from "@tauri-apps/api/event";
import { ler, mudar, novoId } from "../../dados/armazem";
import type { Conversa } from "../../dados/conversas";
import { responder } from "../../dados/pedido";
import { abrirCentral, ditado, motoresDisponiveis, NOMES_MOTORES, pararConversa, type Motor } from "../../maos/sistema";
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

async function enviar(texto: string, ctx: Contexto): Promise<void> {
  const c = (atual ??= nova());
  // Primeiro: dá para resolver sem IA?
  const local = await tentarComando(texto, ctx).catch((e) => `Não deu: ${e}`);
  if (local !== null) {
    c.mensagens.push({ papel: "voce", texto, quando: Date.now() }, { papel: "robo", texto: local, quando: Date.now(), local: true });
    if (!c.titulo) c.titulo = texto.slice(0, 60);
    aoMudar();
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
      <form class="linha rapida-compositor">
        <button type="button" class="redondo" aria-label="Ditado" title="Ditado: fale e o Windows escreve (Win + H)" data-acao="ditado">${ICONES.microfone}</button>
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
  aoClicar(raiz, "ditado", () => {
    campo.focus();
    window.setTimeout(() => ditado().catch(() => {}), 80);
  });
  window.setTimeout(() => {
    ajustar();
    campo.focus();
  }, 60);
  return raiz;
}
