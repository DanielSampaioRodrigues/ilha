// Primeira abertura guiada (pensando no cliente que acabou de instalar):
// nome, como abrir a ilha, voz e qual IA usar. Aparece uma vez só, na Central,
// por cima de tudo. Cada passo pode ser pulado; nada é obrigatório.
import { ler, mudar } from "../dados/armazem";
import { Carinha } from "../corpo/carinha";
import { aoClicar, escapar, html } from "../corpo/ui";
import {
  atalhoAtual,
  atalhoLegivel,
  atenderPeloNome,
  estadoKokoro,
  estadoOuvido,
  prepararKokoro,
  salvarChave,
  testarDeepseek,
} from "../maos/sistema";

const PASSOS = 5;

export function mostrarBoasVindas(palco: HTMLElement, aoTerminar: () => void): void {
  let passo = 0;
  const fundo = html(`<div class="boas-vindas" role="dialog" aria-modal="true" aria-label="Boas-vindas"><div class="cartao-boas-vindas"></div></div>`);
  const cartao = fundo.querySelector<HTMLElement>(".cartao-boas-vindas")!;
  palco.append(fundo);
  let relogio = 0;

  const rodape = (proximo = "Continuar") => `
    <div class="linha rodape-boas-vindas">
      <span class="pontos">${Array.from({ length: PASSOS }, (_, i) => `<span class="${i === passo ? "ativo" : ""}"></span>`).join("")}</span>
      <span class="espaco"></span>
      ${passo > 0 ? '<button type="button" class="botao" data-acao="voltar-passo">Voltar</button>' : ""}
      <button type="button" class="botao ciano" data-acao="proximo">${proximo}</button>
    </div>`;

  const desenhar = () => {
    window.clearInterval(relogio);
    const c = ler().config;
    if (passo === 0) {
      cartao.innerHTML = `
        <div class="topo-boas-vindas"><span class="carinha-boas-vindas"></span></div>
        <h2>Oi! Eu moro aqui em cima da sua tela.</h2>
        <p class="secundario">Organizo suas coisas, converso com as IAs, falo e escuto. Primeiro, as apresentações:</p>
        <label class="campo">Como posso te chamar?<input class="entrada" name="nome" maxlength="30" value="${escapar(c.nome === "Dan" ? "" : c.nome)}" placeholder="Seu nome"></label>
        <label class="campo">E o meu nome? (é como você me chama pela voz)<input class="entrada" name="robo" maxlength="20" value="${escapar(c.nomeRobo)}"></label>
        <label class="campo">Sua cidade (para eu mostrar o tempo)<input class="entrada" name="cidade" maxlength="60" value="${escapar(c.cidade ?? "")}" placeholder="Ex.: Recife"></label>
        ${rodape()}`;
      cartao.querySelector(".carinha-boas-vindas")!.replaceChildren(new Carinha("feliz", { tamanho: 4, comAcessorio: true }).elemento);
      cartao.querySelector<HTMLInputElement>('[name="nome"]')!.focus();
    } else if (passo === 1) {
      cartao.innerHTML = `
        <h2>Como me chamar</h2>
        <div class="item"><div class="coluna"><span class="principal">Abrir e fechar</span><span class="secundario">Clique em mim no topo da tela, ou use o atalho <strong class="atalho-bv">…</strong>.</span></div></div>
        <div class="item"><div class="coluna"><span class="principal">Ditado em qualquer lugar</span><span class="secundario">Em qualquer programa: <strong>Ctrl + Shift + Espaço</strong>, fale, e aperte de novo para colar o texto onde está o cursor.</span></div></div>
        <div class="item"><div class="coluna"><span class="principal">Pela voz</span><span class="secundario">Diga “${escapar(c.nomeRobo)}” e peça: “${escapar(c.nomeRobo)}, timer de 10 minutos”, “abre o Spotify”, “o que tenho amanhã?”.</span></div></div>
        ${rodape()}`;
      atalhoAtual()
        .then((a) => (cartao.querySelector<HTMLElement>(".atalho-bv")!.textContent = atalhoLegivel(a)))
        .catch(() => {});
    } else if (passo === 2) {
      cartao.innerHTML = `
        <h2>Voz</h2>
        <div class="item">
          <div class="coluna"><span class="principal">Atender quando você me chamar pelo nome</span><span class="secundario">O microfone fica ligado, mas o nome é reconhecido no próprio PC.</span></div>
          <button type="button" class="chave" role="switch" aria-checked="${c.atenderPeloNome}" aria-label="Atender pelo nome" data-acao="bv-nome"><span></span></button>
        </div>
        <div class="item">
          <div class="coluna"><span class="principal">Voz natural grátis</span><span class="secundario">Feita no seu PC, sem internet. Escolha depois entre Dora, Alex e Santa em Ajustes › Voz.</span></div>
          <button type="button" class="chave" role="switch" aria-checked="${!!c.vozNatural}" aria-label="Voz natural grátis" data-acao="bv-voz"><span></span></button>
        </div>
        <p class="secundario situacao-bv">Preparando…</p>
        ${rodape()}`;
      const situacao = cartao.querySelector<HTMLElement>(".situacao-bv")!;
      const mb = (n: number) => Math.round(n / 1_000_000);
      const olhar = async () => {
        const partes: string[] = [];
        const o = await estadoOuvido().catch(() => null);
        if (o) partes.push(o.pequeno && o.bom ? "Ouvido pronto." : `Ouvido: baixando ${mb(o.baixado)} de ${mb(o.total)} MB.`);
        if (ler().config.vozNatural) {
          const k = await estadoKokoro().catch(() => null);
          if (k) partes.push(k.pronta ? "Voz pronta." : k.erro ? `Voz: ${k.erro}` : `Voz: baixando ${mb(k.baixado)} de ${mb(k.total)} MB.`);
        }
        situacao.textContent = `${partes.join(" ")} Pode continuar enquanto baixa.`;
      };
      void olhar();
      relogio = window.setInterval(() => (fundo.isConnected ? void olhar() : window.clearInterval(relogio)), 1500);
      aoClicar(cartao, "bv-nome", (b) => {
        const ligado = !ler().config.atenderPeloNome;
        mudar((d) => (d.config.atenderPeloNome = ligado));
        b.setAttribute("aria-checked", String(ligado));
        atenderPeloNome(ligado, ler().config.nomeRobo).catch(() => {});
      });
      aoClicar(cartao, "bv-voz", (b) => {
        const ligado = !ler().config.vozNatural;
        mudar((d) => {
          d.config.vozNatural = ligado;
          d.config.vozMotor ??= "kokoro";
        });
        b.setAttribute("aria-checked", String(ligado));
        if (ligado) prepararKokoro().catch(() => {});
      });
    } else if (passo === 3) {
      cartao.innerHTML = `
        <h2>Com qual IA eu converso?</h2>
        <p class="secundario">Dá para usar várias e trocar quando quiser (na Conversa).</p>
        <div class="item coluna-item">
          <div class="coluna"><span class="principal">DeepSeek (rápida e barata)</span><span class="secundario">Cole a chave da API (platform.deepseek.com › API keys). Ela fica guardada no cofre de senhas do Windows.</span></div>
          <div class="linha"><input class="entrada chave-deepseek" type="password" placeholder="sk-…" aria-label="Chave da DeepSeek"><button type="button" class="botao" data-acao="bv-chave">Salvar</button></div>
          <span class="secundario resposta-chave"></span>
        </div>
        <div class="item"><div class="coluna"><span class="principal">Claude Code, Codex ou Antigravity</span><span class="secundario">Usam a sua assinatura. Na Conversa, escolha um deles e toque em “Instalar e conectar”: eu instalo e abro o login.</span></div></div>
        ${rodape()}`;
      aoClicar(cartao, "bv-chave", () => {
        const campo = cartao.querySelector<HTMLInputElement>(".chave-deepseek")!;
        const resposta = cartao.querySelector<HTMLElement>(".resposta-chave")!;
        const chave = campo.value.trim();
        if (!chave) return;
        resposta.textContent = "Conferindo…";
        salvarChave("deepseek", chave)
          .then(() => testarDeepseek())
          .then(() => {
            campo.value = "";
            resposta.textContent = "Funcionando! A conversa rápida vai usar a DeepSeek.";
            mudar((d) => (d.config.conversaRapida = "motor:deepseek"));
          })
          .catch((e) => (resposta.textContent = String(e)));
      });
    } else {
      cartao.innerHTML = `
        <div class="topo-boas-vindas"><span class="carinha-boas-vindas"></span></div>
        <h2>Pronto, ${escapar(ler().config.nome || "tudo certo")}!</h2>
        <p class="secundario">Tudo isso pode ser mudado depois em Ajustes. Quando quiser, é só me chamar.</p>
        ${rodape("Começar")}`;
      cartao.querySelector(".carinha-boas-vindas")!.replaceChildren(new Carinha("apaixonado", { tamanho: 4, comAcessorio: true }).elemento);
    }

    aoClicar(cartao, "voltar-passo", () => {
      passo = Math.max(0, passo - 1);
      desenhar();
    });
    aoClicar(cartao, "proximo", () => {
      if (passo === 0) {
        const nome = cartao.querySelector<HTMLInputElement>('[name="nome"]')!.value.trim();
        const robo = cartao.querySelector<HTMLInputElement>('[name="robo"]')!.value.trim();
        const cidade = cartao.querySelector<HTMLInputElement>('[name="cidade"]')!.value.trim();
        mudar((d) => {
          if (nome) d.config.nome = nome;
          if (robo) d.config.nomeRobo = robo;
          d.config.cidade = cidade || undefined;
        });
      }
      if (passo >= PASSOS - 1) {
        window.clearInterval(relogio);
        mudar((d) => (d.config.boasVindasFeita = true));
        fundo.remove();
        aoTerminar();
        return;
      }
      passo += 1;
      desenhar();
    });
  };
  desenhar();
}
