// Onde a ilha guarda o que o Dan cadastra: assinaturas, lembretes, apps,
// notas e ajustes. Fica num arquivo "dados.json" na pasta do app no PC
// (%APPDATA%\com.danielsampaio.ilha). Nada disso vai para a internet.
import { emit, listen } from "@tauri-apps/api/event";
import { load, type Store } from "@tauri-apps/plugin-store";
import { dentroDoApp } from "../ponte";

export interface Assinatura {
  id: string;
  nome: string;
  valor: string;
  /** Dia do vencimento (1 a 31; em meses curtos vira o último dia). */
  dia: number;
  frequencia: "mensal" | "anual";
  /** Mês do vencimento (1 a 12), só para assinaturas anuais. */
  mes: number;
  /** Quantos dias antes começa o aviso laranja. */
  antecedencia: number;
  /** Vencimento (AAAA-MM-DD) já marcado como pago. */
  pagoAte: string | null;
}

/** Quando o limite de uma IA (ou outra coisa) volta/renova. */
export interface Redefinicao {
  id: string;
  nome: string;
  /** Próxima redefinição: AAAA-MM-DDTHH:MM, no horário do PC. */
  proxima: string;
  repete: "nao" | "diario" | "semanal" | "mensal";
  /** Quantos dias antes o robô mostra o sinal (0 = sem sinal). */
  avisarDias: number;
  /** Qual IA (para o símbolo). "auto" = descobre pelo nome. */
  ia?: "auto" | "claude" | "chatgpt" | "gemini" | "deepseek" | "outra";
}

export type ModoDiscreto = "desligado" | "automatico" | "sempre";

/** Versão antiga (até a 0.1.8): lembretes de uma vez só. */
interface LembreteAntigo {
  id: string;
  titulo: string;
  quando: string;
}

export interface AppLancador {
  id: string;
  nome: string;
  /** Caminho do programa/atalho no PC ou endereço de site (https://…). */
  caminho: string;
  cor: string;
}

export interface Subtarefa {
  id: string;
  texto: string;
  feita: boolean;
}

export interface Tarefa {
  id: string;
  texto: string;
  /** 0 = normal, 1 a 3 = importante (!, !!, !!!). */
  prioridade: number;
  /** Data (AAAA-MM-DD) ou data e hora (AAAA-MM-DDTHH:MM), opcional. */
  quando: string | null;
  feita: boolean;
  subtarefas: Subtarefa[];
}

export interface Habito {
  id: string;
  nome: string;
  /** Quantas vezes por dia (ex.: 8 copos de água). */
  meta: number;
  /** Quantas vezes em cada dia (AAAA-MM-DD → número). */
  registros: Record<string, number>;
}

export interface TextoRapido {
  id: string;
  nome: string;
  texto: string;
}

export interface Timer {
  id: string;
  nome: string;
  /** Quando termina (milissegundos desde 1970). */
  fim: number;
  minutos: number;
}

export interface PastaConhecida {
  nome: string;
  caminho: string;
  /** Quantas vezes foi aberta pela ilha. */
  usos: number;
  /** Fixada pelo Dan: sempre na lista. */
  fixa?: boolean;
  ultima: number;
}

export interface Nota {
  id: string;
  texto: string;
}

