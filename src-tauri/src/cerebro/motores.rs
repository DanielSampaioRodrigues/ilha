//! Os motores da conversa. Cada um responde pelo seu jeito:
//! - DeepSeek: pela API (rápida e barata), com o texto chegando aos poucos.
//! - Claude Code, Codex, Gemini CLI e Antigravity CLI: pelos programas oficiais
//!   instalados no PC, usando as assinaturas do Dan. A pergunta vai pela entrada do programa
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
use super::mcp::{self, ServidorMcp};

/// O que vai chegando da resposta.
#[derive(Clone, Serialize)]
#[serde(tag = "tipo", rename_all = "camelCase")]
pub enum Evento {
    /// Número da sessão (para continuar depois).
    Sessao { id: String },
    /// Mais um pedaço do texto da resposta.
    Texto { texto: String },
    /// Mais um pedaço do raciocínio (o "pensando" do modelo), quando ele mostra.
    Pensamento { texto: String },
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
    /// "deepseek", "claude", "codex", "gemini" ou "antigravity".
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
    /// Caminhos de arquivos anexados a esta mensagem.
    #[serde(default)]
    pub anexos: Vec<String>,
    /// Modelo escolhido ("" = o padrão do programa).
    #[serde(default)]
    pub modelo: String,
    /// Nível de raciocínio ("" = o padrão do programa).
    #[serde(default)]
    pub esforco: String,
    /// Servidores MCP da ilha ligados nesta conversa (somam aos do programa).
    #[serde(default)]
    pub mcps: Vec<ServidorMcp>,
    /// Nomes de todos os servidores MCP cadastrados na ilha.
    #[serde(default)]
    pub mcps_da_ilha: Vec<String>,
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
        "antigravity" => Some("agy"),
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

/// Programas instalados pelo npm são um ".cmd" que só chama o Node com um
/// arquivo .js. Chamar o Node direto evita o cmd estragar aspas e colchetes.
fn node_por_tras(cmd: &Path) -> Option<(PathBuf, PathBuf)> {
    let texto = std::fs::read_to_string(cmd).ok()?;
    let pasta = cmd.parent()?;
    let inicio = texto.find("%dp0%\\node_modules\\").or_else(|| texto.find("%~dp0\\node_modules\\"))?;
    let resto = &texto[inicio..];
    let fim = resto.find(".js")? + 3;
    let relativo = resto[..fim].replace("%dp0%\\", "").replace("%~dp0\\", "");
    let script = pasta.join(relativo.split('\\').collect::<PathBuf>());
    if !script.is_file() {
        return None;
    }
    let node_local = pasta.join("node.exe");
    let node = if node_local.is_file() { node_local } else { executavel("node")? };
    Some((node, script))
}

/// Monta o comando; programas ".cmd" (instalados pelo npm) rodam pelo Node
/// direto (ou, se não der, pelo cmd).
fn comando(exe: &Path, args: &[String]) -> Command {
    let ext = exe.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    if ext == "cmd" {
        if let Some((node, script)) = node_por_tras(exe) {
            let mut c = Command::new(node);
            c.arg(script).args(args);
            sem_janela(&mut c);
            return c;
        }
    }
    let mut c = if ext == "cmd" || ext == "bat" {
        let mut c = Command::new("cmd");
        c.arg("/d").arg("/c").arg(exe).args(args);
        c
    } else {
        let mut c = Command::new(exe);
        c.args(args);
        c
    };
    sem_janela(&mut c);
    c
}

/// No Windows, roda sem abrir a janela preta do terminal.
fn sem_janela(_c: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        _c.creation_flags(CREATE_NO_WINDOW);
    }
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
    for m in ["claude", "codex", "gemini", "antigravity"] {
        let encontrado = nome_do_programa(m).and_then(executavel).is_some();
        lista.push(MotorDisponivel { motor: m.into(), encontrado });
    }
    lista
}

// ---------- Argumentos de cada programa ----------

