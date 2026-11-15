import "./estilo.css";
import { Ilha } from "./corpo/ilha";
import type { NomeEstado } from "./corpo/estados";
import { aoPerderFoco, dentroDoApp, ouvir } from "./ponte";

const ilha = new Ilha(document.getElementById("palco")!);

ouvir("ilha:abrir", () => ilha.abrir());
ouvir("ilha:alternar", () => ilha.alternar());
ouvir<NomeEstado>("ilha:estado", (estado) => ilha.mostrar(estado));

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
