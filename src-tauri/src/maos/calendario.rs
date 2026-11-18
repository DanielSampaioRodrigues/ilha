//! Calendário da Apple (iCloud), pelo protocolo oficial CalDAV.
//!
//! A ilha grava na agenda do Dan os vencimentos das assinaturas, as
//! redefinições das IAs e as tarefas com data, com alerta — para tocar no
//! iPhone. Login: o e-mail do Apple ID + uma "senha de app" (criada em
//! appleid.apple.com), guardada no cofre do Windows. Só mexe nos eventos que a
//! própria ilha criou (todos com o identificador começando por "ilha-").

use reqwest::{Method, StatusCode};
use serde::{Deserialize, Serialize};

use super::cofre;

const INICIO: &str = "https://caldav.icloud.com/";

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Calendario {
    pub url: String,
    pub nome: String,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Evento {
    /// Sempre começa com "ilha-" (a ilha só mexe nos dela).
    pub uid: String,
    pub titulo: String,
    #[serde(default)]
    pub notas: String,
    /// "AAAA-MM-DD" (dia inteiro) ou "AAAA-MM-DDTHH:MM".
    pub inicio: String,
    /// "nao", "diario", "semanal", "mensal" ou "anual".
    #[serde(default)]
    pub repete: String,
    /// Minutos ANTES do início para o alerta (negativo = depois). Sem = sem alerta.
    pub alerta_minutos: Option<i64>,
    /// Duração (só eventos com hora). Sem = 15 min (lembretes da ilha).
    #[serde(default)]
    pub duracao_minutos: Option<i64>,
}

/// Um compromisso lido da agenda do Dan.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct EventoLido {
    pub calendario: String,
    pub titulo: String,
    /// Como veio do iCloud: "AAAAMMDD" (dia inteiro), "AAAAMMDDTHHMMSSZ" (UTC) ou sem Z (hora local).
    pub inicio: String,
    pub fim: String,
    pub local: String,
}

// ---------- XML (só o necessário para o CalDAV) ----------

/// Tira os prefixos de espaço de nomes (<d:href> → <href>) para facilitar a busca.
fn sem_prefixos(xml: &str) -> String {
    let mut saida = String::with_capacity(xml.len());
    let mut resto = xml;
    while let Some(pos) = resto.find('<') {
        saida.push_str(&resto[..pos]);
        resto = &resto[pos..];
        let fim = resto.find('>').map(|f| f + 1).unwrap_or(resto.len());
        let tag = &resto[..fim];
        let (abre, corpo) = if let Some(c) = tag.strip_prefix("</") { ("</", c) } else { ("<", &tag[1..]) };
        let nome_fim = corpo.find([' ', '>', '/', '\n', '\t']).unwrap_or(corpo.len());
        let nome = &corpo[..nome_fim];
        let nome_limpo = nome.rsplit(':').next().unwrap_or(nome);
        saida.push_str(abre);
        saida.push_str(nome_limpo);
        saida.push_str(&corpo[nome_fim..]);
        resto = &resto[fim..];
    }
    saida.push_str(resto);
    saida
}

/// Conteúdo de cada <tag>…</tag> (ou <tag atributos>…</tag>).
fn blocos<'a>(xml: &'a str, tag: &str) -> Vec<&'a str> {
    let mut lista = Vec::new();
    let mut resto = xml;
    let abre = format!("<{tag}");
    let fecha = format!("</{tag}>");
    while let Some(i) = resto.find(&abre) {
        let depois = &resto[i + abre.len()..];
        // Precisa ser a tag mesmo (não <hrefx>).
        if !depois.starts_with(['>', ' ', '/', '\n', '\t']) {
            resto = depois;
            continue;
        }
        let Some(fim_abre) = depois.find('>') else { break };
        if depois[..fim_abre].ends_with('/') {
            lista.push("");
            resto = &depois[fim_abre + 1..];
            continue;
        }
        let conteudo = &depois[fim_abre + 1..];
        let Some(j) = conteudo.find(&fecha) else { break };
        lista.push(&conteudo[..j]);
        resto = &conteudo[j + fecha.len()..];
    }
    lista
}

fn primeiro_href(xml: &str, dentro_de: &str) -> Option<String> {
    blocos(xml, dentro_de).first().and_then(|b| blocos(b, "href").first().map(|h| h.trim().to_string()))
}

