// Memória: coisas que o Dan pediu para a ilha lembrar ("meu aniversário é…",
// "prefiro respostas curtas"). Vão junto para todas as IAs, se ligado.
import { ler, mudar, novoId } from "../../dados/armazem";
import { haQuanto } from "../../dados/datas";
import type { Contexto } from "../contexto";
import { ICONES } from "../icones";
import { aoClicar, cabecalho, confirmarAntes, escapar, html } from "../ui";

export function montarMemoria(ctx: Contexto): HTMLElement {
  const d = ler();
  const raiz = html(`
    <div class="estado aberta tela">
      ${cabecalho("Memória")}
      <p class="secundario">O que você pedir para eu guardar vai junto para todas as IAs, para elas te conhecerem. Também dá para dizer na conversa: “guarda que…”.</p>
      <div class="item">
        <div class="coluna"><span class="principal">Usar a memória nas conversas</span></div>
        <button type="button" class="chave" role="switch" aria-checked="${d.config.usarMemoria}" data-acao="usar" aria-label="Usar a memória nas conversas"><span></span></button>
      </div>
      <section class="secao">
        ${
          d.memorias
            .slice()
            .reverse()
            .map(
              (m) => `
          <div class="item">
            <div class="coluna"><span class="principal texto-memoria">${escapar(m.texto)}</span><span class="secundario">${haQuanto(new Date(m.criada))}</span></div>
            <button type="button" class="redondo" aria-label="Esquecer" title="Esquecer" data-acao="esquecer" data-id="${m.id}">${ICONES.lixeira}</button>
          </div>`,
            )
            .join("") || '<p class="vazio">Nada guardado ainda. Ex.: “Meu aniversário é 3 de maio”, “Trabalho com design gráfico”.</p>'
        }
        <form class="linha nova-memoria">
          <input class="entrada" name="texto" maxlength="500" required placeholder="Algo para eu lembrar" aria-label="Nova memória">
          <button type="submit" class="botao ciano">Guardar</button>
        </form>
      </section>
    </div>`);

  aoClicar(raiz, "voltar", () => ctx.irPara("conversa"));
  aoClicar(raiz, "usar", () => {
    mudar((dd) => (dd.config.usarMemoria = !dd.config.usarMemoria));
    ctx.renovar();
  });
  aoClicar(raiz, "esquecer", (b) =>
    confirmarAntes(b, "Esquecer?", () => {
      mudar((dd) => (dd.memorias = dd.memorias.filter((m) => m.id !== b.dataset.id)));
      ctx.renovar();
    }),
  );
  const form = raiz.querySelector<HTMLFormElement>(".nova-memoria")!;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const texto = String(new FormData(form).get("texto") ?? "").trim();
    if (!texto) return;
    mudar((dd) => dd.memorias.push({ id: novoId(), texto, criada: Date.now() }));
    ctx.renovar();
  });
  return raiz;
}
