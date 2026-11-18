import "./estilo.css";
import { error as registrarErro } from "@tauri-apps/plugin-log";
import { Ilha } from "./corpo/ilha";
import type { NomeEstado, NomeTela } from "./corpo/contexto";
import { aoPerderFoco, dentroDoApp, ouvir } from "./ponte";
import { procurar, versaoAtual } from "./atualizacao";
import { bip, calar, falando } from "./maos/fala";
import { aoMudarDeFora, carregar, ler, mudar } from "./dados/armazem";
import { ajustarMicrofoneComEco } from "./maos/microfone-eco";
import { avancar, paraISO } from "./dados/datas";
import { aplicarCor } from "./corpo/tema";
import { olharTodas, precarregarImagens } from "./corpo/carinha";
import {
  atalhoAtual,
  avisoPendente,
  definirAtalho,
  esconderEmTelaCheia,
  listarProgramas,
  perceberAtividade,
  atenderPeloNome,
  escolherOuvido,
  responderPermissao,
  copiadosLigar,
  midiaAtual,
  PROGRAMAS_COM_ABAS,
  type Volume,
  type AvisoExterno,
  type JanelaAtiva,
} from "./maos/sistema";

// Erros da interface também vão para o registro de erros.
if (dentroDoApp) {
  window.addEventListener("error", (e) => registrarErro(`Interface: ${e.message}`).catch(() => {}));
  window.addEventListener("unhandledrejection", (e) =>
    registrarErro(`Interface: ${String(e.reason)}`).catch(() => {}),
  );
}

