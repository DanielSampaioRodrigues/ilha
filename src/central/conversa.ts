// Conversa com os motores: lista de conversas (separadas por motor), as
// mensagens com a resposta aparecendo enquanto é escrita, escolher motor,
// projeto e modo, parar, continuar no terminal e passar para outro motor.
import { emit } from "@tauri-apps/api/event";
import { ler, novoId } from "../dados/armazem";
import {
  adicionarConversa,
  apagarConversa,
  conversas,
  salvarConversas,
  type Conversa,
  type MensagemConversa,
} from "../dados/conversas";
import { haQuanto } from "../dados/datas";
import {
  abrirNoTerminal,
  conversar,
  motoresDisponiveis,
  NOMES_MOTORES,
  pararConversa,
  type Motor,
} from "../maos/sistema";
import { selo, type TipoIA } from "../corpo/selos";
import { aoClicar, confirmarAntes, escapar, html } from "../corpo/ui";
import { textoRico } from "./texto-rico";

const MOTORES: Motor[] = ["deepseek", "claude", "codex", "gemini"];
const DESCRICOES: Record<Motor, string> = {
  deepseek: "Rápido e barato · conversa do dia a dia",
  claude: "Pesado · usa sua assinatura Claude",
  codex: "Pesado · usa sua assinatura ChatGPT",
  gemini: "Pesado · usa sua conta Google",
};
const SELO: Record<Motor, TipoIA> = { deepseek: "deepseek", claude: "claude", codex: "chatgpt", gemini: "gemini" };

const FERRAMENTAS: Record<string, string> = {
  Read: "Leu",
  Write: "Escreveu",
  Edit: "Editou",
  MultiEdit: "Editou",
  Bash: "Comando",
  comando: "Comando",
  editou: "Editou",
  Grep: "Procurou",
  Glob: "Procurou arquivos",
  WebSearch: "Pesquisou na web",
  WebFetch: "Abriu página",
  TodoWrite: "Organizou tarefas",
};

/** Conversas rodando agora (id → hora em que começou). */
const rodando = new Map<string, number>();
let atualId: string | null = null;
let filtro: Motor | "todas" = "todas";
let disponiveis: Record<Motor, boolean> = { deepseek: true, claude: true, codex: true, gemini: true };
let rascunho = "";
// Escolhas para a próxima conversa nova.
let novoMotor: Motor = "deepseek";
let novoProjeto: string | null = null;
let novoModo: "conversar" | "editar" = "conversar";
let redesenharTudo: () => void = () => {};

export function conversaRodando(): boolean {
  return rodando.size > 0;
}

/** Para uma conversa (pedido vindo da ilha, pelo botão Parar). */
export function pararPeloId(id: string): void {
  pararConversa(id).catch(() => {});
}

