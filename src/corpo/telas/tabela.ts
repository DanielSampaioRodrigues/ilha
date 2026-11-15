// Todas as assinaturas numa tabela, com o total por mês.
import { ler } from "../../dados/armazem";
import { MESES, diaEscrito, prazo, situacao, valorEmNumero } from "../../dados/datas";
import type { Contexto } from "../contexto";
import { aoClicar, cabecalho, escapar, html } from "../ui";

const real = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function montarTabela(ctx: Contexto): HTMLElement {
  const agora = new Date();
  const linhas = ler()
    .assinaturas.map((a) => ({ a, s: situacao(a, agora) }))
    .sort((x, y) => x.s.dias - y.s.dias);

  let porMes = 0;
  let semValor = 0;
  for (const { a } of linhas) {
    const v = valorEmNumero(a.valor);
    if (v === null) semValor++;
    else porMes += a.frequencia === "anual" ? v / 12 : v;
  }

  const corpo = linhas
    .map(
      ({ a, s }) => `
      <tr class="${s.pendente ? "pendente" : ""}">
        <td>${escapar(a.nome)}</td>
        <td class="numero">${escapar(a.valor || "—")}</td>
        <td>${diaEscrito(s.vence)}</td>
        <td>${a.frequencia === "anual" ? `anual (${MESES[a.mes - 1]})` : `mensal (dia ${a.dia})`}</td>
        <td>${s.pendente ? `<span class="selo">${prazo(s.dias)}</span>` : prazo(s.dias)}</td>
      </tr>`,
    )
    .join("");

  const raiz = html(`
    <div class="estado aberta tela">
      ${cabecalho("Tabela de assinaturas")}
      ${
        linhas.length
          ? `<div class="caixa-tabela"><table class="tabela">
              <thead><tr><th>Nome</th><th class="numero">Valor</th><th>Próximo vencimento</th><th>Repete</th><th>Situação</th></tr></thead>
              <tbody>${corpo}</tbody>
            </table></div>
            <div class="linha"><span class="principal">Total por mês: ${real(porMes)}</span><span class="espaco"></span>
            <span class="secundario">${semValor ? `${semValor} sem valor não entra${semValor > 1 ? "m" : ""} na conta · ` : ""}anuais contam 1/12 por mês</span></div>`
          : '<p class="vazio">Nenhuma assinatura cadastrada.</p>'
      }
    </div>`);
  aoClicar(raiz, "voltar", () => ctx.irPara("avisos"));
  return raiz;
}
