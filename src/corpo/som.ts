// Sons curtos feitos na hora, sem arquivo de áudio.

/** "Plim" de comemoração: duas notas rápidas e suaves, subindo. */
export function tocarPlim(): void {
  try {
    const audio = new AudioContext();
    [784, 1175].forEach((freq, i) => {
      const inicio = audio.currentTime + i * 0.09;
      const nota = audio.createOscillator();
      const volume = audio.createGain();
      nota.type = "triangle";
      nota.frequency.value = freq;
      volume.gain.setValueAtTime(0.0001, inicio);
      volume.gain.exponentialRampToValueAtTime(0.12, inicio + 0.015);
      volume.gain.exponentialRampToValueAtTime(0.0001, inicio + 0.32);
      nota.connect(volume).connect(audio.destination);
      nota.start(inicio);
      nota.stop(inicio + 0.35);
    });
    window.setTimeout(() => audio.close(), 900);
  } catch {
    // Sem som: o confete já comemora.
  }
}

// Som curto de alarme (três bipes).
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
