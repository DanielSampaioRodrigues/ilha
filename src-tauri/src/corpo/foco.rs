//! Quem pegou o foco quando a Central perdeu o foco.
//!
//! Alguns programas (as IAs da Central, por exemplo, quando rodam um comando)
//! abrem por um instante uma janela preta de terminal. Ela "rouba" o foco sem
//! o Dan ter clicado em nada, e a Central achava que ele tinha clicado fora e
//! fechava. Aqui a Central pergunta: a janela da frente é uma "intrusa" (um
//! terminal ou um programa que acabou de abrir)? Se for, ela não fecha e,
//! quando a intrusa some, pega o foco de volta.

use serde::Serialize;

#[derive(Serialize, Default)]
pub struct Frente {
    /// Número da janela da frente (0 = nenhuma).
    pub id: isize,
    /// A janela é da própria ilha.
    pub nossa: bool,
    /// Terminal ou programa aberto há poucos segundos (não foi o Dan).
    pub intrusa: bool,
    /// Nome do programa (ex.: "powershell.exe"), para o registro.
    pub programa: String,
    /// A janela `anterior` (se foi pedida) ainda existe.
    pub anterior_existe: bool,
}

#[tauri::command]
pub fn janela_da_frente(anterior: Option<isize>) -> Frente {
    let frente = sistema::frente(anterior);
    if frente.intrusa && anterior.is_none() {
        log::info!("Uma janela pegou o foco sozinha: {}", frente.programa);
    }
    frente
}

#[cfg(windows)]
mod sistema {
    use super::Frente;
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{CloseHandle, FILETIME, HWND};
    use windows::Win32::System::Threading::{
        GetProcessTimes, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetForegroundWindow, GetWindowThreadProcessId, IsWindow};

    /// Terminais do Windows (o antigo e o "pseudo" que os programas usam por baixo).
    const TERMINAIS: [&str; 2] = ["ConsoleWindowClass", "PseudoConsoleWindow"];
    /// Programa aberto há menos que isto (em segundos) conta como "acabou de abrir".
    const RECEM_ABERTO: f64 = 5.0;

    fn segundos_unix(ft: FILETIME) -> f64 {
        let n = ((ft.dwHighDateTime as u64) << 32) | ft.dwLowDateTime as u64;
        n as f64 / 10_000_000.0 - 11_644_473_600.0
    }

    pub fn frente(anterior: Option<isize>) -> Frente {
        unsafe {
            let janela = GetForegroundWindow();
            let mut f = Frente {
                id: janela.0 as isize,
                anterior_existe: anterior.is_some_and(|a| IsWindow(Some(HWND(a as *mut _))).as_bool()),
                ..Default::default()
            };
            if janela.0.is_null() {
                return f;
            }
            let mut classe = [0u16; 128];
            let n = GetClassNameW(janela, &mut classe);
            let classe = String::from_utf16_lossy(&classe[..n.max(0) as usize]);
            let mut pid = 0u32;
            GetWindowThreadProcessId(janela, Some(&mut pid));
            f.nossa = pid == std::process::id();
            if f.nossa {
                return f;
            }
            let mut recem_aberto = false;
            if let Ok(processo) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                let mut caminho = [0u16; 520];
                let mut tamanho = caminho.len() as u32;
                if QueryFullProcessImageNameW(processo, PROCESS_NAME_WIN32, PWSTR(caminho.as_mut_ptr()), &mut tamanho).is_ok() {
                    let caminho = String::from_utf16_lossy(&caminho[..tamanho as usize]);
                    f.programa = caminho.rsplit(['\\', '/']).next().unwrap_or_default().to_lowercase();
                }
                let (mut inicio, mut fim, mut nucleo, mut usuario) = Default::default();
                if GetProcessTimes(processo, &mut inicio, &mut fim, &mut nucleo, &mut usuario).is_ok() {
                    let agora = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_secs_f64())
                        .unwrap_or_default();
                    recem_aberto = agora - segundos_unix(inicio) < RECEM_ABERTO;
                }
                let _ = CloseHandle(processo);
            }
            f.intrusa = TERMINAIS.contains(&classe.as_str()) || recem_aberto;
            if f.programa.is_empty() {
                f.programa = classe;
            }
            f
        }
    }
}

#[cfg(not(windows))]
mod sistema {
    use super::Frente;

    pub fn frente(_anterior: Option<isize>) -> Frente {
        Frente::default()
    }
}
