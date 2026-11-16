import type { Contexto, NomeTela } from "../contexto";
import { montarAjustes } from "./ajustes";
import { montarApps } from "./apps";
import { montarAvisos } from "./avisos";
import { montarFoco } from "./foco";
import { montarInicio } from "./inicio";
import { montarNotas } from "./notas";
import { montarRedefinicoes } from "./redefinicoes";
import { montarTabela } from "./tabela";
import { montarHabitos } from "./habitos";
import { montarPc } from "./pc";
import { montarTarefas } from "./tarefas";
import { montarTextos } from "./textos";
import { montarTimers } from "./timers";
import { montarTraducoes } from "./traducoes";
import { montarPersonagem } from "./personagem";
import { montarConversaRapida } from "./conversa";
import { montarMemoria } from "./memoria";
import { montarCalendario } from "./calendario";
import { montarCopiados } from "./copiados";
import { montarRotinas } from "./rotinas";

export const TELAS: Record<NomeTela, { montar(ctx: Contexto): HTMLElement }> = {
  inicio: { montar: montarInicio },
  avisos: { montar: montarAvisos },
  tabela: { montar: montarTabela },
  redefinicoes: { montar: montarRedefinicoes },
  notas: { montar: montarNotas },
  apps: { montar: montarApps },
  foco: { montar: montarFoco },
  ajustes: { montar: montarAjustes },
  tarefas: { montar: montarTarefas },
  habitos: { montar: montarHabitos },
  timers: { montar: montarTimers },
  textos: { montar: montarTextos },
  pc: { montar: montarPc },
  traducoes: { montar: montarTraducoes },
  personagem: { montar: montarPersonagem },
  conversa: { montar: montarConversaRapida },
  memoria: { montar: montarMemoria },
  calendario: { montar: montarCalendario },
  copiados: { montar: montarCopiados },
  rotinas: { montar: montarRotinas },
};
