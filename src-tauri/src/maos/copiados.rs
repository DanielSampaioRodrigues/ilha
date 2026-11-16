//! Copiados: histórico do que o Dan copia (Ctrl+C), para achar e colar de novo.
//!
//! - Texto, imagens (prints, fotos) e arquivos copiados no Explorador.
//! - Guarda até 200 itens, sendo no máximo 40 imagens (os fixados não contam
//!   e não somem). Imagens ficam como PNG na pasta de dados da ilha, com uma
//!   miniatura para a lista.
//! - Respeita os gerenciadores de senha: o que eles marcam como "não guardar"
//!   (o mesmo aviso que o histórico do próprio Windows respeita) não entra.
//! - Tudo fica só no computador.

use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;

const MAXIMO: usize = 200;
const MAXIMO_IMAGENS: usize = 40;
const TAMANHO_MAXIMO: usize = 20_000;
/// Imagens maiores que isso (em pixels) não são guardadas (ex.: prints gigantes).
const PIXELS_MAXIMO: u64 = 40_000_000;

static LIGADO: AtomicBool = AtomicBool::new(true);
static PROXIMO: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Serialize, Deserialize, Default)]
pub struct Copiado {
    pub id: String,
    /// "texto", "imagem" ou "arquivos".
    #[serde(default = "tipo_texto")]
    pub tipo: String,
    /// O texto; para arquivos, os caminhos (um por linha); para imagens, "Imagem L×A".
    pub texto: String,
    /// Milissegundos desde 1970.
    pub quando: u64,
    #[serde(default)]
    pub fixo: bool,
    /// Programa que estava na frente quando copiou (ex.: "chrome.exe").
    #[serde(default)]
    pub programa: String,
    /// Imagem: miniatura (data:image/jpeg;base64,…) e o arquivo PNG completo.
    #[serde(default)]
    pub miniatura: String,
    #[serde(default)]
    pub arquivo: String,
    /// Para não guardar duas vezes a mesma imagem.
    #[serde(default)]
    pub chave: String,
}

fn tipo_texto() -> String {
    "texto".into()
}

impl Copiado {
    fn chave(&self) -> &str {
        if self.tipo == "imagem" {
            &self.chave
        } else {
            &self.texto
        }
    }
}

#[derive(Default)]
pub struct Copiados(Mutex<Vec<Copiado>>);

fn agora_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn pasta(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok()
}

fn salvar(app: &AppHandle, lista: &[Copiado]) {
    if let Some(p) = pasta(app) {
        let _ = std::fs::create_dir_all(&p);
        let _ = std::fs::write(p.join("copiados.json"), serde_json::to_string(lista).unwrap_or_default());
    }
}

/// Acrescenta um item (ou sobe para o topo, se já estava). Devolve se mudou e os
/// itens que saíram (para apagar as imagens deles).
pub fn acrescentar_item(lista: &mut Vec<Copiado>, mut item: Copiado) -> (bool, Vec<Copiado>) {
    if item.tipo == "texto" {
        item.texto = item.texto.chars().take(TAMANHO_MAXIMO).collect();
        if item.texto.trim().is_empty() {
            return (false, Vec::new());
        }
    }
    if lista.first().is_some_and(|c| c.tipo == item.tipo && c.chave() == item.chave()) {
        return (false, Vec::new());
    }
    let mut saiu = Vec::new();
    if let Some(i) = lista.iter().position(|c| c.tipo == item.tipo && c.chave() == item.chave()) {
        let antigo = lista.remove(i);
        item.fixo = antigo.fixo;
        // A imagem nova é igual: fica com o arquivo antigo.
        if item.tipo == "imagem" && antigo.arquivo != item.arquivo {
            saiu.push(Copiado { arquivo: std::mem::take(&mut item.arquivo), ..Default::default() });
            item.arquivo = antigo.arquivo;
            item.miniatura = antigo.miniatura;
        }
    }
    item.id = format!("{:x}-{}", item.quando, PROXIMO.fetch_add(1, Ordering::Relaxed));
    lista.insert(0, item);
    // Corta os mais antigos que não estão fixados.
    let (mut soltos, mut imagens) = (0, 0);
    let mut fica = Vec::with_capacity(lista.len());
    for c in lista.drain(..) {
        if c.fixo {
            fica.push(c);
            continue;
        }
        soltos += 1;
        if c.tipo == "imagem" {
            imagens += 1;
        }
        if soltos > MAXIMO || (c.tipo == "imagem" && imagens > MAXIMO_IMAGENS) {
            saiu.push(c);
        } else {
            fica.push(c);
        }
    }
    *lista = fica;
    (true, saiu)
}

