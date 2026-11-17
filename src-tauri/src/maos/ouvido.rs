//! Ouvido próprio da ilha: grava o microfone e entende a fala com o Whisper,
//! no próprio computador (sem internet, sem conta, sem custo).
//!
//! Por que não o reconhecimento de fala do Windows: a Microsoft só libera esse
//! recurso para apps "empacotados" (MSIX). A ilha é um programa comum, então
//! ele só funcionava às vezes, com uma janela da ilha na frente.
//!
//! - Dois modelos, baixados sozinhos quando a ilha liga (do Hugging Face, onde
//!   o projeto whisper.cpp publica): um pequeno (60 MB), que fica procurando o
//!   nome do robô, e um bom (large-v3-turbo, 574 MB), que entende o pedido.
//! - O microfone é cortado em "falas" (trechos de voz entre silêncios); só as
//!   falas viram texto, e nada é guardado.

#![cfg_attr(not(windows), allow(dead_code))]

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

/// Um modelo do Whisper (arquivo e tamanho exato, para saber se baixou inteiro).
pub struct Modelo {
    pub arquivo: &'static str,
    pub tamanho: u64,
}

/// Pequeno e rápido: fica procurando o nome do robô.
pub const PEQUENO: Modelo = Modelo { arquivo: "ggml-base-q5_1.bin", tamanho: 59_707_625 };
/// Mais preciso: entende o pedido quase como o maior do Whisper (uns 4 s por frase num PC comum).
pub const PRECISO: Modelo = Modelo { arquivo: "ggml-large-v3-turbo-q5_0.bin", tamanho: 574_041_195 };
/// Rápido (padrão): uns 5× mais rápido que o preciso, e acerta bem frases comuns em português.
pub const RAPIDO: Modelo = Modelo { arquivo: "ggml-small-q5_1.bin", tamanho: 190_085_487 };
/// O Dan escolhe em Ajustes › Voz (a tela avisa ao ligar).
static QUER_PRECISO: AtomicBool = AtomicBool::new(false);

/// O modelo que entende os pedidos (o escolhido).
pub fn bom() -> &'static Modelo {
    if QUER_PRECISO.load(Ordering::Relaxed) { &PRECISO } else { &RAPIDO }
}

/// Rápido ou mais preciso. Se faltar o modelo escolhido, baixa (a voz espera).
#[tauri::command]
pub async fn escolher_ouvido(app: AppHandle, preciso: bool, nuvem: Option<bool>) {
    super::nuvem::LIGADA.store(nuvem.unwrap_or(false), Ordering::Relaxed);
    let antes = QUER_PRECISO.swap(preciso, Ordering::Relaxed);
    if antes != preciso {
        log::info!("Ouvido: {}", if preciso { "mais preciso" } else { "rápido" });
    }
    if PASTA.lock().ok().is_some_and(|p| p.is_some()) && !falta().is_empty() {
        let _ = baixar_o_que_falta(&app).await;
    }
    aquecer();
}
const ENDERECO: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/";

/// Taxa que o Whisper usa: 16 mil amostras por segundo, um canal.
pub const TAXA: usize = 16_000;

static PASTA: Mutex<Option<PathBuf>> = Mutex::new(None);
/// O robô está falando agora (a tela avisa). Ele mesmo pode dizer o próprio
/// nome; aí só vale o nome dito no começo da fala (alguém interrompendo).
static FALANDO: AtomicBool = AtomicBool::new(false);

/// O que o robô está falando agora tem o próprio nome (ex.: "Eu sou o Broto"):
/// nessa hora o nome ouvido pode ser a voz dele mesmo, e não vale para interromper.
static FALA_COM_NOME: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub fn falando_agora(sim: bool) {
    FALANDO.store(sim, Ordering::Relaxed);
    if !sim {
        FALA_COM_NOME.store(false, Ordering::Relaxed);
    }
}

#[tauri::command]
pub fn fala_com_nome() {
    FALA_COM_NOME.store(true, Ordering::Relaxed);
}
/// Folga da janela de áudio do Whisper (-1 = janela inteira). Só muda em teste.
static JANELA: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(128);
static BAIXANDO: AtomicBool = AtomicBool::new(false);
/// Quanto o último pedido levou para ser entendido (ms), para mostrar nos Ajustes.
static ULTIMO_PEDIDO_MS: AtomicU64 = AtomicU64::new(0);
/// O último pedido foi entendido na nuvem (e não no PC).
static ULTIMO_PELA_NUVEM: AtomicBool = AtomicBool::new(false);
/// Tamanho da última fala de pedido (ms de áudio).
static ULTIMA_FALA_MS: AtomicU64 = AtomicU64::new(0);
static BAIXADO: AtomicU64 = AtomicU64::new(0);
static ERRO_BAIXAR: Mutex<Option<String>> = Mutex::new(None);

fn caminho(m: &Modelo) -> Option<PathBuf> {
    PASTA.lock().ok()?.as_ref().map(|p| p.join(m.arquivo))
}

/// O modelo está baixado inteiro.
pub fn tem(m: &Modelo) -> bool {
    caminho(m).and_then(|c| std::fs::metadata(c).ok()).is_some_and(|d| d.len() == m.tamanho)
}

/// O ouvido está pronto: os dois modelos baixados. Antes disso, nada de voz
/// pela metade (o pequeno sozinho entende mal os pedidos e confundia): a
/// ilha só avisa que está se preparando.
pub fn pronto() -> bool {
    tem(&PEQUENO) && tem(bom())
}

pub fn pronto_para_nome() -> bool {
    pronto()
}

pub fn pronto_para_pedido() -> bool {
    pronto()
}

// ---------- Baixar sozinho ----------

/// O Windows deixa mais lentos os programas que não estão na frente
/// ("economia de energia" dos processos em segundo plano). A ilha quase
/// sempre está atrás das outras janelas, e o ouvido precisa de rapidez.
#[cfg(windows)]
fn sem_economia_de_energia() {
    use windows::Win32::System::Threading::{
        GetCurrentProcess, ProcessPowerThrottling, SetProcessInformation, PROCESS_POWER_THROTTLING_CURRENT_VERSION,
        PROCESS_POWER_THROTTLING_EXECUTION_SPEED, PROCESS_POWER_THROTTLING_STATE,
    };
    let estado = PROCESS_POWER_THROTTLING_STATE {
        Version: PROCESS_POWER_THROTTLING_CURRENT_VERSION,
        ControlMask: PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
        StateMask: 0,
    };
    unsafe {
        let _ = SetProcessInformation(
            GetCurrentProcess(),
            ProcessPowerThrottling,
            (&estado as *const PROCESS_POWER_THROTTLING_STATE).cast(),
            std::mem::size_of::<PROCESS_POWER_THROTTLING_STATE>() as u32,
        );
    }
}

