// A ilha: desenha a forma preta, anima a gota e troca o conteúdo de cada estado.

import { caminho } from "./forma";
import { Mola, type Firmeza } from "./mola";
import { ESTADOS, temSinalVerde } from "./estados";
import type { Contexto, NomeEstado, NomeTela, Notificacao, SessaoFoco } from "./contexto";
import { informarArea } from "../ponte";
import type { Novidade } from "../atualizacao";
import { ler } from "../dados/armazem";
import { pendentes } from "../dados/datas";

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
  private tela: NomeTela = "inicio";
  private versao = "";
  private atalho: string | null = null;
  private notificacoes: Notificacao[] = [];
  private notificacao: Notificacao | null = null;
  private foco: SessaoFoco | null = null;
  private segurando = 0;
  private sinalVerde = false;
  /** Quem cuida de procurar atualização (definido no main.ts). */
  aoProcurarAtualizacao: () => void = () => {};
  private novidade: Novidade | null = null;
  private mensagem: string | null = null;
  private atual: HTMLElement | null = null;
  private esperando: HTMLElement | null = null;
  private relogios: number[] = [];
  private quadro = 0;
  private ultimoTempo = 0;
  private readonly observador: ResizeObserver;

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

    // Quando o conteúdo cresce ou encolhe (ex.: abriu um formulário, apareceu a
    // música), a ilha acompanha com a mesma animação de líquido.
    this.observador = new ResizeObserver(() => {
      if (!this.atual || this.esperando) return;
      const altura = this.atual.offsetHeight;
      if (Math.abs(altura - this.altura.alvo) < 1) return;
      this.altura.alvo = altura;
      this.informarArea();
      this.animar();
    });

    // Confere de tempos em tempos o foco, os lembretes e o aviso laranja.
    window.setInterval(() => this.conferirRelogio(), 1000);

    this.mostrar(this.estadoBase(), true);
  }

  get estadoAtual(): NomeEstado {
    return this.estado;
  }

  /** Pode fechar porque a janela perdeu o foco? (não, se o Dan está escolhendo um arquivo) */
  get podeFecharSozinha(): boolean {
    return this.estado === "aberta" && this.segurando === 0;
  }

  get telaAtual(): NomeTela {
    return this.tela;
  }

  abrir(tela: NomeTela = "inicio"): void {
    this.tela = tela;
    this.mostrar("aberta");
  }

  /** Estado de descanso: foco > aviso laranja > repouso. */
  private estadoBase(): NomeEstado {
    if (this.foco) return "foco";
    if (pendentes(ler().assinaturas).length) return "aviso";
    return "repouso";
  }

  fechar(): void {
    this.tela = "inicio";
    this.mostrar(this.estadoBase());
  }

  irPara(tela: NomeTela): void {
    this.abrir(tela);
  }

  definirAtalho(atalho: string | null): void {
    this.atalho = atalho;
  }

  /** Mostra um aviso (de outro programa, de um lembrete, do foco…). */
  notificar(n: Omit<Notificacao, "id" | "quando">): void {
    const completa: Notificacao = { ...n, id: String(Date.now()), quando: new Date() };
    this.notificacoes = [completa, ...this.notificacoes].slice(0, 6);
    if (this.estado === "aberta") {
      if (this.tela === "inicio") this.renovar();
      return;
    }
    this.notificacao = completa;
    this.mostrar("pronta");
  }

  comecarFoco(tipo: SessaoFoco["tipo"], minutos: number): void {
    const agora = Date.now();
    this.foco = { tipo, inicio: agora, fim: agora + minutos * 60_000 };
    this.fechar();
  }

  pararFoco(): void {
    this.foco = null;
    if (this.estado !== "aberta") this.fechar();
  }

  private conferirRelogio(): void {
    const agora = Date.now();
    if (this.foco && agora >= this.foco.fim) {
      const terminou = this.foco.tipo;
      this.foco = null;
      const pausa = ler().config.pausaMinutos;
      if (terminou === "foco") {
        this.notificar({
          titulo: "Foco concluído",
          detalhe: `Que tal uma pausa de ${pausa} min?`,
          expressao: "feliz",
          botao: { texto: "Pausar", fazer: () => this.comecarFoco("pausa", pausa) },
        });
      } else {
        this.notificar({ titulo: "Fim da pausa", detalhe: "Bora voltar?", expressao: "normal" });
      }
    }
    // A cada 30 s: o aviso laranja pode ter começado (virou o dia) ou acabado.
    if (agora % 30_000 < 1000 && (this.estado === "repouso" || this.estado === "aviso")) {
      if (this.estadoBase() !== this.estado) this.fechar();
      else if (this.estado === "repouso" && temSinalVerde() !== this.sinalVerde) this.renovar();
    }
  }

  /** Redesenha a tela atual sem a animação de troca (dados mudaram). */
  renovar(): void {
    this.relogiosLimpar();
    this.sinalVerde = temSinalVerde();
    const definicao = ESTADOS[this.estado];
    const novo = definicao.montar(this.contexto());
    novo.style.width = `${definicao.largura}px`;
    if (this.esperando) {
      // Ainda abrindo: troca a tela que vai aparecer.
      this.medidor.replaceChildren(novo);
      this.esperando = novo;
      return;
    }
    if (this.atual) {
      this.observador.unobserve(this.atual);
      this.atual.replaceWith(novo);
    } else {
      this.camada.append(novo);
    }
    this.atual = novo;
    this.observador.observe(novo);
    this.posicionarConteudo();
  }

  private relogiosLimpar(): void {
    this.relogios.forEach((r) => {
      window.clearTimeout(r);
      window.clearInterval(r);
    });
    this.relogios = [];
  }

  alternar(): void {
    if (this.estado === "aberta") this.fechar();
    else this.abrir();
  }

  definirVersao(versao: string): void {
    this.versao = versao;
    if (this.estado === "aberta") this.renovar();
  }

  /** Guarda a versão nova encontrada; ela aparece na ilha aberta. */
  definirNovidade(novidade: Novidade | null): void {
    this.novidade = novidade;
    if (this.estado === "aberta" && this.tela === "inicio") this.renovar();
  }

  /** Abre a ilha mostrando um recado curto. */
  avisar(texto: string): void {
    this.mensagem = texto;
    this.abrir("inicio");
  }

  /** Troca o estado. Usado pelo menu de teste da bandeja e pelos botões. */
  mostrar(estado: NomeEstado, imediato = false): void {
    this.relogiosLimpar();
    this.estado = estado;
    this.sinalVerde = temSinalVerde();

    const definicao = ESTADOS[estado];
    const conteudo = definicao.montar(this.contexto());
    conteudo.style.width = `${definicao.largura}px`;

    // Mede a altura do conteúdo novo sem mostrar.
    this.medidor.replaceChildren(conteudo);
    const altura = Math.ceil(conteudo.getBoundingClientRect().height);

    // O conteúdo antigo some rápido; o novo aparece quando a forma estiver quase pronta.
    if (this.atual) {
      const antigo = this.atual;
      this.observador.unobserve(antigo);
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
    const mensagem = this.mensagem;
    this.mensagem = null;
    return {
      tela: this.tela,
      versao: this.versao,
      atalho: this.atalho,
      novidade: this.novidade,
      mensagem,
      notificacoes: this.notificacoes,
      notificacao: this.notificacao,
      foco: this.foco,
      ir: (estado) => this.mostrar(estado),
      fechar: () => this.fechar(),
      irPara: (tela) => this.irPara(tela),
      renovar: () => this.renovar(),
      segurarAberta: (pedido) => {
        this.segurando++;
        return pedido.finally(() => this.segurando--);
      },
      depois: (fazer, ms) => this.relogios.push(window.setTimeout(fazer, ms)),
      aCada: (fazer, ms) => this.relogios.push(window.setInterval(fazer, ms)),
      definirAtalhoAtual: (atalho) => (this.atalho = atalho),
      procurarAtualizacao: () => this.aoProcurarAtualizacao(),
      comecarFoco: (tipo, minutos) => this.comecarFoco(tipo, minutos),
      pararFoco: () => this.pararFoco(),
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
    this.observador.observe(conteudo);
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
   * Informa a área clicável: só o corpo preto, com os cantos redondos (os
   * "ombros" são enfeite e deixam o clique passar). Durante a animação usa a
   * maior entre a forma atual e a final, para o clique nunca "atravessar" a ilha.
   */
  private informarArea(): void {
    const largura = Math.max(this.largura.valor, this.largura.alvo);
    const altura = Math.max(this.altura.valor, this.altura.alvo) + Math.max(this.gota, 0);
    const raio = Math.min(this.raio.valor, this.raio.alvo);
    informarArea({ x: this.centro - largura / 2, y: 0, largura, altura, raio });
  }
}
