//! Achar pastas do computador pelo nome falado ("abre a pasta clientes arcano
//! 3"), mesmo com o nome meio errado. A ilha guarda um índice só com as PASTAS
//! (não arquivos) de todos os discos do PC, montado em segundo plano ao ligar e
//! refeito a cada 6 horas. Pastas do sistema e de programas ficam de fora.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;

/// Caminhos das pastas (com o nome já normalizado, para comparar rápido).
static INDICE: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());
static MONTANDO: AtomicBool = AtomicBool::new(false);
static MONTADO_EM: Mutex<Option<Instant>> = Mutex::new(None);

const MAXIMO: usize = 500_000;
const FUNDO_MAXIMO: usize = 9;
/// Nomes de pastas que nunca entram (sistema, programas, lixo de ferramentas).
const PULAR: [&str; 20] = [
    "windows", "program files", "program files (x86)", "programdata", "$recycle.bin", "system volume information",
    "appdata", "node_modules", "$winreagent", "recovery", "perflogs", "msocache", "config.msi", "$windows.~bt",
    "$windows.~ws", "windowsapps", "__pycache__", "$sysreset", "onedrivetemp", "intel",
];

#[derive(Serialize, Clone, Debug)]
pub struct PastaAchada {
    pub caminho: String,
    pub nome: String,
    pub nota: u32,
}

// ---------- Comparar nomes ----------

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

/// Palavras do nome: minúsculas, sem acento, números falados e romanos viram dígitos.
pub fn palavras(nome: &str) -> Vec<String> {
    let limpo: String = nome
        .to_lowercase()
        .chars()
        .map(sem_acento)
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect();
    limpo
        .split_whitespace()
        .map(|p| {
            match p {
                "um" | "uma" | "i" => "1",
                "dois" | "duas" | "ii" => "2",
                "tres" | "iii" => "3",
                "quatro" | "iv" => "4",
                "cinco" | "v" => "5",
                "seis" | "vi" => "6",
                "sete" | "vii" => "7",
                "oito" | "viii" => "8",
                "nove" | "ix" => "9",
                "dez" | "x" => "10",
                outro => outro,
            }
            .to_string()
        })
        .filter(|p| !matches!(p.as_str(), "a" | "o" | "as" | "os" | "de" | "do" | "da" | "dos" | "das" | "e" | "pasta"))
        .collect()
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
            linha[j] = if a[i - 1] == b[j - 1] { anterior } else { 1 + anterior.min(linha[j]).min(linha[j - 1]) };
            anterior = atual;
        }
    }
    linha[b.len()]
}

fn parecidas(a: &str, b: &str) -> bool {
    if a == b {
        return true;
    }
    // Números precisam ser iguais ("2024" não é "2023", "3" não é "4").
    if a.chars().any(|c| c.is_ascii_digit()) || b.chars().any(|c| c.is_ascii_digit()) {
        return false;
    }
    let n = a.chars().count().min(b.chars().count());
    n >= 4 && distancia(a, b) <= n / 4
}

/// Nota de 0 a 100: quanto o nome da pasta combina com o que foi pedido.
pub fn nota(pedido: &[String], pasta: &[String]) -> u32 {
    if pedido.is_empty() || pasta.is_empty() {
        return 0;
    }
    if pedido == pasta {
        return 100;
    }
    let achadas = pedido.iter().filter(|q| pasta.iter().any(|f| parecidas(q, f))).count();
    if achadas == pedido.len() {
        // Todas as palavras pedidas estão no nome; menos palavras sobrando = melhor.
        let sobra = pasta.len().saturating_sub(pedido.len()) as u32;
        return 90u32.saturating_sub(sobra * 5).max(70);
    }
    // Nome junto (ex.: "clientesarcano3" ou só parte dele).
    let (jp, jf) = (pedido.concat(), pasta.concat());
    let numeros = |p: &[String]| p.iter().filter(|x| x.chars().all(|c| c.is_ascii_digit())).cloned().collect::<Vec<_>>();
    if jp.len() >= 5 && numeros(pedido) == numeros(pasta) && (jf.contains(&jp) || parecidas(&jp, &jf)) {
        return 75;
    }
    let fracao = achadas as f32 / pedido.len() as f32;
    if fracao >= 0.6 {
        (fracao * 65.0) as u32
    } else {
        0
    }
}

// ---------- Índice ----------

fn discos() -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        use windows::core::PCWSTR;
        use windows::Win32::Storage::FileSystem::{GetDriveTypeW, GetLogicalDrives};
        const FIXO: u32 = 3; // DRIVE_FIXED
        let mascara = unsafe { GetLogicalDrives() };
        (0..26u8)
            .filter(|i| mascara & (1 << i) != 0)
            .map(|i| format!("{}:\\", (b'A' + i) as char))
            .filter(|raiz| {
                let largo: Vec<u16> = raiz.encode_utf16().chain(Some(0)).collect();
                unsafe { GetDriveTypeW(PCWSTR(largo.as_ptr())) == FIXO }
            })
            .map(PathBuf::from)
            .collect()
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("HOME").map(PathBuf::from).into_iter().collect()
    }
}

