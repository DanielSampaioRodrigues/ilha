//! Liga, só numa conversa, os servidores MCP da ilha que foram escolhidos.
//! Eles SE SOMAM aos que o programa já tem configurados (esses continuam como
//! estão). Cada programa do seu jeito:
//! - Claude Code: arquivo temporário + "--mcp-config".
//! - Codex: "-c mcp_servers.<nome>...." (vale só para esta execução).
//! - Gemini CLI: os servidores precisam estar no settings.json dele (a ilha
//!   escreve lá, com cópia do original) e "--allowed-mcp-server-names" deixa
//!   de fora os da ilha que não foram escolhidos.
//! - Antigravity e DeepSeek: ainda não (a documentação não mostra como).
//!
//! As chaves (ex.: GITHUB_TOKEN) saem do cofre do Windows e vão como variáveis
//! de ambiente do programa; nos arquivos fica só "${NOME}".

use std::collections::HashMap;
use std::path::PathBuf;

use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::maos::cofre;

#[derive(Clone, Debug, Deserialize)]
pub struct ServidorMcp {
    pub nome: String,
    pub tipo: String,
    pub comando: String,
    #[serde(default)]
    pub argumentos: Vec<String>,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub segredos: Vec<String>,
}

/// O que aplicar no programa: argumentos a mais e variáveis de ambiente.
#[derive(Default)]
pub struct Aplicacao {
    pub argumentos: Vec<String>,
    pub ambiente: HashMap<String, String>,
    /// Arquivo temporário para apagar no fim.
    pub temporario: Option<PathBuf>,
}

fn nome_valido(n: &str) -> bool {
    !n.is_empty() && n.len() <= 40 && n.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn ambiente(servidores: &[ServidorMcp]) -> HashMap<String, String> {
    let mut env = HashMap::new();
    for s in servidores {
        for nome in &s.segredos {
            if let Some(valor) = cofre::ler_segredo_mcp(&s.nome, nome) {
                env.insert(nome.clone(), valor);
            }
        }
    }
    env
}

fn casa() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from)
}

/// Monta o que cada programa precisa para somar os servidores escolhidos.
/// `da_ilha`: nomes de todos os servidores cadastrados na ilha (escolhidos ou não).
/// `perguntar`: (só Claude Code) liga o "posso?" da ilha para o que precisar de permissão.
pub fn aplicar(motor: &str, servidores: &[ServidorMcp], da_ilha: &[String], id: &str, perguntar: bool) -> Result<Aplicacao, String> {
    let servidores: Vec<ServidorMcp> = servidores.iter().filter(|s| nome_valido(&s.nome)).cloned().collect();
    let mut ap = Aplicacao { ambiente: ambiente(&servidores), ..Default::default() };
    match motor {
        "claude" => {
            let mut lista = Map::new();
            for s in &servidores {
                let env: Map<String, Value> = s.segredos.iter().map(|n| (n.clone(), json!(format!("${{{n}}}")))).collect();
                let valor = if s.tipo == "remoto" {
                    let mut v = json!({ "type": "http", "url": s.url });
                    if let Some(token) = s.segredos.first() {
                        v["headers"] = json!({ "Authorization": format!("Bearer ${{{token}}}") });
                    }
                    v
                } else {
                    json!({ "command": s.comando, "args": s.argumentos, "env": env })
                };
                lista.insert(s.nome.clone(), valor);
            }
            // A própria ilha sempre vai junto: o "posso?" e as ferramentas dela
            // (verificar o PC, timers, tarefas, notas…), para a IA saber usá-la.
            if let Some(mut ilha) = crate::corpo::permissao::configuracao_mcp(id) {
                // Espera a resposta do Dan por até 15 min.
                ilha["timeout"] = json!(900_000);
                lista.insert(crate::corpo::permissao::SERVIDOR.to_string(), ilha);
            }
            let arquivo = std::env::temp_dir().join(format!("ilha-mcp-{id}.json"));
            std::fs::write(&arquivo, json!({ "mcpServers": lista }).to_string()).map_err(|e| e.to_string())?;
            ap.argumentos = vec!["--mcp-config".into(), arquivo.to_string_lossy().into()];
            if perguntar {
                ap.argumentos.extend(["--permission-prompt-tool".into(), crate::corpo::permissao::nome_completo()]);
            } else {
                // Só conversar: olhar as coisas da ilha é livre.
                ap.argumentos.extend([
                    "--allowedTools".into(),
                    "mcp__ilha__ilha_ler mcp__ilha__ilha_verificar_pc".into(),
                ]);
            }
            ap.temporario = Some(arquivo);
        }
        "codex" => {
            let texto = |v: &str| serde_json::to_string(v).unwrap_or_default();
            let lista = |v: &[String]| serde_json::to_string(v).unwrap_or_else(|_| "[]".into());
            // As ferramentas da própria ilha (verificar o PC, timers, tarefas…).
            if let Some(ilha) = crate::corpo::permissao::configuracao_mcp(id) {
                let base = format!("mcp_servers.{}", crate::corpo::permissao::SERVIDOR);
                let comando = ilha["command"].as_str().unwrap_or_default();
                let args: Vec<String> = ilha["args"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
                ap.argumentos.extend(["-c".into(), format!("{base}.command={}", texto(comando))]);
                ap.argumentos.extend(["-c".into(), format!("{base}.args={}", lista(&args))]);
            }
            for s in &servidores {
                let base = format!("mcp_servers.{}", s.nome);
                if s.tipo == "remoto" {
                    ap.argumentos.extend(["-c".into(), format!("{base}.url={}", texto(&s.url))]);
                    if let Some(token) = s.segredos.first() {
                        ap.argumentos.extend(["-c".into(), format!("{base}.bearer_token_env_var={}", texto(token))]);
                    }
                } else {
                    ap.argumentos.extend(["-c".into(), format!("{base}.command={}", texto(&s.comando))]);
                    ap.argumentos.extend(["-c".into(), format!("{base}.args={}", lista(&s.argumentos))]);
                    if !s.segredos.is_empty() {
                        ap.argumentos.extend(["-c".into(), format!("{base}.env_vars={}", lista(&s.segredos))]);
                    }
                }
                ap.argumentos.extend(["-c".into(), format!("{base}.enabled=true")]);
            }
        }
        "gemini" => {
            if !servidores.is_empty() {
                gravar_no_gemini(&servidores)?;
            }
            // Os do Gemini continuam; os da ilha só se foram escolhidos.
            let existentes = servidores_do_gemini();
            let fora: Vec<&String> = existentes.iter().filter(|n| da_ilha.contains(n) && !servidores.iter().any(|s| &s.nome == *n)).collect();
            if !fora.is_empty() {
                let permitidos: Vec<&str> = existentes.iter().filter(|n| !fora.contains(n)).map(String::as_str).collect();
                let lista = if permitidos.is_empty() { "nenhum".to_string() } else { permitidos.join(",") };
                ap.argumentos = vec!["--allowed-mcp-server-names".into(), lista];
            }
        }
        _ => {}
    }
    Ok(ap)
}

fn arquivo_do_gemini() -> Option<PathBuf> {
    casa().map(|c| c.join(".gemini").join("settings.json"))
}

/// Nomes dos servidores que estão no settings.json do Gemini.
fn servidores_do_gemini() -> Vec<String> {
    arquivo_do_gemini()
        .and_then(|a| std::fs::read_to_string(a).ok())
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v["mcpServers"].as_object().map(|o| o.keys().cloned().collect()))
        .unwrap_or_default()
}