#[cfg(not(windows))]
fn sem_economia_de_energia() {}

/// Chamado ao ligar: guarda a pasta e baixa o que faltar, em segundo plano.
pub fn iniciar(app: &AppHandle) {
    sem_economia_de_energia();
    let Ok(dados) = app.path().app_data_dir() else { return };
    let pasta = dados.join("whisper");
    let _ = std::fs::create_dir_all(&pasta);
    if let Ok(mut p) = PASTA.lock() {
        *p = Some(pasta);
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // Já está tudo baixado: aquece logo. Senão, espera a ilha terminar de ligar
        // antes de ocupar a internet.
        if falta().is_empty() {
            tokio_dormir(Duration::from_secs(3)).await;
            aquecer();
            return;
        }
        tokio_dormir(Duration::from_secs(20)).await;
        // Se a internet falhar, tenta de novo a cada 2 minutos (continua de onde parou).
        while baixar_o_que_falta(&app).await.is_err() {
            tokio_dormir(Duration::from_secs(120)).await;
        }
        aquecer();
    });
}

async fn tokio_dormir(d: Duration) {
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(d)).await;
}

/// Se o ouvido ainda não está pronto, o que dizer (andamento ou o erro do download).
pub fn aviso_instalando() -> Option<String> {
    if pronto_para_pedido() || PASTA.lock().ok()?.is_none() {
        return None;
    }
    let e = estado_ouvido();
    let mb = |n: u64| n / 1_000_000;
    Some(if e.baixando {
        format!(
            "O ouvido da ilha ainda está se preparando ({} de {} MB). Quando terminar, a ilha avisa e a voz passa a funcionar.",
            mb(e.baixado),
            mb(e.total)
        )
    } else if let Some(erro) = e.erro {
        format!("O ouvido da ilha não terminou de instalar: {erro} Em Ajustes › Voz › Ouvido da ilha, clique em “Tentar de novo”.")
    } else {
        "O ouvido da ilha vai começar a se instalar em instantes. Tente de novo daqui a pouco.".into()
    })
}

#[derive(Serialize, Clone)]
pub struct EstadoOuvido {
    /// Modelo pequeno (nome) pronto.
    pub pequeno: bool,
    /// Modelo bom (pedidos) pronto.
    pub bom: bool,
    pub baixando: bool,
    /// Quanto já baixou e o total (em bytes), somando o que falta.
    pub baixado: u64,
    pub total: u64,
    pub erro: Option<String>,
    /// Quanto o último pedido levou para ser entendido (ms; 0 = nenhum ainda).
    pub ultimo_ms: u64,
    /// Tamanho dessa fala (ms de áudio).
    pub fala_ms: u64,
    /// Fios (núcleos) que o Whisper usa neste PC.
    pub nucleos: usize,
    /// Último problema do ouvido na nuvem (`None` = funcionou ou não usado).
    pub erro_nuvem: Option<String>,
    /// O último pedido foi entendido na nuvem.
    pub pela_nuvem: bool,
}

fn falta() -> Vec<&'static Modelo> {
    [&PEQUENO, bom()].into_iter().filter(|m| !tem(m)).collect()
}

#[tauri::command]
pub fn estado_ouvido() -> EstadoOuvido {
    EstadoOuvido {
        pequeno: tem(&PEQUENO),
        bom: tem(bom()),
        baixando: BAIXANDO.load(Ordering::Relaxed),
        baixado: BAIXADO.load(Ordering::Relaxed),
        total: falta().iter().map(|m| m.tamanho).sum(),
        erro: ERRO_BAIXAR.lock().ok().and_then(|e| e.clone()),
        ultimo_ms: ULTIMO_PEDIDO_MS.load(Ordering::Relaxed),
        fala_ms: ULTIMA_FALA_MS.load(Ordering::Relaxed),
        nucleos: nucleos_do_whisper(),
        erro_nuvem: super::nuvem::ULTIMO_ERRO.lock().ok().and_then(|e| e.clone()),
        pela_nuvem: ULTIMO_PELA_NUVEM.load(Ordering::Relaxed),
    }
}

/// Tenta de novo (botão em Ajustes, se o download falhou).
#[tauri::command]
pub async fn baixar_ouvido(app: AppHandle) -> Result<(), String> {
    baixar_o_que_falta(&app).await
}

async fn baixar_o_que_falta(app: &AppHandle) -> Result<(), String> {
    if BAIXANDO.swap(true, Ordering::Relaxed) {
        return Ok(());
    }
    BAIXADO.store(0, Ordering::Relaxed);
    let ja_faltava = !falta().is_empty();
    if let Ok(mut e) = ERRO_BAIXAR.lock() {
        *e = None;
    }
    let mut resultado = Ok(());
    for m in falta() {
        if let Err(e) = baixar(app, m).await {
            log::warn!("Ouvido: não consegui baixar {}: {e}", m.arquivo);
            if let Ok(mut guardado) = ERRO_BAIXAR.lock() {
                *guardado = Some(e.clone());
            }
            resultado = Err(e);
            break;
        }
        log::info!("Ouvido: {} baixado", m.arquivo);
        let _ = app.emit("ouvido:pronto", m.arquivo);
    }
    BAIXANDO.store(false, Ordering::Relaxed);
    if resultado.is_ok() && pronto() && ja_faltava {
        // Avisa uma vez, quando termina de preparar (a ilha mostra "pronto").
        let _ = app.emit("ouvido:tudo-pronto", ());
    }
    let _ = app.emit("ouvido:progresso", estado_ouvido());
    resultado
}

