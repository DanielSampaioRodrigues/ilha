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
};
