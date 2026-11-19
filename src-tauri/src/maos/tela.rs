//! Ler a tela: tira um print do monitor onde está o mouse e encontra o texto
//! com o OCR do próprio Windows (tudo no PC; nada sai daqui).

use serde::Serialize;

#[derive(Clone, Serialize)]
pub struct Linha {
    pub texto: String,
    /// Posição em pixels da imagem.
    pub x: f32,
    pub y: f32,
    pub largura: f32,
    pub altura: f32,
}

#[derive(Clone, Serialize)]
pub struct Captura {
    /// Print do monitor em JPEG (data:image/jpeg;base64,...).
    pub imagem: String,
    pub largura: u32,
    pub altura: u32,
    pub linhas: Vec<Linha>,
    /// Posição e tamanho do monitor (pixels físicos), para cobrir certinho.
    pub monitor_x: i32,
    pub monitor_y: i32,
}

/// Captura o monitor que contém o ponto (x, y) e lê o texto.
pub fn capturar(x: i32, y: i32) -> Result<Captura, String> {
    sistema::capturar(x, y)
}

#[cfg(windows)]
mod sistema {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use xcap::image::codecs::jpeg::JpegEncoder;
    use xcap::image::{DynamicImage, RgbaImage};
    use windows::core::HSTRING;
    use windows::Globalization::Language;
    use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::DataWriter;
    use xcap::Monitor;

    use super::{Captura, Linha};

    /// Prefere o inglês (texto estrangeiro mais comum); senão, os idiomas do Windows.
    fn motor() -> Result<OcrEngine, String> {
        for idioma in ["en-US", "en-GB"] {
            if let Ok(l) = Language::CreateLanguage(&HSTRING::from(idioma)) {
                if OcrEngine::IsLanguageSupported(&l).unwrap_or(false) {
                    if let Ok(m) = OcrEngine::TryCreateFromLanguage(&l) {
                        return Ok(m);
                    }
                }
            }
        }
        OcrEngine::TryCreateFromUserProfileLanguages()
            .map_err(|_| "O Windows não tem leitura de texto (OCR) instalada para nenhum idioma.".into())
    }

    fn ler_texto(imagem: &RgbaImage) -> Result<Vec<Linha>, String> {
        let (largura, altura) = imagem.dimensions();
        // O Windows quer as cores na ordem azul, verde, vermelho, transparência.
        let mut bgra = imagem.as_raw().clone();
        for px in bgra.chunks_exact_mut(4) {
            px.swap(0, 2);
        }
        let escritor = DataWriter::new().map_err(|e| e.to_string())?;
        escritor.WriteBytes(&bgra).map_err(|e| e.to_string())?;
        let buffer = escritor.DetachBuffer().map_err(|e| e.to_string())?;
        let bitmap = SoftwareBitmap::CreateCopyFromBuffer(&buffer, BitmapPixelFormat::Bgra8, largura as i32, altura as i32)
            .map_err(|e| e.to_string())?;
        let resultado = motor()?
            .RecognizeAsync(&bitmap)
            .and_then(|r| r.join())
            .map_err(|e| format!("Não consegui ler o texto da tela: {e}"))?;

        let mut linhas = Vec::new();
        let lista = resultado.Lines().map_err(|e| e.to_string())?;
        for i in 0..lista.Size().unwrap_or(0) {
            let Ok(linha) = lista.GetAt(i) else { continue };
            let texto = linha.Text().map(|t| t.to_string()).unwrap_or_default();
            if texto.trim().is_empty() {
                continue;
            }
            let (mut x0, mut y0, mut x1, mut y1) = (f32::MAX, f32::MAX, 0f32, 0f32);
            if let Ok(palavras) = linha.Words() {
                for j in 0..palavras.Size().unwrap_or(0) {
                    if let Ok(r) = palavras.GetAt(j).and_then(|p| p.BoundingRect()) {
                        x0 = x0.min(r.X);
                        y0 = y0.min(r.Y);
                        x1 = x1.max(r.X + r.Width);
                        y1 = y1.max(r.Y + r.Height);
                    }
                }
            }
            if x0 < x1 && y0 < y1 {
                linhas.push(Linha { texto, x: x0, y: y0, largura: x1 - x0, altura: y1 - y0 });
            }
        }
        Ok(linhas)
    }

    pub fn capturar(x: i32, y: i32) -> Result<Captura, String> {
        // Modo "multithread" do Windows: esperar a leitura do texto (OCR) num
        // fio de "apartamento" pode travar para sempre.
        unsafe {
            let _ = windows::Win32::System::Com::CoInitializeEx(None, windows::Win32::System::Com::COINIT_MULTITHREADED);
        }
        let monitor = match Monitor::from_point(x, y) {
            Ok(m) => m,
            Err(_) => Monitor::all()
                .map_err(|e| format!("Não achei o monitor: {e}"))?
                .into_iter()
                .next()
                .ok_or("Não achei o monitor.")?,
        };
        let imagem = monitor.capture_image().map_err(|e| format!("Não consegui tirar o print: {e}"))?;
        let linhas = ler_texto(&imagem)?;

        let rgb = DynamicImage::ImageRgba8(imagem.clone()).to_rgb8();
        let mut jpeg = Vec::new();
        JpegEncoder::new_with_quality(&mut jpeg, 82)
            .encode_image(&rgb)
            .map_err(|e| e.to_string())?;
        Ok(Captura {
            imagem: format!("data:image/jpeg;base64,{}", STANDARD.encode(jpeg)),
            largura: imagem.width(),
            altura: imagem.height(),
            linhas,
            monitor_x: monitor.x().unwrap_or(0),
            monitor_y: monitor.y().unwrap_or(0),
        })
    }
}

#[cfg(not(windows))]
mod sistema {
    use super::Captura;

    pub fn capturar(_x: i32, _y: i32) -> Result<Captura, String> {
        Err("A tradução da tela só funciona no Windows.".into())
    }
}
