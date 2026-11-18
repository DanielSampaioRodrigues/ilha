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
pub async fn ouvir(app: tauri::AppHandle) -> Result<String, String> {
    use std::sync::atomic::Ordering;
    PARAR.store(false, Ordering::Relaxed);
    // A escuta do nome solta o microfone enquanto isso.
    super::chamado::OCUPADO.fetch_add(1, Ordering::Relaxed);
    let r = tauri::async_runtime::spawn_blocking(move || {
        // Ouvido próprio (Whisper) baixado: é ele que ouve (o do Windows só
        // funciona com uma janela da ilha na frente). Não precisa esperar a
        // escuta do nome: os dois podem usar o microfone juntos.
        if super::ouvido::pronto_para_pedido() {
            return super::ouvido::ouvir_pedido(&app, &PARAR).map(|t| super::ditado::corrigir(&t));
        }
        // O ouvido do Windows não funciona direito num programa comum como a
        // ilha (só em apps da loja): enquanto o ouvido próprio instala, avisa.
        if let Some(aviso) = super::ouvido::aviso_instalando() {
            return Err(aviso);
        }
        // Espera a escuta do nome soltar o microfone (até 3 s).
        let comeco = std::time::Instant::now();
        while super::chamado::ATIVO.load(Ordering::Relaxed) && comeco.elapsed() < std::time::Duration::from_secs(3) {
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        // Avisa a tela na hora em que o microfone abre de verdade ("pode falar" + bip):
        // antes disso, o que o Dan fala se perde.
        sistema::ouvir(move || {
            use tauri::Emitter;
            let _ = app.emit("ilha:microfone-aberto", ());
        })
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
            0x8004_5509 => "O reconhecimento de fala do Windows está desligado. Em Ajustes › Voz, “Conferir a voz” liga para você.".into(),
            // Sem permissão para o microfone.
            0x8007_0005 => "O Windows não deixou usar o microfone. Em Ajustes › Voz, “Conferir a voz” libera para você.".into(),
            _ => format!("Não consegui ouvir: {}", e.message()),
        }
    }

    /// Sempre português do Brasil. Antes, se não desse, a ilha caía calada no
    /// idioma do Windows (inglês, no PC do Dan) e entendia tudo errado.
    fn reconhecedor() -> Result<SpeechRecognizer, String> {
        let rec = Language::CreateLanguage(&HSTRING::from("pt-BR"))
            .and_then(|l| SpeechRecognizer::Create(&l))
            .map_err(|e| {
                log::warn!("Ouvir: sem reconhecedor pt-BR: {}", e.message());
                "O Windows não tem o reconhecimento de fala em português (Brasil). Em Ajustes › Voz, “Conferir a voz” mostra como resolver.".to_string()
            })?;
        if let Ok(l) = rec.CurrentLanguage().and_then(|l| l.LanguageTag()) {
            log::info!("Ouvir: idioma {l}");
        }
        Ok(rec)
    }

    pub fn ouvir(aberto: impl FnOnce()) -> Result<String, String> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        let rec = reconhecedor()?;
        let ditado = SpeechRecognitionTopicConstraint::Create(SpeechRecognitionScenario::Dictation, &HSTRING::from("ditado"))
            .map_err(explicar)?;
        rec.Constraints().and_then(|c| c.Append(&ditado)).map_err(explicar)?;
        let compilado = rec.CompileConstraintsAsync().and_then(|op| op.join()).map_err(explicar)?;
        if compilado.Status().map_err(explicar)? != SpeechRecognitionResultStatus::Success {
            return Err("O Windows não preparou o reconhecimento de fala (falta o pacote de fala em português?). Em Ajustes › Voz, “Conferir a voz” instala para você.".into());
        }
        if let Ok(t) = rec.Timeouts() {
            // Tempos em unidades de 100 ns.
            let _ = t.SetInitialSilenceTimeout(TimeSpan { Duration: 8 * 10_000_000 });
            let _ = t.SetEndSilenceTimeout(TimeSpan { Duration: 12 * 1_000_000 });
            let _ = t.SetBabbleTimeout(TimeSpan { Duration: 15 * 10_000_000 });
        }
        // Parar antes de o microfone abrir: nem começa.
        if super::PARAR.load(std::sync::atomic::Ordering::Relaxed) {
            return Ok(String::new());
        }
        let operacao = rec.RecognizeAsync().map_err(explicar)?;
        aberto();
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
        // Solta o microfone na hora (a escuta do nome volta logo depois).
        let _ = rec.Close();
        match resultado {
            Ok(r) => {
                let status = r.Status().map_err(explicar)?;
                let texto = r.Text().map(|t| t.to_string()).unwrap_or_default();
                log::info!("Ouvir: resultado {:?}, {} letras", status, texto.chars().count());
                use SpeechRecognitionResultStatus as S;
                match status {
                    S::Success if !texto.trim().is_empty() => Ok(texto),
                    // Chegou som, mas nenhuma palavra: costuma ser o idioma errado.
                    S::Success => Err("Chegou som, mas o Windows não entendeu nenhuma palavra. Em Ajustes › Voz, “Conferir a voz” confere o idioma de fala.".into()),
                    S::MicrophoneUnavailable => Err("O Windows não achou o microfone (ou outro programa está usando ele só para si).".into()),
                    S::NetworkFailure => Err("O reconhecimento de fala do Windows precisa de internet e não conseguiu falar com a Microsoft.".into()),
                    S::AudioQualityFailure => Err("O som do microfone chegou ruim (baixo demais ou com chiado). Confira em Configurações › Sistema › Som › Entrada qual microfone está escolhido e o volume dele.".into()),
                    S::TopicLanguageNotSupported | S::GrammarLanguageMismatch => Err("Falta o reconhecimento de fala em português. Em Ajustes › Voz, “Conferir a voz” instala.".into()),
                    // Silêncio: o microfone abriu mas não chegou voz nenhuma.
                    S::TimeoutExceeded => Err("O microfone abriu, mas não chegou som nenhum. Confira em Configurações › Sistema › Som › Entrada se o microfone certo está escolhido (e se a barrinha mexe quando você fala).".into()),
                    S::UserCanceled => Ok(String::new()),
                    outro => Err(format!("O Windows não reconheceu a fala (motivo: {outro:?}).")),
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
    pub fn ouvir(_aberto: impl FnOnce()) -> Result<String, String> {
        Err("Ouvir só funciona no Windows.".into())
    }

    pub fn parar() {}
}
