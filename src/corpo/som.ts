// Som curto de alarme (três bipes), feito na hora, sem arquivo de áudio.
export function tocarAlarme(): void {
  try {
    const audio = new AudioContext();
    for (let i = 0; i < 3; i++) {
      const inicio = audio.currentTime + i * 0.35;
      const nota = audio.createOscillator();
      const volume = audio.createGain();
      nota.type = "sine";
      nota.frequency.value = 880;
      volume.gain.setValueAtTime(0.0001, inicio);
      volume.gain.exponentialRampToValueAtTime(0.25, inicio + 0.02);
      volume.gain.exponentialRampToValueAtTime(0.0001, inicio + 0.25);
      nota.connect(volume).connect(audio.destination);
      nota.start(inicio);
      nota.stop(inicio + 0.3);
    }
    window.setTimeout(() => audio.close(), 1500);
  } catch {
    // Sem som disponível: o aviso na ilha já basta.
  }
}
