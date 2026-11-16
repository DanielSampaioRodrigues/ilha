//! Copiados: histórico do que o Dan copia (Ctrl+C), para achar e colar de novo.
//!
//! - Só texto. Guarda até 200 (os fixados não contam e não somem).
//! - Respeita os gerenciadores de senha: o que eles marcam como "não guardar"
//!   (o mesmo aviso que o histórico do próprio Windows respeita) não entra.
//! - Fica num arquivo da pasta de dados da ilha, só no computador.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;

const MAXIMO: usize = 200;
const TAMANHO_MAXIMO: usize = 20_000;

static LIGADO: AtomicBool = AtomicBool::new(true);
static PROXIMO: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Serialize, Deserialize)]
pub struct Copiado {
    pub id: String,
    pub texto: String,
    /// Milissegundos desde 1970.
    pub quando: u64,
    #[serde(default)]
    pub fixo: bool,
    /// Programa que estava na frente quando copiou (ex.: "chrome.exe").
    #[serde(default)]
    pub programa: String,
}

#[derive(Default)]
pub struct Copiados(Mutex<Vec<Copiado>>);

fn agora_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn arquivo(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|p| p.join("copiados.json"))
}

fn salvar(app: &AppHandle, lista: &[Copiado]) {
    if let Some(a) = arquivo(app) {
        if let Some(p) = a.parent() {
            let _ = std::fs::create_dir_all(p);
        }
        let _ = std::fs::write(a, serde_json::to_string(lista).unwrap_or_default());
    }
}

/// Acrescenta um texto copiado (ou sobe para o topo, se já estava). Devolve se mudou.
pub fn acrescentar(lista: &mut Vec<Copiado>, texto: &str, programa: &str, quando: u64) -> bool {
    let texto: String = texto.chars().take(TAMANHO_MAXIMO).collect();
    if texto.trim().is_empty() {
        return false;
    }
    if lista.first().is_some_and(|c| c.texto == texto) {
        return false;
    }
    let fixo = match lista.iter().position(|c| c.texto == texto) {
        Some(i) => lista.remove(i).fixo,
        None => false,
    };
    lista.insert(0, Copiado { id: format!("{quando:x}-{}", PROXIMO.fetch_add(1, Ordering::Relaxed)), texto, quando, fixo, programa: programa.to_string() });
    // Corta os mais antigos que não estão fixados.
    let mut soltos = 0;
    lista.retain(|c| {
        if c.fixo {
            return true;
        }
        soltos += 1;
        soltos <= MAXIMO
    });
    true
}

pub fn iniciar(app: AppHandle) {
    if let Some(a) = arquivo(&app) {
        if let Ok(texto) = std::fs::read_to_string(a) {
            if let Ok(lista) = serde_json::from_str::<Vec<Copiado>>(&texto) {
                if let Ok(mut l) = app.state::<Copiados>().0.lock() {
                    *l = lista;
                }
            }
        }
    }
    std::thread::spawn(move || {
        let mut ultimo = sistema::numero_da_copia();
        loop {
            std::thread::sleep(Duration::from_millis(700));
            let numero = sistema::numero_da_copia();
            if numero == ultimo {
                continue;
            }
            ultimo = numero;
            if !LIGADO.load(Ordering::Relaxed) || sistema::pediram_para_nao_guardar() {
                continue;
            }
            let Ok(texto) = app.clipboard().read_text() else { continue };
            let programa = crate::corpo::janela_ativa::programa_agora().unwrap_or_default();
            let mudou = app.state::<Copiados>().0.lock().map(|mut l| acrescentar(&mut l, &texto, &programa, agora_ms())).unwrap_or(false);
            if mudou {
                if let Ok(l) = app.state::<Copiados>().0.lock() {
                    salvar(&app, &l);
                }
                let _ = app.emit("ilha:copiados", ());
            }
        }
    });
}

#[tauri::command]
pub fn copiados_listar(estado: State<'_, Copiados>) -> Vec<Copiado> {
    estado.0.lock().map(|l| l.clone()).unwrap_or_default()
}

fn mexer(app: &AppHandle, fazer: impl FnOnce(&mut Vec<Copiado>)) {
    if let Ok(mut l) = app.state::<Copiados>().0.lock() {
        fazer(&mut l);
        salvar(app, &l);
    }
    let _ = app.emit("ilha:copiados", ());
}

#[tauri::command]
pub fn copiados_fixar(app: AppHandle, id: String) {
    mexer(&app, |l| {
        if let Some(c) = l.iter_mut().find(|c| c.id == id) {
            c.fixo = !c.fixo;
        }
    });
}

#[tauri::command]
pub fn copiados_apagar(app: AppHandle, id: String) {
    mexer(&app, |l| l.retain(|c| c.id != id));
}

/// Apaga tudo que não está fixado.
#[tauri::command]
pub fn copiados_limpar(app: AppHandle) {
    mexer(&app, |l| l.retain(|c| c.fixo));
}

#[tauri::command]
pub fn copiados_ligar(ligar: bool) {
    LIGADO.store(ligar, Ordering::Relaxed);
}

#[cfg(windows)]
mod sistema {
    use windows::core::w;
    use windows::Win32::System::DataExchange::{GetClipboardSequenceNumber, IsClipboardFormatAvailable, RegisterClipboardFormatW};

    pub fn numero_da_copia() -> u32 {
        unsafe { GetClipboardSequenceNumber() }
    }

    /// Gerenciadores de senha marcam a cópia para ninguém guardar.
    pub fn pediram_para_nao_guardar() -> bool {
        unsafe {
            [
                w!("ExcludeClipboardContentFromMonitorProcessing"),
                w!("CanIncludeInClipboardHistory"),
                w!("Clipboard Viewer Ignore"),
            ]
            .into_iter()
            .any(|nome| {
                let formato = RegisterClipboardFormatW(nome);
                formato != 0 && IsClipboardFormatAvailable(formato).is_ok()
            })
        }
    }
}

#[cfg(not(windows))]
mod sistema {
    pub fn numero_da_copia() -> u32 {
        0
    }

    pub fn pediram_para_nao_guardar() -> bool {
        true
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn guarda_sem_repetir_e_respeita_o_limite() {
        let mut l = Vec::new();
        assert!(acrescentar(&mut l, "a", "x.exe", 1));
        assert!(!acrescentar(&mut l, "a", "x.exe", 2));
        assert!(acrescentar(&mut l, "b", "x.exe", 3));
        assert!(acrescentar(&mut l, "a", "x.exe", 4));
        assert_eq!(l.iter().map(|c| c.texto.as_str()).collect::<Vec<_>>(), vec!["a", "b"]);
        l[1].fixo = true;
        for i in 0..250 {
            acrescentar(&mut l, &format!("t{i}"), "", 10 + i);
        }
        assert_eq!(l.iter().filter(|c| !c.fixo).count(), MAXIMO);
        assert!(l.iter().any(|c| c.texto == "b" && c.fixo));
        assert!(!acrescentar(&mut l, "   ", "", 999));
    }
}