async fn baixar(app: &AppHandle, m: &Modelo) -> Result<(), String> {
    let destino = caminho(m).ok_or("Sem pasta para o ouvido.")?;
    let parcial = destino.with_extension("parcial");
    // Continua de onde parou (se a ilha foi fechada no meio do download).
    let ja_tinha = std::fs::metadata(&parcial).map(|d| d.len()).unwrap_or(0).min(m.tamanho);
    let mut pedido = reqwest::Client::new().get(format!("{ENDERECO}{}", m.arquivo));
    if ja_tinha > 0 {
        pedido = pedido.header("Range", format!("bytes={ja_tinha}-"));
    }
    let mut resposta = pedido
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Não consegui baixar o ouvido (confira a internet): {e}"))?;
    let continuando = ja_tinha > 0 && resposta.status() == reqwest::StatusCode::PARTIAL_CONTENT;
    let mut arquivo = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(continuando)
        .truncate(!continuando)
        .open(&parcial)
        .map_err(|e| e.to_string())?;
    let mut neste = if continuando { ja_tinha } else { 0 };
    BAIXADO.fetch_add(neste, Ordering::Relaxed);
    let mut ultimo_aviso = Instant::now();
    use std::io::Write;
    while let Some(pedaco) = resposta.chunk().await.map_err(|e| format!("A internet caiu no meio do download: {e}"))? {
        arquivo.write_all(&pedaco).map_err(|e| format!("Não consegui gravar no disco: {e}"))?;
        neste += pedaco.len() as u64;
        BAIXADO.fetch_add(pedaco.len() as u64, Ordering::Relaxed);
        if ultimo_aviso.elapsed() > Duration::from_millis(500) {
            ultimo_aviso = Instant::now();
            let _ = app.emit("ouvido:progresso", estado_ouvido());
        }
    }
    drop(arquivo);
    if neste != m.tamanho {
        // Veio a mais (arquivo trocado no site): começa do zero da próxima vez.
        if neste > m.tamanho {
            let _ = std::fs::remove_file(&parcial);
        }
        return Err("O download parou antes do fim. Continua de onde parou na próxima tentativa.".into());
    }
    std::fs::rename(&parcial, &destino).map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- Entender a fala ----------

/// Modelos carregados na memória (o bom é solto depois de um tempo parado).
struct Carregado {
    arquivo: &'static str,
    contexto: Arc<WhisperContext>,
    usado: Instant,
}
static CARREGADOS: Mutex<Vec<Carregado>> = Mutex::new(Vec::new());

static CARREGANDO: Mutex<()> = Mutex::new(());

fn ja_carregado(m: &Modelo) -> Option<Arc<WhisperContext>> {
    let mut lista = CARREGADOS.lock().ok()?;
    let c = lista.iter_mut().find(|c| c.arquivo == m.arquivo)?;
    c.usado = Instant::now();
    Some(c.contexto.clone())
}

/// O modelo na memória (carrega na primeira vez; leva alguns segundos).
/// Carregar um não trava quem usa o outro.
fn contexto(m: &Modelo) -> Result<Arc<WhisperContext>, String> {
    if let Some(c) = ja_carregado(m) {
        return Ok(c);
    }
    let _vez = CARREGANDO.lock().map_err(|_| "ouvido ocupado")?;
    if let Some(c) = ja_carregado(m) {
        return Ok(c);
    }
    let caminho = caminho(m).ok_or("Sem pasta para o ouvido.")?;
    let contexto = WhisperContext::new_with_params(&caminho, WhisperContextParameters::default())
        .map(Arc::new)
        .map_err(|e| format!("Não consegui abrir o ouvido: {e}"))?;
    if let Ok(mut lista) = CARREGADOS.lock() {
        lista.push(Carregado { arquivo: m.arquivo, contexto: contexto.clone(), usado: Instant::now() });
    }
    Ok(contexto)
}

/// Solta da memória o modelo bom se ficou 5 minutos sem uso (ele ocupa ~600 MB).
pub fn aliviar_memoria() {
    if let Ok(mut lista) = CARREGADOS.lock() {
        // Só o "mais preciso" (~600 MB de memória) é solto; o pequeno e o rápido ficam prontos.
        lista.retain(|c| c.arquivo != PRECISO.arquivo || c.usado.elapsed() < Duration::from_secs(300));
    }
}

/// Um fio por núcleo de verdade (não por núcleo lógico): com 8 ou mais lógicos, a metade.
fn nucleos_do_whisper() -> usize {
    let logicos = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    if logicos >= 8 { logicos / 2 } else { logicos }.clamp(1, 8)
}

/// Frases que o Whisper "inventa" em silêncio ou barulho (vêm de legendas de vídeos).
const INVENTADAS: [&str; 8] = [
    "legendas pela comunidade",
    "amara.org",
    "obrigado por assistir",
    "inscreva-se",
    "legenda adriana",
    "tradução e legendas",
    "subtítulos",
    "♪",
];

/// Transforma a fala (16 kHz, um canal) em texto. `dica`: palavras que podem
/// aparecer (ex.: o nome do robô), para ele acertar a grafia.
pub fn transcrever(m: &Modelo, audio: &[f32], dica: Option<&str>) -> Result<String, String> {
    let contexto = contexto(m)?;
    let mut estado = contexto.create_state().map_err(|e| e.to_string())?;
    let mut p = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    p.set_language(Some("pt"));
    // O Whisper rende mais com um "fio" por núcleo de verdade (não por núcleo
    // lógico): com 8 ou mais lógicos, usa a metade.
    let nucleos = nucleos_do_whisper();
    // O pequeno (procurar o nome) roda o tempo todo: usa só 2 fios, para não
    // pesar no computador nem atrasar o modelo bom.
    let nucleos = if m.arquivo == PEQUENO.arquivo { nucleos.min(2) } else { nucleos };
    p.set_n_threads(nucleos as i32);
    p.set_no_context(true);
    p.set_single_segment(true);
    p.set_no_timestamps(true);
    p.set_print_special(false);
    p.set_print_progress(false);
    p.set_print_realtime(false);
    p.set_print_timestamps(false);
    p.set_suppress_blank(true);
    let segundos = audio.len() as f32 / TAXA as f32;
    let janela = JANELA.load(Ordering::Relaxed);
    if janela >= 0 {
        // Fala curta: não precisa olhar a janela inteira de 30 s (fica bem mais rápido).
        p.set_audio_ctx(((segundos * 50.0) as i32 + janela as i32).min(1500));
    }
    // Uma fala de poucos segundos tem poucas palavras: corta repetição.
    p.set_max_tokens((segundos * 6.0) as i32 + 8);
    if let Some(d) = dica {
        p.set_initial_prompt(d);
    }
    // O Whisper precisa de pelo menos 1 s de áudio.
    let mut audio = audio.to_vec();
    // Microfone baixo (comum em notebook): sobe o volume até um nível bom
    // (no máximo 8×, para não transformar chiado em "palavra").
    let pico = audio.iter().fold(0.0f32, |m, x| m.max(x.abs()));
    if pico > 0.0 && pico < 0.5 {
        let ganho = (0.9 / pico).min(8.0);
        audio.iter_mut().for_each(|x| *x *= ganho);
    }
    if audio.len() < TAXA {
        audio.resize(TAXA, 0.0);
    }
    estado.full(p, &audio).map_err(|e| format!("O ouvido falhou: {e}"))?;
    let mut texto = String::new();
    for segmento in estado.as_iter() {
        if segmento.no_speech_probability() > 0.6 {
            continue;
        }
        if let Ok(t) = segmento.to_str_lossy() {
            texto.push_str(&t);
        }
    }
    let texto = tirar_repeticao(texto.trim());
    let minusculo = texto.to_lowercase();
    if INVENTADAS.iter().any(|f| minusculo.contains(f)) {
        return Ok(String::new());
    }
    Ok(texto)
}

/// Com a janela curta, o Whisper às vezes repete a frase ("Vamos almoçar.
/// Vamos almoçar."). Fica só uma vez.
pub fn tirar_repeticao(texto: &str) -> String {
    let palavras: Vec<&str> = texto.split_whitespace().collect();
    let chave = |p: &str| normalizar(p);
    let n = palavras.len();
    // A menor "volta" que se repete até o fim (aceita a última incompleta).
    for periodo in 1..=n / 2 {
        let igual = |i: usize| {
            let (a, b) = (chave(palavras[i]), chave(palavras[i - periodo]));
            // A última pode ter sido cortada no meio ("Roboz").
            a == b || (i == n - 1 && !a.is_empty() && b.starts_with(&a))
        };
        if (periodo..n).all(igual) {
            return palavras[..periodo].join(" ");
        }
    }
    texto.to_string()
}

// ---------- Cortar o microfone em falas ----------

/// Separa o som do microfone em falas, pelo volume: começa quando o som passa
/// bem acima do barulho de fundo e termina depois de um silêncio.
pub struct Cortador {
    fundo: f32,
    quadro: Vec<f32>,
    antes: std::collections::VecDeque<Vec<f32>>,
    fala: Vec<f32>,
    falando: bool,
    seguidos: usize,
    silencio: usize,
    com_voz: usize,
    fim_silencio: usize,
    maximo: usize,
}

/// Quadros de 30 ms.
const QUADRO: usize = TAXA * 30 / 1000;

impl Cortador {
    /// `fim_ms`: silêncio que encerra a fala. `max_ms`: fala mais longa aceita.
    pub fn new(fim_ms: usize, max_ms: usize) -> Self {
        Cortador {
            fundo: 0.003,
            quadro: Vec::with_capacity(QUADRO),
            antes: std::collections::VecDeque::new(),
            fala: Vec::new(),
            falando: false,
            seguidos: 0,
            silencio: 0,
            com_voz: 0,
            fim_silencio: fim_ms / 30,
            maximo: max_ms * TAXA / 1000,
        }
    }

    pub fn falando(&self) -> bool {
        self.falando
    }

    /// Recebe som; devolve as falas que terminaram.
    pub fn empurrar(&mut self, amostras: &[f32]) -> Vec<Vec<f32>> {
        let mut prontas = Vec::new();
        for &a in amostras {
            self.quadro.push(a);
            if self.quadro.len() == QUADRO {
                let quadro = std::mem::take(&mut self.quadro);
                if let Some(f) = self.quadro_pronto(quadro) {
                    prontas.push(f);
                }
            }
        }
        prontas
    }

    fn quadro_pronto(&mut self, quadro: Vec<f32>) -> Option<Vec<f32>> {
        let energia = (quadro.iter().map(|x| x * x).sum::<f32>() / quadro.len() as f32).sqrt();
        let limiar = (self.fundo * 3.0).max(0.006);
        if !self.falando {
            // Fundo: acompanha devagar o barulho do lugar.
            self.fundo = (self.fundo * 0.95 + energia * 0.05).clamp(0.0015, 0.05);
            self.antes.push_back(quadro);
            if self.antes.len() > 10 {
                self.antes.pop_front();
            }
            self.seguidos = if energia > limiar { self.seguidos + 1 } else { 0 };
            if self.seguidos >= 2 {
                self.falando = true;
                self.silencio = 0;
                self.com_voz = self.seguidos;
                self.fala = self.antes.drain(..).flatten().collect();
            }
            return None;
        }
        self.fala.extend_from_slice(&quadro);
        if energia > limiar * 0.7 {
            self.silencio = 0;
            self.com_voz += 1;
        } else {
            self.silencio += 1;
        }
        if self.silencio >= self.fim_silencio || self.fala.len() >= self.maximo {
            self.falando = false;
            self.seguidos = 0;
            let mut fala = std::mem::take(&mut self.fala);
            // Tira o silêncio do fim (deixa 150 ms): em silêncio o Whisper inventa palavras.
            let sobra = self.silencio.saturating_sub(5) * QUADRO;
            fala.truncate(fala.len().saturating_sub(sobra));
            // Estalo ou batida (menos de ~180 ms de voz): não é fala.
            if self.com_voz >= 6 {
                return Some(fala);
            }
        }
        None
    }
}

// ---------- Achar o nome ----------

fn sem_acento(c: char) -> char {
    match c {
        'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
        'é' | 'è' | 'ê' | 'ë' => 'e',
        'í' | 'ì' | 'î' | 'ï' => 'i',
        'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
        'ú' | 'ù' | 'û' | 'ü' => 'u',
        'ç' => 'c',
        _ => c,
    }
}

fn normalizar(palavra: &str) -> String {
    palavra.to_lowercase().chars().map(sem_acento).filter(|c| c.is_alphanumeric()).collect()
}

fn distancia(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut linha: Vec<usize> = (0..=b.len()).collect();
    for i in 1..=a.len() {
        let mut anterior = linha[0];
        linha[0] = i;
        for j in 1..=b.len() {
            let atual = linha[j];
            linha[j] = (linha[j] + 1).min(linha[j - 1] + 1).min(anterior + usize::from(a[i - 1] != b[j - 1]));
            anterior = atual;
        }
    }
    linha[b.len()]
}

/// Se a fala chama o robô pelo nome, devolve o que veio depois do nome
/// ("" se foi só o nome). Aceita pequenas diferenças ("Robozinhos", "robô zinho").
pub fn achar_nome(texto: &str, nome: &str) -> Option<String> {
    let alvo = normalizar(nome);
    if alvo.len() < 3 {
        return None;
    }
    let tolerancia = (alvo.chars().count() / 4).max(1);
    let palavras: Vec<&str> = texto.split_whitespace().collect();
    let normais: Vec<String> = palavras.iter().map(|p| normalizar(p)).collect();
    for i in 0..normais.len() {
        // A palavra sozinha, ou ela junto com a próxima ("robô zinho").
        for juntas in 1..=2 {
            if i + juntas > normais.len() {
                break;
            }
            let candidata: String = normais[i..i + juntas].concat();
            if candidata.is_empty() || distancia(&candidata, &alvo) > tolerancia {
                continue;
            }
            let resto = palavras[i + juntas..].join(" ");
            let resto = resto.trim_start_matches(|c: char| !c.is_alphanumeric()).trim().to_string();
            return Some(resto);
        }
    }
    None
}

// ---------- Microfone ----------

/// Som do microfone, já em 16 kHz e um canal, chegando aos pedaços.
pub struct Microfone {
    #[cfg(windows)]
    _fluxo: cpal::Stream,
    pub chegando: std::sync::mpsc::Receiver<Vec<f32>>,
}

#[cfg(windows)]
pub fn abrir_microfone() -> Result<Microfone, String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use cpal::SampleFormat;
    let host = cpal::default_host();
    let aparelho = host.default_input_device().ok_or("Não achei microfone ligado no Windows.")?;
    let config = aparelho
        .default_input_config()
        .map_err(|e| format!("Não consegui abrir o microfone: {e}"))?;
    let canais = config.channels() as usize;
    let taxa = config.sample_rate() as f64;
    let formato = config.sample_format();
    let (envia, chegando) = std::sync::mpsc::channel::<Vec<f32>>();
    let mut conversor = Conversor::new(canais, taxa);
    let erro = |e: cpal::Error| log::warn!("Microfone: {e}");
    macro_rules! fluxo {
        ($t:ty, $para_f32:expr) => {{
            let envia = envia.clone();
            aparelho.build_input_stream::<$t, _, _>(
                config.config(),
                move |dados: &[$t], _: &cpal::InputCallbackInfo| {
                    let f: Vec<f32> = dados.iter().map(|&x| $para_f32(x)).collect();
                    let _ = envia.send(conversor.converter(&f));
                },
                erro,
                None,
            )
        }};
    }
    let fluxo = match formato {
        SampleFormat::F32 => fluxo!(f32, |x: f32| x),
        SampleFormat::I16 => fluxo!(i16, |x: i16| x as f32 / 32768.0),
        SampleFormat::I32 => fluxo!(i32, |x: i32| x as f32 / 2_147_483_648.0),
        SampleFormat::U16 => fluxo!(u16, |x: u16| (x as f32 - 32768.0) / 32768.0),
        outro => return Err(format!("O microfone usa um formato que não conheço ({outro}).")),
    }
    .map_err(|e| format!("Não consegui abrir o microfone: {e}"))?;
    fluxo.play().map_err(|e| format!("Não consegui ligar o microfone: {e}"))?;
    Ok(Microfone { _fluxo: fluxo, chegando })
}

