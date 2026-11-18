// A ilha fala: lê respostas em voz alta. Com a "voz natural" ligada, usa a
// ElevenLabs (voz humana); senão, ou se der erro, as vozes do Windows.
import { ler } from "../dados/armazem";
import { dentroDoApp } from "../ponte";
import { falarKokoro, falarNatural } from "./sistema";

function vozes(): SpeechSynthesisVoice[] {
  return typeof speechSynthesis === "undefined" ? [] : speechSynthesis.getVoices();
}

/** Vozes em português (para escolher em Ajustes). */
export function vozesEmPortugues(): SpeechSynthesisVoice[] {
  return vozes().filter((v) => v.lang.toLowerCase().startsWith("pt"));
}

/** Avisa quando a lista de vozes ficar pronta (ela carrega depois). */
export function aoCarregarVozes(fazer: () => void): void {
  if (typeof speechSynthesis === "undefined") return;
  if (vozes().length) fazer();
  speechSynthesis.addEventListener("voiceschanged", fazer, { once: true });
}

function escolherVoz(): SpeechSynthesisVoice | undefined {
  const escolhida = ler().config.voz;
  const todas = vozes();
  const pt = vozesEmPortugues();
  return (
    todas.find((v) => v.voiceURI === escolhida) ??
    pt.find((v) => v.lang === "pt-BR" && /natural|online/i.test(v.name)) ??
    pt.find((v) => v.lang === "pt-BR") ??
    pt[0]
  );
}

