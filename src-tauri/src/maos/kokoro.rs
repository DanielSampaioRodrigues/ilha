//! Voz Kokoro: voz natural de graça, gerada no próprio PC (sem internet depois
//! de baixar). O Dan escolheu as três vozes brasileiras: Dora (feminina), Alex
//! e Santa (masculinas).
//!
//! Como funciona (igual ao projeto aberto "kokoro-onnx", que gerou as amostras):
//! 1. O texto vira sons do português (fonemas) com o eSpeak NG (`pt-br`), com a
//!    pontuação mantida no lugar, para a voz fazer as pausas.
//! 2. Os fonemas viram números (o vocabulário do modelo) e o modelo Kokoro
//!    (82 milhões de parâmetros, versão compacta int8) gera o som, 24 kHz.
//! 3. O silêncio do começo e do fim é aparado e a ilha recebe um WAV.
//!
//! Nada disso vem no instalador: na primeira vez a ilha baixa ~145 MB (o motor
//! ONNX da Microsoft e o eSpeak, dos pacotes oficiais do PyPI, e o modelo com as
//! vozes, do GitHub do kokoro-onnx), confere a impressão digital (SHA-256) de
//! cada um e guarda na pasta de dados.

use std::collections::HashMap;
use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

pub const TAXA: u32 = 24_000;

/// As vozes brasileiras (nome na ilha → nome no arquivo de vozes).
pub const VOZES: [(&str, &str); 3] = [("dora", "pf_dora"), ("alex", "pm_alex"), ("santa", "pm_santa")];

// ---------- O que baixar ----------

struct Peca {
    nome: &'static str,
    url: &'static str,
    sha256: &'static str,
    tamanho: u64,
}

const MODELO: Peca = Peca {
    nome: "kokoro-v1.0.int8.onnx",
    url: "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx",
    sha256: "6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb",
    tamanho: 92_361_271,
};
const VOZES_ARQUIVO: Peca = Peca {
    nome: "voices-v1.0.bin",
    url: "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin",
    sha256: "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
    tamanho: 28_214_398,
};
/// Motor ONNX da Microsoft (o onnxruntime.dll de dentro do pacote oficial do PyPI).
const ONNX: Peca = Peca {
    nome: "onnxruntime.whl",
    url: "https://files.pythonhosted.org/packages/6f/ee/a776ccc71ba54de3739c20c7c815d9695c55db1d08e2b3c621452676c23f/onnxruntime-1.32.0-cp313-cp313-win_amd64.whl",
    sha256: "c7f9aa98036ba2a47aa041a4a8c6d0a1f7bfe1bde44c131dcd15ce334f2f148d",
    tamanho: 16_697_937,
};
/// eSpeak NG para Windows (biblioteca + dados), do pacote "espeakng-loader".
const ESPEAK: Peca = Peca {
    nome: "espeakng.whl",
    url: "https://files.pythonhosted.org/packages/9d/ed/a3d872fbad4f3a3f3db0e8c31768ab14e77cd77306de16b8b20b1e1df7ea/espeakng_loader-0.2.4-py3-none-win_amd64.whl",
    sha256: "41f1e08ac9deda2efd1ea9de0b81dab9f5ae3c4b24284f76533d0a7b1dd7abd7",
    tamanho: 9_437_292,
};
const PECAS: [&Peca; 4] = [&ONNX, &ESPEAK, &VOZES_ARQUIVO, &MODELO];

static PASTA: Mutex<Option<PathBuf>> = Mutex::new(None);
static BAIXANDO: AtomicBool = AtomicBool::new(false);
static BAIXADO: AtomicU64 = AtomicU64::new(0);
static ERRO: Mutex<Option<String>> = Mutex::new(None);

fn pasta() -> Option<PathBuf> {
    PASTA.lock().ok()?.clone()
}

/// Onde fica cada coisa já pronta para usar.
struct Caminhos {
    onnx: PathBuf,
    espeak: PathBuf,
    dados_espeak: PathBuf,
    modelo: PathBuf,
    vozes: PathBuf,
}

fn caminhos() -> Option<Caminhos> {
    let p = pasta()?;
    let biblioteca = if cfg!(windows) { "espeak-ng.dll" } else { "libespeak-ng.so" };
    let onnx = if cfg!(windows) { "onnxruntime.dll" } else { "libonnxruntime.so" };
    Some(Caminhos {
        onnx: p.join(onnx),
        espeak: p.join(biblioteca),
        dados_espeak: p.join("espeak-ng-data"),
        modelo: p.join(MODELO.nome),
        vozes: p.join(VOZES_ARQUIVO.nome),
    })
}

fn pronta() -> bool {
    caminhos().is_some_and(|c| {
        c.onnx.is_file() && c.espeak.is_file() && c.dados_espeak.join("phontab").is_file() && c.modelo.is_file() && c.vozes.is_file()
    })
}

#[derive(Serialize, Clone)]
pub struct EstadoKokoro {
    pub pronta: bool,
    pub baixando: bool,
    pub baixado: u64,
    pub total: u64,
    pub erro: Option<String>,
}

#[tauri::command]
pub fn estado_kokoro() -> EstadoKokoro {
    EstadoKokoro {
        pronta: pronta(),
        baixando: BAIXANDO.load(Ordering::Relaxed),
        baixado: BAIXADO.load(Ordering::Relaxed),
        total: PECAS.iter().map(|p| p.tamanho).sum(),
        erro: ERRO.lock().ok().and_then(|e| e.clone()),
    }
}

