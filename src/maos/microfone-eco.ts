// Microfone com cancelamento de eco, captado pela janela da ilha (o mesmo
// recurso das chamadas de vídeo). A voz do robô que sai na caixa de som é
// tirada do que o microfone ouve, então dá para interromper sem fone. O som vai
// para o ouvido (Rust) a cada 0,1 s; se isto falhar, o Rust usa o microfone
// direto, como antes. Ideia do projeto aberto "jarvis".
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { dentroDoApp } from "../ponte";
import { ler } from "../dados/armazem";

let fluxo: MediaStream | null = null;
let ctx: AudioContext | null = null;

export async function ligarMicrofoneComEco(): Promise<void> {
  if (!dentroDoApp || fluxo) return;
  try {
    fluxo = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    ctx = new AudioContext({ sampleRate: 16000 });
    await ctx.audioWorklet.addModule("/microfone-worklet.js");
    const fonte = ctx.createMediaStreamSource(fluxo);
    const captura = new AudioWorkletNode(ctx, "captura");
    let juntando: Float32Array[] = [];
    let total = 0;
    captura.port.onmessage = (e: MessageEvent<Float32Array>) => {
      juntando.push(e.data);
      total += e.data.length;
      if (total < 1600) return;
      // Float (−1…1) → PCM 16 bits, mandado como bytes (sem virar texto).
      const bytes = new Uint8Array(total * 2);
      const vista = new DataView(bytes.buffer);
      let i = 0;
      for (const pedaco of juntando)
        for (const a of pedaco) {
          vista.setInt16(i, Math.max(-1, Math.min(1, a)) * 32767, true);
          i += 2;
        }
      juntando = [];
      total = 0;
      invoke("som_do_microfone", bytes).catch(() => {});
    };
    fonte.connect(captura);
    // O nó precisa estar ligado a uma saída para rodar; sem som (volume zero).
    const mudo = ctx.createGain();
    mudo.gain.value = 0;
    captura.connect(mudo).connect(ctx.destination);
    // Se o Windows deixar o som "pausado" até um clique, tenta já e no 1º clique.
    // Enquanto pausado, nada chega ao ouvido e ele usa o microfone direto.
    if (ctx.state !== "running") {
      void ctx.resume().catch(() => {});
      const acordar = () => void ctx?.resume().catch(() => {});
      window.addEventListener("pointerdown", acordar, { once: true });
      window.addEventListener("keydown", acordar, { once: true });
    }
  } catch (erro) {
    console.warn("Microfone com cancelamento de eco indisponível; usando o direto.", erro);
    desligarMicrofoneComEco();
  }
}

export function desligarMicrofoneComEco(): void {
  fluxo?.getTracks().forEach((t) => t.stop());
  fluxo = null;
  void ctx?.close();
  ctx = null;
}

/** Liga ou desliga conforme os Ajustes (só na janela da ilha). */
export function ajustarMicrofoneComEco(): void {
  // Nas outras janelas (Central), a mudança chega à ilha pelo aviso de dados.
  if (!dentroDoApp || getCurrentWindow().label !== "ilha") return;
  const c = ler().config;
  if (c.atenderPeloNome && c.microfoneComEco !== false) void ligarMicrofoneComEco();
  else desligarMicrofoneComEco();
}
