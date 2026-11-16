//! "Posso?": quando uma IA (Claude Code) quer fazer algo que precisa de
//! permissão — rodar um comando, apagar, mexer fora da pasta — a ilha pergunta
//! ao Dan, com botões Sim e Não.
//!
//! Como funciona:
//! 1. A ilha, ao ligar, abre uma "porta" só deste computador (127.0.0.1) e anota
//!    o número e uma senha aleatória num arquivo da pasta temporária do Dan.
//! 2. O Claude Code chama a ferramenta MCP "aprovar" da própria ilha
//!    (`ilha.exe --mcp-permissao`, ligada pela opção --permission-prompt-tool).
//! 3. Esse processo pequeno bate na porta, a ilha mostra a pergunta, o Dan
//!    responde, e a resposta volta para o Claude Code.
//!
//! Sem resposta em 10 minutos, ou com a ilha fechada, a resposta é "não".

use std::collections::HashMap;
use std::hash::{BuildHasher, Hasher};
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

const ESPERA_MAXIMA: Duration = Duration::from_secs(600);
const NOME_DA_FERRAMENTA: &str = "aprovar";
/// Nome do servidor MCP no arquivo de configuração passado ao Claude Code.
pub const SERVIDOR: &str = "ilha";

/// Respostas esperando o clique do Dan (id → onde mandar a resposta).
#[derive(Default)]
pub struct Esperando(Mutex<HashMap<String, Sender<bool>>>);

#[derive(Serialize, Deserialize)]
struct Endereco {
    porta: u16,
    senha: String,
}

#[derive(Deserialize)]
struct PedidoDePermissao {
    senha: String,
    conversa: String,
    ferramenta: String,
    #[serde(default)]
    entrada: Value,
}

/// O que a ilha mostra para o Dan.
#[derive(Clone, Serialize)]
pub struct Pergunta {
    pub id: String,
    pub conversa: String,
    pub ferramenta: String,
    /// Resumo legível (o comando, o arquivo…).
    pub detalhe: String,
}

fn arquivo_do_endereco() -> PathBuf {
    std::env::temp_dir().join("ilha-permissao.json")
}

fn senha_aleatoria() -> String {
    let mut texto = String::new();
    for _ in 0..4 {
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos());
        texto.push_str(&format!("{:016x}", h.finish()));
    }
    texto
}

/// Resumo curto do que a IA quer fazer.
pub fn resumir(ferramenta: &str, entrada: &Value) -> String {
    for chave in ["command", "file_path", "path", "url", "pattern", "query", "description"] {
        if let Some(v) = entrada.get(chave).and_then(|v| v.as_str()) {
            return v.chars().take(300).collect();
        }
    }
    let texto = entrada.to_string();
    if texto == "null" || texto == "{}" {
        ferramenta.to_string()
    } else {
        texto.chars().take(300).collect()
    }
}

/// Abre a porta e fica atendendo (chamado ao ligar a ilha).
pub fn iniciar(app: AppHandle) {
    let Ok(porta) = TcpListener::bind("127.0.0.1:0") else {
        log::warn!("Não consegui abrir a porta das permissões.");
        return;
    };
    let senha = senha_aleatoria();
    let endereco = Endereco { porta: porta.local_addr().map(|a| a.port()).unwrap_or(0), senha: senha.clone() };
    if let Err(e) = std::fs::write(arquivo_do_endereco(), serde_json::to_string(&endereco).unwrap_or_default()) {
        log::warn!("Não consegui anotar a porta das permissões: {e}");
        return;
    }
    std::thread::spawn(move || {
        for conexao in porta.incoming().flatten() {
            let app = app.clone();
            let senha = senha.clone();
            std::thread::spawn(move || atender(app, conexao, &senha));
        }
    });
}

