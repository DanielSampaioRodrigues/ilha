//! Documentos: ler o texto de arquivos do Word/LibreOffice (para a IA) e
//! salvar uma resposta da IA como documento do Word (.docx), já formatado
//! no jeito de trabalho de faculdade (A4, margens da ABNT, Arial 12,
//! espaço 1,5; títulos de verdade, que aparecem no "Painel de navegação").
//! Nada é sobrescrito: o arquivo novo sempre ganha um nome livre.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

/// Texto de um .docx ou .odt (os dois são um zip com um XML dentro).
pub fn texto_de_documento(caminho: &Path) -> Option<Result<String, String>> {
    let ext = caminho.extension()?.to_string_lossy().to_lowercase();
    let (parte, fim_de_paragrafo) = match ext.as_str() {
        "docx" => ("word/document.xml", "</w:p>"),
        "odt" => ("content.xml", "</text:p>"),
        _ => return None,
    };
    let nome = caminho.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let ler = || -> Result<String, String> {
        let f = std::fs::File::open(caminho).map_err(|_| format!("Não consegui abrir {nome}."))?;
        let mut zip = zip::ZipArchive::new(f).map_err(|_| format!("{nome} não parece um documento válido."))?;
        let mut xml = String::new();
        zip.by_name(parte)
            .map_err(|_| format!("{nome} não parece um documento válido."))?
            .read_to_string(&mut xml)
            .map_err(|_| format!("Não consegui ler {nome}."))?;
        Ok(texto_do_xml(&xml, fim_de_paragrafo))
    };
    Some(ler())
}

/// Tira as marcações do XML: fim de parágrafo vira quebra de linha, tabulação vira espaço.
fn texto_do_xml(xml: &str, fim_de_paragrafo: &str) -> String {
    let xml = xml
        .replace(fim_de_paragrafo, "\n")
        .replace("<w:tab/>", "\t")
        .replace("<w:br/>", "\n")
        .replace("<text:tab/>", "\t")
        .replace("<text:line-break/>", "\n");
    let mut texto = String::with_capacity(xml.len() / 3);
    let mut dentro = false;
    for c in xml.chars() {
        match c {
            '<' => dentro = true,
            '>' => dentro = false,
            _ if !dentro => texto.push(c),
            _ => {}
        }
    }
    let texto = texto
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&");
    // Sem um monte de linhas vazias seguidas.
    let mut limpo = String::new();
    let mut vazias = 0;
    for linha in texto.lines() {
        if linha.trim().is_empty() {
            vazias += 1;
            if vazias > 1 {
                continue;
            }
        } else {
            vazias = 0;
        }
        limpo.push_str(linha.trim_end());
        limpo.push('\n');
    }
    limpo.trim().to_string()
}