function sistemaPara(c: Conversa): string {
  const cfg = ler().config;
  const projeto = ler().projetos.find((p) => p.id === c.projetoId);
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

function novaConversa(): Conversa {
  const projeto = ler().projetos.find((p) => p.id === novoProjeto);
  return {
    id: novoId(),
    titulo: "",
    motor: novoMotor,
    sessao: null,
    projetoId: projeto?.id ?? null,
    pasta: projeto?.pasta ?? null,
    modo: novoModo,
    mensagens: [],
    criada: Date.now(),
    atualizada: Date.now(),
  };
}

async function enviar(c: Conversa, texto: string, aoMudar: () => void): Promise<void> {
  const primeira = c.mensagens.length === 0;
  c.mensagens.push({ papel: "voce", texto, quando: Date.now() });
  if (!c.titulo) c.titulo = texto.replace(/\s+/g, " ").slice(0, 60);
  const resposta: MensagemConversa = { papel: "robo", texto: "", quando: Date.now(), ferramentas: [] };
  c.mensagens.push(resposta);
  c.atualizada = Date.now();
  if (!conversas().includes(c)) adicionarConversa(c);
  else salvarConversas();
  rodando.set(c.id, Date.now());
  aoMudar();

  // Para os programas, as instruções do projeto vão junto da primeira mensagem.
  const projeto = ler().projetos.find((p) => p.id === c.projetoId);
  const prompt =
    primeira && projeto?.instrucoes && c.motor !== "deepseek"
      ? `Instruções do projeto "${projeto.nome}":\n${projeto.instrucoes}\n\n---\n\n${texto}`
      : texto;
  emit("ilha:trabalho", { id: c.id, titulo: c.titulo, motor: c.motor }).catch(() => {});
  const inicio = Date.now();

  try {
    await conversar(
      {
        conversaId: c.id,
        motor: c.motor,
        mensagens: c.mensagens.slice(0, -1).slice(-30).map((m) => ({ papel: m.papel, texto: m.texto })),
        prompt,
        sessao: c.sessao,
        pasta: c.pasta,
        modo: c.modo,
        sistema: sistemaPara(c),
      },
      (e) => {
        if (e.tipo === "sessao") c.sessao = e.id;
        if (e.tipo === "texto") resposta.texto += e.texto;
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
  rodando.delete(c.id);
  c.atualizada = Date.now();
  salvarConversas();
  aoMudar();
  emit("ilha:trabalho-fim", {
    id: c.id,
    titulo: c.titulo,
    motor: c.motor,
    ok: !resposta.erro,
    segundos: Math.round((Date.now() - inicio) / 1000),
  }).catch(() => {});
}

/** Texto para começar a mesma conversa com outro motor. */
function contextoPara(c: Conversa, destino: Motor): string {
  const trecho = c.mensagens
    .slice(-12)
    .map((m) => `${m.papel === "voce" ? "Eu" : NOMES_MOTORES[c.motor]}: ${m.texto.slice(0, 1500)}`)
    .join("\n\n");
  return `Estou continuando com você (${NOMES_MOTORES[destino]}) uma conversa que comecei com o ${NOMES_MOTORES[c.motor]}. Aqui está o contexto:\n\n${trecho}\n\n---\n\nContinue a partir daqui: `;
}

function bolha(m: MensagemConversa, motor: Motor, ativa: boolean): string {
  if (m.papel === "voce") return `<div class="bolha voce">${escapar(m.texto).replace(/\n/g, "<br>")}</div>`;
  const ferramentas = (m.ferramentas ?? [])
    .map((f) => `<span class="uso-ferramenta"><b>${escapar(FERRAMENTAS[f.nome] ?? f.nome)}</b> ${escapar(f.detalhe)}</span>`)
    .join("");
  const corpo = m.texto ? textoRico(m.texto) : "";
  const pensando = ativa && !m.texto ? '<span class="digitando"><i></i><i></i><i></i></span>' : "";
  const erro = m.erro && m.erro !== "Parado." ? `<p class="erro-msg">${escapar(m.erro)}</p>` : m.erro === "Parado." ? '<p class="secundario">Parado.</p>' : "";
  return `
    <div class="bolha robo">
      <span class="autor">${selo(SELO[motor], 14)}${NOMES_MOTORES[motor]}</span>
      ${ferramentas ? `<div class="ferramentas">${ferramentas}</div>` : ""}
      <div class="md">${corpo}${pensando}${ativa && m.texto ? '<span class="cursor"></span>' : ""}</div>
      ${erro}
    </div>`;
}

export function montarConversa(): HTMLElement {
  const raiz = html(`
    <div class="conversa">
      <aside class="lista-conversas">
        <button type="button" class="botao ciano nova-conversa" data-acao="nova">+ Nova conversa</button>
        <div class="filtros"></div>
        <input class="entrada busca-conversas" type="search" placeholder="Procurar conversa" aria-label="Procurar conversa">
        <div class="itens-conversa"></div>
      </aside>
      <section class="painel-conversa"></section>
    </div>`);

  const filtros = raiz.querySelector<HTMLElement>(".filtros")!;
  const itens = raiz.querySelector<HTMLElement>(".itens-conversa")!;
  const painel = raiz.querySelector<HTMLElement>(".painel-conversa")!;
  const busca = raiz.querySelector<HTMLInputElement>(".busca-conversas")!;

  const desenharLista = () => {
    filtros.innerHTML = (["todas", ...MOTORES] as const)
      .map(
        (m) =>
          `<button type="button" class="filtro ${filtro === m ? "ativo" : ""}" data-acao="filtro" data-motor="${m}">${m === "todas" ? "Todas" : NOMES_MOTORES[m].replace(" CLI", "").replace(" Code", "")}</button>`,
      )
      .join("");
    const termo = busca.value.trim().toLowerCase();
    const lista = conversas().filter(
      (c) =>
        (filtro === "todas" || c.motor === filtro) &&
        (!termo || c.titulo.toLowerCase().includes(termo) || c.mensagens.some((m) => m.texto.toLowerCase().includes(termo))),
    );
    itens.innerHTML =
      lista
        .map(
          (c) => `
        <button type="button" class="item-conversa ${c.id === atualId ? "ativo" : ""}" data-acao="abrir" data-id="${c.id}">
          ${selo(SELO[c.motor], 16)}
          <span class="coluna">
            <span class="principal">${escapar(c.titulo || "Conversa nova")}</span>
            <span class="secundario">${rodando.has(c.id) ? "respondendo…" : haQuanto(new Date(c.atualizada))}${c.pasta ? ` · ${escapar(c.pasta.split(/[\\/]/).pop() ?? "")}` : ""}</span>
          </span>
        </button>`,
        )
        .join("") || '<p class="secundario vazio-lista">Nenhuma conversa ainda.</p>';
    aoClicar(filtros, "filtro", (b) => {
      filtro = b.dataset.motor as Motor | "todas";
      desenharLista();
    });
    aoClicar(itens, "abrir", (b) => {
      atualId = b.dataset.id ?? null;
      desenharTudo();
    });
  };

  const desenharNova = () => {
    const projetos = ler().projetos;
    painel.innerHTML = `
      <div class="comeco">
        <p class="titulo-comeco">Com quem você quer conversar?</p>
        <div class="motores">
          ${MOTORES.map(
            (m) => `
            <button type="button" class="cartao-motor ${m === novoMotor ? "ativo" : ""}" data-acao="motor" data-motor="${m}" ${disponiveis[m] ? "" : "disabled"}>
              ${selo(SELO[m], 22)}
              <span class="principal">${NOMES_MOTORES[m]}</span>
              <span class="secundario">${disponiveis[m] ? DESCRICOES[m] : m === "deepseek" ? "Falta a chave (Ajustes › Chaves de IA)" : "Não encontrei instalado"}</span>
            </button>`,
          ).join("")}
        </div>
        <div class="linha opcoes-nova">
          <label class="campo-inline">Projeto
            <select class="entrada" data-campo="projeto">
              <option value="">Nenhum</option>
              ${projetos.map((p) => `<option value="${p.id}" ${p.id === novoProjeto ? "selected" : ""}>${escapar(p.nome)}</option>`).join("")}
            </select>
          </label>
          ${
            novoMotor === "deepseek"
              ? ""
              : `<div class="segmentos" role="radiogroup" aria-label="O que ele pode fazer">
                  <button type="button" class="segmento" role="radio" aria-checked="${novoModo === "conversar"}" data-acao="modo" data-modo="conversar">Só conversar e ler</button>
                  <button type="button" class="segmento" role="radio" aria-checked="${novoModo === "editar"}" data-acao="modo" data-modo="editar">Pode editar arquivos</button>
                </div>`
          }
        </div>
        <p class="secundario dica-nova">${
          novoMotor === "deepseek"
            ? "A DeepSeek responde rápido e lembra desta conversa. Não mexe em arquivos."
            : "Ele trabalha na pasta do projeto (ou na sua pasta pessoal). Comandos no computador ficam bloqueados por enquanto; liberar com sua confirmação vem na fase 3."
        }</p>
      </div>`;
    aoClicar(painel, "motor", (b) => {
      novoMotor = b.dataset.motor as Motor;
      desenharNova();
      painel.append(compositor(null));
    });
    aoClicar(painel, "modo", (b) => {
      novoModo = b.dataset.modo as "conversar" | "editar";
      desenharNova();
      painel.append(compositor(null));
    });
    painel.querySelector<HTMLSelectElement>('[data-campo="projeto"]')!.addEventListener("change", (e) => {
      novoProjeto = (e.target as HTMLSelectElement).value || null;
    });
  };

  const compositor = (c: Conversa | null): HTMLElement => {
    const ocupado = c ? rodando.has(c.id) : false;
    const caixa = html(`
      <form class="compositor">
        <textarea rows="1" placeholder="Escreva para ${escapar(ler().config.nomeRobo)}… (Enter envia, Shift+Enter pula linha)" aria-label="Mensagem">${escapar(rascunho)}</textarea>
        ${ocupado ? '<button type="button" class="botao" data-acao="parar">Parar</button>' : '<button type="submit" class="botao ciano">Enviar</button>'}
      </form>`) as HTMLFormElement;
    const campo = caixa.querySelector("textarea")!;
    const ajustar = () => {
      campo.style.height = "auto";
      campo.style.height = `${Math.min(220, campo.scrollHeight)}px`;
    };
    campo.addEventListener("input", () => {
      rascunho = campo.value;
      ajustar();
    });
    campo.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        caixa.requestSubmit();
      }
    });
    caixa.addEventListener("submit", (e) => {
      e.preventDefault();
      const texto = campo.value.trim();
      if (!texto || ocupado) return;
      const conversa = c ?? novaConversa();
      if (!disponiveis[conversa.motor]) return;
      rascunho = "";
      atualId = conversa.id;
      enviar(conversa, texto, () => (atualId === conversa.id ? desenharMensagens() : desenharLista()));
      desenharTudo();
    });
    aoClicar(caixa, "parar", () => c && pararConversa(c.id).catch(() => {}));
    window.setTimeout(() => {
      ajustar();
      campo.focus();
    }, 30);
    return caixa;
  };

  let mensagensEl: HTMLElement | null = null;
  const desenharMensagens = () => {
    const c = conversas().find((x) => x.id === atualId);
    if (!c || !mensagensEl) return desenharTudo();
    const noFim = mensagensEl.scrollHeight - mensagensEl.scrollTop - mensagensEl.clientHeight < 80;
    const ativa = rodando.has(c.id);
    mensagensEl.innerHTML = c.mensagens.map((m, i) => bolha(m, c.motor, ativa && i === c.mensagens.length - 1)).join("");
    if (noFim) mensagensEl.scrollTop = mensagensEl.scrollHeight;
    // Botão Enviar/Parar muda quando termina.
    const form = painel.querySelector(".compositor");
    const temParar = !!form?.querySelector('[data-acao="parar"]');
    if (form && temParar !== ativa) form.replaceWith(compositor(c));
    desenharLista();
  };

  const desenharConversa = (c: Conversa) => {
    const projeto = ler().projetos.find((p) => p.id === c.projetoId);
    const outros = MOTORES.filter((m) => m !== c.motor && disponiveis[m]);
    painel.innerHTML = `
      <header class="topo-conversa">
        ${selo(SELO[c.motor], 22)}
        <div class="coluna">
          <span class="principal">${escapar(c.titulo || "Conversa nova")}</span>
          <span class="secundario">${NOMES_MOTORES[c.motor]}${projeto ? ` · ${escapar(projeto.nome)}` : c.pasta ? ` · ${escapar(c.pasta)}` : ""}${c.motor !== "deepseek" ? ` · ${c.modo === "editar" ? "pode editar arquivos" : "só conversa e lê"}` : ""}${c.custo ? ` · US$ ${c.custo.toFixed(2)}` : ""}</span>
        </div>
        ${c.motor !== "deepseek" && c.sessao ? '<button type="button" class="botao" data-acao="terminal">Abrir no terminal</button>' : ""}
        ${
          outros.length && c.mensagens.length
            ? `<details class="menu-passar"><summary class="botao">Passar para…</summary><div class="opcoes-passar">${outros
                .map((m) => `<button type="button" data-acao="passar" data-motor="${m}">${selo(SELO[m], 14)}${NOMES_MOTORES[m]}</button>`)
                .join("")}</div></details>`
            : ""
        }
        <button type="button" class="botao" data-acao="apagar">Apagar</button>
      </header>
      <div class="mensagens"></div>`;
    mensagensEl = painel.querySelector(".mensagens");
    painel.append(compositor(c));
    desenharMensagens();
    if (mensagensEl) mensagensEl.scrollTop = mensagensEl.scrollHeight;

    aoClicar(painel, "terminal", () => abrirNoTerminal(c.motor, c.sessao, c.pasta).catch(() => {}));
    aoClicar(painel, "apagar", (b) =>
      confirmarAntes(b, "Apagar conversa?", () => {
        apagarConversa(c.id);
        atualId = null;
        desenharTudo();
      }),
    );
    aoClicar(painel, "passar", (b) => {
      const destino = b.dataset.motor as Motor;
      novoMotor = destino;
      novoProjeto = c.projetoId;
      novoModo = c.modo;
      rascunho = contextoPara(c, destino);
      atualId = null;
      desenharTudo();
    });
  };

  const desenharTudo = () => {
    desenharLista();
    const c = conversas().find((x) => x.id === atualId);
    mensagensEl = null;
    if (c) desenharConversa(c);
    else {
      desenharNova();
      painel.append(compositor(null));
    }
  };
  redesenharTudo = desenharTudo;

  aoClicar(raiz, "nova", () => {
    atualId = null;
    rascunho = "";
    desenharTudo();
  });
  busca.addEventListener("input", desenharLista);

  motoresDisponiveis()
    .then((l) => {
      l.forEach((m) => (disponiveis[m.motor] = m.encontrado));
      if (!disponiveis[novoMotor]) novoMotor = MOTORES.find((m) => disponiveis[m]) ?? "deepseek";
      if (!atualId) desenharTudo();
    })
    .catch(() => {});
  desenharTudo();
  return raiz;
}

/** Abre a tela de conversa já pronta para escrever (botão Digitar da ilha). */
export function comecarNova(): void {
  atualId = null;
  redesenharTudo();
}
