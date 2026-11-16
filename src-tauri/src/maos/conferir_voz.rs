//! "Conferir a voz": vê tudo o que o Windows precisa para a ilha ouvir e
//! conserta o que der, sempre depois de o Dan confirmar na ilha.
//!
//! - microfone ligado no computador;
//! - permissão de microfone (para o usuário e para "apps da área de trabalho");
//! - "Reconhecimento de fala online" ligado (o ditado do Windows usa);
//! - pacote de fala em português (Brasil) instalado (se faltar, baixa e
//!   instala pelo próprio Windows, com a permissão de administrador).

use serde::Serialize;

#[derive(Serialize, Default)]
pub struct EstadoVoz {
    /// Há algum microfone ligado. `None` = não deu para saber.
    pub microfone: Option<bool>,
    /// O Windows deixa a ilha usar o microfone (usuário + apps da área de trabalho).
    pub microfone_liberado: Option<bool>,
    /// Bloqueado para o computador inteiro: só dá para liberar nas Configurações.
    pub microfone_bloqueado_no_pc: bool,
    /// "Reconhecimento de fala online" ligado.
    pub fala_online: Option<bool>,
    /// O reconhecimento de fala tem português (Brasil).
    pub pacote_pt: Option<bool>,
    /// Idiomas de fala que o Windows tem (para mostrar).
    pub idiomas: Vec<String>,
    /// Idioma de fala do Windows (Configurações › Hora e idioma › Fala), ex.: "en-US".
    pub idioma_windows: Option<String>,
    /// Teste de verdade: o ditado em português (Brasil) fica pronto para usar.
    pub ditado_pt: Option<bool>,
}

#[tauri::command]
pub async fn conferir_voz() -> EstadoVoz {
    tauri::async_runtime::spawn_blocking(sistema::conferir).await.unwrap_or_default()
}

