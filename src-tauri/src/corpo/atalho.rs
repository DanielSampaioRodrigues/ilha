//! Atalho de teclado global que abre e fecha a ilha.
//!
//! O padrão é Win+Alt+I ("I" de Ilha): combinações com a tecla Windows quase
//! nunca são usadas por outros programas. Se o Windows ou outro programa já
//! usar, tentamos as próximas da lista. O Dan pode trocar em Ajustes.

use std::sync::Mutex;

use tauri::{AppHandle, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use super::janela;

pub const PADROES: [&str; 3] = ["Super+Alt+I", "Super+Alt+Space", "Ctrl+Shift+Space"];

#[derive(Default)]
pub struct AtalhoAtual(Mutex<Option<String>>);

fn registrar(app: &AppHandle, atalho: &str) -> Result<(), String> {
    app.global_shortcut()
        .on_shortcut(atalho, |app, _atalho, evento| {
            if evento.state == ShortcutState::Pressed {
                janela::alternar(app);
            }
        })
        .map_err(|e| e.to_string())
}

/// Ao ligar: registra o primeiro atalho da lista que estiver livre.
pub fn registrar_padrao(app: &AppHandle, estado: &AtalhoAtual) {
    for atalho in PADROES {
        match registrar(app, atalho) {
            Ok(()) => {
                log::info!("Atalho registrado: {atalho}");
                if let Ok(mut atual) = estado.0.lock() {
                    *atual = Some(atalho.to_string());
                }
                return;
            }
            Err(erro) => log::warn!("Atalho {atalho} indisponível: {erro}"),
        }
    }
    log::warn!("Nenhum atalho disponível; a ilha abre só pelo clique.");
}

/// Troca o atalho. Se o novo não puder ser usado, mantém o anterior.
#[tauri::command]
pub fn definir_atalho(
    app: AppHandle,
    atalho: String,
    estado: State<'_, AtalhoAtual>,
) -> Result<String, String> {
    let mut atual = estado.0.lock().map_err(|_| "erro interno".to_string())?;
    if atual.as_deref() == Some(atalho.as_str()) {
        return Ok(atalho);
    }
    if let Some(anterior) = atual.as_deref() {
        let _ = app.global_shortcut().unregister(anterior);
    }
    match registrar(&app, &atalho) {
        Ok(()) => {
            log::info!("Atalho trocado para {atalho}");
            *atual = Some(atalho.clone());
            Ok(atalho)
        }
        Err(erro) => {
            log::warn!("Não consegui usar o atalho {atalho}: {erro}");
            if let Some(anterior) = atual.as_deref() {
                let _ = registrar(&app, anterior);
            }
            Err("Esse atalho já é usado pelo Windows ou por outro programa.".into())
        }
    }
}

#[tauri::command]
pub fn atalho_atual(estado: State<'_, AtalhoAtual>) -> Option<String> {
    estado.0.lock().ok().and_then(|a| a.clone())
}
