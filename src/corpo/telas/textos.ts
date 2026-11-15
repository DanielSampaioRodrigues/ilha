// Textos rápidos (PIX, endereço, assinatura de e-mail…) e gerador de senha.
import { ler, mudar, novoId } from "../../dados/armazem";
import { copiar } from "../../maos/sistema";
import type { Contexto } from "../contexto";
import { ICONES } from "../icones";
import { aoClicar, cabecalho, confirmarAntes, escapar, html, recadoTemporario } from "../ui";

/** Senha aleatória forte (sem letras parecidas como l/1 e O/0). */
export function gerarSenha(tamanho = 20): string {
  const letras = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*?-_";
  const sorteio = new Uint32Array(tamanho);
  crypto.getRandomValues(sorteio);
  return Array.from(sorteio, (n) => letras[n % letras.length]).join("");
}

export function montarTextos(ctx: Contexto): HTMLElement {
  const textos = ler().textos;
  const raiz = html(`
    <div class="estado aberta tela">
      ${cabecalho("Textos rápidos")}
      <p class="secundario aviso-copia">Clique para copiar. Depois é só colar (Ctrl+V) onde quiser.</p>
      <section class="secao">
        ${textos
          .map(
            (t) => `
          <div class="item">
            <button type="button" class="coluna texto-tarefa" data-acao="copiar" data-id="${t.id}">
              <span class="principal">${escapar(t.nome)}</span>
              <span class="secundario caminho">${escapar(t.texto)}</span>
            </button>
            <button type="button" class="redondo" aria-label="Copiar ${escapar(t.nome)}" data-acao="copiar" data-id="${t.id}">${ICONES.copiar}</button>
            <button type="button" class="redondo" aria-label="Apagar ${escapar(t.nome)}" data-acao="apagar" data-id="${t.id}">${ICONES.lixeira}</button>
          </div>`,
          )
          .join("") || '<p class="vazio">Guarde aqui o que você cola sempre: chave PIX, endereço, dados bancários, assinatura de e-mail.</p>'}
        <form class="formulario novo-texto">
          <label class="campo">Nome<input name="nome" required maxlength="40" placeholder="Ex.: Meu PIX"></label>
          <label class="campo largo2">Texto<input name="texto" required maxlength="2000" placeholder="O que vai ser copiado"></label>
          <div class="linha fim largo"><span class="espaco"></span><button type="submit" class="botao ciano">Guardar</button></div>
        </form>
      </section>
      <section class="secao">
        <p class="titulo-secao">Gerar senha</p>
        <div class="item">
          <code class="senha">${gerarSenha()}</code>
          <span class="espaco"></span>
          <button type="button" class="botao" data-acao="outra">Outra</button>
          <button type="button" class="botao ciano" data-acao="copiar-senha">Copiar</button>
        </div>
      </section>
    </div>`);

  const aviso = raiz.querySelector<HTMLElement>(".aviso-copia")!;
  const copiarTexto = (texto: string, nome: string) =>
    copiar(texto)
      .then(() => recadoTemporario(aviso, `“${nome}” copiado.`))
      .catch(() => recadoTemporario(aviso, "Não consegui copiar."));

  aoClicar(raiz, "voltar", () => ctx.irPara("inicio"));
  aoClicar(raiz, "copiar", (b) => {
    const t = textos.find((x) => x.id === b.dataset.id);
    if (t) copiarTexto(t.texto, t.nome);
  });
  aoClicar(raiz, "apagar", (b) =>
    confirmarAntes(b, "Apagar?", () => {
      mudar((d) => (d.textos = d.textos.filter((t) => t.id !== b.dataset.id)));
      ctx.renovar();
    }),
  );
  const senha = raiz.querySelector<HTMLElement>(".senha")!;
  aoClicar(raiz, "outra", () => (senha.textContent = gerarSenha()));
  aoClicar(raiz, "copiar-senha", () => copiarTexto(senha.textContent ?? "", "Senha"));
  const form = raiz.querySelector<HTMLFormElement>(".novo-texto")!;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(form);
    mudar((d) => d.textos.push({ id: novoId(), nome: String(f.get("nome")).trim(), texto: String(f.get("texto")) }));
    ctx.renovar();
  });
  return raiz;
}
