// Cor de destaque escolhida pelo Dan (botões, marcações, abas ativas).

export const CORES_DESTAQUE = [
  { nome: "Ciano", cor: "#3FE6EE" },
  { nome: "Verde", cor: "#5BE38F" },
  { nome: "Azul", cor: "#7BA7FF" },
  { nome: "Lilás", cor: "#B78CFF" },
  { nome: "Rosa", cor: "#FF8FB4" },
  { nome: "Amarelo", cor: "#FFD84D" },
];

export function aplicarCor(cor: string): void {
  document.documentElement.style.setProperty("--ciano", cor);
}
