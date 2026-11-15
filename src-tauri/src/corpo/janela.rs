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

/// Corpo preto da ilha, em pixels lógicos, medido a partir do canto superior
/// esquerdo da janela: um retângulo com os cantos de baixo arredondados.
/// Quem informa é a interface (TypeScript).
#[derive(Default, Clone, Copy, Deserialize)]
pub struct Retangulo {
    pub x: f64,
    pub y: f64,
    pub largura: f64,
    pub altura: f64,
    #[serde(default)]
    pub raio: f64,
}

impl Retangulo {
    /// Confere se o ponto está na parte preta, respeitando os cantos redondos
    /// (assim o clique ao lado da curva vai para o programa de trás).
    fn contem(&self, x: f64, y: f64) -> bool {
        let dentro_do_retangulo =
            x >= self.x && x <= self.x + self.largura && y >= self.y && y <= self.y + self.altura;
        if !dentro_do_retangulo {
            return false;
        }
        let raio = self.raio.max(0.0).min(self.largura / 2.0).min(self.altura);
        let inicio_da_curva = self.y + self.altura - raio;
        if y <= inicio_da_curva {
            return true;
        }
        let centro_x = if x < self.x + raio {
            self.x + raio
        } else if x > self.x + self.largura - raio {
            self.x + self.largura - raio
        } else {
            return true;
        };
        let (dx, dy) = (x - centro_x, y - inicio_da_curva);
        dx * dx + dy * dy <= raio * raio
    }
}

#[cfg(test)]
mod testes {
    use super::Retangulo;

    #[test]
    fn so_a_parte_preta_recebe_clique() {
        let ilha = Retangulo { x: 100.0, y: 0.0, largura: 190.0, altura: 40.0, raio: 20.0 };
        assert!(ilha.contem(195.0, 20.0)); // meio
        assert!(ilha.contem(195.0, 39.0)); // borda de baixo, no meio
        assert!(!ilha.contem(101.0, 39.0)); // canto de baixo, fora da curva
        assert!(ilha.contem(106.0, 34.0)); // canto de baixo, dentro da curva
        assert!(!ilha.contem(95.0, 5.0)); // ao lado (onde fica o ombro)
        assert!(!ilha.contem(195.0, 42.0)); // logo abaixo
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

/// Onde está o mouse em relação à janela da ilha (pixels lógicos) e se está
/// em cima da parte preta.
fn mouse_na_ilha(app: &AppHandle, j: &WebviewWindow) -> tauri::Result<(f64, f64, f64, bool)> {
    let cursor = j.cursor_position()?;
    let posicao = j.outer_position()?;
    let escala = j.scale_factor()?;
    let largura = j.outer_size()?.width as f64 / escala;
    let x = (cursor.x - posicao.x as f64) / escala;
    let y = (cursor.y - posicao.y as f64) / escala;
    let area = app
        .state::<AreaClicavel>()
        .0
        .lock()
        .map(|a| *a)
        .unwrap_or_default();
    Ok((x, y, largura, area.contem(x, y)))
}

/// Para onde os olhos do robô devem olhar: -1, 0 ou 1 na horizontal e na vertical.
#[derive(Clone, Copy, PartialEq, serde::Serialize)]
struct Olhar {
    x: i8,
    y: i8,
}

fn olhar_para(x: f64, y: f64, largura: f64) -> Olhar {
    let dx = x - largura / 2.0;
    Olhar {
        x: if dx < -160.0 { -1 } else if dx > 160.0 { 1 } else { 0 },
        y: if y > 260.0 { 1 } else { 0 },
    }
}

/// Sem mexer o mouse por 5 minutos: o robô pode cochilar.
const OCIOSO_APOS: Duration = Duration::from_secs(5 * 60);

fn vigiar_mouse(app: AppHandle) {
    thread::spawn(move || {
        let mut atravessando = true;
        let mut olhar = Olhar { x: 0, y: 0 };
        let mut ultimo_ponto = (0.0, 0.0);
        let mut parado_desde = std::time::Instant::now();
        let mut ocioso = false;
        loop {
            thread::sleep(Duration::from_millis(30));
            let Some(j) = janela(&app) else { break };
            let Ok((x, y, largura, dentro)) = mouse_na_ilha(&app, &j) else { continue };

            // Olhos seguem o mouse (a interface decide se usa).
            let novo = olhar_para(x, y, largura);
            if novo != olhar {
                olhar = novo;
                let _ = app.emit("ilha:olhar", olhar);
            }
            // Mouse parado há muito tempo: avisa uma vez; mexeu: acorda.
            if (x - ultimo_ponto.0).abs() > 1.0 || (y - ultimo_ponto.1).abs() > 1.0 {
                ultimo_ponto = (x, y);
                parado_desde = std::time::Instant::now();
                if ocioso {
                    ocioso = false;
                    let _ = app.emit("ilha:ocioso", false);
                }
            } else if !ocioso && parado_desde.elapsed() > OCIOSO_APOS {
                ocioso = true;
                let _ = app.emit("ilha:ocioso", true);
            }

            // Só mexe na janela quando o mouse entra ou sai da ilha.
            if dentro == atravessando {
                atravessando = !dentro;
                let _ = j.set_ignore_cursor_events(atravessando);
                // A interface usa isto para "passar o mouse" (modo discreto, sinal das IAs).
                let _ = app.emit("ilha:mouse", dentro);
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