fn desescapar(t: &str) -> String {
    t.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&")
}

/// Calendários (que aceitam eventos) numa resposta PROPFIND da pasta de calendários.
fn calendarios_da_resposta(xml: &str, base: &str) -> Vec<Calendario> {
    let xml = sem_prefixos(xml);
    blocos(&xml, "response")
        .into_iter()
        .filter(|r| blocos(r, "resourcetype").first().is_some_and(|t| t.contains("<calendar")))
        .filter(|r| {
            // Se disser os tipos aceitos, precisa aceitar eventos (não só lembretes).
            let comps = blocos(r, "supported-calendar-component-set");
            comps.is_empty() || comps[0].contains("VEVENT")
        })
        .filter_map(|r| {
            let href = blocos(r, "href").first()?.trim().to_string();
            let nome = blocos(r, "displayname").first().map(|n| desescapar(n.trim())).unwrap_or_default();
            Some(Calendario { url: juntar(base, &href), nome: if nome.is_empty() { "Calendário".into() } else { nome } })
        })
        .collect()
}

/// A senha só pode ir para o iCloud, sempre por https.
fn endereco_do_icloud(url: &str) -> bool {
    let Some(resto) = url.strip_prefix("https://") else { return false };
    let servidor = resto.split(['/', '?', '#']).next().unwrap_or_default();
    let servidor = servidor.rsplit_once(':').map(|(h, porta)| if porta.chars().all(|c| c.is_ascii_digit()) { h } else { servidor }).unwrap_or(servidor);
    servidor == "icloud.com" || servidor.ends_with(".icloud.com")
}

/// Endereço completo a partir de um href (que pode ser só o caminho).
fn juntar(base: &str, href: &str) -> String {
    if href.starts_with("http") {
        return href.to_string();
    }
    let origem = base.find("://").and_then(|i| base[i + 3..].find('/').map(|j| &base[..i + 3 + j])).unwrap_or(base);
    format!("{origem}{href}")
}

// ---------- iCalendar ----------

fn escapar_ics(t: &str) -> String {
    t.replace('\\', "\\\\").replace(';', "\\;").replace(',', "\\,").replace('\n', "\\n")
}

/// Corta linhas longas como o padrão pede (75 bytes, continuação com espaço).
fn dobrar(linha: &str) -> String {
    let mut saida = String::new();
    let mut atual = 0;
    for c in linha.chars() {
        if atual + c.len_utf8() > 74 {
            saida.push_str("\r\n ");
            atual = 1;
        }
        saida.push(c);
        atual += c.len_utf8();
    }
    saida
}

fn data_ics(inicio: &str) -> Option<(String, bool)> {
    let (data, hora) = match inicio.split_once('T') {
        Some((d, h)) => (d, Some(h)),
        None => (inicio, None),
    };
    let d = data.replace('-', "");
    if d.len() != 8 || !d.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    match hora {
        Some(h) => {
            let h = h.replace(':', "");
            let h = format!("{:0<6}", &h[..h.len().min(6)]);
            Some((format!("{d}T{h}"), false))
        }
        None => Some((d, true)),
    }
}