#[cfg(not(windows))]
pub fn abrir_microfone() -> Result<Microfone, String> {
    Err("O ouvido próprio só grava o microfone no Windows.".into())
}

/// Junta os canais e muda a taxa para 16 kHz (interpolação simples).
pub struct Conversor {
    canais: usize,
    passo: f64,
    posicao: f64,
    anterior: f32,
}

impl Conversor {
    pub fn new(canais: usize, taxa: f64) -> Self {
        Conversor { canais: canais.max(1), passo: taxa / TAXA as f64, posicao: 0.0, anterior: 0.0 }
    }

    pub fn converter(&mut self, dados: &[f32]) -> Vec<f32> {
        let mono: Vec<f32> = dados.chunks(self.canais).map(|q| q.iter().sum::<f32>() / q.len() as f32).collect();
        let mut saida = Vec::with_capacity((mono.len() as f64 / self.passo) as usize + 1);
        // `posicao` conta a partir da última amostra do pedaço anterior (índice -1).
        while self.posicao < mono.len() as f64 {
            let i = self.posicao.floor();
            let frac = (self.posicao - i) as f32;
            let i = i as isize;
            let a = if i < 1 { self.anterior } else { mono[(i - 1) as usize] };
            let b = if i < 0 { self.anterior } else { mono[i as usize] };
            saida.push(a + (b - a) * frac);
            self.posicao += self.passo;
        }
        self.posicao -= mono.len() as f64;
        if let Some(&u) = mono.last() {
            self.anterior = u;
        }
        saida
    }
}

