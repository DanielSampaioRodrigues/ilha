//! Passeio: o personagem sai da ilha e anda pela tela (em cima de tudo, mas
//! sem pegar o clique — dá para continuar usando o computador). No fim, volta
//! para a ilha e a janela do passeio fecha.

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const JANELA_PASSEIO: &str = "passeio";

/// Começa um passeio (se já não houver um). Precisa ser "async": criar janela
/// num comando comum trava no Windows.
#[tauri::command]
pub async fn passear(app: AppHandle) -> Result<(), String> {
    if app.get_webview_window(JANELA_PASSEIO).is_some() {
        return Ok(());
    }
    let tela = app.primary_monitor().map_err(|e| e.to_string())?.ok_or("Sem tela.")?;
    let escala = tela.scale_factor();
    let area = tela.work_area();
    let janela = WebviewWindowBuilder::new(&app, JANELA_PASSEIO, WebviewUrl::default())
        .title("Ilha · passeio")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .inner_size(area.size.width as f64 / escala, area.size.height as f64 / escala)
        .position(area.position.x as f64 / escala, area.position.y as f64 / escala)
        .build()
        .map_err(|e| e.to_string())?;
    // O clique passa direto: é só para ver.
    let _ = janela.set_ignore_cursor_events(true);
    let _ = app.emit("ilha:passeio", true);
    Ok(())
}

/// O personagem voltou para a ilha.
#[tauri::command]
pub async fn fim_passeio(app: AppHandle) {
    let _ = app.emit("ilha:passeio", false);
    if let Some(j) = app.get_webview_window(JANELA_PASSEIO) {
        let _ = j.close();
    }
}

// ---------- Pegar o personagem com o mouse ----------
//
// Clicou no personagem (na ilha ou passeando) e arrastou: daqui em diante é
// o Rust que acompanha o mouse enquanto o botão estiver apertado — funciona
// mesmo fora das janelas. A janela do passeio recebe "passeio:arrastar" a
// cada quadro e "passeio:soltar" quando o botão é solto.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

static ARRASTANDO: AtomicBool = AtomicBool::new(false);

/// Como a janela do passeio deve começar (ela demora um pouco para abrir).
#[derive(Clone, Copy, serde::Serialize)]
pub struct Comeco {
    pub modo: &'static str,
    pub x: f64,
    pub y: f64,
}

static COMECO: Mutex<Option<Comeco>> = Mutex::new(None);

#[derive(Clone, Copy, serde::Serialize)]
struct Ponto {
    x: f64,
    y: f64,
}

/// O Dan pegou o personagem: abre o passeio (se preciso) e segue o mouse.
#[tauri::command]
pub async fn pegar_personagem(app: AppHandle) -> Result<(), String> {
    if ARRASTANDO.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let ja_passeando = app.get_webview_window(JANELA_PASSEIO).is_some();
    if !ja_passeando {
        if let Ok(mut c) = COMECO.lock() {
            *c = Some(Comeco { modo: "segurando", x: 0.0, y: 0.0 });
        }
        if let Err(e) = passear(app.clone()).await {
            ARRASTANDO.store(false, Ordering::SeqCst);
            return Err(e);
        }
    }
    std::thread::spawn(move || seguir_mouse(app));
    Ok(())
}

/// A janela do passeio pergunta, ao abrir, se começa normal ou na mão do Dan.
#[tauri::command]
pub fn comeco_do_passeio() -> Comeco {
    COMECO
        .lock()
        .ok()
        .and_then(|mut c| c.take())
        .unwrap_or(Comeco { modo: "normal", x: 0.0, y: 0.0 })
}

fn seguir_mouse(app: AppHandle) {
    let comeco = std::time::Instant::now();
    loop {
        std::thread::sleep(Duration::from_millis(16));
        let Some(j) = app.get_webview_window(JANELA_PASSEIO) else {
            // A janela ainda está abrindo (ou fechou): espera um pouco, depois desiste.
            if comeco.elapsed() > Duration::from_secs(5) || !botao_apertado() {
                ARRASTANDO.store(false, Ordering::SeqCst);
                return;
            }
            continue;
        };
        let (Ok(cursor), Ok(posicao), Ok(escala)) = (j.cursor_position(), j.outer_position(), j.scale_factor()) else {
            continue;
        };
        let ponto = Ponto {
            x: (cursor.x - posicao.x as f64) / escala,
            y: (cursor.y - posicao.y as f64) / escala,
        };
        let solto = !botao_apertado();
        if let Ok(mut c) = COMECO.lock() {
            // Se a janela ainda não leu como começar, guarda onde ele está.
            if let Some(atual) = c.as_mut() {
                *atual = Comeco { modo: if solto { "solto" } else { "segurando" }, x: ponto.x, y: ponto.y };
            }
        }
        if solto {
            ARRASTANDO.store(false, Ordering::SeqCst);
            let _ = app.emit("passeio:soltar", ponto);
            return;
        }
        let _ = app.emit("passeio:arrastar", ponto);
    }
}

#[cfg(windows)]
fn botao_apertado() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
    // O bit mais alto ligado = o botão está apertado agora.
    unsafe { (GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16) & 0x8000 != 0 }
}

#[cfg(not(windows))]
fn botao_apertado() -> bool {
    false
}
