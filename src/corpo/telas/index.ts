import type { Contexto, NomeTela } from "../contexto";
import { montarAjustes } from "./ajustes";
import { montarApps } from "./apps";
import { montarAvisos } from "./avisos";
import { montarFoco } from "./foco";
import { montarInicio } from "./inicio";
import { montarNotas } from "./notas";

export const TELAS: Record<NomeTela, { montar(ctx: Contexto): HTMLElement }> = {
  inicio: { montar: montarInicio },
  avisos: { montar: montarAvisos },
  notas: { montar: montarNotas },
  apps: { montar: montarApps },
  foco: { montar: montarFoco },
  ajustes: { montar: montarAjustes },
};
