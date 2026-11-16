//! Passeio: o personagem sai da ilha e anda pela tela (em cima de tudo, mas
//! sem pegar o clique — dá para continuar usando o computador). No fim, volta
//! para a ilha e a janela do passeio fecha.

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const JANELA_PASSEIO: &str = "passeio";

/// Começa um passeio (se já não houver um). Precisa ser "async": criar janela
/// num comando comum trava no Windows.
#[tauri::command]
pub async fn passear(app: AppHandle) -> Result<(), String> {
    if app.get_webview_window(JANELA_PASSEIO).is_some() {
        return Ok(());
    }
    let tela = app.primary_monitor().map_err(|e| e.to_string())?.ok_or("Sem tela.")?;
    let escala = tela.scale_factor();
    let area = tela.work_area();
    let janela = WebviewWindowBuilder::new(&app, JANELA_PASSEIO, WebviewUrl::default())
        .title("Ilha · passeio")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .inner_size(area.size.width as f64 / escala, area.size.height as f64 / escala)
        .position(area.position.x as f64 / escala, area.position.y as f64 / escala)
        .build()
        .map_err(|e| e.to_string())?;
    // O clique passa direto: é só para ver.
    let _ = janela.set_ignore_cursor_events(true);
    let _ = app.emit("ilha:passeio", true);
    Ok(())
}

/// O personagem voltou para a ilha.
#[tauri::command]
pub async fn fim_passeio(app: AppHandle) {
    let _ = app.emit("ilha:passeio", false);
    if let Some(j) = app.get_webview_window(JANELA_PASSEIO) {
        let _ = j.close();
    }
}
