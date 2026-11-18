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

/// O que a IA quer fazer, COMPLETO (o Dan precisa ver tudo antes de aprovar).
/// Só corta textos enormes, e avisa quando corta.
pub fn resumir(ferramenta: &str, entrada: &Value) -> String {
    const LIMITE: usize = 6000;
    let cortar = |t: &str| {
        if t.chars().count() > LIMITE {
            format!("{}\n… (cortado: o pedido é muito longo; na dúvida, responda Não)", t.chars().take(LIMITE).collect::<String>())
        } else {
            t.to_string()
        }
    };
    // Comando ou arquivo: mostra o principal primeiro e o resto embaixo.
    if let Some(objeto) = entrada.as_object() {
        if let Some(principal) = ["command", "file_path", "path", "url"].iter().find_map(|c| objeto.get(*c).and_then(|v| v.as_str())) {
            let resto: serde_json::Map<String, Value> = objeto
                .iter()
                .filter(|(k, _)| !["command", "file_path", "path", "url", "description"].contains(&k.as_str()))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect();
            let extra = if resto.is_empty() { String::new() } else { format!("\n\n{}", serde_json::to_string_pretty(&resto).unwrap_or_default()) };
            return cortar(&format!("{principal}{extra}"));
        }
    }
    let texto = serde_json::to_string_pretty(entrada).unwrap_or_default();
    if texto == "null" || texto == "{}" {
        ferramenta.to_string()
    } else {
        cortar(&texto)
    }
}

