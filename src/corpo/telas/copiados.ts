// Copiados: tudo que você copiou (Ctrl+C), para achar e copiar de novo.
// Senhas de gerenciadores de senha não entram (eles avisam o Windows).
import { listen } from "@tauri-apps/api/event";
import { ler, mudar } from "../../dados/armazem";
import { haQuanto } from "../../dados/datas";
import { copiadosApagar, copiadosFixar, copiadosLigar, copiadosLimpar, copiadosListar, copiar, nomeDoPrograma, type Copiado } from "../../maos/sistema";
import { dentroDoApp } from "../../ponte";
import type { Contexto } from "../contexto";
import { ICONES } from "../icones";
import { aoClicar, cabecalho, confirmarAntes, escapar, html, recadoTemporario } from "../ui";

let busca = "";

export function montarCopiados(ctx: Contexto): HTMLElement {
  const ligado = ler().config.copiadosLigado;
  const raiz = html(`
    <div class="estado aberta tela">
      ${cabecalho("Copiados")}
      <div class="item">
        <div class="coluna"><span class="principal">Guardar o que eu copio</span><span class="secundario aviso-copiados">Só texto, até 200 (os fixados ficam sempre). Senhas de gerenciadores de senha não entram.</span></div>
        <button type="button" class="chave" role="switch" aria-checked="${ligado}" aria-label="Guardar o que eu copio" data-acao="ligar"><span></span></button>
      </div>
      <div class="linha">
        <input class="entrada busca-copiados" type="search" placeholder="Procurar no que você copiou" aria-label="Procurar" value="${escapar(busca)}">
        <button type="button" class="botao" data-acao="limpar">Limpar</button>
      </div>
      <section class="secao lista-copiados"><p class="secundario">Carregando…</p></section>
    </div>`);
  const lista = raiz.querySelector<HTMLElement>(".lista-copiados")!;
  const aviso = raiz.querySelector<HTMLElement>(".aviso-copiados")!;
  const campo = raiz.querySelector<HTMLInputElement>(".busca-copiados")!;
  let itens: Copiado[] = [];

  const desenhar = () => {
    const termo = busca.trim().toLowerCase();
    const vistos = itens.filter((c) => !termo || c.texto.toLowerCase().includes(termo));
    // Fixados primeiro, depois os mais novos.
    vistos.sort((a, b) => Number(b.fixo) - Number(a.fixo) || b.quando - a.quando);
    lista.innerHTML =
      vistos
        .map(
          (c) => `
        <div class="item copiado ${c.fixo ? "fixo" : ""}">
          <button type="button" class="coluna texto-copiado" data-acao="copiar" data-id="${c.id}" title="Copiar de novo">
            <span class="principal">${escapar(c.texto)}</span>
            <span class="secundario">${haQuanto(new Date(c.quando))}${c.programa ? ` · ${escapar(nomeDoPrograma(c.programa))}` : ""}</span>
          </button>
          <button type="button" class="redondo ${c.fixo ? "ativo-fixo" : ""}" aria-label="${c.fixo ? "Soltar" : "Fixar"}" title="${c.fixo ? "Soltar" : "Fixar (nunca some)"}" data-acao="fixar" data-id="${c.id}">${ICONES.alfinete}</button>
          <button type="button" class="redondo" aria-label="Apagar" data-acao="apagar" data-id="${c.id}">${ICONES.lixeira}</button>
        </div>`,
        )
        .join("") || `<p class="vazio">${termo ? "Nada encontrado." : "Copie qualquer texto (Ctrl+C) e ele aparece aqui."}</p>`;
    aoClicar(lista, "copiar", (b) => {
      const c = itens.find((x) => x.id === b.dataset.id);
      if (!c) return;
      copiar(c.texto)
        .then(() => recadoTemporario(aviso, "Copiado! É só colar com Ctrl+V."))
        .catch(() => {});
    });
    aoClicar(lista, "fixar", (b) => {
      copiadosFixar(b.dataset.id!).then(carregar).catch(() => {});
    });
    aoClicar(lista, "apagar", (b) =>
      confirmarAntes(b, "Apagar?", () => {
        copiadosApagar(b.dataset.id!).then(carregar).catch(() => {});
      }),
    );
  };
  const carregar = () =>
    copiadosListar()
      .then((l) => {
        itens = l;
        desenhar();
      })
      .catch(() => {});
  carregar();
  if (dentroDoApp) {
    listen("ilha:copiados", () => raiz.isConnected && carregar()).then((parar) => {
      // Para de ouvir quando a tela sai.
      const vigia = window.setInterval(() => {
        if (!raiz.isConnected) {
          parar();
          window.clearInterval(vigia);
        }
      }, 2000);
    });
  }

  campo.addEventListener("input", () => {
    busca = campo.value;
    desenhar();
  });
  aoClicar(raiz, "voltar", () => ctx.irPara("inicio"));
  aoClicar(raiz, "ligar", (b) => {
    const novo = !ler().config.copiadosLigado;
    mudar((d) => (d.config.copiadosLigado = novo));
    b.setAttribute("aria-checked", String(novo));
    copiadosLigar(novo).catch(() => {});
  });
  aoClicar(raiz, "limpar", (b) =>
    confirmarAntes(b, "Apagar os não fixados?", () => {
      copiadosLimpar().then(carregar).catch(() => {});
    }),
  );
  return raiz;
}
