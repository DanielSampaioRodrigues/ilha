//! Voz natural da ElevenLabs: transforma a resposta em fala com voz humana
//! (bem menos robótica que as vozes do Windows). A chave fica no cofre do
//! Windows; só o Rust lê. O áudio (MP3) volta para a ilha tocar.

use crate::maos::cofre;

const API: &str = "https://api.elevenlabs.io/v1";
/// Voz usada se nenhuma foi escolhida ("Sarah", das prontas da ElevenLabs).
const VOZ_PADRAO: &str = "EXAVITQu4vr4xnSDxMaL";
/// Modelos aceitos (nomes da documentação da ElevenLabs).
const MODELOS: [&str; 3] = ["eleven_multilingual_v2", "eleven_flash_v2_5", "eleven_v4_turbo"];

fn chave() -> Result<String, String> {
    cofre::ler("elevenlabs").ok_or_else(|| "Falta a chave da ElevenLabs (Ajustes › Chaves de IA).".into())
}

fn explicar(situacao: reqwest::StatusCode, corpo: &str) -> String {
    match situacao.as_u16() {
        401 => "A ElevenLabs recusou a chave. Confira se ela foi copiada inteira e se tem permissão de “Text to Speech”.".into(),
        402 | 429 if corpo.contains("quota") => "Acabou a cota de fala da ElevenLabs deste mês.".into(),
        429 => "A ElevenLabs pediu para esperar um pouco (muitos pedidos seguidos).".into(),
        _ => format!("A ElevenLabs respondeu com erro ({situacao})."),
    }
}

/// Fala o texto e devolve o MP3.
#[tauri::command]
pub async fn falar_natural(texto: String, voz: String, modelo: String) -> Result<tauri::ipc::Response, String> {
    let texto: String = texto.chars().take(2500).collect();
    if texto.trim().is_empty() {
        return Err("Nada para falar.".into());
    }
    let voz = if voz.trim().is_empty() { VOZ_PADRAO.to_string() } else { voz };
    // O id da voz vai no endereço: só letras e números.
    if !voz.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Voz inválida.".into());
    }
    let modelo = if MODELOS.contains(&modelo.as_str()) { modelo } else { MODELOS[0].to_string() };
    let resposta = reqwest::Client::new()
        .post(format!("{API}/text-to-speech/{voz}?output_format=mp3_44100_128"))
        .header("xi-api-key", chave()?)
        .json(&serde_json::json!({ "text": texto, "model_id": modelo, "language_code": "pt" }))
        .timeout(std::time::Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| format!("Não consegui falar com a ElevenLabs: {e}"))?;
    let situacao = resposta.status();
    if !situacao.is_success() {
        let corpo = resposta.text().await.unwrap_or_default();
        return Err(explicar(situacao, &corpo));
    }
    let audio = resposta.bytes().await.map_err(|e| format!("O áudio chegou incompleto: {e}"))?;
    Ok(tauri::ipc::Response::new(audio.to_vec()))
}

#[derive(serde::Serialize)]
pub struct VozNatural {
    pub id: String,
    pub nome: String,
    pub descricao: String,
}

/// As vozes da conta (as prontas da ElevenLabs e as que o Dan adicionar).
#[tauri::command]
pub async fn vozes_naturais() -> Result<Vec<VozNatural>, String> {
    let resposta = reqwest::Client::new()
        .get(format!("{API}/voices"))
        .header("xi-api-key", chave()?)
        .timeout(std::time::Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| format!("Não consegui falar com a ElevenLabs: {e}"))?;
    let situacao = resposta.status();
    if !situacao.is_success() {
        let corpo = resposta.text().await.unwrap_or_default();
        return Err(explicar(situacao, &corpo));
    }
    let json: serde_json::Value = resposta.json().await.map_err(|e| e.to_string())?;
    let mut vozes: Vec<VozNatural> = json["voices"]
        .as_array()
        .map(|lista| {
            lista
                .iter()
                .filter_map(|v| {
                    let rotulos = &v["labels"];
                    let descricao = ["gender", "accent", "description", "use_case"]
                        .iter()
                        .filter_map(|k| rotulos[*k].as_str())
                        .collect::<Vec<_>>()
                        .join(", ");
                    Some(VozNatural {
                        id: v["voice_id"].as_str()?.to_string(),
                        nome: v["name"].as_str()?.to_string(),
                        descricao,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    vozes.sort_by(|a, b| a.nome.to_lowercase().cmp(&b.nome.to_lowercase()));
    Ok(vozes)
}
