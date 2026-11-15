// Meu PC: como está o computador e correções simples (sempre com confirmação).
import { diagnosticoPc, limparTemporarios, type Diagnostico } from "../../maos/sistema";
import type { Contexto } from "../contexto";
import { aoClicar, cabecalho, confirmarAntes, html } from "../ui";

const n1 = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

function cartao(titulo: string, valor: string, pct: number | null, alerta: boolean): string {
  return `
    <div class="cartao ${alerta ? "alerta" : ""}">
      <span class="secundario">${titulo}</span>
      <span class="valor">${valor}</span>
      ${pct === null ? "" : `<div class="barra"><div class="barra-cheia" style="width:${Math.min(100, pct)}%"></div></div>`}
    </div>`;
}

function dicas(d: Diagnostico): string[] {
  const lista: string[] = [];
  const memoria = (d.memoria_usada_gb / d.memoria_total_gb) * 100;
  const disco = d.disco_total_gb ? (d.disco_livre_gb / d.disco_total_gb) * 100 : 100;
  if (memoria > 85) lista.push("Memória quase cheia: feche programas que não está usando (veja os mais pesados abaixo).");
  if (d.processador > 85) lista.push("Processador muito ocupado agora. Se estiver lento, veja qual programa está pesando.");
  if (disco < 10) lista.push("Pouco espaço no disco: vale limpar os temporários e a pasta Downloads.");
  if (d.ligado_horas > 72) lista.push(`O PC está ligado há ${Math.round(d.ligado_horas / 24)} dias. Reiniciar costuma deixar tudo mais leve.`);
  if (d.temporarios_mb > 500) lista.push("Há bastante arquivo temporário antigo para limpar.");
  if (!lista.length) lista.push("Tudo certo! Nada pedindo atenção agora.");
  return lista;
}

export function montarPc(ctx: Contexto): HTMLElement {
  const raiz = html(`
    <div class="estado aberta tela">
      ${cabecalho("Meu PC")}
      <div class="conteudo-pc"><p class="secundario">Examinando o computador…</p></div>
    </div>`);
  aoClicar(raiz, "voltar", () => ctx.irPara("inicio"));
  const lugar = raiz.querySelector<HTMLElement>(".conteudo-pc")!;

  const mostrar = (d: Diagnostico | null) => {
    if (!d) {
      lugar.innerHTML = '<p class="vazio">Não consegui examinar o computador agora.</p>';
      return;
    }
    const memoriaPct = (d.memoria_usada_gb / d.memoria_total_gb) * 100;
    const discoUsado = d.disco_total_gb ? 100 - (d.disco_livre_gb / d.disco_total_gb) * 100 : 0;
    const maior = Math.max(1, ...d.pesados.map((p) => p.memoria_mb));
    lugar.innerHTML = `
      <div class="cartoes">
        ${cartao("Processador", `${Math.round(d.processador)}%`, d.processador, d.processador > 85)}
        ${cartao("Memória", `${n1(d.memoria_usada_gb)} de ${n1(d.memoria_total_gb)} GB`, memoriaPct, memoriaPct > 85)}
        ${cartao("Disco (C:)", `${n1(d.disco_livre_gb)} GB livres`, discoUsado, discoUsado > 90)}
        ${cartao("Ligado há", d.ligado_horas >= 48 ? `${Math.round(d.ligado_horas / 24)} dias` : `${Math.round(d.ligado_horas)} h`, null, d.ligado_horas > 72)}
      </div>
      <section class="secao">
        <p class="titulo-secao">O que eu sugiro</p>
        ${dicas(d).map((t) => `<p class="dica">${t}</p>`).join("")}
      </section>
      <section class="secao">
        <p class="titulo-secao">Programas que mais usam memória</p>
        ${d.pesados
          .map(
            (p) => `
          <div class="linha pesado">
            <span class="nome-pesado">${p.nome}</span>
            <div class="barra"><div class="barra-cheia" style="width:${(p.memoria_mb / maior) * 100}%"></div></div>
            <span class="secundario">${p.memoria_mb >= 1024 ? `${n1(p.memoria_mb / 1024)} GB` : `${p.memoria_mb} MB`}</span>
          </div>`,
          )
          .join("")}
      </section>
      <div class="item">
        <div class="coluna">
          <span class="principal">Arquivos temporários antigos: ${d.temporarios_mb >= 1024 ? `${n1(d.temporarios_mb / 1024)} GB` : `${d.temporarios_mb} MB`}</span>
          <span class="secundario resultado-limpeza">Sobras de instalações e programas, com mais de 2 dias. É o mesmo que a Limpeza de Disco do Windows faz.</span>
        </div>
        <button type="button" class="botao" data-acao="limpar" ${d.temporarios_mb ? "" : "disabled"}>Limpar</button>
      </div>
      <div class="linha fim"><span class="espaco"></span><button type="button" class="botao" data-acao="examinar">Examinar de novo</button></div>`;
    aoClicar(lugar, "examinar", examinar);
    aoClicar(lugar, "limpar", (b) =>
      confirmarAntes(b, "Apagar de vez?", () => {
        (b as HTMLButtonElement).disabled = true;
        b.textContent = "Limpando…";
        limparTemporarios().then((mb) => {
          lugar.querySelector<HTMLElement>(".resultado-limpeza")!.textContent =
            `Pronto: ${mb >= 1024 ? `${n1(mb / 1024)} GB` : `${mb} MB`} liberados. Arquivos em uso foram pulados.`;
          b.textContent = "Limpo";
        });
      }),
    );
  };
  const examinar = () => {
    lugar.innerHTML = '<p class="secundario">Examinando o computador…</p>';
    diagnosticoPc().then(mostrar).catch(() => mostrar(null));
  };
  examinar();
  return raiz;
}