export interface Config {
  nome: string;
  /** Aparência do personagem. */
  corOlhos: string;
  /** Formato dos olhos abertos (redondos, grandes, pontinho…). */
  estiloOlhos: import("../corpo/carinha").EstiloOlhos;
  /** Personagens ilustrados na ilha fechada: só o rosto (viseira, o padrão) ou o corpo inteiro. */
  rostoNaIlha?: "rosto" | "corpo";
  /** Ouvido da ilha: "rápido" (padrão, modelo small) ou "preciso" (turbo, mais lento). */
  ouvidoPreciso?: boolean;
  /** Ouvido na nuvem (ElevenLabs em tempo real): bem mais rápido; gasta créditos dela. */
  ouvidoNuvem?: boolean;
  corBochechas: string;
  acessorio: "nenhum" | "chapeu" | "coroa" | "laco" | "oculos" | "fones" | "antena";
  /** Qual personagem (robô, gato, urso…). */
  personagem: import("../corpo/carinha").PersonagemId;
  /** Na ilha aberta: a cabeça do robô vermelho ou a carinha de pixel grande. */
  cabecaAberta: "robo" | "carinha";
  /** Já passou pela troca do padrão (robô vermelho → personagem escolhido). */
  cabecaRevista?: boolean;
  olhosSeguemMouse: boolean;
  /** Brincadeiras quando parado (pegar uma mosquinha…). */
  brincadeiras: boolean;
  /** Cochilar quando o mouse fica parado por 5 minutos. */
  cochilar: boolean;
  /** Nome do robô: é a palavra que vai chamá-lo quando a voz chegar (fase 3). */
  nomeRobo: string;
  /** Cor dos botões e destaques. */
  corDestaque: string;
  /** Tema de cores: "personagem" (padrão), "aurora" (a cor de destaque) ou um pronto. */
  tema?: string;
  /** Ilha vira um risquinho em repouso (sempre, ou com navegador na frente). */
  modoDiscreto: ModoDiscreto;
  /** Mostrar a música que está tocando na ilha fechada. */
  musicaNaIlha: boolean;
  /** Esconder a ilha em jogos, vídeos e apresentações em tela cheia. */
  esconderTelaCheia: boolean;
  /** A Central: "ilha" (cresce do topo) ou "janela" (janela comum, solta). */
  centralModo: "ilha" | "janela";
  /** Quem responde a conversa rápida da ilha: "motor:deepseek" ou "perfil:<id>". */
  conversaRapida: string;
  /** Modelo escolhido para a conversa rápida, por IA ("" = o padrão do programa). */
  modelosRapida?: Partial<Record<string, string>>;
  /** Conversa rápida: só conversar, ou fazer tudo no PC (pedindo "Posso?" no que não tem volta). */
  modoRapida?: "conversar" | "editar";
  /** Onde tocar a música pedida pelo nome (sem nada: Spotify se instalado, senão YouTube Music). */
  musicaOnde?: "youtube-music" | "youtube" | "spotify" | "deezer" | "apple-music";
  /** Um "plim" curtinho junto com o confete (sem: ligado). */
  somFesta?: boolean;
  /** Cidade para mostrar o tempo na tela inicial (vazio: não mostra). */
  cidade?: string;
  /** A primeira abertura guiada já foi feita (ou a ilha já tinha dados). */
  boasVindasFeita?: boolean;
  /** Silêncio (ms) que encerra um pedido falado: 900, 1400 (padrão) ou 2200. */
  esperaFala?: number;
  /** Ditado em qualquer lugar (atalho global). Ligado se não houver nada. */
  ditadoLigado?: boolean;
  /** Atalho do ditado (ex.: "Ctrl+Shift+Space"). */
  atalhoDitado?: string;
  /** Dicionário do ouvido: uma palavra por linha ("Certo = errado1, errado2"). */
  dicionario?: string;
  /** Pastas que o Dan usa (abertas pela ilha ou fixadas): a IA sempre sabe onde ficam. */
  pastas?: PastaConhecida[];
  /** Microfone com cancelamento de eco (interromper sem fone). Ligado se não houver nada. */
  microfoneComEco?: boolean;
  /** Mandar as memórias para as IAs. */
  usarMemoria: boolean;
  /** A carinha reage ao que o Dan faz (digitando, música, vídeo…). */
  perceberAtividade: boolean;
  /** Ler a resposta em voz alta quando o Dan falou a pergunta. */
  falarRespostas: boolean;
  /** Voz escolhida para falar ("" = a melhor em português que houver). */
  voz: string;
  /** Falar com a voz natural da ElevenLabs (precisa da chave). */
  vozNatural?: boolean;
  /** De onde vem a voz natural: Kokoro (grátis, no PC; o padrão) ou ElevenLabs. */
  vozMotor?: "kokoro" | "elevenlabs";
  /** Voz da Kokoro: Dora (feminina), Alex ou Santa (masculinas). */
  vozKokoro?: "dora" | "alex" | "santa";
  /** Voz da ElevenLabs escolhida (id) e o modelo. */
  vozElevenlabs?: string;
  modeloElevenlabs?: string;
  /** Ficar ouvindo o nome do robô para atender (microfone sempre ligado). */
  atenderPeloNome: boolean;
  /** Depois de responder em voz alta, volta a ouvir (conversa contínua). */
  conversaContinua: boolean;
  /** O personagem sai para passear sozinho de vez em quando. */
  passeios: boolean;
  /** Guardar o histórico do que é copiado (Ctrl+C). */
  copiadosLigado: boolean;
  /** Calendário da Apple (iCloud): e-mail do Apple ID e calendário escolhido. */
  icloudEmail: string;
  icloudCalendario: string;
  icloudNomeCalendario: string;
  /** Qual agenda a ilha usa: Apple (iCloud) ou Google. Sem: Apple. */
  agenda?: "icloud" | "google";
  /** Conta Google conectada (só o e-mail; a permissão fica no cofre do Windows). */
  googleEmail?: string;
  googleCalendario?: string;
  googleNomeCalendario?: string;
  /** O que mandar para o calendário. */
  calendarioItens: { assinaturas: boolean; redefinicoes: boolean; tarefas: boolean };
  /** Eventos já mandados (uid → "impressão digital"), para só mandar o que mudou. */
  calendarioEnviados: Record<string, string>;
  /** Lembrar de fazer uma pausa a cada X minutos (0 = não lembrar). */
  pausaACada: number;
  /** Já trocou os sites padrão pelos programas instalados com o mesmo nome. */
  appsConferidos: boolean;
  /** Atalho escolhido em Ajustes (null = o padrão). */
  atalho: string | null;
  focoMinutos: number;
  pausaMinutos: number;
}

