//! Pedir música pelo nome ("toca Djavan"). Sem conta de desenvolvedor em
//! nenhum serviço: no YouTube / YouTube Music a ilha acha o primeiro vídeo da
//! busca (lendo a página de resultados, como o navegador faz) e abre já tocando;
//! no Spotify e no Deezer abre a busca no aplicativo/site.

use std::time::Duration;

/// O primeiro vídeo da busca no YouTube (o id de 11 letras), se achar.
#[tauri::command]
pub async fn primeiro_video(busca: String) -> Result<Option<String>, String> {
    let busca = busca.trim();
    if busca.is_empty() {
        return Ok(None);
    }
    let cliente = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;
    let endereco = reqwest::Url::parse_with_params("https://www.youtube.com/results", &[("search_query", busca)]).map_err(|e| e.to_string())?;
    let pagina = cliente
        .get(endereco)
        .header("Accept-Language", "pt-BR,pt;q=0.9")
        .send()
        .await
        .map_err(|e| format!("Sem conexão com o YouTube: {e}"))?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    Ok(primeiro_id(&pagina))
}

fn primeiro_id(pagina: &str) -> Option<String> {
    let marca = "\"videoId\":\"";
    let mut resto = pagina;
    while let Some(i) = resto.find(marca) {
        let depois = &resto[i + marca.len()..];
        let id: String = depois.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
        if id.len() == 11 && depois[id.len()..].starts_with('"') {
            return Some(id);
        }
        resto = depois;
    }
    None
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn acha_o_primeiro_video() {
        let p = r#"{"x":1,"videoId":"curto","a":{"videoId":"dQw4w9WgXcQ","b":"videoId":"zzzzzzzzzzz"}"#;
        assert_eq!(primeiro_id(p).as_deref(), Some("dQw4w9WgXcQ"));
        assert_eq!(primeiro_id("nada aqui"), None);
    }
}