// ---------- Ouvir um pedido ----------

/// Manda para a nuvem só o som de quando a pessoa está falando (com 0,4 s de
/// antes, para não cortar o começo). O silêncio de espera não gasta crédito.
struct EnvioNuvem {
    nuvem: Option<super::nuvem::Nuvem>,
    antes: std::collections::VecDeque<f32>,
}

impl EnvioNuvem {
    fn novo() -> Self {
        EnvioNuvem { nuvem: super::nuvem::abrir(), antes: std::collections::VecDeque::new() }
    }

    /// Chamar depois de empurrar o som no cortador: `falava` é como estava antes.
    fn som(&mut self, som: &[f32], falava: bool, fala_agora: bool, terminou: bool) {
        let Some(n) = &self.nuvem else { return };
        if !falava && (fala_agora || terminou) {
            let antes: Vec<f32> = self.antes.drain(..).collect();
            n.enviar(&antes);
        }
        if falava || fala_agora || terminou {
            n.enviar(som);
        } else {
            self.antes.extend(som.iter().copied());
            while self.antes.len() > TAXA * 2 / 5 {
                self.antes.pop_front();
            }
        }
    }

    /// Texto da nuvem; se falhar (sem internet, sem chave, cota), entende no PC.
    fn entender(self, fala: &[f32]) -> Result<String, String> {
        ULTIMO_PELA_NUVEM.store(false, Ordering::Relaxed);
        if let Some(n) = self.nuvem {
            let inicio = Instant::now();
            match n.terminar() {
                Ok(t) if !t.trim().is_empty() => {
                    log::info!("Ouvido: pedido entendido na nuvem em {} ms depois da fala", inicio.elapsed().as_millis());
                    ULTIMO_PELA_NUVEM.store(true, Ordering::Relaxed);
                    return Ok(t.trim().to_string());
                }
                Ok(_) => log::info!("Ouvido: a nuvem não devolveu texto; entendendo no PC"),
                Err(e) => log::warn!("Ouvido: nuvem falhou ({e}); entendendo no PC"),
            }
        }
        transcrever(bom(), fala, None)
    }
}