/// Atalho para texto (usado nos testes).
#[cfg(test)]
pub fn acrescentar(lista: &mut Vec<Copiado>, texto: &str, programa: &str, quando: u64) -> bool {
    acrescentar_item(lista, Copiado { tipo: "texto".into(), texto: texto.into(), quando, programa: programa.into(), ..Default::default() }).0
}

fn apagar_arquivos(itens: &[Copiado]) {
    for c in itens {
        if !c.arquivo.is_empty() {
            let _ = std::fs::remove_file(&c.arquivo);
        }
    }
}

/// Lê a imagem copiada, guarda o PNG e faz a miniatura.
fn guardar_imagem(app: &AppHandle, quando: u64, programa: &str) -> Option<Copiado> {
    let imagem = app.clipboard().read_image().ok()?;
    let (l, a) = (imagem.width(), imagem.height());
    if l == 0 || a == 0 || (l as u64 * a as u64) > PIXELS_MAXIMO {
        return None;
    }
    let rgba = imagem.rgba().to_vec();
    // Impressão digital: tamanho + uma amostra dos pixels.
    let mut h = std::collections::hash_map::DefaultHasher::new();
    (l, a).hash(&mut h);
    rgba.iter().step_by(97).for_each(|b| b.hash(&mut h));
    let chave = format!("{:x}", h.finish());
    let buffer = image::RgbaImage::from_raw(l, a, rgba)?;
    let destino = pasta(app)?.join("copiados");
    std::fs::create_dir_all(&destino).ok()?;
    let arquivo = destino.join(format!("{quando:x}.png"));
    buffer.save_with_format(&arquivo, image::ImageFormat::Png).ok()?;
    let mini = image::DynamicImage::ImageRgba8(buffer).thumbnail(240, 240).to_rgb8();
    let mut jpg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpg, 75).encode_image(&mini).ok()?;
    use base64::Engine;
    Some(Copiado {
        tipo: "imagem".into(),
        texto: format!("Imagem {l}×{a}"),
        quando,
        programa: programa.into(),
        miniatura: format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(jpg)),
        arquivo: arquivo.to_string_lossy().into(),
        chave,
        ..Default::default()
    })
}

/// Lê o que foi copiado agora: arquivos, imagem ou texto (nessa ordem).
fn ler_copia(app: &AppHandle) -> Option<Copiado> {
    let quando = agora_ms();
    let programa = crate::corpo::janela_ativa::programa_agora().unwrap_or_default();
    let arquivos = sistema::arquivos_copiados();
    if !arquivos.is_empty() {
        return Some(Copiado { tipo: "arquivos".into(), texto: arquivos.join("\n"), quando, programa, ..Default::default() });
    }
    if sistema::tem_imagem() {
        if let Some(c) = guardar_imagem(app, quando, &programa) {
            return Some(c);
        }
    }
    let texto = app.clipboard().read_text().ok()?;
    Some(Copiado { tipo: "texto".into(), texto, quando, programa, ..Default::default() })
}

