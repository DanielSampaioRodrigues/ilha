// Personagem: aparência do robô (cor dos olhos, bochechas, acessório) e jeito
// de ser (olhos seguem o mouse, brincadeiras, cochilo). Com prévia ao vivo.
import { ler, mudar, type Config } from "../../dados/armazem";
import { passear, perceberAtividade } from "../../maos/sistema";
import {
  Carinha,
  NOMES_ACESSORIOS,
  NOMES_EXPRESSOES,
  NOMES_ESTILOS_OLHOS,
  type EstiloOlhos,
  PERSONAGENS,
  type Acessorio,
  type Expressao,
  type PersonagemId,
} from "../carinha";
import type { Contexto } from "../contexto";
import { aoClicar, cabecalho, html } from "../ui";

const CORES_OLHOS = [
  ["Ciano", "#3FE6EE"],
  ["Verde", "#5BE38F"],
  ["Azul", "#7BA7FF"],
  ["Lilás", "#B78CFF"],
  ["Rosa", "#FF8FB4"],
  ["Amarelo", "#FFD84D"],
  ["Branco", "#F2F4F6"],
];

const CORES_BOCHECHAS = [
  ["Rosa", "#FF8FB4"],
  ["Pêssego", "#FFB38A"],
  ["Lilás", "#C9A2FF"],
  ["Sem bochechas", "nenhuma"],
];

/** Botão arco-íris: abre a paleta do Windows para qualquer cor. */
export function arcoIris(atual: string, grupo: string, naLista: boolean): string {
  const valor = /^#[0-9a-f]{6}$/i.test(atual) ? atual : "#3fe6ee";
  return `<label class="amostra arco-iris ${naLista ? "" : "ativa"}" title="Qualquer cor" aria-label="Escolher qualquer cor"${naLista ? "" : ` style="--cor-livre:${valor}"`}><input type="color" value="${valor}" data-cor-livre="${grupo}"></label>`;
}

// Expressão mostrada na prévia (fica entre redesenhos da tela).
let expressaoPrevia: Expressao = "feliz";

function interruptor(id: string, titulo: string, texto: string, ligado: boolean): string {
  return `
    <div class="item">
      <div class="coluna"><span class="principal">${titulo}</span><span class="secundario">${texto}</span></div>
      <button type="button" class="chave" role="switch" aria-checked="${ligado}" aria-label="${titulo}" data-acao="alternar" data-opcao="${id}"><span></span></button>
    </div>`;
}