/** Tira o que não se lê em voz alta (código, símbolos de formatação, links). */
export function paraFala(texto: string): string {
  let t = texto
    .replace(/```[\s\S]*?```/g, " (tem um código na tela) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "(link na tela)")
    .replace(/^#+\s*/gm, "")
    .replace(/[*_~>|]/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length > 700) t = `${t.slice(0, 680).replace(/\s\S*$/, "")}… O resto está na tela.`;
  return t;
}

/** A fala em andamento (para desligar o "terminou" dela antes de cortar). */
let atual: SpeechSynthesisUtterance | null = null;
/**
 * Áudio da voz natural tocando (e a vez dele: uma fala nova cancela a anterior).
 * Toca pelo Web Audio (decodifica o MP3 na memória): um <audio> com "blob:"
 * é barrado pela regra de segurança da ilha (CSP).
 */
let somCtx: AudioContext | null = null;
let audio: AudioBufferSourceNode | null = null;
let vez = 0;
/** Último erro da voz natural (para mostrar nos Ajustes). */
export let erroVozNatural = "";

function cortar(): void {
  document.body.classList.remove("falando");
  vez++;
  if (audio) {
    audio.onended = null;
    try {
      audio.stop();
    } catch {
      // já tinha parado
    }
    audio = null;
  }
  if (atual) {
    // Cortar uma fala também dispara "terminou"; isso não pode reabrir o microfone.
    atual.onend = null;
    atual.onerror = null;
    atual = null;
  }
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}

/**
 * O MP3 vindo do Rust pode chegar como ArrayBuffer, como Uint8Array ou como
 * lista de números (depende da versão do Tauri): tudo vira um ArrayBuffer novo.
 */
export function paraArrayBuffer(dados: unknown): ArrayBuffer {
  if (dados instanceof ArrayBuffer) return dados.slice(0);
  if (ArrayBuffer.isView(dados)) {
    const bytes = new Uint8Array(dados.buffer, dados.byteOffset, dados.byteLength);
    return bytes.slice().buffer;
  }
  if (Array.isArray(dados)) return new Uint8Array(dados).buffer;
  if (dados && typeof dados === "object" && "byteLength" in dados) return new Uint8Array(dados as ArrayBufferLike).slice().buffer;
  throw new Error("O áudio da voz natural chegou num formato que não conheço.");
}

/** O áudio da voz natural escolhida: Kokoro (no PC, WAV) ou ElevenLabs (MP3). */
function audioNatural(texto: string): Promise<unknown> {
  const c = ler().config;
  if ((c.vozMotor ?? "kokoro") === "kokoro") return falarKokoro(texto, c.vozKokoro ?? "dora");
  return falarNatural(texto, c.vozElevenlabs ?? "", c.modeloElevenlabs ?? "");
}

/** Voz natural (Kokoro ou ElevenLabs): pede o áudio e toca. Se falhar, usa a do Windows. */
async function falarComVozNatural(texto: string, aoTerminar?: () => void): Promise<void> {
  const minhaVez = vez;
  document.body.classList.add("falando");
  try {
    const mp3 = await audioNatural(texto);
    if (minhaVez !== vez) return; // cortaram enquanto o áudio chegava
    somCtx ??= new AudioContext();
    if (somCtx.state === "suspended") await somCtx.resume();
    if (somCtx.state !== "running") throw new Error("O Windows não deixou tocar o som agora.");
    const som = await somCtx.decodeAudioData(paraArrayBuffer(mp3));
    if (minhaVez !== vez) return;
    erroVozNatural = "";
    const tocar = somCtx.createBufferSource();
    tocar.buffer = som;
    tocar.connect(somCtx.destination);
    audio = tocar;
    tocar.onended = () => {
      if (audio !== tocar) return;
      audio = null;
      document.body.classList.remove("falando");
      aoTerminar?.();
    };
    tocar.start();
  } catch (erro) {
    if (minhaVez !== vez) return;
    erroVozNatural = String(erro);
    console.warn("Voz natural falhou; usando a do Windows.", erro);
    falarWindows(texto, aoTerminar);
  }
}

/** O robô vai dizer o próprio nome: o ouvido não deve tomar isso como "chamaram". */
function avisarSeTemNome(texto: string): void {
  if (!dentroDoApp) return;
  const sem = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (!sem(texto).includes(sem(ler().config.nomeRobo))) return;
  import("@tauri-apps/api/core").then(({ invoke }) => invoke("fala_com_nome")).catch(() => {});
}

export function falar(texto: string, aoTerminar?: () => void): void {
  avisarSeTemNome(texto);
  if (!texto.trim()) {
    aoTerminar?.();
    return;
  }
  cortar();
  if (dentroDoApp && ler().config.vozNatural) {
    void falarComVozNatural(paraFala(texto), aoTerminar);
    return;
  }
  falarWindows(paraFala(texto), aoTerminar);
}

function falarWindows(texto: string, aoTerminar?: () => void): void {
  if (typeof speechSynthesis === "undefined") {
    document.body.classList.remove("falando");
    aoTerminar?.();
    return;
  }
  const fala = new SpeechSynthesisUtterance(texto);
  atual = fala;
  const voz = escolherVoz();
  if (voz) fala.voice = voz;
  fala.lang = voz?.lang ?? "pt-BR";
  fala.rate = 1.05;
  const terminou = () => {
    if (atual === fala) atual = null;
    document.body.classList.remove("falando");
    aoTerminar?.();
  };
  fala.onstart = () => document.body.classList.add("falando");
  fala.onend = terminou;
  fala.onerror = terminou;
  speechSynthesis.speak(fala);
}

/**
 * Fala em partes, conforme a resposta vai chegando (como num assistente de
 * voz): a primeira frase já começa enquanto a IA ainda escreve o resto. Com a
 * voz natural, o áudio da próxima frase já é pedido enquanto a atual toca.
 */
export interface FalaEmPartes {
  parte(texto: string): void;
  fim(): void;
}

export function falarEmPartes(aoTerminar?: () => void): FalaEmPartes {
  cortar();
  const minhaVez = vez;
  const c = ler().config;
  const natural = dentroDoApp && !!c.vozNatural;
  const fila: Promise<AudioBuffer | string>[] = [];
  let tocando = false;
  let acabou = false;
  let terminado = false;
  const terminar = () => {
    if (terminado || minhaVez !== vez) return;
    terminado = true;
    document.body.classList.remove("falando");
    aoTerminar?.();
  };
  // Áudio da voz natural (ou o próprio texto, para a voz do Windows, se falhar).
  const preparar = async (texto: string): Promise<AudioBuffer | string> => {
    if (!natural) return texto;
    try {
      const mp3 = await audioNatural(texto);
      somCtx ??= new AudioContext();
      return await somCtx.decodeAudioData(paraArrayBuffer(mp3));
    } catch (erro) {
      erroVozNatural = String(erro);
      return texto;
    }
  };
  const tocar = (item: AudioBuffer | string) =>
    new Promise<void>((pronto) => {
      if (typeof item === "string") {
        if (typeof speechSynthesis === "undefined") return pronto();
        const fala = new SpeechSynthesisUtterance(item);
        atual = fala;
        const voz = escolherVoz();
        if (voz) fala.voice = voz;
        fala.lang = voz?.lang ?? "pt-BR";
        fala.rate = 1.05;
        fala.onend = () => pronto();
        fala.onerror = () => pronto();
        speechSynthesis.speak(fala);
        return;
      }
      const ctx = (somCtx ??= new AudioContext());
      void ctx.resume();
      const fonte = ctx.createBufferSource();
      fonte.buffer = item;
      fonte.connect(ctx.destination);
      audio = fonte;
      fonte.onended = () => {
        if (audio === fonte) audio = null;
        pronto();
      };
      fonte.start();
    });
  const seguir = async () => {
    if (tocando || minhaVez !== vez) return;
    const proxima = fila.shift();
    if (!proxima) {
      if (acabou) terminar();
      return;
    }
    tocando = true;
    document.body.classList.add("falando");
    const item = await proxima;
    if (minhaVez !== vez) return;
    await tocar(item);
    tocando = false;
    if (minhaVez === vez) void seguir();
  };
  return {
    parte(texto) {
      avisarSeTemNome(texto);
      const t = paraFala(texto);
      if (!t.trim() || minhaVez !== vez) return;
      fila.push(preparar(t));
      void seguir();
    },
    fim() {
      acabou = true;
      if (!tocando && !fila.length) terminar();
    },
  };
}

/** Divide o texto que já chegou em frases completas (o resto espera mais texto). */
export function frasesProntas(texto: string, desde: number, minimo = 24): { frases: string; ate: number } {
  const resto = texto.slice(desde);
  let corte = -1;
  const fim = /[.!?…:;](\s|$)|\n/g;
  let m: RegExpExecArray | null;
  while ((m = fim.exec(resto))) {
    if (m.index + 1 >= minimo) corte = m.index + m[0].length;
  }
  if (corte < 0) return { frases: "", ate: desde };
  return { frases: resto.slice(0, corte), ate: desde + corte };
}

export function calar(): void {
  cortar();
}

export const falando = () => !!audio || (typeof speechSynthesis !== "undefined" && speechSynthesis.speaking);

/** Bip curto: "pode falar" (o microfone abriu). */
export function bip(): void {
  try {
    somCtx ??= new AudioContext();
    const ctx = somCtx;
    void ctx.resume();
    const osc = ctx.createOscillator();
    const volume = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1320, ctx.currentTime + 0.08);
    volume.gain.setValueAtTime(0.0001, ctx.currentTime);
    volume.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    volume.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
    osc.connect(volume).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.24);
  } catch {
    /* sem som, sem problema */
  }
}

// Avisa o ouvido quando o robô está falando (classe "falando" no corpo da
// página): assim ele mesmo dizendo o próprio nome não chama a si mesmo.
if (dentroDoApp && typeof MutationObserver !== "undefined") {
  let antes = false;
  new MutationObserver(() => {
    const agora = document.body.classList.contains("falando");
    if (agora === antes) return;
    antes = agora;
    import("@tauri-apps/api/core").then(({ invoke }) => invoke("falando_agora", { sim: agora })).catch(() => {});
  }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
}
