//! A Central: janela grande com menu lateral (conversa, tarefas, notas,
//! ajustes…). A ilha fica para o rápido; a Central, para o resto.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

pub const JANELA_CENTRAL: &str = "central";

/// Tela pedida antes de a janela ficar pronta.
#[derive(Default)]
pub struct TelaPendente(Mutex<Option<String>>);

pub fn abrir(app: &AppHandle, tela: Option<String>) {
    if let Some(j) = app.get_webview_window(JANELA_CENTRAL) {
        let _ = j.unminimize();
        let _ = j.show();
        let _ = j.set_focus();
        if let Some(t) = tela {
            let _ = app.emit_to(JANELA_CENTRAL, "central:tela", t);
        }
        return;
    }
    if let Ok(mut p) = app.state::<TelaPendente>().0.lock() {
        *p = tela;
    }
    let criada = WebviewWindowBuilder::new(app, JANELA_CENTRAL, WebviewUrl::default())
        .title("Ilha · Central")
        .inner_size(1180.0, 780.0)
        .min_inner_size(860.0, 560.0)
        .center()
        .build();
    if let Err(e) = criada {
        log::error!("Não consegui abrir a Central: {e}");
    }
}

#[tauri::command]
pub fn abrir_central(app: AppHandle, tela: Option<String>) {
    abrir(&app, tela);
}

#[tauri::command]
pub fn tela_inicial_central(pendente: State<'_, TelaPendente>) -> Option<String> {
    pendente.0.lock().ok().and_then(|mut p| p.take())
}
