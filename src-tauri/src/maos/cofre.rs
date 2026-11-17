//! Cofre de chaves de IA: guarda no Gerenciador de Credenciais do Windows
//! (o mesmo cofre de senhas que o Windows usa). A chave nunca volta para a
//! interface: só o lado Rust lê, na hora de chamar a IA.

const PREFIXO: &str = "Ilha/";

/// Provedores aceitos (nome usado no cofre).
pub const PROVEDORES: [&str; 3] = ["deepseek", "elevenlabs", "gemini"];

fn validar(provedor: &str) -> Result<(), String> {
    if PROVEDORES.contains(&provedor) {
        Ok(())
    } else {
        Err("Provedor desconhecido.".into())
    }
}

pub fn ler(provedor: &str) -> Option<String> {
    sistema::ler(&format!("{PREFIXO}{provedor}"))
}

#[tauri::command]
pub fn salvar_chave(provedor: String, chave: String) -> Result<(), String> {
    validar(&provedor)?;
    let chave = chave.trim();
    if chave.len() < 10 {
        return Err("Essa chave parece incompleta.".into());
    }
    sistema::gravar(&format!("{PREFIXO}{provedor}"), chave)
}

#[tauri::command]
pub fn tem_chave(provedor: String) -> bool {
    validar(&provedor).is_ok() && ler(&provedor).is_some()
}

#[tauri::command]
pub fn apagar_chave(provedor: String) -> Result<(), String> {
    validar(&provedor)?;
    sistema::apagar(&format!("{PREFIXO}{provedor}"))
}

// ---------- Senha de app do iCloud (calendário) ----------

pub fn ler_icloud() -> Option<String> {
    sistema::ler(&format!("{PREFIXO}icloud"))
}

pub fn gravar_icloud(senha: &str) -> Result<(), String> {
    sistema::gravar(&format!("{PREFIXO}icloud"), senha)
}

pub fn apagar_icloud() -> Result<(), String> {
    sistema::apagar(&format!("{PREFIXO}icloud"))
}

// ---------- Chaves dos servidores MCP (ex.: GITHUB_TOKEN) ----------

fn alvo_mcp(servidor: &str, nome: &str) -> Result<String, String> {
    let ok = |t: &str| !t.is_empty() && t.len() <= 60 && t.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if ok(servidor) && ok(nome) {
        Ok(format!("{PREFIXO}mcp/{servidor}/{nome}"))
    } else {
        Err("Nome inválido.".into())
    }
}

pub fn ler_segredo_mcp(servidor: &str, nome: &str) -> Option<String> {
    sistema::ler(&alvo_mcp(servidor, nome).ok()?)
}

#[tauri::command]
pub fn salvar_segredo_mcp(servidor: String, nome: String, valor: String) -> Result<(), String> {
    sistema::gravar(&alvo_mcp(&servidor, &nome)?, valor.trim())
}

#[tauri::command]
pub fn tem_segredo_mcp(servidor: String, nome: String) -> bool {
    ler_segredo_mcp(&servidor, &nome).is_some()
}

#[cfg(windows)]
mod sistema {
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Security::Credentials::{
        CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
    };

    fn largo(texto: &str) -> Vec<u16> {
        texto.encode_utf16().chain(Some(0)).collect()
    }

    pub fn gravar(alvo: &str, segredo: &str) -> Result<(), String> {
        let mut nome = largo(alvo);
        let mut usuario = largo("ilha");
        let bytes = segredo.as_bytes();
        let credencial = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: PWSTR(nome.as_mut_ptr()),
            UserName: PWSTR(usuario.as_mut_ptr()),
            CredentialBlobSize: bytes.len() as u32,
            CredentialBlob: bytes.as_ptr() as *mut u8,
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            ..Default::default()
        };
        unsafe { CredWriteW(&credencial, 0) }.map_err(|e| format!("Não consegui guardar a chave: {e}"))
    }

    pub fn ler(alvo: &str) -> Option<String> {
        let nome = largo(alvo);
        let mut ptr: *mut CREDENTIALW = std::ptr::null_mut();
        unsafe {
            CredReadW(PCWSTR(nome.as_ptr()), CRED_TYPE_GENERIC, None, &mut ptr).ok()?;
            let c = &*ptr;
            let bytes = std::slice::from_raw_parts(c.CredentialBlob, c.CredentialBlobSize as usize);
            let segredo = String::from_utf8(bytes.to_vec()).ok();
            CredFree(ptr as *const _);
            segredo
        }
    }

    pub fn apagar(alvo: &str) -> Result<(), String> {
        let nome = largo(alvo);
        unsafe { CredDeleteW(PCWSTR(nome.as_ptr()), CRED_TYPE_GENERIC, None) }.map_err(|e| e.to_string())
    }
}

/// Fora do Windows (só para testes): guarda na memória.
#[cfg(not(windows))]
mod sistema {
    use std::collections::HashMap;
    use std::sync::Mutex;

    static COFRE: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

    pub fn gravar(alvo: &str, segredo: &str) -> Result<(), String> {
        let mut c = COFRE.lock().map_err(|e| e.to_string())?;
        c.get_or_insert_with(HashMap::new).insert(alvo.into(), segredo.into());
        Ok(())
    }

    pub fn ler(alvo: &str) -> Option<String> {
        COFRE.lock().ok()?.as_ref()?.get(alvo).cloned()
    }

    pub fn apagar(alvo: &str) -> Result<(), String> {
        if let Ok(mut c) = COFRE.lock() {
            if let Some(m) = c.as_mut() {
                m.remove(alvo);
            }
        }
        Ok(())
    }
}