export interface Projeto {
  id: string;
  nome: string;
  /** Pasta onde os motores trabalham. */
  pasta: string;
  /** Instruções próprias, iguais para todos os motores. */
  instrucoes: string;
}

/** Servidor MCP: dá ferramentas novas às IAs (ex.: navegar, ler arquivos, memória). */
export interface ServidorMcp {
  id: string;
  /** Nome curto, sem espaços (é como os programas chamam o servidor). */
  nome: string;
  descricao: string;
  tipo: "local" | "remoto";
  /** Local: programa e argumentos (ex.: npx -y @playwright/mcp@latest). */
  comando: string;
  argumentos: string[];
  /** Remoto: endereço (https://…). */
  url: string;
  /** Nomes de variáveis cujo valor fica no cofre do Windows (ex.: GITHUB_TOKEN). */
  segredos: string[];
}

/** Skill: instruções prontas que a IA segue quando o assunto aparece. */
export interface Skill {
  id: string;
  nome: string;
  descricao: string;
  instrucoes: string;
}

/** Perfil (agente): motor, modelo, raciocínio, instruções, MCPs e skills. */
export interface Perfil {
  id: string;
  nome: string;
  motor: "deepseek" | "claude" | "codex" | "gemini" | "antigravity";
  modelo: string;
  esforco: string;
  modo: "conversar" | "editar";
  instrucoes: string;
  mcps: string[];
  skills: string[];
}

export interface Dados {
  assinaturas: Assinatura[];
  redefinicoes: Redefinicao[];
  apps: AppLancador[];
  notas: Nota[];
  notaAtual: string | null;
  tarefas: Tarefa[];
  habitos: Habito[];
  textos: TextoRapido[];
  timers: Timer[];
  projetos: Projeto[];
  mcps: ServidorMcp[];
  skills: Skill[];
  perfis: Perfil[];
  /** Coisas que o Dan pediu para a ilha lembrar (vão para todas as IAs). */
  memorias: Memoria[];
  /** Rotinas: vários passos com uma frase, um botão ou num horário. */
  rotinas: Rotina[];
  /** Minutos de foco por dia (AAAA-MM-DD), para o gráfico da semana. */
  focoHistorico?: Record<string, number>;
  config: Config;
}

export interface PassoRotina {
  /** resumo do dia, abrir programa/site, comando da ilha, falar, perguntar à IA, esperar. */
  tipo: "resumo" | "abrir" | "comando" | "falar" | "perguntar" | "esperar";
  valor: string;
}

export interface Rotina {
  id: string;
  nome: string;
  /** Frases que disparam (ex.: "bom dia"). */
  frases: string[];
  /** "HH:MM" para rodar sozinha, ou "" para só quando pedir. */
  horario: string;
  /** Dias da semana (0 = domingo); vazio = todos. */
  dias: number[];
  /** Ler o resultado em voz alta. */
  falar: boolean;
  passos: PassoRotina[];
  /** Último dia em que rodou sozinha (AAAA-MM-DD). */
  ultimaVez?: string;
}

export interface Memoria {
  id: string;
  texto: string;
  criada: number;
}

export const CORES = ["#D97757", "#E9ECEF", "#7BA7FF", "#B78CFF", "#FF5A8A", "#5C8BFF", "#5BE38F", "#FFD84D"];

