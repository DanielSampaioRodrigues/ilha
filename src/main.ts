import "./estilo.css";
import { error as registrarErro } from "@tauri-apps/plugin-log";
import { Ilha } from "./corpo/ilha";
import type { NomeEstado, NomeTela } from "./corpo/contexto";
import { aoPerderFoco, dentroDoApp, ouvir } from "./ponte";
import { procurar, versaoAtual } from "./atualizacao";
import { carregar, ler, mudar } from "./dados/armazem";
import { avancar } from "./dados/datas";
import { aplicarCor } from "./corpo/tema";
import {
  atalhoAtual,
  avisoPendente,
  definirAtalho,
  listarProgramas,
  PROGRAMAS_COM_ABAS,
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

  ouvir("ilha:abrir", () => ilha.abrir());
  ouvir("ilha:alternar", () => ilha.alternar());
  ouvir<NomeTela>("ilha:tela", (tela) => ilha.abrir(tela));
  ouvir<NomeEstado>("ilha:estado", (estado) => {
    if (estado === "pronta") ilha.notificar({ titulo: "Claude Code terminou", detalhe: "ilha (teste)", expressao: "feliz" });
    else ilha.mostrar(estado);
  });

  // Avisos de outros programas (ex.: Claude Code).
  const mostrarAviso = (aviso: AvisoExterno) =>
    ilha.notificar({ titulo: aviso.titulo, detalhe: aviso.detalhe, expressao: "feliz" });
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
    for (const r of renovadas) ilha.notificar({ titulo: `${r.nome} renovou`, detalhe: "O limite voltou", expressao: "feliz" });
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
    if (e.key !== "Escape" || ilha.estadoAtual !== "aberta") return;
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
    ["mouse ↓", () => ilha.mouse(true)],
    ["mouse ↑", () => ilha.mouse(false)],
    ["confirmação", () => ilha.mostrar("confirmacao")],
    ...(["inicio", "avisos", "tabela", "redefinicoes", "notas", "apps", "foco", "ajustes"] as NomeTela[]).map(
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

iniciar();
