// Calendário da Apple: conectar o iCloud (e-mail + senha de app), escolher o
// calendário e o que mandar para lá. A senha fica no cofre do Windows.
import { ler, mudar } from "../../dados/armazem";
import { eventosDesejados, situacaoCalendario, sincronizarCalendario } from "../../dados/calendario";
import { haQuanto } from "../../dados/datas";
import { abrirPrograma, icloudCalendarios, icloudConectado, icloudConectar, icloudDesconectar, type Calendario } from "../../maos/sistema";
import type { Contexto } from "../contexto";
import { aoClicar, cabecalho, confirmarAntes, escapar, html } from "../ui";

let calendariosAchados: Calendario[] = [];
let conectado: boolean | null = null;

export function montarCalendario(ctx: Contexto): HTMLElement {
  const c = ler().config;
  const situacao = situacaoCalendario();
  const quantos = eventosDesejados(ler()).length;
  const escolhido = c.icloudCalendario && conectado;
  const marca = (chave: keyof typeof c.calendarioItens, titulo: string, texto: string) => `
    <div class="item">
      <div class="coluna"><span class="principal">${titulo}</span><span class="secundario">${texto}</span></div>
      <button type="button" class="chave" role="switch" aria-checked="${c.calendarioItens[chave]}" aria-label="${titulo}" data-acao="item" data-item="${chave}"><span></span></button>
    </div>`;

  const raiz = html(`
    <div class="estado aberta tela">
      ${cabecalho("Calendário da Apple")}
      <p class="secundario">A ilha coloca no seu calendário do iCloud os vencimentos das assinaturas, as renovações das IAs e as tarefas com data, com alerta. Aparece no iPhone, no Mac e no Apple Watch.</p>
      ${
        conectado === null
          ? '<p class="secundario">Conferindo…</p>'
          : !conectado
            ? `
      <section class="secao">
        <p class="titulo-secao">Como conectar (uma vez só)</p>
        <ol class="passos">
          <li>Clique em <button type="button" class="link" data-acao="abrir-apple">abrir appleid.apple.com</button> e entre com o seu Apple ID.</li>
          <li>Vá em <b>Login e Segurança</b> › <b>Senhas de app</b>.</li>
          <li>Clique no <b>+</b>, dê o nome <b>Ilha</b> e clique em <b>Criar</b>. Pode pedir a sua senha ou o código no iPhone — é normal.</li>
          <li>Aparece uma senha no formato <code>abcd-efgh-ijkl-mnop</code>. Copie e cole abaixo. (Ela só serve para o calendário e dá para apagar quando quiser.)</li>
        </ol>
        <form class="formulario form-icloud">
          <label class="campo largo">E-mail do Apple ID<input name="email" type="email" required autocomplete="off" value="${escapar(c.icloudEmail)}" placeholder="voce@icloud.com"></label>
          <label class="campo largo">Senha de app<input name="senha" type="password" required autocomplete="off" placeholder="abcd-efgh-ijkl-mnop"></label>
          <div class="linha fim largo"><span class="secundario resposta-icloud"></span><span class="espaco"></span><button type="submit" class="botao ciano">Conectar</button></div>
        </form>
      </section>`
            : `
      <section class="secao">
        <p class="titulo-secao">Conta</p>
        <div class="item">
          <div class="coluna"><span class="principal">${escapar(c.icloudEmail)}</span><span class="secundario">Conectado. A senha de app está no cofre do Windows. Desconectar não apaga o que já foi para o calendário.</span></div>
          <button type="button" class="botao" data-acao="desconectar">Desconectar</button>
        </div>
        <div class="item">
          <div class="coluna"><span class="principal">Calendário</span><span class="secundario">${escolhido ? `Mandando para “${escapar(c.icloudNomeCalendario)}”.` : "Escolha onde a ilha vai colocar os eventos."}</span></div>
          <select class="entrada curta2 escolha-calendario" aria-label="Calendário">
            <option value="">Escolher…</option>
            ${calendariosAchados.map((k) => `<option value="${escapar(k.url)}" ${k.url === c.icloudCalendario ? "selected" : ""}>${escapar(k.nome)}</option>`).join("")}
            ${c.icloudCalendario && !calendariosAchados.some((k) => k.url === c.icloudCalendario) ? `<option value="${escapar(c.icloudCalendario)}" selected>${escapar(c.icloudNomeCalendario)}</option>` : ""}
          </select>
        </div>
      </section>
      <section class="secao">
        <p class="titulo-secao">O que mandar</p>
        ${marca("assinaturas", "Vencimentos das assinaturas", "Todo mês (ou ano), com alerta às 9h nos dias de antecedência que você escolheu.")}
        ${marca("redefinicoes", "Renovações das IAs", "Na hora em que o limite volta.")}
        ${marca("tarefas", "Tarefas com data", "Somem do calendário quando você conclui a tarefa.")}
        <div class="item">
          <div class="coluna"><span class="principal">${quantos} evento(s) da ilha</span><span class="secundario situacao-calendario">${
            situacao.enviando
              ? "Mandando…"
              : situacao.ultimoErro
                ? escapar(situacao.ultimoErro)
                : situacao.ultimaVez
                  ? `Tudo em dia (${haQuanto(new Date(situacao.ultimaVez))}).`
                  : "Manda sozinho quando algo muda."
          }</span></div>
          <button type="button" class="botao" data-acao="agora" ${escolhido ? "" : "disabled"}>Mandar agora</button>
        </div>
      </section>`
      }
    </div>`);

  aoClicar(raiz, "voltar", () => ctx.irPara("ajustes"));
  aoClicar(raiz, "abrir-apple", () => abrirPrograma("https://appleid.apple.com/account/manage").catch(() => {}));

  if (conectado === null) {
    icloudConectado()
      .then((sim) => {
        conectado = sim;
        if (sim && ler().config.icloudEmail) {
          return icloudCalendarios(ler().config.icloudEmail).then((l) => (calendariosAchados = l));
        }
      })
      .catch(() => {})
      .finally(() => ctx.renovar());
  }

  const form = raiz.querySelector<HTMLFormElement>(".form-icloud");
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const email = String(f.get("email") ?? "").trim();
    const senha = String(f.get("senha") ?? "").trim();
    const resposta = raiz.querySelector<HTMLElement>(".resposta-icloud")!;
    resposta.textContent = "Conectando…";
    icloudConectar(email, senha)
      .then((lista) => {
        calendariosAchados = lista;
        conectado = true;
        mudar((d) => {
          d.config.icloudEmail = email;
          // Começa do zero: manda tudo de novo para a conta nova.
          d.config.calendarioEnviados = {};
          if (lista.length === 1) {
            d.config.icloudCalendario = lista[0].url;
            d.config.icloudNomeCalendario = lista[0].nome;
          }
        });
        ctx.renovar();
      })
      .catch((erro) => (resposta.textContent = String(erro)));
  });

  raiz.querySelector<HTMLSelectElement>(".escolha-calendario")?.addEventListener("change", (e) => {
    const url = (e.target as HTMLSelectElement).value;
    const k = calendariosAchados.find((x) => x.url === url);
    mudar((d) => {
      d.config.icloudCalendario = url;
      d.config.icloudNomeCalendario = k?.nome ?? "";
      // Calendário novo: manda tudo de novo para lá.
      d.config.calendarioEnviados = {};
    });
    ctx.renovar();
  });

  aoClicar(raiz, "item", (b) => {
    const chave = b.dataset.item as keyof typeof c.calendarioItens;
    mudar((d) => (d.config.calendarioItens = { ...d.config.calendarioItens, [chave]: !d.config.calendarioItens[chave] }));
    ctx.renovar();
  });

  aoClicar(raiz, "agora", (b) => {
    b.textContent = "Mandando…";
    sincronizarCalendario().finally(() => ctx.renovar());
  });

  aoClicar(raiz, "desconectar", (b) =>
    confirmarAntes(b, "Desconectar?", () => {
      icloudDesconectar()
        .catch(() => {})
        .finally(() => {
          conectado = false;
          calendariosAchados = [];
          mudar((d) => {
            d.config.icloudCalendario = "";
            d.config.icloudNomeCalendario = "";
            d.config.calendarioEnviados = {};
          });
          ctx.renovar();
        });
    }),
  );
  return raiz;
}