export function montarPersonagem(ctx: Contexto): HTMLElement {
  const c = ler().config;
  const cartao = (id: PersonagemId) => `
    <button type="button" class="cartao-personagem ${id === c.personagem ? "ativo" : ""}" data-acao="personagem" data-personagem="${id}" aria-pressed="${id === c.personagem}">
      <span class="rosto-personagem" data-rosto="${id}"></span>
      <span class="principal">${PERSONAGENS[id].nome}</span>
      <span class="secundario">${PERSONAGENS[id].jeito}</span>
    </button>`;
  const amostras = (lista: string[][], atual: string, grupo: string) =>
    lista
      .map(
        ([nome, cor]) =>
          `<button type="button" class="amostra ${cor === atual ? "ativa" : ""} ${cor === "nenhuma" ? "nenhuma" : ""}" style="${cor === "nenhuma" ? "" : `background:${cor}`}" aria-label="${nome}" title="${nome}" data-acao="cor" data-grupo="${grupo}" data-cor="${cor}"></button>`,
      )
      .join("") + arcoIris(atual, grupo, lista.some(([, cor]) => cor.toLowerCase() === atual.toLowerCase()));

  const raiz = html(`
    <div class="estado aberta tela">
      ${cabecalho(`Personagem · ${c.nomeRobo}`)}
      <div class="previa-personagem">
        <div class="palco-previa"></div>
        <div class="chips-expressoes">
          ${(Object.keys(NOMES_EXPRESSOES) as Expressao[])
            .map(
              (e) =>
                `<button type="button" class="chip pequeno-chip ${e === expressaoPrevia ? "ativo" : ""}" data-acao="expressao" data-expressao="${e}">${NOMES_EXPRESSOES[e]}</button>`,
            )
            .join("")}
        </div>
      </div>

      <section class="secao">
        <p class="titulo-secao">Quem mora na ilha</p>
        <div class="grade-personagens">
          ${(Object.keys(PERSONAGENS) as PersonagemId[])
            .filter((id) => !PERSONAGENS[id].monstro && !PERSONAGENS[id].vetor)
            .map(cartao)
            .join("")}
        </div>
        <p class="titulo-secao espaco-acima">Estilo moderno</p>
        <div class="grade-personagens">
          ${(Object.keys(PERSONAGENS) as PersonagemId[])
            .filter((id) => PERSONAGENS[id].vetor)
            .map(cartao)
            .join("")}
        </div>
        <p class="titulo-secao espaco-acima">Monstrinhos</p>
        <div class="grade-personagens">
          ${(Object.keys(PERSONAGENS) as PersonagemId[])
            .filter((id) => PERSONAGENS[id].monstro)
            .map(cartao)
            .join("")}
        </div>
      </section>

      <section class="secao">
        <p class="titulo-secao">Aparência</p>
        <div class="item"><div class="coluna"><span class="principal">Olhos</span></div><div class="linha amostras">${amostras(CORES_OLHOS, c.corOlhos, "olhos")}</div></div>
        <div class="item"><div class="coluna"><span class="principal">Bochechas</span></div><div class="linha amostras">${amostras(CORES_BOCHECHAS, c.corBochechas, "bochechas")}</div></div>
        <div class="item coluna-item">
          <span class="principal">Formato dos olhos</span>
          <div class="grade-olhos">
            ${(Object.keys(NOMES_ESTILOS_OLHOS) as EstiloOlhos[])
              .map(
                (e) => `
              <button type="button" class="cartao-olho ${e === (c.estiloOlhos ?? "redondos") ? "ativo" : ""}" data-acao="olhos" data-estilo="${e}">
                <span data-olho="${e}"></span><span>${NOMES_ESTILOS_OLHOS[e]}</span>
              </button>`,
              )
              .join("")}
          </div>
        </div>
        <div class="item coluna-item">
          <span class="principal">Acessório</span>
          <div class="linha chips acessorios">
            ${(Object.keys(NOMES_ACESSORIOS) as Acessorio[])
              .map(
                (a) =>
                  `<button type="button" class="chip pequeno-chip ${a === c.acessorio ? "ativo" : ""}" data-acao="acessorio" data-acessorio="${a}">${NOMES_ACESSORIOS[a]}</button>`,
              )
              .join("")}
          </div>
        </div>
        <div class="item">
          <div class="coluna"><span class="principal">Na ilha aberta</span><span class="secundario">O que aparece ao lado da saudação.</span></div>
          <div class="segmentos" role="radiogroup" aria-label="Na ilha aberta">
            <button type="button" class="segmento" role="radio" aria-checked="${c.cabecaAberta === "robo"}" data-acao="cabeca" data-valor="robo">Robô vermelho</button>
            <button type="button" class="segmento" role="radio" aria-checked="${c.cabecaAberta === "carinha"}" data-acao="cabeca" data-valor="carinha">Carinha</button>
          </div>
        </div>
      </section>

      <section class="secao">
        <p class="titulo-secao">Jeito de ser</p>
        ${interruptor("olhosSeguemMouse", "Olhos seguem o mouse", "Ele olha para o lado onde está o mouse.", c.olhosSeguemMouse)}
        ${interruptor("brincadeiras", "Brincadeiras quando parado", "De vez em quando passa uma mosquinha e ele acompanha com os olhos.", c.brincadeiras)}
        ${interruptor("cochilar", "Cochilar", "Com o mouse parado por 5 minutos, ele dorme; mexeu, acorda.", c.cochilar)}
        ${interruptor("passeios", "Sair para passear", "De vez em quando ele sai da ilha, anda pela tela, brinca e volta (o clique passa por ele, não atrapalha).", c.passeios)}
        <div class="item"><div class="coluna"><span class="principal">Passear agora</span><span class="secundario">Ou peça na conversa: “vai passear”.</span></div><button type="button" class="botao" data-acao="passear">Passear</button></div>
        ${interruptor("perceberAtividade", "Perceber o que estou fazendo", "Digitando, ele digita junto; com música, dança; em vídeo, assiste; em chamada, põe fones. Só conta as teclas (não lê quais são) e olha o nome do programa na frente. Nada é guardado.", c.perceberAtividade)}
      </section>
    </div>`);

  aoClicar(raiz, "voltar", () => ctx.irPara("inicio"));

  // Prévia ao vivo, grande, com o acessório.
  const palco = raiz.querySelector<HTMLElement>(".palco-previa")!;
  const desenharPrevia = () => {
    palco.replaceChildren(new Carinha(expressaoPrevia, { tamanho: 7, comAcessorio: true }).elemento);
  };
  desenharPrevia();

  // Cada cartão mostra o personagem feliz, com as cores escolhidas.
  raiz.querySelectorAll<HTMLElement>("[data-rosto]").forEach((lugar) => {
    const personagem = lugar.dataset.rosto as PersonagemId;
    lugar.replaceChildren(new Carinha("feliz", { tamanho: 3, comAcessorio: true, aparencia: { personagem, acessorio: "nenhum" } }).elemento);
  });

  const salvar = (fazer: (c: Config) => void) => {
    mudar((d) => fazer(d.config));
    ctx.renovar();
  };
  aoClicar(raiz, "expressao", (b) => {
    expressaoPrevia = b.dataset.expressao as Expressao;
    raiz.querySelectorAll('[data-acao="expressao"]').forEach((x) => x.classList.toggle("ativo", x === b));
    desenharPrevia();
  });
  raiz.querySelectorAll<HTMLElement>("[data-olho]").forEach((lugar) => {
    const estiloOlhos = lugar.dataset.olho as EstiloOlhos;
    lugar.replaceChildren(new Carinha("normal", { tamanho: 2, aparencia: { estiloOlhos } }).elemento);
  });
  aoClicar(raiz, "olhos", (b) => salvar((c) => (c.estiloOlhos = b.dataset.estilo as EstiloOlhos)));
  // Cor livre (botão arco-íris).
  raiz.querySelectorAll<HTMLInputElement>("input[data-cor-livre]").forEach((campo) =>
    campo.addEventListener("change", () =>
      salvar((c) => {
        if (campo.dataset.corLivre === "olhos") c.corOlhos = campo.value;
        else c.corBochechas = campo.value;
      }),
    ),
  );
  aoClicar(raiz, "cor", (b) =>
    salvar((c) => {
      if (b.dataset.grupo === "olhos") c.corOlhos = b.dataset.cor!;
      else c.corBochechas = b.dataset.cor!;
    }),
  );
  aoClicar(raiz, "passear", () => {
    ctx.fechar();
    passear().catch(() => {});
  });
  aoClicar(raiz, "personagem", (b) => salvar((c) => (c.personagem = b.dataset.personagem as PersonagemId)));
  aoClicar(raiz, "acessorio", (b) => salvar((c) => (c.acessorio = b.dataset.acessorio as Acessorio)));
  aoClicar(raiz, "cabeca", (b) => salvar((c) => (c.cabecaAberta = b.dataset.valor as Config["cabecaAberta"])));
  aoClicar(raiz, "alternar", (b) =>
    salvar((c) => {
      const chave = b.dataset.opcao as "olhosSeguemMouse" | "brincadeiras" | "cochilar" | "perceberAtividade" | "passeios";
      c[chave] = !c[chave];
      if (chave === "perceberAtividade") perceberAtividade(c[chave]).catch(() => {});
    }),
  );
  return raiz;
}
