// Pequenas comemorações: confete quando o Dan conclui uma tarefa, bate a
// meta de um hábito ou quando uma IA termina. Os papeizinhos saem da ilha e
// caem por cima da tela (a janela é transparente; o clique passa por eles).

const CORES = ["var(--ciano)", "var(--cor-2)", "#ff6b9a", "#ffd166", "#7cf29a", "#b69cff"];

function poucoMovimento(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Estoura confete a partir de (x, y). */
export function confete(x: number, y: number, quantos = 26): void {
  if (poucoMovimento()) return;
  for (let i = 0; i < quantos; i++) {
    const p = document.createElement("i");
    p.className = `confete${i % 3 === 0 ? " redondo" : ""}`;
    p.style.background = CORES[i % CORES.length];
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    // Para cima, num leque; depois a "gravidade" puxa para baixo.
    const angulo = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.95;
    const forca = 90 + Math.random() * 120;
    const vx = Math.cos(angulo) * forca;
    const vy = Math.sin(angulo) * forca;
    const giro = (Math.random() - 0.5) * 900;
    const queda = 240 + Math.random() * 120;
    const quadros = [0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => ({
      transform: `translate(${(vx * t * (1 - t * 0.3)).toFixed(1)}px, ${(vy * t + queda * t * t).toFixed(1)}px) rotate(${(giro * t).toFixed(0)}deg) scaleX(${Math.cos(t * 12).toFixed(2)})`,
      opacity: t > 0.75 ? (1 - (t - 0.75) / 0.25).toFixed(2) : "1",
    }));
    document.body.append(p);
    p.animate(quadros, { duration: 950 + Math.random() * 400, easing: "linear" }).finished.finally(() => p.remove());
  }
}

/** Estoura confete a partir do meio de um elemento. */
export function confeteEm(el: Element | null | undefined, quantos?: number): void {
  if (!el?.isConnected) return;
  const r = el.getBoundingClientRect();
  confete(r.left + r.width / 2, r.top + r.height / 2, quantos);
}
