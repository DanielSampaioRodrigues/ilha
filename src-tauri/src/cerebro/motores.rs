//! Os motores da conversa. Cada um responde pelo seu jeito:
//! - DeepSeek: pela API (rápida e barata), com o texto chegando aos poucos.
//! - Claude Code, Codex e Gemini CLI: pelos programas oficiais instalados no
//!   PC, usando as assinaturas do Dan. A pergunta vai pela entrada do programa
//!   (stdin) e a resposta chega em linhas de JSON, que viram eventos para a tela.
//!
//! Cada conversa guarda o número da sessão do programa, para continuar depois
//! (aqui ou no terminal).

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::ipc::Channel;
use tauri::State;

use super::deepseek;

/// O que vai chegando da resposta.
#[derive(Clone, Serialize)]
#[serde(tag = "tipo", rename_all = "camelCase")]
pub enum Evento {
    /// Número da sessão (para continuar depois).
    Sessao { id: String },
    /// Mais um pedaço do texto da resposta.
    Texto { texto: String },
    /// O motor usou uma ferramenta (leu arquivo, rodou comando…).
    Ferramenta { nome: String, detalhe: String },
    /// Terminou (com erro, se houve).
    Fim { erro: Option<String>, custo: Option<f64> },
}

#[derive(Clone, Deserialize)]
pub struct Mensagem {
    pub papel: String,
    pub texto: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pedido {
    pub conversa_id: String,
    /// "deepseek", "claude", "codex" ou "gemini".
    pub motor: String,
    /// Para a DeepSeek: a conversa toda (ela não guarda sessão).
    pub mensagens: Vec<Mensagem>,
    /// Para os programas: só a mensagem nova.
    pub prompt: String,
    pub sessao: Option<String>,
    /// Pasta do projeto (onde o programa trabalha).
    pub pasta: Option<String>,
    /// "conversar" (só lê) ou "editar" (pode mudar arquivos da pasta).
    pub modo: String,
    /// Instruções de sistema (DeepSeek).
    pub sistema: String,
}

/// Como parar cada conversa em andamento.
enum Parada {
    Processo(Arc<Mutex<Child>>),
    Sinal(Arc<AtomicBool>),
}

#[derive(Default, Clone)]
pub struct Andamento(Arc<Mutex<HashMap<String, Parada>>>);

// ---------- Encontrar os programas ----------

fn nome_do_programa(motor: &str) -> Option<&'static str> {
    match motor {
        "claude" => Some("claude"),
        "codex" => Some("codex"),
        "gemini" => Some("gemini"),
        _ => None,
    }
}

/// Procura o programa no PATH e nas pastas onde os instaladores costumam pôr.
pub fn executavel(nome: &str) -> Option<PathBuf> {
    let mut pastas: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    if let Some(casa) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        let casa = PathBuf::from(casa);
        pastas.push(casa.join(".local").join("bin"));
        pastas.push(casa.join("AppData").join("Roaming").join("npm"));
    }
    let extensoes: &[&str] = if cfg!(windows) { &["exe", "cmd", "bat"] } else { &[""] };
    for pasta in pastas {
        for ext in extensoes {
            let caminho = if ext.is_empty() { pasta.join(nome) } else { pasta.join(format!("{nome}.{ext}")) };
            if caminho.is_file() {
                return Some(caminho);
            }
        }
    }
    None
}

/// Monta o comando; programas ".cmd" (instalados pelo npm) rodam pelo cmd.
fn comando(exe: &Path, args: &[String]) -> Command {
    let ext = exe.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    // "mut" só é usado no Windows (para não abrir janela preta).
    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut c = if ext == "cmd" || ext == "bat" {
        let mut c = Command::new("cmd");
        c.arg("/d").arg("/c").arg(exe).args(args);
        c
    } else {
        let mut c = Command::new(exe);
        c.args(args);
        c
    };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}

#[derive(Serialize)]
pub struct MotorDisponivel {
    pub motor: String,
    pub encontrado: bool,
}

#[tauri::command]
pub fn motores_disponiveis() -> Vec<MotorDisponivel> {
    let mut lista = vec![MotorDisponivel {
        motor: "deepseek".into(),
        encontrado: crate::maos::cofre::ler("deepseek").is_some(),
    }];
    for m in ["claude", "codex", "gemini"] {
        lista.push(MotorDisponivel { motor: m.into(), encontrado: executavel(m).is_some() });
    }
    lista
}

// ---------- Argumentos de cada programa ----------