export function novoId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function padrao(): Dados {
  return {
    assinaturas: [],
    redefinicoes: [],
    apps: [
      { id: novoId(), nome: "Claude", caminho: "https://claude.ai", cor: "#D97757" },
      { id: novoId(), nome: "ChatGPT", caminho: "https://chatgpt.com", cor: "#E9ECEF" },
      { id: novoId(), nome: "Gemini", caminho: "https://gemini.google.com", cor: "#7BA7FF" },
      { id: novoId(), nome: "DeepSeek", caminho: "https://chat.deepseek.com", cor: "#5C8BFF" },
    ],
    notas: [{ id: novoId(), texto: "" }],
    notaAtual: null,
    tarefas: [],
    habitos: [
      { id: novoId(), nome: "Água (copos)", meta: 8, registros: {} },
      { id: novoId(), nome: "Leitura", meta: 1, registros: {} },
      { id: novoId(), nome: "Exercício", meta: 1, registros: {} },
    ],
    textos: [],
    timers: [],
    projetos: [],
    mcps: [],
    skills: [],
    perfis: [],
    memorias: [],
    rotinas: [],
    config: {
      nome: "Dan",
      corOlhos: "#3FE6EE",
      corBochechas: "#FF8FB4",
      acessorio: "nenhum",
      personagem: "robo",
      estiloOlhos: "redondos",
      cabecaAberta: "carinha",
      cabecaRevista: true,
      olhosSeguemMouse: true,
      brincadeiras: true,
      cochilar: true,
      nomeRobo: "Robozinho",
      corDestaque: "#3FE6EE",
      modoDiscreto: "desligado",
      musicaNaIlha: true,
      esconderTelaCheia: true,
      centralModo: "ilha",
      conversaRapida: "motor:deepseek",
      usarMemoria: true,
      perceberAtividade: true,
      falarRespostas: true,
      voz: "",
      atenderPeloNome: false,
      conversaContinua: false,
      passeios: true,
      copiadosLigado: true,
      icloudEmail: "",
      icloudCalendario: "",
      icloudNomeCalendario: "",
      calendarioItens: { assinaturas: true, redefinicoes: true, tarefas: true },
      calendarioEnviados: {},
      pausaACada: 0,
      appsConferidos: false,
      atalho: null,
      focoMinutos: 25,
      pausaMinutos: 5,
    },
  };
}

/** Junta o que foi salvo com o padrão (para versões novas com campos novos). */
function completar(salvo: (Partial<Dados> & { lembretes?: LembreteAntigo[] }) | null | undefined): Dados {
  const base = padrao();
  if (!salvo) return base;
  const { lembretes, ...resto } = salvo;
  // Lembretes antigos viram redefinições que não se repetem.
  const convertidos: Redefinicao[] = (lembretes ?? []).map((l) => ({
    id: l.id,
    nome: l.titulo,
    proxima: l.quando,
    repete: "nao",
    avisarDias: 0,
  }));
  const config = { ...base.config, ...(resto.config ?? {}) };
  // O padrão antigo era o robô vermelho; agora é o personagem escolhido.
  // (olha o que estava salvo: o padrão novo já vem "revisado").
  if (!resto.config?.cabecaRevista) {
    config.cabecaAberta = "carinha";
    config.cabecaRevista = true;
  }
  return {
    ...base,
    ...resto,
    redefinicoes: [...(resto.redefinicoes ?? []), ...convertidos],
    config,
    notas: resto.notas?.length ? resto.notas : base.notas,
  };
}

const CHAVE = "dados";
let dados: Dados = padrao();
let loja: Store | null = null;
let relogio = 0;
let pendente = false;

// Várias janelas (ilha, Central) usam os mesmos dados: quem muda avisa as outras.
const ORIGEM = Math.random().toString(36).slice(2);
const ouvintes = new Set<() => void>();

/** Chamado quando outra janela mudou os dados. */
export function aoMudarDeFora(fazer: () => void): void {
  ouvintes.add(fazer);
}

/** Nada salvo ao ligar: a ilha acabou de ser instalada (mostra as boas-vindas). */
export let primeiraVez = false;

export async function carregar(): Promise<void> {
  try {
    if (dentroDoApp) {
      loja = await load("dados.json", { defaults: {}, autoSave: false });
      const salvo = await loja.get<Dados>(CHAVE);
      primeiraVez = !salvo;
      dados = completar(salvo);
      await listen<{ origem: string; dados: Dados }>("dados:mudaram", (e) => {
        if (e.payload.origem === ORIGEM) return;
        dados = completar(e.payload.dados);
        ouvintes.forEach((f) => f());
      });
    } else {
      dados = completar(JSON.parse(localStorage.getItem("ilha-dados") ?? "null"));
    }
  } catch (erro) {
    console.error("Não consegui ler os dados salvos", erro);
    dados = padrao();
  }
}

export function ler(): Dados {
  return dados;
}

/** Muda os dados e salva logo em seguida (salvamento automático). */
export function mudar(fazer: (d: Dados) => void): void {
  fazer(dados);
  pendente = true;
  window.clearTimeout(relogio);
  relogio = window.setTimeout(salvar, 400);
}

// Se a ilha for fechada logo depois de uma mudança, salva na hora.
window.addEventListener("pagehide", () => {
  if (!pendente) return;
  window.clearTimeout(relogio);
  void salvar();
});

async function salvar(): Promise<void> {
  pendente = false;
  try {
    if (loja) {
      await loja.set(CHAVE, dados);
      await loja.save();
      await emit("dados:mudaram", { origem: ORIGEM, dados });
    } else {
      localStorage.setItem("ilha-dados", JSON.stringify(dados));
    }
  } catch (erro) {
    console.error("Não consegui salvar", erro);
  }
}
