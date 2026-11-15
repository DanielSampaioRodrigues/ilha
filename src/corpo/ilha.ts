// A ilha: desenha a forma preta, anima a gota e troca o conteúdo de cada estado.

import { caminho, OMBRO } from "./forma";
import { Mola, type Firmeza } from "./mola";
import { ESTADOS, type Contexto, type NomeEstado } from "./estados";
import { informarArea } from "../ponte";

// Abrindo: a altura desce rápido e balança; a largura vem um pouco depois.
// Isso faz a ilha parecer uma gota escorrendo antes de se espalhar.
const ABRINDO_ALTURA: Firmeza = { rigidez: 190, amortecimento: 17 };
const ABRINDO_LARGURA: Firmeza = { rigidez: 120, amortecimento: 19 };
// Fechando: primeiro encolhe para os lados, depois sobe, quase sem balanço.
const FECHANDO_ALTURA: Firmeza = { rigidez: 170, amortecimento: 25 };
const FECHANDO_LARGURA: Firmeza = { rigidez: 300, amortecimento: 33 };

const SVG = "http://www.w3.org/2000/svg";

export class Ilha {
  private readonly largura = new Mola(ESTADOS.repouso.largura);
  private readonly altura = new Mola(40);
  private readonly raio = new Mola(ESTADOS.repouso.raio);
  private gota = 0;

  private readonly forma: SVGPathElement;
  private readonly svg: SVGSVGElement;
  private readonly camada: HTMLElement;
  private readonly medidor: HTMLElement;

  private estado: NomeEstado = "repouso";
  private temAviso = false;
  private atual: HTMLElement | null = null;
  private esperando: HTMLElement | null = null;
  private relogios: number[] = [];
  private quadro = 0;
  private ultimoTempo = 0;

  constructor(private readonly palco: HTMLElement) {
    this.svg = document.createElementNS(SVG, "svg");
    this.svg.classList.add("forma");
    this.forma = document.createElementNS(SVG, "path");
    this.svg.append(this.forma);

    this.camada = document.createElement("div");
    this.camada.className = "camada";
    this.medidor = document.createElement("div");
    this.medidor.className = "medidor";
    palco.append(this.svg, this.camada, this.medidor);

    // Clicar numa ilha compacta (repouso, aviso, tarefa pronta) abre a ilha inteira.
    const aoClicar = () => {
      if (ESTADOS[this.estado].compacto) this.abrir();
    };
    this.forma.addEventListener("click", aoClicar);
    this.camada.addEventListener("click", aoClicar);
    window.addEventListener("resize", () => this.redesenhar());

    this.mostrar("repouso", true);
  }

  get estadoAtual(): NomeEstado {
    return this.estado;
  }

  abrir(): void {
    this.mostrar("aberta");
  }

  fechar(): void {
    this.mostrar(this.temAviso ? "aviso" : "repouso");
  }

  alternar(): void {
    if (this.estado === "aberta") this.fechar();
    else this.abrir();
  }

  /** Troca o estado. Usado pelo menu de teste da bandeja e pelos botões. */
  mostrar(estado: NomeEstado, imediato = false): void {
    if (estado === "aviso") this.temAviso = true;
    if (estado === "repouso") this.temAviso = false;

    this.relogios.forEach((r) => window.clearTimeout(r));
    this.relogios = [];
    this.estado = estado;

    const definicao = ESTADOS[estado];
    const conteudo = definicao.montar(this.contexto());
    conteudo.style.width = `${definicao.largura}px`;

    // Mede a altura do conteúdo novo sem mostrar.
    this.medidor.replaceChildren(conteudo);
    const altura = Math.ceil(conteudo.getBoundingClientRect().height);

    // O conteúdo antigo some rápido; o novo aparece quando a forma estiver quase pronta.
    if (this.atual) {
      const antigo = this.atual;
      antigo.classList.add("saindo");
      window.setTimeout(() => antigo.remove(), 160);
    }
    this.atual = null;
    this.esperando = conteudo;

    this.largura.alvo = definicao.largura;
    this.altura.alvo = altura;
    this.raio.alvo = definicao.raio;
    if (imediato) {
      this.largura.pular();
      this.altura.pular();
      this.raio.pular();
    }

    this.informarArea();
    this.animar();
  }

