//! Esconde a ilha enquanto um jogo, vídeo ou apresentação está em tela cheia,
//! e mostra de novo quando sai. Usa o mesmo aviso que o Windows usa para
//! segurar as notificações dele ("não perturbe" de tela cheia).

use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Manager, State};

use crate::JANELA;

pub struct EsconderEmTelaCheia(AtomicBool);

impl Default for EsconderEmTelaCheia {
    fn default() -> Self {
        Self(AtomicBool::new(true))
    }
}

#[tauri::command]
pub fn esconder_em_tela_cheia(ligar: bool, estado: State<'_, EsconderEmTelaCheia>) {
    estado.0.store(ligar, Ordering::Relaxed);
}

pub fn vigiar(app: AppHandle) {
    thread::spawn(move || {
        let mut escondida = false;
        loop {
            thread::sleep(Duration::from_millis(1000));
            let ligado = app.state::<EsconderEmTelaCheia>().0.load(Ordering::Relaxed);
            let esconder = ligado && sistema::tela_cheia();
            if esconder == escondida {
                continue;
            }
            escondida = esconder;
            if let Some(j) = app.get_webview_window(JANELA) {
                let _ = if esconder { j.hide() } else { j.show() };
            }
        }
    });
}

#[cfg(windows)]
mod sistema {
    use windows::Win32::UI::Shell::{
        SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN,
    };

    pub fn tela_cheia() -> bool {
        unsafe {
            SHQueryUserNotificationState()
                .map(|e| e == QUNS_BUSY || e == QUNS_RUNNING_D3D_FULL_SCREEN || e == QUNS_PRESENTATION_MODE)
                .unwrap_or(false)
        }
    }
}

#[cfg(not(windows))]
mod sistema {
    pub fn tela_cheia() -> bool {
        false
    }
}
