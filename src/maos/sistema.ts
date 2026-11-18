// Pedidos ao lado Rust e aos plugins do Tauri. Fora do app (navegador de
// teste) tudo responde com valores neutros.
import { Channel, invoke } from "@tauri-apps/api/core";
import { enquanto } from "./foco";
import { open } from "@tauri-apps/plugin-dialog";
import * as inicioAutomatico from "@tauri-apps/plugin-autostart";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { dentroDoApp } from "../ponte";

export interface Midia {
  titulo: string;
  artista: string;
  tocando: boolean;
  capa: string | null;
}

export interface AvisoExterno {
  titulo: string;
  detalhe: string;
}

async function pedir<T>(comando: string, dados?: Record<string, unknown>, foraDoApp?: T): Promise<T> {
  if (!dentroDoApp) return foraDoApp as T;
  return invoke<T>(comando, dados);
}

export const abrirPrograma = (caminho: string) => pedir<void>("abrir_programa", { caminho });
export const abrirRegistros = () => pedir<void>("abrir_registros");
export const midiaAtual = (comCapa: boolean) => pedir<Midia | null>("midia_atual", { comCapa }, null);
export const midiaComando = (acao: "alternar" | "proxima" | "anterior") => pedir<void>("midia_comando", { acao });
export const definirAtalho = (atalho: string) => pedir<string>("definir_atalho", { atalho }, atalho);
export const atalhoAtual = () => pedir<string | null>("atalho_atual", undefined, "Super+Alt+I");
export const avisoPendente = () => pedir<AvisoExterno | null>("aviso_pendente", undefined, null);
export interface ProgramaInstalado {
  nome: string;
  caminho: string;
}

export type ProgramaIA = "claude" | "codex" | "gemini";

export interface SituacaoAviso {
  programa: ProgramaIA;
  encontrado: boolean;
  ligado: boolean;
}

export interface JanelaAtiva {
  programa: string;
  noTopo: boolean;
}

/** Liga a observação do programa em primeiro plano (só no modo discreto automático). */
export const vigiarJanelas = (ligar: boolean) => pedir<void>("vigiar_janelas", { ligar });

/** Programas com abas no topo, onde a ilha atrapalharia. */
export const PROGRAMAS_COM_ABAS: Record<string, string> = {
  "chrome.exe": "Chrome",
  "msedge.exe": "Edge",
  "opera.exe": "Opera",
  "firefox.exe": "Firefox",
  "brave.exe": "Brave",
  "vivaldi.exe": "Vivaldi",
  "arc.exe": "Arc",
  "zen.exe": "Zen",
  "explorer.exe": "Explorador de Arquivos",
  "windowsterminal.exe": "Terminal",
  "code.exe": "VS Code",
  "cursor.exe": "Cursor",
};

export const listarProgramas = () => pedir<ProgramaInstalado[]>("listar_programas", undefined, []);
export const situacaoAvisos = () =>
  pedir<SituacaoAviso[]>("situacao_avisos", undefined, [
    { programa: "claude", encontrado: true, ligado: true },
    { programa: "codex", encontrado: true, ligado: false },
    { programa: "gemini", encontrado: false, ligado: false },
  ]);
export const mudarAviso = (programa: ProgramaIA, ligar: boolean) => pedir<void>("mudar_aviso", { programa, ligar });

export async function iniciaComWindows(): Promise<boolean> {
  return dentroDoApp ? inicioAutomatico.isEnabled() : false;
}

export async function definirInicioComWindows(ligar: boolean): Promise<void> {
  if (!dentroDoApp) return;
  if (ligar) await inicioAutomatico.enable();
  else await inicioAutomatico.disable();
}

/** Janela do Windows para escolher um programa. Devolve o caminho ou null. */
export async function escolherPrograma(): Promise<string | null> {
  if (!dentroDoApp) return null;
  const escolhido = await enquanto(open({
    title: "Escolha um programa ou atalho",
    multiple: false,
    directory: false,
    filters: [{ name: "Programas e atalhos", extensions: ["exe", "lnk", "url", "bat", "cmd", "appref-ms"] }],
  }));
  return typeof escolhido === "string" ? escolhido : null;
}

