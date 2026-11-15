//! Liga e desliga os avisos de fim de tarefa dos programas de IA usados no
//! terminal: Claude Code, Codex e Gemini CLI. Cada um tem o seu jeito de chamar
//! um programa quando termina; todos chamam "ilha.exe --aviso <nome>".
//!
//! Antes de mexer na configuração de um programa, guardamos uma cópia do
//! arquivo original ao lado (com o final ".antes-da-ilha").

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

/// Marca usada para reconhecer o que a ilha colocou nos arquivos dos outros.
const MARCA: &str = "--aviso";

#[derive(Serialize)]
pub struct SituacaoAviso {
    pub programa: String,
    /// O programa parece instalado (a pasta de configuração dele existe).
    pub encontrado: bool,
    pub ligado: bool,
}

struct Programa {
    id: &'static str,
    pasta: &'static str,
    arquivo: &'static str,
}

const PROGRAMAS: [Programa; 3] = [
    Programa { id: "claude", pasta: ".claude", arquivo: "settings.json" },
    Programa { id: "codex", pasta: ".codex", arquivo: "config.toml" },
    Programa { id: "gemini", pasta: ".gemini", arquivo: "settings.json" },
];

fn programa(id: &str) -> Result<&'static Programa, String> {
    PROGRAMAS
        .iter()
        .find(|p| p.id == id)
        .ok_or_else(|| "Programa desconhecido.".to_string())
}

fn pasta(app: &AppHandle, p: &Programa) -> Result<PathBuf, String> {
    Ok(app.path().home_dir().map_err(|e| e.to_string())?.join(p.pasta))
}

fn exe() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    // Barras normais funcionam tanto no cmd quanto no Git Bash.
    Ok(exe.to_string_lossy().replace('\\', "/"))
}

fn ler(caminho: &Path) -> String {
    std::fs::read_to_string(caminho).unwrap_or_default()
}

