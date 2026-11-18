// A ilha: desenha a forma preta, anima a gota e troca o conteúdo de cada estado.

import { caminho, OMBRO } from "./forma";
import { mudarAtividade, type Expressao } from "./carinha";
import { Mola, type Firmeza } from "./mola";
import { ESTADOS, temSinalVerde } from "./estados";
import type { Contexto, NomeEstado, NomeTela, Notificacao, Pergunta, SessaoFoco, Trabalho } from "./contexto";
import { informarArea } from "../ponte";
import type { Novidade } from "../atualizacao";
import { ler, mudar, type ModoDiscreto } from "../dados/armazem";
import { pendentes } from "../dados/datas";
import { passear, pegarPersonagem, responderPermissao, vigiarJanelas, type Midia, type Volume } from "../maos/sistema";
import { tocarAlarme } from "./som";

// Molas no estilo das animações da Apple: definidas pelo "tempo de resposta"
// (quanto demora para chegar) e pelo "amortecimento" (1 = sem balanço;
// menos que 1 = passa um pouquinho e volta, como líquido).
function mola(resposta: number, amortecimento: number): Firmeza {
  const w = (2 * Math.PI) / resposta;
  return { rigidez: w * w, amortecimento: 2 * amortecimento * w };
}
// Abrindo: a altura desce macia com um leve balanço; a largura vem logo depois.
// Isso faz a ilha parecer uma gota escorrendo antes de se espalhar.
const ABRINDO_ALTURA = mola(0.5, 0.72);
const ABRINDO_LARGURA = mola(0.56, 0.84);
// Fechando: encolhe para os lados e sobe, macio e quase sem balanço.
const FECHANDO_ALTURA = mola(0.46, 0.92);
const FECHANDO_LARGURA = mola(0.4, 0.96);

const SVG = "http://www.w3.org/2000/svg";

export class Ilha {
  private readonly largura = new Mola(ESTADOS.repouso.largura);
  private readonly altura = new Mola(40);
  private readonly raio = new Mola(ESTADOS.repouso.raio);
  private readonly ombro = new Mola(OMBRO);
  private gota = 0;

  private readonly forma: SVGPathElement;
  private readonly brilho: SVGPathElement;
  private readonly contorno: SVGPathElement;
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
  // Modo discreto e "passar o mouse".
  private modoDiscreto: ModoDiscreto = "desligado";
  private janelaComAbas = false;
  private mouseDentro = false;
  private expandida = false;
  private relogioMouse = 0;
  // Atividades ao vivo na ilha fechada.
  private musica: Midia | null = null;
  private volume: Volume | null = null;
  private relogioVolume = 0;
  private dormindo = false;
  private trabalho: Trabalho | null = null;
  // O que o Dan está fazendo (para a carinha reagir).
  private digitando = false;
  private categoria = "";
  private expressaoAtividade: Expressao = "normal";
  /** Pedidos de permissão ("posso?") esperando resposta, na ordem. */
  private perguntas: Pergunta[] = [];
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
    // Brilho colorido em volta (estilo Siri): aparece ouvindo, falando ou trabalhando.
    this.svg.innerHTML = `
      <defs>
        <linearGradient id="grad-siri" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#ff6ec7"/><stop offset=".3" stop-color="#7b61ff"/>
          <stop offset=".55" stop-color="#2fd6ff"/><stop offset=".8" stop-color="#ffcf6e"/><stop offset="1" stop-color="#ff6ec7"/>
          <animateTransform attributeName="gradientTransform" type="rotate" values="0 .5 .5;360 .5 .5" dur="3.2s" repeatCount="indefinite"/>
        </linearGradient>
        <filter id="desfoque-siri" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="7"/></filter>
      </defs>`;
    this.brilho = document.createElementNS(SVG, "path");
    this.brilho.classList.add("brilho-siri");
    this.contorno = document.createElementNS(SVG, "path");
    this.contorno.classList.add("contorno-siri");
    this.svg.append(this.brilho, this.forma, this.contorno);

