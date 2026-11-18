//! Google Agenda: entrar com a conta Google (o jeito oficial para programas de
//! computador: abre o navegador, a pessoa autoriza, o Google devolve a
//! permissão para um endereço local da própria ilha). A permissão de longa
//! duração fica no cofre do Windows; a de curta duração, só na memória.
//!
//! O que faz: lê os compromissos (todas as agendas visíveis, já com as
//! repetições abertas pelo próprio Google) e cria/troca/apaga os eventos da
//! ilha (vencimentos, renovações, tarefas e o que a IA marcar). Só mexe nos
//! eventos que a própria ilha criou (identificador derivado de "ilha-…").
//!
//! A "identidade" da ilha no Google (ID e segredo do cliente OAuth) não fica
//! no código (o repositório é público): entra na hora de montar o instalador,
//! pelos segredos ILHA_GOOGLE_CLIENT_ID e ILHA_GOOGLE_CLIENT_SECRET do GitHub.
//! Sem eles, o botão "Entrar com Google" simplesmente não aparece.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::Engine;
use reqwest::StatusCode;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use super::calendario::{data_ics, regra_repeticao, uid_valido, Calendario, Evento, EventoLido};
use super::cofre;

const AUTORIZAR: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN: &str = "https://oauth2.googleapis.com/token";
const API: &str = "https://www.googleapis.com/calendar/v3";
const ESCOPOS: &str = "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly";

fn cliente_oauth() -> Option<(&'static str, &'static str)> {
    let id = option_env!("ILHA_GOOGLE_CLIENT_ID").filter(|s| !s.trim().is_empty())?;
    let segredo = option_env!("ILHA_GOOGLE_CLIENT_SECRET").filter(|s| !s.trim().is_empty())?;
    Some((id.trim(), segredo.trim()))
}

/// A permissão de curta duração (uma hora), guardada só na memória.
static ACESSO: Mutex<Option<(String, Instant)>> = Mutex::new(None);

fn http() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().timeout(Duration::from_secs(30)).build().map_err(|e| e.to_string())
}

fn aleatorio(bytes: usize) -> String {
    let mut b = vec![0u8; bytes];
    // Sem sorteio do sistema não dá para fazer o login com segurança.
    getrandom::getrandom(&mut b).expect("sem números aleatórios do sistema");
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b)
}

/// Lê uma parte da URL ("code=…") já decodificada.
fn parametro(consulta: &str, nome: &str) -> Option<String> {
    consulta.split('&').find_map(|par| {
        let (k, v) = par.split_once('=')?;
        (k == nome).then(|| decodificar(v))
    })
}

fn decodificar(t: &str) -> String {
    let b = t.as_bytes();
    let mut saida = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'+' => saida.push(b' '),
            b'%' if i + 2 < b.len() => {
                if let Ok(n) = u8::from_str_radix(&t[i + 1..i + 3], 16) {
                    saida.push(n);
                    i += 2;
                } else {
                    saida.push(b'%');
                }
            }
            c => saida.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&saida).into_owned()
}