/// Conserta um item. `item`: "fala_online", "microfone", "pacote", "abrir_microfone", "abrir_fala" ou "abrir_idiomas".
#[tauri::command]
pub async fn consertar_voz(item: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || sistema::consertar(&item))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(windows)]
mod sistema {
    use super::EstadoVoz;
    use windows::core::{HSTRING, PCWSTR};
    use windows::Media::SpeechRecognition::SpeechRecognizer;
    use windows::Win32::Foundation::{CloseHandle, ERROR_CANCELLED, WAIT_OBJECT_0};
    use windows::Win32::Media::Audio::{eCapture, IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE_ACTIVE};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};
    use windows::Win32::System::Registry::{
        RegGetValueW, RegSetKeyValueW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, REG_DWORD, REG_SZ, RRF_RT_REG_DWORD, RRF_RT_REG_SZ,
    };
    use windows::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject, INFINITE};
    use windows::Win32::UI::Shell::{ShellExecuteExW, ShellExecuteW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
    use windows::Win32::UI::WindowsAndMessaging::{SW_HIDE, SW_SHOWNORMAL};

    const MICROFONE: &str = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone";
    const MICROFONE_APPS: &str = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone\NonPackaged";
    const FALA_ONLINE: &str = r"Software\Microsoft\Speech_OneCore\Settings\OnlineSpeechPrivacy";

    fn ler_texto(raiz: HKEY, chave: &str, valor: &str) -> Option<String> {
        let mut buf = [0u16; 64];
        let mut tamanho = (buf.len() * 2) as u32;
        let ok = unsafe {
            RegGetValueW(
                raiz,
                &HSTRING::from(chave),
                &HSTRING::from(valor),
                RRF_RT_REG_SZ,
                None,
                Some(buf.as_mut_ptr().cast()),
                Some(&mut tamanho),
            )
        };
        if ok.is_err() {
            return None;
        }
        let n = (tamanho as usize / 2).saturating_sub(1).min(buf.len());
        Some(String::from_utf16_lossy(&buf[..n]))
    }

    fn ler_numero(raiz: HKEY, chave: &str, valor: &str) -> Option<u32> {
        let mut n = 0u32;
        let mut tamanho = 4u32;
        let ok = unsafe {
            RegGetValueW(
                raiz,
                &HSTRING::from(chave),
                &HSTRING::from(valor),
                RRF_RT_REG_DWORD,
                None,
                Some((&mut n as *mut u32).cast()),
                Some(&mut tamanho),
            )
        };
        ok.is_ok().then_some(n)
    }

    fn gravar_texto(chave: &str, valor: &str, texto: &str) -> Result<(), String> {
        let largo: Vec<u16> = texto.encode_utf16().chain(Some(0)).collect();
        unsafe {
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                &HSTRING::from(chave),
                &HSTRING::from(valor),
                REG_SZ.0,
                Some(largo.as_ptr().cast()),
                (largo.len() * 2) as u32,
            )
        }
        .ok()
        .map_err(|e| format!("Não consegui mudar a configuração: {}", e.message()))
    }

    fn gravar_numero(chave: &str, valor: &str, n: u32) -> Result<(), String> {
        unsafe {
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                &HSTRING::from(chave),
                &HSTRING::from(valor),
                REG_DWORD.0,
                Some((&n as *const u32).cast()),
                4,
            )
        }
        .ok()
        .map_err(|e| format!("Não consegui mudar a configuração: {}", e.message()))
    }

    fn tem_microfone() -> Option<bool> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let enumerador: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
            let lista = enumerador.EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE).ok()?;
            Some(lista.GetCount().ok()? > 0)
        }
    }

    fn idiomas_de_fala() -> Option<Vec<String>> {
        let lista = SpeechRecognizer::SupportedTopicLanguages().ok()?;
        let mut idiomas = Vec::new();
        for i in 0..lista.Size().ok()? {
            if let Ok(tag) = lista.GetAt(i).and_then(|l| l.LanguageTag()) {
                idiomas.push(tag.to_string());
            }
        }
        Some(idiomas)
    }

    /// Prepara um ditado em português de verdade (sem ouvir nada) e diz se deu certo.
    fn ditado_pt_pronto() -> Option<bool> {
        use windows::Globalization::Language;
        use windows::Media::SpeechRecognition::{SpeechRecognitionResultStatus, SpeechRecognitionScenario, SpeechRecognitionTopicConstraint};
        let idioma = Language::CreateLanguage(&HSTRING::from("pt-BR")).ok()?;
        let Ok(rec) = SpeechRecognizer::Create(&idioma) else { return Some(false) };
        let ditado = SpeechRecognitionTopicConstraint::Create(SpeechRecognitionScenario::Dictation, &HSTRING::from("ditado")).ok()?;
        rec.Constraints().and_then(|c| c.Append(&ditado)).ok()?;
        let pronto = rec
            .CompileConstraintsAsync()
            .and_then(|op| op.join())
            .and_then(|r| r.Status())
            .map(|s| s == SpeechRecognitionResultStatus::Success)
            .unwrap_or(false);
        let _ = rec.Close();
        Some(pronto)
    }

    pub fn conferir() -> EstadoVoz {
        let negado = |v: Option<String>| v.is_some_and(|t| t.eq_ignore_ascii_case("Deny"));
        let usuario = negado(ler_texto(HKEY_CURRENT_USER, MICROFONE, "Value"));
        let apps = negado(ler_texto(HKEY_CURRENT_USER, MICROFONE_APPS, "Value"));
        let pc = negado(ler_texto(HKEY_LOCAL_MACHINE, MICROFONE, "Value"));
        let idiomas = idiomas_de_fala();
        EstadoVoz {
            microfone: tem_microfone(),
            microfone_liberado: Some(!usuario && !apps && !pc),
            microfone_bloqueado_no_pc: pc,
            fala_online: Some(ler_numero(HKEY_CURRENT_USER, FALA_ONLINE, "HasAccepted") == Some(1)),
            pacote_pt: idiomas.as_ref().map(|l| l.iter().any(|t| t.eq_ignore_ascii_case("pt-BR"))),
            idiomas: idiomas.unwrap_or_default(),
            idioma_windows: SpeechRecognizer::SystemSpeechLanguage().and_then(|l| l.LanguageTag()).ok().map(|t| t.to_string()),
            ditado_pt: ditado_pt_pronto(),
        }
    }

    fn abrir(endereco: &str) {
        unsafe {
            ShellExecuteW(None, &HSTRING::from("open"), &HSTRING::from(endereco), PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL);
        }
    }

    /// Instala o pacote de fala (e as vozes) em português pelo próprio Windows.
    /// Precisa de administrador: o Windows mostra a pergunta de permissão.
    fn instalar_pacote() -> Result<(), String> {
        let comando = "-NoProfile -ExecutionPolicy Bypass -Command \"$ErrorActionPreference='Stop'; try { \
            Add-WindowsCapability -Online -Name 'Language.Speech~~~pt-BR~0.0.1.0' | Out-Null; \
            Add-WindowsCapability -Online -Name 'Language.TextToSpeech~~~pt-BR~0.0.1.0' | Out-Null; exit 0 } catch { exit 1 }\"";
        let verbo = HSTRING::from("runas");
        let programa = HSTRING::from("powershell.exe");
        let parametros = HSTRING::from(comando);
        let mut info = SHELLEXECUTEINFOW {
            cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
            fMask: SEE_MASK_NOCLOSEPROCESS,
            lpVerb: PCWSTR(verbo.as_ptr()),
            lpFile: PCWSTR(programa.as_ptr()),
            lpParameters: PCWSTR(parametros.as_ptr()),
            nShow: SW_HIDE.0,
            ..Default::default()
        };
        if let Err(e) = unsafe { ShellExecuteExW(&mut info) } {
            if e.code() == ERROR_CANCELLED.to_hresult() {
                return Err("A permissão do Windows foi recusada, então o pacote não foi instalado.".into());
            }
            return Err(format!("Não consegui começar a instalação: {}", e.message()));
        }
        let processo = info.hProcess;
        let mut codigo = 1u32;
        unsafe {
            if WaitForSingleObject(processo, INFINITE) == WAIT_OBJECT_0 {
                let _ = GetExitCodeProcess(processo, &mut codigo);
            }
            let _ = CloseHandle(processo);
        }
        if codigo == 0 {
            Ok(())
        } else {
            Err("O Windows não conseguiu baixar o pacote de fala. Confira a internet e tente de novo (ou instale em Configurações › Hora e idioma › Idioma e região › Português (Brasil) › Opções).".into())
        }
    }

    pub fn consertar(item: &str) -> Result<(), String> {
        match item {
            "fala_online" => gravar_numero(FALA_ONLINE, "HasAccepted", 1),
            "microfone" => {
                gravar_texto(MICROFONE, "Value", "Allow")?;
                gravar_texto(MICROFONE_APPS, "Value", "Allow")
            }
            "abrir_microfone" => {
                abrir("ms-settings:privacy-microphone");
                Ok(())
            }
            "abrir_fala" => {
                abrir("ms-settings:speech");
                Ok(())
            }
            "abrir_idiomas" => {
                abrir("ms-settings:regionlanguage");
                Ok(())
            }
            "pacote" => instalar_pacote(),
            _ => Err("Não sei consertar isso.".into()),
        }
    }
}

#[cfg(not(windows))]
mod sistema {
    use super::EstadoVoz;

    pub fn conferir() -> EstadoVoz {
        EstadoVoz::default()
    }

    pub fn consertar(_item: &str) -> Result<(), String> {
        Err("Só funciona no Windows.".into())
    }
}
