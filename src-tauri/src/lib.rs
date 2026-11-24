//! Coque minimale (§3) : une seule commande, `run_engine`, qui lance le moteur
//! Node et renvoie son JSON tel quel. Toute la logique vit dans le moteur.

mod pty;

use std::path::PathBuf;
use std::process::Command;

/// Script passé à un shell de connexion : une app lancée du Finder n'hérite pas
/// du PATH (node). Les arguments passent par "$@", jamais interpolés, et tsx est
/// appelé directement : `pnpm run` réécrit les arguments qui contiennent des sauts de ligne.
const ENGINE_SCRIPT: &str = r#"cd -- "$1" && shift && exec ./node_modules/.bin/tsx src/engine/cli.ts "$@""#;

/// Dossier du projet de l'outil : `CC_HOME` s'il est défini, sinon le dossier
/// parent de `src-tauri` connu à la compilation.
fn tool_dir() -> PathBuf {
    std::env::var_os("CC_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."))
}

fn engine_command(dir: &PathBuf, args: &[String]) -> Command {
    let mut cmd = Command::new("/bin/zsh");
    cmd.arg("-lc").arg(ENGINE_SCRIPT).arg("coverage-cockpit").arg(dir).args(args);
    cmd
}

fn run_blocking(dir: PathBuf, args: Vec<String>) -> Result<String, String> {
    let out = engine_command(&dir, &args)
        .output()
        .map_err(|e| format!("lancement du moteur impossible : {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(if stderr.is_empty() {
            format!("le moteur a échoué ({})", out.status)
        } else {
            stderr
        })
    }
}

#[tauri::command]
async fn run_engine(args: Vec<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || run_blocking(tool_dir(), args))
        .await
        .map_err(|e| format!("tâche du moteur interrompue : {e}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(pty::Ptys::default())
        .invoke_handler(tauri::generate_handler![run_engine, pty::pty_start, pty::pty_write, pty::pty_resize, pty::pty_stop])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Coverage Cockpit");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arguments_are_passed_verbatim_not_interpolated() {
        let cmd = engine_command(&PathBuf::from("/tmp/x"), &["$(touch /tmp/pwned)".into(), "a b".into()]);
        let args: Vec<_> = cmd.get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert_eq!(args[0], "-lc");
        assert_eq!(args[1], ENGINE_SCRIPT);
        assert_eq!(&args[3..], ["/tmp/x", "$(touch /tmp/pwned)", "a b"]);
    }

    #[test]
    fn engine_errors_surface_stderr() {
        // Dossier inexistant : le `cd` échoue, le message de zsh remonte.
        let err = run_blocking(PathBuf::from("/nonexistent-cc-dir"), vec!["journeys".into()]).unwrap_err();
        assert!(!err.is_empty());
    }
}