  private contexto(): Contexto {
    return {
      ir: (estado) => this.mostrar(estado),
      fechar: () => this.fechar(),
      pagarAviso: () => {
        this.temAviso = false;
        if (this.estado === "aberta") this.mostrar("aberta");
        else this.fechar();
      },
      temAviso: this.temAviso,
      depois: (fazer, ms) => this.relogios.push(window.setTimeout(fazer, ms)),
      aCada: (fazer, ms) => this.relogios.push(window.setInterval(fazer, ms)),
    };
  }

  private animar(): void {
    if (this.quadro) return;
    this.ultimoTempo = performance.now();
    const passo = (agora: number) => {
      const segundos = Math.min((agora - this.ultimoTempo) / 1000, 1 / 20);
      this.ultimoTempo = agora;

      const crescendo = this.altura.alvo >= this.altura.valor;
      this.altura.passo(segundos, crescendo ? ABRINDO_ALTURA : FECHANDO_ALTURA);
      this.largura.passo(
        segundos,
        this.largura.alvo >= this.largura.valor ? ABRINDO_LARGURA : FECHANDO_LARGURA,
      );
      this.raio.passo(segundos, FECHANDO_LARGURA);

      // A gota acompanha a velocidade com que a ilha desce (ou sobe).
      const alvoGota = Math.max(-8, Math.min(30, this.altura.velocidade * 0.03));
      this.gota += (alvoGota - this.gota) * Math.min(1, segundos * 18);

      this.redesenhar();
      this.revelarSeChegou();

      const parado =
        this.altura.parada && this.largura.parada && this.raio.parada && Math.abs(this.gota) < 0.2;
      if (parado) {
        this.largura.pular();
        this.altura.pular();
        this.raio.pular();
        this.gota = 0;
        this.redesenhar();
        this.revelarSeChegou(true);
        this.informarArea();
        this.quadro = 0;
        return;
      }
      this.quadro = requestAnimationFrame(passo);
    };
    this.quadro = requestAnimationFrame(passo);
  }

  private revelarSeChegou(forcar = false): void {
    if (!this.esperando) return;
    const perto = (m: Mola) => Math.abs(m.valor - m.alvo) <= Math.max(6, m.alvo * 0.08);
    if (!forcar && !(perto(this.altura) && perto(this.largura))) return;

    const conteudo = this.esperando;
    this.esperando = null;
    this.atual = conteudo;
    conteudo.classList.add("entrando");
    this.camada.append(conteudo);
    this.posicionarConteudo();
    requestAnimationFrame(() => conteudo.classList.remove("entrando"));
  }

  private get centro(): number {
    return this.palco.clientWidth / 2;
  }

  private redesenhar(): void {
    const d = caminho(
      {
        largura: this.largura.valor,
        altura: this.altura.valor,
        raio: this.raio.valor,
        gota: this.gota,
      },
      this.centro,
    );
    this.forma.setAttribute("d", d);
    // O conteúdo é recortado no formato da ilha: nada aparece para fora do preto.
    this.camada.style.clipPath = `path("${d}")`;
    this.posicionarConteudo();
  }

  private posicionarConteudo(): void {
    for (const filho of this.camada.children) {
      const largura = (filho as HTMLElement).offsetWidth;
      (filho as HTMLElement).style.left = `${this.centro - largura / 2}px`;
    }
  }

  /**
   * Informa a área clicável. Durante a animação usa a maior entre a forma atual
   * e a final, para o clique nunca "atravessar" a ilha.
   */
  private informarArea(): void {
    const largura = Math.max(this.largura.valor, this.largura.alvo) + OMBRO * 2;
    const altura = Math.max(this.altura.valor, this.altura.alvo) + Math.max(this.gota, 0);
    informarArea({ x: this.centro - largura / 2, y: 0, largura, altura: altura + 2 });
  }
}