fn argumentos(motor: &str, sessao: Option<&str>, editar: bool) -> Vec<String> {
    let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
    match motor {
        "claude" => {
            let mut a = s(&["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages"]);
            a.extend(s(&["--permission-mode", if editar { "acceptEdits" } else { "plan" }]));
            if let Some(id) = sessao {
                a.extend(s(&["--resume", id]));
            }
            a
        }
        "codex" => {
            let mut a = s(&["exec", "--json", "--skip-git-repo-check"]);
            if editar {
                a.extend(s(&["--sandbox", "workspace-write"]));
            }
            if let Some(id) = sessao {
                a.extend(s(&["resume", id]));
            }
            a.push("-".into());
            a
        }
        "gemini" => {
            let mut a = s(&["--output-format", "stream-json"]);
            if editar {
                a.extend(s(&["--approval-mode", "auto_edit"]));
            }
            if let Some(id) = sessao {
                a.extend(s(&["-r", id]));
            }
            a
        }
        _ => Vec::new(),
    }
}

/// Resumo curto do que a ferramenta fez (arquivo, comando, busca…).
fn detalhe_de(entrada: &Value) -> String {
    for chave in ["file_path", "path", "command", "pattern", "url", "query", "description"] {
        if let Some(v) = entrada.get(chave).and_then(|v| v.as_str()) {
            return v.chars().take(120).collect();
        }
    }
    String::new()
}

/// Lê uma linha de JSON de um programa e transforma em eventos.
struct Leitor {
    motor: String,
    recebeu_parcial: bool,
    escreveu_texto: bool,
    erro: Option<String>,
    custo: Option<f64>,
}

impl Leitor {
    fn texto(&mut self, t: &str, canal: &Channel<Evento>) {
        if t.is_empty() {
            return;
        }
        self.escreveu_texto = true;
        let _ = canal.send(Evento::Texto { texto: t.to_string() });
    }

    fn separar(&mut self, canal: &Channel<Evento>) {
        if self.escreveu_texto {
            let _ = canal.send(Evento::Texto { texto: "\n\n".into() });
        }
    }

    fn linha(&mut self, linha: &str, canal: &Channel<Evento>) {
        let Ok(v) = serde_json::from_str::<Value>(linha) else { return };
        let tipo = v["type"].as_str().unwrap_or_default();
        match self.motor.as_str() {
            "claude" => match tipo {
                "system" if v["subtype"] == "init" => {
                    if let Some(id) = v["session_id"].as_str() {
                        let _ = canal.send(Evento::Sessao { id: id.into() });
                    }
                }
                "stream_event" => {
                    let e = &v["event"];
                    match e["type"].as_str() {
                        Some("content_block_start") if e["content_block"]["type"] == "text" => self.separar(canal),
                        Some("content_block_delta") if e["delta"]["type"] == "text_delta" => {
                            self.recebeu_parcial = true;
                            let t = e["delta"]["text"].as_str().unwrap_or_default().to_string();
                            self.texto(&t, canal);
                        }
                        _ => {}
                    }
                }
                "assistant" => {
                    for bloco in v["message"]["content"].as_array().into_iter().flatten() {
                        match bloco["type"].as_str() {
                            Some("tool_use") => {
                                let _ = canal.send(Evento::Ferramenta {
                                    nome: bloco["name"].as_str().unwrap_or("ferramenta").into(),
                                    detalhe: detalhe_de(&bloco["input"]),
                                });
                            }
                            Some("text") if !self.recebeu_parcial => {
                                self.separar(canal);
                                let t = bloco["text"].as_str().unwrap_or_default().to_string();
                                self.texto(&t, canal);
                            }
                            _ => {}
                        }
                    }
                }
                "result" => {
                    self.custo = v["total_cost_usd"].as_f64();
                    if v["is_error"].as_bool().unwrap_or(false) {
                        self.erro = Some(v["result"].as_str().unwrap_or("O Claude Code parou com erro.").to_string());
                    } else if !self.escreveu_texto {
                        let t = v["result"].as_str().unwrap_or_default().to_string();
                        self.texto(&t, canal);
                    }
                }
                _ => {}
            },
            "codex" => match tipo {
                "thread.started" => {
                    if let Some(id) = v["thread_id"].as_str() {
                        let _ = canal.send(Evento::Sessao { id: id.into() });
                    }
                }
                "item.completed" | "item.started" => {
                    let item = &v["item"];
                    match item["type"].as_str() {
                        Some("agent_message") | Some("assistant_message") if tipo == "item.completed" => {
                            self.separar(canal);
                            let t = item["text"].as_str().unwrap_or_default().to_string();
                            self.texto(&t, canal);
                        }
                        Some("command_execution") if tipo == "item.started" => {
                            let _ = canal.send(Evento::Ferramenta {
                                nome: "comando".into(),
                                detalhe: item["command"].as_str().unwrap_or_default().chars().take(120).collect(),
                            });
                        }
                        Some("file_change") if tipo == "item.completed" => {
                            let arquivos = item["changes"]
                                .as_array()
                                .map(|l| l.iter().filter_map(|c| c["path"].as_str()).collect::<Vec<_>>().join(", "))
                                .unwrap_or_default();
                            let _ = canal.send(Evento::Ferramenta { nome: "editou".into(), detalhe: arquivos });
                        }
                        _ => {}
                    }
                }
                "turn.failed" | "error" => {
                    let msg = v["error"]["message"].as_str().or_else(|| v["message"].as_str()).unwrap_or("O Codex parou com erro.");
                    self.erro = Some(msg.to_string());
                }
                _ => {}
            },
            "gemini" => match tipo {
                "init" => {
                    if let Some(id) = v["session_id"].as_str() {
                        let _ = canal.send(Evento::Sessao { id: id.into() });
                    }
                }
                "message" if v["role"] == "assistant" => {
                    let t = v["content"].as_str().unwrap_or_default().to_string();
                    self.texto(&t, canal);
                }
                "tool_use" => {
                    let _ = canal.send(Evento::Ferramenta {
                        nome: v["tool_name"].as_str().unwrap_or("ferramenta").into(),
                        detalhe: detalhe_de(&v["parameters"]),
                    });
                }
                "result" if v["status"] == "error" => {
                    self.erro = Some(v["error"]["message"].as_str().unwrap_or("O Gemini parou com erro.").to_string());
                }
                "error" if v["severity"] == "error" => {
                    self.erro = Some(v["message"].as_str().unwrap_or("Erro no Gemini.").to_string());
                }
                _ => {}
            },
            _ => {}
        }
    }
}

