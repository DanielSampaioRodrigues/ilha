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
/// O PATH também é lido direto do Windows: se o Dan instalou um programa
/// depois de a ilha abrir, o PATH que a ilha recebeu ao ligar está velho.
pub fn executavel(nome: &str) -> Option<PathBuf> {
    let mut pastas: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    pastas.extend(path_do_windows());
    let var = |v: &str| std::env::var_os(v).map(PathBuf::from);
    if let Some(casa) = var("USERPROFILE").or_else(|| var("HOME")) {
        pastas.push(casa.join(".local").join("bin"));
        pastas.push(casa.join("AppData").join("Roaming").join("npm"));
        pastas.push(casa.join(".bun").join("bin"));
        pastas.push(casa.join(".volta").join("bin"));
        pastas.push(casa.join("scoop").join("shims"));
        pastas.push(casa.join(".codex").join("bin"));
    }
    if let Some(local) = var("LOCALAPPDATA") {
        pastas.push(local.join("Microsoft").join("WinGet").join("Links"));
        pastas.push(local.join("pnpm"));
        pastas.push(local.join("Programs").join(nome));
        pastas.push(local.join("Programs").join(nome).join("bin"));
    }
    // O Claude para computador traz o Claude Code junto (uma pasta por versão).
    if let Some(dados) = var("APPDATA") {
        pastas.extend(versoes_em(&dados.join("Claude").join("claude-code")));
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

/// Subpastas (uma por versão), da mais nova para a mais velha.
fn versoes_em(pasta: &Path) -> Vec<PathBuf> {
    let mut lista: Vec<PathBuf> = std::fs::read_dir(pasta)
        .map(|l| l.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect())
        .unwrap_or_default();
    let chave = |p: &PathBuf| -> Vec<u64> {
        p.file_name()
            .map(|n| n.to_string_lossy().split(['.', '-']).map(|x| x.parse().unwrap_or(0)).collect())
            .unwrap_or_default()
    };
    lista.sort_by_key(|p| std::cmp::Reverse(chave(p)));
    lista
}

/// O PATH guardado no Windows agora (do usuário e do computador).
#[cfg(windows)]
fn path_do_windows() -> Vec<PathBuf> {
    use windows::core::HSTRING;
    use windows::Win32::System::Registry::{
        RegGetValueW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_NOEXPAND, RRF_RT_REG_EXPAND_SZ, RRF_RT_REG_SZ,
    };
    fn ler(raiz: HKEY, chave: &str) -> String {
        let mut buf = vec![0u16; 16 * 1024];
        let mut tamanho = (buf.len() * 2) as u32;
        let ok = unsafe {
            RegGetValueW(
                raiz,
                &HSTRING::from(chave),
                &HSTRING::from("Path"),
                RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ | RRF_NOEXPAND,
                None,
                Some(buf.as_mut_ptr().cast()),
                Some(&mut tamanho),
            )
        };
        if ok.is_err() {
            return String::new();
        }
        let n = (tamanho as usize / 2).saturating_sub(1).min(buf.len());
        String::from_utf16_lossy(&buf[..n])
    }
    let usuario = ler(HKEY_CURRENT_USER, "Environment");
    let pc = ler(HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment");
    format!("{usuario};{pc}")
        .split(';')
        .map(expandir)
        .filter(|p| !p.trim().is_empty())
        .map(PathBuf::from)
        .collect()
}

#[cfg(not(windows))]
fn path_do_windows() -> Vec<PathBuf> {
    Vec::new()
}

/// Troca %NOME% pelo valor da variável (ex.: %USERPROFILE%).
#[cfg_attr(not(windows), allow(dead_code))]
fn expandir(texto: &str) -> String {
    let mut saida = String::new();
    let mut resto = texto;
    while let Some(inicio) = resto.find('%') {
        saida.push_str(&resto[..inicio]);
        let depois = &resto[inicio + 1..];
        match depois.find('%') {
            Some(fim) => {
                let nome = &depois[..fim];
                match std::env::var(nome) {
                    Ok(v) => saida.push_str(&v),
                    Err(_) => {
                        saida.push('%');
                        saida.push_str(nome);
                        saida.push('%');
                    }
                }
                resto = &depois[fim + 1..];
            }
            None => {
                saida.push_str(&resto[inicio..]);
                resto = "";
            }
        }
    }
    saida.push_str(resto);
    saida
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

/// Encerra o programa e tudo o que ele abriu (no Windows, só matar o programa
/// deixava os "filhos" vivos segurando a saída, e a resposta nunca terminava).
fn matar_arvore(filho: &mut std::process::Child) {
    #[cfg(windows)]
    {
        let mut c = Command::new("taskkill");
        c.args(["/PID", &filho.id().to_string(), "/T", "/F"]).stdout(Stdio::null()).stderr(Stdio::null());
        sem_janela(&mut c);
        let _ = c.status();
    }
    let _ = filho.kill();
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

/// Modelos do Antigravity que coordenam outros agentes (nomes da documentação).
const ORQUESTRADORES: [&str; 2] = ["Orchestrator (Argon)", "Orchestrator (Carbon)"];

fn argumentos(motor: &str, sessao: Option<&str>, editar: bool, modelo: &str, esforco: &str) -> Vec<String> {
    let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
    // O Orquestrador do Antigravity tem nome com espaço e parênteses: só esses dois passam.
    let orquestrador = motor == "antigravity" && ORQUESTRADORES.contains(&modelo);
    let modelo = Some(modelo).filter(|m| valor_simples(m) || orquestrador);
    // O Orquestrador tem configuração fixa: não aceita nível de raciocínio.
    let esforco = Some(esforco).filter(|e| valor_simples(e) && !orquestrador);
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
            // Formato oficial (antigravity.google/docs/cli/headless): cada linha tem
            // "event" com o tipo e os dados dentro de uma chave com o mesmo nome:
            // {"event":"step_update","step_update":{...}}.
            "antigravity" => {
                let tipo = v["event"].as_str().or(v["type"].as_str()).unwrap_or_default();
                let p = if v[tipo].is_object() { &v[tipo] } else { &v };
                let conversa = p["conversation_id"].as_str().or(v["conversation_id"].as_str());
                if let Some(id) = conversa.filter(|_| !self.avisou_sessao) {
                    self.avisou_sessao = true;
                    let _ = canal.send(Evento::Sessao { id: id.into() });
                }
                match tipo {
                    "step_update" => match p["step_type"].as_str() {
                        Some("agent_response") => {
                            if p["step_index"] != self.passo {
                                self.passo = p["step_index"].clone();
                                self.separar(canal);
                            }
                            let t = p["text_delta"].as_str().unwrap_or_default().to_string();
                            self.texto(&t, canal);
                        }
                        Some("tool") if p["state"] == "ACTIVE" && p["step_index"] != self.passo => {
                            self.passo = p["step_index"].clone();
                            let info = &p["tool_info"];
                            let nome = info["name"].as_str().or(p["tool_name"].as_str()).unwrap_or("ferramenta");
                            let _ = canal.send(Evento::Ferramenta { nome: nome.into(), detalhe: detalhe_de(&info["parameters"]) });
                        }
                        _ => {}
                    },
                    "result" => {
                        let erro = p["error"].as_str().map(String::from).or_else(|| p["error"]["message"].as_str().map(String::from));
                        if erro.is_some() || p["status"].as_str().is_some_and(|s| s.eq_ignore_ascii_case("error")) {
                            self.erro = Some(erro.unwrap_or_else(|| "O Antigravity parou com erro.".into()));
                        } else if !self.escreveu_texto {
                            let t = p["response"].as_str().unwrap_or_default().to_string();
                            self.texto(&t, canal);
                        }
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
}

// ---------- Claude Code sempre aberto ----------
//
// Abrir o Claude Code leva alguns segundos. Em vez de abrir e fechar a cada
// pergunta, a ilha deixa ele aberto por conversa (modo oficial de entrada
// contínua: `--input-format stream-json`) e só manda a pergunta nova. A partir
// da segunda pergunta, a resposta começa quase na hora. (Ideia do projeto
// aberto "jarvis", que faz o mesmo pelo Claude Agent SDK.)

struct ClaudeAberto {
    /// Tudo o que define o processo (argumentos, pasta, raciocínio): mudou, abre outro.
    chave: String,
    entrada: std::process::ChildStdin,
    linhas: std::sync::mpsc::Receiver<String>,
    erros: Arc<Mutex<String>>,
    filho: Arc<Mutex<Child>>,
    usado: std::time::Instant,
    temporario: Option<PathBuf>,
}

static ABERTOS: Mutex<Option<HashMap<String, ClaudeAberto>>> = Mutex::new(None);

impl ClaudeAberto {
    fn fechar(self) {
        if let Ok(mut f) = self.filho.lock() {
            matar_arvore(&mut f);
            let _ = f.wait();
        }
        if let Some(t) = &self.temporario {
            let _ = std::fs::remove_file(t);
        }
    }
}

/// Fecha os que ficaram 15 minutos sem uso (cada um ocupa memória).
fn fechar_parados() {
    let parados: Vec<ClaudeAberto> = {
        let Ok(mut a) = ABERTOS.lock() else { return };
        let mapa = a.get_or_insert_with(HashMap::new);
        let chaves: Vec<String> = mapa
            .iter()
            .filter(|(_, c)| c.usado.elapsed() > std::time::Duration::from_secs(15 * 60))
            .map(|(k, _)| k.clone())
            .collect();
        chaves.iter().filter_map(|k| mapa.remove(k)).collect()
    };
    for c in parados {
        c.fechar();
    }
}

fn rodar_claude_aberto(pedido: &Pedido, canal: &Channel<Evento>, andamento: &Andamento) -> Result<(), String> {
    fechar_parados();
    let exe = executavel("claude").ok_or("Não encontrei o programa \"claude\" neste computador. Ele precisa estar instalado e com login feito.")?;
    let editar = pedido.modo == "editar";
    // Os argumentos sem o "continuar a sessão": é o que identifica o processo.
    let mut base = argumentos("claude", None, editar, &pedido.modelo, &pedido.esforco);
    base.extend(["--input-format".into(), "stream-json".into()]);
    if !pedido.sistema.trim().is_empty() {
        base.extend(["--append-system-prompt".into(), pedido.sistema.clone()]);
    }
    let pasta = pedido
        .pasta
        .as_deref()
        .filter(|p| Path::new(p).is_dir())
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from));
    let mcps: Vec<String> = pedido.mcps.iter().map(|m| format!("{m:?}")).collect();
    let chave = format!("{base:?}|{pasta:?}|{mcps:?}");

    // Já aberto com a mesma configuração e ainda vivo? Usa. Senão, abre outro.
    let reaproveitado = ABERTOS.lock().ok().and_then(|mut a| a.get_or_insert_with(HashMap::new).remove(&pedido.conversa_id));
    let mut aberto = match reaproveitado {
        Some(c) if c.chave == chave && c.filho.lock().ok().is_some_and(|mut f| matches!(f.try_wait(), Ok(None))) => c,
        outro => {
            if let Some(c) = outro {
                c.fechar();
            }
            let mut args = base.clone();
            if let Some(id) = pedido.sessao.as_deref() {
                args.extend(["--resume".into(), id.to_string()]);
            }
            let aplicacao = mcp::aplicar("claude", &pedido.mcps, &pedido.mcps_da_ilha, &pedido.conversa_id, editar)?;
            args.extend(aplicacao.argumentos.iter().cloned());
            let mut cmd = comando(&exe, &args);
            cmd.envs(&aplicacao.ambiente);
            if valor_simples(&pedido.esforco) {
                cmd.env("CLAUDE_CODE_EFFORT_LEVEL", &pedido.esforco);
            }
            // Sempre pela assinatura (nunca por uma chave de API guardada no PC).
            cmd.env_remove("ANTHROPIC_API_KEY");
            cmd.env_remove("ANTHROPIC_AUTH_TOKEN");
            if let Some(p) = &pasta {
                cmd.current_dir(p);
            }
            let mut filho = cmd
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| format!("Não consegui abrir o Claude Code: {e}"))?;
            let entrada = filho.stdin.take().ok_or("sem entrada")?;
            let saida = filho.stdout.take().ok_or("sem saída")?;
            let (envia, linhas) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                for linha in BufReader::new(saida).lines().map_while(Result::ok) {
                    if envia.send(linha).is_err() {
                        break;
                    }
                }
            });
            let erros = Arc::new(Mutex::new(String::new()));
            if let Some(mut e) = filho.stderr.take() {
                let guarda = erros.clone();
                std::thread::spawn(move || {
                    let mut buf = [0u8; 2048];
                    while let Ok(n) = e.read(&mut buf) {
                        if n == 0 {
                            break;
                        }
                        if let Ok(mut g) = guarda.lock() {
                            g.push_str(&String::from_utf8_lossy(&buf[..n]));
                            let tamanho = g.chars().count();
                            if tamanho > 4000 {
                                *g = g.chars().skip(tamanho - 4000).collect();
                            }
                        }
                    }
                });
            }
            ClaudeAberto {
                chave,
                entrada,
                linhas,
                erros,
                filho: Arc::new(Mutex::new(filho)),
                usado: std::time::Instant::now(),
                temporario: aplicacao.temporario.clone(),
            }
        }
    };

    // A pergunta, como uma linha de JSON (a sessão continua aberta depois).
    let texto = super::anexos::para_programa("claude", &pedido.prompt, &pedido.anexos);
    let linha = serde_json::json!({ "type": "user", "message": { "role": "user", "content": texto } }).to_string() + "\n";
    if aberto.entrada.write_all(linha.as_bytes()).and_then(|_| aberto.entrada.flush()).is_err() {
        aberto.fechar();
        return Err("O Claude Code fechou sozinho. Mande de novo.".into());
    }
    if let Ok(mut a) = andamento.0.lock() {
        a.insert(pedido.conversa_id.clone(), Parada::Processo(aberto.filho.clone()));
    }
    let mut leitor = Leitor {
        motor: "claude".into(),
        recebeu_parcial: false,
        escreveu_texto: false,
        erro: None,
        custo: None,
        passo: Value::Null,
        avisou_sessao: false,
    };
    // Lê até o fim desta resposta ("result"); o processo continua aberto.
    let mut terminou_bem = false;
    loop {
        match aberto.linhas.recv_timeout(std::time::Duration::from_millis(300)) {
            Ok(linha) => {
                let fim = serde_json::from_str::<Value>(&linha).is_ok_and(|v| v["type"] == "result");
                leitor.linha(&linha, canal);
                if fim {
                    terminou_bem = true;
                    break;
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                // Parar (o botão) mata o processo; a leitura acaba sozinha.
                if andamento.0.lock().map(|a| !a.contains_key(&pedido.conversa_id)).unwrap_or(false) {
                    break;
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    let parou_a_pedido = andamento.0.lock().map(|a| !a.contains_key(&pedido.conversa_id)).unwrap_or(false);
    if let Ok(mut a) = andamento.0.lock() {
        a.remove(&pedido.conversa_id);
    }
    let erro = if parou_a_pedido {
        Some("Parado.".to_string())
    } else if leitor.erro.is_some() {
        leitor.erro.clone()
    } else if !terminou_bem && !leitor.escreveu_texto {
        let erros = aberto.erros.lock().map(|e| sem_cores(&e)).unwrap_or_default();
        let fim: String = erros.trim().chars().rev().take(400).collect::<Vec<_>>().into_iter().rev().collect();
        Some(if fim.is_empty() { "O Claude Code terminou com erro.".to_string() } else { fim })
    } else {
        None
    };
    // Vivo e sem problema: fica aberto para a próxima pergunta.
    let vivo = aberto.filho.lock().ok().is_some_and(|mut f| matches!(f.try_wait(), Ok(None)));
    if vivo && terminou_bem && !parou_a_pedido {
        aberto.usado = std::time::Instant::now();
        if let Ok(mut a) = ABERTOS.lock() {
            a.get_or_insert_with(HashMap::new).insert(pedido.conversa_id.clone(), aberto);
        }
    } else {
        aberto.fechar();
    }
    let _ = canal.send(Evento::Fim { erro, custo: leitor.custo });
    Ok(())
}

fn rodar_programa(pedido: &Pedido, canal: &Channel<Evento>, andamento: &Andamento) -> Result<(), String> {
    if pedido.motor == "claude" {
        return rodar_claude_aberto(pedido, canal, andamento);
    }
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
    // No modo "pode editar", o Claude Code pergunta ao Dan, pela ilha, o que
    // precisar de permissão (rodar comandos etc.) em vez de recusar sozinho.
    let perguntar = pedido.motor == "claude" && pedido.modo == "editar";
    let aplicacao = Some(mcp::aplicar(&pedido.motor, &pedido.mcps, &pedido.mcps_da_ilha, &pedido.conversa_id, perguntar)?);
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
    // Claude Code: sempre pela conta (assinatura) em que o Dan entrou. Se o PC
    // tiver uma chave de API guardada nas variáveis do Windows, o Claude Code
    // usaria ela (e cobraria à parte); aqui ela não passa.
    if pedido.motor == "claude" {
        cmd.env_remove("ANTHROPIC_API_KEY");
        cmd.env_remove("ANTHROPIC_AUTH_TOKEN");
    }
    // O Gemini CLI escondido recusa pastas "não confiáveis" (não tem como
    // perguntar). A pasta é a do projeto escolhido pelo Dan ou a pessoal dele.
    if pedido.motor == "gemini" {
        cmd.env("GEMINI_CLI_TRUST_WORKSPACE", "true");
        // A chave paga da API do Gemini, se o Dan guardou nos Ajustes.
        if let Some(chave) = crate::maos::cofre::ler("gemini") {
            cmd.env("GEMINI_API_KEY", chave);
        }
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
    // As últimas linhas ficam guardadas: se a resposta vier vazia, vão para o registro.
    let mut ultimas: std::collections::VecDeque<String> = std::collections::VecDeque::new();
    // A saída é lida num fio à parte: assim o Parar encerra na hora, mesmo que
    // algum programa aberto por ele continue segurando a saída.
    let (envia, linhas) = std::sync::mpsc::channel::<String>();
    std::thread::spawn(move || {
        for linha in BufReader::new(saida).lines().map_while(Result::ok) {
            if envia.send(linha).is_err() {
                break;
            }
        }
    });
    let parado = || andamento.0.lock().map(|a| !a.contains_key(&pedido.conversa_id)).unwrap_or(false);
    loop {
        match linhas.recv_timeout(std::time::Duration::from_millis(300)) {
            Ok(linha) => {
                leitor.linha(&linha, canal);
                if ultimas.len() == 6 {
                    ultimas.pop_front();
                }
                ultimas.push_back(linha.chars().take(400).collect());
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) if parado() => break,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    let parou_a_pedido = parado();
    // Parado: não espera o programa (nem os erros) terminarem de fechar.
    let codigo = if parou_a_pedido { None } else { filho.lock().ok().and_then(|mut f| f.wait().ok()) };
    apagar_temporario();
    let erros = if parou_a_pedido { String::new() } else { erros_texto.join().unwrap_or_default() };
    if let Ok(mut a) = andamento.0.lock() {
        a.remove(&pedido.conversa_id);
    }

    let erro = if parou_a_pedido {
        Some("Parado.".to_string())
    } else if leitor.erro.is_some() {
        leitor.erro.clone()
    } else if codigo.is_some_and(|c| !c.success()) && !leitor.escreveu_texto {
        let limpo = sem_cores(&erros);
        let fim: String = limpo.trim().chars().rev().take(400).collect::<Vec<_>>().into_iter().rev().collect();
        Some(if fim.is_empty() { format!("O {nome} terminou com erro.") } else { fim })
    } else if !leitor.escreveu_texto {
        log::warn!("{nome} terminou sem resposta. Últimas linhas: {}", ultimas.iter().cloned().collect::<Vec<_>>().join(" | "));
        Some(format!("O {nome} terminou, mas a ilha não conseguiu ler a resposta. Mande o registro de erros (Ajustes › Sobre) para o Claude."))
    } else {
        None
    };
    if erro.is_some() && !erros.is_empty() {
        log::warn!("{nome}: {}", erros.chars().take(800).collect::<String>());
    }
    let _ = canal.send(Evento::Fim { erro, custo: leitor.custo });
    Ok(())
}

/// Tira os códigos de cor do terminal (ex.: "\x1b[31m") das mensagens de erro.
fn sem_cores(texto: &str) -> String {
    let mut saida = String::with_capacity(texto.len());
    let mut chars = texto.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                while let Some(&d) = chars.peek() {
                    chars.next();
                    if d.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        saida.push(c);
    }
    saida
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
            // Num fio à parte: matar a árvore de programas leva um instante.
            std::thread::spawn(move || {
                if let Ok(mut f) = filho.lock() {
                    matar_arvore(&mut f);
                }
            });
        }
        Some(Parada::Sinal(s)) => s.store(true, Ordering::Relaxed),
        None => {}
    }
}

/// Instala o Claude Code ou o Codex pelo instalador oficial de cada um, sem
/// janela (a ilha mostra o andamento). A ilha só chama isto depois de o Dan
/// confirmar. Leva de 1 a 3 minutos.
#[tauri::command]
pub async fn instalar_motor(motor: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || instalar_motor_agora(&motor))
        .await
        .map_err(|e| e.to_string())?
}

fn instalar_motor_agora(motor: &str) -> Result<(), String> {
    let roteiro = match motor {
        "claude" => "$ErrorActionPreference='Stop'; irm https://claude.ai/install.ps1 | iex",
        "codex" => {
            "$ErrorActionPreference='Stop'; try { irm https://chatgpt.com/codex/install.ps1 | iex } \
             catch { if (Get-Command npm -ErrorAction SilentlyContinue) { npm install -g @openai/codex } else { throw } }"
        }
        _ => return Err("A ilha não sabe instalar esse.".into()),
    };
    let mut c = Command::new("powershell.exe");
    c.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", roteiro]);
    sem_janela(&mut c);
    let saida = c.output().map_err(|e| format!("Não consegui abrir o instalador: {e}"))?;
    let nome = nome_do_programa(motor).unwrap_or(motor);
    // O PATH é relido do Windows: o programa recém-instalado já aparece.
    if executavel(nome).is_some() {
        log::info!("{nome} instalado pela ilha");
        return Ok(());
    }
    let texto = format!("{}\n{}", String::from_utf8_lossy(&saida.stdout), String::from_utf8_lossy(&saida.stderr));
    let fim: String = texto.trim().chars().rev().take(300).collect::<Vec<_>>().into_iter().rev().collect();
    log::warn!("Instalar {nome}: {texto}");
    Err(if fim.is_empty() {
        format!("O instalador terminou, mas não achei o {nome}. Tente de novo.")
    } else {
        format!("O instalador não terminou: {fim}")
    })
}

/// Abre o login da conta no navegador (Claude: `claude auth login`; Codex:
/// `codex login`). O programa fica esperando o Dan entrar no navegador e sai
/// sozinho; a ilha confere com `conta_motor`.
#[tauri::command]
pub fn entrar_motor(motor: String) -> Result<(), String> {
    let nome = nome_do_programa(&motor).ok_or("Esse não tem conta para entrar.")?;
    let exe = executavel(nome).ok_or_else(|| format!("Não encontrei o {nome}."))?;
    let args: Vec<String> = match motor.as_str() {
        "claude" => vec!["auth".into(), "login".into()],
        "codex" => vec!["login".into()],
        _ => return Err("Esse não tem conta para entrar.".into()),
    };
    let mut c = comando(&exe, &args);
    if motor == "claude" {
        c.env_remove("ANTHROPIC_API_KEY");
    }
    c.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    c.spawn().map(|_| ()).map_err(|e| format!("Não consegui abrir o login: {e}"))
}

/// Já entrou na conta? `None` = não dá para saber (programa sem esse comando).
#[tauri::command]
pub async fn conta_motor(motor: String) -> Option<bool> {
    tauri::async_runtime::spawn_blocking(move || conta_motor_agora(&motor)).await.ok().flatten()
}

fn conta_motor_agora(motor: &str) -> Option<bool> {
    let args: Vec<String> = match motor {
        "claude" => vec!["auth".into(), "status".into()],
        "codex" => vec!["login".into(), "status".into()],
        // Gemini CLI: só funciona com a chave paga da API (guardada no cofre).
        "gemini" => return Some(crate::maos::cofre::ler("gemini").is_some() || std::env::var_os("GEMINI_API_KEY").is_some()),
        _ => return None,
    };
    let exe = executavel(nome_do_programa(motor)?)?;
    let mut c = comando(&exe, &args);
    if motor == "claude" {
        c.env_remove("ANTHROPIC_API_KEY");
    }
    let mut filho = c.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().ok()?;
    let comeco = std::time::Instant::now();
    loop {
        if let Ok(Some(s)) = filho.try_wait() {
            return Some(s.success());
        }
        if comeco.elapsed() > std::time::Duration::from_secs(20) {
            let _ = filho.kill();
            return None;
        }
        std::thread::sleep(std::time::Duration::from_millis(150));
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

    #[test]
    fn le_o_formato_do_antigravity_e_tira_cores() {
        use std::sync::{Arc, Mutex};
        let recebido = Arc::new(Mutex::new(String::new()));
        let r = recebido.clone();
        let canal: tauri::ipc::Channel<super::Evento> = tauri::ipc::Channel::new(move |corpo| {
            if let tauri::ipc::InvokeResponseBody::Json(j) = corpo {
                r.lock().unwrap().push_str(&j);
            }
            Ok(())
        });
        let mut l = super::Leitor {
            motor: "antigravity".into(),
            recebeu_parcial: false,
            escreveu_texto: false,
            erro: None,
            custo: None,
            passo: serde_json::Value::Null,
            avisou_sessao: false,
        };
        l.linha(r#"{"event":"init","conversation_id":"abc","init":{"cwd":"C:/"}}"#, &canal);
        l.linha(r#"{"event":"step_update","step_update":{"conversation_id":"abc","step_index":1,"state":"ACTIVE","step_type":"agent_response","text_delta":"Olá, "}}"#, &canal);
        l.linha(r#"{"event":"step_update","step_update":{"conversation_id":"abc","step_index":1,"state":"DONE","step_type":"agent_response","text_delta":"Dan!"}}"#, &canal);
        l.linha(r#"{"event":"result","result":{"conversation_id":"abc","status":"SUCCESS","response":"Olá, Dan!"}}"#, &canal);
        let tudo = recebido.lock().unwrap().clone();
        assert!(l.escreveu_texto && l.erro.is_none());
        assert!(tudo.contains("Olá, ") && tudo.contains("Dan!") && tudo.contains("abc"), "{tudo}");
        // A resposta final não repete o texto que já veio aos pedaços.
        assert_eq!(tudo.matches("Dan!").count(), 1, "{tudo}");
        assert_eq!(super::sem_cores("\u{1b}[31mGemini CLI\u{1b}[0m ok"), "Gemini CLI ok");
    }
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
        let o = argumentos("antigravity", None, false, "Orchestrator (Argon)", "high");
        assert!(o.windows(2).any(|w| w == ["--model", "Orchestrator (Argon)"]));
        assert!(!o.iter().any(|a| a == "--effort"));
        assert!(!argumentos("antigravity", None, false, "x (y); rm", "").iter().any(|a| a == "--model"));
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
