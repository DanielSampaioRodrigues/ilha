//! Chamar pelo nome: com a opção ligada, a ilha fica ouvindo SÓ o nome do
//! robô (ex.: "Robozinho", "ei Robozinho"). Ouviu: abre a conversa e escuta o
//! pedido. É uma lista fechada de frases, reconhecida no próprio computador.
//! Desligado por padrão (o microfone fica sempre ligado enquanto ativo).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::AppHandle;

static LIGADO: AtomicBool = AtomicBool::new(false);
/// O "ouvir" normal está usando o microfone: a escuta do nome pausa.
pub static OCUPADO: AtomicBool = AtomicBool::new(false);
static NOME: Mutex<String> = Mutex::new(String::new());
static INICIADO: AtomicBool = AtomicBool::new(false);

/// Frases que acordam o robô.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn frases(nome: &str) -> Vec<String> {
    let nome = nome.trim();
    if nome.is_empty() {
        return Vec::new();
    }
    vec![nome.to_string(), format!("ei {nome}"), format!("oi {nome}"), format!("olá {nome}"), format!("ô {nome}")]
}

#[tauri::command]
pub fn atender_pelo_nome(app: AppHandle, ligar: bool, nome: String) {
    if let Ok(mut n) = NOME.lock() {
        *n = nome;
    }
    LIGADO.store(ligar, Ordering::Relaxed);
    if ligar && !INICIADO.swap(true, Ordering::Relaxed) {
        sistema::iniciar(app);
    }
}

#[cfg(windows)]
mod sistema {
    use std::sync::atomic::Ordering;
    use std::time::Duration;

    use tauri::{AppHandle, Emitter};
    use windows::core::HSTRING;
    use windows::Foundation::TypedEventHandler;
    use windows::Globalization::Language;
    use windows::Media::SpeechRecognition::{
        SpeechContinuousRecognitionSession, SpeechContinuousRecognitionResultGeneratedEventArgs, SpeechRecognitionConfidence,
        SpeechRecognitionListConstraint, SpeechRecognitionResultStatus, SpeechRecognizer,
    };
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    use super::{frases, LIGADO, NOME, OCUPADO};

    fn preparar(app: &AppHandle, nome: &str) -> windows::core::Result<SpeechRecognizer> {
        let rec = Language::CreateLanguage(&HSTRING::from("pt-BR"))
            .and_then(|l| SpeechRecognizer::Create(&l))
            .or_else(|_| SpeechRecognizer::new())?;
        let lista: Vec<HSTRING> = frases(nome).iter().map(HSTRING::from).collect();
        let restricao = SpeechRecognitionListConstraint::Create(&windows_collections::IIterable::from(lista))?;
        rec.Constraints()?.Append(&restricao)?;
        let compilado = rec.CompileConstraintsAsync()?.join()?;
        if compilado.Status()? != SpeechRecognitionResultStatus::Success {
            return Err(windows::core::Error::from_hresult(windows::core::HRESULT(0x8004_5509u32 as i32)));
        }
        let app = app.clone();
        rec.ContinuousRecognitionSession()?.ResultGenerated(&TypedEventHandler::<
            SpeechContinuousRecognitionSession,
            SpeechContinuousRecognitionResultGeneratedEventArgs,
        >::new(move |_, args| {
            if let Some(args) = args.as_ref() {
                let r = args.Result()?;
                let confianca = r.Confidence()?;
                if r.Status()? == SpeechRecognitionResultStatus::Success
                    && (confianca == SpeechRecognitionConfidence::High || confianca == SpeechRecognitionConfidence::Medium)
                {
                    let _ = app.emit("ilha:chamou", r.Text()?.to_string());
                }
            }
            Ok(())
        }))?;
        Ok(rec)
    }

    pub fn iniciar(app: AppHandle) {
        std::thread::spawn(move || {
            unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            }
            let mut atual: Option<(SpeechRecognizer, String)> = None;
            loop {
                std::thread::sleep(Duration::from_millis(400));
                let nome = NOME.lock().map(|n| n.clone()).unwrap_or_default();
                let querer = LIGADO.load(Ordering::Relaxed) && !OCUPADO.load(Ordering::Relaxed) && !nome.trim().is_empty();
                // Desliga se não quer mais (ou se o nome mudou).
                if let Some((rec, nome_atual)) = &atual {
                    if !querer || *nome_atual != nome {
                        if let Ok(s) = rec.ContinuousRecognitionSession() {
                            let _ = s.StopAsync().and_then(|op| op.join());
                        }
                        atual = None;
                    }
                }
                if querer && atual.is_none() {
                    match preparar(&app, &nome) {
                        Ok(rec) => {
                            let comecou = rec.ContinuousRecognitionSession().and_then(|s| s.StartAsync()).and_then(|op| op.join());
                            match comecou {
                                Ok(()) => atual = Some((rec, nome)),
                                Err(e) => {
                                    log::warn!("Chamar pelo nome: não consegui começar a ouvir: {}", e.message());
                                    std::thread::sleep(Duration::from_secs(20));
                                }
                            }
                        }
                        Err(e) => {
                            log::warn!("Chamar pelo nome: {}", e.message());
                            std::thread::sleep(Duration::from_secs(20));
                        }
                    }
                }
            }
        });
    }
}

#[cfg(not(windows))]
mod sistema {
    pub fn iniciar(_app: tauri::AppHandle) {}
}

#[cfg(test)]
mod testes {
    #[test]
    fn frases_do_nome() {
        let f = super::frases(" Robozinho ");
        assert!(f.contains(&"ei Robozinho".to_string()));
        assert!(super::frases("").is_empty());
    }
}