    this.camada = document.createElement("div");
    this.camada.className = "camada";
    this.medidor = document.createElement("div");
    this.medidor.className = "medidor";
    palco.append(this.svg, this.camada, this.medidor);

    // Clicar numa ilha compacta (repouso, aviso, tarefa pronta) abre a ilha inteira.
    let acabouDeArrastar = false;
    const aoClicar = () => {
      if (acabouDeArrastar) return;
      if (ESTADOS[this.estado].compacto) this.abrir();
    };

    // Apertar no personagem e arrastar: ele sai da ilha pendurado no mouse.
    let arraste: { x: number; y: number; id: number } | null = null;
    this.camada.addEventListener("pointerdown", (e) => {
      const carinha = (e.target as Element).closest?.(".estado.repouso > .carinha");
      if (!carinha || document.body.classList.contains("carinha-fora")) return;
      arraste = { x: e.screenX, y: e.screenY, id: e.pointerId };
    });
    window.addEventListener("pointermove", (e) => {
      if (!arraste || e.pointerId !== arraste.id) return;
      if (Math.hypot(e.screenX - arraste.x, e.screenY - arraste.y) < 8) return;
      arraste = null;
      acabouDeArrastar = true;
      window.setTimeout(() => (acabouDeArrastar = false), 400);
      document.body.classList.add("carinha-fora");
      pegarPersonagem().catch(() => document.body.classList.remove("carinha-fora"));
    });
    window.addEventListener("pointerup", () => (arraste = null));
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

  /** Estado de descanso: discreto (se ligado) > foco > aviso laranja > repouso. */
  private estadoBase(): NomeEstado {
    const discreto =
      this.modoDiscreto === "sempre" || (this.modoDiscreto === "automatico" && this.janelaComAbas);
    if (this.perguntas.length) return "confirmacao";
    if (this.ditado) return "ditando";
    if (discreto && !this.expandida) return "discreto";
    if (this.trabalho) return "trabalhando";
    if (this.foco || ler().timers.length) return "foco";
    if (pendentes(ler().assinaturas).length) return "aviso";
    if (this.musica?.tocando && ler().config.musicaNaIlha) return "musica";
    return "repouso";
  }

  fechar(): void {
    this.tela = "inicio";
    if (!this.mouseDentro) this.expandida = false;
    this.mostrar(this.estadoBase());
  }

  /** Estados de descanso, que podem ser trocados sem atrapalhar o Dan. */
  private emDescanso(): boolean {
    return ["repouso", "aviso", "foco", "discreto", "renovacao", "musica", "volume", "trabalhando", "ditando"].includes(this.estado);
  }

  /** O que está tocando mudou (vem a cada 2 s do main.ts). */
  definirMusica(m: Midia | null): void {
    const antes = this.musica;
    this.musica = m;
    this.atualizarAtividade();
    const mudou = antes?.titulo !== m?.titulo || antes?.tocando !== m?.tocando;
    if (!mudou || !this.emDescanso() || this.estado === "volume" || this.mouseDentro) return;
    if (this.estadoBase() !== this.estado) this.fechar();
    else if (this.estado === "musica") this.renovar();
  }

  /** Ditado em qualquer lugar: mostra o que está sendo ouvido, sem pegar o foco. */
  private ditado: { etapa: string; texto: string } | null = null;
  mostrarDitado(etapa: string, texto = ""): void {
    const ativo = etapa === "ouvindo" || etapa === "entendendo" || etapa === "texto";
    if (ativo) {
      this.ditado = { etapa: etapa === "texto" ? this.ditado?.etapa ?? "ouvindo" : etapa, texto: texto || this.ditado?.texto || "" };
      if (this.estado === "ditando") this.renovar();
      else if (this.emDescanso()) this.mostrar("ditando");
      return;
    }
    this.ditado = null;
    if (this.estado === "ditando") this.fechar();
  }

  /** O volume mudou: mostra por um instante na ilha (só se ela estiver fechada). */
  mostrarVolume(v: Volume): void {
    this.volume = v;
    if (!this.emDescanso()) return;
    if (this.estado === "volume") this.renovar();
    else this.mostrar("volume");
    window.clearTimeout(this.relogioVolume);
    this.relogioVolume = window.setTimeout(() => {
      if (this.estado === "volume") this.fechar();
    }, 1600);
  }

