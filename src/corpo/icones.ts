// Ícones de traço (mesmos do rascunho visual).

const icone = (tamanho: number, conteudo: string) =>
  `<svg width="${tamanho}" height="${tamanho}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${conteudo}</svg>`;

export const ICONES = {
  teclado: icone(18, '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>'),
  microfone: icone(18, '<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
  certo: icone(18, '<path d="m5 12 5 5L20 7"/>'),
  musica: icone(20, '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>'),
  anterior: icone(18, '<path d="M19 5 9 12l10 7zM5 5v14"/>'),
  pausar: icone(18, '<path d="M8 5v14M16 5v14"/>'),
  tocar: icone(18, '<path d="M7 5v14l12-7z"/>'),
  proxima: icone(18, '<path d="m5 5 10 7-10 7zM19 5v14"/>'),
  mais: icone(18, '<path d="M12 5v14M5 12h14"/>'),
  notas: icone(16, '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>'),
  cartao: icone(16, '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>'),
  relogio: icone(16, '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>'),
  lixeira: icone(16, '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>'),
  lapis: icone(16, '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  tabela: icone(16, '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/>'),
  renovar: icone(16, '<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>'),
  tarefas: icone(16, '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m8 12 3 3 5-6"/>'),
  timer: icone(16, '<circle cx="12" cy="14" r="7"/><path d="M12 10v4M10 2h4M19 7l1.5-1.5"/>'),
  habitos: icone(16, '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>'),
  textos: icone(16, '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6"/>'),
  pc: icone(16, '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'),
  ajustes: icone(16, '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>'),
  som: icone(18, '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>'),
  mudo: icone(18, '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="m17 9 5 6M22 9l-5 6"/>'),
  copiar: icone(16, '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>'),
  traduzir: icone(18, '<path d="M4 5h9M8.5 3v2M6 5c.5 3 3 6 6 7.5M11 5c-.8 3.5-3.5 6.5-7 8"/><path d="m12 21 4.5-10 4.5 10M13.8 17h5.4"/>'),
  chave: icone(16, '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3M17 6l3 3M14 9l2 2"/>'),
  arquivo: icone(14, '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/>'),
};
