//! DeepSeek pela API (chave guardada no cofre do Windows).

use serde::Deserialize;
use serde_json::{json, Value};

use crate::maos::cofre;

const ENDERECO: &str = "https://api.deepseek.com/chat/completions";

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
        "model": "deepseek-chat",
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
