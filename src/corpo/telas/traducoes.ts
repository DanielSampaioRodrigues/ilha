// Histórico das traduções da tela, com busca.
import {
  apagarTraducao,
  copiar,
  imagemTraducao,
  listarTraducoes,
  nomeDoPrograma,
  traduzirTela,
  type ItemTraducao,
} from "../../maos/sistema";
import { haQuanto } from "../../dados/datas";
import type { Contexto } from "../contexto";
import { ICONES } from "../icones";
import { aoClicar, cabecalho, confirmarAntes, escapar, html, recadoTemporario } from "../ui";

let busca = "";

export function montarTraducoes(ctx: Contexto): HTMLElement {
  const raiz = html(`
    <div class="estado aberta tela">
      ${cabecalho("Traduções")}
      <div class="linha">
        <input class="entrada" type="search" placeholder="Procurar no original ou na tradução" value="${escapar(busca)}" aria-label="Procurar">
        <button type="button" class="botao ciano" data-acao="nova">${ICONES.traduzir}Traduzir</button>
      </div>
      <span class="secundario aviso-traducoes">Win + Alt + T traduz um trecho da tela. As últimas 300 ficam guardadas aqui.</span>
      <div class="secao lista-traducoes"><p class="secundario">Carregando…</p></div>
    </div>`);

  aoClicar(raiz, "voltar", () => ctx.irPara("inicio"));
  aoClicar(raiz, "nova", () => {
    ctx.fechar();
    traduzirTela().catch(() => {});
  });

  const lista = raiz.querySelector<HTMLElement>(".lista-traducoes")!;
  const aviso = raiz.querySelector<HTMLElement>(".aviso-traducoes")!;
  const campo = raiz.querySelector<HTMLInputElement>('input[type="search"]')!;
  let todos: ItemTraducao[] = [];
  let mostrando = 20;

  const desenhar = () => {
    const termo = busca.trim().toLowerCase();
    const achados = todos.filter(
      (t) => !termo || t.original.toLowerCase().includes(termo) || t.traducao.toLowerCase().includes(termo),
    );
    if (!achados.length) {
      lista.innerHTML = `<p class="vazio">${todos.length ? "Nada encontrado." : "Nenhuma tradução ainda."}</p>`;
      return;
    }
    lista.innerHTML =
      achados
        .slice(0, mostrando)
        .map(
          (t) => `
        <div class="item item-traducao" data-id="${t.id}">
          <div class="miniatura" data-imagem="${t.id}"></div>
          <div class="coluna">
            <span class="texto-traduzido">${escapar(t.traducao).replace(/\n/g, "<br>")}</span>
            <span class="secundario texto-original">${escapar(t.original).replace(/\n/g, " · ")}</span>
            <span class="secundario">${haQuanto(new Date(Number(t.data) * 1000))}${t.programa ? ` · ${escapar(nomeDoPrograma(t.programa))}` : ""}</span>
          </div>
          <div class="coluna-botoes">
            <button type="button" class="redondo" aria-label="Copiar tradução" data-acao="copiar" data-id="${t.id}">${ICONES.copiar}</button>
            <button type="button" class="redondo" aria-label="Apagar" data-acao="apagar" data-id="${t.id}">${ICONES.lixeira}</button>
          </div>
        </div>`,
        )
        .join("") +
      (achados.length > mostrando ? `<button type="button" class="link" data-acao="mais">Mostrar mais (${achados.length - mostrando})</button>` : "");

    // As imagens chegam uma a uma, só das que estão na tela.
    lista.querySelectorAll<HTMLElement>("[data-imagem]").forEach((caixa) =>
      imagemTraducao(caixa.dataset.imagem!)
        .then((src) => {
          if (src) caixa.innerHTML = `<img src="${src}" alt="">`;
          else caixa.classList.add("sem-imagem");
        })
        .catch(() => {}),
    );
    aoClicar(lista, "copiar", (b) => {
      const t = todos.find((x) => x.id === b.dataset.id);
      if (t) copiar(t.traducao).then(() => recadoTemporario(aviso, "Tradução copiada."));
    });
    aoClicar(lista, "apagar", (b) =>
      confirmarAntes(b, "Apagar?", () => {
        apagarTraducao(b.dataset.id!)
          .then(() => {
            todos = todos.filter((x) => x.id !== b.dataset.id);
            desenhar();
          })
          .catch(() => {});
      }),
    );
    aoClicar(lista, "mais", () => {
      mostrando += 20;
      desenhar();
    });
  };

  campo.addEventListener("input", () => {
    busca = campo.value;
    mostrando = 20;
    desenhar();
  });
  listarTraducoes()
    .then((l) => {
      todos = l;
      desenhar();
    })
    .catch(() => (lista.innerHTML = '<p class="vazio">Não consegui abrir o histórico.</p>'));
  return raiz;
}
