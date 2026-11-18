// Painel "Hoje" da Central: um resumo vivo do dia em cartões (estilo
// "bento"): saudação com o tempo e o próximo compromisso, foco e timers,
// agenda, tarefas, hábitos, conversas recentes, a nota mais recente e as
// contas que precisam de atenção. Dá para agir direto daqui (concluir
// tarefa, somar hábito, começar foco, abrir conversa).
import "./hoje.css";
import { emit } from "@tauri-apps/api/event";
import { ler, mudar, novoId } from "../dados/armazem";
import { conversas } from "../dados/conversas";
import { NOMES_MOTORES } from "../maos/sistema";
import { haQuanto, paraISO, pendentes, pertoDeRenovar, prazo, faltaEscrito } from "../dados/datas";
import { compromissosDeHoje, jeitoDoTempo, tempoAgora } from "../dados/agora";
import { agendaConectada } from "../dados/agenda";
import { graficoFoco, resumoFoco, sequencia } from "../dados/progresso";
import { Carinha } from "../corpo/carinha";
import { confeteEm } from "../corpo/festa";
import { ICONES } from "../corpo/icones";
import { selo, SELO_MOTOR } from "../corpo/selos";
import { escapar, html } from "../corpo/ui";
import { ordenar } from "../corpo/telas/tarefas";
import { entenderData, quandoLegivel } from "../dados/datas-faladas";

export interface AcoesHoje {
  ir(secao: string): void;
  abrirConversa(id: string): void;
  novaConversa(): void;
  renovar(): void;
}

function saudacao(h: number): string {
  return h < 5 ? "Boa noite" : h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

const hora = (d: Date) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

function anel(fracao: number, tamanho = 46): string {
  const r = tamanho / 2 - 4;
  const c = 2 * Math.PI * r;
  return `<svg viewBox="0 0 ${tamanho} ${tamanho}" width="${tamanho}" height="${tamanho}" aria-hidden="true"><circle cx="${tamanho / 2}" cy="${tamanho / 2}" r="${r}" class="anel-fundo"/>${fracao > 0 ? `<circle cx="${tamanho / 2}" cy="${tamanho / 2}" r="${r}" class="anel-cheio" stroke-dasharray="${(c * Math.min(1, fracao)).toFixed(1)} ${c.toFixed(1)}"/>` : ""}</svg>`;
}

const relogio = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
};