/// O outro lado (o processo do Claude Code) desistiu? (conexão fechada)
fn cliente_saiu(conexao: &TcpStream) -> bool {
    let mut b = [0u8; 1];
    if conexao.set_nonblocking(true).is_err() {
        return false;
    }
    let saiu = match conexao.peek(&mut b) {
        Ok(0) => true,
        Ok(_) => false,
        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => false,
        Err(_) => true,
    };
    let _ = conexao.set_nonblocking(false);
    saiu
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
    // Espera a resposta, conferindo a cada segundo se a IA não foi parada.
    let comeco = std::time::Instant::now();
    let permitir = loop {
        match receber.recv_timeout(Duration::from_secs(1)) {
            Ok(r) => break r,
            Err(_) if comeco.elapsed() >= ESPERA_MAXIMA || cliente_saiu(&conexao) => break false,
            Err(_) => {}
        }
    };
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

// ---------- O que pede confirmação ----------
//
// O Dan quer a ilha livre para fazer tudo no PC (abrir programas, procurar,
// instalar, editar arquivos, rodar comandos) sem perguntar a cada passo. Só o
// que não tem volta pede o "Posso…?" (regra do CLAUDE.md): apagar, enviar ou
// publicar, pagar e mudar configurações do Windows. Na dúvida sobre um comando
// escondido (codificado), pergunta.

/// Comandos que apagam, desligam ou mexem no Windows (nome do comando, minúsculo).
const SEM_VOLTA: [&str; 52] = [
    // apagar
    "rm", "rmdir", "rd", "del", "erase", "ri", "remove-item", "clear-content", "clear-recyclebin", "format", "format-volume",
    "clear-disk", "initialize-disk", "diskpart", "cipher", "remove-partition",
    // desligar
    "shutdown", "stop-computer", "restart-computer", "logoff",
    // configurações do Windows
    "reg", "regedit", "set-itemproperty", "new-itemproperty", "remove-itemproperty", "rename-itemproperty",
    "set-executionpolicy", "set-winuserlanguagelist", "setx", "netsh", "bcdedit", "powercfg", "sc", "set-service",
    "new-service", "schtasks", "register-scheduledtask", "set-mppreference", "add-mppreference", "new-netfirewallrule",
    "set-netfirewallrule", "set-netfirewallprofile", "takeown", "icacls", "new-localuser", "set-localuser",
    "add-localgroupmember", "dism", "set-timezone", "set-date", "wmic", "set-winsystemlocale",
];
/// Começos de comando do PowerShell que desfazem ou desligam algo.
const COMECOS_SEM_VOLTA: [&str; 4] = ["remove-", "uninstall-", "unregister-", "disable-"];
/// Programas que enviam algo para fora (internet), quando usados para mandar dados.
const MANDAM_PELA_INTERNET: [&str; 7] = ["curl", "wget", "invoke-webrequest", "iwr", "invoke-restmethod", "irm", "send-mailmessage"];

fn palavras(comando: &str) -> Vec<String> {
    comando
        .to_lowercase()
        .split(|c: char| c.is_whitespace() || "|;&(){}'\"`,=".contains(c))
        .filter(|p| !p.is_empty())
        .map(|p| p.trim_end_matches(".exe").to_string())
        .collect()
}

/// O comando faz algo que não tem volta? (apagar, enviar/publicar, mudar o Windows)
pub fn comando_sem_volta(comando: &str) -> bool {
    let p = palavras(comando);
    let tem = |w: &str| p.iter().any(|x| x == w);
    let depois = |a: &str, bs: &[&str]| p.windows(2).any(|j| j[0] == a && bs.contains(&j[1].as_str()));
    // Comando escondido (codificado): não dá para saber o que faz.
    if p.iter().any(|x| matches!(x.as_str(), "-encodedcommand" | "-enc" | "-ec" | "-e")) && (tem("powershell") || tem("pwsh")) {
        return true;
    }
    if p.iter().any(|x| SEM_VOLTA.contains(&x.as_str()) || (COMECOS_SEM_VOLTA.iter().any(|c| x.starts_with(c)))) {
        return true;
    }
    // Registro do Windows (HKLM:, HKCU:) sendo mudado.
    if p.iter().any(|x| x.starts_with("hklm:") || x.starts_with("hkcu:") || x.starts_with("registry::"))
        && p.iter().any(|x| x.starts_with("set-") || x.starts_with("new-") || x.starts_with("remove-"))
    {
        return true;
    }
    // git: enviar ou jogar fora alterações.
    if depois("git", &["push", "clean", "restore", "rm"])
        || (tem("git") && (tem("--hard") || tem("--force") || tem("-d") || tem("drop") || tem("clear")))
        || (tem("git") && tem("checkout") && tem("--"))
    {
        return true;
    }
    // Publicar pacotes, sites e programas.
    if tem("publish") || tem("deploy") || depois("docker", &["push"]) || depois("twine", &["upload"]) {
        return true;
    }
    // GitHub pela linha de comando: criar, juntar, apagar, comentar.
    if tem("gh") && p.iter().any(|x| matches!(x.as_str(), "create" | "merge" | "delete" | "close" | "comment" | "edit" | "release" | "review")) {
        return true;
    }
    // Mandar dados pela internet (baixar é livre; enviar, não).
    if p.iter().any(|x| MANDAM_PELA_INTERNET.contains(&x.as_str())) {
        let envia = tem("send-mailmessage")
            || p.iter().any(|x| {
                matches!(
                    x.as_str(),
                    "post" | "put" | "delete" | "patch" | "-d" | "--data" | "--data-raw" | "--data-binary" | "--form" | "--upload-file" | "-t" | "-body" | "-infile"
                )
            });
        if envia {
            return true;
        }
    }
    // Copiar arquivos para outro computador.
    p.iter().any(|x| matches!(x.as_str(), "scp" | "sftp" | "ftp" | "rsync"))
}

/// Ferramentas de conectores (Gmail, GitHub…) que mandam, apagam ou pagam.
fn ferramenta_sem_volta(nome: &str) -> bool {
    let n = nome.to_lowercase();
    [
        "send", "delete", "remove", "trash", "publish", "pay", "purchase", "buy", "checkout", "merge", "push", "post", "reply",
        "forward", "share", "archive", "transfer", "cancel", "create_pull", "comment", "invite", "spam", "unsubscribe",
    ]
    .iter()
    .any(|v| n.contains(v))
}

/// Pode fazer sem perguntar? Tudo, menos o que não tem volta.
pub fn seguro_sem_perguntar(ferramenta: &str, entrada: &Value) -> bool {
    match ferramenta {
        "Bash" | "PowerShell" => !comando_sem_volta(entrada["command"].as_str().unwrap_or_default()),
        f if f.starts_with("mcp__") => !ferramenta_sem_volta(f),
        _ => true,
    }
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
            // Só olhar (listar, ler, pesquisar) não precisa de permissão: com voz,
            // perguntar a cada "listar pasta" deixaria a conversa impossível.
            if seguro_sem_perguntar(ferramenta, &entrada) {
                resposta_da_ferramenta(Ok(true), &entrada)
            } else {
                resposta_da_ferramenta(perguntar(ferramenta, &entrada), &entrada)
            }
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
    // As mensagens são atendidas noutra linha de execução; esta só lê a entrada.
    // Se a entrada fechar (Claude Code parado), o processo sai na hora — e a
    // ilha percebe a conexão fechada e tira a pergunta da tela.
    let (enviar, receber) = channel::<Value>();
    let atendente = std::thread::spawn(move || {
        let mut saida = std::io::stdout();
        for msg in receber {
            let perguntar = |ferramenta: &str, e: &Value| perguntar_a_ilha(&conversa, ferramenta, e);
            if let Some(resposta) = responder_mcp(&msg, &conversa, &perguntar) {
                let _ = writeln!(saida, "{resposta}");
                let _ = saida.flush();
            }
        }
    });
    for linha in std::io::stdin().lock().lines().map_while(Result::ok) {
        if let Ok(msg) = serde_json::from_str::<Value>(&linha) {
            let _ = enviar.send(msg);
        }
    }
    // Entrada acabou: espera um instante a última resposta e sai.
    drop(enviar);
    let _ = std::thread::spawn(move || atendente.join());
    std::thread::sleep(Duration::from_millis(300));
    std::process::exit(0)
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
        let chamada = json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"aprovar","arguments":{"tool_name":"Bash","input":{"command":"npm publish"}}}});
        let r = responder_mcp(&chamada, "c", &sim).unwrap();
        let texto: Value = serde_json::from_str(r["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(texto["behavior"], "allow");
        assert_eq!(texto["updatedInput"]["command"], "npm publish");
        let nao = |_: &str, _: &Value| Ok(false);
        let r = responder_mcp(&chamada, "c", &nao).unwrap();
        assert!(r["result"]["content"][0]["text"].as_str().unwrap().contains("deny"));
    }

    #[test]
    fn so_o_que_nao_tem_volta_pergunta() {
        use serde_json::json;
        let b = |c: &str| super::seguro_sem_perguntar("Bash", &json!({ "command": c }));
        // Livre: olhar, abrir, instalar, rodar.
        assert!(b("ls -la"));
        assert!(b("git status"));
        assert!(b("Get-StartApps | Where-Object { $_.Name -match 'gemini' }"));
        assert!(b("Start-Process 'shell:AppsFolder\\Google.Gemini'"));
        assert!(b("npm install"));
        assert!(b("winget install Spotify.Spotify"));
        assert!(b("git add . && git commit -m 'x'"));
        assert!(b("curl -L https://exemplo.com/arquivo.zip -o a.zip"));
        assert!(b("ls > lista.txt"));
        assert!(b("Stop-Process -Name chrome"));
        assert!(b("Clear-Host"));
        // Pergunta: apagar, enviar/publicar, mudar o Windows.
        assert!(!b("rm -rf pasta"));
        assert!(!b("Remove-Item x -Recurse"));
        assert!(!b("cmd /c del /q arquivo.txt"));
        assert!(!b("git push"));
        assert!(!b("git reset --hard HEAD~1"));
        assert!(!b("npm publish"));
        assert!(!b("curl -X POST https://api.x.com -d '{}'"));
        assert!(!b("Invoke-RestMethod -Method Post -Uri https://x -Body $b"));
        assert!(!b("Set-ItemProperty -Path HKCU:\\Software\\X -Name a -Value 1"));
        assert!(!b("reg add HKCU\\Software\\X"));
        assert!(!b("shutdown /s /t 0"));
        assert!(!b("Uninstall-Package x"));
        assert!(!b("powershell -enc ZQBjAGgAbwA="));
        assert!(!b("gh pr create --title x"));
        let t = |n: &str| super::seguro_sem_perguntar(n, &json!({}));
        assert!(t("WebSearch") && t("Write") && t("Edit") && t("Read"));
        assert!(t("mcp__Gmail__search_threads"));
        assert!(!t("mcp__Gmail__send_message"));
        assert!(!t("mcp__github__merge_pull_request"));
    }

    #[test]
    fn resume_o_pedido() {
        assert_eq!(resumir("Bash", &json!({"command": "rm -rf build"})), "rm -rf build");
        let w = resumir("Write", &json!({"file_path": "C:/a.txt", "content": "x"}));
        assert!(w.starts_with("C:/a.txt") && w.contains("\"content\": \"x\""));
        let longo = "a".repeat(7000);
        assert!(resumir("Bash", &json!({ "command": longo })).contains("cortado"));
    }
}
