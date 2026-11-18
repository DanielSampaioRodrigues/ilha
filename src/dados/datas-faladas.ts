// Entende datas escritas ou faladas do jeito de todo dia, no fim (ou no meio)
// de uma frase: "Entregar trabalho amanhã 19h", "Prova de cálculo sexta 8h",
// "Pagar luz dia 25", "Dentista 25/11 às 14h30", "Ligar pra mãe hoje à noite".
// Também "!", "!!" ou "!!!" no fim viram a importância da tarefa.
import { paraISO } from "./datas";

export interface Entendido {
  /** A frase sem a parte da data (e sem os "!"). */
  texto: string;
  /** "AAAA-MM-DD" ou "AAAA-MM-DDTHH:MM" (hora do PC); null = sem data. */
  quando: string | null;
  /** 0 a 3, pelos "!" no fim. */
  prioridade: number;
}

const DIAS = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];

/** Tira acentos e deixa minúsculo, mantendo o mesmo tamanho (para cortar a frase original). */
const simples = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const PERIODO: Record<string, number> = { manha: 9, tarde: 15, noite: 20 };

export function entenderData(frase: string, agora = new Date()): Entendido {
  let original = frase.trim();
  let prioridade = 0;
  const bang = original.match(/\s*(!{1,3})\s*$/);
  if (bang) {
    prioridade = bang[1].length;
    original = original.slice(0, bang.index).trim();
  }
  // Trabalha numa cópia sem acentos e com a mesma quantidade de letras; ao achar um
  // pedaço, recorta o mesmo trecho da frase original.
  // (NFD separa os acentos; por isso comparamos letra a letra depois de recompor.)
  const base = original.normalize("NFC");
  const s = simples(base);
  if (s.length !== base.length) return { texto: original, quando: null, prioridade };

  let dia: Date | null = null;
  let hora: [number, number] | null = null;
  const tirar: [number, number][] = [];
  const achar = (re: RegExp) => {
    const m = re.exec(s);
    if (m) tirar.push([m.index, m.index + m[0].length]);
    return m;
  };

  // Hora: "às 19h", "19h30", "19:30", "as 7h", "8h da manha", "às 15"
  let m = achar(/(?:^|\s)(?:as\s+|a\s+partir\s+das\s+)?(\d{1,2})(?:(?:h|:)(\d{2})?|h)(?:\s+(?:da|de)\s+(manha|tarde|noite))?(?=\s|$|[,.])/);
  if (!m) m = achar(/(?:^|\s)as\s+(\d{1,2})(?:\s+(?:da|de)\s+(manha|tarde|noite))?(?=\s|$|[,.])/);
  if (m) {
    let h = Number(m[1]);
    const min = m[2] && /^\d{2}$/.test(m[2]) ? Number(m[2]) : 0;
    const periodo = m[3] ?? (m[2] && !/^\d{2}$/.test(m[2]) ? m[2] : undefined);
    if ((periodo === "tarde" || periodo === "noite") && h < 12) h += 12;
    if (h <= 23 && min <= 59) hora = [h, min];
  }
  // "de manhã", "à tarde", "à noite" sozinhos: uma hora típica.
  if (!hora) {
    const p = achar(/(?:^|\s)(?:de|a|pela|na)\s+(manha|tarde|noite)(?=\s|$|[,.])/);
    if (p) hora = [PERIODO[p[1]], 0];
  }

  // Dia
  const hoje0 = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const mais = (n: number) => new Date(hoje0.getFullYear(), hoje0.getMonth(), hoje0.getDate() + n);
  if (achar(/(?:^|\s)depois\s+de\s+amanha(?=\s|$|[,.])/)) dia = mais(2);
  else if (achar(/(?:^|\s)amanha(?=\s|$|[,.])/)) dia = mais(1);
  else if (achar(/(?:^|\s)hoje(?=\s|$|[,.])/)) dia = mais(0);
  else {
    const sem = achar(/(?:^|\s)(?:n[ao]\s+|nest[ae]\s+|(?:n[ao]\s+)?proxim[ao]\s+)?(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:-feira|\s+feira)?(?=\s|$|[,.])/);
    if (sem) {
      const alvo = DIAS.indexOf(sem[1]);
      let n = (alvo - hoje0.getDay() + 7) % 7;
      // "sexta" dita numa sexta: a próxima (a não ser que a hora ainda não passou).
      if (n === 0 && !(hora && hora[0] * 60 + hora[1] > agora.getHours() * 60 + agora.getMinutes())) n = 7;
      dia = mais(n);
    } else {
      const d = achar(/(?:^|\s)(?:dia\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=\s|$|[,.])/);
      if (d) {
        const ano = d[3] ? (d[3].length === 2 ? 2000 + Number(d[3]) : Number(d[3])) : hoje0.getFullYear();
        let data = new Date(ano, Number(d[2]) - 1, Number(d[1]));
        if (!d[3] && data < hoje0) data = new Date(ano + 1, Number(d[2]) - 1, Number(d[1]));
        if (data.getDate() === Number(d[1])) dia = data;
      } else {
        const soDia = achar(/(?:^|\s)dia\s+(\d{1,2})(?=\s|$|[,.])/);
        if (soDia) {
          const n = Number(soDia[1]);
          let data = new Date(hoje0.getFullYear(), hoje0.getMonth(), n);
          if (data < hoje0) data = new Date(hoje0.getFullYear(), hoje0.getMonth() + 1, n);
          if (data.getDate() === n) dia = data;
        }
      }
    }
  }
  // Só a hora: hoje (ou amanhã, se a hora já passou).
  if (!dia && hora) dia = hora[0] * 60 + hora[1] > agora.getHours() * 60 + agora.getMinutes() ? mais(0) : mais(1);
  if (!dia) return { texto: original, quando: null, prioridade };

  // Recorta da frase original o que era data/hora (de trás para frente).
  let texto = base;
  for (const [a, b] of tirar.sort((x, y) => y[0] - x[0])) texto = texto.slice(0, a) + texto.slice(b);
  texto = texto.replace(/\s{2,}/g, " ").replace(/\s+([,.])/g, "$1").replace(/[\s,.-]+$/, "").trim();
  // Sobrou um "para"/"até"/"no"/"na" pendurado no fim: tira.
  texto = texto.replace(/\s+(?:para|pra|ate|até|no|na|em|de)$/i, "").trim();
  const iso = paraISO(dia);
  const quando = hora ? `${iso}T${String(hora[0]).padStart(2, "0")}:${String(hora[1]).padStart(2, "0")}` : iso;
  return { texto: texto || original, quando, prioridade };
}

/** "sexta, 20/11 às 08:00" — para mostrar o que foi entendido. */
export function quandoLegivel(quando: string): string {
  const [data, hora] = quando.split("T");
  const [a, m, d] = data.split("-").map(Number);
  const dt = new Date(a, m - 1, d);
  const hoje = new Date();
  const amanha = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 1);
  const mesmo = (x: Date, y: Date) => x.toDateString() === y.toDateString();
  const nome = mesmo(dt, hoje)
    ? "hoje"
    : mesmo(dt, amanha)
      ? "amanhã"
      : `${dt.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "")}, ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
  return hora ? `${nome} às ${hora}` : nome;
}
