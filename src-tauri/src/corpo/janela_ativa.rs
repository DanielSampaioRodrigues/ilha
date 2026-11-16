//! Qual programa está em primeiro plano (para o modo discreto automático).
//!
//! Só funciona quando o Dan escolhe o modo discreto "Automático": aí, a cada
//! meio segundo, vemos o nome do programa da janela ativa (ex.: chrome.exe) e se
//! ela está encostada no topo da tela, embaixo da ilha. Nada é guardado.

use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct VigiarJanelas(AtomicBool);

#[derive(Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JanelaAtiva {
    /// Nome do arquivo do programa, em minúsculas (ex.: "chrome.exe").
    pub programa: String,
    /// A janela encosta no topo da tela, no meio (onde fica a ilha).
    pub no_topo: bool,
}

#[tauri::command]
pub fn vigiar_janelas(ligar: bool, estado: State<'_, VigiarJanelas>) {
    estado.0.store(ligar, Ordering::Relaxed);
}

/// Nome do programa em primeiro plano agora (ex.: "chrome.exe"), se não for a ilha.
pub fn programa_agora() -> Option<String> {
    sistema::janela_ativa().map(|j| j.programa)
}

/// Título da janela em primeiro plano (só para a carinha saber se é vídeo ou
/// chamada; não é guardado em lugar nenhum).
pub fn titulo_agora() -> String {
    sistema::titulo_ativo()
}

pub fn iniciar(app: AppHandle) {
    thread::spawn(move || {
        let mut ultima: Option<JanelaAtiva> = None;
        loop {
            thread::sleep(Duration::from_millis(500));
            if !app.state::<VigiarJanelas>().0.load(Ordering::Relaxed) {
                ultima = None;
                continue;
            }
            // A própria ilha em primeiro plano não muda nada.
            let Some(atual) = sistema::janela_ativa() else { continue };
            if ultima.as_ref() != Some(&atual) {
                let _ = app.emit("ilha:janela-ativa", atual.clone());
                ultima = Some(atual);
            }
        }
    });
}

#[cfg(windows)]
mod sistema {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{CloseHandle, RECT};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetSystemMetrics, GetWindowRect, GetWindowTextW, GetWindowThreadProcessId, SM_CXSCREEN,
    };

    pub fn titulo_ativo() -> String {
        unsafe {
            let janela = GetForegroundWindow();
            if janela.0.is_null() {
                return String::new();
            }
            let mut texto = [0u16; 512];
            let n = GetWindowTextW(janela, &mut texto);
            String::from_utf16_lossy(&texto[..n.max(0) as usize])
        }
    }

    use super::JanelaAtiva;

    pub fn janela_ativa() -> Option<JanelaAtiva> {
        unsafe {
            let janela = GetForegroundWindow();
            if janela.0.is_null() {
                return None;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(janela, Some(&mut pid));
            if pid == 0 || pid == std::process::id() {
                return None;
            }
            let processo = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut texto = [0u16; 1024];
            let mut tamanho = texto.len() as u32;
            let lido = QueryFullProcessImageNameW(processo, PROCESS_NAME_WIN32, PWSTR(texto.as_mut_ptr()), &mut tamanho);
            let _ = CloseHandle(processo);
            lido.ok()?;
            let caminho = String::from_utf16_lossy(&texto[..tamanho as usize]);
            let programa = caminho.rsplit(['\\', '/']).next().unwrap_or_default().to_lowercase();

            let mut r = RECT::default();
            let no_topo = GetWindowRect(janela, &mut r).is_ok() && {
                let meio = GetSystemMetrics(SM_CXSCREEN) / 2;
                r.top <= 8 && r.left < meio && r.right > meio
            };
            Some(JanelaAtiva { programa, no_topo })
        }
    }
}

#[cfg(not(windows))]
mod sistema {
    use super::JanelaAtiva;

    pub fn janela_ativa() -> Option<JanelaAtiva> {
        None
    }

    pub fn titulo_ativo() -> String {
        String::new()
    }
}
