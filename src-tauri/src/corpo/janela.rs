//! A janela da ilha.
//!
//! A janela é um retângulo transparente maior que a ilha, preso ao topo central
//! da tela. Só a parte preta (a ilha) pode receber cliques: no resto, o clique
//! "atravessa" e vai para o programa que está embaixo. Para isso, a cada 30 ms
//! conferimos se o mouse está sobre a ilha e ligamos/desligamos a travessia.

use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow};

use crate::JANELA;

/// Retângulo ocupado pela ilha, em pixels lógicos, medido a partir do canto
/// superior esquerdo da janela. Quem informa é a interface (TypeScript).
#[derive(Default, Clone, Copy, Deserialize)]
pub struct Retangulo {
    pub x: f64,
    pub y: f64,
    pub largura: f64,
    pub altura: f64,
}

impl Retangulo {
    fn contem(&self, x: f64, y: f64) -> bool {
        x >= self.x && x <= self.x + self.largura && y >= self.y && y <= self.y + self.altura
    }
}

#[derive(Default)]
pub struct AreaClicavel(Mutex<Retangulo>);

/// A interface chama isto sempre que a ilha muda de tamanho.
#[tauri::command]
pub fn definir_area(area: Retangulo, estado: tauri::State<'_, AreaClicavel>) {
    if let Ok(mut atual) = estado.0.lock() {
        *atual = area;
    }
}

fn janela(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(JANELA)
}

/// Coloca a janela no topo central da tela principal e começa a vigiar o mouse.
pub fn preparar(app: &AppHandle) -> tauri::Result<()> {
    let Some(j) = janela(app) else {
        return Ok(());
    };
    posicionar(&j)?;
    j.set_ignore_cursor_events(true)?;
    j.show()?;
    vigiar_mouse(app.clone());
    Ok(())
}

fn posicionar(j: &WebviewWindow) -> tauri::Result<()> {
    let monitor = match j.primary_monitor()? {
        Some(m) => Some(m),
        None => j.current_monitor()?,
    };
    if let Some(monitor) = monitor {
        let tamanho = j.outer_size()?;
        let inicio = monitor.position();
        let tela = monitor.size();
        let x = inicio.x + (tela.width as i32 - tamanho.width as i32) / 2;
        j.set_position(PhysicalPosition::new(x, inicio.y))?;
    }
    Ok(())
}

fn mouse_sobre_a_ilha(app: &AppHandle, j: &WebviewWindow) -> tauri::Result<bool> {
    let cursor = j.cursor_position()?;
    let posicao = j.outer_position()?;
    let escala = j.scale_factor()?;
    let x = (cursor.x - posicao.x as f64) / escala;
    let y = (cursor.y - posicao.y as f64) / escala;
    let area = app
        .state::<AreaClicavel>()
        .0
        .lock()
        .map(|a| *a)
        .unwrap_or_default();
    Ok(area.contem(x, y))
}

fn vigiar_mouse(app: AppHandle) {
    thread::spawn(move || {
        let mut atravessando = true;
        loop {
            thread::sleep(Duration::from_millis(30));
            let Some(j) = janela(&app) else { break };
            let dentro = mouse_sobre_a_ilha(&app, &j).unwrap_or(false);
            // Só mexe na janela quando o mouse entra ou sai da ilha.
            if dentro == atravessando {
                atravessando = !dentro;
                let _ = j.set_ignore_cursor_events(atravessando);
            }
        }
    });
}

/// Abre a ilha (pelo ícone da bandeja ou ao abrir o programa de novo).
pub fn abrir(app: &AppHandle) {
    focar(app);
    let _ = app.emit("ilha:abrir", ());
}

/// Abre se estiver fechada, fecha se estiver aberta (atalho de teclado).
pub fn alternar(app: &AppHandle) {
    focar(app);
    let _ = app.emit("ilha:alternar", ());
}

fn focar(app: &AppHandle) {
    if let Some(j) = janela(app) {
        let _ = j.show();
        let _ = j.set_focus();
    }
}
