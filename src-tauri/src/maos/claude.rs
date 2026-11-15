//! Liga o aviso do Claude Code: quando ele termina uma resposta (ou fica
//! esperando o Dan), chama "ilha.exe --aviso claude-code" e a ilha mostra.
//!
//! Isso é feito com os "ganchos" (hooks) do Claude Code, no arquivo
//! %USERPROFILE%\.claude\settings.json. Antes de mexer, guardamos uma cópia
//! do arquivo original ao lado (settings.json.antes-da-ilha).

use std::path::PathBuf;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

const MARCA: &str = "--aviso claude-code";

fn arquivo(app: &AppHandle) -> Result<PathBuf, String> {
    let casa = app.path().home_dir().map_err(|e| e.to_string())?;
    Ok(casa.join(".claude").join("settings.json"))
}

fn comando(tipo: &str) -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    // Barras normais funcionam tanto no cmd quanto no Git Bash.
    let exe = exe.to_string_lossy().replace('\\', "/");
    Ok(format!("\"{exe}\" --aviso {tipo}"))
}

#[tauri::command]
pub fn aviso_claude_ligado(app: AppHandle) -> bool {
    arquivo(&app)
        .ok()
        .and_then(|caminho| std::fs::read_to_string(caminho).ok())
        .is_some_and(|texto| texto.contains(MARCA))
}

#[tauri::command]
pub fn ligar_aviso_claude(app: AppHandle) -> Result<(), String> {
    let caminho = arquivo(&app)?;
    let texto = std::fs::read_to_string(&caminho).unwrap_or_default();
    if texto.contains(MARCA) {
        return Ok(());
    }
    let mut config: Value = if texto.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(&texto).map_err(|_| {
            "Não reconheci o arquivo de configuração do Claude Code, então não mexi nele.".to_string()
        })?
    };
    let objeto = config
        .as_object_mut()
        .ok_or("O arquivo de configuração do Claude Code tem um formato inesperado.")?;

    let ganchos = objeto.entry("hooks").or_insert_with(|| json!({}));
    let ganchos = ganchos
        .as_object_mut()
        .ok_or("A parte \"hooks\" do Claude Code tem um formato inesperado.")?;
    for (evento, tipo) in [("Stop", "claude-code"), ("Notification", "claude-code-espera")] {
        let lista = ganchos.entry(evento).or_insert_with(|| json!([]));
        let lista = lista
            .as_array_mut()
            .ok_or("A parte \"hooks\" do Claude Code tem um formato inesperado.")?;
        lista.push(json!({ "hooks": [{ "type": "command", "command": comando(tipo)? }] }));
    }

    if let Some(pasta) = caminho.parent() {
        std::fs::create_dir_all(pasta).map_err(|e| e.to_string())?;
    }
    if !texto.is_empty() {
        let copia = caminho.with_extension("json.antes-da-ilha");
        if !copia.exists() {
            std::fs::write(&copia, &texto).map_err(|e| e.to_string())?;
        }
    }
    let novo = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(&caminho, novo).map_err(|e| e.to_string())?;
    log::info!("Aviso do Claude Code ligado em {}", caminho.display());
    Ok(())
}
