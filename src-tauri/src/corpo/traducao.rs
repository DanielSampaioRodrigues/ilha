//! Tradução da tela, estilo Google Lens: um print do monitor onde está o
//! mouse, o texto lido pelo Windows e a tradução por cima, no mesmo lugar.
//! Abre por Win+Alt+T, pelo botão da ilha ou pelo menu do ícone. Esc fecha.

use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use super::avisos::{self, Aviso};
use crate::maos::tela::{self, Captura};
use crate::JANELA;

pub const JANELA_TRADUCAO: &str = "traducao";
const ATALHO: &str = "Super+Alt+T";

/// O print atual e o programa que estava na frente quando ele foi tirado.
#[derive(Default)]
pub struct CapturaAtual(Mutex<Option<(Captura, String)>>);

impl CapturaAtual {
    pub fn imagem_e_programa(&self) -> Option<(String, String)> {
        let c = self.0.lock().ok()?;
        c.as_ref().map(|(captura, programa)| (captura.imagem.clone(), programa.clone()))
    }
}

pub fn registrar_atalho(app: &AppHandle) {
    let registro = app.global_shortcut().on_shortcut(ATALHO, |app, _a, evento| {
        if evento.state == ShortcutState::Pressed {
            iniciar(app.clone());
        }
    });
    if let Err(erro) = registro {
        log::warn!("Atalho da tradução ({ATALHO}) indisponível: {erro}");
    }
}

/// Tira o print (sem a ilha nele), lê o texto e abre a janela da tradução.
pub fn iniciar(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let ilha = app.get_webview_window(JANELA);
        let programa = super::janela_ativa::programa_agora().unwrap_or_default();
        let cursor = ilha.as_ref().and_then(|j| j.cursor_position().ok());
        let (x, y) = cursor.map(|c| (c.x as i32, c.y as i32)).unwrap_or((0, 0));
        if let Some(j) = app.get_webview_window(JANELA_TRADUCAO) {
            let _ = j.close();
        }
        if let Some(j) = &ilha {
            let _ = j.hide();
        }
        tokio_sleep(Duration::from_millis(220)).await;
        let inicio = std::time::Instant::now();
        // Num fio novo (com o Windows no modo certo) e com tempo limite: se a
        // leitura do texto empacar, a ilha volta e avisa em vez de sumir.
        let resultado = tauri::async_runtime::spawn_blocking(move || {
            let (envia, recebe) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                let _ = envia.send(tela::capturar(x, y));
            });
            recebe
                .recv_timeout(Duration::from_secs(20))
                .unwrap_or_else(|_| Err("A leitura da tela demorou demais. Tente de novo.".into()))
        })
        .await
        .unwrap_or_else(|e| Err(e.to_string()));
        if let Some(j) = &ilha {
            let _ = j.show();
        }
        log::info!("Tradução da tela: print e leitura em {} ms", inicio.elapsed().as_millis());
        match resultado {
            Ok(captura) => {
                if let Err(erro) = abrir_janela(&app, &captura) {
                    log::error!("Janela da tradução: {erro}");
                }
                if let Ok(mut atual) = app.state::<CapturaAtual>().0.lock() {
                    *atual = Some((captura, programa));
                }
            }
            Err(erro) => {
                log::warn!("Tradução da tela: {erro}");
                avisos::mostrar(&app, Aviso { titulo: "Não consegui traduzir a tela".into(), detalhe: erro });
            }
        }
    });
}

async fn tokio_sleep(tempo: Duration) {
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(tempo)).await;
}

fn abrir_janela(app: &AppHandle, c: &Captura) -> tauri::Result<()> {
    let janela = WebviewWindowBuilder::new(app, JANELA_TRADUCAO, WebviewUrl::default())
        .title("Tradução da tela")
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .visible(false)
        .build()?;
    janela.set_position(PhysicalPosition::new(c.monitor_x, c.monitor_y))?;
    janela.set_size(PhysicalSize::new(c.largura, c.altura))?;
    janela.show()?;
    janela.set_focus()?;
    Ok(())
}

/// A janela da tradução pede o print e as linhas lidas.
#[tauri::command]
pub fn captura_atual(estado: State<'_, CapturaAtual>) -> Option<Captura> {
    estado.0.lock().ok().and_then(|c| c.as_ref().map(|(captura, _)| captura.clone()))
}

#[tauri::command]
pub async fn traduzir_linhas(linhas: Vec<String>) -> Result<Vec<String>, String> {
    crate::cerebro::deepseek::traduzir(&linhas).await
}

#[tauri::command]
pub fn traduzir_tela(app: AppHandle) {
    iniciar(app);
}

#[tauri::command]
pub fn fechar_traducao(app: AppHandle, estado: State<'_, CapturaAtual>) {
    if let Ok(mut c) = estado.0.lock() {
        *c = None;
    }
    if let Some(j) = app.get_webview_window(JANELA_TRADUCAO) {
        let _ = j.close();
    }
}