export function montarHoje(acoes: AcoesHoje, animar: boolean): HTMLElement {
  const d = ler();
  const agora = new Date();
  const dia = paraISO(agora);
  const nome = d.config.nome || "Dan";

  // Tarefas: as de hoje/atrasadas e importantes primeiro.
  const tarefas = ordenar(d.tarefas).filter((t) => !t.feita);
  const fimDeHoje = `${dia}T23:59`;
  const paraHoje = tarefas.filter((t) => (t.quando && t.quando <= fimDeHoje) || t.prioridade >= 2).length;
  // Hábitos de hoje.
  const habitos = d.habitos.map((h) => ({ ...h, feito: h.registros[dia] ?? 0 }));
  const faltamHabitos = habitos.filter((h) => h.feito < h.meta).length;
  // Contas que precisam de atenção.
  const contas = pendentes(d.assinaturas, agora);
  const renovam = d.redefinicoes.filter((r) => pertoDeRenovar(r, agora));
  // Conversas recentes.
  const recentes = [...conversas()].sort((a, b) => b.atualizada - a.atualizada).slice(0, 4);
  const nota = d.notas.find((n) => n.texto.trim());

  // Uma frase que resume o dia.
  const partes = [
    paraHoje ? `${paraHoje} ${paraHoje === 1 ? "tarefa" : "tarefas"} para hoje` : "",
    faltamHabitos ? `${faltamHabitos} ${faltamHabitos === 1 ? "hábito" : "hábitos"} para completar` : "",
    contas.length ? `${contas.length} ${contas.length === 1 ? "conta" : "contas"} para pagar` : "",
  ].filter(Boolean);
  const resumo = partes.length
    ? `Você tem ${partes.length > 1 ? `${partes.slice(0, -1).join(", ")} e ${partes.at(-1)}` : partes[0]}.`
    : "Tudo em dia por aqui. Bora fazer algo legal?";

  const raiz = html(`
    <div class="painel-hoje ${animar ? "chegando" : ""}">
      <section class="cartao-hoje heroi">
        <div class="heroi-texto">
          <p class="data-hoje">${escapar(agora.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }))}</p>
          <h1 class="ola">${saudacao(agora.getHours())}, ${escapar(nome)}</h1>
          <p class="resumo-hoje">${escapar(resumo)}</p>
          <div class="chips-heroi"></div>
        </div>
        <div class="heroi-personagem"></div>
      </section>

      <section class="cartao-hoje foco-hoje">
        <p class="titulo-cartao">${ICONES.relogio}Foco</p>
        <div class="botoes-foco">
          <button type="button" class="bola-foco" data-foco="foco" data-min="${d.config.focoMinutos}"><strong>${d.config.focoMinutos}</strong><span>min de foco</span></button>
          <button type="button" class="bola-foco pausa" data-foco="pausa" data-min="${d.config.pausaMinutos}"><strong>${d.config.pausaMinutos}</strong><span>de pausa</span></button>
        </div>
        <div class="timers-hoje">${d.timers
          .slice()
          .sort((a, b) => a.fim - b.fim)
          .slice(0, 3)
          .map((t) => `<div class="linha-hoje"><span>${ICONES.timer}${escapar(t.nome)}</span><span class="tempo-timer" data-fim="${t.fim}">${relogio(t.fim - Date.now())}</span></div>`)
          .join("")}</div>
        <div class="semana-foco no-hoje">${graficoFoco(agora)}<span class="secundario">${resumoFoco(agora)}</span></div>
      </section>

      <section class="cartao-hoje agenda-hoje">
        <p class="titulo-cartao">${ICONES.calendario}Agenda de hoje</p>
        <div class="lista-agenda">${
          agendaConectada(d)
            ? '<p class="vazio-hoje">Carregando…</p>'
            : '<button type="button" class="botao-suave" data-ir="calendario">Conectar sua agenda (Apple ou Google)</button>'
        }</div>
      </section>

      <section class="cartao-hoje tarefas-hoje">
        <p class="titulo-cartao">${ICONES.tarefas}Tarefas <button type="button" class="ver-tudo" data-ir="tarefas">ver todas</button></p>
        <div class="lista-tarefas-hoje">${
          tarefas
            .slice(0, 6)
            .map(
              (t) => `
          <div class="linha-tarefa">
            <button type="button" class="circulo" aria-label="Concluir ${escapar(t.texto)}" data-concluir="${t.id}"></button>
            <span>${t.prioridade ? `<b class="prioridade">${"!".repeat(t.prioridade)}</b>` : ""}${escapar(t.texto)}</span>
          </div>`,
            )
            .join("") || '<p class="vazio-hoje">Nada pendente. Que tal descansar um pouco?</p>'
        }</div>
        <form class="nova-tarefa-hoje"><input class="entrada" name="texto" placeholder="+ Nova tarefa (ex.: Prova sexta 8h)" aria-label="Nova tarefa" autocomplete="off"><span class="previa-data" hidden></span></form>
      </section>

      <section class="cartao-hoje habitos-hoje">
        <p class="titulo-cartao">${ICONES.habitos}Hábitos <button type="button" class="ver-tudo" data-ir="habitos">editar</button></p>
        <div class="aneis-habitos">${
          habitos
            .map(
              (h, i) => `
          <button type="button" class="anel-habito ${h.feito >= h.meta ? "completo" : ""}" data-habito="${h.id}" style="--giro:${i * 70}" title="Somar 1 em ${escapar(h.nome)}">
            <span class="anel-caixa">${anel(h.feito / Math.max(1, h.meta))}<b>${h.feito >= h.meta ? "✓" : `${h.feito}/${h.meta}`}</b></span>
            <span class="nome-habito">${escapar(h.nome)}</span>
            ${sequencia(h, agora) >= 2 ? `<span class="fogo">🔥 ${sequencia(h, agora)}</span>` : ""}
          </button>`,
            )
            .join("") || '<p class="vazio-hoje">Nenhum hábito ainda.</p>'
        }</div>
      </section>

      <section class="cartao-hoje conversas-hoje">
        <p class="titulo-cartao">${ICONES.teclado}Conversas recentes <button type="button" class="ver-tudo" data-acao-hoje="nova">+ nova</button></p>
        <div class="lista-conversas-hoje">${
          recentes
            .map(
              (c) => `
          <button type="button" class="linha-conversa" data-conversa="${c.id}">
            ${selo(SELO_MOTOR[c.motor], 18)}
            <span class="coluna"><span class="principal">${escapar(c.titulo || "Conversa nova")}</span><span class="secundario">${NOMES_MOTORES[c.motor]} · ${haQuanto(new Date(c.atualizada), agora)}</span></span>
          </button>`,
            )
            .join("") || '<p class="vazio-hoje">Nenhuma conversa ainda. Comece uma!</p>'
        }</div>
      </section>

      <section class="cartao-hoje nota-hoje" ${nota ? 'data-ir="notas" role="button" tabindex="0"' : ""}>
        <p class="titulo-cartao">${ICONES.notas}Nota</p>
        ${nota ? `<p class="texto-nota">${escapar(nota.texto.slice(0, 400))}</p>` : '<button type="button" class="botao-suave" data-ir="notas">Escrever uma nota</button>'}
      </section>

      <section class="cartao-hoje contas-hoje">
        <p class="titulo-cartao">${ICONES.cartao}Contas e renovações</p>
        ${
          contas.length || renovam.length
            ? [
                ...contas.map((a) => `<div class="linha-hoje alerta"><span>${escapar(a.nome)}</span><span>${prazo(a.dias)}</span></div>`),
                ...renovam.map((r) => `<div class="linha-hoje"><span>${escapar(r.nome)}</span><span>renova ${faltaEscrito(new Date(r.proxima), agora)}</span></div>`),
              ].join("")
            : '<p class="vazio-hoje tudo-certo">Tudo em dia ✓</p>'
        }
      </section>
    </div>`);

  raiz.querySelector(".heroi-personagem")!.replaceChildren(new Carinha("feliz", { tamanho: 13, comAcessorio: true, corpoInteiro: true }).elemento);

  // Coisas que chegam da internet: o tempo e a agenda.
  const chips = raiz.querySelector<HTMLElement>(".chips-heroi")!;
  void tempoAgora().then((t) => {
    if (!t || !raiz.isConnected) return;
    const j = jeitoDoTempo(t.codigo, t.dia);
    chips.insertAdjacentHTML("afterbegin", `<span class="chip-heroi">${j.icone}${Math.round(t.temperatura)}° · ${escapar(j.nome)} em ${escapar(t.cidade)}</span>`);
  });
  if (agendaConectada(d)) {
    void compromissosDeHoje().then((lista) => {
      if (!raiz.isConnected) return;
      const caixa = raiz.querySelector<HTMLElement>(".lista-agenda")!;
      const agoraMs = Date.now();
      caixa.innerHTML =
        lista
          .map((c) => {
            const passou = !c.diaInteiro && c.quando.getTime() < agoraMs - 60 * 60_000;
            return `<div class="linha-agenda ${passou ? "passou" : ""}"><span class="hora-agenda">${c.diaInteiro ? "dia todo" : hora(c.quando)}</span><span class="coluna"><span class="principal">${escapar(c.titulo)}</span>${c.local ? `<span class="secundario">${escapar(c.local)}</span>` : ""}</span></div>`;
          })
          .join("") || '<p class="vazio-hoje">Dia livre na agenda.</p>';
      const proximo = lista.find((c) => !c.diaInteiro && c.quando.getTime() >= agoraMs - 15 * 60_000);
      if (proximo) {
        const falta = Math.round((proximo.quando.getTime() - agoraMs) / 60_000);
        chips.insertAdjacentHTML(
          "beforeend",
          `<span class="chip-heroi">${ICONES.calendario}${escapar(proximo.titulo)} · ${falta <= 0 ? "agora" : falta < 60 ? `em ${falta} min` : `às ${hora(proximo.quando)}`}</span>`,
        );
      }
    });
  }

  // Timers correndo: atualiza a cada segundo enquanto o painel está à vista.
  const tempos = [...raiz.querySelectorAll<HTMLElement>(".tempo-timer")];
  if (tempos.length) {
    const relogioTimers = window.setInterval(() => {
      if (!raiz.isConnected) return window.clearInterval(relogioTimers);
      for (const t of tempos) t.textContent = relogio(Number(t.dataset.fim) - Date.now());
    }, 1000);
  }

  // ---------- Ações ----------
  raiz.addEventListener("click", (e) => {
    const alvo = e.target as HTMLElement;
    const ir = alvo.closest<HTMLElement>("[data-ir]");
    const concluir = alvo.closest<HTMLElement>("[data-concluir]");
    const habito = alvo.closest<HTMLElement>("[data-habito]");
    const foco = alvo.closest<HTMLElement>("[data-foco]");
    const conversa = alvo.closest<HTMLElement>("[data-conversa]");
    if (concluir) {
      confeteEm(concluir);
      concluir.classList.add("marcado");
      mudar((x) => {
        const t = x.tarefas.find((y) => y.id === concluir.dataset.concluir);
        if (t) t.feita = true;
      });
      window.setTimeout(acoes.renovar, 380);
    } else if (habito) {
      let bateu = false;
      mudar((x) => {
        const h = x.habitos.find((y) => y.id === habito.dataset.habito);
        if (!h) return;
        h.registros[dia] = (h.registros[dia] ?? 0) + 1;
        bateu = h.registros[dia] === h.meta;
      });
      if (bateu) confeteEm(habito, 34);
      acoes.renovar();
    } else if (foco) {
      emit("ilha:comecar-foco", { tipo: foco.dataset.foco, minutos: Number(foco.dataset.min) }).catch(() => {});
      foco.classList.add("comecou");
      foco.querySelector("span")!.textContent = "começou!";
    } else if (conversa) {
      acoes.abrirConversa(conversa.dataset.conversa!);
    } else if (alvo.closest('[data-acao-hoje="nova"]')) {
      acoes.novaConversa();
    } else if (ir) {
      acoes.ir(ir.dataset.ir!);
    }
  });
  raiz.querySelector<HTMLElement>(".nota-hoje")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") acoes.ir("notas");
  });
  const form = raiz.querySelector<HTMLFormElement>(".nova-tarefa-hoje")!;
  const previa = form.querySelector<HTMLElement>(".previa-data")!;
  form.querySelector("input")!.addEventListener("input", (e) => {
    const r = entenderData((e.target as HTMLInputElement).value);
    previa.hidden = !r.quando;
    previa.innerHTML = r.quando ? `${ICONES.calendario}${quandoLegivel(r.quando)}` : "";
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const frase = String(new FormData(form).get("texto") ?? "").trim();
    if (!frase) return;
    const { texto, quando, prioridade } = entenderData(frase);
    mudar((x) => x.tarefas.push({ id: novoId(), texto, prioridade, quando, feita: false, subtarefas: [] }));
    acoes.renovar();
    window.setTimeout(() => document.querySelector<HTMLInputElement>(".nova-tarefa-hoje input")?.focus(), 30);
  });
  return raiz;
}
