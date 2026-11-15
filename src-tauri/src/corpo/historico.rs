//! Histórico das traduções da tela: um recorte do print, o texto original, a
//! tradução, a data e o programa. Fica na pasta do app no PC
//! (%APPDATA%\com.danielsampaio.ilha\traducoes), no máximo 300 itens.

use std::io::Cursor;
use std::path::PathBuf;
use std::sync::Mutex;

use base64::{engine::general_purpose::STANDARD, Engine};
use image::codecs::jpeg::JpegEncoder;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use super::traducao::CapturaAtual;

const LIMITE: usize = 300;

#[derive(Clone, Serialize, Deserialize)]
pub struct Entrada {
    pub id: String,
    /// Quando foi traduzido (segundos desde 1970).
    pub data: String,
    pub programa: String,
    pub original: String,
    pub traducao: String,
}

/// Evita duas gravações ao mesmo tempo no arquivo da lista.
#[derive(Default)]
pub struct Trava(Mutex<()>);

fn pasta(app: &AppHandle) -> Result<PathBuf, String> {
    let p = app.path().app_data_dir().map_err(|e| e.to_string())?.join("traducoes");
    std::fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    Ok(p)
}

fn ler_lista(app: &AppHandle) -> Vec<Entrada> {
    pasta(app)
        .ok()
        .and_then(|p| std::fs::read(p.join("historico.json")).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn gravar_lista(app: &AppHandle, lista: &[Entrada]) -> Result<(), String> {
    let texto = serde_json::to_vec_pretty(lista).map_err(|e| e.to_string())?;
    std::fs::write(pasta(app)?.join("historico.json"), texto).map_err(|e| e.to_string())
}

/// Recorta o pedaço traduzido do print guardado e salva em JPEG.
fn salvar_recorte(app: &AppHandle, id: &str, imagem: &str, recorte: [f32; 4]) -> Result<(), String> {
    let base64 = imagem.split_once(',').map(|(_, b)| b).unwrap_or(imagem);
    let bytes = STANDARD.decode(base64).map_err(|e| e.to_string())?;
    let print = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
    let margem = 12.0;
    let x = (recorte[0] - margem).max(0.0) as u32;
    let y = (recorte[1] - margem).max(0.0) as u32;
    let largura = ((recorte[2] + margem * 2.0) as u32).min(print.width().saturating_sub(x)).max(1);
    let altura = ((recorte[3] + margem * 2.0) as u32).min(print.height().saturating_sub(y)).max(1);
    let pedaco = print.crop_imm(x, y, largura, altura).to_rgb8();
    let mut saida = Cursor::new(Vec::new());
    JpegEncoder::new_with_quality(&mut saida, 80)
        .encode_image(&pedaco)
        .map_err(|e| e.to_string())?;
    std::fs::write(pasta(app)?.join(format!("{id}.jpg")), saida.into_inner()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn salvar_traducao(
    app: AppHandle,
    original: String,
    traducao: String,
    recorte: [f32; 4],
    captura: State<'_, CapturaAtual>,
    trava: State<'_, Trava>,
) -> Result<(), String> {
    let _t = trava.0.lock().map_err(|e| e.to_string())?;
    let (imagem, programa) = captura.imagem_e_programa().ok_or("Nada para salvar.")?;
    let agora = agora_em_segundos();
    let id = format!("{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0));
    if let Err(erro) = salvar_recorte(&app, &id, &imagem, recorte) {
        log::warn!("Recorte da tradução não salvo: {erro}");
    }
    let mut lista = ler_lista(&app);
    lista.insert(0, Entrada { id, data: agora, programa, original, traducao });
    // Passou do limite: apaga as mais antigas (e as imagens delas).
    if lista.len() > LIMITE {
        for velha in lista.split_off(LIMITE) {
            let _ = std::fs::remove_file(pasta(&app)?.join(format!("{}.jpg", velha.id)));
        }
    }
    gravar_lista(&app, &lista)
}

#[tauri::command]
pub fn listar_traducoes(app: AppHandle) -> Vec<Entrada> {
    ler_lista(&app)
}

/// Imagem de um item, como data:image/jpeg;base64,... (ou nada, se não houver).
#[tauri::command]
pub fn imagem_traducao(app: AppHandle, id: String) -> Option<String> {
    if !id.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let bytes = std::fs::read(pasta(&app).ok()?.join(format!("{id}.jpg"))).ok()?;
    Some(format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)))
}

#[tauri::command]
pub fn apagar_traducao(app: AppHandle, id: String, trava: State<'_, Trava>) -> Result<(), String> {
    let _t = trava.0.lock().map_err(|e| e.to_string())?;
    if !id.chars().all(|c| c.is_ascii_digit()) {
        return Err("Item inválido.".into());
    }
    let mut lista = ler_lista(&app);
    lista.retain(|e| e.id != id);
    let _ = std::fs::remove_file(pasta(&app)?.join(format!("{id}.jpg")));
    gravar_lista(&app, &lista)
}

/// Momento atual em segundos desde 1970 (a interface mostra no horário do PC).
fn agora_em_segundos() -> String {
    let s = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    s.to_string()
}
