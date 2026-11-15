import "./estilo.css";
import { error as registrarErro } from "@tauri-apps/plugin-log";
import { Ilha } from "./corpo/ilha";
import type { NomeEstado, NomeTela } from "./corpo/contexto";
import { aoPerderFoco, dentroDoApp, ouvir } from "./ponte";
import { procurar, versaoAtual } from "./atualizacao";
import { carregar, ler, mudar } from "./dados/armazem";
import { atalhoAtual, avisoPendente, definirAtalho, type AvisoExterno } from "./maos/sistema";

// Erros da interface também vão para o registro de erros.
if (dentroDoApp) {
  window.addEventListener("error", (e) => registrarErro(`Interface: ${e.message}`).catch(() => {}));
  window.addEventListener("unhandledrejection", (e) =>
    registrarErro(`Interface: ${String(e.reason)}`).catch(() => {}),
  );
}

async function iniciar(): Promise<void> {
  await carregar();
  const ilha = new Ilha(document.getElementById("palco")!);

  // Atalho: usa o que o Dan escolheu em Ajustes; senão, o padrão que o Rust registrou.
  const escolhido = ler().config.atalho;
  const registrado = escolhido
    ? await definirAtalho(escolhido).catch(() => atalhoAtual())
    : await atalhoAtual().catch(() => null);
  ilha.definirAtalho(registrado);

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

  // Lembretes: quando chega a hora, avisa uma vez e tira da lista.
  window.setInterval(() => {
    const agora = new Date();
    const vencidos = ler().lembretes.filter((l) => new Date(l.quando) <= agora);
    if (!vencidos.length) return;
    mudar((d) => (d.lembretes = d.lembretes.filter((l) => new Date(l.quando) > agora)));
    for (const l of vencidos) ilha.notificar({ titulo: l.titulo, detalhe: "Lembrete", expressao: "alerta" });
  }, 15_000);

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
    ["confirmação", () => ilha.mostrar("confirmacao")],
    ...(["inicio", "avisos", "notas", "apps", "foco", "ajustes"] as NomeTela[]).map(
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