/** "Super+Alt+I" → "Win + Alt + I" */
export function atalhoLegivel(atalho: string | null): string {
  if (!atalho) return "nenhum";
  return atalho
    .split("+")
    .map((p) => ({ Super: "Win", Space: "Espaço", Ctrl: "Ctrl", Shift: "Shift", Alt: "Alt" })[p] ?? p)
    .join(" + ");
}

export interface Volume {
  nivel: number;
  mudo: boolean;
}

export const volumeAtual = () => pedir<Volume | null>("volume_atual", undefined, { nivel: 40, mudo: false });
export const definirVolume = (nivel?: number, mudo?: boolean) => pedir<void>("definir_volume", { nivel, mudo });
export const esconderEmTelaCheia = (ligar: boolean) => pedir<void>("esconder_em_tela_cheia", { ligar });

export interface Diagnostico {
  processador: number;
  memoria_usada_gb: number;
  memoria_total_gb: number;
  disco_livre_gb: number;
  disco_total_gb: number;
  ligado_horas: number;
  temporarios_mb: number;
  pesados: { nome: string; memoria_mb: number }[];
}

export const diagnosticoPc = () =>
  pedir<Diagnostico | null>("diagnostico_pc", undefined, {
    processador: 23,
    memoria_usada_gb: 11.2,
    memoria_total_gb: 16,
    disco_livre_gb: 48,
    disco_total_gb: 476,
    ligado_horas: 81,
    temporarios_mb: 1840,
    pesados: [
      { nome: "chrome", memoria_mb: 3120 },
      { nome: "InDesign", memoria_mb: 1450 },
      { nome: "Claude", memoria_mb: 610 },
    ],
  });
export const limparTemporarios = () => pedir<number>("limpar_temporarios", undefined, 0);

/** Copia um texto para a área de transferência. */
export async function copiar(texto: string): Promise<void> {
  if (dentroDoApp) await writeText(texto);
  else await navigator.clipboard.writeText(texto);
}

/** O texto que está copiado agora ("" se não for texto). */
export async function lerCopiado(): Promise<string> {
  try {
    return dentroDoApp ? ((await readText()) ?? "") : await navigator.clipboard.readText();
  } catch {
    return "";
  }
}

export type AcaoTexto = "corrigir" | "traduzir" | "resumir" | "melhorar";
/** IA rápida (DeepSeek) sobre um texto: devolve só o texto pronto. */
export const transformarTexto = (acao: AcaoTexto, texto: string) =>
  pedir<string>("transformar_texto", { acao, texto }, `(${acao}) ${texto}`);

// ---------- Chaves de IA (ficam no cofre do Windows; a interface nunca lê a chave) ----------

export const salvarChave = (provedor: string, chave: string) => pedir<void>("salvar_chave", { provedor, chave });
export const temChave = (provedor: string) => pedir<boolean>("tem_chave", { provedor }, false);
export const apagarChave = (provedor: string) => pedir<void>("apagar_chave", { provedor });
export const testarDeepseek = () => pedir<string>("testar_deepseek", undefined, "Funcionando! (teste)");

// ---------- Tradução da tela ----------

export interface LinhaLida {
  texto: string;
  x: number;
  y: number;
  largura: number;
  altura: number;
}

export interface Captura {
  imagem: string;
  largura: number;
  altura: number;
  linhas: LinhaLida[];
}

export const traduzirTela = () => pedir<void>("traduzir_tela");
export const capturaAtual = () => pedir<Captura | null>("captura_atual", undefined, null);
export const traduzirLinhas = (linhas: string[]) => pedir<string[]>("traduzir_linhas", { linhas }, linhas.map((l) => `[pt] ${l}`));
export const fecharTraducao = () => pedir<void>("fechar_traducao");

// ---------- Histórico das traduções ----------

export interface ItemTraducao {
  id: string;
  /** Segundos desde 1970. */
  data: string;
  programa: string;
  original: string;
  traducao: string;
}

export const salvarTraducao = (original: string, traducao: string, recorte: [number, number, number, number]) =>
  pedir<void>("salvar_traducao", { original, traducao, recorte });