async function iniciar(): Promise<void> {
  await carregar();
  aplicarCor(ler().config.corDestaque);
  const ilha = new Ilha(document.getElementById("palco")!);

  // Atalho: usa o que o Dan escolheu em Ajustes; senão, o padrão que o Rust registrou.
  const escolhido = ler().config.atalho;
  const registrado = escolhido
    ? await definirAtalho(escolhido).catch(() => atalhoAtual())
    : await atalhoAtual().catch(() => null);
  ilha.definirAtalho(registrado);

  // Modo discreto: risquinho em repouso; no automático, só com navegador (ou
  // outro programa com abas) na frente e encostado no topo da tela.
  ilha.definirModoDiscreto(ler().config.modoDiscreto);
  ouvir<JanelaAtiva>("ilha:janela-ativa", (j) => ilha.definirJanelaComAbas(j.noTopo && j.programa in PROGRAMAS_COM_ABAS));
  ouvir<boolean>("ilha:mouse", (dentro) => ilha.mouse(dentro));

  // Personagem: olhos seguem o mouse; cochila com o mouse parado.
  ouvir<{ x: number; y: number }>("ilha:olhar", (o) => {
    if (ler().config.olhosSeguemMouse) olharTodas(o.x, o.y);
  });
  ouvir<boolean>("ilha:ocioso", (parado) => ilha.ocioso(parado));
  // Passeio: enquanto o personagem está fora, a ilha fica sem carinha.
  ouvir<boolean>("ilha:passeio", (fora) => ilha.passeando(fora));
  ilha.agendarPasseios();
  ilha.agendarRotinas();
  ouvir<import("./corpo/contexto").Pergunta>("ilha:permissao", (p) => {
    ilha.perguntar(p);
    // Conversa por voz: pergunta falando e aceita "sim"/"não" falado.
    import("./corpo/telas/conversa").then((m) =>
      m.perguntarPorVoz(p, (sim) => {
        responderPermissao(p.id, sim).catch(() => {});
        ilha.esquecerPergunta(p.id);
      }),
    );
  });
  ouvir<string>("ilha:permissao-fim", (id) => ilha.esquecerPergunta(id));
  ouvir<{ digitando: boolean; categoria: string }>("ilha:atividade", (a) => ilha.atividade(a.digitando, a.categoria));
  // Madrugada etc.: confere a hora de tempos em tempos.
  window.setInterval(() => ilha.atualizarAtividade(), 60_000);
  perceberAtividade(ler().config.perceberAtividade).catch(() => {});
  precarregarImagens(ler().config.personagem);
  if (!ler().config.copiadosLigado) copiadosLigar(false).catch(() => {});
  if (ler().config.atenderPeloNome) atenderPeloNome(true, ler().config.nomeRobo).catch(() => {});
  // Microfone com cancelamento de eco (só nesta janela, a da ilha): fica ligado
  // enquanto "Atender quando eu chamar pelo nome" estiver ligado.
  ajustarMicrofoneComEco();
  aoMudarDeFora(ajustarMicrofoneComEco);
  // Calendário da Apple: manda o que mudou (se estiver conectado).
  import("./dados/calendario").then((m) => m.sincronizarSempre());
  // Chamou pelo nome: abre a conversa já ouvindo o pedido.
  // Ouvido rápido (padrão) ou mais preciso: o Rust baixa o que faltar.
  escolherOuvido(!!ler().config.ouvidoPreciso, !!ler().config.ouvidoNuvem).catch(() => {});
  // O ouvido terminou de se preparar (primeira vez): avisa uma vez.
  ouvir("ouvido:tudo-pronto", () =>
    ilha.notificar({
      titulo: "O ouvido da ilha está pronto",
      detalhe: ler().config.atenderPeloNome ? `Agora é só chamar “${ler().config.nomeRobo}”` : "Já dá para falar pelo microfone",
      expressao: "feliz",
    }),
  );
  // Se o pedido veio junto ("Robozinho, que horas são?"), já manda; senão, abre ouvindo.
  ouvir<string | { texto: string; pedido?: string | null; esperando?: boolean; etapa?: "ouvindo" | "entendendo" }>("ilha:chamou", (chamou) => {
    const pedido = typeof chamou === "object" ? chamou.pedido?.trim() : "";
    const esperando = typeof chamou === "object" && !!chamou.esperando;
    const entendendo = typeof chamou === "object" && chamou.etapa === "entendendo";
    // O bip vem já, antes de carregar a tela da conversa (cada milésimo conta).
    if (esperando && !entendendo) {
      calar();
      bip();
    }
    import("./corpo/telas/conversa").then((m) => {
      // Ouvido da ilha: ele mesmo já está ouvindo o pedido.
      if (esperando) m.abrirEsperandoPedido(entendendo ? "entendendo" : "ouvindo", true);
      else if (pedido) m.abrirComPedido(pedido);
      else m.abrirOuvindo();
      ilha.abrir("conversa");
    });
  });

  // Atividades ao vivo na ilha fechada: música tocando e volume mudando.
  const conferirMusica = () => midiaAtual(false).then((m) => ilha.definirMusica(m)).catch(() => {});
  if (dentroDoApp) {
    conferirMusica();
    window.setInterval(conferirMusica, 2000);
  }
  ouvir<Volume>("ilha:volume", (v) => ilha.mostrarVolume(v));

  // Esconder em jogo/vídeo em tela cheia (o Rust começa ligado; aqui vale o que o Dan escolheu).
  esconderEmTelaCheia(ler().config.esconderTelaCheia).catch(() => {});

  // PC pesado por um tempo: avisa com o culpado.
  ouvir<{ motivo: string; programa: string }>("ilha:pc-pesado", (p) =>
    ilha.notificar({
      titulo: `PC pesado: ${p.motivo}`,
      detalhe: p.programa ? `quem mais pesa: ${p.programa}` : "",
      expressao: "alerta",
      botao: { texto: "Ver", fazer: () => ilha.abrir("pc") },
    }),
  );

  // Lembrete de pausa (Hábitos): a cada X minutos com o PC ligado.
  let ultimaPausa = Date.now();
  window.setInterval(() => {
    const minutos = ler().config.pausaACada;
    if (!minutos) {
      ultimaPausa = Date.now();
      return;
    }
    if (Date.now() - ultimaPausa < minutos * 60_000) return;
    ultimaPausa = Date.now();
    const agua = ler().habitos.find((h) => h.nome.toLowerCase().includes("água"));
    ilha.notificar({
      titulo: "Hora de uma pausa",
      detalhe: "Levanta, alonga e bebe água",
      expressao: "feliz",
      botao: agua
        ? {
            texto: "Bebi água",
            fazer: () => {
              const dia = paraISO(new Date());
              mudar((d) => {
                const h = d.habitos.find((x) => x.id === agua.id);
                if (h) h.registros[dia] = (h.registros[dia] ?? 0) + 1;
              });
              ilha.fechar();
            },
          }
        : undefined,
    });
  }, 30_000);

  // Recados da Central (outra janela).
  aoMudarDeFora(() => {
    aplicarCor(ler().config.corDestaque);
    ilha.dadosMudaram();
  });
  ouvir<{ id: string; titulo: string; motor: string }>("ilha:trabalho", (t) => ilha.comecarTrabalho(t.id, t.titulo, t.motor));
  ouvir<{ id: string; titulo: string; motor: string; ok: boolean; segundos: number }>("ilha:trabalho-fim", (t) =>
    ilha.terminarTrabalho(t.id, t.titulo, t.motor, t.ok, t.segundos),
  );
  ouvir<{ tipo: "foco" | "pausa"; minutos: number }>("ilha:comecar-foco", (f) => ilha.comecarFoco(f.tipo, f.minutos));
  ouvir("ilha:parar-foco", () => ilha.pararFoco());
  ouvir<{ nome: string; minutos: number }>("ilha:comecar-timer", (t) => ilha.comecarTimer(t.nome, t.minutos));
  ouvir<"desligado" | "automatico" | "sempre">("ilha:modo-discreto", (m) => ilha.definirModoDiscreto(m));
  ouvir<string>("ilha:atalho", (a) => ilha.definirAtalho(a));

  // Arrastar arquivos para a ilha: abre a Central com eles anexados.
  if (dentroDoApp) {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    const { abrirCentral } = await import("./maos/sistema");
    getCurrentWebview()
      .onDragDropEvent((e) => {
        if (e.payload.type !== "drop" || !e.payload.paths.length) return;
        abrirCentral("conversa-atual", e.payload.paths).catch(() => {});
      })
      .catch(() => {});
  }

  ouvir("ilha:abrir", () => ilha.abrir());
  // O atalho da ilha também faz o robô parar de falar (sem abrir nem fechar).
  ouvir("ilha:alternar", () => (falando() ? calar() : ilha.alternar()));
  // Clicar na ilha enquanto ele fala: para de falar.
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (falando() && (e.target as Element).closest?.(".forma, .camada .estado:not(.aberta)")) calar();
    },
    true,
  );
  ouvir<NomeTela>("ilha:tela", (tela) => ilha.abrir(tela));
  ouvir<NomeEstado>("ilha:estado", (estado) => {
    if (estado === "pronta") ilha.notificar({ titulo: "Claude Code terminou", detalhe: "ilha (teste)", expressao: "feliz" });
    else ilha.mostrar(estado);
  });

  // Avisos de outros programas (ex.: Claude Code).
  const mostrarAviso = (aviso: AvisoExterno) =>
    ilha.notificar({
      titulo: aviso.titulo,
      detalhe: aviso.detalhe,
      expressao: /não consegui|erro/i.test(aviso.titulo) ? "triste" : /esperando/i.test(aviso.titulo) ? "pensando" : "feliz",
    });
  ouvir<AvisoExterno>("ilha:notificar", mostrarAviso);
  avisoPendente()
    .then((aviso) => aviso && mostrarAviso(aviso))
    .catch(() => {});

  // Redefinições: quando chega a hora, avisa que renovou e passa para a próxima
  // data (ou sai da lista, se não se repete).
  const conferirRedefinicoes = () => {
    const agora = new Date();
    const renovadas = ler().redefinicoes.filter((r) => avancar(r, agora) !== r.proxima);
    if (!renovadas.length) return;
    mudar((d) => {
      d.redefinicoes = d.redefinicoes.flatMap((r) => {
        const proxima = avancar(r, agora);
        return proxima ? [{ ...r, proxima }] : [];
      });
    });
    for (const r of renovadas) ilha.notificar({ titulo: `${r.nome} renovou`, detalhe: "O limite voltou", expressao: "apaixonado" });
  };
  conferirRedefinicoes();
  window.setInterval(conferirRedefinicoes, 15_000);

  // Uma vez só: troca os sites padrão (Claude, ChatGPT…) pelo programa instalado
  // com o mesmo nome, se existir. Assim abre o app em vez do navegador.
  if (!ler().config.appsConferidos && dentroDoApp) {
    listarProgramas()
      .then((instalados) => {
        mudar((d) => {
          for (const app of d.apps) {
            if (!/^https?:/i.test(app.caminho)) continue;
            const mesmo = instalados.find((p) => p.nome.trim().toLowerCase() === app.nome.trim().toLowerCase());
            if (mesmo) app.caminho = mesmo.caminho;
          }
          d.config.appsConferidos = true;
        });
      })
      .catch(() => {});
  }

  // Atualização: procura sozinha ao ligar e a cada 6 horas, sem interromper.
  versaoAtual().then((versao) => ilha.definirVersao(versao));
  const procurarEmSilencio = () => procurar().then((n) => ilha.definirNovidade(n)).catch(() => {});
  window.setTimeout(procurarEmSilencio, 15_000);
  window.setInterval(procurarEmSilencio, 6 * 60 * 60 * 1000);
  const procurarAgora = async () => {
    try {
      const novidade = await procurar();
      ilha.definirNovidade(novidade);
      if (novidade) ilha.abrir();
      else ilha.avisar(`Você já tem a versão mais nova (${await versaoAtual()}).`);
    } catch {
      ilha.avisar("Não consegui procurar atualização agora.");
    }
  };
  ilha.aoProcurarAtualizacao = procurarAgora;
  ouvir("ilha:procurar-atualizacao", procurarAgora);

  // Clicar fora fecha a ilha aberta. Esc volta para o início ou fecha.
  aoPerderFoco(() => {
    if (ilha.podeFecharSozinha) ilha.fechar();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    // Esc primeiro faz o robô parar de falar.
    if (falando()) {
      calar();
      return;
    }
    if (ilha.estadoAtual !== "aberta") return;
    if (ilha.telaAtual !== "inicio") ilha.abrir("inicio");
    else ilha.fechar();
  });

  if (!dentroDoApp) montarTeste(ilha);
}