fn guardar_copia(caminho: &Path, texto: &str) -> Result<(), String> {
    if texto.is_empty() {
        return Ok(());
    }
    let nome = format!("{}.antes-da-ilha", caminho.file_name().unwrap_or_default().to_string_lossy());
    let copia = caminho.with_file_name(nome);
    if !copia.exists() {
        std::fs::write(copia, texto).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn escrever(caminho: &Path, texto: &str) -> Result<(), String> {
    if let Some(pai) = caminho.parent() {
        std::fs::create_dir_all(pai).map_err(|e| e.to_string())?;
    }
    std::fs::write(caminho, texto).map_err(|e| e.to_string())
}

// ---------- JSON (Claude Code e Gemini CLI) ----------

fn ler_json(texto: &str, nome: &str) -> Result<Value, String> {
    if texto.trim().is_empty() {
        return Ok(json!({}));
    }
    serde_json::from_str(texto)
        .map_err(|_| format!("Não reconheci o arquivo de configuração do {nome}, então não mexi nele."))
}

fn gancho(comando: String) -> Value {
    json!({ "hooks": [{ "type": "command", "command": comando }] })
}

fn ligar_json(config: &mut Value, eventos: &[(&str, &str)], nome: &str) -> Result<(), String> {
    let erro = || format!("A parte \"hooks\" do {nome} tem um formato inesperado.");
    let objeto = config.as_object_mut().ok_or_else(erro)?;
    let ganchos = objeto.entry("hooks").or_insert_with(|| json!({}));
    let ganchos = ganchos.as_object_mut().ok_or_else(erro)?;
    for (evento, tipo) in eventos {
        let lista = ganchos.entry(*evento).or_insert_with(|| json!([]));
        let lista = lista.as_array_mut().ok_or_else(erro)?;
        lista.push(gancho(format!("\"{}\" {MARCA} {tipo}", exe()?)));
    }
    Ok(())
}

/// Tira só os ganchos que a ilha colocou.
fn desligar_json(config: &mut Value) {
    let Some(ganchos) = config.get_mut("hooks").and_then(|g| g.as_object_mut()) else {
        return;
    };
    for lista in ganchos.values_mut() {
        if let Some(lista) = lista.as_array_mut() {
            lista.retain(|grupo| !grupo.to_string().contains(MARCA) || !grupo.to_string().contains("ilha"));
        }
    }
    ganchos.retain(|_, lista| lista.as_array().is_none_or(|l| !l.is_empty()));
}

// ---------- TOML (Codex) ----------

/// É a linha "notify = ..." do topo do arquivo (antes de qualquer [seção])?
/// Cuidado: "notifications = ..." (dentro de [tui]) é outra coisa.
fn eh_notify(linha: &str) -> bool {
    linha
        .split_once('=')
        .is_some_and(|(chave, _)| chave.trim().trim_matches('"') == "notify")
}

fn linhas_do_topo(texto: &str) -> impl Iterator<Item = &str> {
    texto.lines().take_while(|l| !l.trim_start().starts_with('['))
}

/// "notify = []" (vazio) não avisa ninguém: pode ser trocado.
fn notify_vazio(linha: &str) -> bool {
    linha
        .split_once('=')
        .is_some_and(|(_, valor)| valor.split('#').next().unwrap_or("").trim().replace(' ', "") == "[]")
}

/// O Codex aceita um único programa em "notify", que precisa ficar no topo do arquivo.
fn ligar_codex(texto: &str) -> Result<String, String> {
    // Um "notify = []" vazio sai para dar lugar ao da ilha.
    let sem_vazio: String = texto
        .lines()
        .filter(|l| !(eh_notify(l) && notify_vazio(l)))
        .map(|l| format!("{l}\n"))
        .collect();
    let texto = if texto.lines().any(|l| eh_notify(l) && notify_vazio(l)) { sem_vazio.as_str() } else { texto };
    if let Some(outro) = linhas_do_topo(texto).find(|l| eh_notify(l)) {
        return Err(format!(
            "O Codex já avisa outro programa quando termina ({}); não mexi para não atrapalhar.",
            outro.trim()
        ));
    }
    Ok(format!("notify = [\"{}\", \"{MARCA}\", \"codex\"]\n{texto}", exe()?))
}

fn desligar_codex(texto: &str) -> String {
    texto
        .lines()
        .filter(|l| !(eh_notify(l) && l.contains(MARCA)))
        .map(|l| format!("{l}\n"))
        .collect()
}

// ---------- Comandos ----------

#[tauri::command]
pub fn situacao_avisos(app: AppHandle) -> Vec<SituacaoAviso> {
    PROGRAMAS
        .iter()
        .map(|p| {
            let pasta = pasta(&app, p).ok();
            let texto = pasta.as_ref().map(|d| ler(&d.join(p.arquivo))).unwrap_or_default();
            SituacaoAviso {
                programa: p.id.into(),
                encontrado: pasta.is_some_and(|d| d.exists()),
                ligado: texto.contains(MARCA) && texto.contains("ilha"),
            }
        })
        .collect()
}

#[tauri::command]
pub fn mudar_aviso(app: AppHandle, programa: String, ligar: bool) -> Result<(), String> {
    let p = self::programa(&programa)?;
    let caminho = pasta(&app, p)?.join(p.arquivo);
    let texto = ler(&caminho);
    let ligado = texto.contains(MARCA) && texto.contains("ilha");
    if ligado == ligar {
        return Ok(());
    }
    let novo = match (p.id, ligar) {
        ("codex", true) => ligar_codex(&texto)?,
        ("codex", false) => desligar_codex(&texto),
        (id, true) => {
            let nome = if id == "claude" { "Claude Code" } else { "Gemini CLI" };
            let mut config = ler_json(&texto, nome)?;
            let eventos: &[(&str, &str)] = if id == "claude" {
                &[("Stop", "claude-code"), ("Notification", "claude-code-espera")]
            } else {
                &[("AfterAgent", "gemini"), ("Notification", "gemini-espera")]
            };
            ligar_json(&mut config, eventos, nome)?;
            serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?
        }
        (_, false) => {
            let mut config = ler_json(&texto, "programa")?;
            desligar_json(&mut config);
            serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?
        }
    };
    guardar_copia(&caminho, &texto)?;
    escrever(&caminho, &novo)?;
    log::info!("Aviso do {} {}", p.id, if ligar { "ligado" } else { "desligado" });
    Ok(())
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn liga_e_desliga_sem_mexer_no_resto() {
        let original = json!({ "model": "opus", "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "outro" }] }] } });
        let mut config = original.clone();
        ligar_json(&mut config, &[("Stop", "claude-code")], "Claude Code").unwrap();
        assert_eq!(config["hooks"]["Stop"].as_array().unwrap().len(), 2);
        desligar_json(&mut config);
        assert_eq!(config, original);
    }

    #[test]
    fn codex_no_topo_e_volta() {
        let original = "model = \"o3\"\n\n[tui]\nnotifications = true\n";
        let ligado = ligar_codex(original).unwrap();
        assert!(ligado.starts_with("notify = ["));
        assert_eq!(desligar_codex(&ligado), original);
        assert!(ligar_codex("notify = [\"outro\"]\n").is_err());
        // "notifications" dentro de [tui] não é um aviso para outro programa.
        assert!(ligar_codex("[tui]\nnotifications = true\n").is_ok());
        // "notify" dentro de outra seção também não conta.
        assert!(ligar_codex("[algo]\nnotify = 1\n").is_ok());
        // Um "notify" vazio é trocado pelo da ilha.
        let trocado = ligar_codex("notify = []\nmodel = \"o3\"\n").unwrap();
        assert_eq!(trocado.matches("notify").count(), 1);
    }
}
