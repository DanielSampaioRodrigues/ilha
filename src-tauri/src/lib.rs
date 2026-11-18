// O código da Ilha é dividido em três partes (ver PLANO.md):
// - cérebro: agentes e provedores de IA (fase 2)
// - mãos: ferramentas que mexem no computador (abrir programas, música…)
// - corpo: a ilha na tela, a carinha, o atalho e os avisos
mod cerebro;
mod corpo;
mod maos;

use tauri::Manager;

use corpo::{atalho, avisos, janela};

/// Nome da janela da ilha (o mesmo do tauri.conf.json).
pub const JANELA: &str = "ilha";

pub fn run() {
    // Chamada pelo Claude Code para perguntar "posso?" (servidor MCP): não abre a ilha.
    if corpo::permissao::servidor_mcp_se_pedido() {
        return;
    }
    // Chamada por outro programa (ex.: Claude Code)? Relança solta e sai.
    if avisos::soltar_se_chamada_por_outro_programa() {
        return;
    }

    tauri::Builder::default()
        // O microfone é liberado só para as janelas da própria ilha (conteúdo local):
        // é por ele que vem o som com cancelamento de eco. Sem pergunta do Windows.
        .on_permission_request(|_, tipo| match tipo {
            tauri::webview::PermissionKind::Microphone => tauri::webview::PermissionResponse::Allow,
            _ => tauri::webview::PermissionResponse::Default,
        })
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
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(janela::AreaClicavel::default())
        .manage(atalho::AtalhoAtual::default())
        .manage(avisos::AvisoPendente::default())
        .manage(corpo::janela_ativa::VigiarJanelas::default())
        .manage(corpo::tela_cheia::EsconderEmTelaCheia::default())
        .manage(corpo::traducao::CapturaAtual::default())
        .manage(corpo::historico::Trava::default())
        .manage(corpo::central::TelaPendente::default())
        .manage(cerebro::motores::Andamento::default())
        .manage(corpo::permissao::Esperando::default())
        .manage(corpo::permissao::AcoesEsperando::default())
        .manage(maos::copiados::Copiados::default())
        .invoke_handler(tauri::generate_handler![
            janela::definir_area,
            atalho::definir_atalho,
            atalho::atalho_atual,
            corpo::janela_ativa::vigiar_janelas,
            corpo::tela_cheia::esconder_em_tela_cheia,
            corpo::traducao::captura_atual,
            corpo::traducao::traduzir_linhas,
            corpo::traducao::traduzir_tela,
            corpo::traducao::fechar_traducao,
            corpo::historico::salvar_traducao,
            corpo::historico::listar_traducoes,
            corpo::historico::imagem_traducao,
            corpo::historico::apagar_traducao,
            maos::cofre::salvar_chave,
            maos::cofre::tem_chave,
            maos::cofre::apagar_chave,
            maos::cofre::salvar_segredo_mcp,
            maos::cofre::tem_segredo_mcp,
            cerebro::deepseek::testar_deepseek,
            cerebro::motores::conversar,
            cerebro::motores::parar_conversa,
            cerebro::motores::motores_disponiveis,
            cerebro::motores::abrir_no_terminal,
            cerebro::motores::instalar_motor,
            cerebro::motores::entrar_motor,
            cerebro::motores::conta_motor,
            cerebro::motores::listar_modelos,
            cerebro::skills::skills_do_claude,
            maos::ditado::ditado,
            corpo::central::abrir_central,
            corpo::central::esconder_central,
            corpo::central::modo_central,
            corpo::atividade::perceber_atividade,
            corpo::permissao::responder_permissao,
            corpo::permissao::responder_acao,
            corpo::passeio::passear,
            corpo::passeio::fim_passeio,
            corpo::passeio::pegar_personagem,
            corpo::passeio::comeco_do_passeio,
            maos::voz::ouvir,
            maos::conferir_voz::conferir_voz,
            maos::conferir_voz::consertar_voz,
            maos::chamado::estado_chamado,
            maos::voz_natural::falar_natural,
            maos::voz_natural::vozes_naturais,
            maos::voz::parar_de_ouvir,
            maos::chamado::atender_pelo_nome,
            maos::copiados::copiados_listar,
            maos::copiados::copiados_fixar,
            maos::copiados::copiados_apagar,
            maos::copiados::copiados_limpar,
            maos::copiados::copiados_copiar_imagem,
            maos::copiados::copiados_ligar,
            maos::calendario::icloud_conectar,
            maos::calendario::icloud_calendarios,
            maos::calendario::icloud_desconectar,
            maos::calendario::icloud_conectado,
            maos::calendario::icloud_enviar,
            maos::calendario::icloud_eventos,
            corpo::central::tela_inicial_central,
            corpo::foco::janela_da_frente,
            maos::ouvido::estado_ouvido,
            maos::ouvido::baixar_ouvido,
            maos::ouvido::falando_agora,
            maos::ouvido::fala_com_nome,
            maos::ouvido::escolher_ouvido,
            maos::ouvido::testar_ouvido,
            maos::ouvido::som_do_microfone,
            maos::atualizar::procurar_versao,
            maos::pastas::procurar_pastas,
            maos::pastas::renovar_pastas,
            maos::atualizar::instalar_versao,
            maos::volume::volume_atual,
            maos::volume::definir_volume,
            maos::pc::diagnostico_pc,
            maos::pc::limpar_temporarios,
            avisos::aviso_pendente,
            maos::programas::abrir_programa,
            maos::programas::listar_programas,
            maos::programas::abrir_registros,
            maos::midia::midia_atual,
            maos::midia::midia_comando,
            maos::integracoes::situacao_avisos,
            maos::integracoes::mudar_aviso,
        ])
        .setup(|app| {
            // Se a ilha travar, o motivo fica anotado no registro de erros.
            std::panic::set_hook(Box::new(|info| log::error!("A ilha travou: {info}")));
            log::info!("Ilha {} ligando", app.package_info().version);

            let app = app.handle();
            janela::preparar(app)?;
            corpo::bandeja::criar(app)?;
            corpo::janela_ativa::iniciar(app.clone());
            corpo::atividade::iniciar(app.clone());
            corpo::permissao::iniciar(app.clone());
            maos::copiados::iniciar(app.clone());
            // Ouvido próprio: baixa sozinho o que faltar, em segundo plano.
            maos::ouvido::iniciar(app);
            maos::pastas::iniciar();
            corpo::tela_cheia::vigiar(app.clone());
            maos::volume::vigiar(app.clone());
            maos::pc::vigiar(app.clone());
            atalho::registrar_padrao(app, &app.state::<atalho::AtalhoAtual>());
            corpo::traducao::registrar_atalho(app);

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