pub fn iniciar(app: AppHandle) {
    if let Some(p) = pasta(&app) {
        if let Ok(texto) = std::fs::read_to_string(p.join("copiados.json")) {
            if let Ok(lista) = serde_json::from_str::<Vec<Copiado>>(&texto) {
                if let Ok(mut l) = app.state::<Copiados>().0.lock() {
                    *l = lista;
                }
            }
        }
    }
    std::thread::spawn(move || {
        let mut ultimo = sistema::numero_da_copia();
        loop {
            std::thread::sleep(Duration::from_millis(700));
            let numero = sistema::numero_da_copia();
            if numero == ultimo {
                continue;
            }
            ultimo = numero;
            if !LIGADO.load(Ordering::Relaxed) || sistema::pediram_para_nao_guardar() {
                continue;
            }
            let Some(item) = ler_copia(&app) else { continue };
            let imagem_nova = (item.tipo == "imagem").then(|| item.arquivo.clone());
            let (mudou, saiu) = app
                .state::<Copiados>()
                .0
                .lock()
                .map(|mut l| acrescentar_item(&mut l, item))
                .unwrap_or((false, Vec::new()));
            apagar_arquivos(&saiu);
            if !mudou {
                // Não entrou (repetida): a imagem recém-salva sobra.
                if let Some(a) = imagem_nova {
                    let _ = std::fs::remove_file(a);
                }
                continue;
            }
            if let Ok(l) = app.state::<Copiados>().0.lock() {
                salvar(&app, &l);
            }
            let _ = app.emit("ilha:copiados", ());
        }
    });
}

#[tauri::command]
pub fn copiados_listar(estado: State<'_, Copiados>) -> Vec<Copiado> {
    estado.0.lock().map(|l| l.clone()).unwrap_or_default()
}

fn mexer(app: &AppHandle, fazer: impl FnOnce(&mut Vec<Copiado>) -> Vec<Copiado>) {
    let saiu = app
        .state::<Copiados>()
        .0
        .lock()
        .map(|mut l| {
            let s = fazer(&mut l);
            salvar(app, &l);
            s
        })
        .unwrap_or_default();
    apagar_arquivos(&saiu);
    let _ = app.emit("ilha:copiados", ());
}

#[tauri::command]
pub fn copiados_fixar(app: AppHandle, id: String) {
    mexer(&app, |l| {
        if let Some(c) = l.iter_mut().find(|c| c.id == id) {
            c.fixo = !c.fixo;
        }
        Vec::new()
    });
}

#[tauri::command]
pub fn copiados_apagar(app: AppHandle, id: String) {
    mexer(&app, |l| {
        let (sai, fica): (Vec<_>, Vec<_>) = l.drain(..).partition(|c| c.id == id);
        *l = fica;
        sai
    });
}

/// Apaga tudo que não está fixado.
#[tauri::command]
pub fn copiados_limpar(app: AppHandle) {
    mexer(&app, |l| {
        let (fica, sai): (Vec<_>, Vec<_>) = l.drain(..).partition(|c| c.fixo);
        *l = fica;
        sai
    });
}