fn montar() {
    if MONTANDO.swap(true, Ordering::Relaxed) {
        return;
    }
    let inicio = Instant::now();
    let mut lista: Vec<(String, String)> = Vec::new();
    let mut fila: Vec<(PathBuf, usize)> = discos().into_iter().map(|d| (d, 0)).collect();
    while let Some((pasta, fundo)) = fila.pop() {
        if lista.len() >= MAXIMO {
            break;
        }
        let Ok(itens) = std::fs::read_dir(&pasta) else { continue };
        for item in itens.flatten() {
            let Ok(tipo) = item.file_type() else { continue };
            // Atalhos de pasta (junções) ficam de fora: evitam voltas infinitas.
            if !tipo.is_dir() || tipo.is_symlink() {
                continue;
            }
            let nome = item.file_name().to_string_lossy().to_string();
            let minusculo = nome.to_lowercase();
            if nome.starts_with('.') || nome.starts_with('$') || PULAR.contains(&minusculo.as_str()) {
                continue;
            }
            let caminho = item.path();
            lista.push((caminho.to_string_lossy().to_string(), palavras(&nome).join(" ")));
            if fundo + 1 < FUNDO_MAXIMO {
                fila.push((caminho, fundo + 1));
            }
        }
    }
    log::info!("Pastas: índice com {} pastas em {} s", lista.len(), inicio.elapsed().as_secs());
    if let Ok(mut i) = INDICE.lock() {
        *i = lista;
    }
    if let Ok(mut m) = MONTADO_EM.lock() {
        *m = Some(Instant::now());
    }
    MONTANDO.store(false, Ordering::Relaxed);
}

/// Monta o índice 1 min depois de ligar e refaz a cada 6 horas.
pub fn iniciar() {
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_secs(60));
        loop {
            montar();
            std::thread::sleep(Duration::from_secs(6 * 3600));
        }
    });
}

fn procurar_no_indice(nome: &str) -> Vec<PastaAchada> {
    let pedido = palavras(nome);
    let Ok(indice) = INDICE.lock() else { return Vec::new() };
    let mut achadas: Vec<PastaAchada> = indice
        .iter()
        .filter_map(|(caminho, nome_normal)| {
            let pasta: Vec<String> = nome_normal.split(' ').map(String::from).collect();
            let n = nota(&pedido, &pasta);
            (n >= 50).then(|| PastaAchada {
                nome: Path::new(caminho).file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default(),
                caminho: caminho.clone(),
                nota: n,
            })
        })
        .collect();
    // Melhor nota primeiro; empate: caminho mais curto (mais perto da raiz).
    achadas.sort_by(|a, b| b.nota.cmp(&a.nota).then(a.caminho.len().cmp(&b.caminho.len())));
    achadas.truncate(8);
    achadas
}

/// Procura pastas pelo nome em todos os discos. Se o índice ainda não existe,
/// monta agora (a primeira vez pode levar um minuto).
#[tauri::command]
pub async fn procurar_pastas(nome: String) -> Vec<PastaAchada> {
    tauri::async_runtime::spawn_blocking(move || {
        let vazio = INDICE.lock().map(|i| i.is_empty()).unwrap_or(true);
        if vazio {
            if MONTANDO.load(Ordering::Relaxed) {
                // Já está montando (ao ligar): espera até 90 s.
                let comeco = Instant::now();
                while MONTANDO.load(Ordering::Relaxed) && comeco.elapsed() < Duration::from_secs(90) {
                    std::thread::sleep(Duration::from_millis(300));
                }
            } else {
                montar();
            }
        }
        procurar_no_indice(&nome)
    })
    .await
    .unwrap_or_default()
}

/// Abre uma pasta no Explorador, só se for mesmo uma pasta (nunca um programa).
#[tauri::command]
pub fn abrir_pasta(app: tauri::AppHandle, caminho: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let caminho = caminho.trim();
    if !Path::new(caminho).is_dir() {
        return Err("Essa pasta não existe (ou não é uma pasta).".into());
    }
    app.opener().open_path(caminho, None::<&str>).map_err(|e| e.to_string())
}

/// Refaz o índice agora (ex.: a pasta foi criada há pouco e não foi achada).
#[tauri::command]
pub async fn renovar_pastas() {
    let _ = tauri::async_runtime::spawn_blocking(montar).await;
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn acha_nome_aproximado() {
        let pasta = palavras("Clientes Arcano 3");
        assert_eq!(nota(&palavras("clientes arcano 3"), &pasta), 100);
        assert!(nota(&palavras("Clientes Arcano três"), &pasta) >= 90);
        assert!(nota(&palavras("pasta dos clientes arcanos 3"), &pasta) >= 90);
        assert!(nota(&palavras("clientes arcano III"), &pasta) >= 90);
        assert!(nota(&palavras("arcano 3"), &pasta) >= 70);
        assert!(nota(&palavras("clientes arcano 3"), &palavras("Clientes Arcano 3 - antigos")) >= 70);
        assert!(nota(&palavras("clientes arcano 3"), &pasta) > nota(&palavras("clientes arcano 3"), &palavras("Clientes Arcano 3 - antigos")));
        assert_eq!(nota(&palavras("fotos da viagem"), &pasta), 0);
        // Números diferentes não servem.
        assert!(nota(&palavras("clientes arcano 3"), &palavras("Clientes Arcano 4")) < 50);
        assert!(nota(&palavras("notas 2024"), &palavras("Notas 2023")) < 50);
    }
}
