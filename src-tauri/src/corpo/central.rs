//! A Central: janela grande com menu lateral (conversa, tarefas, notas,
//! ajustes…). A ilha fica para o rápido; a Central, para o resto.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

pub const JANELA_CENTRAL: &str = "central";

/// O que foi pedido antes de a janela ficar pronta (tela e arquivos para anexar).
#[derive(Default, Clone, serde::Serialize)]
pub struct Pedido {
    pub tela: Option<String>,
    pub anexos: Vec<String>,
}

#[derive(Default)]
pub struct TelaPendente(Mutex<Option<Pedido>>);

pub fn abrir(app: &AppHandle, tela: Option<String>) {
    abrir_com(app, tela, Vec::new());
}

pub fn abrir_com(app: &AppHandle, tela: Option<String>, anexos: Vec<String>) {
    if let Some(j) = app.get_webview_window(JANELA_CENTRAL) {
        let _ = j.unminimize();
        let _ = j.show();
        let _ = j.set_focus();
        if let Some(t) = tela {
            let _ = app.emit_to(JANELA_CENTRAL, "central:tela", t);
        }
        if !anexos.is_empty() {
            let _ = app.emit_to(JANELA_CENTRAL, "central:anexar", anexos);
        }
        return;
    }
    if let Ok(mut p) = app.state::<TelaPendente>().0.lock() {
        *p = Some(Pedido { tela, anexos });
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

/// Precisa ser "async": no Windows, criar janela dentro de um comando comum
/// trava o programa (a janela fica branca e nem fecha).
#[tauri::command]
pub async fn abrir_central(app: AppHandle, tela: Option<String>, anexos: Option<Vec<String>>) {
    abrir_com(&app, tela, anexos.unwrap_or_default());
}

/// A Central, ao abrir, pergunta o que foi pedido (tela e anexos).
#[tauri::command]
pub fn tela_inicial_central(pendente: State<'_, TelaPendente>) -> Pedido {
    pendente.0.lock().ok().and_then(|mut p| p.take()).unwrap_or_default()
}
