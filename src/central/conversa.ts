// Conversa com os motores: lista de conversas (separadas por motor), as
// mensagens com a resposta aparecendo enquanto é escrita, escolher perfil,
// motor, modelo, raciocínio, projeto, modo, MCPs e skills; parar, continuar no
// terminal e passar para outro motor.
import { emit } from "@tauri-apps/api/event";
import { ler, novoId, type Dados } from "../dados/armazem";
import { responder, USAM_MCP } from "../dados/pedido";
import { esforcosDe, guardarModelosExtras, modelosDe, nomeDoEsforco, nomeDoModelo } from "../dados/modelos";
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
  ouvir,
  pararDeOuvir,
  escolherArquivos,
  listarModelos,
  motoresDisponiveis,
  instalarMotor,
  entrarMotor,
  contaMotor,
  salvarChave,
  abrirPrograma,
  NOMES_MOTORES,
  pararConversa,
  type Motor,
} from "../maos/sistema";
import { selo, SELO_MOTOR as SELO } from "../corpo/selos";
import { aoClicar, confirmarAntes, escapar, html } from "../corpo/ui";
import { ICONES } from "../corpo/icones";
import { bip } from "../maos/fala";
import { ouvir as aoEventoDaIlha } from "../ponte";
import { textoRico } from "./texto-rico";

const MOTORES: Motor[] = ["deepseek", "claude", "codex", "antigravity", "gemini"];
const DESCRICOES: Record<Motor, string> = {
  deepseek: "Rápido e barato · conversa do dia a dia",
  claude: "Pesado · usa sua assinatura Claude",
  codex: "Pesado · usa sua assinatura ChatGPT",
  antigravity: "Pesado · usa sua conta Google",
  gemini: "Pesado · só com chave paga da API",
};
/** Motores que podem editar arquivos pela ilha. */
const EDITAM: Motor[] = ["claude", "codex", "gemini", "antigravity"];

/** O que dá para escolher numa conversa (nova ou já começada). */
interface Escolhas {
  motor: Motor;
  modelo: string;
  esforco: string;
  mcps: string[];
  skills: string[];
}

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
/** Guarda e lê um lembrete desta tela (some se o navegador não deixar). */
function lembrar(chave: string, valor: string): void {
  try {
    localStorage.setItem(chave, valor);
  } catch {
    /* sem problema */
  }
}
function lembrado(chave: string): string | null {
  try {
    return localStorage.getItem(chave);
  } catch {
    return null;
  }
}
let atualId: string | null = lembrado("ilha-central-conversa") || null;
let filtro: Motor | "todas" = "todas";
let disponiveis: Record<Motor, boolean> = { deepseek: true, claude: true, codex: true, gemini: true, antigravity: true };
const buscouModelos = new Set<Motor>();
let rascunho = "";
/** O ditado (microfone da caixa de texto) está ouvindo. */
let ditando = false;
// Bip quando o microfone abre de verdade: pode falar.
aoEventoDaIlha("ilha:microfone-aberto", () => {
  if (ditando) bip();
});
/** Arquivos esperando a próxima mensagem. */
let anexosPendentes: string[] = [];
let aoMudarAnexos: () => void = () => {};

const nomeDo = (caminho: string) => caminho.split(/[\\/]/).pop() ?? caminho;

/** Anexa arquivos à próxima mensagem (botão, arrastar para a Central ou para a ilha). */
export function anexar(caminhos: string[]): void {
  for (const c of caminhos) if (!anexosPendentes.includes(c)) anexosPendentes.push(c);
  aoMudarAnexos();
}
/** Programas que a ilha sabe instalar (pelo instalador oficial de cada um). */
const INSTALAVEIS: Motor[] = ["claude", "codex"];
/**
 * Preparar um programa para usar, tudo por dentro da ilha: instalar (por trás,
 * sem janela), entrar na conta (pelo navegador) ou guardar a chave (Gemini CLI).
 */
type Etapa = "explica" | "confirma" | "instalando" | "entrar" | "esperando" | "chave-gemini";
let preparando: Motor | null = null;
let etapa: Etapa = "explica";
let recadoInstalar = "";
let redesenharPreparo: () => void = () => {};
/** Resultado de "já entrou na conta?" (para o cartão dizer "falta entrar"). */
const contaOk = new Map<Motor, boolean>();
let vigiaLogin = 0;