pub fn ics(e: &Evento, agora_utc: &str) -> Result<String, String> {
    let (inicio, dia_inteiro) = data_ics(&e.inicio).ok_or("Data inválida.")?;
    let mut l = vec![
        "BEGIN:VCALENDAR".to_string(),
        "VERSION:2.0".into(),
        "PRODID:-//Ilha//Ilha//PT".into(),
        "BEGIN:VEVENT".into(),
        format!("UID:{}", e.uid),
        format!("DTSTAMP:{agora_utc}"),
        dobrar(&format!("SUMMARY:{}", escapar_ics(&e.titulo))),
    ];
    if dia_inteiro {
        l.push(format!("DTSTART;VALUE=DATE:{inicio}"));
    } else {
        // Horário "flutuante": o do computador/iPhone, sem fuso fixo.
        l.push(format!("DTSTART:{inicio}"));
        l.push(format!("DURATION:PT{}M", e.duracao_minutos.filter(|m| (1..=1440).contains(m)).unwrap_or(15)));
    }
    if !e.notas.trim().is_empty() {
        l.push(dobrar(&format!("DESCRIPTION:{}", escapar_ics(&e.notas))));
    }
    let regra = match e.repete.as_str() {
        "diario" => Some("FREQ=DAILY".to_string()),
        "semanal" => Some("FREQ=WEEKLY".into()),
        "mensal" => {
            let dia: u32 = inicio[6..8].parse().unwrap_or(1);
            // Dia 29+ não existe em todo mês: pega o maior dia possível até ele
            // (ex.: dia 30 → 28 em fevereiro, 30 nos outros meses).
            Some(match dia {
                1..=28 => format!("FREQ=MONTHLY;BYMONTHDAY={dia}"),
                31 => "FREQ=MONTHLY;BYMONTHDAY=-1".into(),
                _ => format!("FREQ=MONTHLY;BYMONTHDAY={};BYSETPOS=-1", (28..=dia).map(|d| d.to_string()).collect::<Vec<_>>().join(",")),
            })
        }
        "anual" => Some("FREQ=YEARLY".into()),
        _ => None,
    };
    if let Some(r) = regra {
        l.push(format!("RRULE:{r}"));
    }
    if let Some(min) = e.alerta_minutos {
        let gatilho = if min >= 0 { format!("-PT{min}M") } else { format!("PT{}M", -min) };
        l.extend([
            "BEGIN:VALARM".into(),
            "ACTION:DISPLAY".into(),
            dobrar(&format!("DESCRIPTION:{}", escapar_ics(&e.titulo))),
            format!("TRIGGER:{gatilho}"),
            "END:VALARM".into(),
        ]);
    }
    l.extend(["END:VEVENT".into(), "END:VCALENDAR".into()]);
    Ok(l.join("\r\n") + "\r\n")
}

// ---------- Rede ----------

fn cliente() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())
}

/// PROPFIND seguindo redirecionamentos com o mesmo método.
async fn propfind(c: &reqwest::Client, url: &str, profundidade: &str, corpo: &str, email: &str, senha: &str) -> Result<(String, String), String> {
    let mut alvo = url.to_string();
    for _ in 0..4 {
        if !endereco_do_icloud(&alvo) {
            return Err("O iCloud mandou para um endereço que não é da Apple; parei por segurança.".into());
        }
        let r = c
            .request(Method::from_bytes(b"PROPFIND").map_err(|e| e.to_string())?, &alvo)
            .basic_auth(email, Some(senha))
            .header("Depth", profundidade)
            .header("Content-Type", "application/xml; charset=utf-8")
            .body(corpo.to_string())
            .send()
            .await
            .map_err(|e| format!("Sem conexão com o iCloud: {e}"))?;
        let situacao = r.status();
        if situacao.is_redirection() {
            let destino = r.headers().get("location").and_then(|l| l.to_str().ok()).ok_or("O iCloud mandou para outro endereço sem dizer qual.")?;
            alvo = juntar(&alvo, destino);
            continue;
        }
        if situacao == StatusCode::UNAUTHORIZED || situacao == StatusCode::FORBIDDEN {
            return Err("O iCloud recusou o login. Confira o e-mail do Apple ID e use uma SENHA DE APP (não a senha normal).".into());
        }
        if !situacao.is_success() {
            return Err(format!("O iCloud respondeu com erro ({situacao})."));
        }
        return Ok((r.text().await.map_err(|e| e.to_string())?, alvo));
    }
    Err("O iCloud redirecionou demais.".into())
}

async fn descobrir(email: &str, senha: &str) -> Result<Vec<Calendario>, String> {
    let c = cliente()?;
    let corpo_principal = r#"<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>"#;
    let (xml, base) = propfind(&c, INICIO, "0", corpo_principal, email, senha).await?;
    let principal = primeiro_href(&sem_prefixos(&xml), "current-user-principal").ok_or("Não achei a conta no iCloud.")?;
    let corpo_casa = r#"<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>"#;
    let (xml, base) = propfind(&c, &juntar(&base, &principal), "0", corpo_casa, email, senha).await?;
    let casa = primeiro_href(&sem_prefixos(&xml), "calendar-home-set").ok_or("Não achei os calendários no iCloud.")?;
    let corpo_lista = r#"<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><d:resourcetype/><c:supported-calendar-component-set/></d:prop></d:propfind>"#;
    let casa = juntar(&base, &casa);
    let (xml, base) = propfind(&c, &casa, "1", corpo_lista, email, senha).await?;
    Ok(calendarios_da_resposta(&xml, &base))
}

