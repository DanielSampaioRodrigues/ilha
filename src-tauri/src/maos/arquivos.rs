//! Arquivos soltos na ilha: diminuir imagens, juntar imagens num PDF,
//! converter entre JPG e PNG e renomear em sequência. O resultado é sempre
//! gravado AO LADO do original, com um nome novo: nada é apagado nem
//! sobrescrito (renomear só acontece se o nome novo estiver livre).

use std::io::Write;
use std::path::{Path, PathBuf};

use image::{DynamicImage, GenericImageView, ImageFormat};

/// Um nome que ainda não existe: "foto (menor).jpg", "foto (menor) 2.jpg"…
fn livre(pasta: &Path, base: &str, ext: &str) -> PathBuf {
    let primeiro = pasta.join(format!("{base}.{ext}"));
    if !primeiro.exists() {
        return primeiro;
    }
    (2..10_000)
        .map(|n| pasta.join(format!("{base} {n}.{ext}")))
        .find(|p| !p.exists())
        .unwrap_or(primeiro)
}

fn partes(caminho: &Path) -> (PathBuf, String) {
    let pasta = caminho.parent().map(Path::to_path_buf).unwrap_or_default();
    let nome = caminho.file_stem().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "arquivo".into());
    (pasta, nome)
}

fn abrir_imagem(caminho: &Path) -> Result<DynamicImage, String> {
    image::ImageReader::open(caminho)
        .map_err(|e| format!("{}: {e}", caminho.display()))?
        .with_guessed_format()
        .map_err(|e| e.to_string())?
        .decode()
        .map_err(|e| format!("Não consegui ler a imagem {}: {e}", caminho.display()))
}

fn gravar_jpg(img: &DynamicImage, destino: &Path, qualidade: u8) -> Result<(), String> {
    let rgb = img.to_rgb8();
    let mut f = std::io::BufWriter::new(std::fs::File::create(destino).map_err(|e| e.to_string())?);
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut f, qualidade)
        .encode_image(&rgb)
        .map_err(|e| e.to_string())?;
    f.flush().map_err(|e| e.to_string())
}

/// Diminui imagens (lado maior até `max_lado`, JPG de qualidade 82).
#[tauri::command]
pub async fn diminuir_imagens(caminhos: Vec<String>, max_lado: Option<u32>) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let max = max_lado.unwrap_or(1920).clamp(320, 8000);
        let mut feitos = Vec::new();
        for c in caminhos {
            let origem = PathBuf::from(&c);
            let img = abrir_imagem(&origem)?;
            let (w, h) = img.dimensions();
            let img = if w.max(h) > max { img.resize(max, max, image::imageops::FilterType::Lanczos3) } else { img };
            let (pasta, nome) = partes(&origem);
            let destino = livre(&pasta, &format!("{nome} (menor)"), "jpg");
            gravar_jpg(&img, &destino, 82)?;
            feitos.push(destino.to_string_lossy().to_string());
        }
        Ok(feitos)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Converte imagens para "jpg" ou "png".