export const listarTraducoes = () =>
  pedir<ItemTraducao[]>("listar_traducoes", undefined, [
    {
      id: "1",
      data: String(Math.floor(Date.now() / 1000) - 3600),
      programa: "chrome.exe",
      original: "Usage limits reset every Tuesday at 6:32 PM.",
      traducao: "Os limites de uso são redefinidos toda terça às 18:32.",
    },
    {
      id: "2",
      data: String(Math.floor(Date.now() / 1000) - 86400 * 2),
      programa: "InDesign.exe",
      original: "Package\nCollects all fonts and linked graphics.",
      traducao: "Empacotar\nReúne todas as fontes e imagens vinculadas.",
    },
  ]);
export const imagemTraducao = (id: string) => pedir<string | null>("imagem_traducao", { id }, null);
export const apagarTraducao = (id: string) => pedir<void>("apagar_traducao", { id });

/** "chrome.exe" → "Chrome"; desconhecido: o nome sem ".exe". */
export function nomeDoPrograma(exe: string): string {
  if (!exe) return "";
  return PROGRAMAS_COM_ABAS[exe.toLowerCase()] ?? exe.replace(/\.exe$/i, "");
}

// ---------- Central e conversa ----------

export type Motor = "deepseek" | "claude" | "codex" | "gemini" | "antigravity";

export const NOMES_MOTORES: Record<Motor, string> = {
  deepseek: "DeepSeek",
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
  antigravity: "Antigravity",
};

export type EventoMotor =
  | { tipo: "sessao"; id: string }
  | { tipo: "texto"; texto: string }
  | { tipo: "pensamento"; texto: string }
  | { tipo: "ferramenta"; nome: string; detalhe: string }
  | { tipo: "fim"; erro: string | null; custo: number | null };

export interface PedidoConversa {
  conversaId: string;
  motor: Motor;
  mensagens: { papel: string; texto: string }[];
  prompt: string;
  sessao: string | null;
  pasta: string | null;
  modo: "conversar" | "editar";
  sistema: string;
  anexos: string[];
  /** "" = o padrão do programa. */
  modelo: string;
  esforco: string;
  /** Servidores MCP da ilha ligados nesta conversa. */
  mcps: { nome: string; tipo: string; comando: string; argumentos: string[]; url: string; segredos: string[] }[];
  /** Nomes de todos os MCPs da ilha (para deixar de fora os não escolhidos). */
  mcpsDaIlha: string[];
}

export const abrirCentral = (tela?: string, anexos?: string[], conversa?: unknown) =>
  pedir<void>("abrir_central", { tela: tela ?? null, anexos: anexos ?? null, conversa: conversa ?? null });
export const telaInicialCentral = () =>
  pedir<{ tela: string | null; anexos: string[]; conversa: unknown }>("tela_inicial_central", undefined, {
    tela: null,
    anexos: [],
    conversa: null,
  });
export const motoresDisponiveis = () =>
  pedir<{ motor: Motor; encontrado: boolean }[]>("motores_disponiveis", undefined, [
    { motor: "deepseek", encontrado: true },
    { motor: "claude", encontrado: true },
    { motor: "codex", encontrado: true },
    { motor: "gemini", encontrado: false },
    { motor: "antigravity", encontrado: true },
  ]);
/** Modelos que o programa/API informa (Antigravity e DeepSeek). */
export const listarModelos = (motor: Motor) =>
  pedir<string[]>("listar_modelos", { motor }, motor === "antigravity" ? ["gemini-3.8-flash-medium", "gemini-4-hydrogen-high"] : []);
/** Esconde a ilha grande (ela continua viva por trás, terminando conversas). */
export const esconderCentral = () => pedir<void>("esconder_central");
/** A janela da frente do Windows: se é da ilha, ou uma "intrusa" (terminal que abriu sozinho). */
export interface Frente {
  id: number;
  nossa: boolean;
  intrusa: boolean;
  programa: string;
  anterior_existe: boolean;
}
export const janelaDaFrente = (anterior?: number) =>
  pedir<Frente>("janela_da_frente", { anterior: anterior ?? null }, { id: 0, nossa: true, intrusa: false, programa: "", anterior_existe: false });
/** Escuta uma frase pelo microfone (reconhecimento de fala do Windows). */
export const ouvir = () => pedir<string>("ouvir", undefined, "que horas são");
export const pararDeOuvir = () => pedir<void>("parar_de_ouvir");
/** Liga/desliga ouvir o nome do robô para ele atender. */
export const atenderPeloNome = (ligar: boolean, nome: string) => pedir<void>("atender_pelo_nome", { ligar, nome });
// ---------- Calendário da Apple (iCloud) ----------

