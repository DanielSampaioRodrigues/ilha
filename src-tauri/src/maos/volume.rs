//! Volume do Windows: ler, mudar e avisar a ilha quando muda (pelo teclado,
//! pelo ícone do Windows ou por outro programa), para mostrar na ilha.

use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Copy, PartialEq, Serialize)]
pub struct Volume {
    /// De 0 a 100.
    pub nivel: u8,
    pub mudo: bool,
}

#[tauri::command]
pub async fn volume_atual() -> Option<Volume> {
    tauri::async_runtime::spawn_blocking(|| sistema::Controle::novo().and_then(|c| c.ler()))
        .await
        .ok()
        .flatten()
}

#[tauri::command]
pub async fn definir_volume(nivel: Option<u8>, mudo: Option<bool>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let controle = sistema::Controle::novo().ok_or("Não achei a saída de som.")?;
        if let Some(n) = nivel {
            controle.definir(n.min(100))?;
        }
        if let Some(m) = mudo {
            controle.silenciar(m)?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Confere o volume 4 vezes por segundo e avisa quando muda.
pub fn vigiar(app: AppHandle) {
    thread::spawn(move || {
        let mut controle = None;
        let mut ultimo: Option<Volume> = None;
        loop {
            thread::sleep(Duration::from_millis(250));
            if controle.is_none() {
                controle = sistema::Controle::novo();
            }
            let Some(c) = controle.as_ref() else { continue };
            match c.ler() {
                Some(atual) => {
                    if ultimo.is_some() && ultimo != Some(atual) {
                        let _ = app.emit("ilha:volume", atual);
                    }
                    ultimo = Some(atual);
                }
                // A saída de som mudou (fone conectado etc.): pega a nova.
                None => controle = None,
            }
        }
    });
}

#[cfg(windows)]
mod sistema {
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

    use super::Volume;

    pub struct Controle(IAudioEndpointVolume);

    impl Controle {
        pub fn novo() -> Option<Self> {
            unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
                let lista: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
                let saida = lista.GetDefaultAudioEndpoint(eRender, eConsole).ok()?;
                saida.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None).ok().map(Controle)
            }
        }

        pub fn ler(&self) -> Option<Volume> {
            unsafe {
                let nivel = self.0.GetMasterVolumeLevelScalar().ok()?;
                let mudo = self.0.GetMute().ok()?.as_bool();
                Some(Volume { nivel: (nivel * 100.0).round() as u8, mudo })
            }
        }

        pub fn definir(&self, nivel: u8) -> Result<(), String> {
            unsafe {
                self.0
                    .SetMasterVolumeLevelScalar(nivel as f32 / 100.0, std::ptr::null())
                    .map_err(|e| e.to_string())
            }
        }

        pub fn silenciar(&self, mudo: bool) -> Result<(), String> {
            unsafe { self.0.SetMute(mudo, std::ptr::null()).map_err(|e| e.to_string()) }
        }
    }
}

#[cfg(not(windows))]
mod sistema {
    use super::Volume;

    pub struct Controle;

    impl Controle {
        pub fn novo() -> Option<Self> {
            None
        }
        pub fn ler(&self) -> Option<Volume> {
            None
        }
        pub fn definir(&self, _nivel: u8) -> Result<(), String> {
            Err("Só funciona no Windows.".into())
        }
        pub fn silenciar(&self, _mudo: bool) -> Result<(), String> {
            Err("Só funciona no Windows.".into())
        }
    }
}
