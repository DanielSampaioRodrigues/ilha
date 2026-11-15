// Ajustes: nome, atalho, iniciar com o Windows, aviso do Claude Code, atualização.
import { ler, mudar } from "../../dados/armazem";
import {
  abrirRegistros,
  atalhoLegivel,
  avisoClaudeLigado,
  definirAtalho,
  definirInicioComWindows,
  iniciaComWindows,
  ligarAvisoClaude,
} from "../../maos/sistema";
import type { Contexto } from "../contexto";
import { aoClicar, cabecalho, confirmarAntes, escapar, html, recadoTemporario } from "../ui";

const TECLAS = [
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
  ..."0123456789".split(""),
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
  "Space",
];

export function montarAjustes(ctx: Contexto): HTMLElement {
  const dados = ler();
  const partes = (ctx.atalho ?? "Super+Alt+I").split("+");
  const tecla = partes[partes.length - 1];
  const tem = (m: string) => (partes.includes(m) ? "checked" : "");
  const opcoesTecla = TECLAS.map(
    (t) => `<option value="${t}" ${t === tecla ? "selected" : ""}>${t === "Space" ? "Espaço" : t}</option>`,
  ).join("");

  const raiz = html(`
    <div class="estado aberta tela">
      ${cabecalho("Ajustes")}

      <section class="secao">
        <p class="titulo-secao">Como a ilha te chama</p>
        <div class="linha"><input class="entrada" name="nome" maxlength="30" value="${escapar(dados.config.nome)}"><span class="secundario salvo-nome"></span></div>
      </section>

      <section class="secao">
        <p class="titulo-secao">Atalho para abrir e fechar</p>
        <p class="secundario">Agora: <strong class="atalho-atual">${atalhoLegivel(ctx.atalho)}</strong></p>
        <div class="linha atalho">
          <label class="marca"><input type="checkbox" name="Ctrl" ${tem("Ctrl")}>Ctrl</label>
          <label class="marca"><input type="checkbox" name="Alt" ${tem("Alt")}>Alt</label>
          <label class="marca"><input type="checkbox" name="Shift" ${tem("Shift")}>Shift</label>
          <label class="marca"><input type="checkbox" name="Super" ${tem("Super")}>Win</label>
          <span>+</span>
          <select name="tecla" class="entrada curta">${opcoesTecla}</select>
          <button type="button" class="botao ciano" data-acao="atalho">Usar</button>
        </div>
        <span class="secundario resposta-atalho">Dica: combinações com a tecla Win quase nunca são usadas por outros programas.</span>
      </section>

      <section class="secao">
        <p class="titulo-secao">Computador</p>
        <div class="item">
          <div class="coluna"><span class="principal">Abrir a ilha quando o Windows ligar</span><span class="secundario">Você pode desligar quando quiser.</span></div>
          <button type="button" class="botao" data-acao="inicio-windows" disabled>…</button>
        </div>
        <div class="item">
          <div class="coluna"><span class="principal">Aviso quando o Claude Code terminar</span><span class="secundario estado-claude">Conferindo…</span></div>
          <button type="button" class="botao" data-acao="claude" hidden>Ligar</button>
        </div>
      </section>

      <section class="secao">
        <p class="titulo-secao">Sobre</p>
        <div class="item">
          <div class="coluna"><span class="principal">Ilha versão ${escapar(ctx.versao)}</span><span class="secundario">Ela procura versões novas sozinha a cada 6 horas.</span></div>
          <button type="button" class="botao" data-acao="procurar">Procurar agora</button>
        </div>
        <div class="item">
          <div class="coluna"><span class="principal">Registro de erros</span><span class="secundario">Se algo der errado, mande esse arquivo para o Claude.</span></div>
          <button type="button" class="botao" data-acao="registros">Abrir pasta</button>
        </div>
      </section>
    </div>`);

  aoClicar(raiz, "voltar", () => ctx.irPara("inicio"));

  // Nome
  const nome = raiz.querySelector<HTMLInputElement>('[name="nome"]')!;
  const salvoNome = raiz.querySelector<HTMLElement>(".salvo-nome")!;
  nome.addEventListener("input", () => {
    mudar((d) => (d.config.nome = nome.value.trim() || "Dan"));
    salvoNome.textContent = "Salvo";
  });

  // Atalho
  const resposta = raiz.querySelector<HTMLElement>(".resposta-atalho")!;
  aoClicar(raiz, "atalho", () => {
    const mods = ["Ctrl", "Alt", "Shift", "Super"].filter(
      (m) => raiz.querySelector<HTMLInputElement>(`input[name="${m}"]`)!.checked,
    );
    if (!mods.length) {
      recadoTemporario(resposta, "Escolha pelo menos uma tecla entre Ctrl, Alt, Shift e Win.");
      return;
    }
    const escolhido = [...mods, raiz.querySelector<HTMLSelectElement>('[name="tecla"]')!.value].join("+");
    definirAtalho(escolhido)
      .then((registrado) => {
        ctx.definirAtalhoAtual(registrado);
        mudar((d) => (d.config.atalho = registrado));
        raiz.querySelector<HTMLElement>(".atalho-atual")!.textContent = atalhoLegivel(registrado);
        recadoTemporario(resposta, "Pronto! Esse é o atalho agora.");
      })
      .catch((erro) => recadoTemporario(resposta, String(erro), 5000));
  });

  // Iniciar com o Windows
  const botaoInicio = raiz.querySelector<HTMLButtonElement>('[data-acao="inicio-windows"]')!;
  const mostrarInicio = (ligado: boolean) => {
    botaoInicio.disabled = false;
    botaoInicio.textContent = ligado ? "Ligado" : "Desligado";
    botaoInicio.classList.toggle("ciano", ligado);
    botaoInicio.dataset.ligado = ligado ? "1" : "";
  };
  iniciaComWindows().then(mostrarInicio).catch(() => mostrarInicio(false));
  botaoInicio.addEventListener("click", (e) => {
    e.stopPropagation();
    const ligar = !botaoInicio.dataset.ligado;
    botaoInicio.disabled = true;
    definirInicioComWindows(ligar)
      .then(() => mostrarInicio(ligar))
      .catch(() => mostrarInicio(!ligar));
  });

  // Claude Code
  const estadoClaude = raiz.querySelector<HTMLElement>(".estado-claude")!;
  const botaoClaude = raiz.querySelector<HTMLElement>('[data-acao="claude"]')!;
  const mostrarClaude = (ligado: boolean) => {
    estadoClaude.textContent = ligado
      ? "Ligado: a ilha avisa quando ele termina ou espera você."
      : "Desligado. Ligar muda a configuração do Claude Code (com cópia de segurança).";
    botaoClaude.hidden = ligado;
  };
  avisoClaudeLigado().then(mostrarClaude).catch(() => mostrarClaude(false));
  aoClicar(raiz, "claude", (b) =>
    confirmarAntes(b, "Confirmar?", () => {
      ligarAvisoClaude()
        .then(() => mostrarClaude(true))
        .catch((erro) => (estadoClaude.textContent = String(erro)));
    }),
  );

  aoClicar(raiz, "procurar", () => ctx.procurarAtualizacao());
  aoClicar(raiz, "registros", () => {
    abrirRegistros().catch(() => {});
  });
  return raiz;
}