fn escapar(t: &str) -> String {
    t.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Pedaços de uma linha com **negrito** e *itálico*.
fn trechos(linha: &str) -> String {
    let linha = linha.replace('`', "");
    let mut saida = String::new();
    let mut negrito = false;
    let mut italico = false;
    let mut atual = String::new();
    let soltar = |atual: &mut String, saida: &mut String, negrito: bool, italico: bool| {
        if atual.is_empty() {
            return;
        }
        let estilo = format!("{}{}", if negrito { "<w:b/>" } else { "" }, if italico { "<w:i/>" } else { "" });
        let rpr = if estilo.is_empty() { String::new() } else { format!("<w:rPr>{estilo}</w:rPr>") };
        saida.push_str(&format!(r#"<w:r>{rpr}<w:t xml:space="preserve">{}</w:t></w:r>"#, escapar(atual)));
        atual.clear();
    };
    let chars: Vec<char> = linha.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '*' && chars.get(i + 1) == Some(&'*') {
            soltar(&mut atual, &mut saida, negrito, italico);
            negrito = !negrito;
            i += 2;
            continue;
        }
        // *itálico* (um asterisco colado numa palavra, não "2 * 3").
        if chars[i] == '*' && chars.get(i + 1).is_some_and(|c| !c.is_whitespace()) && !italico
            || chars[i] == '*' && italico && i > 0 && !chars[i - 1].is_whitespace()
        {
            soltar(&mut atual, &mut saida, negrito, italico);
            italico = !italico;
            i += 1;
            continue;
        }
        atual.push(chars[i]);
        i += 1;
    }
    soltar(&mut atual, &mut saida, negrito, italico);
    saida
}

/// O texto da IA (markdown simples) virando parágrafos do Word.
fn corpo_do_word(texto: &str) -> String {
    let mut corpo = String::new();
    for linha in texto.lines() {
        let t = linha.trim();
        if t.is_empty() || t.chars().all(|c| matches!(c, '-' | '|' | ':' | ' ' | '=' | '*' | '_')) {
            continue;
        }
        let nivel = t.chars().take_while(|c| *c == '#').count();
        let (ppr, conteudo) = if (1..=6).contains(&nivel) {
            let estilo = format!("Titulo{}", nivel.min(3));
            (format!(r#"<w:pPr><w:pStyle w:val="{estilo}"/></w:pPr>"#), t[nivel..].trim().to_string())
        } else if let Some(resto) = t.strip_prefix("- ").or_else(|| t.strip_prefix("* ")).or_else(|| t.strip_prefix("• ")) {
            let recuo = if linha.starts_with("  ") || linha.starts_with('\t') { 1080 } else { 540 };
            (format!(r#"<w:pPr><w:spacing w:after="60"/><w:ind w:left="{recuo}" w:hanging="270"/></w:pPr>"#), format!("•\t{resto}"))
        } else if let Some(resto) = t.strip_prefix("> ") {
            (r#"<w:pPr><w:ind w:left="2268"/><w:spacing w:line="240" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr>"#.to_string(), format!("*{}*", resto.trim()))
        } else if t.split_once(". ").is_some_and(|(n, _)| !n.is_empty() && n.len() <= 3 && n.chars().all(|c| c.is_ascii_digit())) {
            (r#"<w:pPr><w:spacing w:after="60"/><w:ind w:left="540" w:hanging="360"/></w:pPr>"#.to_string(), t.replacen(". ", ".\t", 1))
        } else if t.starts_with('|') {
            // Linha de tabela: vira texto separado por " | ".
            let celulas: Vec<&str> = t.trim_matches('|').split('|').map(str::trim).collect();
            (r#"<w:pPr><w:jc w:val="left"/></w:pPr>"#.to_string(), celulas.join("  |  "))
        } else {
            (r#"<w:pPr><w:jc w:val="both"/><w:ind w:firstLine="709"/></w:pPr>"#.to_string(), t.to_string())
        };
        corpo.push_str(&format!("<w:p>{ppr}{}</w:p>", trechos(&conteudo)));
    }
    corpo
}

const W: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

fn estilos() -> String {
    let titulo = |id: &str, nome: &str, tamanho: u32, nivel: u32| {
        format!(
            r#"<w:style w:type="paragraph" w:styleId="{id}"><w:name w:val="{nome}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="{nivel}"/></w:pPr><w:rPr><w:b/><w:sz w:val="{tamanho}"/><w:szCs w:val="{tamanho}"/></w:rPr></w:style>"#
        )
    };
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>{}{}{}</w:styles>"#,
        titulo("Titulo1", "heading 1", 28, 0),
        titulo("Titulo2", "heading 2", 26, 1),
        titulo("Titulo3", "heading 3", 24, 2),
    )
}

/// Monta o .docx inteiro (um zip) a partir do texto.
pub fn montar_docx(texto: &str) -> Result<Vec<u8>, String> {
    let documento = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="{W}"><w:body>{}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1701" w:right="1134" w:bottom="1134" w:left="1701" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>"#,
        corpo_do_word(texto)
    );
    let partes: [(&str, String); 5] = [
        (
            "[Content_Types].xml",
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>"#.to_string(),
        ),
        (
            "_rels/.rels",
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#.to_string(),
        ),
        (
            "word/_rels/document.xml.rels",
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>"#.to_string(),
        ),
        ("word/styles.xml", estilos()),
        ("word/document.xml", documento),
    ];
    let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let opcoes = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for (nome, conteudo) in partes {
        zip.start_file(nome, opcoes).map_err(|e| e.to_string())?;
        zip.write_all(conteudo.as_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(zip.finish().map_err(|e| e.to_string())?.into_inner())
}

/// Um nome de arquivo seguro a partir do título.
fn nome_seguro(titulo: &str) -> String {
    let nome: String = titulo
        .chars()
        .map(|c| if "\\/:*?\"<>|".contains(c) || c.is_control() { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let nome: String = nome.chars().take(80).collect();
    if nome.trim().is_empty() { "Documento da ilha".into() } else { nome.trim_end_matches('.').to_string() }
}

/// Salva o texto como .docx (em Documentos\Ilha, ou ao lado de `junto_de`) e abre no Word.
#[tauri::command]
pub async fn salvar_word(app: AppHandle, texto: String, titulo: String, junto_de: Option<String>) -> Result<String, String> {
    if texto.trim().is_empty() {
        return Err("Não tem texto para salvar.".into());
    }
    let pasta: PathBuf = match junto_de.as_deref().map(Path::new).and_then(Path::parent).filter(|p| p.is_dir()) {
        Some(p) => p.to_path_buf(),
        None => app.path().document_dir().map_err(|e| e.to_string())?.join("Ilha"),
    };
    std::fs::create_dir_all(&pasta).map_err(|_| "Não consegui criar a pasta para salvar.".to_string())?;
    let destino = super::arquivos::livre(&pasta, &nome_seguro(&titulo), "docx");
    let bytes = montar_docx(&texto)?;
    std::fs::write(&destino, bytes).map_err(|_| "Não consegui gravar o documento.".to_string())?;
    let caminho = destino.to_string_lossy().to_string();
    let _ = app.opener().open_path(&caminho, None::<&str>);
    Ok(caminho)
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn xml_vira_texto() {
        let xml = r#"<w:body><w:p><w:r><w:t>Olá &amp; até</w:t></w:r></w:p><w:p></w:p><w:p></w:p><w:p><w:r><w:t>Fim</w:t><w:tab/><w:t>x</w:t></w:r></w:p></w:body>"#;
        assert_eq!(texto_do_xml(xml, "</w:p>"), "Olá & até\n\nFim\tx");
    }

    #[test]
    fn negrito_e_italico() {
        let t = trechos("um **forte** e *leve* 2 * 3");
        assert!(t.contains(r#"<w:rPr><w:b/></w:rPr><w:t xml:space="preserve">forte</w:t>"#), "{t}");
        assert!(t.contains(r#"<w:rPr><w:i/></w:rPr><w:t xml:space="preserve">leve</w:t>"#), "{t}");
        assert!(t.contains("2 * 3"), "{t}");
    }

    #[test]
    fn gera_docx() {
        let texto = "# Fichamento\n\n**Referência:** SILVA, J. *Livro*. 2020.\n\n## Ideia central\nTexto com <sinal> & coisa.\n- tópico um\n  - sub\n1. primeiro\n> citação\n| a | b |\n|---|---|\n| 1 | 2 |";
        let bytes = montar_docx(texto).unwrap();
        let destino = std::env::temp_dir().join("ilha-teste.docx");
        std::fs::write(&destino, &bytes).unwrap();
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        let mut doc = String::new();
        zip.by_name("word/document.xml").unwrap().read_to_string(&mut doc).unwrap();
        assert!(doc.contains("Titulo1") && doc.contains("&lt;sinal&gt; &amp; coisa"));
        // E o texto dele volta certinho.
        let lido = texto_de_documento(&destino).unwrap().unwrap();
        assert!(lido.contains("Ideia central") && lido.contains("tópico um"), "{lido}");
    }
}