export interface Calendario {
  url: string;
  nome: string;
}
export interface EventoCalendario {
  uid: string;
  titulo: string;
  notas: string;
  inicio: string;
  repete: string;
  alertaMinutos: number | null;
  duracaoMinutos?: number | null;
}
export interface EventoLido {
  calendario: string;
  titulo: string;
  inicio: string;
  fim: string;
  local: string;
}
export const icloudEventos = (email: string, inicio: string, fim: string) => pedir<EventoLido[]>("icloud_eventos", { email, inicio, fim }, []);
export const icloudConectar = (email: string, senha: string) =>
  pedir<Calendario[]>("icloud_conectar", { email, senha }, [{ url: "https://exemplo/cal/home/", nome: "Casa" }]);
export const icloudCalendarios = (email: string) => pedir<Calendario[]>("icloud_calendarios", { email }, []);
export const icloudDesconectar = () => pedir<void>("icloud_desconectar");
export const icloudConectado = () => pedir<boolean>("icloud_conectado", undefined, false);
export const icloudEnviar = (email: string, calendario: string, eventos: EventoCalendario[], apagar: string[]) =>
  pedir<string[]>("icloud_enviar", { email, calendario, eventos, apagar }, [...eventos.map((e) => e.uid), ...apagar]);

/** Skills instaladas no Claude Code (~/.claude/skills), para importar. */
export const skillsDoClaude = () =>
  pedir<{ nome: string; descricao: string; instrucoes: string }[]>("skills_do_claude", undefined, [
    { nome: "revisor", descricao: "Revisa textos", instrucoes: "Revise com cuidado." },
  ]);

// ---------- Copiados (histórico do Ctrl+C) ----------

export interface Copiado {
  id: string;
  tipo: "texto" | "imagem" | "arquivos";
  /** Miniatura da imagem (data URL), quando é imagem. */
  miniatura: string;
  texto: string;
  quando: number;
  fixo: boolean;
  programa: string;
}
export const copiadosListar = () =>
  pedir<Copiado[]>("copiados_listar", undefined, [
    { id: "1", tipo: "texto", miniatura: "", texto: "chave-pix@exemplo.com", quando: Date.now() - 60_000, fixo: true, programa: "chrome.exe" },
    { id: "4", tipo: "imagem", miniatura: "/robozinho.png", texto: "Imagem 1920×1080", quando: Date.now() - 600_000, fixo: false, programa: "snippingtool.exe" },
    { id: "5", tipo: "arquivos", miniatura: "", texto: "C:\\Users\\Dan\\Livro\\capitulo1.indd\nC:\\Users\\Dan\\Livro\\capa.psd", quando: Date.now() - 1_800_000, fixo: false, programa: "explorer.exe" },
    { id: "2", tipo: "texto", miniatura: "", texto: "Rua das Flores, 123 — Centro", quando: Date.now() - 3_600_000, fixo: false, programa: "winword.exe" },
  ]);
export const copiadosFixar = (id: string) => pedir<void>("copiados_fixar", { id });
export const copiadosApagar = (id: string) => pedir<void>("copiados_apagar", { id });
export const copiadosLimpar = () => pedir<void>("copiados_limpar");
export const copiadosCopiarImagem = (id: string) => pedir<void>("copiados_copiar_imagem", { id });
export const copiadosLigar = (ligar: boolean) => pedir<void>("copiados_ligar", { ligar });

/** O personagem sai da ilha e passeia pela tela. */
export const passear = () => pedir<void>("passear");
/** O Dan pegou o personagem com o mouse: ele sai da ilha pendurado no mouse. */
export const pegarPersonagem = () => pedir<void>("pegar_personagem");

/** Responde o "posso?" de uma IA (Sim ou Não). */
export const responderPermissao = (id: string, permitir: boolean) => pedir<void>("responder_permissao", { id, permitir });
/** Liga/desliga a carinha perceber o que o Dan faz (digitação, programa na frente). */
export const perceberAtividade = (ligar: boolean) => pedir<void>("perceber_atividade", { ligar });
/** Central como janela comum (true) ou como ilha grande (false). */
export const modoJanelaCentral = (janela: boolean) => pedir<void>("modo_central", { janela });

