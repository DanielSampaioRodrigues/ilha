//! Ditado em qualquer lugar (ideia do projeto aberto "Arara", licença MIT):
//! o Dan aperta o atalho (Ctrl+Shift+Espaço por padrão), fala, aperta de novo e
//! o texto é colado onde está o cursor, em qualquer programa. Esc cancela.
//!
//! E o dicionário: palavras que o ouvido costuma errar (nomes, siglas, termos).
//! Vale para tudo que a ilha ouve (ditado, pedidos, conversa).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

// ---------- Dicionário ----------

#[derive(Deserialize, Clone, Debug)]
pub struct Palavra {
    /// Como deve ficar escrito (ex.: "Arcano").
    pub certo: String,
    /// Como o ouvido costuma escrever errado (ex.: "arca no", "Arkano").
    #[serde(default)]
    pub errados: Vec<String>,
}

static DICIONARIO: Mutex<Vec<Palavra>> = Mutex::new(Vec::new());

#[tauri::command]
pub fn definir_dicionario(palavras: Vec<Palavra>) {
    if let Ok(mut d) = DICIONARIO.lock() {
        *d = palavras.into_iter().filter(|p| !p.certo.trim().is_empty()).collect();
    }
}

/// Dica para o Whisper (as palavras do dicionário), para ele já acertar.
pub fn dica() -> Option<String> {
    let d = DICIONARIO.lock().ok()?;
    let lista: Vec<&str> = d.iter().map(|p| p.certo.trim()).filter(|p| !p.is_empty()).take(40).collect();
    (!lista.is_empty()).then(|| lista.join(", "))
}

fn sem_acento(c: char) -> char {
    match c {
        'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
        'é' | 'è' | 'ê' | 'ë' => 'e',
        'í' | 'ì' | 'î' | 'ï' => 'i',
        'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
        'ú' | 'ù' | 'û' | 'ü' => 'u',
        'ç' => 'c',
        _ => c,
    }
}

/// Um caractere comparável: minúsculo e sem acento (sempre 1 para 1).
fn simples(c: char) -> char {
    sem_acento(c.to_lowercase().next().unwrap_or(c))
}

/// Troca as formas erradas (e a própria palavra em outra caixa) pela certa,
/// só em palavras inteiras, sem ligar para maiúsculas e acentos.
pub fn corrigir(texto: &str) -> String {
    let Ok(d) = DICIONARIO.lock() else { return texto.to_string() };
    if d.is_empty() {
        return texto.to_string();
    }
    // (forma a procurar, como deve ficar), as mais compridas primeiro.
    let mut trocas: Vec<(Vec<char>, &str)> = Vec::new();
    for p in d.iter() {
        let certo = p.certo.trim();
        for forma in std::iter::once(certo).chain(p.errados.iter().map(|e| e.trim())) {
            let f: Vec<char> = forma.chars().map(simples).collect();
            if !f.is_empty() {
                trocas.push((f, certo));
            }
        }
    }
    trocas.sort_by_key(|(f, _)| std::cmp::Reverse(f.len()));
    let original: Vec<char> = texto.chars().collect();
    let comparar: Vec<char> = original.iter().map(|c| simples(*c)).collect();
    let letra = |i: usize| comparar.get(i).is_some_and(|c| c.is_alphanumeric());
    let mut saida = String::with_capacity(texto.len());
    let mut i = 0;
    'fora: while i < original.len() {
        let comeco_de_palavra = i == 0 || !letra(i - 1);
        if comeco_de_palavra {
            for (forma, certo) in &trocas {
                let fim = i + forma.len();
                if fim <= comparar.len() && comparar[i..fim] == forma[..] && !letra(fim) {
                    saida.push_str(certo);
                    i = fim;
                    continue 'fora;
                }
            }
        }
        saida.push(original[i]);
        i += 1;
    }
    saida
}

// ---------- Ditado ----------

static DITANDO: AtomicBool = AtomicBool::new(false);
static PARAR: AtomicBool = AtomicBool::new(false);
static CANCELAR: AtomicBool = AtomicBool::new(false);
static ATALHO: Mutex<Option<String>> = Mutex::new(None);
const ESC: &str = "Escape";

/// Liga, troca ou desliga o atalho do ditado. Devolve o atalho registrado.
#[tauri::command]
pub fn definir_ditado(app: AppHandle, ligado: bool, atalho: String) -> Result<Option<String>, String> {
    let mut atual = ATALHO.lock().map_err(|e| e.to_string())?;
    if let Some(anterior) = atual.take() {
        let _ = app.global_shortcut().unregister(anterior.as_str());
    }
    if !ligado {
        return Ok(None);
    }
    app.global_shortcut()
        .on_shortcut(atalho.as_str(), |app, _, evento| {
            if evento.state == ShortcutState::Pressed {
                apertou(app);
            }
        })
        .map_err(|_| "Esse atalho já é usado pelo Windows ou por outro programa. Escolha outro.".to_string())?;
    log::info!("Ditado: atalho {atalho}");
    *atual = Some(atalho.clone());
    Ok(Some(atalho))
}

