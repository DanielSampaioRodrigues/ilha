//! Ouvido na nuvem: a fala vai, enquanto a pessoa fala, para o reconhecimento
//! em tempo real da ElevenLabs (Scribe), pela chave que o Dan já guardou. Como
//! o texto vai sendo montado durante a fala, quando ela termina o pedido já
//! está quase pronto (bem mais rápido que entender tudo no fim, no PC).
//!
//! Só o que vem depois do nome vai para a nuvem; o nome continua sendo ouvido
//! no PC. Se faltar internet ou a chave, a ilha entende no próprio PC.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, Message};

const ENDERECO: &str = "wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime&audio_format=pcm_16000&language_code=pt&commit_strategy=manual";

/// O Dan escolheu "Na nuvem" em Ajustes › Voz.
pub static LIGADA: AtomicBool = AtomicBool::new(false);
/// O último problema da nuvem (para os Ajustes mostrarem); `None` = funcionou.
pub static ULTIMO_ERRO: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

/// Uma conversa com o reconhecimento da ElevenLabs, aberta enquanto a pessoa fala.
pub struct Nuvem {
    envia: tokio::sync::mpsc::UnboundedSender<(Vec<u8>, bool)>,
    resultado: std::sync::mpsc::Receiver<Result<String, String>>,
}

fn pcm16(amostras: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(amostras.len() * 2);
    for a in amostras {
        let v = (a.clamp(-1.0, 1.0) * 32767.0) as i16;
        bytes.extend_from_slice(&v.to_le_bytes());
    }
    bytes
}

/// Abre a conexão (se a nuvem está escolhida e há chave). O som pode ser
/// mandado na hora: o que chegar antes de conectar espera na fila.
pub fn abrir() -> Option<Nuvem> {
    if !LIGADA.load(Ordering::Relaxed) {
        return None;
    }
    let chave = crate::maos::cofre::ler("elevenlabs")?;
    let (envia, mut fila) = tokio::sync::mpsc::unbounded_channel::<(Vec<u8>, bool)>();
    let (devolve, resultado) = std::sync::mpsc::channel();
    tauri::async_runtime::spawn(async move {
        let r = conversar(&chave, &mut fila).await;
        if let Err(e) = &r {
            log::warn!("Ouvido na nuvem: {e}");
        }
        if let Ok(mut u) = ULTIMO_ERRO.lock() {
            *u = r.as_ref().err().cloned();
        }
        let _ = devolve.send(r);
    });
    Some(Nuvem { envia, resultado })
}

async fn conversar(chave: &str, fila: &mut tokio::sync::mpsc::UnboundedReceiver<(Vec<u8>, bool)>) -> Result<String, String> {
    // A criptografia padrão (uma vez só; se já houver, tudo bem).
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let mut pedido = ENDERECO.into_client_request().map_err(|e| e.to_string())?;
    pedido
        .headers_mut()
        .insert("xi-api-key", chave.parse().map_err(|_| "chave inválida".to_string())?);
    let (ws, _) = tokio::time::timeout(Duration::from_secs(5), tokio_tungstenite::connect_async(pedido))
        .await
        .map_err(|_| "a ElevenLabs demorou para responder".to_string())?
        .map_err(|e| format!("não conectou na ElevenLabs: {e}"))?;
    let (mut manda, mut recebe) = ws.split();
    let mut texto = String::new();
    let mut fechou = false;
    loop {
        tokio::select! {
            audio = fila.recv(), if !fechou => {
                let Some((bytes, commit)) = audio else { return Ok(texto) };
                let json = serde_json::json!({
                    "message_type": "input_audio_chunk",
                    "audio_base_64": STANDARD.encode(&bytes),
                    "commit": commit,
                    "sample_rate": 16000,
                });
                manda.send(Message::Text(json.to_string().into())).await.map_err(|e| e.to_string())?;
                if commit {
                    fechou = true;
                }
            }
            msg = recebe.next() => {
                let Some(msg) = msg else { return Ok(texto) };
                let Message::Text(t) = msg.map_err(|e| e.to_string())? else { continue };
                let v: serde_json::Value = serde_json::from_str(&t).unwrap_or_default();
                match v["message_type"].as_str().unwrap_or_default() {
                    "committed_transcript" | "committed_transcript_with_timestamps" => {
                        let parte = v["text"].as_str().unwrap_or_default().trim();
                        if !parte.is_empty() {
                            if !texto.is_empty() {
                                texto.push(' ');
                            }
                            texto.push_str(parte);
                        }
                        if fechou {
                            return Ok(texto);
                        }
                    }
                    "partial_transcript" | "session_started" | "warning" => {}
                    tipo if v.get("error").is_some() => {
                        return Err(match tipo {
                            "auth_error" => "a ElevenLabs recusou a chave (ela precisa da permissão “Speech to Text”)".into(),
                            "quota_exceeded" => "acabou a cota da ElevenLabs".into(),
                            _ => format!("{tipo}: {}", v["error"].as_str().unwrap_or_default()),
                        });
                    }
                    _ => {}
                }
            }
        }
    }
}

impl Nuvem {
    /// Manda um pedaço de som (16 kHz) enquanto a pessoa fala.
    pub fn enviar(&self, amostras: &[f32]) {
        // Pedaços de no máximo 0,5 s (a ElevenLabs limita o tamanho de cada um).
        for pedaco in amostras.chunks(8_000) {
            let _ = self.envia.send((pcm16(pedaco), false));
        }
    }

    /// A pessoa terminou: fecha e espera o texto final (até 5 s).
    pub fn terminar(self) -> Result<String, String> {
        // Um pedacinho de silêncio leva o "pode fechar".
        let _ = self.envia.send((pcm16(&[0.0; 160]), true));
        self.resultado
            .recv_timeout(Duration::from_secs(5))
            .map_err(|_| "a ElevenLabs não respondeu a tempo".to_string())?
    }
}

#[cfg(test)]
mod testes {
    /// Conecta de verdade com uma chave falsa: a ElevenLabs tem de recusar a
    /// chave (prova que a conexão segura e o protocolo funcionam).
    /// `cargo test -- --ignored conecta_na_elevenlabs`
    #[test]
    #[ignore]
    fn conecta_na_elevenlabs() {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let (envia, mut fila) = tokio::sync::mpsc::unbounded_channel();
        envia.send((super::pcm16(&[0.0; 16000]), true)).unwrap();
        let r = rt.block_on(super::conversar("chave-falsa-de-teste", &mut fila));
        println!("{r:?}");
        assert!(r.unwrap_err().contains("recusou a chave"));
    }
}
