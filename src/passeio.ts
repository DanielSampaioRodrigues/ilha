// Passeio: o personagem pula da ilha, anda pela parte de baixo da tela, faz
// alguma coisa (brinca de bola, encontra um amigo, cresce, dança, tira um
// cochilo) e volta para a ilha. Roda numa janela transparente que não pega
// o clique. Cada passeio sorteia o que acontece.
//
// O Dan pode pegar o personagem com o mouse (arrastando da ilha ou clicando
// nele enquanto passeia): ele fica pendurado no mouse e, ao soltar, cai com
// gravidade (jogado com força, vai quicando). Depois segue o passeio.
import "./estilo.css";
import { invoke } from "@tauri-apps/api/core";
import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import { carregar, ler } from "./dados/armazem";
import { dentroDoApp, ouvir } from "./ponte";
import { Carinha, PERSONAGENS, type Expressao, type PersonagemId } from "./corpo/carinha";

const TAMANHO = 5; // pixels de cada "pixel" do personagem
/** O Dan pegou o personagem: o que estava acontecendo para na hora. */
class Interrompido extends Error {}
/** Muda cada vez que o Dan pega o personagem; quem é de uma "geração" antiga para. */
let geracao = 0;
let pego = false;
const espera = (ms: number) => {
  const g = geracao;
  return new Promise<void>((ok, falha) => window.setTimeout(() => (g !== geracao ? falha(new Interrompido()) : ok()), ms));
};
/** Um passo de animação por quadro, até "fazer" devolver true (ou o Dan pegar o personagem). */
function quadros(fazer: (agora: number) => boolean): Promise<void> {
  const g = geracao;
  return new Promise<void>((ok, falha) => {
    const passo = (agora: number) => {
      if (g !== geracao) return falha(new Interrompido());
      if (fazer(agora)) ok();
      else requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  });
}
const sorteio = <T,>(lista: T[]) => lista[Math.floor(Math.random() * lista.length)];

/** Um bichinho na tela: carinha + pezinhos, que anda, pula e muda de cara. */
class Bicho {
  readonly el: HTMLElement;
  private readonly carinha: Carinha;
  x = 0;
  y = 0;
  escala = 1;

  constructor(palco: HTMLElement, personagem?: PersonagemId, tamanhoPedido = TAMANHO) {
    // Os 3D (feitos com IA) andam um pouco maiores, para os detalhes aparecerem.
    const tamanho = PERSONAGENS[personagem ?? ler().config.personagem]?.imagens ? tamanhoPedido + 2 : tamanhoPedido;
    this.el = document.createElement("div");
    this.el.className = "bicho";
    // Personagem 3D (feito com IA): anda solto, sem a cápsula e os pezinhos.
    if (PERSONAGENS[personagem ?? ler().config.personagem]?.imagens) this.el.classList.add("bicho-3d");
    this.carinha = new Carinha("normal", {
      corpoInteiro: true,
      tamanho,
      comAcessorio: true,
      aparencia: personagem ? { personagem, acessorio: "nenhum" } : undefined,
    });
    // Corpinho: uma mini-ilha preta com a carinha, e os pezinhos embaixo.
    const cabeca = document.createElement("div");
    cabeca.className = "cabeca-bicho";
    cabeca.append(this.carinha.elemento);
    const pes = document.createElement("div");
    pes.className = "pes";
    pes.innerHTML = "<i></i><i></i>";
    this.el.append(cabeca, pes);
    palco.append(this.el);
  }

  get largura(): number {
    return this.el.offsetWidth;
  }

  get altura(): number {
    return this.el.offsetHeight;
  }

  colocar(x: number, y: number, escala = this.escala): void {
    this.x = x;
    this.y = y;
    this.escala = escala;
    this.el.style.transform = `translate(${x}px, ${y}px) scale(${escala})`;
  }

  cara(e: Expressao): void {
    this.carinha.mudar(e);
  }

  olhar(dx: number): void {
    this.carinha.olharPara(dx, 0);
  }

  /**
   * Anda até x de verdade: cada passo troca o quadro conforme a distância
   * andada (pé no chão não escorrega) e o corpo sobe quando as pernas se
   * cruzam e desce quando o pé encosta no chão.
   */
  async andar(destino: number, velocidade = 90): Promise<void> {
    const inicio = this.x;
    const distancia = destino - inicio;
    if (Math.abs(distancia) < 2) return;
    this.cara("andando");
    this.olhar(Math.sign(distancia));
    this.el.classList.add("andando");
    const tempo = (Math.abs(distancia) / velocidade) * 1000;
    const comeco = performance.now();
    // Tamanho de meio passo: proporcional ao personagem (os grandes dão passos maiores).
    const passada = Math.max(14, this.largura * 0.15);
    // Começa e termina mais devagar (ninguém sai a 100 por hora).
    const suave = (t: number) => (t < 0.12 ? (t * t) / 0.2112 : t > 0.88 ? 1 - ((1 - t) * (1 - t)) / 0.2112 : (t - 0.06) / 0.88);
    try {
      await quadros((agora) => {
        const t = Math.min(1, (agora - comeco) / tempo);
        this.x = inicio + distancia * suave(t);
        const andado = Math.abs(this.x - inicio) / passada;
        this.carinha.passo(Math.floor(andado));
        const onda = Math.sin((Math.PI / 2) * (andado - 0.5));
        // Pezinhos (dos personagens de pixel): um levanta de cada vez, no mesmo ritmo.
        const [pe1, pe2] = this.el.querySelectorAll<HTMLElement>(".pes i");
        if (pe1 && pe2) {
          pe1.style.transform = `translateY(${(-5 * Math.max(0, onda)).toFixed(1)}px)`;
          pe2.style.transform = `translateY(${(-5 * Math.max(0, -onda)).toFixed(1)}px)`;
        }
        // Quadros 1 e 3 (pé no chão): embaixo; quadros 2 (pernas juntas): em cima.
        const balanco = -3 * Math.abs(onda);
        this.el.style.transform = `translate(${this.x}px, ${this.y + balanco}px) scale(${this.escala})`;
        return t >= 1;
      });
    } finally {
      // Mesmo se o Dan pegar o personagem no meio do passo: pés no chão.
      this.el.classList.remove("andando");
      for (const pe of this.el.querySelectorAll<HTMLElement>(".pes i")) pe.style.transform = "";
    }
    this.x = destino;
    this.el.style.transform = `translate(${this.x}px, ${this.y}px) scale(${this.escala})`;
    this.cara("normal");
    this.olhar(0);
  }

  /** Pulo em arco até (x, y), mudando de tamanho no caminho. */
  async pular(x: number, y: number, ms = 700, altura = 80, escalaFinal = this.escala): Promise<void> {
    const [x0, y0, e0] = [this.x, this.y, this.escala];
    const comeco = performance.now();
    await quadros((agora) => {
      const t = Math.min(1, (agora - comeco) / ms);
      const arco = -4 * altura * t * (1 - t);
      const e = e0 + (escalaFinal - e0) * t;
      this.x = x0 + (x - x0) * t;
      this.y = y0 + (y - y0) * t + arco;
      this.escala = e;
      this.el.style.transform = `translate(${this.x}px, ${this.y}px) scale(${e})`;
      return t >= 1;
    });
    this.colocar(x, y, escalaFinal);
  }

  /** Amassa ao cair no chão. */
  async amassar(): Promise<void> {
    this.el.classList.add("amassando");
    await espera(260);
    this.el.classList.remove("amassando");
  }

  sumir(): void {
    this.el.remove();
  }

  /** Pendurado no mouse: segura pela cabeça e balança conforme o movimento. */
  segurar(x: number, y: number, inclinacao: number): void {
    this.el.style.transformOrigin = "50% 6%";
    this.escala = 1;
    this.x = x - this.largura / 2;
    this.y = y - this.altura * 0.06;
    this.el.style.transform = `translate(${this.x}px, ${this.y}px) rotate(${inclinacao.toFixed(1)}deg)`;
  }

  /** Cai com gravidade a partir de onde está; jogado com força, quica nas bordas e no chão. */
  async cair(vx: number, vy: number, chao: number, largura: number): Promise<void> {
    this.el.style.transformOrigin = "";
    this.cara("surpreso");
    let { x, y } = this;
    let quique = 0;
    await quadros(() => {
      vy += 1.1;
      x += vx;
      y += vy;
      if (x < 0) [x, vx] = [0, -vx * 0.6];
      if (x > largura - this.largura) [x, vx] = [largura - this.largura, -vx * 0.6];
      if (y < -this.altura) [y, vy] = [-this.altura, Math.abs(vy) * 0.5];
      if (y >= chao) {
        y = chao;
        if (Math.abs(vy) < 4 || quique > 4) return true;
        vy = -vy * 0.45;
        vx *= 0.75;
        quique++;
        this.cara(quique > 1 ? "rindo" : "surpreso");
      }
      this.x = x;
      this.y = y;
      this.el.style.transform = `translate(${x}px, ${y}px) rotate(${(vx * 1.6).toFixed(1)}deg)`;
      return false;
    });
    this.colocar(x, chao, 1);
    await this.amassar();
  }
}

/** Uma bolinha que rola até parar. */
function bola(palco: HTMLElement, x: number, chao: number): HTMLElement {
  const b = document.createElement("div");
  b.className = "bola-passeio";
  b.style.transform = `translate(${x}px, ${chao}px)`;
  palco.append(b);
  return b;
}

function brilhos(palco: HTMLElement, x: number, y: number, emoji = "✨"): void {
  for (let i = 0; i < 6; i++) {
    const s = document.createElement("span");
    s.className = "brilho-passeio";
    s.textContent = emoji;
    s.style.left = `${x + (Math.random() - 0.5) * 80}px`;
    s.style.top = `${y + (Math.random() - 0.5) * 50}px`;
    s.style.animationDelay = `${i * 90}ms`;
    palco.append(s);
    window.setTimeout(() => s.remove(), 1600);
  }
}

// ---------- O que pode acontecer no passeio ----------

async function brincarDeBola(palco: HTMLElement, bicho: Bicho, chao: number, largura: number): Promise<void> {
  const xBola = Math.min(largura - 80, Math.max(40, bicho.x + (Math.random() < 0.5 ? -220 : 220)));
  const b = bola(palco, xBola, chao + bicho.altura - 26);
  bicho.cara("surpreso");
  await espera(700);
  await bicho.andar(xBola - (xBola > bicho.x ? bicho.largura : -26), 120);
  // Chuta: a bola rola para longe.
  bicho.cara("pulando");
  const lado = xBola > bicho.x ? 1 : -1;
  const destino = Math.min(largura - 30, Math.max(10, xBola + lado * 300));
  b.style.transition = "transform 1.4s cubic-bezier(0.2, 0.7, 0.3, 1)";
  b.style.transform = `translate(${destino}px, ${chao + bicho.altura - 26}px) rotate(${lado * 720}deg)`;
  await bicho.pular(bicho.x, bicho.y, 450, 40);
  await bicho.amassar();
  await espera(900);
  b.style.transition = "opacity 0.5s";
  b.style.opacity = "0";
  window.setTimeout(() => b.remove(), 600);
  bicho.cara("feliz");
  await espera(800);
}

async function encontrarAmigo(palco: HTMLElement, bicho: Bicho, chao: number, largura: number): Promise<void> {
  const meu = ler().config.personagem;
  const outros = (Object.keys(PERSONAGENS) as PersonagemId[]).filter((p) => p !== meu);
  const amigo = new Bicho(palco, sorteio(outros), TAMANHO - 1);
  const daDireita = bicho.x < largura / 2;
  amigo.colocar(daDireita ? largura + 20 : -amigo.largura - 20, chao + bicho.altura - amigo.altura);
  bicho.cara("surpreso");
  await amigo.andar(daDireita ? bicho.x + bicho.largura + 24 : bicho.x - amigo.largura - 24, 110);
  bicho.olhar(daDireita ? 1 : -1);
  amigo.olhar(daDireita ? -1 : 1);
  bicho.cara("apaixonado");
  amigo.cara("apaixonado");
  brilhos(palco, (bicho.x + amigo.x) / 2 + 30, chao - 10, "💗");
  await Promise.all([bicho.pular(bicho.x, bicho.y, 420, 30), amigo.pular(amigo.x, amigo.y, 420, 30)]);
  await espera(900);
  bicho.cara("piscadinha");
  amigo.cara("feliz");
  await espera(700);
  await amigo.andar(daDireita ? largura + 40 : -amigo.largura - 40, 130);
  amigo.sumir();
  bicho.cara("feliz");
  await espera(500);
}

async function crescer(palco: HTMLElement, bicho: Bicho): Promise<void> {
  bicho.cara("surpreso");
  await espera(400);
  // Cresce a partir dos pés.
  const base = bicho.y + bicho.altura;
  const subir = (e: number) => base - bicho.altura * e;
  for (const e of [1.4, 1.2, 1.9, 1.7, 2.4]) {
    await bicho.pular(bicho.x, subir(e) + bicho.altura * (e - 1) * 0.0, 160, 0, e);
  }
  bicho.cara("rindo");
  brilhos(palco, bicho.x + bicho.largura / 2, bicho.y - 20);
  await espera(1100);
  bicho.cara("confuso");
  await espera(500);
  await bicho.pular(bicho.x, bicho.y, 400, 0, 1);
  await bicho.amassar();
  bicho.cara("feliz");
  await espera(500);
}

async function dancar(bicho: Bicho): Promise<void> {
  bicho.cara("musica");
  for (let i = 0; i < 6; i++) await bicho.pular(bicho.x + (i % 2 ? 14 : -14), bicho.y, 330, 22);
  await espera(300);
}

async function cochilar(palco: HTMLElement, bicho: Bicho): Promise<void> {
  bicho.cara("sonolento");
  await espera(1600);
  bicho.cara("dormindo");
  const z = document.createElement("span");
  z.className = "zzz zzz-passeio";
  z.innerHTML = "<i>z</i><i>z</i><i>z</i>";
  z.style.transform = `translate(${bicho.x + bicho.largura}px, ${bicho.y - 10}px)`;
  palco.append(z);
  await espera(3500);
  z.remove();
  bicho.cara("surpreso");
  await bicho.pular(bicho.x, bicho.y, 300, 30);
  bicho.cara("feliz");
  await espera(400);
}

async function acenar(bicho: Bicho): Promise<void> {
  bicho.cara("acenando");
  await bicho.pular(bicho.x, bicho.y, 380, 26);
  await espera(900);
}

/** Deixa só o personagem principal no palco (some a bola, o amigo, os brilhos…). */
function limparPalco(palco: HTMLElement, bicho: Bicho): void {
  for (const filho of [...palco.children]) if (filho !== bicho.el) filho.remove();
}

export async function iniciarPasseio(): Promise<void> {
  document.body.classList.add("modo-passeio");
  await carregar();
  const palco = document.getElementById("palco")!;
  palco.replaceChildren();
  const largura = window.innerWidth;
  const altura = window.innerHeight;
  const bicho = new Bicho(palco);
  await espera(60);
  const chao = altura - bicho.altura - 6;
  const meio = largura / 2 - bicho.largura / 2;

  const coisas = [
    () => brincarDeBola(palco, bicho, chao, largura),
    () => encontrarAmigo(palco, bicho, chao, largura),
    () => crescer(palco, bicho),
    () => dancar(bicho),
    () => cochilar(palco, bicho),
    () => acenar(bicho),
  ];
  const fazerCoisas = async (quantas: number) => {
    const sorteio = [...coisas];
    for (let i = 0; i < quantas; i++) {
      await bicho.andar(Math.max(30, Math.min(largura - bicho.largura - 30, Math.random() * largura)), 75);
      await espera(400);
      await sorteio.splice(Math.floor(Math.random() * sorteio.length), 1)[0]();
    }
  };
  const voltar = async () => {
    // Volta para a ilha: anda até o meio e pula para dentro.
    await bicho.andar(meio, 110);
    bicho.cara("pulando");
    await espera(300);
    await bicho.pular(meio, 4, 900, 140, 0.35);
    bicho.sumir();
    if (dentroDoApp) await invoke("fim_passeio").catch(() => {});
  };
  /** Roda uma sequência; se o Dan pegar o personagem no meio, ela simplesmente para. */
  const rodar = async (sequencia: () => Promise<void>) => {
    try {
      await sequencia();
      await voltar();
    } catch (e) {
      if (!(e instanceof Interrompido)) throw e;
    }
  };

  // ---------- Na mão do Dan ----------
  const rastro: { x: number; y: number; t: number }[] = [];
  let inclinacao = 0;
  // Soltar perto da ilha (no topo, no meio) devolve o personagem para casa.
  const zona = document.createElement("div");
  zona.className = "zona-ilha";
  zona.innerHTML = "<span>Solte aqui para voltar</span>";
  const pertoDaIlha = (x: number, y: number) => y < 150 && Math.abs(x - largura / 2) < 260;
  const voltarParaCasa = async () => {
    zona.remove();
    bicho.cara("feliz");
    await bicho.pular(meio, 4, 520, 60, 0.35);
    bicho.sumir();
    if (dentroDoApp) await invoke("fim_passeio").catch(() => {});
  };
  const pegar = (x: number, y: number) => {
    if (!pego) {
      pego = true;
      geracao++;
      limparPalco(palco, bicho);
      palco.append(zona);
      bicho.cara("surpreso");
      window.setTimeout(() => pego && bicho.cara("pulando"), 500);
    }
    rastro.push({ x, y, t: performance.now() });
    if (rastro.length > 5) rastro.shift();
    // Balança para o lado contrário do movimento, como pendurado.
    const dx = rastro.length > 1 ? rastro[rastro.length - 1].x - rastro[rastro.length - 2].x : 0;
    inclinacao += (Math.max(-30, Math.min(30, -dx * 2.2)) - inclinacao) * 0.35;
    bicho.segurar(x, y, inclinacao);
    zona.classList.toggle("perto", pertoDaIlha(x, y));
  };
  const soltar = (x: number, y: number) => {
    if (!pego) return;
    pegar(x, y);
    pego = false;
    // Velocidade dos últimos movimentos (px por quadro): dá para jogá-lo.
    const [a, b] = [rastro[0], rastro[rastro.length - 1]];
    const quadrosPassados = Math.max(1, (b.t - a.t) / 16);
    const limite = (v: number) => Math.max(-38, Math.min(38, v));
    const vx = limite((b.x - a.x) / quadrosPassados);
    const vy = limite((b.y - a.y) / quadrosPassados);
    rastro.length = 0;
    inclinacao = 0;
    if (pertoDaIlha(x, y)) {
      void voltarParaCasa().catch(() => {});
      return;
    }
    zona.remove();
    void rodar(async () => {
      await bicho.cair(vx, vy, chao, largura);
      bicho.cara("confuso");
      await espera(600);
      bicho.cara("feliz");
      await espera(500);
      await fazerCoisas(1);
    });
  };
  ligarMaos(bicho, pegar, soltar);

  const comeco = dentroDoApp
    ? await invoke<{ modo: string; x: number; y: number }>("comeco_do_passeio").catch(() => ({ modo: "normal", x: 0, y: 0 }))
    : { modo: new URLSearchParams(location.search).get("comeco") ?? "normal", x: largura / 2, y: altura / 3 };
  if (comeco.modo === "segurando" || comeco.modo === "solto") {
    // Saiu da ilha na mão do Dan.
    pegar(comeco.x, comeco.y);
    if (comeco.modo === "solto") soltar(comeco.x, comeco.y);
    return;
  }

  void rodar(async () => {
    // 1. Sai da ilha (pequenininho) e cai até o chão.
    bicho.colocar(meio, 4, 0.35);
    bicho.cara("surpreso");
    await espera(250);
    await bicho.pular(meio + (Math.random() - 0.5) * 300, chao, 1100, 120, 1);
    await bicho.amassar();
    bicho.cara("feliz");
    await espera(500);
    // 2. Passeia e faz três coisas sorteadas.
    await fazerCoisas(3);
  });
}

/**
 * Deixa o Dan pegar o personagem: a janela do passeio deixa o clique passar,
 * menos quando o mouse está em cima dele. Ao clicar, o Rust passa a seguir o
 * mouse (mesmo fora da janela) e manda "arrastar" e "soltar".
 */
function ligarMaos(bicho: Bicho, pegar: (x: number, y: number) => void, soltar: (x: number, y: number) => void): void {
  ouvir<{ x: number; y: number }>("passeio:arrastar", ({ x, y }) => pegar(x, y));
  ouvir<{ x: number; y: number }>("passeio:soltar", ({ x, y }) => soltar(x, y));
  // Fora do app (testes no navegador): dá para simular pelo console.
  Object.assign(window, { passeioTeste: { pegar, soltar } });
  if (!dentroDoApp) return;
  const janela = getCurrentWindow();
  void (async () => {
    const [posicao, escala] = await Promise.all([janela.outerPosition(), janela.scaleFactor()]);
    let atravessando = true;
    window.setInterval(async () => {
      if (pego || !bicho.el.isConnected) return;
      const c = await cursorPosition().catch(() => null);
      if (!c) return;
      const x = (c.x - posicao.x) / escala;
      const y = (c.y - posicao.y) / escala;
      const r = bicho.el.getBoundingClientRect();
      const emCima = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      if (emCima === atravessando) {
        atravessando = !emCima;
        await janela.setIgnoreCursorEvents(atravessando).catch(() => {});
      }
    }, 60);
    bicho.el.addEventListener("pointerdown", () => {
      atravessando = true;
      void janela.setIgnoreCursorEvents(true).catch(() => {});
      void invoke("pegar_personagem").catch(() => {});
    });
  })();
}