/// O atalho foi apertado: começa, ou termina e cola.
fn apertou(app: &AppHandle) {
    if DITANDO.load(Ordering::Relaxed) {
        PARAR.store(true, Ordering::Relaxed);
        return;
    }
    DITANDO.store(true, Ordering::Relaxed);
    PARAR.store(false, Ordering::Relaxed);
    CANCELAR.store(false, Ordering::Relaxed);
    // A janela onde o Dan está escrevendo (para colar lá, mesmo se o foco mudar).
    let janela = sistema::janela_da_frente();
    // Esc cancela, só enquanto dita.
    let _ = app.global_shortcut().on_shortcut(ESC, |_, _, e| {
        if e.state == ShortcutState::Pressed {
            CANCELAR.store(true, Ordering::Relaxed);
        }
    });
    let _ = app.emit("ilha:ditado", serde_json::json!({ "etapa": "ouvindo" }));
    let app = app.clone();
    std::thread::spawn(move || {
        super::chamado::OCUPADO.fetch_add(1, Ordering::Relaxed);
        let r = super::ouvido::ditar(&app, &PARAR, &CANCELAR);
        super::chamado::OCUPADO.fetch_sub(1, Ordering::Relaxed);
        let _ = app.global_shortcut().unregister(ESC);
        let cancelado = CANCELAR.load(Ordering::Relaxed);
        let resposta = match r {
            _ if cancelado => serde_json::json!({ "etapa": "cancelado" }),
            Ok(t) if t.trim().is_empty() => serde_json::json!({ "etapa": "vazio" }),
            Ok(t) => {
                let texto = corrigir(t.trim());
                match colar(&app, &texto, janela) {
                    Ok(()) => serde_json::json!({ "etapa": "colado", "texto": texto }),
                    Err(e) => serde_json::json!({ "etapa": "erro", "erro": e, "texto": texto }),
                }
            }
            Err(e) => serde_json::json!({ "etapa": "erro", "erro": e }),
        };
        let _ = app.emit("ilha:ditado", resposta);
        DITANDO.store(false, Ordering::Relaxed);
    });
}

/// Cola o texto onde está o cursor: põe na área de transferência, aperta
/// Ctrl+V na janela certa e devolve o que estava copiado antes (se era texto).
fn colar(app: &AppHandle, texto: &str, janela: isize) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let antes = app.clipboard().read_text().ok();
    app.clipboard().write_text(texto.to_string()).map_err(|e| format!("Não consegui copiar o texto: {e}"))?;
    sistema::esperar_soltar_teclas();
    sistema::voltar_para(janela);
    std::thread::sleep(Duration::from_millis(60));
    sistema::ctrl_v()?;
    // O programa lê a área de transferência logo depois do Ctrl+V.
    std::thread::sleep(Duration::from_millis(450));
    if let Some(a) = antes {
        let _ = app.clipboard().write_text(a);
    }
    Ok(())
}

#[cfg(windows)]
mod sistema {
    use std::time::{Duration, Instant};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
        VIRTUAL_KEY, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT, VK_SPACE,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, IsWindow, SetForegroundWindow};

    pub fn janela_da_frente() -> isize {
        unsafe { GetForegroundWindow().0 as isize }
    }

    pub fn voltar_para(janela: isize) {
        unsafe {
            let h = HWND(janela as *mut _);
            if janela != 0 && IsWindow(Some(h)).as_bool() && GetForegroundWindow() != h {
                let _ = SetForegroundWindow(h);
            }
        }
    }

    /// Espera o Dan soltar Ctrl/Shift/Alt/Win/Espaço do atalho (até 1,5 s),
    /// senão o Ctrl+V vira outra combinação.
    pub fn esperar_soltar_teclas() {
        let comeco = Instant::now();
        let teclas = [VK_CONTROL, VK_SHIFT, VK_MENU, VK_LWIN, VK_RWIN, VK_SPACE];
        while comeco.elapsed() < Duration::from_millis(1500) {
            let alguma = teclas.iter().any(|t| unsafe { GetAsyncKeyState(t.0 as i32) } as u16 & 0x8000 != 0);
            if !alguma {
                return;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    fn tecla(vk: VIRTUAL_KEY, soltar: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: if soltar { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    pub fn ctrl_v() -> Result<(), String> {
        let v = VIRTUAL_KEY(b'V' as u16);
        let entradas = [tecla(VK_CONTROL, false), tecla(v, false), tecla(v, true), tecla(VK_CONTROL, true)];
        let enviadas = unsafe { SendInput(&entradas, std::mem::size_of::<INPUT>() as i32) };
        if enviadas as usize == entradas.len() {
            Ok(())
        } else {
            Err("O Windows não deixou colar (talvez o programa da frente esteja como administrador).".into())
        }
    }
}

#[cfg(not(windows))]
mod sistema {
    pub fn janela_da_frente() -> isize {
        0
    }
    pub fn voltar_para(_janela: isize) {}
    pub fn esperar_soltar_teclas() {}
    pub fn ctrl_v() -> Result<(), String> {
        Err("Colar só funciona no Windows.".into())
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn corrige_pelo_dicionario() {
        definir_dicionario(vec![
            Palavra { certo: "Arcano".into(), errados: vec!["arca no".into(), "Arkano".into()] },
            Palavra { certo: "Claude Code".into(), errados: vec!["clode code".into(), "cloud code".into()] },
            Palavra { certo: "Aleph".into(), errados: vec!["alef".into()] },
        ]);
        assert_eq!(corrigir("abre a pasta clientes arca no 3"), "abre a pasta clientes Arcano 3");
        assert_eq!(corrigir("pede pro cloud code revisar o livro Alef."), "pede pro Claude Code revisar o livro Aleph.");
        assert_eq!(corrigir("ARKANO e arcano"), "Arcano e Arcano");
        // Só palavra inteira: "alefante" fica como está.
        assert_eq!(corrigir("alefante"), "alefante");
        assert_eq!(dica().as_deref(), Some("Arcano, Claude Code, Aleph"));
        definir_dicionario(vec![]);
        assert_eq!(corrigir("arca no"), "arca no");
    }
}