/// Grava até a pessoa parar de falar (1,4 s de silêncio: dá para pensar no
/// meio da frase sem ser cortado) e devolve o texto. `parar`: botão Parar.
pub fn ouvir_pedido(app: &AppHandle, parar: &AtomicBool) -> Result<String, String> {
    let microfone = abrir_microfone()?;
    let _ = app.emit("ilha:microfone-aberto", ());
    preparar_bom();
    let mut cortador = Cortador::new(1_400, 20_000);
    let mut nuvem = EnvioNuvem::novo();
    let comeco = Instant::now();
    let fala = loop {
        if parar.load(Ordering::Relaxed) {
            return Ok(String::new());
        }
        if !cortador.falando() && comeco.elapsed() > Duration::from_secs(8) {
            return Err("O microfone abriu, mas não chegou voz nenhuma. Confira em Configurações › Sistema › Som › Entrada se o microfone certo está escolhido (e se a barrinha mexe quando você fala).".into());
        }
        match microfone.chegando.recv_timeout(Duration::from_millis(200)) {
            Ok(som) => {
                let falava = cortador.falando();
                let pronta = cortador.empurrar(&som).into_iter().next();
                nuvem.som(&som, falava, cortador.falando(), pronta.is_some());
                if let Some(f) = pronta {
                    break f;
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            Err(_) => return Err("O microfone parou de mandar som.".into()),
        }
    };
    drop(microfone);
    let _ = app.emit("ilha:entendendo", ());
    let inicio = Instant::now();
    let texto = nuvem.entender(&fala)?;
    ULTIMO_PEDIDO_MS.store(inicio.elapsed().as_millis() as u64, Ordering::Relaxed);
    ULTIMA_FALA_MS.store((fala.len() * 1000 / TAXA) as u64, Ordering::Relaxed);
    log::info!("Ouvido: pedido entendido em {} ms ({} letras, fala de {} ms)", inicio.elapsed().as_millis(), texto.chars().count(), fala.len() * 1000 / TAXA);
    if texto.is_empty() {
        return Err("Chegou som, mas não entendi nenhuma palavra. Fale de novo, um pouco mais perto do microfone.".into());
    }
    Ok(texto)
}

/// Deixa os modelos carregados e "aquecidos" (a primeira conta do Whisper é a
/// mais lenta). Chamado ao ligar, quando termina de baixar e ao trocar o jeito.
pub fn aquecer() {
    if !pronto() {
        return;
    }
    std::thread::spawn(|| {
        let inicio = Instant::now();
        let silencio = vec![0.0f32; TAXA];
        let _ = transcrever(&PEQUENO, &silencio, None);
        let _ = transcrever(bom(), &silencio, None);
        log::info!("Ouvido: modelos prontos na memória em {} ms", inicio.elapsed().as_millis());
    });
}

/// Carrega o modelo bom em segundo plano (leva uns segundos), enquanto a pessoa fala.
pub fn preparar_bom() {
    if tem(bom()) {
        std::thread::spawn(|| {
            let _ = contexto(bom());
        });
    }
}

// ---------- Esperar o nome ----------

/// O pedido que veio na mesma fala do nome ("Robozinho, que horas são?").
/// O modelo bom escuta de novo para entender direito (sem dica: com o nome de
/// dica, ele às vezes repete ou some com o nome).
fn pedido_junto(fala: &[f32], nome: &str, resto: String) -> String {
    if !tem(bom()) {
        return resto;
    }
    let nuvem = EnvioNuvem::novo();
    if let Some(n) = &nuvem.nuvem {
        n.enviar(fala);
    }
    match nuvem.entender(fala).ok().filter(|t| !t.is_empty()) {
        Some(t) => match achar_nome(&t, nome) {
            Some(r) if !r.is_empty() => r,
            Some(_) => resto,
            // Ele não escreveu o nome: o texto todo é o pedido.
            None => t,
        },
        None => resto,
    }
}

/// Vê se a fala chama o robô (modelo pequeno, rápido). Devolve (o que ouviu,
/// o que veio depois do nome).
fn chamou(fala: &[f32], nome: &str) -> Option<(String, String)> {
    // O nome vem no começo: só os primeiros 2,5 s são conferidos (uma conversa
    // comprida perto do microfone não vira trabalho pesado).
    let comeco = &fala[..fala.len().min(TAXA * 5 / 2)];
    // Sem dica: com o nome como dica, o Whisper acha que ele já foi dito e o tira da frase.
    let texto = transcrever(&PEQUENO, comeco, None).ok().filter(|t| !t.is_empty())?;
    let resto = achar_nome(&texto, nome)?;
    Some((texto, resto))
}

/// Depois do nome sozinho: o MESMO microfone já ouve o pedido (sem fechar e
/// abrir outro, que perdia o começo da frase). Espera até 8 s a pessoa começar.
fn ouvir_continuacao(
    microfone: &Microfone,
    fila: &mut std::collections::VecDeque<Vec<f32>>,
) -> Result<(Vec<f32>, EnvioNuvem), String> {
    if let Some(f) = fila.pop_front() {
        // Já gravada: vai para a nuvem de uma vez (ou é entendida no PC).
        let nuvem = EnvioNuvem::novo();
        if let Some(n) = &nuvem.nuvem {
            n.enviar(&f);
        }
        return Ok((f, nuvem));
    }
    let parar = &super::voz::PARAR;
    let mut cortador = Cortador::new(1_400, 20_000);
    let mut nuvem = EnvioNuvem::novo();
    let comeco = Instant::now();
    loop {
        if parar.load(Ordering::Relaxed) {
            return Ok((Vec::new(), EnvioNuvem { nuvem: None, antes: Default::default() }));
        }
        if !cortador.falando() && comeco.elapsed() > Duration::from_secs(8) {
            return Err("Não ouvi o pedido depois do nome. Chame de novo e fale logo depois do bip.".into());
        }
        match microfone.chegando.recv_timeout(Duration::from_millis(100)) {
            Ok(som) => {
                let falava = cortador.falando();
                let pronta = cortador.empurrar(&som).into_iter().next();
                nuvem.som(&som, falava, cortador.falando(), pronta.is_some());
                if let Some(f) = pronta {
                    return Ok((f, nuvem));
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            Err(_) => return Err("O microfone parou de mandar som.".into()),
        }
    }
}

/// Chamaram pelo nome: avisa a ilha na hora, ouve o pedido (junto com o nome
/// ou logo depois, no mesmo microfone) e manda o texto.
fn atender(
    app: &AppHandle,
    microfone: &Microfone,
    fila: &mut std::collections::VecDeque<Vec<f32>>,
    nome: &str,
    texto: String,
    resto: String,
    fala: &[f32],
) {
    preparar_bom();
    super::voz::PARAR.store(false, Ordering::Relaxed);
    // A etapa vai junto: a tela pode ainda estar abrindo quando os avisos chegam.
    let veio_junto = resto.split_whitespace().count() >= 2;
    let etapa = if veio_junto { "entendendo" } else { "ouvindo" };
    let _ = app.emit("ilha:chamou", serde_json::json!({ "texto": texto, "esperando": true, "etapa": etapa }));
    let pedido = if veio_junto {
        let inicio = Instant::now();
        let p = pedido_junto(fala, nome, resto);
        ULTIMO_PEDIDO_MS.store(inicio.elapsed().as_millis() as u64, Ordering::Relaxed);
        ULTIMA_FALA_MS.store((fala.len() * 1000 / TAXA) as u64, Ordering::Relaxed);
        Ok(p)
    } else {
        // Uma palavra que veio colada no nome ("Robozinho, que… horas são?") entra no pedido.
        let comeco_do_pedido = resto.clone();
        ouvir_continuacao(microfone, fila).and_then(|(f, nuvem)| {
            if f.is_empty() {
                return Ok(String::new());
            }
            let _ = app.emit("ilha:entendendo", ());
            let inicio = Instant::now();
            let t = nuvem.entender(&f);
            ULTIMO_PEDIDO_MS.store(inicio.elapsed().as_millis() as u64, Ordering::Relaxed);
            ULTIMA_FALA_MS.store((f.len() * 1000 / TAXA) as u64, Ordering::Relaxed);
            log::info!("Ouvido: pedido entendido em {} ms (fala de {} ms)", inicio.elapsed().as_millis(), f.len() * 1000 / TAXA);
            t.map(|t| if comeco_do_pedido.is_empty() || t.is_empty() { t } else { format!("{comeco_do_pedido} {t}") })
        })
    };
    let _ = match pedido {
        Ok(texto) => app.emit("ilha:pedido-ouvido", serde_json::json!({ "texto": texto })),
        Err(erro) => app.emit("ilha:pedido-ouvido", serde_json::json!({ "erro": erro })),
    };
}

/// Fica ouvindo até `continuar` dizer que não. Quando alguém chama pelo nome:
/// avisa a ilha na hora ("ilha:chamou": ela abre e para de falar, se estava
/// falando), ouve o pedido (junto com o nome ou logo depois, no mesmo
/// microfone) e manda o texto ("ilha:pedido-ouvido"). Devolve `true`.
pub fn esperar_nome(app: &AppHandle, continuar: impl Fn() -> bool, ouviu: impl Fn(String)) -> Result<bool, String> {
    let microfone = abrir_microfone()?;
    // 400 ms de silêncio já encerram a fala do nome (responde mais rápido; se a
    // pessoa continuar falando, a continuação vira o pedido).
    let mut cortador = Cortador::new(400, 8_000);
    let mut fila: std::collections::VecDeque<Vec<f32>> = std::collections::VecDeque::new();
    let mut ultimo_alivio = Instant::now();
    // Os últimos 2 s de som: com o robô falando, é aqui que se procura o nome.
    let mut recente: std::collections::VecDeque<f32> = std::collections::VecDeque::with_capacity(TAXA * 2);
    let mut ultima_olhada = Instant::now();
    let mut estava_falando = false;
    while continuar() {
        if ultimo_alivio.elapsed() > Duration::from_secs(30) {
            ultimo_alivio = Instant::now();
            aliviar_memoria();
        }
        let som = match microfone.chegando.recv_timeout(Duration::from_millis(200)) {
            Ok(som) => som,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
            Err(_) => return Err("O microfone parou de mandar som.".into()),
        };
        recente.extend(som.iter().copied());
        while recente.len() > TAXA * 2 {
            recente.pop_front();
        }
        let falando = FALANDO.load(Ordering::Relaxed);
        if falando {
            // A voz do robô sai na caixa de som e entra no microfone: tudo vira uma
            // fala só, comprida. Então, enquanto ele fala, a ilha olha os últimos
            // 2 s a cada 0,7 s procurando o nome (interromper chamando o nome).
            estava_falando = true;
            cortador.empurrar(&som);
            if ultima_olhada.elapsed() < Duration::from_millis(700) || FALA_COM_NOME.load(Ordering::Relaxed) {
                continue;
            }
            ultima_olhada = Instant::now();
            let pedaco: Vec<f32> = recente.iter().copied().collect();
            let nome = super::chamado::nome_atual();
            if let Some((texto, _)) = chamou(&pedaco, &nome) {
                log::info!("Ouvido: interrompido pelo nome");
                ouviu(texto.clone());
                fila.clear();
                atender(app, &microfone, &mut fila, &nome, texto, String::new(), &pedaco);
                return Ok(true);
            }
            continue;
        }
        if estava_falando {
            // O robô parou: o que sobrou no cortador era a voz dele.
            estava_falando = false;
            cortador = Cortador::new(400, 8_000);
            fila.clear();
            continue;
        }
        fila.extend(cortador.empurrar(&som));
        while let Some(fala) = fila.pop_front() {
            let segundos = fala.len() as f32 / TAXA as f32;
            if !(0.3..=8.0).contains(&segundos) {
                continue;
            }
            let nome = super::chamado::nome_atual();
            let inicio = Instant::now();
            let Some((texto, resto)) = chamou(&fala, &nome) else { continue };
            log::info!("Ouvido: nome reconhecido em {} ms", inicio.elapsed().as_millis());
            ouviu(texto.clone());
            atender(app, &microfone, &mut fila, &nome, texto, resto, &fala);
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn acha_o_nome_e_o_pedido() {
        assert_eq!(achar_nome("Robozinho, que horas são?", "Robozinho").as_deref(), Some("que horas são?"));
        assert_eq!(achar_nome("Ei, robôzinho!", "Robozinho").as_deref(), Some(""));
        assert_eq!(achar_nome("ô robo zinho abre o spotify", "Robozinho").as_deref(), Some("abre o spotify"));
        assert_eq!(achar_nome("Robozinhos.", "Robozinho").as_deref(), Some(""));
        assert_eq!(achar_nome("vamos almoçar agora", "Robozinho"), None);
        assert_eq!(achar_nome("o robô quebrou", "Robozinho"), None);
    }

    #[test]
    fn tira_frase_repetida() {
        assert_eq!(tirar_repeticao("Robozinho. Robozinho. Robozinho."), "Robozinho.");
        assert_eq!(
            tirar_repeticao("Vamos almoçar no restaurante. Vamos almoçar no restaurante. Vamos almoçar"),
            "Vamos almoçar no restaurante."
        );
        assert_eq!(tirar_repeticao("que horas são agora?"), "que horas são agora?");
        assert_eq!(tirar_repeticao("Robozinho, que horas? Robozinho, que horas? Roboz"), "Robozinho, que horas?");
        // Palavra repetida de propósito no meio não some.
        assert_eq!(tirar_repeticao("muito muito obrigado"), "muito muito obrigado");
    }

    #[test]
    fn corta_a_fala_entre_silencios() {
        let mut c = Cortador::new(600, 8_000);
        let silencio = vec![0.0005f32; TAXA];
        let voz: Vec<f32> = (0..TAXA).map(|i| 0.2 * ((i as f32) * 0.05).sin()).collect();
        assert!(c.empurrar(&silencio).is_empty());
        assert!(c.empurrar(&voz).is_empty());
        assert!(c.falando());
        let falas = c.empurrar(&silencio);
        assert_eq!(falas.len(), 1);
        // ~1 s de voz + o começo (até 300 ms) + 150 ms de silêncio no fim.
        let s = falas[0].len() as f32 / TAXA as f32;
        assert!((1.2..1.7).contains(&s), "{s}");
        // Um estalo curto não vira fala.
        let estalo = vec![0.3f32; QUADRO * 3];
        c.empurrar(&estalo);
        assert!(c.empurrar(&silencio).is_empty());
    }

    /// Teste com o Whisper de verdade (precisa dos modelos e de falas gravadas):
    /// OUVIDO_TESTE=<pasta com ggml-base-q5_1.bin e falas .f32> cargo test -- --ignored
    #[test]
    #[ignore]
    fn entende_portugues_de_verdade() {
        let pasta = PathBuf::from(std::env::var("OUVIDO_TESTE").expect("OUVIDO_TESTE"));
        *PASTA.lock().unwrap() = Some(pasta.clone());
        let ler = |nome: &str| -> Vec<f32> {
            let bytes = std::fs::read(pasta.join(format!("{nome}.f32"))).unwrap();
            bytes.chunks(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect()
        };
        for (nome, espera) in [("nome", Some("")), ("pedido", Some("que horas")), ("outra", None)] {
            // Como no microfone: silêncio, a fala, silêncio; o cortador separa.
            let mut c = Cortador::new(700, 8_000);
            let mut som = vec![0.0005f32; TAXA];
            som.extend(ler(nome));
            som.extend(vec![0.0005f32; TAXA]);
            let mut falas: std::collections::VecDeque<Vec<f32>> = c.empurrar(&som).into();
            for f in &falas {
                println!("{nome}: fala {:.2}s: {:?}", f.len() as f32 / TAXA as f32, transcrever(&PEQUENO, f, None));
                if tem(bom()) {
                    for j in [128i64] {
                        JANELA.store(j, Ordering::Relaxed);
                        let t = Instant::now();
                        println!("  bom janela {j}: {:?} ({} ms)", transcrever(bom(), f, None), t.elapsed().as_millis());
                    }
                    JANELA.store(128, Ordering::Relaxed);
                }
            }
            let primeira = falas.pop_front().unwrap();
            let inicio = Instant::now();
            let r = chamou(&primeira, "Robozinho").map(|(texto, resto)| {
                let pedido = if resto.split_whitespace().count() >= 2 {
                    pedido_junto(&primeira, "Robozinho", resto)
                } else {
                    falas.pop_front().and_then(|f| transcrever(bom(), &f, None).ok()).unwrap_or(resto)
                };
                (texto, pedido)
            });
            println!("{nome}: {r:?} ({} ms)", inicio.elapsed().as_millis());
            match espera {
                None => assert!(r.is_none(), "{nome}"),
                Some(trecho) => {
                    let (_, pedido) = r.expect(nome);
                    assert!(pedido.to_lowercase().contains(trecho), "{nome}: {pedido}");
                }
            }
        }
    }

    #[test]
    fn converte_48k_estereo_para_16k_mono() {
        let mut c = Conversor::new(2, 48_000.0);
        let dados = vec![0.5f32; 48_000 * 2];
        let saida = c.converter(&dados);
        assert!((15_990..=16_010).contains(&saida.len()), "{}", saida.len());
        assert!(saida[100..].iter().all(|&x| (x - 0.5).abs() < 1e-4));
    }
}
