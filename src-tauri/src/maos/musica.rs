//! Pedir música pelo nome ("toca Djavan"). Sem conta de desenvolvedor em
//! nenhum serviço: no YouTube / YouTube Music a ilha acha o primeiro vídeo da
//! busca (lendo a página de resultados, como o navegador faz) e abre já tocando;
//! no Spotify e no Deezer abre a busca no aplicativo/site; no Apple Music acha
//! a música exata (pela busca pública da Apple, sem conta) e abre a página dela
//! no aplicativo, se estiver instalado, ou no site.

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

/// A música achada no Apple Music.
#[derive(serde::Serialize)]
pub struct MusicaApple {
    /// Endereço para abrir: no aplicativo, se ele estiver instalado; senão o do site.
    link: String,
    site: String,
    nome: String,
    artista: String,
    no_app: bool,
}

/// Procura a música na busca pública da Apple (a mesma do iTunes, sem chave).
#[tauri::command]
pub async fn musica_apple(busca: String) -> Result<Option<MusicaApple>, String> {
    let busca = busca.trim();
    if busca.is_empty() {
        return Ok(None);
    }
    let cliente = reqwest::Client::builder().timeout(Duration::from_secs(12)).build().map_err(|e| e.to_string())?;
    let endereco = reqwest::Url::parse_with_params(
        "https://itunes.apple.com/search",
        &[("term", busca), ("country", "BR"), ("media", "music"), ("entity", "song"), ("limit", "1")],
    )
    .map_err(|e| e.to_string())?;
    let v: serde_json::Value = cliente
        .get(endereco)
        .send()
        .await
        .map_err(|e| format!("Sem conexão com a Apple: {e}"))?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let Some(m) = v["results"].get(0) else { return Ok(None) };
    let Some(site) = m["trackViewUrl"].as_str().filter(|u| u.starts_with("https://music.apple.com/")) else {
        return Ok(None);
    };
    let protocolo = protocolo_do_app();
    let link = match protocolo {
        Some(p) => format!("{p}://{}", &site["https://".len()..]),
        None => site.to_string(),
    };
    Ok(Some(MusicaApple {
        link,
        site: site.to_string(),
        nome: m["trackName"].as_str().unwrap_or(busca).to_string(),
        artista: m["artistName"].as_str().unwrap_or_default().to_string(),
        no_app: protocolo.is_some(),
    }))
}

/// O jeito de abrir um link direto no aplicativo Apple Music (ou iTunes), se instalado.
#[cfg(windows)]
fn protocolo_do_app() -> Option<&'static str> {
    use windows::core::HSTRING;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_CLASSES_ROOT, RRF_RT_ANY};
    ["music", "itmss"].into_iter().find(|p| unsafe {
        RegGetValueW(HKEY_CLASSES_ROOT, &HSTRING::from(*p), &HSTRING::from("URL Protocol"), RRF_RT_ANY, None, None, None).is_ok()
    })
}

#[cfg(not(windows))]
fn protocolo_do_app() -> Option<&'static str> {
    None
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
