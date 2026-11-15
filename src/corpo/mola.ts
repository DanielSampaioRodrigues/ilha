// Uma "mola": o valor corre atrás do alvo, passa um pouco e volta.
// É isso que dá o balanço de líquido à ilha.

export interface Firmeza {
  rigidez: number;
  amortecimento: number;
}

export class Mola {
  valor: number;
  alvo: number;
  velocidade = 0;

  constructor(inicial: number) {
    this.valor = inicial;
    this.alvo = inicial;
  }

  passo(segundos: number, firmeza: Firmeza): void {
    // Passos pequenos para a conta ficar estável mesmo se um quadro atrasar.
    const passos = Math.max(1, Math.ceil(segundos / (1 / 240)));
    const dt = segundos / passos;
    for (let i = 0; i < passos; i++) {
      const forca =
        -firmeza.rigidez * (this.valor - this.alvo) - firmeza.amortecimento * this.velocidade;
      this.velocidade += forca * dt;
      this.valor += this.velocidade * dt;
    }
  }

  get parada(): boolean {
    return Math.abs(this.valor - this.alvo) < 0.3 && Math.abs(this.velocidade) < 2;
  }

  pular(): void {
    this.valor = this.alvo;
    this.velocidade = 0;
  }
}