#[tauri::command]
pub async fn converter_imagens(caminhos: Vec<String>, formato: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut feitos = Vec::new();
        for c in caminhos {
            let origem = PathBuf::from(&c);
            let img = abrir_imagem(&origem)?;
            let (pasta, nome) = partes(&origem);
            let destino = match formato.as_str() {
                "png" => {
                    let d = livre(&pasta, &nome, "png");
                    img.save_with_format(&d, ImageFormat::Png).map_err(|e| e.to_string())?;
                    d
                }
                _ => {
                    let d = livre(&pasta, &nome, "jpg");
                    gravar_jpg(&img, &d, 92)?;
                    d
                }
            };
            feitos.push(destino.to_string_lossy().to_string());
        }
        Ok(feitos)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Um PDF com uma imagem por página (na ordem em que vieram), ao lado da primeira.
#[tauri::command]
pub async fn imagens_para_pdf(caminhos: Vec<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let primeira = PathBuf::from(caminhos.first().ok_or("Nenhuma imagem.")?);
        let mut paginas = Vec::new();
        for c in &caminhos {
            let img = abrir_imagem(Path::new(c))?;
            let (w, h) = img.dimensions();
            let mut jpg = Vec::new();
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpg, 90)
                .encode_image(&img.to_rgb8())
                .map_err(|e| e.to_string())?;
            paginas.push((w, h, jpg));
        }
        let (pasta, nome) = partes(&primeira);
        let destino = livre(&pasta, &format!("{nome} (imagens)"), "pdf");
        std::fs::write(&destino, montar_pdf(&paginas)).map_err(|e| e.to_string())?;
        Ok(destino.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// PDF mínimo: cada página do tamanho da imagem (cabendo num A4 em pé ou deitado).
fn montar_pdf(paginas: &[(u32, u32, Vec<u8>)]) -> Vec<u8> {
    let mut saida: Vec<u8> = b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n".to_vec();
    let mut posicoes: Vec<usize> = Vec::new();
    // Objetos: 1 catálogo, 2 páginas, depois para cada página: página, imagem, conteúdo.
    let n = paginas.len();
    let id_pagina = |i: usize| 3 + i * 3;
    let mut objeto = |saida: &mut Vec<u8>, corpo: &[u8]| {
        posicoes.push(saida.len());
        let numero = posicoes.len();
        saida.extend_from_slice(format!("{numero} 0 obj\n").as_bytes());
        saida.extend_from_slice(corpo);
        saida.extend_from_slice(b"\nendobj\n");
    };
    objeto(&mut saida, b"<< /Type /Catalog /Pages 2 0 R >>");
    let filhos: Vec<String> = (0..n).map(|i| format!("{} 0 R", id_pagina(i))).collect();
    objeto(&mut saida, format!("<< /Type /Pages /Kids [{}] /Count {n} >>", filhos.join(" ")).as_bytes());
    for (i, (w, h, jpg)) in paginas.iter().enumerate() {
        // A4 = 595 x 842 pontos: a página fica do jeito da imagem, sem passar disso.
        let (lw, lh) = if w > h { (842.0, 595.0) } else { (595.0, 842.0) };
        let escala = (lw / *w as f64).min(lh / *h as f64).min(1.0);
        let (pw, ph) = ((*w as f64 * escala).round().max(1.0), (*h as f64 * escala).round().max(1.0));
        let pagina = id_pagina(i);
        objeto(
            &mut saida,
            format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {pw} {ph}] /Resources << /XObject << /Im{i} {} 0 R >> >> /Contents {} 0 R >>",
                pagina + 1,
                pagina + 2
            )
            .as_bytes(),
        );
        let mut img = format!(
            "<< /Type /XObject /Subtype /Image /Width {w} /Height {h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length {} >>\nstream\n",
            jpg.len()
        )
        .into_bytes();
        img.extend_from_slice(jpg);
        img.extend_from_slice(b"\nendstream");
        objeto(&mut saida, &img);
        let conteudo = format!("q {pw} 0 0 {ph} 0 0 cm /Im{i} Do Q");
        let mut c = format!("<< /Length {} >>\nstream\n", conteudo.len()).into_bytes();
        c.extend_from_slice(conteudo.as_bytes());
        c.extend_from_slice(b"\nendstream");
        objeto(&mut saida, &c);
    }
    let xref = saida.len();
    saida.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", posicoes.len() + 1).as_bytes());
    for p in &posicoes {
        saida.extend_from_slice(format!("{p:010} 00000 n \n").as_bytes());
    }
    saida.extend_from_slice(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", posicoes.len() + 1).as_bytes());
    saida
}

/// Renomeia em sequência: "Base 01.jpg", "Base 02.pdf"… (na ordem dada). Pula
/// (e avisa) os que já tiverem um arquivo com o nome novo.
#[tauri::command]
pub fn renomear_em_sequencia(caminhos: Vec<String>, base: String) -> Result<Vec<String>, String> {
    let base: String = base.trim().chars().filter(|c| !"\\/:*?\"<>|".contains(*c)).collect();
    if base.is_empty() {
        return Err("Escolha um nome.".into());
    }
    let digitos = caminhos.len().to_string().len().max(2);
    let mut feitos = Vec::new();
    for (i, c) in caminhos.iter().enumerate() {
        let origem = PathBuf::from(c);
        let pasta = origem.parent().map(Path::to_path_buf).unwrap_or_default();
        let ext = origem.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
        let destino = pasta.join(format!("{base} {:0digitos$}{ext}", i + 1));
        if destino.exists() {
            return Err(format!("Já existe {}; parei antes de mexer nele.", destino.display()));
        }
        std::fs::rename(&origem, &destino).map_err(|e| format!("Não consegui renomear {}: {e}", origem.display()))?;
        feitos.push(destino.to_string_lossy().to_string());
    }
    Ok(feitos)
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn faz_pdf_e_diminui() {
        let pasta = std::env::temp_dir().join(format!("ilha-teste-arquivos-{}", std::process::id()));
        std::fs::create_dir_all(&pasta).unwrap();
        let a = pasta.join("foto.png");
        DynamicImage::new_rgb8(3000, 2000).save(&a).unwrap();
        let b = pasta.join("outra.jpg");
        gravar_jpg(&DynamicImage::new_rgb8(800, 1200), &b, 80).unwrap();
        let rt = tokio::runtime::Builder::new_current_thread().build().unwrap();
        let menores = rt.block_on(diminuir_imagens(vec![a.to_string_lossy().into()], Some(1920))).unwrap();
        assert!(menores[0].ends_with("foto (menor).jpg"));
        assert_eq!(abrir_imagem(Path::new(&menores[0])).unwrap().dimensions(), (1920, 1280));
        let pdf = rt.block_on(imagens_para_pdf(vec![a.to_string_lossy().into(), b.to_string_lossy().into()])).unwrap();
        let bytes = std::fs::read(&pdf).unwrap();
        assert!(bytes.starts_with(b"%PDF-1.4") && bytes.ends_with(b"%%EOF\n"));
        assert_eq!(String::from_utf8_lossy(&bytes).matches("/Type /Page ").count(), 2);
        // Converter de novo não sobrescreve: ganha " 2".
        let j1 = rt.block_on(converter_imagens(vec![a.to_string_lossy().into()], "jpg".into())).unwrap();
        let j2 = rt.block_on(converter_imagens(vec![a.to_string_lossy().into()], "jpg".into())).unwrap();
        assert_ne!(j1[0], j2[0]);
        let novos = renomear_em_sequencia(vec![j1[0].clone(), j2[0].clone()], "Viagem".into()).unwrap();
        assert!(novos[0].ends_with("Viagem 01.jpg") && novos[1].ends_with("Viagem 02.jpg"));
        if std::env::var_os("MANTER_ARQUIVOS_TESTE").is_none() {
            let _ = std::fs::remove_dir_all(&pasta);
        }
    }
}