/// Anota a pasta de dados (ao ligar a ilha).
pub fn iniciar(app: &AppHandle) {
    let Ok(dados) = app.path().app_data_dir() else { return };
    let p = dados.join("voz-kokoro");
    let _ = std::fs::create_dir_all(&p);
    if let Ok(mut g) = PASTA.lock() {
        *g = Some(p);
    }
}

fn sha256_do_arquivo(caminho: &Path) -> Result<String, String> {
    let mut f = std::fs::File::open(caminho).map_err(|e| e.to_string())?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Baixa uma peça (continua de onde parou) e confere a impressão digital.
async fn baixar_peca(app: Option<&AppHandle>, peca: &Peca, destino: &Path) -> Result<(), String> {
    use std::io::Write;
    let parcial = destino.with_extension("parcial");
    let ja_tinha = std::fs::metadata(&parcial).map(|d| d.len()).unwrap_or(0).min(peca.tamanho);
    let mut pedido = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?
        .get(peca.url);
    if ja_tinha > 0 {
        pedido = pedido.header("Range", format!("bytes={ja_tinha}-"));
    }
    let mut resposta = pedido
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Não consegui baixar a voz (confira a internet): {e}"))?;
    let continuando = ja_tinha > 0 && resposta.status() == reqwest::StatusCode::PARTIAL_CONTENT;
    let mut arquivo = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(continuando)
        .truncate(!continuando)
        .open(&parcial)
        .map_err(|e| e.to_string())?;
    if continuando {
        BAIXADO.fetch_add(ja_tinha, Ordering::Relaxed);
    }
    let mut ultimo = std::time::Instant::now();
    while let Some(pedaco) = resposta.chunk().await.map_err(|e| format!("A internet caiu no meio do download: {e}"))? {
        arquivo.write_all(&pedaco).map_err(|e| format!("Não consegui gravar no disco: {e}"))?;
        BAIXADO.fetch_add(pedaco.len() as u64, Ordering::Relaxed);
        if ultimo.elapsed() > Duration::from_millis(500) {
            ultimo = std::time::Instant::now();
            if let Some(app) = app {
                let _ = app.emit("kokoro:progresso", estado_kokoro());
            }
        }
    }
    drop(arquivo);
    if sha256_do_arquivo(&parcial)? != peca.sha256 {
        let _ = std::fs::remove_file(&parcial);
        return Err("O arquivo da voz veio diferente do esperado (descartado; tento de novo depois).".into());
    }
    std::fs::rename(&parcial, destino).map_err(|e| e.to_string())
}

/// Tira do pacote (.whl é um zip) os arquivos cujo caminho começa com `prefixo`,
/// gravando em `destino` sem o prefixo.
fn extrair(pacote: &Path, prefixo: &str, destino: &Path) -> Result<usize, String> {
    let f = std::fs::File::open(pacote).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
    let mut n = 0;
    for i in 0..zip.len() {
        let mut item = zip.by_index(i).map_err(|e| e.to_string())?;
        let nome = item.name().map_err(|e| e.to_string())?.replace('\\', "/");
        let Some(resto) = nome.strip_prefix(prefixo) else { continue };
        if resto.is_empty() || item.is_dir() || resto.split('/').any(|p| p == ".." || p.is_empty()) {
            continue;
        }
        let alvo = destino.join(resto);
        if let Some(pai) = alvo.parent() {
            std::fs::create_dir_all(pai).map_err(|e| e.to_string())?;
        }
        let mut saida = std::fs::File::create(&alvo).map_err(|e| e.to_string())?;
        std::io::copy(&mut item, &mut saida).map_err(|e| e.to_string())?;
        n += 1;
    }
    Ok(n)
}

async fn baixar_tudo(app: Option<&AppHandle>) -> Result<(), String> {
    let p = pasta().ok_or("Sem pasta para a voz.")?;
    let c = caminhos().ok_or("Sem pasta para a voz.")?;
    BAIXADO.store(0, Ordering::Relaxed);
    for peca in PECAS {
        let arquivo = p.join(peca.nome);
        let pronta_ja = match peca.nome {
            "onnxruntime.whl" => c.onnx.is_file(),
            "espeakng.whl" => c.espeak.is_file() && c.dados_espeak.join("phontab").is_file(),
            _ => arquivo.is_file(),
        };
        if pronta_ja {
            BAIXADO.fetch_add(peca.tamanho, Ordering::Relaxed);
            continue;
        }
        if !arquivo.is_file() {
            baixar_peca(app, peca, &arquivo).await?;
        } else {
            BAIXADO.fetch_add(peca.tamanho, Ordering::Relaxed);
        }
        // Os pacotes do PyPI: tira só o que a ilha usa e apaga o resto.
        match peca.nome {
            "onnxruntime.whl" => {
                let f = std::fs::File::open(&arquivo).map_err(|e| e.to_string())?;
                let mut zip = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
                let mut dll = zip.by_name("onnxruntime/capi/onnxruntime.dll").map_err(|e| e.to_string())?;
                let mut saida = std::fs::File::create(&c.onnx).map_err(|e| e.to_string())?;
                std::io::copy(&mut dll, &mut saida).map_err(|e| e.to_string())?;
                let _ = std::fs::remove_file(&arquivo);
            }
            "espeakng.whl" => {
                extrair(&arquivo, "espeakng_loader/espeak-ng-data/", &c.dados_espeak)?;
                let f = std::fs::File::open(&arquivo).map_err(|e| e.to_string())?;
                let mut zip = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
                let mut dll = zip.by_name("espeakng_loader/espeak-ng.dll").map_err(|e| e.to_string())?;
                let mut saida = std::fs::File::create(&c.espeak).map_err(|e| e.to_string())?;
                std::io::copy(&mut dll, &mut saida).map_err(|e| e.to_string())?;
                let _ = std::fs::remove_file(&arquivo);
            }
            _ => {}
        }
    }
    Ok(())
}

/// Baixa o que faltar (em segundo plano). Chamado quando o Dan escolhe a Kokoro.
#[tauri::command]
pub async fn preparar_kokoro(app: AppHandle) -> Result<(), String> {
    if pronta() {
        return Ok(());
    }
    if BAIXANDO.swap(true, Ordering::Relaxed) {
        return Ok(());
    }
    if let Ok(mut e) = ERRO.lock() {
        *e = None;
    }
    let r = baixar_tudo(Some(&app)).await;
    BAIXANDO.store(false, Ordering::Relaxed);
    if let Err(e) = &r {
        log::warn!("Voz Kokoro: {e}");
        if let Ok(mut g) = ERRO.lock() {
            *g = Some(e.clone());
        }
    } else {
        log::info!("Voz Kokoro: pronta");
    }
    let _ = app.emit("kokoro:progresso", estado_kokoro());
    r
}

// ---------- eSpeak NG (texto → fonemas) ----------

type FnInicializar = unsafe extern "C" fn(c_int, c_int, *const c_char, c_int) -> c_int;
type FnVoz = unsafe extern "C" fn(*const c_char) -> c_int;
type FnFonemas = unsafe extern "C" fn(*mut *const c_void, c_int, c_int) -> *const c_char;

pub struct Espeak {
    _biblioteca: libloading::Library,
    fonemas: FnFonemas,
}

impl Espeak {
    /// Carrega a biblioteca e escolhe a voz pt-br.
    pub fn carregar(biblioteca: &Path, dados: &Path) -> Result<Self, String> {
        unsafe {
            let lib = libloading::Library::new(biblioteca).map_err(|e| format!("eSpeak não abriu: {e}"))?;
            let inicializar: FnInicializar = *lib.get(b"espeak_Initialize\0").map_err(|e| e.to_string())?;
            let voz: FnVoz = *lib.get(b"espeak_SetVoiceByName\0").map_err(|e| e.to_string())?;
            let fonemas: FnFonemas = *lib.get(b"espeak_TextToPhonemes\0").map_err(|e| e.to_string())?;
            let caminho = CString::new(dados.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
            // 0x02 = AUDIO_OUTPUT_SYNCHRONOUS (o mesmo do phonemizer).
            if inicializar(0x02, 0, caminho.as_ptr(), 0) <= 0 {
                return Err("O eSpeak não achou os dados dele.".into());
            }
            let nome = CString::new("pt-br").unwrap_or_default();
            if voz(nome.as_ptr()) != 0 {
                return Err("O eSpeak não tem a voz pt-br.".into());
            }
            Ok(Espeak { _biblioteca: lib, fonemas })
        }
    }

    /// Fonemas de um trecho sem pontuação, como o phonemizer devolve
    /// (palavras separadas por espaço, sem o "_" entre fonemas).
    fn trecho(&self, texto: &str) -> String {
        let Ok(c) = CString::new(texto) else { return String::new() };
        let mut ponteiro: *const c_void = c.as_ptr() as *const c_void;
        let mut partes = Vec::new();
        // texto em UTF-8 (1); fonemas em IPA (0x02) separados por "_".
        let modo = (('_' as c_int) << 8) | 0x02;
        while !ponteiro.is_null() {
            let saida = unsafe { (self.fonemas)(&mut ponteiro, 1, modo) };
            if saida.is_null() {
                break;
            }
            let s = unsafe { CStr::from_ptr(saida) }.to_string_lossy().to_string();
            if !s.is_empty() {
                partes.push(s);
            }
        }
        pos_processar(&partes.join(" "))
    }
}

/// O mesmo arrumado que o phonemizer faz na saída do eSpeak.
fn pos_processar(linha: &str) -> String {
    let mut l = linha.trim().replace('\n', " ").replace("  ", " ");
    while l.contains("__") {
        l = l.replace("__", "_");
    }
    let l = l.replace("_ ", " ");
    if l.is_empty() {
        return String::new();
    }
    let palavras: Vec<String> = l.split(' ').map(|p| p.trim().replace('_', "")).collect();
    format!("{} ", palavras.join(" "))
}

// ---------- Pontuação (igual ao phonemizer, preserve_punctuation) ----------

const MARCAS: &str = ";:!?¡¿—…\"«»“”(){}[]";

enum Parte {
    Trecho(String),
    Marca(String),
}

/// Corta o texto nas pontuações. Vírgula e ponto entre dois algarismos
/// ("11,2") não cortam: são número.
fn separar(texto: &str) -> Vec<Parte> {
    let c: Vec<char> = texto.chars().collect();
    let n = c.len();
    let marca = |i: usize| -> bool {
        let ch = c[i];
        if MARCAS.contains(ch) {
            return true;
        }
        if ch == ',' || ch == '.' {
            let antes = i > 0 && c[i - 1].is_ascii_digit();
            let depois = i + 1 < n && c[i + 1].is_ascii_digit();
            return !(antes && depois);
        }
        false
    };
    let mut partes = Vec::new();
    let mut cursor = 0;
    let mut i = 0;
    while i < n {
        if !(c[i].is_whitespace() || marca(i)) {
            i += 1;
            continue;
        }
        // Espaços seguidos de pontuação entram junto com ela.
        let mut k = i;
        while k < n && c[k].is_whitespace() {
            k += 1;
        }
        if k >= n || !marca(k) {
            i = k.max(i + 1);
            continue;
        }
        let inicio = i;
        let mut fim = k;
        loop {
            while fim < n && marca(fim) {
                fim += 1;
            }
            let mut w = fim;
            while w < n && c[w].is_whitespace() {
                w += 1;
            }
            fim = w;
            if !(w < n && marca(w)) {
                break;
            }
        }
        if inicio > cursor {
            partes.push(Parte::Trecho(c[cursor..inicio].iter().collect()));
        }
        partes.push(Parte::Marca(c[inicio..fim].iter().collect()));
        cursor = fim;
        i = fim;
    }
    if cursor < n {
        partes.push(Parte::Trecho(c[cursor..].iter().collect()));
    }
    partes
}

/// Junta os fonemas de volta com a pontuação (como o `restore` do phonemizer).
fn juntar(partes: &[Parte], fonemas: &[String]) -> String {
    let mut saida = String::new();
    let mut ultima_marca: Option<&str> = None;
    let mut t = 0;
    for p in partes {
        match p {
            Parte::Marca(m) => {
                if saida.ends_with(' ') {
                    saida.pop();
                }
                saida.push_str(m);
                ultima_marca = Some(m);
            }
            Parte::Trecho(_) => {
                let f = &fonemas[t];
                t += 1;
                if !f.is_empty() {
                    saida.push_str(f);
                    ultima_marca = None;
                }
            }
        }
    }
    if ultima_marca.is_some_and(|m| !m.ends_with(' ')) {
        saida.push(' ');
    }
    saida
}

/// O vocabulário do modelo (do config.json do kokoro-onnx).
const VOCABULARIO: &[(char, i64)] = &[
    (';', 1), (':', 2), (',', 3), ('.', 4), ('!', 5), ('?', 6), ('—', 9), ('…', 10), ('"', 11), ('(', 12), (')', 13),
    ('“', 14), ('”', 15), (' ', 16), ('\u{303}', 17), ('ʣ', 18), ('ʥ', 19), ('ʦ', 20), ('ʨ', 21), ('ᵝ', 22), ('ꭧ', 23),
    ('A', 24), ('I', 25), ('O', 31), ('Q', 33), ('S', 35), ('T', 36), ('W', 39), ('Y', 41), ('ᵊ', 42), ('a', 43), ('b', 44),
    ('c', 45), ('d', 46), ('e', 47), ('f', 48), ('h', 50), ('i', 51), ('j', 52), ('k', 53), ('l', 54), ('m', 55), ('n', 56),
    ('o', 57), ('p', 58), ('q', 59), ('r', 60), ('s', 61), ('t', 62), ('u', 63), ('v', 64), ('w', 65), ('x', 66), ('y', 67),
    ('z', 68), ('ɑ', 69), ('ɐ', 70), ('ɒ', 71), ('æ', 72), ('β', 75), ('ɔ', 76), ('ɕ', 77), ('ç', 78), ('ɖ', 80), ('ð', 81),
    ('ʤ', 82), ('ə', 83), ('ɚ', 85), ('ɛ', 86), ('ɜ', 87), ('ɟ', 90), ('ɡ', 92), ('ɥ', 99), ('ɨ', 101), ('ɪ', 102),
    ('ʝ', 103), ('ɯ', 110), ('ɰ', 111), ('ŋ', 112), ('ɳ', 113), ('ɲ', 114), ('ɴ', 115), ('ø', 116), ('ɸ', 118), ('θ', 119),
    ('œ', 120), ('ɹ', 123), ('ɾ', 125), ('ɻ', 126), ('ʁ', 128), ('ɽ', 129), ('ʂ', 130), ('ʃ', 131), ('ʈ', 132), ('ʧ', 133),
    ('ʊ', 135), ('ʋ', 136), ('ʌ', 138), ('ɣ', 139), ('ɤ', 140), ('χ', 142), ('ʎ', 143), ('ʒ', 147), ('ʔ', 148), ('ˈ', 156),
    ('ˌ', 157), ('ː', 158), ('ʰ', 162), ('ʲ', 164), ('↓', 169), ('→', 171), ('↗', 172), ('↘', 173), ('ᵻ', 177),
];

fn no_vocabulario(c: char) -> Option<i64> {
    VOCABULARIO.iter().find(|(v, _)| *v == c).map(|(_, n)| *n)
}

/// Aspas e parênteses não interrompem a fala: as palavras dos dois lados são
/// pronunciadas juntas.
const EM_LINHA: &str = "\"«»“”‘’„‹›()[]{}";

fn em_linha(marca: &str) -> bool {
    let sem_espaco: String = marca.split_whitespace().collect();
    !sem_espaco.is_empty() && sem_espaco.chars().all(|c| EM_LINHA.contains(c))
}

/// Grupos de trechos separados só por aspas/parênteses (índices dos trechos).
fn grupos_em_linha(partes: &[Parte]) -> Vec<Vec<usize>> {
    let mut grupos = Vec::new();
    let mut grupo: Vec<usize> = Vec::new();
    let mut trecho = 0;
    for (i, p) in partes.iter().enumerate() {
        let Parte::Trecho(_) = p else { continue };
        let continua = !grupo.is_empty()
            && i >= 2
            && matches!(partes[i - 2], Parte::Trecho(_))
            && matches!(&partes[i - 1], Parte::Marca(m) if em_linha(m));
        if continua {
            grupo.push(trecho);
        } else {
            if grupo.len() > 1 {
                grupos.push(std::mem::take(&mut grupo));
            }
            grupo = vec![trecho];
        }
        trecho += 1;
    }
    if grupo.len() > 1 {
        grupos.push(grupo);
    }
    grupos
}

/// O grupo pronunciado junto, cortado de volta em um pedaço por trecho (se a
/// contagem de palavras bater; senão, fica cada trecho sozinho).
fn cortar_grupo(sozinhos: &[&str], junto: &str) -> Option<Vec<String>> {
    let palavras = |t: &str| t.split(' ').filter(|p| !p.is_empty()).count();
    let contagens: Vec<usize> = sozinhos.iter().map(|t| palavras(t)).collect();
    if contagens.contains(&0) || palavras(junto) != contagens.iter().sum::<usize>() {
        return None;
    }
    let mut inicios = std::collections::HashSet::new();
    let mut soma = 0;
    for c in &contagens[..contagens.len() - 1] {
        soma += c;
        inicios.insert(soma);
    }
    let pedacos: Vec<&str> = junto.split(' ').collect();
    let mut cortes = vec![0];
    let mut n = 0;
    for (i, p) in pedacos.iter().enumerate() {
        if !p.is_empty() {
            if inicios.contains(&n) {
                cortes.push(i);
            }
            n += 1;
        }
    }
    cortes.push(pedacos.len());
    Some(cortes.windows(2).map(|j| pedacos[j[0]..j[1]].join(" ")).collect())
}

impl Espeak {
    /// Texto → fonemas, exatamente como o kokoro-onnx (phonemizer + vocabulário).
    pub fn fonemas(&self, texto: &str) -> String {
        let partes = separar(texto.trim());
        let textos: Vec<&str> = partes
            .iter()
            .filter_map(|p| match p {
                Parte::Trecho(t) => Some(t.as_str()),
                Parte::Marca(_) => None,
            })
            .collect();
        let mut fonemas: Vec<String> = textos.iter().map(|t| self.trecho(t)).collect();
        // Palavras em volta de aspas/parênteses: pronunciadas no contexto.
        for grupo in grupos_em_linha(&partes) {
            let junto = self.trecho(&grupo.iter().map(|i| textos[*i]).collect::<Vec<_>>().join(" "));
            let sozinhos: Vec<&str> = grupo.iter().map(|i| fonemas[*i].as_str()).collect();
            if let Some(cortados) = cortar_grupo(&sozinhos, &junto) {
                for (i, f) in grupo.iter().zip(cortados) {
                    fonemas[*i] = f;
                }
            }
        }
        let juntos = juntar(&partes, &fonemas);
        let filtrado: String = juntos.chars().filter(|c| no_vocabulario(*c).is_some()).collect();
        // Espaços repetidos viram um só (o kokoro-onnx faz isso).
        filtrado.split_whitespace().collect::<Vec<_>>().join(" ")
    }
}

/// O eSpeak recebe o caminho dos dados em texto simples (sem acentos no
/// Windows). Se o nome do usuário tiver acento (C:\Users\João…), copia os dados
/// uma vez para C:\ProgramData\Ilha\espeak-ng-data.
fn dados_com_caminho_simples(dados: &Path) -> PathBuf {
    if !cfg!(windows) || dados.to_string_lossy().is_ascii() {
        return dados.to_path_buf();
    }
    let Some(base) = std::env::var_os("PROGRAMDATA").map(PathBuf::from) else { return dados.to_path_buf() };
    let destino = base.join("Ilha").join("espeak-ng-data");
    if destino.join("phontab").is_file() {
        return destino;
    }
    fn copiar(de: &Path, para: &Path) -> std::io::Result<()> {
        std::fs::create_dir_all(para)?;
        for item in std::fs::read_dir(de)? {
            let item = item?;
            let alvo = para.join(item.file_name());
            if item.file_type()?.is_dir() {
                copiar(&item.path(), &alvo)?;
            } else {
                std::fs::copy(item.path(), alvo)?;
            }
        }
        Ok(())
    }
    match copiar(dados, &destino) {
        Ok(()) => destino,
        Err(e) => {
            log::warn!("Voz Kokoro: não consegui copiar os dados do eSpeak: {e}");
            dados.to_path_buf()
        }
    }
}

// ---------- O modelo (fonemas → som) ----------

pub struct Motor {
    _ambiente: ort::environment::Environment,
    espeak: Espeak,
    sessao: ort::session::Session,
    /// 510 linhas × 256 números por voz.
    vozes: HashMap<String, Vec<f32>>,
}

/// Lê uma voz (arquivo .npy dentro do .npz de vozes): 510 × 1 × 256 float32.
fn ler_npy(bytes: &[u8]) -> Result<Vec<f32>, String> {
    if bytes.len() < 10 || &bytes[..6] != b"\x93NUMPY" {
        return Err("voz em formato desconhecido".into());
    }
    let (versao, inicio) = (bytes[6], 8);
    let (tamanho_cabecalho, dados) = if versao == 1 {
        (u16::from_le_bytes([bytes[inicio], bytes[inicio + 1]]) as usize, inicio + 2)
    } else {
        (u32::from_le_bytes([bytes[inicio], bytes[inicio + 1], bytes[inicio + 2], bytes[inicio + 3]]) as usize, inicio + 4)
    };
    let cabecalho = String::from_utf8_lossy(&bytes[dados..dados + tamanho_cabecalho]);
    if !cabecalho.contains("<f4") {
        return Err("voz com números de outro tipo".into());
    }
    Ok(bytes[dados + tamanho_cabecalho..].chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect())
}

fn ler_vozes(arquivo: &Path) -> Result<HashMap<String, Vec<f32>>, String> {
    let f = std::fs::File::open(arquivo).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
    let mut vozes = HashMap::new();
    for (nome, arquivo_voz) in VOZES {
        let mut item = zip.by_name(&format!("{arquivo_voz}.npy")).map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        item.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        let v = ler_npy(&bytes)?;
        if v.len() != 510 * 256 {
            return Err("voz com tamanho inesperado".into());
        }
        vozes.insert(nome.to_string(), v);
    }
    Ok(vozes)
}

fn nucleos() -> usize {
    let logicos = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    (if logicos >= 8 { logicos / 2 } else { logicos }).clamp(1, 8)
}

impl Motor {
    fn carregar(c: &Caminhos) -> Result<Self, String> {
        let espeak = Espeak::carregar(&c.espeak, &dados_com_caminho_simples(&c.dados_espeak))?;
        let ambiente = ort::init_from(&c.onnx)
            .map_err(|e| format!("O motor de voz (ONNX) não abriu: {e}"))?
            .with_name("ilha-voz")
            .build()
            .map_err(|e| format!("O motor de voz (ONNX) não abriu: {e}"))?;
        let sessao = ort::session::Session::builder(&ambiente)
            .map_err(|e| e.to_string())?
            .with_intra_threads(nucleos())
            .map_err(|e| e.to_string())?
            .commit_from_file(&c.modelo)
            .map_err(|e| format!("O modelo da voz não abriu: {e}"))?;
        Ok(Motor { _ambiente: ambiente, espeak, sessao, vozes: ler_vozes(&c.vozes)? })
    }

    /// Fonemas → som (24 kHz, -1…1), com o silêncio das pontas aparado.
    fn gerar_lote(&mut self, fonemas: &str, voz: &[f32], velocidade: f32) -> Result<Vec<f32>, String> {
        let tokens: Vec<i64> = fonemas.chars().filter_map(no_vocabulario).collect();
        if tokens.is_empty() {
            return Ok(Vec::new());
        }
        // Uma "linha de estilo" por quantidade de fonemas (como o kokoro-onnx).
        let linha = tokens.len().min(510) - 1;
        let estilo = voz[linha * 256..(linha + 1) * 256].to_vec();
        let mut entrada = Vec::with_capacity(tokens.len() + 2);
        entrada.push(0);
        entrada.extend(tokens);
        entrada.push(0);
        let n = entrada.len();
        let tokens = ort::value::Tensor::from_array(([1usize, n], entrada)).map_err(|e| e.to_string())?;
        let estilo = ort::value::Tensor::from_array(([1usize, 256], estilo)).map_err(|e| e.to_string())?;
        let vel = ort::value::Tensor::from_array(([1usize], vec![velocidade])).map_err(|e| e.to_string())?;
        let saidas = self
            .sessao
            .run(ort::inputs!["tokens" => tokens, "style" => estilo, "speed" => vel])
            .map_err(|e| e.to_string())?;
        let (_, audio) = saidas[0].try_extract_tensor::<f32>().map_err(|e| e.to_string())?;
        Ok(aparar(audio).to_vec())
    }

    /// Texto → som. Frases muito longas são divididas (o modelo aceita até 510 fonemas).
    pub fn falar(&mut self, texto: &str, voz: &str, velocidade: f32) -> Result<Vec<f32>, String> {
        let estilo = self.vozes.get(voz).or_else(|| self.vozes.get("dora")).cloned().ok_or("voz não encontrada")?;
        let fonemas = self.espeak.fonemas(texto);
        let mut audio = Vec::new();
        for lote in lotes(&fonemas, 510) {
            let pedaco = self.gerar_lote(&lote, &estilo, velocidade.clamp(0.5, 2.0))?;
            if !audio.is_empty() && !pedaco.is_empty() {
                // Pausa curta entre os pedaços (o corte é numa pontuação).
                audio.extend(std::iter::repeat_n(0.0, TAXA as usize / 4));
            }
            audio.extend(pedaco);
        }
        Ok(audio)
    }
}

/// Divide os fonemas em lotes de até `maximo` caracteres, de preferência
/// depois de uma pontuação, senão num espaço.
fn lotes(fonemas: &str, maximo: usize) -> Vec<String> {
    let mut resto: Vec<char> = fonemas.chars().collect();
    let mut lista = Vec::new();
    while resto.len() > maximo {
        let janela = &resto[..maximo];
        let corte = janela
            .iter()
            .rposition(|c| ".!?;:,—…".contains(*c))
            .map(|i| i + 1)
            .or_else(|| janela.iter().rposition(|c| *c == ' '))
            .unwrap_or(maximo);
        let corte = corte.max(1);
        lista.push(resto[..corte].iter().collect::<String>().trim().to_string());
        resto = resto[corte..].to_vec();
    }
    let ultimo: String = resto.iter().collect::<String>().trim().to_string();
    if !ultimo.is_empty() {
        lista.push(ultimo);
    }
    lista.retain(|l| !l.is_empty());
    lista
}

/// Apara o silêncio do começo e do fim (60 dB abaixo do pico, em quadros de
/// 2048 com passo de 512, como o librosa que o kokoro-onnx usa).
fn aparar(audio: &[f32]) -> &[f32] {
    const QUADRO: usize = 2048;
    const PASSO: usize = 512;
    if audio.len() < QUADRO {
        return audio;
    }
    let metade = QUADRO / 2;
    let quadros = audio.len() / PASSO + 1;
    let rms: Vec<f32> = (0..quadros)
        .map(|i| {
            let centro = i * PASSO;
            let (a, b) = (centro.saturating_sub(metade), (centro + metade).min(audio.len()));
            let soma: f32 = audio[a..b].iter().map(|x| x * x).sum();
            (soma / QUADRO as f32).sqrt()
        })
        .collect();
    let pico = rms.iter().cloned().fold(0.0f32, f32::max);
    if pico <= 0.0 {
        return audio;
    }
    let limiar = pico * 10f32.powf(-60.0 / 20.0);
    let Some(primeiro) = rms.iter().position(|r| *r > limiar) else { return &audio[..0] };
    let ultimo = rms.iter().rposition(|r| *r > limiar).unwrap_or(primeiro);
    let inicio = (primeiro * PASSO).min(audio.len());
    let fim = ((ultimo + 1) * PASSO).min(audio.len());
    &audio[inicio..fim.max(inicio)]
}

/// Som → arquivo WAV (16 bits, um canal, 24 kHz).
pub fn wav(audio: &[f32]) -> Vec<u8> {
    let dados = (audio.len() * 2) as u32;
    let mut v = Vec::with_capacity(44 + dados as usize);
    v.extend_from_slice(b"RIFF");
    v.extend_from_slice(&(36 + dados).to_le_bytes());
    v.extend_from_slice(b"WAVEfmt ");
    v.extend_from_slice(&16u32.to_le_bytes());
    v.extend_from_slice(&1u16.to_le_bytes());
    v.extend_from_slice(&1u16.to_le_bytes());
    v.extend_from_slice(&TAXA.to_le_bytes());
    v.extend_from_slice(&(TAXA * 2).to_le_bytes());
    v.extend_from_slice(&2u16.to_le_bytes());
    v.extend_from_slice(&16u16.to_le_bytes());
    v.extend_from_slice(b"data");
    v.extend_from_slice(&dados.to_le_bytes());
    for a in audio {
        v.extend_from_slice(&((a.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes());
    }
    v
}

static MOTOR: Mutex<Option<Motor>> = Mutex::new(None);

/// Gera a fala (WAV). Na primeira vez carrega o motor (~1 s).
#[tauri::command]
pub async fn falar_kokoro(texto: String, voz: String, velocidade: Option<f32>) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut guarda = MOTOR.lock().map_err(|e| e.to_string())?;
        if guarda.is_none() {
            if !pronta() {
                return Err("A voz Kokoro ainda está sendo baixada.".to_string());
            }
            let c = caminhos().ok_or("Sem pasta para a voz.")?;
            *guarda = Some(Motor::carregar(&c)?);
        }
        let motor = guarda.as_mut().ok_or("motor não carregou")?;
        let inicio = std::time::Instant::now();
        let audio = motor.falar(&texto, &voz, velocidade.unwrap_or(1.0))?;
        log::info!(
            "Voz Kokoro: {:.1} s de fala em {} ms",
            audio.len() as f32 / TAXA as f32,
            inicio.elapsed().as_millis()
        );
        Ok(tauri::ipc::Response::new(wav(&audio)))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Deixa o motor carregado (ex.: ao escolher a Kokoro), para a 1ª fala sair rápida.
#[tauri::command]
pub async fn aquecer_kokoro() {
    let _ = tauri::async_runtime::spawn_blocking(|| {
        if !pronta() {
            return;
        }
        if let (Ok(mut g), Some(c)) = (MOTOR.lock(), caminhos()) {
            if g.is_none() {
                match Motor::carregar(&c) {
                    Ok(m) => *g = Some(m),
                    Err(e) => log::warn!("Voz Kokoro: {e}"),
                }
            }
        }
    })
    .await;
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn corta_na_pontuacao_como_o_phonemizer() {
        let p = separar("Oi, Dan! O processador está em 11,2 de 16. Agora são 14:30.");
        let t: Vec<String> = p
            .iter()
            .map(|x| match x {
                Parte::Trecho(t) => format!("[{t}]"),
                Parte::Marca(m) => format!("<{m}>"),
            })
            .collect();
        assert_eq!(t.join(""), "[Oi]<, >[Dan]<! >[O processador está em 11,2 de 16]<. >[Agora são 14]<:>[30]<.>");
        let partes = separar("Oi, Dan!");
        assert_eq!(juntar(&partes, &["ˈoɪ ".into(), "dˈɐ̃ŋ ".into()]), "ˈoɪ, dˈɐ̃ŋ! ");
    }

    #[test]
    fn arruma_a_saida_do_espeak() {
        assert_eq!(pos_processar("ˈo_ɪ  d_ˈɐ̃ŋ__ "), "ˈoɪ dˈɐ̃ŋ ");
        assert_eq!(pos_processar(""), "");
    }

    #[test]
    fn divide_frases_longas() {
        let longa = "ab, ".repeat(200);
        let l = lotes(&longa, 510);
        assert!(l.len() >= 2 && l.iter().all(|x| x.chars().count() <= 510));
    }

    /// Compara com a saída do kokoro-onnx (Python). Precisa de:
    /// KOKORO_ESPEAK (libespeak-ng), KOKORO_DADOS (espeak-ng-data) e
    /// KOKORO_FRASES / KOKORO_REFERENCIA (uma frase / um resultado por linha).
    #[test]
    #[ignore]
    fn fonemas_iguais_ao_kokoro_onnx() {
        let v = |n: &str| std::env::var(n).unwrap();
        let e = Espeak::carregar(Path::new(&v("KOKORO_ESPEAK")), Path::new(&v("KOKORO_DADOS"))).unwrap();
        let frases = std::fs::read_to_string(v("KOKORO_FRASES")).unwrap();
        let referencia = std::fs::read_to_string(v("KOKORO_REFERENCIA")).unwrap();
        let mut erros = 0;
        for (f, r) in frases.lines().filter(|l| !l.trim().is_empty()).zip(referencia.lines()) {
            let meu = e.fonemas(f);
            if meu != r {
                erros += 1;
                println!("DIFERENTE\n  texto: {f}\n  ilha:  {meu}\n  ref:   {r}");
            }
        }
        assert_eq!(erros, 0);
    }

    /// Baixa os pacotes de verdade (Windows), confere e extrai. KOKORO_PASTA: pasta vazia.
    #[test]
    #[ignore]
    fn baixa_e_extrai_os_pacotes() {
        let pasta = PathBuf::from(std::env::var("KOKORO_PASTA").unwrap());
        *PASTA.lock().unwrap() = Some(pasta.clone());
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        // Só os dois pacotes do PyPI (o modelo e as vozes já foram testados acima).
        rt.block_on(async {
            for peca in [&ONNX, &ESPEAK] {
                baixar_peca(None, peca, &pasta.join(peca.nome)).await.unwrap();
            }
        });
        let n = extrair(&pasta.join(ESPEAK.nome), "espeakng_loader/espeak-ng-data/", &pasta.join("espeak-ng-data")).unwrap();
        assert!(n > 100 && pasta.join("espeak-ng-data/phontab").is_file() && pasta.join("espeak-ng-data/pt_dict").is_file());
        let f = std::fs::File::open(pasta.join(ONNX.nome)).unwrap();
        let mut zip = zip::ZipArchive::new(f).unwrap();
        assert!(zip.by_name("onnxruntime/capi/onnxruntime.dll").unwrap().size() > 10_000_000);
        let f = std::fs::File::open(pasta.join(ESPEAK.nome)).unwrap();
        let mut zip = zip::ZipArchive::new(f).unwrap();
        assert!(zip.by_name("espeakng_loader/espeak-ng.dll").unwrap().size() > 100_000);
    }

    /// Gera um WAV de verdade. Precisa também de KOKORO_ONNX (libonnxruntime),
    /// KOKORO_MODELO, KOKORO_VOZES e KOKORO_SAIDA (pasta).
    #[test]
    #[ignore]
    fn gera_a_fala() {
        let v = |n: &str| std::env::var(n).unwrap();
        let c = Caminhos {
            onnx: v("KOKORO_ONNX").into(),
            espeak: v("KOKORO_ESPEAK").into(),
            dados_espeak: v("KOKORO_DADOS").into(),
            modelo: v("KOKORO_MODELO").into(),
            vozes: v("KOKORO_VOZES").into(),
        };
        let mut m = Motor::carregar(&c).unwrap();
        let texto = "Oi, Dan! Olhei a sua agenda: amanhã você tem a reunião com a gráfica às três da tarde. Quer que eu abra a pasta Clientes Arcano 3?";
        for (voz, _) in VOZES {
            let inicio = std::time::Instant::now();
            let a = m.falar(texto, voz, 1.0).unwrap();
            println!("{voz}: {:.1} s de fala em {} ms", a.len() as f32 / TAXA as f32, inicio.elapsed().as_millis());
            assert!(a.len() > TAXA as usize * 3);
            std::fs::write(Path::new(&v("KOKORO_SAIDA")).join(format!("ilha_{voz}.wav")), wav(&a)).unwrap();
        }
    }
}
