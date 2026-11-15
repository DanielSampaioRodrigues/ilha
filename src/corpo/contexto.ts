// O que cada estado e cada tela da ilha pode ver e pedir.
import type { Novidade } from "../atualizacao";
import type { Expressao } from "./carinha";
import type { Midia, Volume } from "../maos/sistema";

export type NomeEstado =
  | "repouso"
  | "ouvindo"
  | "trabalhando"
  | "pronta"
  | "aviso"
  | "confirmacao"
  | "foco"
  | "discreto"
  | "renovacao"
  | "musica"
  | "volume"
  | "aberta";

export type NomeTela =
  | "inicio"
  | "avisos"
  | "tabela"
  | "redefinicoes"
  | "notas"
  | "apps"
  | "foco"
  | "ajustes"
  | "tarefas"
  | "habitos"
  | "timers"
  | "textos"
  | "pc"
  | "traducoes"
  | "personagem";

export interface Notificacao {
  id: string;
  titulo: string;
  detalhe: string;
  quando: Date;
  expressao?: Expressao;
  botao?: { texto: string; fazer: () => void };
}

export interface SessaoFoco {
  tipo: "foco" | "pausa";
  inicio: number;
  fim: number;
}

export interface Contexto {
  /** Troca o estado da ilha. */
  ir(estado: NomeEstado): void;
  /** Volta ao descanso (repouso, aviso laranja ou foco, conforme o caso). */
  fechar(): void;
  /** Tela mostrada na ilha aberta. */
  tela: NomeTela;
  /** Abre uma tela dentro da ilha aberta. */
  irPara(tela: NomeTela): void;
  /** Redesenha a tela atual com os dados novos. */
  renovar(): void;
  /** Mantém a ilha aberta enquanto uma janela do Windows (ex.: escolher arquivo) estiver aberta. */
  segurarAberta<T>(pedido: Promise<T>): Promise<T>;
  /** Relógios que são cancelados sozinhos quando o estado muda. */
  depois(fazer: () => void, ms: number): void;
  aCada(fazer: () => void, ms: number): void;

  versao: string;
  atalho: string | null;
  definirAtalhoAtual(atalho: string): void;
  novidade: Novidade | null;
  procurarAtualizacao(): void;
  /** Recado para mostrar uma vez ao abrir. */
  mensagem: string | null;
  notificacoes: Notificacao[];
  /** A notificação mostrada no estado "pronta". */
  notificacao: Notificacao | null;
  foco: SessaoFoco | null;
  /** O robô está cochilando (mouse parado há muito tempo). */
  dormindo: boolean;
  /** Música tocando no Windows (para a ilha fechada). */
  musica: Midia | null;
  /** Último volume visto (para o aviso de volume). */
  volume: Volume | null;
  comecarFoco(tipo: SessaoFoco["tipo"], minutos: number): void;
  /** Liga/desliga o modo discreto (risquinho em repouso). */
  definirModoDiscreto(modo: import("../dados/armazem").ModoDiscreto): void;
  pararFoco(): void;
  comecarTimer(nome: string, minutos: number): void;
}
