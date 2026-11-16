//! DeepSeek pela API (chave guardada no cofre do Windows).

use serde::Deserialize;
use serde_json::{json, Value};

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::ipc::Channel;

use super::motores::{Evento, Mensagem as MensagemConversa};
use crate::maos::cofre;

const ENDERECO: &str = "https://api.deepseek.com/chat/completions";
const MODELOS: &str = "https://api.deepseek.com/models";
/// Modelo para tarefas rápidas (tradução, testes). Os antigos "deepseek-chat" e
/// "deepseek-reasoner" foram desligados pela DeepSeek em 24/07/2026.
pub const MODELO_RAPIDO: &str = "deepseek-flash";

#[derive(Deserialize)]
struct Resposta {
    choices: Vec<Escolha>,
}

#[derive(Deserialize)]
struct Escolha {
    message: Mensagem,
}

#[derive(Deserialize)]
struct Mensagem {
    content: String,
}

/// Manda uma conversa curta e devolve o texto da resposta.
pub async fn perguntar(sistema: &str, usuario: &str, em_json: bool) -> Result<String, String> {
    let chave = cofre::ler("deepseek")
        .ok_or("Falta a chave da DeepSeek: abra Ajustes › Chaves de IA.")?;
    let mut corpo = json!({
        "model": MODELO_RAPIDO,
        // Sem "pensar" antes: tradução precisa ser rápida.
        "thinking": { "type": "disabled" },
        "temperature": 0.2,
        "messages": [
            { "role": "system", "content": sistema },
            { "role": "user", "content": usuario },
        ],
    });
    if em_json {
        corpo["response_format"] = json!({ "type": "json_object" });
    }
    let resposta = reqwest::Client::new()
        .post(ENDERECO)
        .bearer_auth(chave)
        .json(&corpo)
        .timeout(std::time::Duration::from_secs(90))
        .send()
        .await
        .map_err(|e| format!("Sem conexão com a DeepSeek: {e}"))?;
    let situacao = resposta.status();
    if situacao == reqwest::StatusCode::UNAUTHORIZED {
        return Err("A DeepSeek recusou a chave. Confira em Ajustes › Chaves de IA.".into());
    }
    if situacao == reqwest::StatusCode::PAYMENT_REQUIRED {
        return Err("Acabou o saldo da DeepSeek. Recarregue no site deles.".into());
    }
    if !situacao.is_success() {
        let texto = resposta.text().await.unwrap_or_default();
        return Err(format!("A DeepSeek respondeu com erro ({situacao}): {}", texto.chars().take(200).collect::<String>()));
    }
    let r: Resposta = resposta.json().await.map_err(|e| e.to_string())?;
    r.choices
        .into_iter()
        .next()
        .map(|c| c.message.content)
        .ok_or_else(|| "A DeepSeek não respondeu nada.".into())
}

/// Testa a chave guardada com uma pergunta mínima.
#[tauri::command]
pub async fn testar_deepseek() -> Result<String, String> {
    perguntar("Responda só com: ok", "teste", false).await.map(|_| "Funcionando!".into())
}

/// Traduz várias linhas de uma vez para português do Brasil, mantendo a ordem.
pub async fn traduzir(linhas: &[String]) -> Result<Vec<String>, String> {
    if linhas.is_empty() {
        return Ok(Vec::new());
    }
    let sistema = "Você traduz textos lidos da tela de um computador para português do Brasil. \
        Recebe um JSON {\"linhas\": [...]} e responde SÓ com um JSON {\"traducoes\": [...]} com \
        a tradução de cada linha, na mesma ordem e na mesma quantidade. Mantenha nomes próprios, \
        números, links e código como estão. Se a linha já estiver em português, repita igual.";
    let usuario = json!({ "linhas": linhas }).to_string();
    let texto = perguntar(sistema, &usuario, true).await?;
    let valor: Value = serde_json::from_str(&texto).map_err(|_| "A tradução veio num formato estranho.".to_string())?;
    let mut traducoes: Vec<String> = valor["traducoes"]
        .as_array()
        .map(|l| l.iter().map(|t| t.as_str().unwrap_or_default().to_string()).collect())
        .unwrap_or_default();
    // Se faltou alguma, completa com o original para as posições baterem.
    traducoes.resize(linhas.len(), String::new());
    for (t, original) in traducoes.iter_mut().zip(linhas) {
        if t.trim().is_empty() {
            t.clone_from(original);
        }
    }
    Ok(traducoes)
}