  /** Uma IA começou a trabalhar numa conversa da Central. */
  comecarTrabalho(id: string, titulo: string, motor: string): void {
    this.trabalho = { id, titulo, motor, inicio: Date.now() };
    if (this.emDescanso()) this.fechar();
  }

  /** Terminou: volta ao descanso e, se demorou ou é um motor "pesado", avisa. */
  terminarTrabalho(id: string, titulo: string, motor: string, ok: boolean, segundos: number): void {
    if (this.trabalho?.id === id) this.trabalho = null;
    const nomes: Record<string, string> = { deepseek: "DeepSeek", claude: "Claude Code", codex: "Codex", gemini: "Gemini", antigravity: "Antigravity" };
    if (motor !== "deepseek" || segundos > 20 || !ok) {
      this.notificar({
        titulo: ok ? `${nomes[motor] ?? motor} respondeu` : `${nomes[motor] ?? motor} parou`,
        detalhe: titulo,
        expressao: ok ? "feliz" : "triste",
        botao: {
          texto: "Ver",
          fazer: () => {
            // Conversa rápida: abre na própria ilha; as outras, na Central.
            if (id.startsWith("rapida-")) {
              this.abrir("conversa");
              return;
            }
            import("../maos/sistema").then((m) => m.abrirCentral("conversa-atual")).catch(() => {});
            this.fechar();
          },
        },
      });
    } else if (this.emDescanso()) {
      this.fechar();
    }
  }

  /** Outra janela (a Central) mudou os dados. */
  dadosMudaram(): void {
    if (this.estado === "aberta") {
      if (this.tela !== "notas") this.renovar();
    } else if (this.emDescanso() && this.estadoBase() !== this.estado) {
      this.fechar();
    }
  }

  /** O personagem saiu para passear (ou voltou). */
  passeando(fora: boolean): void {
    document.body.classList.toggle("carinha-fora", fora);
    if (!fora && this.estado === "repouso") {
      mudarAtividade("feliz");
      window.setTimeout(() => mudarAtividade(this.expressaoAtividade), 1800);
    }
  }

  /** De vez em quando (40 a 80 min), se nada estiver acontecendo, sai para passear. */
  agendarPasseios(): void {
    const proximo = () => (40 + Math.random() * 40) * 60_000;
    const tentar = () => {
      const c = ler().config;
      const sossegado =
        c.passeios &&
        c.brincadeiras &&
        this.estado === "repouso" &&
        !this.digitando &&
        !this.dormindo &&
        !["chamada", "video"].includes(this.categoria);
      if (sossegado) passear().catch(() => {});
      window.setTimeout(tentar, proximo());
    };
    window.setTimeout(tentar, proximo());
  }

  /** Rotinas com horário: confere a cada 30 s e roda as da hora. */
  agendarRotinas(): void {
    const conferir = async () => {
      const { rotinasDaHora, rodarRotina } = await import("./rotinas");
      const { paraISO } = await import("../dados/datas");
      for (const r of rotinasDaHora()) {
        // Marca antes de rodar, para não rodar duas vezes.
        mudar((d) => {
          const x = d.rotinas.find((y) => y.id === r.id);
          if (x) x.ultimaVez = paraISO(new Date());
        });
        const texto = await rodarRotina(r, this.contexto());
        this.notificar({ titulo: `Rotina: ${r.nome}`, detalhe: texto.slice(0, 160), expressao: "feliz" });
      }
    };
    window.setInterval(() => void conferir(), 30_000);
  }

  /** Uma IA pediu permissão: a ilha pergunta (passa na frente de tudo). */
  perguntar(p: Pergunta): void {
    this.perguntas.push(p);
    if (this.perguntas.length === 1) this.mostrar("confirmacao");
  }

  /** A pergunta foi respondida em outro lugar (Central) ou o tempo acabou. */
  esquecerPergunta(id: string): void {
    const antes = this.perguntas.length;
    this.perguntas = this.perguntas.filter((p) => p.id !== id);
    if (antes !== this.perguntas.length && this.estado === "confirmacao") this.fechar();
  }