/// Só aceita valores simples (letras, números, ponto, traço, colchetes) para
/// modelo e raciocínio, para nada estranho virar argumento do programa.
fn valor_simples(v: &str) -> bool {
    !v.is_empty() && v.len() <= 60 && v.chars().all(|c| c.is_ascii_alphanumeric() || "-._[]".contains(c))
}

fn argumentos(motor: &str, sessao: Option<&str>, editar: bool, modelo: &str, esforco: &str) -> Vec<String> {
    let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
    let modelo = Some(modelo).filter(|m| valor_simples(m));
    let esforco = Some(esforco).filter(|e| valor_simples(e));
    match motor {
        "claude" => {
            let mut a = s(&["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages"]);
            a.extend(s(&["--permission-mode", if editar { "acceptEdits" } else { "plan" }]));
            if let Some(m) = modelo {
                a.extend(s(&["--model", m]));
            }
            // O raciocínio vai pela variável CLAUDE_CODE_EFFORT_LEVEL (ver rodar_programa),
            // porque ela, se existir no PC, passa por cima do "--effort".
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
            if let Some(m) = modelo {
                a.extend(s(&["-m", m]));
            }
            if let Some(e) = esforco {
                a.extend(["-c".into(), format!("model_reasoning_effort=\"{e}\"")]);
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
            if let Some(m) = modelo {
                a.extend(s(&["-m", m]));
            }
            if let Some(id) = sessao {
                a.extend(s(&["-r", id]));
            }
            a
        }
        "antigravity" => {
            // A pergunta vai pela entrada, em JSON (único jeito documentado de usar stdin).
            let mut a = s(&["--input-format", "stream-json", "--output-format", "stream-json"]);
            // Rodando escondido, ninguém responde às perguntas de permissão, e o
            // Antigravity recusa tudo. Com "pode editar", o Dan autorizou (16/11/2026)
            // ele aprovar sozinho — inclusive comandos. A tela avisa isso.
            if editar {
                a.push("--dangerously-skip-permissions".into());
            }
            if let Some(m) = modelo {
                a.extend(s(&["--model", m]));
            }
            if let Some(e) = esforco {
                a.extend(s(&["--effort", e]));
            }
            if let Some(id) = sessao {
                a.extend(s(&["--conversation", id]));
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
    /// Antigravity: passo atual e se já mandou o número da conversa.
    passo: Value,
    avisou_sessao: bool,
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
            "antigravity" => match tipo {
                "step_update" => {
                    if let Some(id) = v["conversation_id"].as_str().filter(|_| !self.avisou_sessao) {
                        self.avisou_sessao = true;
                        let _ = canal.send(Evento::Sessao { id: id.into() });
                    }
                    match v["step_type"].as_str() {
                        Some("agent_response") => {
                            if v["step_index"] != self.passo {
                                self.passo = v["step_index"].clone();
                                self.separar(canal);
                            }
                            let t = v["text_delta"].as_str().unwrap_or_default().to_string();
                            self.texto(&t, canal);
                        }
                        Some("tool") if v["state"] == "ACTIVE" && v["step_index"] != self.passo => {
                            self.passo = v["step_index"].clone();
                            let info = &v["tool_info"];
                            let nome = info["name"].as_str().or_else(|| info.as_str()).unwrap_or("ferramenta");
                            let _ = canal.send(Evento::Ferramenta { nome: nome.into(), detalhe: detalhe_de(&info["args"]) });
                        }
                        _ => {}
                    }
                }
                "result" => {
                    if let Some(id) = v["conversation_id"].as_str().filter(|_| !self.avisou_sessao) {
                        self.avisou_sessao = true;
                        let _ = canal.send(Evento::Sessao { id: id.into() });
                    }
                    let erro = v["error"].as_str().map(String::from).or_else(|| v["error"]["message"].as_str().map(String::from));
                    if erro.is_some() || v["status"].as_str().is_some_and(|s| s.eq_ignore_ascii_case("error")) {
                        self.erro = Some(erro.unwrap_or_else(|| "O Antigravity parou com erro.".into()));
                    } else if !self.escreveu_texto {
                        let t = v["response"].as_str().unwrap_or_default().to_string();
                        self.texto(&t, canal);
                    }
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
    let mut args = argumentos(&pedido.motor, pedido.sessao.as_deref(), pedido.modo == "editar", &pedido.modelo, &pedido.esforco);
    // Instruções do perfil e skills: o Claude Code recebe como instrução de sistema.
    if pedido.motor == "claude" && !pedido.sistema.trim().is_empty() {
        args.extend(["--append-system-prompt".into(), pedido.sistema.clone()]);
    }
    // MCPs só desta conversa.
    let aplicacao = Some(mcp::aplicar(&pedido.motor, &pedido.mcps, &pedido.mcps_da_ilha, &pedido.conversa_id)?);
    if let Some(ap) = &aplicacao {
        if pedido.motor == "codex" {
            // Os "-c" precisam vir antes do "-" final.
            let fim = args.pop();
            args.extend(ap.argumentos.iter().cloned());
            args.extend(fim);
        } else {
            args.extend(ap.argumentos.iter().cloned());
        }
    }
    // Codex: imagens anexadas vão com "-i" (antes do "-" final).
    if pedido.motor == "codex" {
        let fim = args.pop();
        for a in pedido.anexos.iter().filter(|a| super::anexos::eh_imagem(a)) {
            args.push("-i".into());
            args.push(a.clone());
        }
        args.extend(fim);
    }
    let mut cmd = comando(&exe, &args);
    if let Some(ap) = &aplicacao {
        cmd.envs(&ap.ambiente);
    }
    if pedido.motor == "claude" && valor_simples(&pedido.esforco) {
        cmd.env("CLAUDE_CODE_EFFORT_LEVEL", &pedido.esforco);
    }
    if let Some(p) = pedido.pasta.as_deref().filter(|p| Path::new(p).is_dir()) {
        cmd.current_dir(p);
    } else if let Some(casa) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        cmd.current_dir(casa);
    }
    let temporario = aplicacao.as_ref().and_then(|a| a.temporario.clone());
    let apagar_temporario = move || {
        if let Some(t) = &temporario {
            let _ = std::fs::remove_file(t);
        }
    };
    let mut filho = match cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn() {
        Ok(f) => f,
        Err(e) => {
            apagar_temporario();
            return Err(format!("Não consegui abrir o {nome}: {e}"));
        }
    };

    // A pergunta vai pela entrada do programa (sem problemas com aspas e acentos).
    if let Some(mut entrada) = filho.stdin.take() {
        let texto = super::anexos::para_programa(&pedido.motor, &pedido.prompt, &pedido.anexos);
        let texto = if pedido.motor == "antigravity" {
            serde_json::json!({ "event": "user", "message": { "content": texto } }).to_string() + "\n"
        } else {
            texto
        };
        let _ = entrada.write_all(texto.as_bytes());
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

    let mut leitor = Leitor {
        motor: pedido.motor.clone(),
        recebeu_parcial: false,
        escreveu_texto: false,
        erro: None,
        custo: None,
        passo: Value::Null,
        avisou_sessao: false,
    };
    for linha in BufReader::new(saida).lines().map_while(Result::ok) {
        leitor.linha(&linha, canal);
    }
    let codigo = filho.lock().ok().and_then(|mut f| f.wait().ok());
    apagar_temporario();
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
        // Anexos: o conteúdo vai junto da última mensagem.
        let mut mensagens = pedido.mensagens.clone();
        // Imagens: só o deepseek-flash (o padrão) lê.
        let le_imagens = pedido.modelo.is_empty() || pedido.modelo.contains("flash");
        let ultima = super::anexos::para_api(&pedido.prompt, &pedido.anexos, le_imagens);
        let resultado = match ultima {
            Ok((texto, imagens)) => {
                mensagens.push(Mensagem { papel: "voce".into(), texto });
                let esforco = if pedido.esforco == "none" || valor_simples(&pedido.esforco) { pedido.esforco.as_str() } else { "" };
                deepseek::conversar(&pedido.sistema, &mensagens, &pedido.modelo, esforco, &imagens, &canal, &parar).await
            }
            Err(e) => Err(e),
        };
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

/// Modelos que o próprio programa (ou a API) diz ter. Só o Antigravity e a
/// DeepSeek têm uma lista assim; os outros usam os nomes da documentação.
#[tauri::command]
pub async fn listar_modelos(motor: String) -> Result<Vec<String>, String> {
    match motor.as_str() {
        "deepseek" => deepseek::modelos().await,
        "antigravity" => tauri::async_runtime::spawn_blocking(|| {
            let exe = executavel("agy").ok_or("Não encontrei o Antigravity CLI (agy).")?;
            let saida = comando(&exe, &["models".to_string()]).output().map_err(|e| e.to_string())?;
            let texto = String::from_utf8_lossy(&saida.stdout);
            Ok(texto
                .lines()
                .filter_map(|l| l.split_whitespace().next())
                .map(|p| p.trim_matches(|c: char| c == '*' || c == '-' || c == '•').to_string())
                .filter(|p| valor_simples(p) && p.contains('-') && p.chars().next().is_some_and(|c| c.is_ascii_lowercase()))
                .collect())
        })
        .await
        .map_err(|e| e.to_string())?,
        _ => Ok(Vec::new()),
    }
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
            "antigravity" => args.extend(["--conversation".into(), id]),
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
    fn acha_o_script_do_npm() {
        let pasta = std::env::temp_dir().join(format!("ilha-teste-npm-{}", std::process::id()));
        let js = pasta.join("node_modules").join("@anthropic-ai").join("claude-code");
        std::fs::create_dir_all(&js).unwrap();
        std::fs::write(js.join("cli.js"), "").unwrap();
        std::fs::write(pasta.join("node.exe"), "").unwrap();
        let shim = pasta.join("claude.cmd");
        std::fs::write(
            &shim,
            "@ECHO off\r\nIF EXIST \"%dp0%\\node.exe\" (\r\n  SET \"_prog=%dp0%\\node.exe\"\r\n)\r\nendLocal & \"%_prog%\"  \"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js\" %*\r\n",
        )
        .unwrap();
        let (node, script) = node_por_tras(&shim).expect("deveria achar o script");
        assert!(node.ends_with("node.exe"));
        assert!(script.ends_with("cli.js"));
        let _ = std::fs::remove_dir_all(&pasta);
    }

    #[test]
    fn argumentos_dos_programas() {
        let c = argumentos("claude", Some("abc"), false, "opus", "high");
        assert!(c.windows(2).any(|w| w == ["--model", "opus"]));
        assert!(c.windows(2).any(|w| w == ["--resume", "abc"]));
        assert!(c.windows(2).any(|w| w == ["--permission-mode", "plan"]));
        let x = argumentos("codex", Some("t1"), true, "gpt-6-astra", "xhigh");
        assert!(x.windows(2).any(|w| w == ["-c", "model_reasoning_effort=\"xhigh\""]));
        assert!(x.windows(2).any(|w| w == ["-m", "gpt-6-astra"]));
        assert_eq!(x.last().map(String::as_str), Some("-"));
        assert!(x.windows(2).any(|w| w == ["resume", "t1"]));
        assert!(x.windows(2).any(|w| w == ["--sandbox", "workspace-write"]));
        let g = argumentos("gemini", None, false, "", "");
        assert!(!g.contains(&"-r".to_string()) && !g.contains(&"-m".to_string()));
        let a = argumentos("antigravity", Some("c9"), false, "gemini-3.8-flash-medium", "max");
        assert!(a.windows(2).any(|w| w == ["--conversation", "c9"]));
        assert!(a.windows(2).any(|w| w == ["--effort", "max"]));
        assert!(!a.iter().any(|x| x.contains("dangerously")));
        assert!(argumentos("antigravity", None, true, "", "").contains(&"--dangerously-skip-permissions".to_string()));
        // Nada estranho vira argumento.
        let r = argumentos("claude", None, false, "opus --dangerously-skip-permissions", "");
        assert!(!r.iter().any(|x| x.contains("dangerously")));
    }
}
