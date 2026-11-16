//! Skills que o Dan já tem instaladas no Claude Code (pasta ~/.claude/skills).
//! A ilha lê o SKILL.md de cada uma para importar como skill da ilha (aí
//! funcionam com qualquer IA). Só lê; não muda nada nas pastas.

use std::path::Path;

use serde::Serialize;

#[derive(Serialize, Debug, PartialEq)]
pub struct SkillEncontrada {
    pub nome: String,
    pub descricao: String,
    pub instrucoes: String,
}

/// Separa o cabeçalho (entre "---") do texto. Lê só "name" e "description".
pub fn ler_skill(texto: &str, pasta: &str) -> SkillEncontrada {
    let texto = texto.trim_start_matches('\u{feff}');
    let (cabeca, corpo) = match texto.strip_prefix("---") {
        Some(resto) => match resto.find("\n---") {
            Some(fim) => (&resto[..fim], resto[fim + 4..].trim_start_matches(['-', '\r', '\n'])),
            None => ("", texto),
        },
        None => ("", texto),
    };
    let campo = |nome: &str| {
        cabeca
            .lines()
            .find_map(|l| l.trim().strip_prefix(&format!("{nome}:")).map(|v| v.trim().trim_matches(['"', '\'']).to_string()))
            .unwrap_or_default()
    };
    let nome = campo("name");
    SkillEncontrada {
        nome: if nome.is_empty() { pasta.to_string() } else { nome },
        descricao: campo("description").chars().take(200).collect(),
        instrucoes: corpo.trim().chars().take(20_000).collect(),
    }
}

fn pasta_de_skills() -> Option<std::path::PathBuf> {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(|c| Path::new(&c).join(".claude").join("skills"))
}

#[tauri::command]
pub fn skills_do_claude() -> Vec<SkillEncontrada> {
    let Some(pasta) = pasta_de_skills() else { return Vec::new() };
    let Ok(itens) = std::fs::read_dir(pasta) else { return Vec::new() };
    let mut lista: Vec<SkillEncontrada> = itens
        .flatten()
        .filter(|i| i.path().is_dir())
        .filter_map(|i| {
            let texto = std::fs::read_to_string(i.path().join("SKILL.md")).ok()?;
            Some(ler_skill(&texto, &i.file_name().to_string_lossy()))
        })
        .collect();
    lista.sort_by(|a, b| a.nome.to_lowercase().cmp(&b.nome.to_lowercase()));
    lista
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn le_o_cabecalho() {
        let s = ler_skill("---\nname: revisor\ndescription: \"Revisa textos\"\n---\n\n# Como revisar\nPasso 1", "pasta");
        assert_eq!(s.nome, "revisor");
        assert_eq!(s.descricao, "Revisa textos");
        assert!(s.instrucoes.starts_with("# Como revisar"));
        let sem = ler_skill("Só texto", "minha-skill");
        assert_eq!(sem.nome, "minha-skill");
    }
}
