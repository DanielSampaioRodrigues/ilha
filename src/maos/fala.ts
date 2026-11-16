// A ilha fala: lê respostas em voz alta. Com a "voz natural" ligada, usa a
// ElevenLabs (voz humana); senão, ou se der erro, as vozes do Windows.
import { ler } from "../dados/armazem";
import { dentroDoApp } from "../ponte";
import { falarNatural } from "./sistema";

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

/** Voz natural (ElevenLabs): pede o áudio e toca. Se falhar, usa a do Windows. */
async function falarComVozNatural(texto: string, aoTerminar?: () => void): Promise<void> {
  const minhaVez = vez;
  const c = ler().config;
  document.body.classList.add("falando");
  try {
    const mp3 = await falarNatural(texto, c.vozElevenlabs ?? "", c.modeloElevenlabs ?? "");
    if (minhaVez !== vez) return; // cortaram enquanto o áudio chegava
    somCtx ??= new AudioContext();
    if (somCtx.state === "suspended") await somCtx.resume();
    if (somCtx.state !== "running") throw new Error("O Windows não deixou tocar o som agora.");
    const som = await somCtx.decodeAudioData(mp3.slice(0));
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

export function falar(texto: string, aoTerminar?: () => void): void {
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

export function calar(): void {
  cortar();
}

export const falando = () => !!audio || (typeof speechSynthesis !== "undefined" && speechSynthesis.speaking);