fn rodar_programa(pedido: &Pedido, canal: &Channel<Evento>, andamento: &Andamento) -> Result<(), String> {
    let nome = nome_do_programa(&pedido.motor).ok_or("Motor desconhecido.")?;
    let exe = executavel(nome).ok_or_else(|| {
        format!("Não encontrei o programa \"{nome}\" neste computador. Ele precisa estar instalado e com login feito.")
    })?;
    let args = argumentos(&pedido.motor, pedido.sessao.as_deref(), pedido.modo == "editar");
    let mut cmd = comando(&exe, &args);
    if let Some(p) = pedido.pasta.as_deref().filter(|p| Path::new(p).is_dir()) {
        cmd.current_dir(p);
    } else if let Some(casa) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        cmd.current_dir(casa);
    }
    let mut filho = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Não consegui abrir o {nome}: {e}"))?;

    // A pergunta vai pela entrada do programa (sem problemas com aspas e acentos).
    if let Some(mut entrada) = filho.stdin.take() {
        let _ = entrada.write_all(pedido.prompt.as_bytes());
    }
    let saida = filho.stdout.take().ok_or("sem saída")?;
    let mut erros = filho.stderr.take();
    let erros_texto = std::thread::spawn(move || {
        let mut t = String::new();
        if let Some(e) = erros.as_mut() {
            let _ = e.read_to_string(&mut t);
        }
        t
    });

    let filho = Arc::new(Mutex::new(filho));
    if let Ok(mut a) = andamento.0.lock() {
        a.insert(pedido.conversa_id.clone(), Parada::Processo(filho.clone()));
    }

    let mut leitor = Leitor { motor: pedido.motor.clone(), recebeu_parcial: false, escreveu_texto: false, erro: None, custo: None };
    for linha in BufReader::new(saida).lines().map_while(Result::ok) {
        leitor.linha(&linha, canal);
    }
    let codigo = filho.lock().ok().and_then(|mut f| f.wait().ok());
    let erros = erros_texto.join().unwrap_or_default();
    let parou_a_pedido = andamento.0.lock().map(|a| !a.contains_key(&pedido.conversa_id)).unwrap_or(false);
    if let Ok(mut a) = andamento.0.lock() {
        a.remove(&pedido.conversa_id);
    }

    let erro = if parou_a_pedido {
        Some("Parado.".to_string())
    } else if leitor.erro.is_some() {
        leitor.erro.clone()
    } else if codigo.is_some_and(|c| !c.success()) && !leitor.escreveu_texto {
        let fim: String = erros.trim().chars().rev().take(400).collect::<Vec<_>>().into_iter().rev().collect();
        Some(if fim.is_empty() { format!("O {nome} terminou com erro.") } else { fim })
    } else {
        None
    };
    if erro.is_some() && !erros.is_empty() {
        log::warn!("{nome}: {}", erros.chars().take(800).collect::<String>());
    }
    let _ = canal.send(Evento::Fim { erro, custo: leitor.custo });
    Ok(())
}

