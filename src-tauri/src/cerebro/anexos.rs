//! Arquivos anexados à conversa.
//! - Programas (Claude Code, Codex, Gemini): recebem o caminho do arquivo e
//!   abrem eles mesmos, sem limite de tamanho (o Gemini usa "@caminho"; o Codex
//!   recebe imagens com "-i").
//! - DeepSeek (API): o texto do arquivo vai junto da mensagem; PDF vira texto;
//!   arquivos grandes são cortados (com aviso). Imagens só o modelo
//!   deepseek-flash lê (vão como imagem, não como texto).

use std::path::Path;

const LIMITE_CARACTERES: usize = 60_000;

const IMAGENS: [&str; 6] = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];

pub fn eh_imagem(caminho: &str) -> bool {
    Path::new(caminho)
        .extension()
        .map(|e| IMAGENS.contains(&e.to_string_lossy().to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Texto que vai junto do pedido para os programas.
pub fn para_programa(motor: &str, prompt: &str, anexos: &[String]) -> String {
    if anexos.is_empty() {
        return prompt.to_string();
    }
    let lista = anexos
        .iter()
        .map(|a| if motor == "gemini" { format!("- @{}", a.replace('\\', "/")) } else { format!("- {a}") })
        .collect::<Vec<_>>()
        .join("\n");
    format!("{prompt}\n\nArquivos anexados (abra e leia o que for preciso):\n{lista}")
}

/// Para a DeepSeek: junta o conteúdo dos arquivos à mensagem e devolve as
/// imagens à parte (como "data:image/...;base64,...").
pub fn para_api(prompt: &str, anexos: &[String], le_imagens: bool) -> Result<(String, Vec<String>), String> {
    use base64::Engine;
    let mut texto = String::from(prompt);
    let mut imagens = Vec::new();
    for caminho in anexos {
        let nome = Path::new(caminho).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        if eh_imagem(caminho) {
            if !le_imagens {
                return Err(format!(
                    "Este modelo da DeepSeek não lê imagens ({nome}). Troque para o deepseek-flash ou use o Claude Code ou o Codex."
                ));
            }
            let bytes = std::fs::read(caminho).map_err(|_| format!("Não consegui abrir {nome}."))?;
            if bytes.len() > 10 * 1024 * 1024 {
                return Err(format!("A imagem {nome} passa de 10 MB."));
            }
            let ext = Path::new(caminho).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
            let tipo = match ext.as_str() {
                "jpg" | "jpeg" => "jpeg",
                outro => outro,
            };
            imagens.push(format!("data:image/{tipo};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)));
            continue;
        }
        let conteudo = if caminho.to_lowercase().ends_with(".pdf") {
            pdf_extract::extract_text(caminho).map_err(|_| format!("Não consegui ler o PDF {nome}."))?
        } else {
            let bytes = std::fs::read(caminho).map_err(|_| format!("Não consegui abrir {nome}."))?;
            String::from_utf8(bytes).map_err(|_| format!("{nome} não é um arquivo de texto. Para ele, use o Claude Code, o Codex ou o Gemini."))?
        };
        let cortado = conteudo.chars().count() > LIMITE_CARACTERES;
        let trecho: String = conteudo.chars().take(LIMITE_CARACTERES).collect();
        texto.push_str(&format!(
            "\n\n--- Arquivo anexado: {nome}{} ---\n{trecho}\n--- fim de {nome} ---",
            if cortado { " (muito grande: só o começo foi enviado)" } else { "" }
        ));
    }
    Ok((texto, imagens))
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn anexos_viram_texto_certo() {
        let a = vec!["C:\\Livro\\cap1.md".to_string(), "C:\\Fotos\\capa.png".to_string()];
        let g = para_programa("gemini", "Revise", &a);
        assert!(g.contains("@C:/Livro/cap1.md"));
        let c = para_programa("claude", "Revise", &a);
        assert!(c.contains("- C:\\Livro\\cap1.md"));
        assert!(eh_imagem("x.PNG") && !eh_imagem("x.pdf"));
        assert!(para_api("oi", &["a.jpg".into()], false).is_err());
        assert_eq!(para_api("oi", &[], true).unwrap().0, "oi");
    }
}