const CONTA: Partial<Record<Motor, string>> = {
  claude: "a sua conta da Claude (assinatura Pro ou Max)",
  codex: "a sua conta do ChatGPT (assinatura Plus ou Pro)",
};

function preparar(m: Motor, e: Etapa, recado = ""): void {
  preparando = m;
  etapa = e;
  recadoInstalar = recado;
  redesenharPreparo();
}

function terminarPreparo(m: Motor, recado: string): void {
  window.clearInterval(vigiaLogin);
  contaOk.set(m, true);
  preparando = null;
  recadoInstalar = "";
  nova.motor = m;
  nova.modelo = "";
  nova.esforco = "";
  recadoPronto = recado;
  redesenharPreparo();
}
/** Recado curto depois de preparar ("Pronto! …"). */
let recadoPronto = "";

/** Confere se já entrou na conta; se não, abre o passo de entrar (ou da chave). */
function conferirConta(m: Motor): void {
  if (!["claude", "codex", "gemini"].includes(m)) return;
  contaMotor(m)
    .then((ok) => {
      if (ok === null) return;
      contaOk.set(m, ok);
      if (!ok && nova.motor === m && !preparando) preparar(m, m === "gemini" ? "chave-gemini" : "entrar");
      else redesenharPreparo();
    })
    .catch(() => {});
}

function caixaInstalar(m: Motor): string {
  const nome = NOMES_MOTORES[m];
  const recado = recadoInstalar ? `<p class="secundario">${escapar(recadoInstalar)}</p>` : "";
  const fechar = `<button type="button" class="botao" data-acao="instalar-nao">Fechar</button>`;
  let corpo = "";
  if (etapa === "explica")
    corpo = `<p>O ${nome} não está instalado neste computador. Ele usa ${CONTA[m] ?? "a sua conta"}, sem chave e sem custo extra. A ilha instala sozinha (instalador oficial, sem precisar de administrador) e depois abre o navegador para você entrar na conta, uma vez só.</p>
      <div class="linha"><button type="button" class="botao ciano" data-acao="instalar">Instalar e conectar</button>${fechar}</div>`;
  else if (etapa === "confirma")
    corpo = `<p class="principal">Posso instalar o ${nome}? Leva de 1 a 3 minutos e acontece por trás, sem janelas. Depois eu abro o navegador para você entrar na sua conta.</p>
      <div class="linha"><button type="button" class="botao" data-acao="instalar-nao">Agora não</button><button type="button" class="botao ciano" data-acao="instalar-sim">Sim, pode instalar</button></div>`;
  else if (etapa === "instalando")
    corpo = `<p class="linha"><span class="ponto gravando esperando"></span><span class="principal">Instalando o ${nome}… (1 a 3 minutos)</span></p><p class="secundario">Pode continuar usando o computador.</p>`;
  else if (etapa === "entrar")
    corpo = `<p>O ${nome} está instalado. Falta entrar com ${CONTA[m] ?? "a sua conta"} (uma vez só). Vou abrir o navegador: entre na conta e volte aqui, eu percebo sozinho.</p>
      <div class="linha"><button type="button" class="botao ciano" data-acao="entrar-conta">Entrar com a minha conta</button>${fechar}</div>`;
  else if (etapa === "esperando")
    corpo = `<p class="linha"><span class="ponto gravando esperando"></span><span class="principal">Abri o navegador: entre na sua conta e volte aqui.</span></p>
      <p class="secundario">Se o navegador não abriu, clique de novo em “Entrar”.</p>
      <div class="linha"><button type="button" class="botao" data-acao="entrar-conta">Entrar de novo</button>${fechar}</div>`;
  else if (etapa === "chave-gemini")
    corpo = `<p>Desde junho de 2026, o Gemini CLI só funciona com a <strong>chave paga da API do Gemini</strong> (o login com a conta Google deixou de valer nele). Se você tem a assinatura Google AI Pro, use o <strong>Antigravity</strong>, que já funciona com ela.</p>
      <form class="linha form-chave-gemini"><input class="entrada" type="password" placeholder="Cole aqui a chave da API do Gemini" autocomplete="off" spellcheck="false" aria-label="Chave da API do Gemini"><button type="submit" class="botao ciano">Guardar</button></form>
      <div class="linha"><button type="button" class="botao" data-acao="usar-antigravity">Usar o Antigravity</button><button type="button" class="link" data-acao="como-chave-gemini">Como pegar a chave</button>${fechar}</div>`;
  return `<div class="caixa-instalar">${corpo}${recado}</div>`;
}