fn atender(app: AppHandle, conexao: TcpStream, senha: &str) {
    let _ = conexao.set_read_timeout(Some(Duration::from_secs(10)));
    let mut leitor = BufReader::new(&conexao);
    let mut linha = String::new();
    if leitor.read_line(&mut linha).is_err() {
        return;
    }
    let Ok(pedido) = serde_json::from_str::<PedidoDePermissao>(&linha) else { return };
    if pedido.senha != senha {
        return;
    }
    let id = senha_aleatoria()[..12].to_string();
    let (enviar, receber) = channel();
    if let Ok(mut e) = app.state::<Esperando>().0.lock() {
        e.insert(id.clone(), enviar);
    }
    let pergunta = Pergunta {
        id: id.clone(),
        conversa: pedido.conversa,
        detalhe: resumir(&pedido.ferramenta, &pedido.entrada),
        ferramenta: pedido.ferramenta,
    };
    let _ = app.emit("ilha:permissao", pergunta);
    let permitir = receber.recv_timeout(ESPERA_MAXIMA).unwrap_or(false);
    if let Ok(mut e) = app.state::<Esperando>().0.lock() {
        e.remove(&id);
    }
    let _ = app.emit("ilha:permissao-fim", id);
    let mut escrita = &conexao;
    let _ = writeln!(escrita, "{}", json!({ "permitir": permitir }));
}

/// O Dan clicou Sim ou Não.
#[tauri::command]
pub fn responder_permissao(id: String, permitir: bool, esperando: State<'_, Esperando>) {
    if let Some(enviar) = esperando.0.lock().ok().and_then(|mut e| e.remove(&id)) {
        let _ = enviar.send(permitir);
    }
}

// ---------- O servidor MCP (processo pequeno chamado pelo Claude Code) ----------

/// Pergunta à ilha (que está aberta) e espera a resposta.
fn perguntar_a_ilha(conversa: &str, ferramenta: &str, entrada: &Value) -> Result<bool, String> {
    let texto = std::fs::read_to_string(arquivo_do_endereco()).map_err(|_| "A ilha não está aberta.".to_string())?;
    let endereco: Endereco = serde_json::from_str(&texto).map_err(|e| e.to_string())?;
    let conexao = TcpStream::connect(("127.0.0.1", endereco.porta)).map_err(|_| "A ilha não está aberta.".to_string())?;
    let _ = conexao.set_read_timeout(Some(ESPERA_MAXIMA + Duration::from_secs(30)));
    let mut escrita = &conexao;
    writeln!(
        escrita,
        "{}",
        json!({ "senha": endereco.senha, "conversa": conversa, "ferramenta": ferramenta, "entrada": entrada })
    )
    .map_err(|e| e.to_string())?;
    let mut linha = String::new();
    BufReader::new(&conexao).read_line(&mut linha).map_err(|e| e.to_string())?;
    let v: Value = serde_json::from_str(&linha).map_err(|_| "A ilha não respondeu.".to_string())?;
    Ok(v["permitir"].as_bool().unwrap_or(false))
}

/// Resposta da ferramenta "aprovar" no formato que o Claude Code espera.
pub fn resposta_da_ferramenta(permitir: Result<bool, String>, entrada: &Value) -> Value {
    let decisao = match permitir {
        Ok(true) => json!({ "behavior": "allow", "updatedInput": entrada }),
        Ok(false) => json!({ "behavior": "deny", "message": "O Dan não autorizou isso pela ilha." }),
        Err(e) => json!({ "behavior": "deny", "message": e }),
    };
    json!({ "content": [{ "type": "text", "text": decisao.to_string() }] })
}

