// MCPs e Skills: instalar uma vez, usar em qualquer motor. Em cada conversa
// (ou perfil) você liga só os que quer.
import { ler, mudar, novoId, type ServidorMcp, type Skill } from "../dados/armazem";
import { salvarSegredoMcp, temSegredoMcp, skillsDoClaude } from "../maos/sistema";
import { aoClicar, confirmarAntes, escapar, html } from "../corpo/ui";

/** Servidores MCP conhecidos, prontos para instalar com um clique. */
export const CATALOGO_MCP: Omit<ServidorMcp, "id">[] = [
  {
    nome: "playwright",
    descricao: "Navegador: a IA abre sites, clica, preenche e lê páginas.",
    tipo: "local",
    comando: "npx",
    argumentos: ["-y", "@playwright/mcp@latest"],
    url: "",
    segredos: [],
  },
  {
    nome: "context7",
    descricao: "Documentação atualizada de bibliotecas e programas.",
    tipo: "local",
    comando: "npx",
    argumentos: ["-y", "@upstash/context7-mcp"],
    url: "",
    segredos: [],
  },
  {
    nome: "memoria",
    descricao: "Memória de longo prazo em forma de anotações ligadas.",
    tipo: "local",
    comando: "npx",
    argumentos: ["-y", "@modelcontextprotocol/server-memory"],
    url: "",
    segredos: [],
  },
  {
    nome: "pensamento",
    descricao: "Pensamento passo a passo para problemas difíceis.",
    tipo: "local",
    comando: "npx",
    argumentos: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    url: "",
    segredos: [],
  },
  {
    nome: "arquivos",
    descricao: "Ler e escrever arquivos de uma pasta (troque a pasta depois de instalar).",
    tipo: "local",
    comando: "npx",
    argumentos: ["-y", "@modelcontextprotocol/server-filesystem", "C:\\Users"],
    url: "",
    segredos: [],
  },
];

let editandoMcp: string | null = null;
let editandoSkill: string | null = null;

const slug = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "servidor";

