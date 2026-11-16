// Conversas com os motores (só a Central grava). Ficam em "conversas.json",
// separado dos outros dados, porque crescem bastante. Guarda as 300 mais novas.
import { load, type Store } from "@tauri-apps/plugin-store";
import { dentroDoApp } from "../ponte";
import type { Motor } from "../maos/sistema";

export interface Ferramenta {
  nome: string;
  detalhe: string;
}

export interface MensagemConversa {
  papel: "voce" | "robo";
  texto: string;
  quando: number;
  ferramentas?: Ferramenta[];
  erro?: string | null;
  /** Caminhos dos arquivos anexados (mensagens do Dan). */
  anexos?: string[];
  /** O raciocínio que o modelo mostrou antes de responder (DeepSeek). */
  pensamento?: string;
}

export interface Conversa {
  id: string;
  titulo: string;
  motor: Motor;
  /** Número da sessão do programa (para continuar). */
  sessao: string | null;
  projetoId: string | null;
  pasta: string | null;
  modo: "conversar" | "editar";
  /** Perfil (agente) usado, se houver. */
  perfilId?: string | null;
  /** Modelo e nível de raciocínio escolhidos ("" = o padrão do programa). */
  modelo?: string;
  esforco?: string;
  /** MCPs e skills ligados nesta conversa. */
  mcps?: string[];
  skills?: string[];
  /** Instruções (perfil + skills) já mandadas na sessão do programa. */
  instrucoesEnviadas?: string;
  mensagens: MensagemConversa[];
  criada: number;
  atualizada: number;
  /** Custo em dólares informado pelo Claude Code (quando houver). */
  custo?: number;
}

const LIMITE = 300;
let lista: Conversa[] = [];
let loja: Store | null = null;
let relogio = 0;

export async function carregarConversas(): Promise<void> {
  try {
    if (dentroDoApp) {
      loja = await load("conversas.json", { defaults: {}, autoSave: false });
      lista = (await loja.get<Conversa[]>("conversas")) ?? [];
    } else {
      lista = JSON.parse(localStorage.getItem("ilha-conversas") ?? "[]");
    }
  } catch {
    lista = [];
  }
}

export function conversas(): Conversa[] {
  return lista;
}

export function salvarConversas(): void {
  lista.sort((a, b) => b.atualizada - a.atualizada);
  if (lista.length > LIMITE) lista = lista.slice(0, LIMITE);
  window.clearTimeout(relogio);
  relogio = window.setTimeout(async () => {
    try {
      if (loja) {
        await loja.set("conversas", lista);
        await loja.save();
      } else {
        localStorage.setItem("ilha-conversas", JSON.stringify(lista));
      }
    } catch (erro) {
      console.error("Não consegui salvar as conversas", erro);
    }
  }, 500);
}

export function adicionarConversa(c: Conversa): void {
  lista.unshift(c);
  salvarConversas();
}

export function apagarConversa(id: string): void {
  lista = lista.filter((c) => c.id !== id);
  salvarConversas();
}