  private responderPergunta(permitir: boolean): void {
    const p = this.perguntas.shift();
    if (p) responderPermissao(p.id, permitir).catch(() => {});
    this.fechar();
  }

  /** O Windows contou: digitando? qual tipo de programa na frente? */
  atividade(digitando: boolean, categoria: string): void {
    this.digitando = digitando;
    this.categoria = categoria;
    this.atualizarAtividade();
  }

  /** Escolhe a animação da carinha conforme o que está acontecendo. */
  private calcularAtividade(): Expressao {
    if (!ler().config.perceberAtividade) return "normal";
    const c = this.categoria;
    if (c === "chamada") return "chamada";
    if (this.digitando) return c === "codigo" ? "programando" : "digitando";
    if (c === "design") return "desenhando";
    if (this.musica?.tocando) return "musica";
    if (c === "video") return "assistindo";
    if (c === "navegador" || c === "codigo" || c === "escrita") return "lendo";
    const hora = new Date().getHours();
    if (hora < 5) return "sonolento";
    return "normal";
  }

  atualizarAtividade(): void {
    const nova = this.calcularAtividade();
    if (nova === this.expressaoAtividade) return;
    this.expressaoAtividade = nova;
    if (!this.dormindo) mudarAtividade(nova);
  }

  /** Mouse parado há 5 min (ou voltou a mexer): cochila ou acorda. */
  ocioso(parado: boolean): void {
    // Vendo vídeo, em chamada ou com música tocando, ele não dorme.
    const ocupado = ["video", "chamada"].includes(this.categoria) || !!this.musica?.tocando;
    const dormir = parado && ler().config.cochilar && !ocupado;
    if (dormir === this.dormindo) return;
    this.dormindo = dormir;
    if (this.estado === "repouso") this.renovar();
  }

  /** Começa um timer com nome (fica salvo: sobrevive a fechar a ilha). */
  comecarTimer(nome: string, minutos: number): void {
    mudar((d) =>
      d.timers.push({ id: String(Date.now()), nome, minutos, fim: Date.now() + minutos * 60_000 }),
    );
    if (this.emDescanso()) this.fechar();
  }

  definirModoDiscreto(modo: ModoDiscreto): void {
    this.modoDiscreto = modo;
    vigiarJanelas(modo === "automatico").catch(() => {});
    if (modo !== "automatico") this.janelaComAbas = false;
    if (this.emDescanso()) this.fechar();
  }

  /** Programa na frente mudou (só chega quando o modo é "automático"). */
  definirJanelaComAbas(comAbas: boolean): void {
    if (comAbas === this.janelaComAbas) return;
    this.janelaComAbas = comAbas;
    if (this.emDescanso() && !this.mouseDentro) this.fechar();
  }

  /**
   * O mouse entrou ou saiu da ilha. Parado em cima por um instante: o risquinho
   * cresce e, se alguma IA está renovando, aparece qual e quanto falta.
   * Saiu: volta ao descanso pouco depois.
   */
  mouse(dentro: boolean): void {
    this.mouseDentro = dentro;
    if (dentro && this.dormindo) {
      this.dormindo = false;
      if (this.estado === "repouso") this.renovar();
    }
    window.clearTimeout(this.relogioMouse);
    if (dentro) {
      this.relogioMouse = window.setTimeout(() => {
        if (!this.mouseDentro) return;
        if (this.estado === "discreto") {
          this.expandida = true;
          if (this.estadoBase() === "repouso" && temSinalVerde()) this.mostrar("renovacao");
          else this.fechar();
        } else if (this.estado === "repouso" && temSinalVerde()) {
          this.mostrar("renovacao");
        }
      }, 350);
    } else {
      this.relogioMouse = window.setTimeout(() => {
        if (this.mouseDentro) return;
        const voltar = this.expandida || this.estado === "renovacao";
        this.expandida = false;
        if (voltar && this.emDescanso()) this.fechar();
      }, 700);
    }
  }

  irPara(tela: NomeTela): void {
    this.abrir(tela);
  }