/// Lista os modelos que a conta da DeepSeek pode usar (direto da API).
pub async fn modelos() -> Result<Vec<String>, String> {
    let chave = cofre::ler("deepseek").ok_or("Falta a chave da DeepSeek.")?;
    let resposta = reqwest::Client::new()
        .get(MODELOS)
        .bearer_auth(chave)
        .timeout(std::time::Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resposta.status().is_success() {
        return Err(format!("A DeepSeek respondeu com erro ({}).", resposta.status()));
    }
    let v: Value = resposta.json().await.map_err(|e| e.to_string())?;
    Ok(v["data"]
        .as_array()
        .map(|l| l.iter().filter_map(|m| m["id"].as_str().map(String::from)).collect())
        .unwrap_or_default())
}

/// Conversa com a resposta chegando aos poucos (para aparecer enquanto escreve).
/// `esforco`: "" (padrão da DeepSeek), "none" (sem pensar), "low", "high" ou "max".
/// `imagens`: imagens da última mensagem, como "data:image/...;base64,...".
pub async fn conversar(
    sistema: &str,
    mensagens: &[MensagemConversa],
    modelo: &str,
    esforco: &str,
    imagens: &[String],
    canal: &Channel<Evento>,
    parar: &AtomicBool,
) -> Result<(), String> {
    let chave = cofre::ler("deepseek")
        .ok_or("Falta a chave da DeepSeek: abra Ajustes › Chaves de IA.")?;
    let mut lista = vec![json!({ "role": "system", "content": sistema })];
    let total = mensagens.len();
    for (i, m) in mensagens.iter().enumerate() {
        let papel = if m.papel == "voce" { "user" } else { "assistant" };
        if i + 1 == total && papel == "user" && !imagens.is_empty() {
            let mut partes = vec![json!({ "type": "text", "text": m.texto })];
            for url in imagens {
                partes.push(json!({ "type": "image_url", "image_url": { "url": url } }));
            }
            lista.push(json!({ "role": papel, "content": partes }));
        } else {
            lista.push(json!({ "role": papel, "content": m.texto }));
        }
    }
    let modelo = if modelo.is_empty() { MODELO_RAPIDO } else { modelo };
    let mut corpo = json!({ "model": modelo, "stream": true, "messages": lista });
    match esforco {
        "" => {}
        "none" => {
            corpo["thinking"] = json!({ "type": "disabled" });
            corpo["temperature"] = json!(0.7);
        }
        nivel => {
            corpo["thinking"] = json!({ "type": "enabled" });
            corpo["reasoning_effort"] = json!(nivel);
        }
    }
    let mut resposta = reqwest::Client::new()
        .post(ENDERECO)
        .bearer_auth(chave)
        .json(&corpo)
        .timeout(std::time::Duration::from_secs(600))
        .send()
        .await
        .map_err(|e| format!("Sem conexão com a DeepSeek: {e}"))?;
    let situacao = resposta.status();
    if situacao == reqwest::StatusCode::UNAUTHORIZED {
        return Err("A DeepSeek recusou a chave. Confira em Ajustes › Chaves de IA.".into());
    }
    if situacao == reqwest::StatusCode::PAYMENT_REQUIRED {
        return Err("Acabou o saldo da DeepSeek. Recarregue no site deles.".into());
    }
    if !situacao.is_success() {
        let texto = resposta.text().await.unwrap_or_default();
        return Err(format!("A DeepSeek respondeu com erro ({situacao}): {}", texto.chars().take(300).collect::<String>()));
    }
    // Os pedaços chegam no formato "data: {json}" (um por linha).
    let mut sobra: Vec<u8> = Vec::new();
    while let Some(pedaco) = resposta.chunk().await.map_err(|e| e.to_string())? {
        if parar.load(Ordering::Relaxed) {
            break;
        }
        sobra.extend_from_slice(&pedaco);
        while let Some(fim) = sobra.iter().position(|&b| b == b'\n') {
            let linha: Vec<u8> = sobra.drain(..=fim).collect();
            let linha = String::from_utf8_lossy(&linha);
            let Some(dados) = linha.trim().strip_prefix("data:") else { continue };
            let dados = dados.trim();
            if dados == "[DONE]" {
                return Ok(());
            }
            if let Ok(v) = serde_json::from_str::<Value>(dados) {
                let delta = &v["choices"][0]["delta"];
                if let Some(t) = delta["reasoning_content"].as_str().filter(|t| !t.is_empty()) {
                    let _ = canal.send(Evento::Pensamento { texto: t.to_string() });
                }
                if let Some(t) = delta["content"].as_str().filter(|t| !t.is_empty()) {
                    let _ = canal.send(Evento::Texto { texto: t.to_string() });
                }
            }
        }
    }
    Ok(())
}