/// Copia de novo uma imagem guardada.
#[tauri::command]
pub async fn copiados_copiar_imagem(app: AppHandle, id: String) -> Result<(), String> {
    let arquivo = app
        .state::<Copiados>()
        .0
        .lock()
        .ok()
        .and_then(|l| l.iter().find(|c| c.id == id).map(|c| c.arquivo.clone()))
        .ok_or("Não achei essa imagem.")?;
    let img = image::open(&arquivo).map_err(|_| "A imagem guardada sumiu.".to_string())?.to_rgba8();
    let (l, a) = img.dimensions();
    app.clipboard()
        .write_image(&tauri::image::Image::new_owned(img.into_raw(), l, a))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn copiados_ligar(ligar: bool) {
    LIGADO.store(ligar, Ordering::Relaxed);
}

#[cfg(windows)]
mod sistema {
    use windows::core::w;
    use windows::Win32::Foundation::HGLOBAL;
    use windows::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, GetClipboardSequenceNumber, IsClipboardFormatAvailable, OpenClipboard,
        RegisterClipboardFormatW,
    };
    use windows::Win32::UI::Shell::{DragQueryFileW, HDROP};

    const CF_DIB: u32 = 8;
    const CF_DIBV5: u32 = 17;
    const CF_HDROP: u32 = 15;

    pub fn numero_da_copia() -> u32 {
        unsafe { GetClipboardSequenceNumber() }
    }

    pub fn tem_imagem() -> bool {
        unsafe { IsClipboardFormatAvailable(CF_DIB).is_ok() || IsClipboardFormatAvailable(CF_DIBV5).is_ok() }
    }

    /// Caminhos dos arquivos copiados no Explorador (se for isso).
    pub fn arquivos_copiados() -> Vec<String> {
        unsafe {
            if IsClipboardFormatAvailable(CF_HDROP).is_err() || OpenClipboard(None).is_err() {
                return Vec::new();
            }
            let mut lista = Vec::new();
            if let Ok(dados) = GetClipboardData(CF_HDROP) {
                let drop = HDROP(HGLOBAL(dados.0).0);
                let n = DragQueryFileW(drop, u32::MAX, None);
                for i in 0..n.min(500) {
                    let tamanho = DragQueryFileW(drop, i, None) as usize;
                    let mut texto = vec![0u16; tamanho + 1];
                    let lido = DragQueryFileW(drop, i, Some(&mut texto)) as usize;
                    lista.push(String::from_utf16_lossy(&texto[..lido]));
                }
            }
            let _ = CloseClipboard();
            lista
        }
    }

    /// Gerenciadores de senha marcam a cópia para ninguém guardar.
    pub fn pediram_para_nao_guardar() -> bool {
        unsafe {
            [
                w!("ExcludeClipboardContentFromMonitorProcessing"),
                w!("CanIncludeInClipboardHistory"),
                w!("Clipboard Viewer Ignore"),
            ]
            .into_iter()
            .any(|nome| {
                let formato = RegisterClipboardFormatW(nome);
                formato != 0 && IsClipboardFormatAvailable(formato).is_ok()
            })
        }
    }
}

#[cfg(not(windows))]
mod sistema {
    pub fn numero_da_copia() -> u32 {
        0
    }

    pub fn tem_imagem() -> bool {
        false
    }

    pub fn arquivos_copiados() -> Vec<String> {
        Vec::new()
    }

    pub fn pediram_para_nao_guardar() -> bool {
        true
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn guarda_sem_repetir_e_respeita_o_limite() {
        let mut l = Vec::new();
        assert!(acrescentar(&mut l, "a", "x.exe", 1));
        assert!(!acrescentar(&mut l, "a", "x.exe", 2));
        assert!(acrescentar(&mut l, "b", "x.exe", 3));
        assert!(acrescentar(&mut l, "a", "x.exe", 4));
        assert_eq!(l.iter().map(|c| c.texto.as_str()).collect::<Vec<_>>(), vec!["a", "b"]);
        l[1].fixo = true;
        for i in 0..250 {
            acrescentar(&mut l, &format!("t{i}"), "", 10 + i);
        }
        assert_eq!(l.iter().filter(|c| !c.fixo).count(), MAXIMO);
        assert!(l.iter().any(|c| c.texto == "b" && c.fixo));
        assert!(!acrescentar(&mut l, "   ", "", 999));
    }

    #[test]
    fn limita_as_imagens() {
        let mut l = Vec::new();
        let mut sairam = 0;
        for i in 0..50 {
            let (_, saiu) = acrescentar_item(
                &mut l,
                Copiado { tipo: "imagem".into(), chave: format!("k{i}"), arquivo: format!("f{i}"), quando: i, ..Default::default() },
            );
            sairam += saiu.len();
        }
        assert_eq!(l.len(), MAXIMO_IMAGENS);
        assert_eq!(sairam, 10);
        // A mesma imagem de novo só sobe para o topo.
        let (mudou, saiu) = acrescentar_item(&mut l, Copiado { tipo: "imagem".into(), chave: "k45".into(), arquivo: "novo".into(), quando: 99, ..Default::default() });
        assert!(mudou);
        assert_eq!(l[0].arquivo, "f45");
        assert_eq!(saiu[0].arquivo, "novo");
    }
}