// Escolhas para a próxima conversa nova.
let novoProjeto: string | null = null;
let novoModo: "conversar" | "editar" = "conversar";
let novoPerfil: string | null = null;
const nova: Escolhas = { motor: "deepseek", modelo: "", esforco: "", mcps: [], skills: [] };
let redesenharTudo: () => void = () => {};

export function conversaRodando(): boolean {
  return rodando.size > 0;
}

/** Para uma conversa (pedido vindo da ilha, pelo botão Parar). */
export function pararPeloId(id: string): void {
  pararConversa(id).catch(() => {});
}

/** Busca (uma vez) os modelos que o Antigravity ou a DeepSeek informam. */
function buscarModelos(motor: Motor, depois: () => void): void {
  if ((motor !== "antigravity" && motor !== "deepseek") || buscouModelos.has(motor) || !disponiveis[motor]) return;
  buscouModelos.add(motor);
  listarModelos(motor)
    .then((l) => {
      if (!l.length) return;
      guardarModelosExtras(motor, l);
      depois();
    })
    .catch(() => {});
}

/** Selects de modelo e raciocínio + marcas de MCPs e skills. */
function campoEscolhas(e: Escolhas, d: Dados): string {
  const opcoes = (lista: { valor: string; nome: string }[], escolhido: string) =>
    lista.map((o) => `<option value="${escapar(o.valor)}" ${o.valor === escolhido ? "selected" : ""}>${escapar(o.nome)}</option>`).join("");
  const esforcos = esforcosDe(e.motor, e.esforco);
  const marcas = (lista: { id: string; nome: string; descricao: string }[], ligados: string[], grupo: string) =>
    lista
      .map(
        (x) => `
      <label class="marca-item"><input type="checkbox" data-grupo="${grupo}" value="${x.id}" ${ligados.includes(x.id) ? "checked" : ""}>
        <span class="coluna"><span class="principal">${escapar(x.nome)}</span>${x.descricao ? `<span class="secundario">${escapar(x.descricao)}</span>` : ""}</span></label>`,
      )
      .join("");
  const ligados = e.mcps.filter((id) => d.mcps.some((m) => m.id === id)).length + e.skills.filter((id) => d.skills.some((s) => s.id === id)).length;
  const temFerramentas = d.mcps.length + d.skills.length > 0;
  return `
    <label class="campo-inline">Modelo<select class="entrada" data-campo="modelo">${opcoes(modelosDe(e.motor, e.modelo), e.modelo)}</select></label>
    ${
      e.motor === "deepseek"
        ? `<label class="campo-inline">Pensar antes de responder<select class="entrada" data-campo="pensar">
            <option value="sim" ${e.esforco !== "none" ? "selected" : ""}>Sim</option>
            <option value="nao" ${e.esforco === "none" ? "selected" : ""}>Não (mais rápido)</option>
          </select></label>
          <label class="campo-inline campo-quanto" ${e.esforco === "none" ? "hidden" : ""}>Quanto pensar<select class="entrada" data-campo="esforco">
            <option value="">Alto (padrão)</option>
            <option value="max" ${e.esforco === "max" ? "selected" : ""}>Máximo</option>
          </select></label>`
        : esforcos.length > 1 && !e.modelo.startsWith("Orchestrator")
          ? `<label class="campo-inline">Raciocínio<select class="entrada" data-campo="esforco">${opcoes(esforcos, e.esforco)}</select></label>`
          : ""
    }
    ${
      temFerramentas
        ? `<details class="escolha-ferramentas">
        <summary class="botao">MCPs e skills${ligados ? ` (${ligados})` : ""}</summary>
        <div class="caixa-ferramentas">
          ${d.mcps.length ? `<p class="titulo-secao">MCPs</p>${USAM_MCP.includes(e.motor) ? "" : `<p class="secundario">${NOMES_MOTORES[e.motor]} ainda não recebe MCPs da ilha.</p>`}${marcas(d.mcps, e.mcps, "mcps")}` : ""}
          ${d.skills.length ? `<p class="titulo-secao">Skills</p>${marcas(d.skills, e.skills, "skills")}` : ""}
          <p class="secundario">Valem a partir da próxima mensagem. Os MCPs que o programa já tem continuam ligados.</p>
        </div>
      </details>`
        : ""
    }`;
}