/// Conversa com um motor. A resposta chega pelo canal, aos poucos.
#[tauri::command]
pub async fn conversar(
    pedido: Pedido,
    canal: Channel<Evento>,
    andamento: State<'_, Andamento>,
) -> Result<(), String> {
    if pedido.motor == "deepseek" {
        let parar = Arc::new(AtomicBool::new(false));
        if let Ok(mut a) = andamento.0.lock() {
            a.insert(pedido.conversa_id.clone(), Parada::Sinal(parar.clone()));
        }
        let resultado = deepseek::conversar(&pedido.sistema, &pedido.mensagens, &canal, &parar).await;
        if let Ok(mut a) = andamento.0.lock() {
            a.remove(&pedido.conversa_id);
        }
        let erro = match resultado {
            Ok(()) if parar.load(Ordering::Relaxed) => Some("Parado.".to_string()),
            Ok(()) => None,
            Err(e) => Some(e),
        };
        let _ = canal.send(Evento::Fim { erro, custo: None });
        return Ok(());
    }
    // Os programas rodam fora da fila principal (ler a saída é "bloqueante").
    let andamento = andamento.inner().clone();
    tauri::async_runtime::spawn_blocking(move || rodar_programa(&pedido, &canal, &andamento))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn parar_conversa(conversa_id: String, andamento: State<'_, Andamento>) {
    let parada = andamento.0.lock().ok().and_then(|mut a| a.remove(&conversa_id));
    match parada {
        Some(Parada::Processo(filho)) => {
            if let Ok(mut f) = filho.lock() {
                let _ = f.kill();
            }
        }
        Some(Parada::Sinal(s)) => s.store(true, Ordering::Relaxed),
        None => {}
    }
}

/// Abre a sessão no terminal, para continuar lá (Windows Terminal, se houver).
#[tauri::command]
pub fn abrir_no_terminal(motor: String, sessao: Option<String>, pasta: Option<String>) -> Result<(), String> {
    let nome = nome_do_programa(&motor).ok_or("Esse motor não tem terminal.")?;
    let exe = executavel(nome).ok_or_else(|| format!("Não encontrei o programa \"{nome}\"."))?;
    let mut args: Vec<String> = Vec::new();
    if let Some(id) = sessao {
        match motor.as_str() {
            "claude" => args.extend(["--resume".into(), id]),
            "codex" => args.extend(["resume".into(), id]),
            _ => args.extend(["-r".into(), id]),
        }
    }
    let pasta = pasta
        .filter(|p| Path::new(p).is_dir())
        .or_else(|| std::env::var("USERPROFILE").ok())
        .unwrap_or_else(|| ".".into());
    let tentativa = Command::new("wt.exe").arg("-d").arg(&pasta).arg(&exe).args(&args).spawn();
    if tentativa.is_ok() {
        return Ok(());
    }
    Command::new("cmd")
        .args(["/c", "start", "", "/d"])
        .arg(&pasta)
        .arg("cmd")
        .arg("/k")
        .arg(&exe)
        .args(&args)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Não consegui abrir o terminal: {e}"))
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn argumentos_dos_programas() {
        let c = argumentos("claude", Some("abc"), false);
        assert!(c.windows(2).any(|w| w == ["--resume", "abc"]));
        assert!(c.windows(2).any(|w| w == ["--permission-mode", "plan"]));
        let x = argumentos("codex", Some("t1"), true);
        assert_eq!(x.last().map(String::as_str), Some("-"));
        assert!(x.windows(2).any(|w| w == ["resume", "t1"]));
        assert!(x.windows(2).any(|w| w == ["--sandbox", "workspace-write"]));
        let g = argumentos("gemini", None, false);
        assert!(!g.contains(&"-r".to_string()));
    }
}