  definirAtalho(atalho: string | null): void {
    this.atalho = atalho;
  }

  /** Mostra um aviso (de outro programa, de um lembrete, do foco…). */
  notificar(n: Omit<Notificacao, "id" | "quando">): void {
    this.dormindo = false;
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
    // Timers que acabaram: toca o alarme e avisa.
    const acabaram = ler().timers.filter((t) => t.fim <= agora);
    if (acabaram.length) {
      mudar((d) => (d.timers = d.timers.filter((t) => t.fim > agora)));
      tocarAlarme();
      for (const t of acabaram) {
        this.notificar({ titulo: `${t.nome}: acabou o tempo`, detalhe: `Timer de ${t.minutos} min`, expressao: "surpreso" });
      }
    }
    if (this.foco && agora >= this.foco.fim) {
      const terminou = this.foco.tipo;
      this.foco = null;
      tocarAlarme();
      const pausa = ler().config.pausaMinutos;
      if (terminou === "foco") {
        this.notificar({
          titulo: "Foco concluído",
          detalhe: `Que tal uma pausa de ${pausa} min?`,
          expressao: "feliz",
          botao: { texto: "Pausar", fazer: () => this.comecarFoco("pausa", pausa) },
        });
      } else {
        this.notificar({ titulo: "Fim da pausa", detalhe: "Bora voltar?", expressao: "piscadinha" });
      }
    }
    // A cada 30 s: o aviso laranja pode ter começado (virou o dia) ou acabado.
    if (agora % 30_000 < 1000 && ["repouso", "aviso", "discreto"].includes(this.estado)) {
      if (this.estadoBase() !== this.estado) this.fechar();
      else if (temSinalVerde() !== this.sinalVerde) this.renovar();
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
    this.svg.classList.toggle("com-brilho", estado === "ouvindo" || estado === "trabalhando" || estado === "ditando");
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
    this.ombro.alvo = definicao.ombro ?? OMBRO;
    if (imediato) {
      this.largura.pular();
      this.altura.pular();
      this.raio.pular();
      this.ombro.pular();
    }

    this.informarArea();
    this.animar();
  }

  /** Contexto para as ações pedidas pelas IAs (não consome o recado da tela). */
  contextoParaAcoes(): Contexto {
    const recado = this.mensagem;
    const c = this.contexto();
    this.mensagem = recado;
    return c;
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
      musica: this.musica,
      dormindo: this.dormindo,
      atividade: this.expressaoAtividade,
      pergunta: this.perguntas[0] ?? null,
      responderPergunta: (permitir) => this.responderPergunta(permitir),
      trabalho: this.trabalho,
      volume: this.volume,
      ditado: this.ditado,
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
      definirModoDiscreto: (modo) => this.definirModoDiscreto(modo),
      comecarTimer: (nome, minutos) => this.comecarTimer(nome, minutos),
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
      this.ombro.passo(segundos, FECHANDO_LARGURA);

      // A gota acompanha a velocidade com que a ilha desce (ou sobe), com suavidade.
      const alvoGota = Math.max(-8, Math.min(26, this.altura.velocidade * 0.026));
      this.gota += (alvoGota - this.gota) * Math.min(1, segundos * 12);

      this.redesenhar();
      this.revelarSeChegou();

      const parado =
        this.altura.parada &&
        this.largura.parada &&
        this.raio.parada &&
        this.ombro.parada &&
        Math.abs(this.gota) < 0.2;
      if (parado) {
        this.largura.pular();
        this.altura.pular();
        this.raio.pular();
        this.ombro.pular();
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
    const medidas = {
      largura: this.largura.valor,
      altura: this.altura.valor,
      raio: this.raio.valor,
      gota: this.gota,
      ombro: this.ombro.valor,
    };
    const d = caminho(medidas, this.centro);
    this.forma.setAttribute("d", d);
    // O brilho colorido não passa na linha de cima, a que encosta na borda da tela.
    const semTopo = caminho(medidas, this.centro, true);
    this.brilho.setAttribute("d", semTopo);
    this.contorno.setAttribute("d", semTopo);
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
