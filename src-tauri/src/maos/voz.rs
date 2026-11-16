//! Ouvir o Dan: reconhecimento de fala do próprio Windows (sem conta, sem
//! chave). Aperta o microfone, fala, e a ilha recebe o texto.
//!
//! Precisa, no Windows: microfone liberado para apps da área de trabalho e
//! "Reconhecimento de fala online" ligado (Configurações › Privacidade ›
//! Fala). Os erros explicam o que fazer.

#[cfg(windows)]
use std::sync::Mutex;

#[cfg(windows)]
type Operacao = windows_future::IAsyncOperation<windows::Media::SpeechRecognition::SpeechRecognitionResult>;

#[cfg(windows)]
static ATUAL: Mutex<Option<Operacao>> = Mutex::new(None);

/// Escuta uma frase (até ~15 s) e devolve o texto. Vazio = não ouviu nada.
#[tauri::command]
pub async fn ouvir() -> Result<String, String> {
    use std::sync::atomic::Ordering;
    PARAR.store(false, Ordering::Relaxed);
    // A escuta do nome solta o microfone enquanto isso.
    super::chamado::OCUPADO.fetch_add(1, Ordering::Relaxed);
    let r = tauri::async_runtime::spawn_blocking(|| {
        // Espera a escuta do nome soltar o microfone (até 3 s).
        let comeco = std::time::Instant::now();
        while super::chamado::ATIVO.load(Ordering::Relaxed) && comeco.elapsed() < std::time::Duration::from_secs(3) {
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        sistema::ouvir()
    })
    .await
    .map_err(|e| e.to_string());
    super::chamado::OCUPADO.fetch_sub(1, Ordering::Relaxed);
    r?
}

/// O Dan apertou Parar (vale mesmo antes de o microfone abrir de fato).
pub static PARAR: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Para de ouvir (botão Parar).
#[tauri::command]
pub fn parar_de_ouvir() {
    PARAR.store(true, std::sync::atomic::Ordering::Relaxed);
    sistema::parar();
}

#[cfg(windows)]
mod sistema {
    use windows::core::HSTRING;
    use windows::Foundation::TimeSpan;
    use windows::Globalization::Language;
    use windows::Media::SpeechRecognition::{
        SpeechRecognitionResultStatus, SpeechRecognitionScenario, SpeechRecognitionTopicConstraint, SpeechRecognizer,
    };
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    use super::ATUAL;

    fn explicar(e: windows::core::Error) -> String {
        let codigo = e.code().0 as u32;
        match codigo {
            // Privacidade: reconhecimento de fala online desligado.
            0x8004_5509 => "O reconhecimento de fala do Windows está desligado. Ligue em Configurações › Privacidade e segurança › Fala › Reconhecimento de fala online.".into(),
            // Sem permissão para o microfone.
            0x8007_0005 => "O Windows não deixou usar o microfone. Libere em Configurações › Privacidade e segurança › Microfone (inclusive para apps da área de trabalho).".into(),
            _ => format!("Não consegui ouvir: {}", e.message()),
        }
    }

    fn reconhecedor() -> windows::core::Result<SpeechRecognizer> {
        // Português do Brasil, se o Windows tiver; senão, o idioma do sistema.
        Language::CreateLanguage(&HSTRING::from("pt-BR"))
            .and_then(|l| SpeechRecognizer::Create(&l))
            .or_else(|_| SpeechRecognizer::new())
    }

    pub fn ouvir() -> Result<String, String> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        let rec = reconhecedor().map_err(explicar)?;
        let ditado = SpeechRecognitionTopicConstraint::Create(SpeechRecognitionScenario::Dictation, &HSTRING::from("ditado"))
            .map_err(explicar)?;
        rec.Constraints().and_then(|c| c.Append(&ditado)).map_err(explicar)?;
        let compilado = rec.CompileConstraintsAsync().and_then(|op| op.join()).map_err(explicar)?;
        if compilado.Status().map_err(explicar)? != SpeechRecognitionResultStatus::Success {
            return Err("O Windows não preparou o reconhecimento de fala. Confira se o idioma português tem o pacote de fala instalado (Configurações › Hora e idioma › Fala).".into());
        }
        if let Ok(t) = rec.Timeouts() {
            // Tempos em unidades de 100 ns.
            let _ = t.SetInitialSilenceTimeout(TimeSpan { Duration: 6 * 10_000_000 });
            let _ = t.SetEndSilenceTimeout(TimeSpan { Duration: 12 * 1_000_000 });
            let _ = t.SetBabbleTimeout(TimeSpan { Duration: 15 * 10_000_000 });
        }
        // Parar antes de o microfone abrir: nem começa.
        if super::PARAR.load(std::sync::atomic::Ordering::Relaxed) {
            return Ok(String::new());
        }
        let operacao = rec.RecognizeAsync().map_err(explicar)?;
        if let Ok(mut a) = ATUAL.lock() {
            *a = Some(operacao.clone());
        }
        let resultado = operacao.join();
        if let Ok(mut a) = ATUAL.lock() {
            *a = None;
        }
        // Cancelado (Parar): qualquer que seja o código de erro, é "nada ouvido".
        if super::PARAR.load(std::sync::atomic::Ordering::Relaxed) || operacao.Status().is_ok_and(|s| s == windows_future::AsyncStatus::Canceled) {
            return Ok(String::new());
        }
        match resultado {
            Ok(r) => {
                let status = r.Status().map_err(explicar)?;
                if status == SpeechRecognitionResultStatus::Success {
                    Ok(r.Text().map(|t| t.to_string()).unwrap_or_default())
                } else if status == SpeechRecognitionResultStatus::MicrophoneUnavailable {
                    Err("Não achei microfone ligado.".into())
                } else if status == SpeechRecognitionResultStatus::NetworkFailure {
                    Err("O reconhecimento de fala do Windows precisa de internet.".into())
                } else {
                    Ok(String::new())
                }
            }
            // Cancelado pelo botão Parar.
            Err(e) if e.code().0 as u32 == 0x8000_4004 || e.code().0 as u32 == 0x8000_000E => Ok(String::new()),
            Err(e) => Err(explicar(e)),
        }
    }

    pub fn parar() {
        if let Some(op) = ATUAL.lock().ok().and_then(|mut a| a.take()) {
            let _ = op.Cancel();
        }
    }
}

#[cfg(not(windows))]
mod sistema {
    pub fn ouvir() -> Result<String, String> {
        Err("Ouvir só funciona no Windows.".into())
    }

    pub fn parar() {}
}
