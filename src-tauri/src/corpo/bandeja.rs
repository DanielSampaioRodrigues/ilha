//! Ícone da Ilha perto do relógio do Windows, com um menu simples.

use tauri::menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter};

use super::janela;

/// Estados que podem ser vistos pelo menu "Ver os estados", enquanto as
/// funções de verdade não chegam.
const ESTADOS_DE_TESTE: [(&str, &str); 6] = [
    ("repouso", "Repouso"),
    ("ouvindo", "Ouvindo"),
    ("trabalhando", "Trabalhando"),
    ("pronta", "Tarefa pronta"),
    ("aviso", "Aviso fixo"),
    ("confirmacao", "Confirmação"),
];

pub fn criar(app: &AppHandle) -> tauri::Result<()> {
    let abrir = MenuItem::with_id(app, "abrir", "Abrir a ilha", true, None::<&str>)?;
    let ajustes = MenuItem::with_id(app, "ajustes", "Ajustes", true, None::<&str>)?;
    let traduzir = MenuItem::with_id(app, "traduzir", "Traduzir a tela (Win+Alt+T)", true, None::<&str>)?;

    let itens_teste = ESTADOS_DE_TESTE
        .iter()
        .map(|(id, nome)| MenuItem::with_id(app, format!("teste:{id}"), *nome, true, None::<&str>))
        .collect::<tauri::Result<Vec<_>>>()?;
    let referencias: Vec<&dyn IsMenuItem<tauri::Wry>> =
        itens_teste.iter().map(|item| item as &dyn IsMenuItem<tauri::Wry>).collect();
    let teste = Submenu::with_items(app, "Ver os estados (teste)", true, &referencias)?;

    let atualizar = MenuItem::with_id(app, "atualizar", "Procurar atualização", true, None::<&str>)?;
    let registros = MenuItem::with_id(app, "registros", "Abrir registro de erros", true, None::<&str>)?;
    let separador = PredefinedMenuItem::separator(app)?;
    let sair = MenuItem::with_id(app, "sair", "Sair", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&abrir, &traduzir, &ajustes, &teste, &atualizar, &registros, &separador, &sair])?;

    let mut construtor = TrayIconBuilder::with_id("ilha")
        .tooltip("Ilha")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, evento| match evento.id().as_ref() {
            "abrir" => janela::abrir(app),
            "atualizar" => {
                janela::abrir(app);
                let _ = app.emit("ilha:procurar-atualizacao", ());
            }
            "ajustes" => {
                janela::abrir(app);
                let _ = app.emit("ilha:tela", "ajustes");
            }
            "traduzir" => super::traducao::iniciar(app.clone()),
            "registros" => {
                let _ = crate::maos::programas::abrir_registros(app.clone());
            }
            "sair" => app.exit(0),
            outro => {
                if let Some(estado) = outro.strip_prefix("teste:") {
                    let _ = app.emit("ilha:estado", estado);
                }
            }
        })
        .on_tray_icon_event(|icone, evento| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = evento
            {
                janela::abrir(icone.app_handle());
            }
        });
    if let Some(icone) = app.default_window_icon() {
        construtor = construtor.icon(icone.clone());
    }
    construtor.build(app)?;
    Ok(())
}