/** Janela do Windows para escolher arquivos para anexar. */
export async function escolherArquivos(): Promise<string[]> {
  if (!dentroDoApp) return [];
  const escolhidos = await enquanto(open({ title: "Anexar arquivos", multiple: true, directory: false }));
  return Array.isArray(escolhidos) ? escolhidos : typeof escolhidos === "string" ? [escolhidos] : [];
}

export const pararConversa = (conversaId: string) => pedir<void>("parar_conversa", { conversaId });
/** Instala o Claude Code ou o Codex por trás (1 a 3 minutos). Só depois de o Dan confirmar. */
export const instalarMotor = (motor: Motor) => pedir<void>("instalar_motor", { motor });
/** Abre o login da conta no navegador (Claude Code / Codex). */
export const entrarMotor = (motor: Motor) => pedir<void>("entrar_motor", { motor });
/** Já entrou na conta? (Gemini CLI: tem a chave paga.) `null` = não deu para saber. */
export const contaMotor = (motor: Motor) => pedir<boolean | null>("conta_motor", { motor }, motor !== "gemini");
export const abrirNoTerminal = (motor: Motor, sessao: string | null, pasta: string | null) =>
  pedir<void>("abrir_no_terminal", { motor, sessao, pasta });

/** Conversa com um motor; a resposta chega aos poucos em "aoEvento". */
export async function conversar(pedido: PedidoConversa, aoEvento: (e: EventoMotor) => void): Promise<void> {
  if (!dentroDoApp) {
    // Navegador de teste: finge uma resposta escrevendo aos poucos.
    aoEvento({ tipo: "sessao", id: "teste-123" });
    if (pedido.esforco && pedido.esforco !== "none") aoEvento({ tipo: "pensamento", texto: "Pensando em como responder de um jeito curto e claro…" });
    if (pedido.motor !== "deepseek") aoEvento({ tipo: "ferramenta", nome: "Read", detalhe: "PLANO.md" });
    const resposta = `Resposta de teste do **${NOMES_MOTORES[pedido.motor]}** para: “${pedido.prompt.slice(0, 60)}”.\n\n- primeiro ponto\n- segundo ponto\n\n\`\`\`\nexemplo de código\n\`\`\``;
    for (const pedaco of resposta.match(/.{1,12}/gs) ?? []) {
      await new Promise((r) => setTimeout(r, 40));
      aoEvento({ tipo: "texto", texto: pedaco });
    }
    aoEvento({ tipo: "fim", erro: null, custo: null });
    return;
  }
  const canal = new Channel<EventoMotor>();
  canal.onmessage = aoEvento;
  await invoke("conversar", { pedido, canal });
}

// ---------- Chaves dos MCPs (cofre do Windows) ----------

export const salvarSegredoMcp = (servidor: string, nome: string, valor: string) =>
  pedir<void>("salvar_segredo_mcp", { servidor, nome, valor });
export const temSegredoMcp = (servidor: string, nome: string) =>
  pedir<boolean>("tem_segredo_mcp", { servidor, nome }, false);

/** O que o Windows tem (ou não) para a ilha ouvir. `null` = não deu para saber. */
export interface EstadoVoz {
  microfone: boolean | null;
  microfone_liberado: boolean | null;
  microfone_bloqueado_no_pc: boolean;
  fala_online: boolean | null;
  pacote_pt: boolean | null;
  idiomas: string[];
  /** Idioma de fala do Windows (ex.: "en-US"). */
  idioma_windows: string | null;
  /** O ditado em português (Brasil) fica pronto de verdade. */
  ditado_pt: boolean | null;
}
export const conferirVoz = () =>
  pedir<EstadoVoz>("conferir_voz", undefined, {
    microfone: true,
    microfone_liberado: true,
    microfone_bloqueado_no_pc: false,
    fala_online: false,
    pacote_pt: false,
    idiomas: [],
    idioma_windows: "en-US",
    ditado_pt: false,
  });