export function montarFerramentas(redesenhar: () => void): HTMLElement {
  const d = ler();
  const instalados = new Set(d.mcps.map((m) => m.nome));
  const mcpAtual = d.mcps.find((m) => m.id === editandoMcp);
  const skillAtual = d.skills.find((s) => s.id === editandoSkill);

  const raiz = html(`
    <div class="pagina">
      <header class="topo-pagina">
        <h1>MCPs e Skills</h1>
        <p class="secundario">Instale uma vez e use com qualquer motor. Em cada conversa ou perfil, ligue só o que precisar.</p>
      </header>

      <section class="secao">
        <p class="titulo-secao">MCPs instalados</p>
        ${
          d.mcps
            .map(
              (m) => `
          <div class="item">
            <div class="coluna">
              <span class="principal">${escapar(m.nome)}</span>
              <span class="secundario">${escapar(m.descricao || (m.tipo === "remoto" ? m.url : [m.comando, ...m.argumentos].join(" ")))}</span>
              ${m.segredos.length ? `<span class="secundario segredos" data-mcp="${m.id}">Chaves: ${m.segredos.map((s) => `<code>${escapar(s)}</code>`).join(" ")}</span>` : ""}
            </div>
            ${m.segredos.length ? `<button type="button" class="botao" data-acao="segredo" data-id="${m.id}">Chaves…</button>` : ""}
            <button type="button" class="botao" data-acao="editar-mcp" data-id="${m.id}">Editar</button>
            <button type="button" class="botao" data-acao="tirar-mcp" data-id="${m.id}">Desinstalar</button>
          </div>
          ${
            m.segredos.length
              ? `<form class="linha form-segredos" data-mcp="${m.id}" hidden>
                  ${m.segredos.map((s) => `<input class="entrada" type="password" name="${escapar(s)}" placeholder="${escapar(s)}" autocomplete="off" aria-label="${escapar(s)}">`).join("")}
                  <button type="submit" class="botao ciano">Guardar no cofre</button>
                </form>`
              : ""
          }`,
            )
            .join("") || '<p class="vazio">Nenhum MCP ainda. Escolha um do catálogo abaixo ou adicione o seu.</p>'
        }
      </section>

      <section class="secao">
        <p class="titulo-secao espaco-acima">Catálogo</p>
        <div class="catalogo">
          ${CATALOGO_MCP.map(
            (m, i) => `
            <div class="cartao-catalogo">
              <span class="principal">${escapar(m.nome)}</span>
              <span class="secundario">${escapar(m.descricao)}</span>
              <button type="button" class="botao ${instalados.has(m.nome) ? "" : "ciano"}" data-acao="instalar" data-i="${i}" ${instalados.has(m.nome) ? "disabled" : ""}>${instalados.has(m.nome) ? "Instalado" : "Instalar"}</button>
            </div>`,
          ).join("")}
        </div>
        <p class="secundario">Os do catálogo usam o Node.js (comando <code>npx</code>). Se ainda não tiver, instale em nodejs.org.</p>
      </section>

      <form class="formulario-projeto form-mcp">
        <p class="titulo-secao">${mcpAtual ? `Editando “${escapar(mcpAtual.nome)}”` : "Adicionar MCP"}</p>
        <div class="linha">
          <label class="campo">Nome<input name="nome" required maxlength="40" value="${escapar(mcpAtual?.nome ?? "")}" placeholder="ex.: github"></label>
          <label class="campo">Tipo<select name="tipo" class="entrada">
            <option value="local" ${mcpAtual?.tipo !== "remoto" ? "selected" : ""}>Local (programa no PC)</option>
            <option value="remoto" ${mcpAtual?.tipo === "remoto" ? "selected" : ""}>Remoto (endereço na internet)</option>
          </select></label>
        </div>
        <label class="campo">Descrição<input name="descricao" maxlength="120" value="${escapar(mcpAtual?.descricao ?? "")}" placeholder="Para que serve"></label>
        <label class="campo so-local">Comando completo<input name="comando" value="${escapar(mcpAtual ? [mcpAtual.comando, ...mcpAtual.argumentos].join(" ") : "")}" placeholder="npx -y @pacote/servidor-mcp"></label>
        <label class="campo so-remoto">Endereço<input name="url" value="${escapar(mcpAtual?.url ?? "")}" placeholder="https://exemplo.com/mcp"></label>
        <label class="campo">Chaves que ele precisa (opcional)<input name="segredos" value="${escapar(mcpAtual?.segredos.join(", ") ?? "")}" placeholder="ex.: GITHUB_TOKEN (o valor fica no cofre do Windows)"></label>
        <div class="linha fim"><span class="espaco"></span>${mcpAtual ? '<button type="button" class="botao" data-acao="cancelar-mcp">Cancelar</button>' : ""}<button type="submit" class="botao ciano">Salvar</button></div>
      </form>

      <section class="secao espaco-acima">
        <p class="titulo-secao">Skills</p>
        <p class="secundario">Uma skill é um conjunto de instruções para um tipo de tarefa (ex.: “revisar texto como editor”, “montar orçamento”). Quando ligada, a IA segue essas instruções.</p>
        <div class="linha"><button type="button" class="botao" data-acao="importar-skills">Importar as skills do Claude Code</button><span class="secundario resposta-importar"></span></div>
        ${
          d.skills
            .map(
              (s) => `
          <div class="item">
            <div class="coluna"><span class="principal">${escapar(s.nome)}</span><span class="secundario">${escapar(s.descricao)}</span></div>
            <button type="button" class="botao" data-acao="editar-skill" data-id="${s.id}">Editar</button>
            <button type="button" class="botao" data-acao="tirar-skill" data-id="${s.id}">Apagar</button>
          </div>`,
            )
            .join("") || '<p class="vazio">Nenhuma skill ainda.</p>'
        }
      </section>

      <form class="formulario-projeto form-skill">
        <p class="titulo-secao">${skillAtual ? `Editando “${escapar(skillAtual.nome)}”` : "Nova skill"}</p>
        <label class="campo">Nome<input name="nome" required maxlength="50" value="${escapar(skillAtual?.nome ?? "")}" placeholder="ex.: Revisor de texto"></label>
        <label class="campo">Quando usar<input name="descricao" required maxlength="200" value="${escapar(skillAtual?.descricao ?? "")}" placeholder="ex.: Quando eu pedir para revisar um capítulo"></label>
        <label class="campo">Instruções<textarea name="instrucoes" rows="6" required placeholder="O passo a passo que a IA deve seguir">${escapar(skillAtual?.instrucoes ?? "")}</textarea></label>
        <div class="linha fim"><span class="espaco"></span>${skillAtual ? '<button type="button" class="botao" data-acao="cancelar-skill">Cancelar</button>' : ""}<button type="submit" class="botao ciano">Salvar</button></div>
      </form>
    </div>`);

  // Local × remoto.
  const formMcp = raiz.querySelector<HTMLFormElement>(".form-mcp")!;
  const tipo = formMcp.querySelector<HTMLSelectElement>('[name="tipo"]')!;
  const mostrarTipo = () => {
    formMcp.querySelector<HTMLElement>(".so-local")!.hidden = tipo.value !== "local";
    formMcp.querySelector<HTMLElement>(".so-remoto")!.hidden = tipo.value !== "remoto";
  };
  tipo.addEventListener("change", mostrarTipo);
  mostrarTipo();

  aoClicar(raiz, "instalar", (b) => {
    const m = CATALOGO_MCP[Number(b.dataset.i)];
    mudar((dd) => dd.mcps.push({ id: novoId(), ...m, argumentos: [...m.argumentos], segredos: [...m.segredos] }));
    redesenhar();
  });
  aoClicar(raiz, "editar-mcp", (b) => {
    editandoMcp = b.dataset.id ?? null;
    redesenhar();
  });
  aoClicar(raiz, "cancelar-mcp", () => {
    editandoMcp = null;
    redesenhar();
  });
  aoClicar(raiz, "tirar-mcp", (b) =>
    confirmarAntes(b, "Desinstalar?", () => {
      mudar((dd) => {
        dd.mcps = dd.mcps.filter((m) => m.id !== b.dataset.id);
        dd.perfis.forEach((p) => (p.mcps = p.mcps.filter((x) => x !== b.dataset.id)));
      });
      redesenhar();
    }),
  );
  aoClicar(raiz, "segredo", (b) => {
    const form = raiz.querySelector<HTMLFormElement>(`.form-segredos[data-mcp="${b.dataset.id}"]`);
    if (form) form.hidden = !form.hidden;
  });
  raiz.querySelectorAll<HTMLFormElement>(".form-segredos").forEach((form) =>
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const m = d.mcps.find((x) => x.id === form.dataset.mcp);
      if (!m) return;
      const pedidos = [...form.querySelectorAll<HTMLInputElement>("input")]
        .filter((i) => i.value.trim())
        .map((i) => salvarSegredoMcp(m.nome, i.name, i.value.trim()));
      Promise.allSettled(pedidos).then(() => redesenhar());
    }),
  );
  // Mostra quais chaves já estão guardadas.
  raiz.querySelectorAll<HTMLElement>(".segredos").forEach((linha) => {
    const m = d.mcps.find((x) => x.id === linha.dataset.mcp);
    if (!m) return;
    Promise.all(m.segredos.map((s) => temSegredoMcp(m.nome, s).catch(() => false))).then((tem) => {
      linha.innerHTML = `Chaves: ${m.segredos.map((s, i) => `<code>${escapar(s)}</code> ${tem[i] ? "guardada" : "<b>falta</b>"}`).join(" · ")}`;
    });
  });

  formMcp.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(formMcp);
    const partes = String(f.get("comando") ?? "").trim().match(/"[^"]*"|\S+/g) ?? [];
    const limpas = partes.map((p) => p.replace(/^"|"$/g, ""));
    const valores: Omit<ServidorMcp, "id"> = {
      nome: slug(String(f.get("nome"))),
      descricao: String(f.get("descricao") ?? "").trim(),
      tipo: f.get("tipo") === "remoto" ? "remoto" : "local",
      comando: limpas[0] ?? "",
      argumentos: limpas.slice(1),
      url: String(f.get("url") ?? "").trim(),
      segredos: String(f.get("segredos") ?? "")
        .split(",")
        .map((s) => s.trim().toUpperCase().replace(/[^A-Z0-9_]/g, ""))
        .filter(Boolean),
    };
    mudar((dd) => {
      const m = dd.mcps.find((x) => x.id === editandoMcp);
      if (m) Object.assign(m, valores);
      else dd.mcps.push({ id: novoId(), ...valores });
    });
    editandoMcp = null;
    redesenhar();
  });

  // Skills já instaladas no Claude Code viram skills da ilha (servem para todas as IAs).
  aoClicar(raiz, "importar-skills", () => {
    const resposta = raiz.querySelector<HTMLElement>(".resposta-importar")!;
    skillsDoClaude()
      .then((lista) => {
        const existentes = new Set(ler().skills.map((s) => s.nome.toLowerCase()));
        const novas = lista.filter((s) => !existentes.has(s.nome.toLowerCase()));
        if (!lista.length) {
          resposta.textContent = "Não achei skills na pasta do Claude Code (.claude\\skills).";
          return;
        }
        if (!novas.length) {
          resposta.textContent = "Todas já estão aqui.";
          return;
        }
        mudar((dd) => novas.forEach((s) => dd.skills.push({ id: novoId(), nome: s.nome, descricao: s.descricao, instrucoes: s.instrucoes })));
        redesenhar();
      })
      .catch((e) => (resposta.textContent = String(e)));
  });

  const formSkill = raiz.querySelector<HTMLFormElement>(".form-skill")!;
  aoClicar(raiz, "editar-skill", (b) => {
    editandoSkill = b.dataset.id ?? null;
    redesenhar();
  });
  aoClicar(raiz, "cancelar-skill", () => {
    editandoSkill = null;
    redesenhar();
  });
  aoClicar(raiz, "tirar-skill", (b) =>
    confirmarAntes(b, "Apagar?", () => {
      mudar((dd) => {
        dd.skills = dd.skills.filter((s) => s.id !== b.dataset.id);
        dd.perfis.forEach((p) => (p.skills = p.skills.filter((x) => x !== b.dataset.id)));
      });
      redesenhar();
    }),
  );
  formSkill.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(formSkill);
    const valores: Omit<Skill, "id"> = {
      nome: String(f.get("nome")).trim(),
      descricao: String(f.get("descricao")).trim(),
      instrucoes: String(f.get("instrucoes")).trim(),
    };
    mudar((dd) => {
      const s = dd.skills.find((x) => x.id === editandoSkill);
      if (s) Object.assign(s, valores);
      else dd.skills.push({ id: novoId(), ...valores });
    });
    editandoSkill = null;
    redesenhar();
  });
  return raiz;
}