/// Conecta (confere o login e lista os calendários) e guarda a senha no cofre.
#[tauri::command]
pub async fn icloud_conectar(email: String, senha: String) -> Result<Vec<Calendario>, String> {
    let senha = senha.trim().to_string();
    let lista = descobrir(email.trim(), &senha).await?;
    cofre::gravar_icloud(&senha)?;
    Ok(lista)
}

#[tauri::command]
pub async fn icloud_calendarios(email: String) -> Result<Vec<Calendario>, String> {
    let senha = cofre::ler_icloud().ok_or("Conecte o iCloud em Ajustes.")?;
    descobrir(email.trim(), &senha).await
}

#[tauri::command]
pub fn icloud_desconectar() -> Result<(), String> {
    cofre::apagar_icloud()
}

#[tauri::command]
pub fn icloud_conectado() -> bool {
    cofre::ler_icloud().is_some()
}

fn agora_utc() -> String {
    // AAAAMMDDTHHMMSSZ a partir do relógio (sem crate de datas).
    let s = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) as i64;
    let (dias, resto) = (s.div_euclid(86_400), s.rem_euclid(86_400));
    // Algoritmo de dias → data civil (Howard Hinnant).
    let z = dias + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}{m:02}{d:02}T{:02}{:02}{:02}Z", resto / 3600, resto % 3600 / 60, resto % 60)
}

