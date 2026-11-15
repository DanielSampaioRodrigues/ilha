//! Música e vídeo tocando no Windows (Apple Music, Spotify, navegador…),
//! pelos controles de mídia do próprio Windows: nome, artista, capa e
//! tocar/pausar/pular.

use serde::Serialize;

#[derive(Serialize)]
pub struct Midia {
    pub titulo: String,
    pub artista: String,
    pub tocando: bool,
    /// Capa como imagem embutida (data:image/...;base64,...), só quando pedida.
    pub capa: Option<String>,
}

#[tauri::command]
pub async fn midia_atual(com_capa: bool) -> Option<Midia> {
    tauri::async_runtime::spawn_blocking(move || sistema::ler(com_capa))
        .await
        .ok()
        .flatten()
}

#[tauri::command]
pub async fn midia_comando(acao: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || sistema::comando(&acao))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(windows)]
mod sistema {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Sessao,
        GlobalSystemMediaTransportControlsSessionManager as Gerenciador,
        GlobalSystemMediaTransportControlsSessionMediaProperties as Propriedades,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Situacao,
    };
    use windows::Storage::Streams::DataReader;

    use super::Midia;

    fn sessao() -> windows::core::Result<Sessao> {
        Gerenciador::RequestAsync()?.join()?.GetCurrentSession()
    }

    pub fn ler(com_capa: bool) -> Option<Midia> {
        let sessao = sessao().ok()?;
        let propriedades = sessao.TryGetMediaPropertiesAsync().ok()?.join().ok()?;
        let titulo = propriedades.Title().map(|t| t.to_string()).unwrap_or_default();
        if titulo.is_empty() {
            return None;
        }
        let tocando = sessao
            .GetPlaybackInfo()
            .and_then(|info| info.PlaybackStatus())
            .map(|s| s == Situacao::Playing)
            .unwrap_or(false);
        Some(Midia {
            titulo,
            artista: propriedades.Artist().map(|a| a.to_string()).unwrap_or_default(),
            tocando,
            capa: if com_capa { capa(&propriedades) } else { None },
        })
    }

    fn capa(propriedades: &Propriedades) -> Option<String> {
        let fluxo = propriedades.Thumbnail().ok()?.OpenReadAsync().ok()?.join().ok()?;
        let tamanho = u32::try_from(fluxo.Size().ok()?).ok()?;
        if tamanho == 0 || tamanho > 5_000_000 {
            return None;
        }
        let tipo = fluxo.ContentType().map(|t| t.to_string()).unwrap_or_default();
        let leitor = DataReader::CreateDataReader(&fluxo).ok()?;
        leitor.LoadAsync(tamanho).ok()?.join().ok()?;
        let mut bytes = vec![0u8; tamanho as usize];
        leitor.ReadBytes(&mut bytes).ok()?;
        let tipo = if tipo.starts_with("image/") { tipo } else { "image/png".into() };
        Some(format!("data:{tipo};base64,{}", STANDARD.encode(bytes)))
    }

    pub fn comando(acao: &str) -> Result<(), String> {
        let sessao = sessao().map_err(|_| "Nada tocando agora.".to_string())?;
        let pedido = match acao {
            "alternar" => sessao.TryTogglePlayPauseAsync(),
            "proxima" => sessao.TrySkipNextAsync(),
            "anterior" => sessao.TrySkipPreviousAsync(),
            _ => return Err("Comando desconhecido.".into()),
        };
        pedido.and_then(|p| p.join()).map(|_| ()).map_err(|e| e.to_string())
    }
}

#[cfg(not(windows))]
mod sistema {
    use super::Midia;

    pub fn ler(_com_capa: bool) -> Option<Midia> {
        None
    }

    pub fn comando(_acao: &str) -> Result<(), String> {
        Err("Só funciona no Windows.".into())
    }
}
