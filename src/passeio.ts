// Passeio: o personagem pula da ilha, anda pela parte de baixo da tela, faz
// alguma coisa (brinca de bola, encontra um amigo, cresce, dança, tira um
// cochilo) e volta para a ilha. Roda numa janela transparente que não pega
// o clique. Cada passeio sorteia o que acontece.
import "./estilo.css";
import { invoke } from "@tauri-apps/api/core";
import { carregar, ler } from "./dados/armazem";
import { dentroDoApp } from "./ponte";
import { Carinha, PERSONAGENS, type Expressao, type PersonagemId } from "./corpo/carinha";

const TAMANHO = 5; // pixels de cada "pixel" do personagem
const espera = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
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
      tamanho,
      comAcessorio: true,
      corpoInteiro: true,
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

  /** Anda até x, balançando e mexendo os pés. */
  async andar(destino: number, velocidade = 90): Promise<void> {
    const inicio = this.x;
    const distancia = destino - inicio;
    if (Math.abs(distancia) < 2) return;
    this.cara("andando");
    this.olhar(Math.sign(distancia));
    this.el.classList.add("andando");
    const tempo = (Math.abs(distancia) / velocidade) * 1000;
    const comeco = performance.now();
    await new Promise<void>((pronto) => {
      const passo = (agora: number) => {
        const t = Math.min(1, (agora - comeco) / tempo);
        const balanco = Math.abs(Math.sin(t * tempo * 0.012)) * -4;
        this.el.style.transform = `translate(${inicio + distancia * t}px, ${this.y + balanco}px) scale(${this.escala})`;
        if (t < 1) requestAnimationFrame(passo);
        else pronto();
      };
      requestAnimationFrame(passo);
    });
    this.x = destino;
    this.el.classList.remove("andando");
    this.cara("normal");
    this.olhar(0);
  }

  /** Pulo em arco até (x, y), mudando de tamanho no caminho. */
  async pular(x: number, y: number, ms = 700, altura = 80, escalaFinal = this.escala): Promise<void> {
    const [x0, y0, e0] = [this.x, this.y, this.escala];
    const comeco = performance.now();
    await new Promise<void>((pronto) => {
      const passo = (agora: number) => {
        const t = Math.min(1, (agora - comeco) / ms);
        const arco = -4 * altura * t * (1 - t);
        const e = e0 + (escalaFinal - e0) * t;
        this.el.style.transform = `translate(${x0 + (x - x0) * t}px, ${y0 + (y - y0) * t + arco}px) scale(${e})`;
        if (t < 1) requestAnimationFrame(passo);
        else pronto();
      };
      requestAnimationFrame(passo);
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

  // 1. Sai da ilha (pequenininho) e cai até o chão.
  bicho.colocar(meio, 4, 0.35);
  bicho.cara("surpreso");
  await espera(250);
  await bicho.pular(meio + (Math.random() - 0.5) * 300, chao, 1100, 120, 1);
  await bicho.amassar();
  bicho.cara("feliz");
  await espera(500);

  // 2. Passeia e faz duas coisas sorteadas.
  const coisas = [
    () => brincarDeBola(palco, bicho, chao, largura),
    () => encontrarAmigo(palco, bicho, chao, largura),
    () => crescer(palco, bicho),
    () => dancar(bicho),
    () => cochilar(palco, bicho),
    () => acenar(bicho),
  ];
  for (let i = 0; i < 3; i++) {
    await bicho.andar(Math.max(30, Math.min(largura - bicho.largura - 30, Math.random() * largura)), 75);
    await espera(400);
    const escolhida = coisas.splice(Math.floor(Math.random() * coisas.length), 1)[0];
    await escolhida();
  }

  // 3. Volta para a ilha: anda até o meio e pula para dentro.
  await bicho.andar(meio, 110);
  bicho.cara("pulando");
  await espera(300);
  await bicho.pular(meio, 4, 900, 140, 0.35);
  bicho.sumir();
  if (dentroDoApp) await invoke("fim_passeio").catch(() => {});
}
