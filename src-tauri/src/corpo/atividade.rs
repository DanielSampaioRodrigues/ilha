//! O que o Dan está fazendo no computador, para a carinha reagir: digitando,
//! programando, desenhando, em chamada, vendo vídeo, lendo no navegador.
//!
//! - Digitação: o Windows avisa a ilha a cada tecla (Raw Input). A ilha só
//!   CONTA quantas teclas foram apertadas no último segundo e meio: não lê
//!   quais são, não guarda nada.
//! - Programa na frente: nome do programa e título da janela, só para
//!   classificar (ex.: "YouTube" no título = vídeo). Nada é guardado.
//!
//! Dá para desligar em Ajustes › Personagem ("Perceber o que estou fazendo").

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::janela_ativa;

static LIGADO: AtomicBool = AtomicBool::new(true);
/// Quantas mensagens de teclado chegaram (aperta + solta = 2).
static TECLAS: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, PartialEq, Serialize)]
pub struct Atividade {
    pub digitando: bool,
    /// "codigo", "design", "escrita", "chamada", "video", "navegador" ou "".
    pub categoria: String,
}

#[tauri::command]
pub fn perceber_atividade(ligar: bool) {
    LIGADO.store(ligar, Ordering::Relaxed);
    sistema::ligar_teclado(ligar);
}

/// Classifica pelo programa e pelo título da janela.
pub fn categoria(programa: &str, titulo: &str) -> &'static str {
    let t = titulo.to_lowercase();
    const VIDEO: [&str; 9] = ["youtube", "netflix", "prime video", "disney+", "twitch", "hbo max", "globoplay", "vlc media player", "crunchyroll"];
    const CHAMADA_TITULO: [&str; 4] = ["meet -", "meet –", "zoom meeting", "reunião do zoom"];
    match programa {
        "teams.exe" | "ms-teams.exe" | "zoom.exe" | "webex.exe" => return "chamada",
        "code.exe" | "cursor.exe" | "windsurf.exe" | "zed.exe" | "devenv.exe" | "idea64.exe" | "pycharm64.exe" | "webstorm64.exe"
        | "rider64.exe" | "sublime_text.exe" | "notepad++.exe" | "windowsterminal.exe" | "wt.exe" | "powershell.exe" | "pwsh.exe"
        | "cmd.exe" | "conhost.exe" => return "codigo",
        "photoshop.exe" | "illustrator.exe" | "indesign.exe" | "afterfx.exe" | "adobe premiere pro.exe" | "figma.exe"
        | "blender.exe" | "krita.exe" | "affinity designer 2.exe" | "affinity photo 2.exe" | "affinity publisher 2.exe"
        | "coreldrw.exe" | "canva.exe" | "mspaint.exe" | "clipstudiopaint.exe" => return "design",
        "winword.exe" | "notion.exe" | "obsidian.exe" | "notepad.exe" | "onenote.exe" | "wps.exe" => return "escrita",
        "vlc.exe" | "mpc-hc64.exe" | "mpv.exe" | "potplayermini64.exe" => return "video",
        _ => {}
    }
    if CHAMADA_TITULO.iter().any(|c| t.contains(c)) {
        return "chamada";
    }
    let navegador = matches!(
        programa,
        "chrome.exe" | "msedge.exe" | "firefox.exe" | "brave.exe" | "opera.exe" | "vivaldi.exe" | "arc.exe" | "zen.exe"
    );
    if navegador {
        if VIDEO.iter().any(|v| t.contains(v)) {
            return "video";
        }
        if t.contains("figma") || t.contains("canva") {
            return "design";
        }
        if t.contains("google docs") || t.contains("documentos google") {
            return "escrita";
        }
        return "navegador";
    }
    ""
}

pub fn iniciar(app: AppHandle) {
    sistema::iniciar_teclado();
    thread::spawn(move || {
        let mut ultima: Option<Atividade> = None;
        // (quando, contagem) dos últimos instantes, para medir o ritmo.
        let mut historico: Vec<(Instant, u64)> = Vec::new();
        loop {
            thread::sleep(Duration::from_millis(350));
            let atual = if LIGADO.load(Ordering::Relaxed) {
                let agora = Instant::now();
                historico.push((agora, TECLAS.load(Ordering::Relaxed)));
                historico.retain(|(q, _)| agora.duration_since(*q) <= Duration::from_millis(1600));
                let feitas = historico.last().map(|u| u.1).unwrap_or(0) - historico.first().map(|p| p.1).unwrap_or(0);
                // 3 teclas (6 mensagens) em 1,6 s = digitando.
                let digitando = feitas >= 6;
                let categoria = janela_ativa::programa_agora()
                    .map(|p| categoria(&p, &janela_ativa::titulo_agora()).to_string())
                    .unwrap_or_default();
                Atividade { digitando, categoria }
            } else {
                historico.clear();
                Atividade { digitando: false, categoria: String::new() }
            };
            if ultima.as_ref() != Some(&atual) {
                let _ = app.emit("ilha:atividade", atual.clone());
                ultima = Some(atual);
            }
        }
    });
}

