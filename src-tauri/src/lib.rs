// O código da Ilha é dividido em três partes (ver PLANO.md):
// - cérebro: agentes e provedores de IA (fase 2)
// - mãos: ferramentas que mexem no computador (fase 3)
// - corpo: a ilha na tela, a carinha e os personagens (esta etapa)
mod corpo;

use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// Nome da janela da ilha (o mesmo do tauri.conf.json).
pub const JANELA: &str = "ilha";

/// Atalho de teclado que abre e fecha a ilha. O botão do Ulanzi D200 ou do
/// Keydial pode ser configurado para "apertar" este mesmo atalho.
const ATALHO: &str = "ctrl+alt+space";

pub fn run() {
    tauri::Builder::default()
        // Se o Dan abrir o programa de novo, não cria uma segunda ilha: só abre a que já existe.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _pasta| {
            corpo::janela::abrir(app);
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(corpo::janela::AreaClicavel::default())
        .invoke_handler(tauri::generate_handler![corpo::janela::definir_area])
        .setup(|app| {
            let app = app.handle();
            corpo::janela::preparar(app)?;
            corpo::bandeja::criar(app)?;

            // Se outro programa já usa o atalho, a ilha continua funcionando pelo clique.
            let registro = app.global_shortcut().on_shortcut(ATALHO, |app, _atalho, evento| {
                if evento.state == ShortcutState::Pressed {
                    corpo::janela::alternar(app);
                }
            });
            if let Err(erro) = registro {
                eprintln!("Não consegui registrar o atalho {ATALHO}: {erro}");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erro ao iniciar a Ilha");
}
