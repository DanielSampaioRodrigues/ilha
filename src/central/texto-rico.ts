// Mostra a resposta das IAs com formatação simples (markdown básico):
// blocos de código, `código`, **negrito**, *itálico*, títulos, listas e links.
import { escapar } from "../corpo/ui";

function emLinha(t: string): string {
  return t
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

export function textoRico(bruto: string): string {
  const partes = bruto.split(/```/);
  return partes
    .map((parte, i) => {
      if (i % 2 === 1) {
        // Bloco de código: a primeira linha pode ser o nome da linguagem.
        const codigo = parte.replace(/^[a-zA-Z0-9_-]*\n/, "");
        return `<pre><code>${escapar(codigo.replace(/\n$/, ""))}</code></pre>`;
      }
      const linhas = escapar(parte).split("\n");
      let html = "";
      let lista: "ul" | "ol" | null = null;
      const fecharLista = () => {
        if (lista) html += `</${lista}>`;
        lista = null;
      };
      for (const linha of linhas) {
        const titulo = linha.match(/^(#{1,4})\s+(.*)$/);
        const item = linha.match(/^\s*[-*•]\s+(.*)$/);
        const numerado = linha.match(/^\s*\d+[.)]\s+(.*)$/);
        if (titulo) {
          fecharLista();
          html += `<p class="titulo-md">${emLinha(titulo[2])}</p>`;
        } else if (item || numerado) {
          const tipo = item ? "ul" : "ol";
          if (lista !== tipo) {
            fecharLista();
            html += `<${tipo}>`;
            lista = tipo;
          }
          html += `<li>${emLinha((item ?? numerado)![1])}</li>`;
        } else if (linha.trim() === "") {
          fecharLista();
          html += "<br>";
        } else {
          fecharLista();
          html += `<p>${emLinha(linha)}</p>`;
        }
      }
      fecharLista();
      return html.replace(/(<br>)+$/, "");
    })
    .join("");
}
