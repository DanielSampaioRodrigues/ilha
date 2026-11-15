import "./estilo.css";
import { Ilha } from "./corpo/ilha";
import type { NomeEstado } from "./corpo/estados";
import { aoPerderFoco, dentroDoApp, ouvir } from "./ponte";
import { procurar, versaoAtual } from "./atualizacao";

const ilha = new Ilha(document.getElementById("palco")!);

ouvir("ilha:abrir", () => ilha.abrir());
ouvir("ilha:alternar", () => ilha.alternar());
ouvir<NomeEstado>("ilha:estado", (estado) => ilha.mostrar(estado));

// Atualização: procura sozinha ao ligar e a cada 6 horas, sem interromper.
// Pelo menu da bandeja ("Procurar atualização"), avisa o resultado.
versaoAtual().then((versao) => ilha.definirVersao(versao));
const procurarEmSilencio = () => procurar().then((n) => ilha.definirNovidade(n)).catch(() => {});
window.setTimeout(procurarEmSilencio, 15_000);
window.setInterval(procurarEmSilencio, 6 * 60 * 60 * 1000);
ouvir("ilha:procurar-atualizacao", async () => {
  try {
    const novidade = await procurar();
    ilha.definirNovidade(novidade);
    if (novidade) ilha.abrir();
    else ilha.avisar(`Você já tem a versão mais nova (${await versaoAtual()}).`);
  } catch {
    ilha.avisar("Não consegui procurar atualização agora.");
  }
});

// Clicar fora ou apertar Esc fecha a ilha aberta.
aoPerderFoco(() => {
  if (ilha.estadoAtual === "aberta") ilha.fechar();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && ilha.estadoAtual === "aberta") ilha.fechar();
});

// No navegador (só para testar a aparência): fundo de "área de trabalho" e
// botões para ver cada estado. Nada disso aparece no app instalado.
if (!dentroDoApp) {
  document.body.classList.add("navegador");
  const estados: NomeEstado[] = ["repouso", "ouvindo", "trabalhando", "pronta", "aviso", "confirmacao", "aberta"];
  const barra = document.createElement("nav");
  barra.className = "teste";
  for (const estado of estados) {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.textContent = estado;
    botao.addEventListener("click", () => ilha.mostrar(estado));
    barra.append(botao);
  }
  document.body.append(barra);
  document.getElementById("palco")!.addEventListener("click", (e) => {
    if (e.target === e.currentTarget && ilha.estadoAtual === "aberta") ilha.fechar();
  });
  const inicial = new URLSearchParams(location.search).get("estado") as NomeEstado | null;
  if (inicial) ilha.mostrar(inicial, true);
  Object.assign(window, { ilha });
}
