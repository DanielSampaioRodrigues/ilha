//! Avisos que outros programas mandam para a ilha pela linha de comando.
//!
//! Exemplo (é o que o Claude Code chama quando termina uma tarefa):
//!   ilha.exe --aviso claude-code
//!   ilha.exe --aviso "Backup concluído" --detalhe "Pasta Fotos"
//!
//! Se a ilha já estiver aberta, o aviso é repassado para ela e o novo processo
//! fecha na hora. Se não estiver, a ilha abre já mostrando o aviso.

use std::path::Path;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

#[derive(Clone, Serialize)]
pub struct Aviso {
    pub titulo: String,
    pub detalhe: String,
}

/// Aviso que chegou antes de a interface estar pronta para mostrar.
#[derive(Default)]
pub struct AvisoPendente(pub Mutex<Option<Aviso>>);

fn valor_depois(args: &[String], chave: &str) -> Option<String> {
    args.iter()
        .position(|a| a == chave)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

fn nome_da_pasta(pasta: &str) -> String {
    Path::new(pasta)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// Lê "--aviso" dos argumentos. `pasta` é de onde o programa foi chamado
/// (no caso do Claude Code, a pasta do projeto).
pub fn ler(args: &[String], pasta: &str) -> Option<Aviso> {
    let tipo = valor_depois(args, "--aviso")?;
    let projeto = nome_da_pasta(pasta);
    let aviso = match tipo.as_str() {
        "claude-code" => Aviso {
            titulo: "Claude Code terminou".into(),
            detalhe: projeto,
        },
        "claude-code-espera" => Aviso {
            titulo: "Claude Code está esperando você".into(),
            detalhe: projeto,
        },
        "codex" => Aviso {
            titulo: "Codex terminou".into(),
            detalhe: projeto,
        },
        "gemini" => Aviso {
            titulo: "Gemini terminou".into(),
            detalhe: projeto,
        },
        "gemini-espera" => Aviso {
            titulo: "Gemini está esperando você".into(),
            detalhe: projeto,
        },
        _ => Aviso {
            titulo: tipo,
            detalhe: valor_depois(args, "--detalhe").unwrap_or_default(),
        },
    };
    Some(aviso)
}

pub fn mostrar(app: &AppHandle, aviso: Aviso) {
    let _ = app.emit("ilha:notificar", aviso);
}

/// A interface pergunta isto ao ligar, para mostrar um aviso que chegou cedo demais.
#[tauri::command]
pub fn aviso_pendente(estado: State<'_, AvisoPendente>) -> Option<Aviso> {
    estado.0.lock().ok().and_then(|mut a| a.take())
}

/// Quando outro programa chama a ilha com "--aviso", ele espera o processo
/// terminar (o Claude Code espera até 60 s). Para não prender quem chamou,
/// a ilha se relança "solta" e o processo original sai na hora.
/// Devolve true quando o processo atual deve encerrar.
pub fn soltar_se_chamada_por_outro_programa() -> bool {
    let args: Vec<String> = std::env::args().collect();
    if !args.iter().any(|a| a == "--aviso") || args.iter().any(|a| a == "--solta") {
        return false;
    }
    // Se a ilha entrou na frente de outro aviso (ex.: o computer-use do Codex),
    // chama o original também, com os mesmos dados que o programa mandou.
    repassar(&args);

    // O Gemini CLI espera uma resposta em JSON; "{}" quer dizer "nada a fazer".
    {
        use std::io::Write;
        let mut saida = std::io::stdout();
        let _ = saida.write_all(b"{}");
        let _ = saida.flush();
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        if let Ok(exe) = std::env::current_exe() {
            let lancado = std::process::Command::new(exe)
                .args(&args[1..])
                .arg("--solta")
                .creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)
                .spawn();
            return lancado.is_ok();
        }
    }
    false
}

fn repassar(args: &[String]) {
    let Some(original) = crate::maos::integracoes::original_guardado(args) else { return };
    let Some((programa, fixos)) = original.split_first() else { return };
    // O que vem depois do valor guardado é o que o programa mandou (ex.: o JSON do Codex).
    let extras = args
        .iter()
        .position(|a| a == crate::maos::integracoes::REPASSAR)
        .map(|i| &args[(i + 2).min(args.len())..])
        .unwrap_or(&[]);
    let mut comando = std::process::Command::new(programa);
    comando.args(fixos).args(extras);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        comando.creation_flags(CREATE_NO_WINDOW);
    }
    if let Err(erro) = comando.spawn() {
        log::warn!("Não consegui repassar o aviso para {programa}: {erro}");
    }
}

#[cfg(test)]
mod testes {
    use super::ler;

    fn args(lista: &[&str]) -> Vec<String> {
        lista.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn entende_os_avisos() {
        let a = ler(&args(&["ilha.exe", "--aviso", "claude-code", "--solta"]), "C:/Projetos/ilha").unwrap();
        assert_eq!(a.titulo, "Claude Code terminou");
        assert_eq!(a.detalhe, "ilha");
        let b = ler(&args(&["ilha.exe", "--aviso", "Backup", "--detalhe", "Fotos"]), "").unwrap();
        assert_eq!((b.titulo.as_str(), b.detalhe.as_str()), ("Backup", "Fotos"));
        assert!(ler(&args(&["ilha.exe"]), "").is_none());
    }
}