// No navegador (só para testar a aparência): fundo de "área de trabalho" e
// botões para ver cada estado. Nada disso aparece no app instalado.
function montarTeste(ilha: Ilha): void {
  document.body.classList.add("navegador");
  const barra = document.createElement("nav");
  barra.className = "teste";
  const botoes: [string, () => void][] = [
    ["repouso", () => ilha.mostrar("repouso")],
    ["ouvindo", () => ilha.mostrar("ouvindo")],
    ["pronta", () => ilha.notificar({ titulo: "Claude Code terminou", detalhe: "ilha", expressao: "feliz" })],
    ["aviso", () => ilha.mostrar("aviso")],
    ["foco", () => ilha.comecarFoco("foco", 25)],
    ["discreto", () => ilha.definirModoDiscreto("sempre")],
    ["música", () => ilha.definirMusica({ titulo: "Highway to Hell", artista: "AC/DC", tocando: true, capa: null })],
    ["volume", () => ilha.mostrarVolume({ nivel: 64, mudo: false })],
    ["timer", () => ilha.comecarTimer("Macarrão", 10)],
    ["digitando", () => ilha.atividade(true, "")],
    ["vídeo", () => ilha.atividade(false, "video")],
    ["sem atividade", () => ilha.atividade(false, "")],
    ["cochilar", () => ilha.ocioso(true)],
    ["acordar", () => ilha.ocioso(false)],
    ["mouse ↓", () => ilha.mouse(true)],
    ["mouse ↑", () => ilha.mouse(false)],
    ["confirmação", () => ilha.mostrar("confirmacao")],
    ["passear", () => window.open("/?modo=passeio", "_blank")],
    ["posso?", () => ilha.perguntar({ id: "t1", conversa: "x", ferramenta: "Bash", detalhe: "npm install && npm run build" })],
    ...(["inicio", "personagem", "traducoes", "tarefas", "habitos", "timers", "textos", "pc", "ajustes"] as NomeTela[]).map(
      (t): [string, () => void] => [`tela ${t}`, () => ilha.abrir(t)],
    ),
  ];
  for (const [nome, fazer] of botoes) {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.textContent = nome;
    botao.addEventListener("click", fazer);
    barra.append(botao);
  }
  document.body.append(barra);
  document.getElementById("palco")!.addEventListener("click", (e) => {
    if (e.target === e.currentTarget && ilha.podeFecharSozinha) ilha.fechar();
  });
  const pedido = new URLSearchParams(location.search);
  const tela = pedido.get("tela") as NomeTela | null;
  const estado = pedido.get("estado") as NomeEstado | null;
  if (tela) ilha.abrir(tela);
  else if (estado) ilha.mostrar(estado, true);
  Object.assign(window, { ilha });
}

// A mesma interface serve a três janelas: a ilha, a tradução da tela e a Central.
const janela = dentroDoApp
  ? (await import("@tauri-apps/api/window")).getCurrentWindow().label
  : (new URLSearchParams(location.search).get("modo") ?? "ilha");
if (janela === "traducao") (await import("./traducao")).iniciarTraducao();
else if (janela === "central") (await import("./central/central")).iniciarCentral();
else if (janela === "passeio") (await import("./passeio")).iniciarPasseio();
else iniciar();