/// Espera o navegador voltar com a resposta do Google (até 5 minutos).
fn esperar_resposta(servidor: TcpListener, estado: &str) -> Result<String, String> {
    servidor.set_nonblocking(true).map_err(|e| e.to_string())?;
    let limite = Instant::now() + Duration::from_secs(300);
    while Instant::now() < limite {
        let (mut conexao, _) = match servidor.accept() {
            Ok(c) => c,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(150));
                continue;
            }
            Err(e) => return Err(e.to_string()),
        };
        let _ = conexao.set_nonblocking(false);
        let _ = conexao.set_read_timeout(Some(Duration::from_secs(5)));
        let mut buf = [0u8; 8192];
        let n = conexao.read(&mut buf).unwrap_or(0);
        let pedido = String::from_utf8_lossy(&buf[..n]);
        let caminho = pedido.split_whitespace().nth(1).unwrap_or("/");
        let consulta = caminho.split_once('?').map(|(_, q)| q).unwrap_or("");
        let (codigo, erro) = (parametro(consulta, "code"), parametro(consulta, "error"));
        if codigo.is_none() && erro.is_none() {
            // Ex.: o navegador pedindo o ícone da página.
            let _ = conexao.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            continue;
        }
        let deu_certo = codigo.is_some() && parametro(consulta, "state").as_deref() == Some(estado);
        let pagina = format!(
            "<!doctype html><meta charset=utf-8><title>Ilha</title><body style=\"font-family:system-ui;background:#0b0c10;color:#eef;display:grid;place-items:center;height:100vh;margin:0\"><div style=\"text-align:center\"><h1>{}</h1><p>{}</p></div>",
            if deu_certo { "Pronto! 🎉" } else { "Não deu certo" },
            if deu_certo { "A ilha já está ligada à sua agenda do Google. Pode fechar esta aba." } else { "Volte para a ilha e tente de novo." }
        );
        let _ = conexao.write_all(
            format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{pagina}", pagina.len()).as_bytes(),
        );
        if let Some(e) = erro {
            return Err(if e == "access_denied" { "Você não autorizou no Google.".into() } else { format!("O Google recusou: {e}") });
        }
        if !deu_certo {
            return Err("A resposta do Google não confere (tente de novo).".into());
        }
        return Ok(codigo.unwrap_or_default());
    }
    Err("Passou o tempo para autorizar no navegador. Tente de novo.".into())
}

/// Dá para entrar com Google nesta versão? (Só se o instalador veio com a identidade da ilha.)
#[tauri::command]
pub fn google_disponivel() -> bool {
    cliente_oauth().is_some()
}

/// A conta conectada (o e-mail), se houver.
#[tauri::command]
pub fn google_conectado() -> Option<String> {
    let guardado: Value = serde_json::from_str(&cofre::ler_google()?).ok()?;
    guardado["email"].as_str().map(str::to_string)
}

#[tauri::command]
pub fn google_sair() -> Result<(), String> {
    if let Ok(mut a) = ACESSO.lock() {
        *a = None;
    }
    cofre::apagar_google()
}

/// Entrar: abre o navegador para o Dan autorizar e espera a volta.
#[tauri::command]
pub async fn google_entrar(app: AppHandle) -> Result<String, String> {
    let (id, segredo) = cliente_oauth().ok_or("Esta versão da ilha ainda não tem o login do Google.")?;
    let servidor = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let volta = format!("http://127.0.0.1:{}", servidor.local_addr().map_err(|e| e.to_string())?.port());
    let verificador = aleatorio(48);
    let desafio = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verificador.as_bytes()));
    let estado = aleatorio(18);
    let endereco = reqwest::Url::parse_with_params(
        AUTORIZAR,
        &[
            ("client_id", id),
            ("redirect_uri", volta.as_str()),
            ("response_type", "code"),
            ("scope", ESCOPOS),
            ("access_type", "offline"),
            ("prompt", "consent"),
            ("code_challenge", desafio.as_str()),
            ("code_challenge_method", "S256"),
            ("state", estado.as_str()),
        ],
    )
    .map_err(|e| e.to_string())?;
    app.opener().open_url(endereco.as_str(), None::<&str>).map_err(|e| format!("Não consegui abrir o navegador: {e}"))?;
    let estado2 = estado.clone();
    let codigo = tokio::task::spawn_blocking(move || esperar_resposta(servidor, &estado2)).await.map_err(|e| e.to_string())??;
    let r: Value = http()?
        .post(TOKEN)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(formulario(&[
            ("client_id", id),
            ("client_secret", segredo),
            ("code", codigo.as_str()),
            ("code_verifier", verificador.as_str()),
            ("grant_type", "authorization_code"),
            ("redirect_uri", volta.as_str()),
        ]))
        .send()
        .await
        .map_err(|_| "Sem conexão com o Google.".to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let renovar = r["refresh_token"].as_str().ok_or_else(|| format!("O Google não devolveu a permissão ({}).", r["error"].as_str().unwrap_or("?")))?;
    let acesso = r["access_token"].as_str().unwrap_or_default().to_string();
    let validade = r["expires_in"].as_u64().unwrap_or(3000).saturating_sub(120);
    if let Ok(mut a) = ACESSO.lock() {
        *a = Some((acesso.clone(), Instant::now() + Duration::from_secs(validade)));
    }
    // O e-mail é o identificador da agenda principal.
    let lista = listar_calendarios(&acesso).await.unwrap_or_default();
    let email = lista.iter().find(|c| c["primary"].as_bool() == Some(true)).and_then(|c| c["id"].as_str()).unwrap_or("conta Google").to_string();
    cofre::gravar_google(&json!({ "refresh_token": renovar, "email": email }).to_string())?;
    Ok(email)
}