/** Liga os campos de campoEscolhas ao objeto de escolhas. */
function ligarEscolhas(raiz: HTMLElement, e: Escolhas, aoMudar: (redesenhar: boolean) => void): void {
  raiz.querySelector<HTMLSelectElement>('[data-campo="modelo"]')?.addEventListener("change", (ev) => {
    e.modelo = (ev.target as HTMLSelectElement).value;
    aoMudar(false);
  });
  raiz.querySelector<HTMLSelectElement>('[data-campo="esforco"]')?.addEventListener("change", (ev) => {
    e.esforco = (ev.target as HTMLSelectElement).value;
    aoMudar(false);
  });
  // DeepSeek: "pensar ou não" e "quanto pensar" são duas escolhas (guardadas juntas).
  raiz.querySelector<HTMLSelectElement>('[data-campo="pensar"]')?.addEventListener("change", (ev) => {
    const pensa = (ev.target as HTMLSelectElement).value === "sim";
    const quanto = raiz.querySelector<HTMLElement>(".campo-quanto");
    if (quanto) quanto.hidden = !pensa;
    e.esforco = pensa ? (raiz.querySelector<HTMLSelectElement>('.campo-quanto select')?.value ?? "") : "none";
    aoMudar(false);
  });
  raiz.querySelectorAll<HTMLInputElement>("[data-grupo]").forEach((caixa) =>
    caixa.addEventListener("change", () => {
      const grupo = caixa.dataset.grupo as "mcps" | "skills";
      const lista = e[grupo].filter((x) => x !== caixa.value);
      if (caixa.checked) lista.push(caixa.value);
      e[grupo] = lista;
      const resumo = raiz.querySelector(".escolha-ferramentas summary");
      const total = raiz.querySelectorAll<HTMLInputElement>("[data-grupo]:checked").length;
      if (resumo) resumo.textContent = `MCPs e skills${total ? ` (${total})` : ""}`;
      aoMudar(false);
    }),
  );
}

function novaConversa(): Conversa {
  const projeto = ler().projetos.find((p) => p.id === novoProjeto);
  return {
    id: novoId(),
    titulo: "",
    motor: nova.motor,
    sessao: null,
    projetoId: projeto?.id ?? null,
    pasta: projeto?.pasta ?? null,
    modo: EDITAM.includes(nova.motor) ? novoModo : "conversar",
    perfilId: novoPerfil,
    modelo: nova.modelo,
    esforco: nova.esforco,
    mcps: [...nova.mcps],
    skills: [...nova.skills],
    mensagens: [],
    criada: Date.now(),
    atualizada: Date.now(),
  };
}