/// Garante que os servidores estão no settings.json do Gemini (com cópia do original).
fn gravar_no_gemini(servidores: &[ServidorMcp]) -> Result<(), String> {
    let arquivo = arquivo_do_gemini().ok_or("sem pasta pessoal")?;
    let texto = std::fs::read_to_string(&arquivo).unwrap_or_default();
    let mut config: Value = if texto.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(&texto).map_err(|_| "Não reconheci o settings.json do Gemini, então não mexi nele.".to_string())?
    };
    let objeto = config.as_object_mut().ok_or("settings.json do Gemini com formato inesperado.")?;
    let lista = objeto.entry("mcpServers").or_insert_with(|| json!({}));
    let lista = lista.as_object_mut().ok_or("mcpServers do Gemini com formato inesperado.")?;
    let mut mudou = false;
    for s in servidores {
        let env: Map<String, Value> = s.segredos.iter().map(|n| (n.clone(), json!(format!("${n}")))).collect();
        let novo = if s.tipo == "remoto" {
            json!({ "httpUrl": s.url })
        } else {
            json!({ "command": s.comando, "args": s.argumentos, "env": env })
        };
        if lista.get(&s.nome) != Some(&novo) {
            lista.insert(s.nome.clone(), novo);
            mudou = true;
        }
    }
    if !mudou {
        return Ok(());
    }
    if !texto.is_empty() {
        let copia = arquivo.with_file_name("settings.json.antes-da-ilha");
        if !copia.exists() {
            let _ = std::fs::write(&copia, &texto);
        }
    }
    if let Some(p) = arquivo.parent() {
        std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
    }
    std::fs::write(&arquivo, serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

#[cfg(test)]
mod testes {
    use super::*;

    fn pw() -> ServidorMcp {
        ServidorMcp {
            nome: "playwright".into(),
            tipo: "local".into(),
            comando: "npx".into(),
            argumentos: vec!["-y".into(), "@playwright/mcp@latest".into()],
            url: String::new(),
            segredos: vec![],
        }
    }

    #[test]
    fn claude_usa_arquivo() {
        let ap = aplicar("claude", &[pw()], &[], "teste", true).unwrap();
        assert!(ap.argumentos.windows(2).any(|w| w[0] == "--permission-prompt-tool" && w[1] == "mcp__ilha__aprovar"));
        assert_eq!(ap.argumentos[0], "--mcp-config");
        let texto = std::fs::read_to_string(ap.temporario.as_ref().unwrap()).unwrap();
        assert!(texto.contains("@playwright/mcp@latest"));
        let _ = std::fs::remove_file(ap.temporario.unwrap());
    }

    #[test]
    fn codex_cria_servidor_por_c() {
        let ap = aplicar("codex", &[pw()], &[], "t", false).unwrap();
        // A ilha vai sempre junto (ferramentas dela), mesmo sem outros servidores.
        let so_ilha = aplicar("claude", &[], &[], "t", false).unwrap();
        let texto = std::fs::read_to_string(so_ilha.temporario.as_ref().unwrap()).unwrap();
        assert!(texto.contains("--mcp-permissao"));
        assert!(!so_ilha.argumentos.contains(&"--permission-prompt-tool".to_string()));
        let _ = std::fs::remove_file(so_ilha.temporario.unwrap());
        assert!(ap.argumentos.iter().any(|a| a.starts_with("mcp_servers.ilha.args=")));
        assert!(ap.argumentos.contains(&"mcp_servers.playwright.command=\"npx\"".to_string()));
        assert!(ap.argumentos.contains(&"mcp_servers.playwright.args=[\"-y\",\"@playwright/mcp@latest\"]".to_string()));
    }
}
