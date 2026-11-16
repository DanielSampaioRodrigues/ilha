//! Chamar pelo nome: com a opção ligada, a ilha fica ouvindo SÓ o nome do
//! robô (ex.: "Robozinho", "ei Robozinho"). Ouviu: abre a conversa e escuta o
//! pedido. É uma lista fechada de frases, reconhecida no próprio computador.
//! Desligado por padrão (o microfone fica sempre ligado enquanto ativo).

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;

use tauri::AppHandle;

static LIGADO: AtomicBool = AtomicBool::new(false);
/// Quantos "ouvir" normais estão usando o microfone (a escuta do nome pausa).
pub static OCUPADO: AtomicUsize = AtomicUsize::new(0);
/// A escuta do nome está com o microfone agora.
pub static ATIVO: AtomicBool = AtomicBool::new(false);
/// O Windows encerrou a escuta sozinho (microfone trocado, PC suspenso…).
#[cfg_attr(not(windows), allow(dead_code))]
static TERMINOU: AtomicBool = AtomicBool::new(false);
static NOME: Mutex<String> = Mutex::new(String::new());
static INICIADO: AtomicBool = AtomicBool::new(false);
/// Para o "Conferir a voz": o último problema e a última coisa ouvida.
static ULTIMO_ERRO: Mutex<Option<String>> = Mutex::new(None);
static ULTIMO_OUVIDO: Mutex<Option<String>> = Mutex::new(None);

#[cfg_attr(not(windows), allow(dead_code))]
fn guardar(onde: &Mutex<Option<String>>, texto: Option<String>) {
    if let Ok(mut v) = onde.lock() {
        *v = texto;
    }
}

#[derive(serde::Serialize)]
pub struct EstadoChamado {
    pub ligado: bool,
    pub escutando: bool,
    pub erro: Option<String>,
    pub ouviu: Option<String>,
}

/// Como está a escuta do nome (para o "Conferir a voz").
#[tauri::command]
pub fn estado_chamado() -> EstadoChamado {
    EstadoChamado {
        ligado: LIGADO.load(Ordering::Relaxed),
        escutando: ATIVO.load(Ordering::Relaxed),
        erro: ULTIMO_ERRO.lock().ok().and_then(|e| e.clone()),
        ouviu: ULTIMO_OUVIDO.lock().ok().and_then(|e| e.clone()),
    }
}

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
    use windows::Foundation::{TimeSpan, TypedEventHandler};
    use windows::Globalization::Language;
    use windows::Media::SpeechRecognition::{
        SpeechContinuousRecognitionCompletedEventArgs, SpeechContinuousRecognitionSession,
        SpeechContinuousRecognitionResultGeneratedEventArgs, SpeechRecognitionConfidence,
        SpeechRecognitionListConstraint, SpeechRecognitionResultStatus, SpeechRecognizer,
    };
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    use super::{frases, guardar, ATIVO, LIGADO, NOME, OCUPADO, TERMINOU, ULTIMO_ERRO, ULTIMO_OUVIDO};

    fn explicar(e: &windows::core::Error) -> String {
        match e.code().0 as u32 {
            0x8004_5509 => "O reconhecimento de fala está desligado ou falta o pacote de fala em português.".into(),
            0x8007_0005 => "O Windows não deixou usar o microfone.".into(),
            _ => e.message().to_string(),
        }
    }

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
                let texto = r.Text()?.to_string();
                let nivel = match confianca {
                    SpeechRecognitionConfidence::High => "alta",
                    SpeechRecognitionConfidence::Medium => "média",
                    SpeechRecognitionConfidence::Low => "baixa",
                    _ => "nenhuma",
                };
                if !texto.is_empty() {
                    guardar(&ULTIMO_OUVIDO, Some(format!("“{texto}” (certeza {nivel})")));
                }
                // A lista só tem as frases com o nome: até a certeza baixa vale.
                if r.Status()? == SpeechRecognitionResultStatus::Success && confianca != SpeechRecognitionConfidence::Rejected {
                    let _ = app.emit("ilha:chamou", texto);
                }
            }
            Ok(())
        }))?;
        // Se o Windows encerrar a escuta por conta própria, ela é recomeçada.
        rec.ContinuousRecognitionSession()?.Completed(&TypedEventHandler::<
            SpeechContinuousRecognitionSession,
            SpeechContinuousRecognitionCompletedEventArgs,
        >::new(|_, args| {
            if let Some(status) = args.as_ref().and_then(|a| a.Status().ok()) {
                if status == SpeechRecognitionResultStatus::MicrophoneUnavailable {
                    guardar(&ULTIMO_ERRO, Some("O microfone parou de responder.".into()));
                } else if status == SpeechRecognitionResultStatus::AudioQualityFailure {
                    guardar(&ULTIMO_ERRO, Some("O som do microfone está ruim (muito baixo ou com chiado).".into()));
                }
            }
            TERMINOU.store(true, Ordering::Relaxed);
            Ok(())
        }))?;
        // Por padrão o Windows para depois de 20 s de silêncio: aqui, só depois de um dia.
        let _ = rec.ContinuousRecognitionSession()?.SetAutoStopSilenceTimeout(TimeSpan { Duration: 24 * 3600 * 10_000_000 });
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
                let livre = || OCUPADO.load(Ordering::Relaxed) == 0;
                let querer = LIGADO.load(Ordering::Relaxed) && livre() && !nome.trim().is_empty();
                // Encerrada pelo Windows: descarta para recomeçar.
                if TERMINOU.swap(false, Ordering::Relaxed) && atual.is_some() {
                    atual = None;
                    ATIVO.store(false, Ordering::Relaxed);
                    std::thread::sleep(Duration::from_secs(2));
                    continue;
                }
                // Desliga se não quer mais (ou se o nome mudou).
                if let Some((rec, nome_atual)) = &atual {
                    if !querer || *nome_atual != nome {
                        if let Ok(s) = rec.ContinuousRecognitionSession() {
                            let _ = s.StopAsync().and_then(|op| op.join());
                        }
                        atual = None;
                        ATIVO.store(false, Ordering::Relaxed);
                    }
                }
                if querer && atual.is_none() {
                    match preparar(&app, &nome) {
                        // O microfone pode ter sido pedido enquanto preparava.
                        Ok(_) if !livre() => {}
                        Ok(rec) => {
                            let comecou = rec.ContinuousRecognitionSession().and_then(|s| s.StartAsync()).and_then(|op| op.join());
                            match comecou {
                                Ok(()) => {
                                    guardar(&ULTIMO_ERRO, None);
                                    TERMINOU.store(false, Ordering::Relaxed);
                                    ATIVO.store(true, Ordering::Relaxed);
                                    atual = Some((rec, nome));
                                }
                                Err(e) => {
                                    log::warn!("Chamar pelo nome: não consegui começar a ouvir: {}", e.message());
                                    guardar(&ULTIMO_ERRO, Some(format!("Não consegui começar a ouvir: {}", explicar(&e))));
                                    std::thread::sleep(Duration::from_secs(20));
                                }
                            }
                        }
                        Err(e) => {
                            log::warn!("Chamar pelo nome: {}", e.message());
                            guardar(&ULTIMO_ERRO, Some(explicar(&e)));
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
