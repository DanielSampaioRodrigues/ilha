//! O tempo agora na cidade do Dan (para a pílula da tela inicial), pelo
//! Open-Meteo: grátis, sem conta e sem chave. Primeiro acha a cidade
//! (latitude/longitude), depois pede a temperatura e o "código do tempo".

use std::time::Duration;

#[derive(serde::Serialize, Debug, PartialEq)]
pub struct TempoAgora {
    cidade: String,
    temperatura: f64,
    /// Código WMO: 0 céu limpo, 1-3 nuvens, 45/48 neblina, 51-67 chuva, 71-77 neve, 80-82 pancadas, 95-99 trovoada.
    codigo: u32,
    dia: bool,
}

fn cliente() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().timeout(Duration::from_secs(10)).build().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn tempo_agora(cidade: String) -> Result<Option<TempoAgora>, String> {
    let cidade = cidade.trim();
    if cidade.is_empty() {
        return Ok(None);
    }
    let c = cliente()?;
    let busca = reqwest::Url::parse_with_params(
        "https://geocoding-api.open-meteo.com/v1/search",
        &[("name", cidade), ("count", "1"), ("language", "pt"), ("format", "json")],
    )
    .map_err(|e| e.to_string())?;
    let lugar: serde_json::Value = c.get(busca).send().await.map_err(|_| "Sem internet para ver o tempo.".to_string())?.json().await.map_err(|e| e.to_string())?;
    let Some(l) = lugar["results"].get(0) else { return Ok(None) };
    let (Some(lat), Some(lon)) = (l["latitude"].as_f64(), l["longitude"].as_f64()) else { return Ok(None) };
    let nome = l["name"].as_str().unwrap_or(cidade).to_string();
    let previsao = reqwest::Url::parse_with_params(
        "https://api.open-meteo.com/v1/forecast",
        &[
            ("latitude", lat.to_string().as_str()),
            ("longitude", lon.to_string().as_str()),
            ("current", "temperature_2m,weather_code,is_day"),
            ("timezone", "auto"),
        ],
    )
    .map_err(|e| e.to_string())?;
    let v: serde_json::Value = c.get(previsao).send().await.map_err(|_| "Sem internet para ver o tempo.".to_string())?.json().await.map_err(|e| e.to_string())?;
    Ok(ler_atual(&v, nome))
}

fn ler_atual(v: &serde_json::Value, cidade: String) -> Option<TempoAgora> {
    let atual = &v["current"];
    Some(TempoAgora {
        cidade,
        temperatura: atual["temperature_2m"].as_f64()?,
        codigo: atual["weather_code"].as_u64().unwrap_or(0) as u32,
        dia: atual["is_day"].as_u64().unwrap_or(1) == 1,
    })
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn le_a_resposta_do_open_meteo() {
        let v: serde_json::Value = serde_json::from_str(
            r#"{"latitude":-8.0,"current_units":{"temperature_2m":"°C"},"current":{"time":"2026-11-18T14:00","interval":900,"temperature_2m":29.4,"weather_code":2,"is_day":1}}"#,
        )
        .unwrap();
        assert_eq!(ler_atual(&v, "Recife".into()), Some(TempoAgora { cidade: "Recife".into(), temperatura: 29.4, codigo: 2, dia: true }));
        assert_eq!(ler_atual(&serde_json::json!({"erro": true}), "X".into()), None);
    }
}