/** Ouvido próprio da ilha (Whisper no PC): o que já baixou. */
export interface EstadoOuvido {
  pequeno: boolean;
  bom: boolean;
  baixando: boolean;
  baixado: number;
  total: number;
  erro: string | null;
  /** Quanto o último pedido levou para ser entendido (ms; 0 = nenhum ainda). */
  ultimo_ms: number;
  /** Tamanho dessa fala (ms de áudio). */
  fala_ms: number;
  /** Fios (núcleos) que o Whisper usa neste PC. */
  nucleos: number;
  /** Último problema do ouvido na nuvem (null = funcionou). */
  erro_nuvem: string | null;
  /** O último pedido foi entendido na nuvem. */
  pela_nuvem: boolean;
}
export const estadoOuvido = () =>
  pedir<EstadoOuvido>("estado_ouvido", undefined, { pequeno: false, bom: false, baixando: true, baixado: 120_000_000, total: 249_793_112, erro: null, ultimo_ms: 0, fala_ms: 0, nucleos: 4, erro_nuvem: null, pela_nuvem: false });
export const baixarOuvido = () => pedir<void>("baixar_ouvido");
/** Resultado do teste do ouvido (Ajustes › Voz). */
export interface TesteOuvido {
  microfone: string;
  pico: number;
  fala_ms: number;
  texto: string;
  ms: number;
  pela_nuvem: boolean;
  erro_nuvem: string | null;
}
export const testarOuvido = () =>
  pedir<TesteOuvido>("testar_ouvido", undefined, { microfone: "Microfone (teste)", pico: 0.4, fala_ms: 2100, texto: "teste de microfone", ms: 900, pela_nuvem: false, erro_nuvem: null });
/** Ouvido rápido (padrão) ou mais preciso (mais lento). Baixa o que faltar. */
export const escolherOuvido = (preciso: boolean, nuvem = false) => pedir<void>("escolher_ouvido", { preciso, nuvem });
/** Conserta um item ("fala_online", "microfone", "abrir_microfone", "pacote"). Só depois de o Dan confirmar. */
export const consertarVoz = (item: string) => pedir<void>("consertar_voz", { item });

/** Como está a escuta do nome ("chamar pelo nome"). */
export interface EstadoChamado {
  ligado: boolean;
  escutando: boolean;
  erro: string | null;
  ouviu: string | null;
}
export const estadoChamado = () =>
  pedir<EstadoChamado>("estado_chamado", undefined, { ligado: false, escutando: false, erro: null, ouviu: null });

/** Fala com a voz natural da ElevenLabs: devolve o MP3. */
export const falarNatural = (texto: string, voz: string, modelo: string) => invoke<unknown>("falar_natural", { texto, voz, modelo });
/** Voz Kokoro (no PC): devolve um WAV. */
export const falarKokoro = (texto: string, voz: string) => invoke<unknown>("falar_kokoro", { texto, voz });
export interface EstadoKokoro {
  pronta: boolean;
  baixando: boolean;
  baixado: number;
  total: number;
  erro: string | null;
}
export const estadoKokoro = () => pedir<EstadoKokoro>("estado_kokoro", undefined, { pronta: true, baixando: false, baixado: 0, total: 0, erro: null });
export const prepararKokoro = () => pedir<void>("preparar_kokoro");
export const aquecerKokoro = () => pedir<void>("aquecer_kokoro");
export interface VozNatural {
  id: string;
  nome: string;
  descricao: string;
}
export const vozesNaturais = () => pedir<VozNatural[]>("vozes_naturais", undefined, []);

export interface PastaAchada {
  caminho: string;
  nome: string;
  nota: number;
}
/** Procura pastas pelo nome (aproximado) em todos os discos. */
export const procurarPastas = (nome: string) => pedir<PastaAchada[]>("procurar_pastas", { nome }, []);
export const renovarPastas = () => pedir<void>("renovar_pastas");

/** Ditado em qualquer lugar: liga/troca o atalho. Devolve o atalho registrado. */
export const definirDitado = (ligado: boolean, atalho: string) => pedir<string | null>("definir_ditado", { ligado, atalho }, ligado ? atalho : null);
export interface PalavraDicionario {
  certo: string;
  errados: string[];
}
/** Palavras que o ouvido costuma errar (vale para tudo que a ilha ouve). */
export const definirDicionario = (palavras: PalavraDicionario[]) => pedir<void>("definir_dicionario", { palavras });
/** Quanto silêncio encerra um pedido falado (ms). */
export const definirEspera = (ms: number) => pedir<void>("definir_espera", { ms });
