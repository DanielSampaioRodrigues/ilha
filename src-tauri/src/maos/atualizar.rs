//! Segundo caminho de atualização. O atualizador oficial do Tauri às vezes
//! fica "Procurando…" para sempre em alguns PCs (sem dizer o porquê). Este
//! aqui faz o mesmo com tempo limite: lê o `latest.json` do GitHub, baixa o
//! instalador, confere a assinatura (a mesma chave do atualizador oficial: só
//! instala o que foi assinado no GitHub Actions) e abre o instalador no modo
//! "passivo", que fecha a ilha, instala e reabre. Só roda quando o Dan clica.

use serde::Serialize;
use std::time::Duration;
use tauri::{ipc::Channel, AppHandle};

const ENDERECO: &str = "https://github.com/DanielSampaioRodrigues/ilha/releases/latest/download/latest.json";

#[derive(Serialize, Clone)]
pub struct VersaoNova {
    pub versao: String,
    url: String,
    assinatura: String,
}

fn cliente(tempo: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(tempo)
        .user_agent("ilha-atualizador")
        .build()
        .map_err(|e| e.to_string())
}

/// "0.1.134" → [0, 1, 134], para comparar.
fn numeros(v: &str) -> Vec<u64> {
    v.trim_start_matches('v').split(['.', '-', '+']).map_while(|p| p.parse().ok()).collect()
}

fn mais_nova(nova: &str, atual: &str) -> bool {
    numeros(nova) > numeros(atual)
}

/// Procura a versão nova. `None` = já está na mais nova.
#[tauri::command]
pub async fn procurar_versao(app: AppHandle) -> Result<Option<VersaoNova>, String> {
    let atual = app.package_info().version.to_string();
    let json: serde_json::Value = cliente(Duration::from_secs(25))?
        .get(ENDERECO)
        .send()
        .await
        .map_err(|e| format!("não consegui falar com o GitHub: {e}"))?
        .error_for_status()
        .map_err(|e| format!("o GitHub respondeu com erro: {e}"))?
        .json()
        .await
        .map_err(|e| format!("resposta estranha do GitHub: {e}"))?;
    let versao = json["version"].as_str().unwrap_or_default().to_string();
    let plataforma = &json["platforms"]["windows-x86_64"];
    let url = plataforma["url"].as_str().unwrap_or_default().to_string();
    let assinatura = plataforma["signature"].as_str().unwrap_or_default().to_string();
    if versao.is_empty() || url.is_empty() || assinatura.is_empty() {
        return Err("o arquivo de versões do GitHub veio incompleto".into());
    }
    log::info!("Atualização (caminho próprio): atual {atual}, no GitHub {versao}");
    Ok(mais_nova(&versao, &atual).then_some(VersaoNova { versao, url, assinatura }))
}

/// Confere se o instalador foi assinado com a nossa chave (a do tauri.conf).
fn conferir_assinatura(app: &AppHandle, dados: &[u8], assinatura: &str, versao: &str) -> Result<(), String> {
    let chave = app.config().plugins.0.get("updater").and_then(|u| u["pubkey"].as_str()).ok_or("sem a chave pública")?;
    conferir(chave, dados, assinatura, versao)
}

fn conferir(chave: &str, dados: &[u8], assinatura: &str, versao: &str) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let texto = |b64: &str| -> Result<String, String> {
        String::from_utf8(STANDARD.decode(b64.trim()).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
    };
    let chave = minisign_verify::PublicKey::decode(&texto(chave)?).map_err(|e| e.to_string())?;
    let assinatura = minisign_verify::Signature::decode(&texto(assinatura)?).map_err(|e| e.to_string())?;
    chave.verify(dados, &assinatura, true).map_err(|_| "a assinatura do instalador não confere".to_string())?;
    // O comentário assinado diz a versão: não deixa trocar um instalador velho por um "novo".
    let comentario = assinatura.trusted_comment();
    if !comentario.contains(&format!("version:{versao}")) {
        return Err("a assinatura é de outra versão".into());
    }
    Ok(())
}

/// Baixa, confere e abre o instalador (a ilha fecha e reabre sozinha).
/// `andamento` recebe de 0 a 100.
#[tauri::command]
pub async fn instalar_versao(app: AppHandle, versao: VersaoRecebida, andamento: Channel<u8>) -> Result<(), String> {
    if !versao.url.starts_with("https://github.com/DanielSampaioRodrigues/ilha/releases/download/") {
        return Err("endereço do instalador desconhecido".into());
    }
    let mut resposta = cliente(Duration::from_secs(600))?
        .get(&versao.url)
        .send()
        .await
        .map_err(|e| format!("não consegui baixar: {e}"))?
        .error_for_status()
        .map_err(|e| format!("o GitHub respondeu com erro: {e}"))?;
    let total = resposta.content_length().unwrap_or(0);
    let mut dados = Vec::with_capacity(total as usize);
    let mut ultimo = 0u8;
    while let Some(pedaco) = resposta.chunk().await.map_err(|e| format!("a internet caiu no meio: {e}"))? {
        dados.extend_from_slice(&pedaco);
        if total > 0 {
            let p = (dados.len() as u64 * 100 / total).min(100) as u8;
            if p != ultimo {
                ultimo = p;
                let _ = andamento.send(p);
            }
        }
    }
    conferir_assinatura(&app, &dados, &versao.assinatura, &versao.versao)?;
    let pasta = std::env::temp_dir().join(format!("ilha-atualizacao-{}", versao.versao));
    std::fs::create_dir_all(&pasta).map_err(|e| e.to_string())?;
    let arquivo = pasta.join(format!("Ilha_{}_x64-setup.exe", versao.versao));
    std::fs::write(&arquivo, &dados).map_err(|e| format!("não consegui salvar o instalador: {e}"))?;
    log::info!("Atualização (caminho próprio): instalando {}", versao.versao);
    // /P = passivo (só a barra de progresso), /UPDATE = atualização, /R = reabrir depois.
    std::process::Command::new(&arquivo)
        .args(["/P", "/UPDATE", "/R"])
        .spawn()
        .map_err(|e| format!("não consegui abrir o instalador: {e}"))?;
    app.exit(0);
    Ok(())
}

#[derive(serde::Deserialize)]
pub struct VersaoRecebida {
    versao: String,
    url: String,
    assinatura: String,
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn compara_versoes() {
        assert!(mais_nova("0.1.134", "0.1.124"));
        assert!(mais_nova("0.2.0", "0.1.999"));
        assert!(!mais_nova("0.1.124", "0.1.124"));
        assert!(!mais_nova("0.1.99", "0.1.124"));
    }

    /// Baixa o instalador publicado e confere a assinatura de verdade.
    #[test]
    #[ignore]
    fn confere_instalador_do_github() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
        let chave = conf["plugins"]["updater"]["pubkey"].as_str().unwrap().to_string();
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        rt.block_on(async {
            let c = cliente(Duration::from_secs(120)).unwrap();
            let json: serde_json::Value = c.get(ENDERECO).send().await.unwrap().json().await.unwrap();
            let versao = json["version"].as_str().unwrap();
            let p = &json["platforms"]["windows-x86_64"];
            let dados = c.get(p["url"].as_str().unwrap()).send().await.unwrap().bytes().await.unwrap();
            let assinatura = p["signature"].as_str().unwrap();
            conferir(&chave, &dados, assinatura, versao).unwrap();
            assert!(conferir(&chave, &dados[1..], assinatura, versao).is_err());
            assert!(conferir(&chave, &dados, assinatura, "0.1.999").is_err());
        });
    }
}