#[cfg(windows)]
mod sistema {
    use std::sync::atomic::{AtomicIsize, Ordering};

    use windows::core::w;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::Input::{RegisterRawInputDevices, RAWINPUTDEVICE, RIDEV_INPUTSINK, RIDEV_REMOVE};
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, PostMessageW, RegisterClassW, TranslateMessage,
        HWND_MESSAGE, MSG, WINDOW_EX_STYLE, WINDOW_STYLE, WM_APP, WM_INPUT, WNDCLASSW,
    };

    use super::TECLAS;

    /// Janela invisível (só de mensagens) que recebe o aviso de cada tecla.
    static JANELA: AtomicIsize = AtomicIsize::new(0);
    const LIGAR: u32 = WM_APP + 1;
    const DESLIGAR: u32 = WM_APP + 2;

    unsafe extern "system" fn recebe(janela: HWND, msg: u32, w: WPARAM, l: LPARAM) -> LRESULT {
        match msg {
            WM_INPUT => {
                TECLAS.fetch_add(1, Ordering::Relaxed);
            }
            LIGAR => registrar(Some(janela)),
            DESLIGAR => registrar(None),
            _ => {}
        }
        DefWindowProcW(janela, msg, w, l)
    }

    /// Teclado: página 1, uso 6 (padrão USB HID). Sem janela = parar de ouvir.
    fn registrar(janela: Option<HWND>) {
        let dispositivo = RAWINPUTDEVICE {
            usUsagePage: 0x01,
            usUsage: 0x06,
            dwFlags: if janela.is_some() { RIDEV_INPUTSINK } else { RIDEV_REMOVE },
            hwndTarget: janela.unwrap_or_default(),
        };
        unsafe {
            if let Err(e) = RegisterRawInputDevices(&[dispositivo], std::mem::size_of::<RAWINPUTDEVICE>() as u32) {
                log::warn!("Não consegui {} a percepção do teclado: {e}", if janela.is_some() { "ligar" } else { "desligar" });
            }
        }
    }

    pub fn iniciar_teclado() {
        std::thread::spawn(|| unsafe {
            let Ok(modulo) = GetModuleHandleW(None) else { return };
            let classe = WNDCLASSW {
                lpfnWndProc: Some(recebe),
                hInstance: modulo.into(),
                lpszClassName: w!("IlhaPercebeTeclado"),
                ..Default::default()
            };
            RegisterClassW(&classe);
            let Ok(janela) = CreateWindowExW(
                WINDOW_EX_STYLE(0),
                w!("IlhaPercebeTeclado"),
                w!(""),
                WINDOW_STYLE(0),
                0,
                0,
                0,
                0,
                Some(HWND_MESSAGE),
                None,
                Some(modulo.into()),
                None,
            ) else {
                return;
            };
            JANELA.store(janela.0 as isize, Ordering::Relaxed);
            if super::LIGADO.load(Ordering::Relaxed) {
                registrar(Some(janela));
            }
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        });
    }

    pub fn ligar_teclado(ligar: bool) {
        let janela = JANELA.load(Ordering::Relaxed);
        if janela != 0 {
            unsafe {
                let _ = PostMessageW(Some(HWND(janela as *mut _)), if ligar { LIGAR } else { DESLIGAR }, WPARAM(0), LPARAM(0));
            }
        }
    }
}

#[cfg(not(windows))]
mod sistema {
    pub fn iniciar_teclado() {}
    pub fn ligar_teclado(_ligar: bool) {}
}

#[cfg(test)]
mod testes {
    use super::categoria;

    #[test]
    fn classifica_programas() {
        assert_eq!(categoria("code.exe", "main.rs - ilha"), "codigo");
        assert_eq!(categoria("chrome.exe", "Vídeo legal - YouTube - Google Chrome"), "video");
        assert_eq!(categoria("msedge.exe", "Meet - abc-defg-hij"), "chamada");
        assert_eq!(categoria("indesign.exe", "livro.indd"), "design");
        assert_eq!(categoria("chrome.exe", "Notícias"), "navegador");
        assert_eq!(categoria("explorer.exe", "Downloads"), "");
    }
}
