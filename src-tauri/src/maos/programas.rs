//! Abrir programas, arquivos e sites (lançador de apps), e listar os
//! programas instalados (os mesmos de "Todos os apps" do menu Iniciar,
//! inclusive os da Microsoft Store, como o ChatGPT).

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

/// Programas da lista do menu Iniciar ficam salvos como "app:<identificação>".
const PREFIXO_APP: &str = "app:";

#[derive(Serialize)]
pub struct ProgramaInstalado {
    pub nome: String,
    pub caminho: String,
}

#[tauri::command]
pub async fn listar_programas() -> Vec<ProgramaInstalado> {
    // Num fio só dele: a lista liga um modo do Windows (COM de "apartamento")
    // que não pode sobrar num fio reaproveitado (travava a leitura da tela).
    tauri::async_runtime::spawn_blocking(|| std::thread::spawn(sistema::listar).join().unwrap_or_default())
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub fn abrir_programa(app: AppHandle, caminho: String) -> Result<(), String> {
    let caminho = caminho.trim();
    let resultado = if let Some(id) = caminho.strip_prefix(PREFIXO_APP) {
        sistema::abrir_app(id).map_err(|e| tauri_plugin_opener::Error::Io(std::io::Error::other(e)))
    } else if caminho.starts_with("http://") || caminho.starts_with("https://") {
        app.opener().open_url(caminho, None::<&str>)
    } else {
        app.opener().open_path(caminho, None::<&str>)
    };
    resultado.map_err(|erro| {
        log::warn!("Não consegui abrir {caminho}: {erro}");
        "Não consegui abrir. Confira se o programa ainda está nesse lugar.".to_string()
    })
}

/// Abre a pasta onde a ilha anota os erros.
#[tauri::command]
pub fn abrir_registros(app: AppHandle) -> Result<(), String> {
    let pasta = app.path().app_log_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&pasta).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(pasta.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[cfg(windows)]
mod sistema {
    use windows::Win32::System::Com::{CoInitializeEx, CoTaskMemFree, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{
        BHID_EnumItems, FOLDERID_AppsFolder, IEnumShellItems, IShellItem, SHGetKnownFolderItem,
        KF_FLAG_DEFAULT, SIGDN, SIGDN_NORMALDISPLAY, SIGDN_PARENTRELATIVEPARSING,
    };

    use super::{ProgramaInstalado, PREFIXO_APP};

    fn texto(item: &IShellItem, tipo: SIGDN) -> Option<String> {
        unsafe {
            let ptr = item.GetDisplayName(tipo).ok()?;
            let valor = ptr.to_string().ok();
            CoTaskMemFree(Some(ptr.0 as *const _));
            valor
        }
    }

    pub fn listar() -> Vec<ProgramaInstalado> {
        let mut lista = Vec::new();
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let Ok(pasta) = SHGetKnownFolderItem::<IShellItem>(&FOLDERID_AppsFolder, KF_FLAG_DEFAULT, None) else {
                return lista;
            };
            let Ok(itens) = pasta.BindToHandler::<_, IEnumShellItems>(None, &BHID_EnumItems) else {
                return lista;
            };
            loop {
                let mut um = [None];
                let mut pegos = 0u32;
                if itens.Next(&mut um, Some(&mut pegos)).is_err() || pegos == 0 {
                    break;
                }
                let Some(item) = um[0].take() else { break };
                let (Some(nome), Some(id)) = (
                    texto(&item, SIGDN_NORMALDISPLAY),
                    texto(&item, SIGDN_PARENTRELATIVEPARSING),
                ) else {
                    continue;
                };
                let minusculo = nome.to_lowercase();
                if minusculo.contains("uninstall") || minusculo.contains("desinstalar") {
                    continue;
                }
                lista.push(ProgramaInstalado { nome, caminho: format!("{PREFIXO_APP}{id}") });
            }
        }
        lista.sort_by_key(|p| p.nome.to_lowercase());
        lista.dedup_by(|a, b| a.nome == b.nome);
        lista
    }

    pub fn abrir_app(id: &str) -> Result<(), String> {
        std::process::Command::new("explorer.exe")
            .arg(format!("shell:AppsFolder\\{id}"))
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

#[cfg(not(windows))]
mod sistema {
    use super::ProgramaInstalado;

    pub fn listar() -> Vec<ProgramaInstalado> {
        Vec::new()
    }

    pub fn abrir_app(_id: &str) -> Result<(), String> {
        Err("Só funciona no Windows.".into())
    }
}
