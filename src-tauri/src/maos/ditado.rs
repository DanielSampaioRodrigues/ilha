//! Ditado: abre a digitação por voz do próprio Windows (Win + H), que escreve
//! na caixa de texto que estiver com o cursor. Grátis, em português, sem chave.
//! (O ditado com Whisper rodando no PC fica para a fase 3, junto com a voz.)

#[tauri::command]
pub fn ditado() -> Result<(), String> {
    sistema::apertar_win_h()
}

#[cfg(windows)]
mod sistema {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_LWIN,
    };

    fn tecla(vk: VIRTUAL_KEY, soltar: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: if soltar { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    pub fn apertar_win_h() -> Result<(), String> {
        let h = VIRTUAL_KEY(0x48);
        let teclas = [tecla(VK_LWIN, false), tecla(h, false), tecla(h, true), tecla(VK_LWIN, true)];
        let enviadas = unsafe { SendInput(&teclas, std::mem::size_of::<INPUT>() as i32) };
        if enviadas as usize == teclas.len() {
            Ok(())
        } else {
            Err("Não consegui abrir o ditado do Windows. Tente apertar Win + H.".into())
        }
    }
}

#[cfg(not(windows))]
mod sistema {
    pub fn apertar_win_h() -> Result<(), String> {
        Err("O ditado usa o Windows.".into())
    }
}
