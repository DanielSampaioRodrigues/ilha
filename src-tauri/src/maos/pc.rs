//! "Meu PC": diagnóstico do computador e correções simples.
//!
//! Mostra processador, memória, disco, programas que mais pesam, há quanto
//! tempo o PC está ligado e o tamanho dos arquivos temporários. A única
//! correção automática é apagar temporários antigos (o mesmo que a Limpeza de
//! Disco do Windows faz), e só depois da confirmação do Dan.
//! Também avisa a ilha quando o PC fica pesado por um tempo.

use std::collections::HashMap;
use std::path::Path;
use std::thread;
use std::time::{Duration, SystemTime};

use serde::Serialize;
use sysinfo::{Disks, ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter};

#[derive(Serialize)]
pub struct Programa {
    pub nome: String,
    /// Memória em MB (somando todas as janelas/processos do programa).
    pub memoria_mb: u64,
}

#[derive(Serialize)]
pub struct Diagnostico {
    pub processador: f32,
    pub memoria_usada_gb: f32,
    pub memoria_total_gb: f32,
    pub disco_livre_gb: f32,
    pub disco_total_gb: f32,
    pub ligado_horas: f32,
    pub temporarios_mb: u64,
    pub pesados: Vec<Programa>,
}

const GB: f32 = 1024.0 * 1024.0 * 1024.0;

/// Arquivos temporários com mais de 2 dias (os mais novos podem estar em uso).
fn temporarios_antigos() -> Vec<(std::path::PathBuf, u64)> {
    let limite = SystemTime::now() - Duration::from_secs(2 * 24 * 3600);
    let mut lista = Vec::new();
    let mut pastas = vec![std::env::temp_dir()];
    while let Some(pasta) = pastas.pop() {
        let Ok(itens) = std::fs::read_dir(&pasta) else { continue };
        for item in itens.flatten() {
            let Ok(info) = item.metadata() else { continue };
            if info.is_dir() {
                if lista.len() < 200_000 {
                    pastas.push(item.path());
                }
            } else if info.modified().map(|m| m < limite).unwrap_or(false) {
                lista.push((item.path(), info.len()));
            }
        }
    }
    lista
}

fn disco_do_sistema(discos: &Disks) -> (f32, f32) {
    let sistema = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
    discos
        .iter()
        .find(|d| d.mount_point().to_string_lossy().to_uppercase().starts_with(&sistema.to_uppercase()))
        .or_else(|| discos.iter().find(|d| d.mount_point() == Path::new("/")))
        .map(|d| (d.available_space() as f32 / GB, d.total_space() as f32 / GB))
        .unwrap_or((0.0, 0.0))
}

fn medir() -> Option<Diagnostico> {
    let mut s = System::new().ok()?;
    s.refresh_cpu_usage();
    thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL.max(Duration::from_millis(300)));
    s.refresh_cpu_usage();
    s.refresh_memory();
    s.refresh_processes(ProcessesToUpdate::All, true);

    let mut por_programa: HashMap<String, u64> = HashMap::new();
    for p in s.processes().values() {
        let nome = p.name().to_string_lossy().trim_end_matches(".exe").to_string();
        *por_programa.entry(nome).or_default() += p.memory();
    }
    let mut pesados: Vec<Programa> = por_programa
        .into_iter()
        .map(|(nome, bytes)| Programa { nome, memoria_mb: bytes / (1024 * 1024) })
        .collect();
    pesados.sort_by(|a, b| b.memoria_mb.cmp(&a.memoria_mb));
    pesados.truncate(5);

    let (disco_livre_gb, disco_total_gb) = Disks::new_with_refreshed_list()
        .map(|d| disco_do_sistema(&d))
        .unwrap_or((0.0, 0.0));
    let temporarios_mb = temporarios_antigos().iter().map(|(_, t)| t).sum::<u64>() / (1024 * 1024);

    Some(Diagnostico {
        processador: s.global_cpu_usage(),
        memoria_usada_gb: s.used_memory() as f32 / GB,
        memoria_total_gb: s.total_memory() as f32 / GB,
        disco_livre_gb,
        disco_total_gb,
        ligado_horas: System::uptime().unwrap_or(0) as f32 / 3600.0,
        temporarios_mb,
        pesados,
    })
}

#[tauri::command]
pub async fn diagnostico_pc() -> Option<Diagnostico> {
    tauri::async_runtime::spawn_blocking(medir).await.ok().flatten()
}

/// Apaga temporários antigos. Arquivos em uso são pulados. Devolve os MB liberados.
#[tauri::command]
pub async fn limpar_temporarios() -> u64 {
    tauri::async_runtime::spawn_blocking(|| {
        let mut liberado = 0u64;
        for (caminho, tamanho) in temporarios_antigos() {
            if std::fs::remove_file(&caminho).is_ok() {
                liberado += tamanho;
            }
        }
        log::info!("Temporários limpos: {} MB", liberado / (1024 * 1024));
        liberado / (1024 * 1024)
    })
    .await
    .unwrap_or(0)
}

#[derive(Clone, Serialize)]
pub struct PcPesado {
    pub motivo: String,
    pub programa: String,
}

/// A cada 10 s mede o processador e a memória. Se ficar pesado por ~1 minuto,
/// avisa (no máximo uma vez a cada 30 minutos).
pub fn vigiar(app: AppHandle) {
    thread::spawn(move || {
        let Ok(mut s) = System::new() else { return };
        let mut seguidas = 0;
        let mut ultimo_aviso: Option<SystemTime> = None;
        loop {
            thread::sleep(Duration::from_secs(10));
            s.refresh_cpu_usage();
            s.refresh_memory();
            let cpu = s.global_cpu_usage();
            let memoria = s.used_memory() as f32 / s.total_memory().max(1) as f32;
            let pesado = cpu > 90.0 || memoria > 0.92;
            seguidas = if pesado { seguidas + 1 } else { 0 };
            let pode_avisar = ultimo_aviso
                .and_then(|t| t.elapsed().ok())
                .is_none_or(|d| d > Duration::from_secs(30 * 60));
            if seguidas >= 6 && pode_avisar {
                s.refresh_processes(ProcessesToUpdate::All, true);
                let culpado = s
                    .processes()
                    .values()
                    .max_by(|a, b| {
                        if cpu > 90.0 {
                            a.cpu_usage().total_cmp(&b.cpu_usage())
                        } else {
                            a.memory().cmp(&b.memory())
                        }
                    })
                    .map(|p| p.name().to_string_lossy().trim_end_matches(".exe").to_string())
                    .unwrap_or_default();
                let motivo = if cpu > 90.0 { "processador no limite" } else { "memória quase cheia" };
                let _ = app.emit("ilha:pc-pesado", PcPesado { motivo: motivo.into(), programa: culpado });
                ultimo_aviso = Some(SystemTime::now());
                seguidas = 0;
            }
        }
    });
}