fn uid_valido(uid: &str) -> bool {
    uid.starts_with("ilha-") && uid.len() <= 80 && uid.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Grava (cria ou troca) eventos e apaga os que a ilha não quer mais.
/// Devolve os uids que deram certo (gravados e apagados).
#[tauri::command]
pub async fn icloud_enviar(email: String, calendario: String, eventos: Vec<Evento>, apagar: Vec<String>) -> Result<Vec<String>, String> {
    let senha = cofre::ler_icloud().ok_or("Conecte o iCloud em Ajustes.")?;
    if !endereco_do_icloud(&calendario) {
        return Err("Calendário inválido.".into());
    }
    let pasta = if calendario.ends_with('/') { calendario } else { format!("{calendario}/") };
    let c = cliente()?;
    let carimbo = agora_utc();
    let mut feitos = Vec::new();
    let mut erros = Vec::new();
    for e in eventos.iter().filter(|e| uid_valido(&e.uid)) {
        let corpo = match ics(e, &carimbo) {
            Ok(t) => t,
            Err(err) => {
                erros.push(format!("{}: {err}", e.titulo));
                continue;
            }
        };
        let r = c
            .put(format!("{pasta}{}.ics", e.uid))
            .basic_auth(email.trim(), Some(&senha))
            .header("Content-Type", "text/calendar; charset=utf-8")
            .body(corpo)
            .send()
            .await;
        match r {
            Ok(r) if r.status().is_success() => feitos.push(e.uid.clone()),
            Ok(r) => erros.push(format!("{}: {}", e.titulo, r.status())),
            Err(err) => erros.push(format!("{}: {err}", e.titulo)),
        }
    }
    for uid in apagar.iter().filter(|u| uid_valido(u)) {
        let r = c.delete(format!("{pasta}{uid}.ics")).basic_auth(email.trim(), Some(&senha)).send().await;
        match r {
            Ok(r) if r.status().is_success() || r.status() == StatusCode::NOT_FOUND => feitos.push(uid.clone()),
            Ok(r) => erros.push(format!("apagar {uid}: {}", r.status())),
            Err(err) => erros.push(format!("apagar {uid}: {err}")),
        }
    }
    if !erros.is_empty() {
        log::warn!("Calendário: {}", erros.join(" | "));
    }
    if feitos.is_empty() && !erros.is_empty() {
        return Err(format!("Não consegui gravar no calendário: {}", erros[0]));
    }
    Ok(feitos)
}

// ---------- Ler a agenda ----------

fn desescapar_ics(t: &str) -> String {
    t.replace("\\n", "\n").replace("\\N", "\n").replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\")
}

/// Compromissos de um texto iCalendar (já com as repetições expandidas pelo iCloud).
fn eventos_do_ics(ics: &str, calendario: &str) -> Vec<EventoLido> {
    // Linhas dobradas: as que começam com espaço continuam a anterior.
    let mut linhas: Vec<String> = Vec::new();
    for l in ics.replace("\r\n", "\n").split('\n') {
        if let Some(cont) = l.strip_prefix([' ', '\t']) {
            if let Some(ultima) = linhas.last_mut() {
                ultima.push_str(cont);
            }
        } else {
            linhas.push(l.to_string());
        }
    }
    let mut lista = Vec::new();
    let mut atual: Option<EventoLido> = None;
    let mut fundo = 0; // dentro de VALARM etc.
    for l in linhas {
        let Some((chave, valor)) = l.split_once(':') else { continue };
        let nome = chave.split(';').next().unwrap_or_default().to_ascii_uppercase();
        match (nome.as_str(), valor.trim()) {
            ("BEGIN", "VEVENT") => {
                atual = Some(EventoLido {
                    calendario: calendario.to_string(),
                    titulo: String::new(),
                    inicio: String::new(),
                    fim: String::new(),
                    local: String::new(),
                })
            }
            ("BEGIN", _) if atual.is_some() => fundo += 1,
            ("END", "VEVENT") => {
                if let Some(e) = atual.take().filter(|e| !e.inicio.is_empty()) {
                    lista.push(e);
                }
                fundo = 0;
            }
            ("END", _) if fundo > 0 => fundo -= 1,
            _ if fundo > 0 => {}
            ("SUMMARY", v) => {
                if let Some(e) = atual.as_mut() {
                    e.titulo = desescapar_ics(v);
                }
            }
            ("LOCATION", v) => {
                if let Some(e) = atual.as_mut() {
                    e.local = desescapar_ics(v);
                }
            }
            ("DTSTART", v) => {
                if let Some(e) = atual.as_mut() {
                    e.inicio = v.to_string();
                }
            }
            ("DTEND", v) => {
                if let Some(e) = atual.as_mut() {
                    e.fim = v.to_string();
                }
            }
            _ => {}
        }
    }
    lista
}

/// "AAAAMMDDTHHMMSSZ" (formato que o CalDAV pede no intervalo).
fn data_utc_valida(t: &str) -> bool {
    t.len() == 16 && t.as_bytes()[8] == b'T' && t.ends_with('Z') && t[..8].chars().chain(t[9..15].chars()).all(|c| c.is_ascii_digit())
}

/// Lê os compromissos de TODOS os calendários do iCloud entre `inicio` e `fim`
/// (UTC, "AAAAMMDDTHHMMSSZ"). Só leitura.
#[tauri::command]
pub async fn icloud_eventos(email: String, inicio: String, fim: String) -> Result<Vec<EventoLido>, String> {
    if !data_utc_valida(&inicio) || !data_utc_valida(&fim) {
        return Err("Datas inválidas.".into());
    }
    let senha = cofre::ler_icloud().ok_or("O calendário da Apple não está conectado (Ajustes › Calendário da Apple).")?;
    let calendarios = descobrir(email.trim(), &senha).await?;
    let c = cliente()?;
    let corpo = format!(
        r#"<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-data><c:expand start="{inicio}" end="{fim}"/></c:calendar-data></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="{inicio}" end="{fim}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>"#
    );
    let mut todos = Vec::new();
    for cal in &calendarios {
        if !endereco_do_icloud(&cal.url) {
            continue;
        }
        let r = c
            .request(Method::from_bytes(b"REPORT").map_err(|e| e.to_string())?, &cal.url)
            .basic_auth(email.trim(), Some(&senha))
            .header("Depth", "1")
            .header("Content-Type", "application/xml; charset=utf-8")
            .body(corpo.clone())
            .send()
            .await;
        let xml = match r {
            Ok(r) if r.status().is_success() => r.text().await.unwrap_or_default(),
            Ok(r) => {
                log::warn!("Calendário: não li \"{}\" ({})", cal.nome, r.status());
                continue;
            }
            Err(e) => return Err(format!("Sem conexão com o iCloud: {e}")),
        };
        let xml = sem_prefixos(&xml);
        for dados in blocos(&xml, "calendar-data") {
            let texto = dados.trim().trim_start_matches("<![CDATA[").trim_end_matches("]]>");
            todos.extend(eventos_do_ics(&desescapar(texto), &cal.nome));
        }
    }
    todos.sort_by(|a, b| a.inicio.cmp(&b.inicio));
    Ok(todos)
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn le_os_compromissos() {
        let ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:1\r\nSUMMARY:Reunião com a\r\n  gráfica\\, revisão\r\nDTSTART:20261118T170000Z\r\nDTEND:20261118T180000Z\r\nLOCATION:Sala 2\r\nBEGIN:VALARM\r\nSUMMARY:alerta\r\nEND:VALARM\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:Feriado\r\nDTSTART;VALUE=DATE:20261120\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        let e = eventos_do_ics(ics, "Casa");
        assert_eq!(e.len(), 2);
        assert_eq!(e[0].titulo, "Reunião com a gráfica, revisão");
        assert_eq!(e[0].inicio, "20261118T170000Z");
        assert_eq!(e[0].local, "Sala 2");
        assert_eq!(e[1].inicio, "20261120");
        assert!(data_utc_valida("20261118T030000Z"));
        assert!(!data_utc_valida("2026-11-18"));
    }

    #[test]
    fn le_a_lista_de_calendarios() {
        let xml = r#"<?xml version="1.0"?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
 <response><href>/1234/calendars/</href><propstat><prop><resourcetype><collection/></resourcetype></prop></propstat></response>
 <response><href>/1234/calendars/home/</href><propstat><prop><displayname>Casa &amp; família</displayname>
   <resourcetype><collection/><C:calendar/></resourcetype>
   <C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set></prop></propstat></response>
 <response><href>/1234/calendars/tasks/</href><propstat><prop><displayname>Lembretes</displayname>
   <resourcetype><collection/><C:calendar/></resourcetype>
   <C:supported-calendar-component-set><C:comp name="VTODO"/></C:supported-calendar-component-set></prop></propstat></response>
</multistatus>"#;
        let lista = calendarios_da_resposta(xml, "https://p55-caldav.icloud.com:443/1234/calendars/");
        assert_eq!(lista, vec![Calendario { url: "https://p55-caldav.icloud.com:443/1234/calendars/home/".into(), nome: "Casa & família".into() }]);
    }

    #[test]
    fn acha_o_principal() {
        let xml = r#"<d:multistatus xmlns:d="DAV:"><d:response><d:href>/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>/1234/principal/</d:href></d:current-user-principal></d:prop></d:propstat></d:response></d:multistatus>"#;
        assert_eq!(primeiro_href(&sem_prefixos(xml), "current-user-principal").as_deref(), Some("/1234/principal/"));
    }

    #[test]
    fn monta_o_evento() {
        let e = Evento {
            uid: "ilha-assinatura-1".into(),
            titulo: "Vence: Netflix, R$ 55".into(),
            notas: String::new(),
            inicio: "2026-12-31".into(),
            repete: "mensal".into(),
            alerta_minutos: Some(2 * 1440 - 540),
            duracao_minutos: None,
        };
        let t = ics(&e, "20261116T000000Z").unwrap();
        assert!(t.contains("DTSTART;VALUE=DATE:20261231"));
        assert!(t.contains("RRULE:FREQ=MONTHLY;BYMONTHDAY=-1"));
        let trinta = Evento { inicio: "2026-11-30".into(), ..e.clone() };
        assert!(ics(&trinta, "20261116T000000Z").unwrap().contains("BYMONTHDAY=28,29,30;BYSETPOS=-1"));
        assert!(endereco_do_icloud("https://p55-caldav.icloud.com:443/1/calendars/home/"));
        assert!(!endereco_do_icloud("https://icloud.com.ladrao.net/x"));
        assert!(!endereco_do_icloud("http://caldav.icloud.com/"));
        assert!(t.contains("SUMMARY:Vence: Netflix\\, R$ 55"));
        assert!(t.contains("TRIGGER:-PT2340M"));
        let h = Evento { inicio: "2026-11-20T09:30".into(), repete: "semanal".into(), alerta_minutos: Some(0), ..e };
        let t = ics(&h, "20261116T000000Z").unwrap();
        assert!(t.contains("DTSTART:20261120T093000"));
        assert!(t.contains("RRULE:FREQ=WEEKLY"));
        assert!(t.contains("TRIGGER:-PT0M"));
        assert!(agora_utc().ends_with('Z') && agora_utc().len() == 16);
    }
}