/// Uma permissão de curta duração válida (renova com a de longa duração quando precisa).
async fn acesso() -> Result<String, String> {
    if let Ok(a) = ACESSO.lock() {
        if let Some((t, ate)) = a.as_ref() {
            if Instant::now() < *ate {
                return Ok(t.clone());
            }
        }
    }
    let (id, segredo) = cliente_oauth().ok_or("Esta versão da ilha não tem o login do Google.")?;
    let guardado: Value = serde_json::from_str(&cofre::ler_google().ok_or("A agenda do Google não está conectada.")?).map_err(|e| e.to_string())?;
    let renovar = guardado["refresh_token"].as_str().ok_or("Conecte o Google de novo.")?;
    let r: Value = http()?
        .post(TOKEN)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(formulario(&[("client_id", id), ("client_secret", segredo), ("refresh_token", renovar), ("grant_type", "refresh_token")]))
        .send()
        .await
        .map_err(|_| "Sem conexão com o Google.".to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    if r["error"].as_str() == Some("invalid_grant") {
        // A pessoa tirou a permissão (ou ela venceu): desconecta para pedir de novo.
        let _ = cofre::apagar_google();
        return Err("A permissão do Google acabou. Conecte de novo em Calendário.".into());
    }
    let t = r["access_token"].as_str().ok_or("O Google não renovou a permissão.")?.to_string();
    let validade = r["expires_in"].as_u64().unwrap_or(3000).saturating_sub(120);
    if let Ok(mut a) = ACESSO.lock() {
        *a = Some((t.clone(), Instant::now() + Duration::from_secs(validade)));
    }
    Ok(t)
}

async fn listar_calendarios(token: &str) -> Result<Vec<Value>, String> {
    let r: Value = http()?
        .get(format!("{API}/users/me/calendarList"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| "Sem conexão com o Google.".to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    Ok(r["items"].as_array().cloned().unwrap_or_default())
}

/// As agendas em que a ilha pode gravar (dono ou editor).
#[tauri::command]
pub async fn google_calendarios() -> Result<Vec<Calendario>, String> {
    let token = acesso().await?;
    Ok(listar_calendarios(&token)
        .await?
        .iter()
        .filter(|c| matches!(c["accessRole"].as_str(), Some("owner" | "writer")))
        .map(|c| Calendario {
            url: c["id"].as_str().unwrap_or_default().to_string(),
            nome: c["summaryOverride"].as_str().or(c["summary"].as_str()).unwrap_or("Agenda").to_string(),
        })
        .collect())
}

// ---------- Datas (sem crate de datas) ----------

fn dias_desde_1970(a: i64, m: i64, d: i64) -> i64 {
    let a = if m <= 2 { a - 1 } else { a };
    let era = a.div_euclid(400);
    let yoe = a - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn data_de_dias(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

/// "AAAAMMDDTHHMMSS" (ou só a data) → segundos desde 1970, sem fuso.
fn segundos_de(t: &str) -> Option<i64> {
    let n = |a: usize, b: usize| t.get(a..b)?.parse::<i64>().ok();
    let dias = dias_desde_1970(n(0, 4)?, n(4, 6)?, n(6, 8)?);
    let (h, mi, s) = if t.len() >= 13 { (n(9, 11)?, n(11, 13)?, n(13, 15).unwrap_or(0)) } else { (0, 0, 0) };
    Some(dias * 86_400 + h * 3600 + mi * 60 + s)
}

fn texto_de(seg: i64, com_hora: bool) -> String {
    let (a, m, d) = data_de_dias(seg.div_euclid(86_400));
    if !com_hora {
        return format!("{a:04}-{m:02}-{d:02}");
    }
    let r = seg.rem_euclid(86_400);
    format!("{a:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}", r / 3600, r % 3600 / 60, r % 60)
}

/// "2026-11-18T14:00:00-03:00" (ou com Z / frações) → "20261118T170000Z".
fn rfc3339_para_utc(t: &str) -> Option<String> {
    let base: String = t.get(0..19)?.replace(['-', ':'], "");
    let local = segundos_de(&base)?;
    let resto = &t[19..];
    let resto = resto.trim_start_matches(|c: char| c == '.' || c.is_ascii_digit());
    let deslocamento = match resto.chars().next() {
        Some('Z') | None => 0,
        Some(sinal @ ('+' | '-')) => {
            let h: i64 = resto.get(1..3)?.parse().ok()?;
            let m: i64 = resto.get(4..6)?.parse().ok()?;
            (h * 3600 + m * 60) * if sinal == '-' { -1 } else { 1 }
        }
        _ => return None,
    };
    let utc = local - deslocamento;
    Some(format!("{}Z", texto_de(utc, true).replace(['-', ':'], "")))
}

/// "20261118T170000Z" → "2026-11-18T17:00:00Z" (o formato que o Google pede).
fn utc_para_rfc3339(t: &str) -> Option<String> {
    let s = segundos_de(t.trim_end_matches('Z'))?;
    Some(format!("{}Z", texto_de(s, true)))
}

/// Lê os compromissos de todas as agendas visíveis entre inicio e fim (UTC, "AAAAMMDDTHHMMSSZ").
#[tauri::command]
pub async fn google_eventos(inicio: String, fim: String) -> Result<Vec<EventoLido>, String> {
    let (de, ate) = (utc_para_rfc3339(&inicio).ok_or("Datas inválidas.")?, utc_para_rfc3339(&fim).ok_or("Datas inválidas.")?);
    let token = acesso().await?;
    let c = http()?;
    let mut todos = Vec::new();
    for cal in listar_calendarios(&token).await? {
        if cal["selected"].as_bool() == Some(false) {
            continue;
        }
        let id = cal["id"].as_str().unwrap_or_default();
        let nome = cal["summaryOverride"].as_str().or(cal["summary"].as_str()).unwrap_or("Agenda");
        let endereco = reqwest::Url::parse_with_params(
            &format!("{API}/calendars/{}/events", urlencode(id)),
            &[("timeMin", de.as_str()), ("timeMax", ate.as_str()), ("singleEvents", "true"), ("orderBy", "startTime"), ("maxResults", "250")],
        )
        .map_err(|e| e.to_string())?;
        let Ok(r) = c.get(endereco).bearer_auth(&token).send().await else { continue };
        let Ok(v) = r.json::<Value>().await else { continue };
        for e in v["items"].as_array().into_iter().flatten() {
            if e["status"].as_str() == Some("cancelled") {
                continue;
            }
            let quando = |campo: &str| -> String {
                if let Some(d) = e[campo]["date"].as_str() {
                    d.replace('-', "")
                } else {
                    e[campo]["dateTime"].as_str().and_then(rfc3339_para_utc).unwrap_or_default()
                }
            };
            todos.push(EventoLido {
                calendario: nome.to_string(),
                titulo: e["summary"].as_str().unwrap_or("(sem título)").to_string(),
                inicio: quando("start"),
                fim: quando("end"),
                local: e["location"].as_str().unwrap_or_default().to_string(),
            });
        }
    }
    Ok(todos)
}

/// Corpo de formulário ("a=1&b=2"), com cada valor codificado.
fn formulario(pares: &[(&str, &str)]) -> String {
    pares.iter().map(|(k, v)| format!("{k}={}", urlencode(v))).collect::<Vec<_>>().join("&")
}

fn urlencode(t: &str) -> String {
    t.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// O identificador do evento no Google a partir do "ilha-…" (o Google só aceita 0-9 e a-v).
fn id_google(uid: &str) -> String {
    uid.bytes().map(|b| format!("{b:02x}")).collect()
}

/// O evento da ilha no formato do Google.
fn corpo_do_evento(e: &Evento, fuso: &str) -> Result<Value, String> {
    let (inicio, dia_inteiro) = data_ics(&e.inicio).ok_or("Data inválida.")?;
    let seg = segundos_de(&inicio).ok_or("Data inválida.")?;
    let (comeco, termino) = if dia_inteiro {
        (json!({ "date": texto_de(seg, false) }), json!({ "date": texto_de(seg + 86_400, false) }))
    } else {
        let duracao = e.duracao_minutos.filter(|m| (1..=1440).contains(m)).unwrap_or(15);
        (json!({ "dateTime": texto_de(seg, true), "timeZone": fuso }), json!({ "dateTime": texto_de(seg + duracao * 60, true), "timeZone": fuso }))
    };
    let mut corpo = json!({
        "id": id_google(&e.uid),
        "status": "confirmed",
        "summary": e.titulo,
        "description": e.notas,
        "start": comeco,
        "end": termino,
    });
    if let Some(r) = regra_repeticao(&e.repete, &inicio) {
        corpo["recurrence"] = json!([format!("RRULE:{r}")]);
    }
    // Alerta antes do início: do jeito da ilha. "No mesmo dia às 9h" (negativo) o Google não aceita: fica o aviso padrão.
    corpo["reminders"] = match e.alerta_minutos {
        Some(m) if (0..=40_320).contains(&m) => json!({ "useDefault": false, "overrides": [{ "method": "popup", "minutes": m }] }),
        Some(_) => json!({ "useDefault": true }),
        None => json!({ "useDefault": false }),
    };
    Ok(corpo)
}

/// Grava (cria ou troca) e apaga eventos da ilha numa agenda do Google.
/// Devolve os uids que deram certo. `fuso` é o do computador (ex.: "America/Recife").
#[tauri::command]
pub async fn google_enviar(calendario: String, eventos: Vec<Evento>, apagar: Vec<String>, fuso: String) -> Result<Vec<String>, String> {
    let token = acesso().await?;
    let c = http()?;
    let cal = urlencode(if calendario.is_empty() { "primary" } else { &calendario });
    let fuso = if fuso.is_empty() { "America/Sao_Paulo".to_string() } else { fuso };
    let mut feitos = Vec::new();
    let mut erros = Vec::new();
    for e in eventos.iter().filter(|e| uid_valido(&e.uid)) {
        let corpo = match corpo_do_evento(e, &fuso) {
            Ok(c) => c,
            Err(err) => {
                erros.push(format!("{}: {err}", e.titulo));
                continue;
            }
        };
        let id = id_google(&e.uid);
        // Troca se já existe (mesmo apagado antes: volta a valer); senão, cria.
        let mut r = c.put(format!("{API}/calendars/{cal}/events/{id}")).bearer_auth(&token).json(&corpo).send().await;
        if matches!(&r, Ok(x) if x.status() == StatusCode::NOT_FOUND) {
            r = c.post(format!("{API}/calendars/{cal}/events")).bearer_auth(&token).json(&corpo).send().await;
        }
        match r {
            Ok(x) if x.status().is_success() => feitos.push(e.uid.clone()),
            Ok(x) => erros.push(format!("{}: {}", e.titulo, x.status())),
            Err(err) => erros.push(format!("{}: {err}", e.titulo)),
        }
    }
    for uid in apagar.iter().filter(|u| uid_valido(u)) {
        let r = c.delete(format!("{API}/calendars/{cal}/events/{}", id_google(uid))).bearer_auth(&token).send().await;
        match r {
            Ok(x) if x.status().is_success() || x.status() == StatusCode::NOT_FOUND || x.status() == StatusCode::GONE => feitos.push(uid.clone()),
            Ok(x) => erros.push(format!("apagar {uid}: {}", x.status())),
            Err(err) => erros.push(format!("apagar {uid}: {err}")),
        }
    }
    if !erros.is_empty() {
        log::warn!("Google Agenda: {}", erros.join(" | "));
    }
    if feitos.is_empty() && !erros.is_empty() {
        return Err(format!("O Google não aceitou: {}", erros[0]));
    }
    Ok(feitos)
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn datas_vao_e_voltam() {
        assert_eq!(rfc3339_para_utc("2026-11-18T14:00:00-03:00").as_deref(), Some("20261118T170000Z"));
        assert_eq!(rfc3339_para_utc("2026-12-31T23:30:00.000-03:00").as_deref(), Some("20270101T023000Z"));
        assert_eq!(rfc3339_para_utc("2026-11-18T14:00:00Z").as_deref(), Some("20261118T140000Z"));
        assert_eq!(rfc3339_para_utc("2026-11-18T01:00:00+05:30").as_deref(), Some("20261117T193000Z"));
        assert_eq!(utc_para_rfc3339("20261118T030000Z").as_deref(), Some("2026-11-18T03:00:00Z"));
        assert_eq!(texto_de(segundos_de("20280228").unwrap() + 86_400, false), "2028-02-29");
    }

    #[test]
    fn id_so_com_letras_aceitas() {
        let id = id_google("ilha-tarefa-abc123");
        assert!(id.chars().all(|c| c.is_ascii_digit() || ('a'..='v').contains(&c)) && id.len() >= 5);
    }

    #[test]
    fn evento_no_formato_do_google() {
        let e = Evento {
            uid: "ilha-tarefa-1".into(),
            titulo: "Prova".into(),
            notas: String::new(),
            inicio: "2026-11-20T19:30".into(),
            repete: "semanal".into(),
            alerta_minutos: Some(15),
            duracao_minutos: Some(90),
        };
        let c = corpo_do_evento(&e, "America/Recife").unwrap();
        assert_eq!(c["start"]["dateTime"], "2026-11-20T19:30:00");
        assert_eq!(c["end"]["dateTime"], "2026-11-20T21:00:00");
        assert_eq!(c["recurrence"][0], "RRULE:FREQ=WEEKLY");
        assert_eq!(c["reminders"]["overrides"][0]["minutes"], 15);
        let dia = Evento { inicio: "2026-12-31".into(), repete: "nao".into(), alerta_minutos: Some(-540), ..e };
        let c = corpo_do_evento(&dia, "America/Recife").unwrap();
        assert_eq!((c["start"]["date"].as_str(), c["end"]["date"].as_str()), (Some("2026-12-31"), Some("2027-01-01")));
        assert_eq!(c["reminders"]["useDefault"], true);
    }

    #[test]
    fn recebe_a_volta_pelo_endereco_local() {
        let servidor = TcpListener::bind("127.0.0.1:0").unwrap();
        let porta = servidor.local_addr().unwrap().port();
        let navegador = std::thread::spawn(move || {
            let pedir = |caminho: &str| {
                let mut c = std::net::TcpStream::connect(("127.0.0.1", porta)).unwrap();
                c.write_all(format!("GET {caminho} HTTP/1.1\r\nHost: x\r\n\r\n").as_bytes()).unwrap();
                let mut r = String::new();
                let _ = c.read_to_string(&mut r);
                r
            };
            let icone = pedir("/favicon.ico");
            let pagina = pedir("/?state=abc&code=4%2Fxyz&scope=x");
            (icone, pagina)
        });
        assert_eq!(esperar_resposta(servidor, "abc").unwrap(), "4/xyz");
        let (icone, pagina) = navegador.join().unwrap();
        assert!(icone.starts_with("HTTP/1.1 404"));
        assert!(pagina.contains("Pronto!"));
        // Estado errado (resposta que não é deste login): recusa.
        let servidor = TcpListener::bind("127.0.0.1:0").unwrap();
        let porta = servidor.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let mut c = std::net::TcpStream::connect(("127.0.0.1", porta)).unwrap();
            c.write_all(b"GET /?state=outro&code=1 HTTP/1.1\r\n\r\n").unwrap();
        });
        assert!(esperar_resposta(servidor, "abc").is_err());
    }

    #[test]
    fn le_a_volta_do_navegador() {
        assert_eq!(parametro("state=a%2Bb&code=4%2F0Ab_x", "code").as_deref(), Some("4/0Ab_x"));
        assert_eq!(parametro("state=a%2Bb&code=x", "state").as_deref(), Some("a+b"));
    }
}