async function enviar(c: Conversa, texto: string, anexos: string[], aoMudar: () => void): Promise<void> {
  const inicio = Date.now();
  const resposta = await responder(c, texto, anexos, aoMudar, () => {
    if (!conversas().includes(c)) adicionarConversa(c);
    else salvarConversas();
    rodando.set(c.id, Date.now());
    emit("ilha:trabalho", { id: c.id, titulo: c.titulo, motor: c.motor }).catch(() => {});
  });
  rodando.delete(c.id);
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
  if (m.papel === "voce") {
    const anexos = (m.anexos ?? []).map((a) => `<span class="chip-anexo" title="${escapar(a)}">${ICONES.clipe}${escapar(nomeDo(a))}</span>`).join("");
    return `<div class="bolha voce">${anexos ? `<div class="anexos-msg">${anexos}</div>` : ""}${escapar(m.texto).replace(/\n/g, "<br>")}</div>`;
  }
  const ferramentas = (m.ferramentas ?? [])
    .map((f) => `<span class="uso-ferramenta"><b>${escapar(FERRAMENTAS[f.nome] ?? f.nome)}</b> ${escapar(f.detalhe)}</span>`)
    .join("");
  const corpo = m.texto ? textoRico(m.texto) : "";
  const pensando = ativa && !m.texto ? '<span class="digitando"><i></i><i></i><i></i></span>' : "";
  const raciocinio = m.pensamento
    ? `<details class="pensamento" ${ativa && !m.texto ? "open" : ""}><summary>${ativa && !m.texto ? "Pensando…" : "Como pensou"}</summary><div>${escapar(m.pensamento).replace(/\n/g, "<br>")}</div></details>`
    : "";
  const erro = m.erro && m.erro !== "Parado." ? `<p class="erro-msg">${escapar(m.erro)}</p>` : m.erro === "Parado." ? '<p class="secundario">Parado.</p>' : "";
  return `
    <div class="bolha robo">
      <span class="autor">${selo(SELO[motor], 14)}${NOMES_MOTORES[motor]}</span>
      ${raciocinio}
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
    const d = ler();
    const projetos = d.projetos;
    const motor = nova.motor;
    const dica: Record<Motor, string> = {
      deepseek: "A DeepSeek responde rápido e lembra desta conversa. Não mexe em arquivos. O deepseek-flash também lê imagens.",
      claude:
        novoModo === "editar"
          ? "Ele trabalha na pasta do projeto (ou na sua pasta pessoal). Edita arquivos sozinho; o resto que precisar de permissão (rodar comandos, por exemplo) a ilha pergunta para você antes, com Sim e Não."
          : "Ele trabalha na pasta do projeto (ou na sua pasta pessoal) e só lê. Para ele mudar arquivos e pedir para rodar comandos, escolha “Pode editar arquivos”.",
      codex: "Ele trabalha na pasta do projeto (ou na sua pasta pessoal). O Codex não tem um jeito oficial de pedir permissão a outro programa, então comandos fora da pasta ficam bloqueados.",
      antigravity:
        novoModo === "editar"
          ? "Atenção: com “Pode editar arquivos”, o Antigravity aprova tudo sozinho, inclusive rodar comandos no computador, sem perguntar. Precisa do agy instalado e com login feito uma vez no terminal."
          : "Precisa do Antigravity CLI (agy) instalado e com login feito uma vez no terminal. Em “Só conversar e ler”, ele recusa sozinho o que precisaria da sua aprovação.",
      gemini: "Atenção: desde junho de 2026 o Gemini CLI só funciona com chave paga da API do Gemini. Com a assinatura Google AI Pro, use o Antigravity (é lá que estão os modelos Gemini 4).",
    };
    painel.innerHTML = `
      <div class="comeco">
        ${
          d.perfis.length
            ? `<p class="titulo-comeco">Começar com um perfil</p>
          <div class="perfis-rapidos">
            <button type="button" class="chip-perfil ${novoPerfil ? "" : "ativo"}" data-acao="perfil" data-id="">Sem perfil</button>
            ${d.perfis
              .map(
                (p) =>
                  `<button type="button" class="chip-perfil ${p.id === novoPerfil ? "ativo" : ""}" data-acao="perfil" data-id="${p.id}" ${disponiveis[p.motor] ? "" : "disabled"} title="${escapar(NOMES_MOTORES[p.motor])}">${selo(SELO[p.motor], 14)}${escapar(p.nome)}</button>`,
              )
              .join("")}
          </div>`
            : ""
        }
        <p class="titulo-comeco">Com quem você quer conversar?</p>
        <div class="motores">
          ${MOTORES.map(
            (m) => `
            <button type="button" class="cartao-motor ${m === motor ? "ativo" : ""} ${(!disponiveis[m] && INSTALAVEIS.includes(m)) || contaOk.get(m) === false ? "faltando" : ""} ${m === preparando ? "ativo" : ""}" data-acao="${!disponiveis[m] && INSTALAVEIS.includes(m) ? "como-instalar" : "motor"}" data-motor="${m}" ${disponiveis[m] || INSTALAVEIS.includes(m) ? "" : "disabled"}>
              ${selo(SELO[m], 22)}
              <span class="principal">${NOMES_MOTORES[m]}</span>
              <span class="secundario">${
                !disponiveis[m]
                  ? m === "deepseek"
                    ? "Falta a chave (Ajustes › Chaves de IA)"
                    : INSTALAVEIS.includes(m)
                      ? "Não está instalado · clique para instalar"
                      : "Não encontrei instalado"
                  : contaOk.get(m) === false
                    ? m === "gemini"
                      ? "Falta a chave paga da API · clique"
                      : "Instalado · falta entrar na conta"
                    : DESCRICOES[m]
              }</span>
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
          ${campoEscolhas(nova, d)}
          ${
            EDITAM.includes(motor)
              ? `<div class="segmentos" role="radiogroup" aria-label="O que ele pode fazer">
                  <button type="button" class="segmento" role="radio" aria-checked="${novoModo === "conversar"}" data-acao="modo" data-modo="conversar">Só conversar e ler</button>
                  <button type="button" class="segmento" role="radio" aria-checked="${novoModo === "editar"}" data-acao="modo" data-modo="editar">Pode editar arquivos</button>
                </div>`
              : ""
          }
        </div>
        <p class="secundario dica-nova">${dica[motor]}</p>
        ${preparando ? caixaInstalar(preparando) : recadoPronto ? `<p class="secundario recado-pronto">${escapar(recadoPronto)}</p>` : ""}
      </div>`;
    const refazer = () => {
      desenharNova();
      painel.append(compositor(null));
    };
    aoClicar(painel, "perfil", (b) => {
      const p = d.perfis.find((x) => x.id === b.dataset.id);
      novoPerfil = p?.id ?? null;
      if (p) {
        Object.assign(nova, { motor: p.motor, modelo: p.modelo, esforco: p.esforco, mcps: [...p.mcps], skills: [...p.skills] });
        novoModo = p.modo;
      } else Object.assign(nova, { modelo: "", esforco: "", mcps: [], skills: [] });
      refazer();
    });
    aoClicar(painel, "motor", (b) => {
      recadoPronto = "";
      if (preparando && preparando !== b.dataset.motor) preparando = null;
      conferirConta(b.dataset.motor as Motor);
      if (nova.motor !== b.dataset.motor) {
        // Trocar de motor sai do perfil (e das ferramentas que vieram dele).
        if (novoPerfil) Object.assign(nova, { mcps: [], skills: [] });
        nova.motor = b.dataset.motor as Motor;
        nova.modelo = "";
        nova.esforco = "";
        novoPerfil = null;
      }
      refazer();
    });
    aoClicar(painel, "modo", (b) => {
      novoModo = b.dataset.modo as "conversar" | "editar";
      refazer();
    });
    // Preparar Claude Code / Codex / Gemini CLI: instalar, entrar na conta, chave.
    redesenharPreparo = () => painel.isConnected && refazer();
    aoClicar(painel, "como-instalar", (b) => preparar(b.dataset.motor as Motor, "explica"));
    aoClicar(painel, "instalar", () => preparar(preparando!, "confirma"));
    aoClicar(painel, "instalar-nao", () => {
      window.clearInterval(vigiaLogin);
      preparando = null;
      recadoInstalar = "";
      refazer();
    });
    aoClicar(painel, "instalar-sim", () => {
      const m = preparando;
      if (!m) return;
      preparar(m, "instalando");
      instalarMotor(m)
        .then(() => motoresDisponiveis())
        .then((l) => {
          l.forEach((x) => (disponiveis[x.motor] = x.encontrado));
          return contaMotor(m);
        })
        .then((ok) => {
          if (ok) terminarPreparo(m, `Pronto! O ${NOMES_MOTORES[m]} já está funcionando.`);
          else preparar(m, "entrar");
        })
        .catch((e) => preparar(m, "explica", String(e)));
    });
    aoClicar(painel, "entrar-conta", () => {
      const m = preparando;
      if (!m) return;
      entrarMotor(m)
        .then(() => {
          preparar(m, "esperando");
          window.clearInterval(vigiaLogin);
          const comeco = Date.now();
          vigiaLogin = window.setInterval(() => {
            if (Date.now() - comeco > 10 * 60_000) {
              window.clearInterval(vigiaLogin);
              return preparar(m, "entrar", "Não percebi o login. Tente de novo.");
            }
            contaMotor(m)
              .then((ok) => ok && terminarPreparo(m, `Pronto! Você entrou na sua conta e o ${NOMES_MOTORES[m]} já está funcionando.`))
              .catch(() => {});
          }, 3000);
        })
        .catch((e) => preparar(m, "entrar", String(e)));
    });
    painel.querySelector<HTMLFormElement>(".form-chave-gemini")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const campo = (e.target as HTMLFormElement).querySelector("input")!;
      if (!campo.value.trim()) return;
      salvarChave("gemini", campo.value.trim())
        .then(() => terminarPreparo("gemini", "Chave guardada no cofre do Windows. O Gemini CLI já pode responder."))
        .catch((erro) => preparar("gemini", "chave-gemini", String(erro)));
    });
    aoClicar(painel, "como-chave-gemini", () => {
      abrirPrograma("https://aistudio.google.com/apikey").catch(() => {});
    });
    aoClicar(painel, "usar-antigravity", () => terminarPreparo("antigravity", ""));
    painel.querySelector<HTMLSelectElement>('[data-campo="projeto"]')!.addEventListener("change", (e) => {
      novoProjeto = (e.target as HTMLSelectElement).value || null;
    });
    ligarEscolhas(painel.querySelector(".opcoes-nova")!, nova, () => {});
    buscarModelos(motor, () => !atualId && painel.isConnected && refazer());
  };

  const compositor = (c: Conversa | null): HTMLElement => {
    const ocupado = c ? rodando.has(c.id) : false;
    const caixa = html(`
      <form class="compositor">
        <div class="anexos-pendentes"></div>
        <div class="linha-compositor">
          <button type="button" class="redondo" aria-label="Anexar arquivos" title="Anexar arquivos (ou arraste para a janela)" data-acao="anexar">${ICONES.clipe}</button>
          <button type="button" class="redondo" aria-label="Ditado" title="Ditado: fale e eu escrevo aqui (clique de novo para parar)" data-acao="ditado">${ICONES.microfone}</button>
          <textarea rows="1" placeholder="Escreva para ${escapar(ler().config.nomeRobo)}… (Enter envia, Shift+Enter pula linha)" aria-label="Mensagem">${escapar(rascunho)}</textarea>
          ${ocupado ? '<button type="button" class="botao" data-acao="parar">Parar</button>' : '<button type="submit" class="botao ciano">Enviar</button>'}
        </div>
      </form>`) as HTMLFormElement;
    const campo = caixa.querySelector("textarea")!;
    const listaAnexos = caixa.querySelector<HTMLElement>(".anexos-pendentes")!;
    const desenharAnexos = () => {
      listaAnexos.innerHTML = anexosPendentes
        .map(
          (a, i) =>
            `<span class="chip-anexo" title="${escapar(a)}">${ICONES.clipe}${escapar(nomeDo(a))}<button type="button" aria-label="Tirar ${escapar(nomeDo(a))}" data-tirar="${i}">×</button></span>`,
        )
        .join("");
      listaAnexos.hidden = !anexosPendentes.length;
      listaAnexos.querySelectorAll<HTMLElement>("[data-tirar]").forEach((b) =>
        b.addEventListener("click", () => {
          anexosPendentes.splice(Number(b.dataset.tirar), 1);
          desenharAnexos();
        }),
      );
    };
    aoMudarAnexos = desenharAnexos;
    desenharAnexos();
    aoClicar(caixa, "anexar", () => {
      escolherArquivos().then(anexar).catch(() => {});
    });
    // Ditado pelo ouvido da ilha: o que você fala vira texto no campo (não envia sozinho).
    const botaoDitado = caixa.querySelector<HTMLButtonElement>('[data-acao="ditado"]')!;
    aoClicar(caixa, "ditado", () => {
      if (ditando) {
        pararDeOuvir().catch(() => {});
        return;
      }
      ditando = true;
      botaoDitado.classList.add("ditando");
      botaoDitado.title = "Ouvindo… fale e espere. Clique para parar.";
      ouvir()
        .then((texto) => {
          const t = texto.trim();
          if (!t) return;
          campo.value = campo.value.trim() ? `${campo.value.trimEnd()} ${t}` : t;
          rascunho = campo.value;
          ajustar();
        })
        .catch((erro) => {
          campo.placeholder = String(erro);
          window.setTimeout(() => (campo.placeholder = `Escreva para ${ler().config.nomeRobo}… (Enter envia, Shift+Enter pula linha)`), 8000);
        })
        .finally(() => {
          ditando = false;
          botaoDitado.classList.remove("ditando");
          botaoDitado.title = "Ditado: fale e eu escrevo aqui (clique de novo para parar)";
          campo.focus();
        });
    });
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
      const texto = campo.value.trim() || (anexosPendentes.length ? "Veja os arquivos anexados." : "");
      if (!texto || ocupado) return;
      const conversa = c ?? novaConversa();
      if (!disponiveis[conversa.motor]) return;
      const anexos = anexosPendentes;
      anexosPendentes = [];
      rascunho = "";
      atualId = conversa.id;
      enviar(conversa, texto, anexos, () => (atualId === conversa.id ? desenharMensagens() : desenharLista()));
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
    const d = ler();
    const projeto = d.projetos.find((p) => p.id === c.projetoId);
    const perfil = d.perfis.find((p) => p.id === c.perfilId);
    const escolhas: Escolhas = { motor: c.motor, modelo: c.modelo ?? "", esforco: c.esforco ?? "", mcps: c.mcps ?? [], skills: c.skills ?? [] };
    const outros = MOTORES.filter((m) => m !== c.motor && disponiveis[m]);
    painel.innerHTML = `
      <header class="topo-conversa">
        ${selo(SELO[c.motor], 22)}
        <div class="coluna">
          <span class="principal">${escapar(c.titulo || "Conversa nova")}</span>
          <span class="secundario">${perfil ? `${escapar(perfil.nome)} · ` : ""}${NOMES_MOTORES[c.motor]}${c.modelo ? ` (${escapar(nomeDoModelo(c.motor, c.modelo))})` : ""}${c.esforco ? ` · raciocínio ${escapar(nomeDoEsforco(c.motor, c.esforco).toLowerCase())}` : ""}${projeto ? ` · ${escapar(projeto.nome)}` : c.pasta ? ` · ${escapar(c.pasta)}` : ""}${EDITAM.includes(c.motor) ? ` · ${c.modo === "editar" ? "pode editar arquivos" : "só conversa e lê"}` : ""}${c.custo ? ` · US$ ${c.custo.toFixed(2)}` : ""}</span>
        </div>
        <details class="menu-ajustes"><summary class="botao">Ajustes</summary><div class="opcoes-ajustes">${campoEscolhas(escolhas, d)}</div></details>
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

    const ajustes = painel.querySelector<HTMLElement>(".opcoes-ajustes")!;
    ligarEscolhas(ajustes, escolhas, () => {
      Object.assign(c, { modelo: escolhas.modelo, esforco: escolhas.esforco, mcps: escolhas.mcps, skills: escolhas.skills });
      salvarConversas();
    });
    // Fechar o menu de ajustes atualiza o resumo do topo.
    painel.querySelector(".menu-ajustes")!.addEventListener("toggle", (e) => {
      if (!(e.target as HTMLDetailsElement).open) desenharConversa(c);
    });
    buscarModelos(c.motor, () => atualId === c.id && painel.isConnected && desenharConversa(c));
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
      Object.assign(nova, { motor: destino, modelo: "", esforco: "", mcps: [...(c.mcps ?? [])], skills: [...(c.skills ?? [])] });
      novoPerfil = null;
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
    // Guarda a conversa aberta: a Central volta nela da próxima vez.
    lembrar("ilha-central-conversa", c ? c.id : "");
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
      if (!disponiveis[nova.motor]) nova.motor = MOTORES.find((m) => disponiveis[m]) ?? "deepseek";
      if (!atualId) desenharTudo();
      // Instalados, mas sem conta (ou sem chave): o cartão avisa "falta entrar".
      for (const m of ["claude", "codex", "gemini"] as Motor[])
        if (disponiveis[m])
          contaMotor(m)
            .then((ok) => {
              if (ok !== null) contaOk.set(m, ok);
              if (!atualId) redesenharPreparo();
            })
            .catch(() => {});
    })
    .catch(() => {});
  desenharTudo();
  return raiz;
}

/** Conversa rápida da ilha que continua aqui: passa a ser uma conversa da Central. */
export function importarConversa(c: Conversa): void {
  if (!c?.id || !Array.isArray(c.mensagens)) return;
  const existente = conversas().find((x) => x.id === c.id);
  if (existente) Object.assign(existente, c);
  else adicionarConversa(c);
  salvarConversas();
  atualId = c.id;
  redesenharTudo();
}

/** Abre a tela de conversa já pronta para escrever (botão Digitar da ilha). */
export function comecarNova(): void {
  atualId = null;
  redesenharTudo();
}
