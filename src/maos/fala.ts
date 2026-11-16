// A ilha fala: lê respostas em voz alta com as vozes do próprio Windows
// (as mesmas do Narrador; as "Natural" soam bem melhor, se houver).
import { ler } from "../dados/armazem";

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

function cortar(): void {
  if (atual) {
    // Cortar uma fala também dispara "terminou"; isso não pode reabrir o microfone.
    atual.onend = null;
    atual.onerror = null;
    atual = null;
  }
  speechSynthesis.cancel();
}

export function falar(texto: string, aoTerminar?: () => void): void {
  if (typeof speechSynthesis === "undefined" || !texto.trim()) {
    aoTerminar?.();
    return;
  }
  cortar();
  const fala = new SpeechSynthesisUtterance(paraFala(texto));
  atual = fala;
  const voz = escolherVoz();
  if (voz) fala.voice = voz;
  fala.lang = voz?.lang ?? "pt-BR";
  fala.rate = 1.05;
  const terminou = () => {
    if (atual === fala) atual = null;
    aoTerminar?.();
  };
  fala.onend = terminou;
  fala.onerror = terminou;
  speechSynthesis.speak(fala);
}

export function calar(): void {
  if (typeof speechSynthesis !== "undefined") cortar();
}

export const falando = () => typeof speechSynthesis !== "undefined" && speechSynthesis.speaking;
