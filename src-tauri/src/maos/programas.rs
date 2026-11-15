//! Abrir programas, arquivos e sites (lançador de apps).

use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub fn abrir_programa(app: AppHandle, caminho: String) -> Result<(), String> {
    let caminho = caminho.trim();
    let resultado = if caminho.starts_with("http://") || caminho.starts_with("https://") {
        app.opener().open_url(caminho, None::<&str>)
    } else {
        app.opener().open_path(caminho, None::<&str>)
    };
    resultado.map_err(|erro| {
        log::warn!("Não consegui abrir {caminho}: {erro}");
        "Não consegui abrir. Confira se o programa ainda está nesse lugar.".to_string()
    })
}

/// Abre a pasta onde a ilha anota os erros.
#[tauri::command]
pub fn abrir_registros(app: AppHandle) -> Result<(), String> {
    let pasta = app.path().app_log_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&pasta).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(pasta.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}
