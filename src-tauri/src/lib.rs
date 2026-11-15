// O código da Ilha é dividido em três partes (ver PLANO.md):
// - cérebro: agentes e provedores de IA (fase 2)
// - mãos: ferramentas que mexem no computador (abrir programas, música…)
// - corpo: a ilha na tela, a carinha, o atalho e os avisos
mod corpo;
mod maos;

use tauri::Manager;

use corpo::{atalho, avisos, janela};

/// Nome da janela da ilha (o mesmo do tauri.conf.json).
pub const JANELA: &str = "ilha";

pub fn run() {
    // Chamada por outro programa (ex.: Claude Code)? Relança solta e sai.
    if avisos::soltar_se_chamada_por_outro_programa() {
        return;
    }

    tauri::Builder::default()
        // Se a ilha já estiver aberta, não cria outra: repassa o aviso ou só abre a que existe.
        .plugin(tauri_plugin_single_instance::init(|app, args, pasta| {
            match avisos::ler(&args, &pasta) {
                Some(aviso) => avisos::mostrar(app, aviso),
                None => janela::abrir(app),
            }
        }))
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .max_file_size(1_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                .build(),
        )
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(janela::AreaClicavel::default())
        .manage(atalho::AtalhoAtual::default())
        .manage(avisos::AvisoPendente::default())
        .invoke_handler(tauri::generate_handler![
            janela::definir_area,
            atalho::definir_atalho,
            atalho::atalho_atual,
            avisos::aviso_pendente,
            maos::programas::abrir_programa,
            maos::programas::abrir_registros,
            maos::midia::midia_atual,
            maos::midia::midia_comando,
            maos::claude::aviso_claude_ligado,
            maos::claude::ligar_aviso_claude,
        ])
        .setup(|app| {
            // Se a ilha travar, o motivo fica anotado no registro de erros.
            std::panic::set_hook(Box::new(|info| log::error!("A ilha travou: {info}")));
            log::info!("Ilha {} ligando", app.package_info().version);

            let app = app.handle();
            janela::preparar(app)?;
            corpo::bandeja::criar(app)?;
            atalho::registrar_padrao(app, &app.state::<atalho::AtalhoAtual>());

            // Aberta por outro programa com um aviso: guarda para a interface mostrar.
            let args: Vec<String> = std::env::args().collect();
            let pasta = std::env::current_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            if let Some(aviso) = avisos::ler(&args, &pasta) {
                if let Ok(mut pendente) = app.state::<avisos::AvisoPendente>().0.lock() {
                    *pendente = Some(aviso);
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erro ao iniciar a Ilha");
}
