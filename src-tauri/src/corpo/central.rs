//! A Central ("ilha grande"): a ilha cresce do topo da tela num painel largo
//! com menu lateral (conversa, perfis, tarefas, notas, ajustes…). Não é uma
//! janela comum: sem moldura, sem aparecer na barra de tarefas, presa no topo.
//! Ao fechar ela só se esconde (as conversas continuam rodando por trás).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

pub const JANELA_CENTRAL: &str = "central";

/// O que foi pedido antes de a janela ficar pronta (tela e arquivos para anexar).
#[derive(Default, Clone, serde::Serialize)]
pub struct Pedido {
    pub tela: Option<String>,
    pub anexos: Vec<String>,
    /// Conversa rápida da ilha que vai continuar na Central.
    pub conversa: Option<serde_json::Value>,
}

#[derive(Default)]
pub struct TelaPendente(Mutex<Option<Pedido>>);

/// A Central está solta, como janela comum (o Dan escolhe; dá para juntar de volta).
static MODO_JANELA: AtomicBool = AtomicBool::new(false);

pub fn abrir(app: &AppHandle, tela: Option<String>) {
    abrir_com(app, tela, Vec::new(), None);
}

pub fn abrir_com(app: &AppHandle, tela: Option<String>, anexos: Vec<String>, conversa: Option<serde_json::Value>) {
    if let Some(j) = app.get_webview_window(JANELA_CENTRAL) {
        if !MODO_JANELA.load(Ordering::Relaxed) {
            posicionar(app, &j);
        }
        let _ = j.unminimize();
        let _ = j.show();
        let _ = j.set_focus();
        let _ = app.emit_to(JANELA_CENTRAL, "central:abrir", ());
        if let Some(t) = tela {
            let _ = app.emit_to(JANELA_CENTRAL, "central:tela", t);
        }
        if !anexos.is_empty() {
            let _ = app.emit_to(JANELA_CENTRAL, "central:anexar", anexos);
        }
        if let Some(c) = conversa {
            let _ = app.emit_to(JANELA_CENTRAL, "central:importar", c);
        }
        return;
    }
    if let Ok(mut p) = app.state::<TelaPendente>().0.lock() {
        *p = Some(Pedido { tela, anexos, conversa });
    }
    let criada = WebviewWindowBuilder::new(app, JANELA_CENTRAL, WebviewUrl::default())
        .title("Ilha")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .inner_size(1180.0, 780.0)
        .build();
    match criada {
        Ok(j) => {
            posicionar(app, &j);
            let _ = j.set_focus();
        }
        Err(e) => log::error!("Não consegui abrir a Central: {e}"),
    }
}

/// Tamanho e lugar: no topo, centralizada, na tela principal (onde mora a ilha),
/// deixando a barra de tarefas livre.
fn posicionar(app: &AppHandle, j: &tauri::WebviewWindow) {
    let Ok(Some(tela)) = app.primary_monitor() else { return };
    let escala = tela.scale_factor();
    let area = tela.work_area();
    let (largura_tela, altura_tela) = (area.size.width as f64 / escala, area.size.height as f64 / escala);
    let largura = (largura_tela - 80.0).clamp(760.0, 1240.0);
    let altura = (altura_tela - 40.0).clamp(520.0, 840.0);
    let _ = j.set_size(tauri::LogicalSize::new(largura, altura));
    let x = area.position.x as f64 / escala + (largura_tela - largura) / 2.0;
    let y = tela.position().y as f64 / escala;
    let _ = j.set_position(tauri::LogicalPosition::new(x, y));
}

/// Solta a Central como janela comum (com moldura, na barra de tarefas, sem
/// ficar por cima de tudo) ou junta de volta como ilha grande. É a mesma
/// janela: as conversas em andamento continuam.
#[tauri::command]
pub fn modo_central(app: AppHandle, janela: bool) {
    let Some(j) = app.get_webview_window(JANELA_CENTRAL) else { return };
    let antes = MODO_JANELA.swap(janela, Ordering::Relaxed);
    if janela {
        let _ = j.set_always_on_top(false);
        let _ = j.set_decorations(true);
        let _ = j.set_shadow(true);
        let _ = j.set_resizable(true);
        let _ = j.set_skip_taskbar(false);
        let _ = j.set_title("Ilha · Central");
        let _ = j.set_min_size(Some(tauri::LogicalSize::new(860.0, 560.0)));
        if !antes {
            let _ = j.set_size(tauri::LogicalSize::new(1180.0, 780.0));
            let _ = j.center();
        }
    } else {
        let _ = j.set_min_size(None::<tauri::LogicalSize<f64>>);
        let _ = j.set_decorations(false);
        let _ = j.set_shadow(false);
        let _ = j.set_resizable(false);
        let _ = j.set_skip_taskbar(true);
        let _ = j.set_always_on_top(true);
        let _ = j.set_title("Ilha");
        posicionar(&app, &j);
    }
    let _ = j.set_focus();
}

#[tauri::command]
pub fn esconder_central(app: AppHandle) {
    if let Some(j) = app.get_webview_window(JANELA_CENTRAL) {
        let _ = j.hide();
    }
}

/// Precisa ser "async": no Windows, criar janela dentro de um comando comum
/// trava o programa (a janela fica branca e nem fecha).
#[tauri::command]
pub async fn abrir_central(
    app: AppHandle,
    tela: Option<String>,
    anexos: Option<Vec<String>>,
    conversa: Option<serde_json::Value>,
) {
    abrir_com(&app, tela, anexos.unwrap_or_default(), conversa);
}

/// A Central, ao abrir, pergunta o que foi pedido (tela e anexos).
#[tauri::command]
pub fn tela_inicial_central(pendente: State<'_, TelaPendente>) -> Pedido {
    pendente.0.lock().ok().and_then(|mut p| p.take()).unwrap_or_default()
}