/// Responde uma mensagem JSON-RPC do protocolo MCP (None = notificação, sem resposta).
pub fn responder_mcp(msg: &Value, conversa: &str, perguntar: &dyn Fn(&str, &Value) -> Result<bool, String>) -> Option<Value> {
    let id = msg.get("id")?.clone();
    let metodo = msg["method"].as_str().unwrap_or_default();
    let resultado = match metodo {
        "initialize" => json!({
            "protocolVersion": msg["params"]["protocolVersion"].as_str().unwrap_or("2025-06-18"),
            "capabilities": { "tools": {} },
            "serverInfo": { "name": SERVIDOR, "version": env!("CARGO_PKG_VERSION") },
        }),
        "ping" => json!({}),
        "tools/list" => json!({
            "tools": [{
                "name": NOME_DA_FERRAMENTA,
                "description": "Pergunta ao Dan, pela ilha, se pode usar uma ferramenta.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "tool_name": { "type": "string" },
                        "input": { "type": "object" },
                        "tool_use_id": { "type": "string" }
                    }
                }
            }]
        }),
        "tools/call" => {
            // A documentação não lista os nomes dos campos: aceita as variações comuns.
            let args = &msg["params"]["arguments"];
            let ferramenta = args["tool_name"].as_str().or_else(|| args["toolName"].as_str()).unwrap_or("ferramenta");
            let entrada = [&args["input"], &args["tool_input"], &args["toolInput"]]
                .into_iter()
                .find(|v| !v.is_null())
                .cloned()
                .unwrap_or_else(|| json!({}));
            resposta_da_ferramenta(perguntar(ferramenta, &entrada), &entrada)
        }
        _ => {
            return Some(json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": format!("Método desconhecido: {metodo}") } }));
        }
    };
    let _ = conversa;
    Some(json!({ "jsonrpc": "2.0", "id": id, "result": resultado }))
}

/// `ilha.exe --mcp-permissao <conversa>`: vira um servidor MCP pela entrada e
/// saída padrão e não abre a ilha. Devolve true se foi esse o caso.
pub fn servidor_mcp_se_pedido() -> bool {
    let args: Vec<String> = std::env::args().collect();
    let Some(pos) = args.iter().position(|a| a == "--mcp-permissao") else { return false };
    let conversa = args.get(pos + 1).cloned().unwrap_or_default();
    let entrada = std::io::stdin();
    let mut saida = std::io::stdout();
    for linha in entrada.lock().lines().map_while(Result::ok) {
        let Ok(msg) = serde_json::from_str::<Value>(&linha) else { continue };
        let perguntar = |ferramenta: &str, e: &Value| perguntar_a_ilha(&conversa, ferramenta, e);
        if let Some(resposta) = responder_mcp(&msg, &conversa, &perguntar) {
            let _ = writeln!(saida, "{resposta}");
            let _ = saida.flush();
        }
    }
    true
}

/// Arquivo de configuração MCP com o servidor de permissões da ilha.
pub fn configuracao_mcp(conversa: &str) -> Option<Value> {
    let exe = std::env::current_exe().ok()?;
    Some(json!({
        "command": exe.to_string_lossy(),
        "args": ["--mcp-permissao", conversa],
    }))
}

/// Nome completo da ferramenta para o "--permission-prompt-tool".
pub fn nome_completo() -> String {
    format!("mcp__{SERVIDOR}__{NOME_DA_FERRAMENTA}")
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn conversa_mcp_completa() {
        let sim = |_: &str, _: &Value| Ok(true);
        let ini = responder_mcp(&json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}), "c", &sim).unwrap();
        assert_eq!(ini["result"]["protocolVersion"], "2025-06-18");
        assert!(responder_mcp(&json!({"jsonrpc":"2.0","method":"notifications/initialized"}), "c", &sim).is_none());
        let lista = responder_mcp(&json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}), "c", &sim).unwrap();
        assert_eq!(lista["result"]["tools"][0]["name"], "aprovar");
        let chamada = json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"aprovar","arguments":{"tool_name":"Bash","input":{"command":"ls"}}}});
        let r = responder_mcp(&chamada, "c", &sim).unwrap();
        let texto: Value = serde_json::from_str(r["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(texto["behavior"], "allow");
        assert_eq!(texto["updatedInput"]["command"], "ls");
        let nao = |_: &str, _: &Value| Ok(false);
        let r = responder_mcp(&chamada, "c", &nao).unwrap();
        assert!(r["result"]["content"][0]["text"].as_str().unwrap().contains("deny"));
    }

    #[test]
    fn resume_o_pedido() {
        assert_eq!(resumir("Bash", &json!({"command": "rm -rf build"})), "rm -rf build");
        assert_eq!(resumir("Write", &json!({"file_path": "C:/a.txt", "content": "x"})), "C:/a.txt");
    }
}
