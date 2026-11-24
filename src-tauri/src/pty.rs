//! Pseudo-terminal du terminal Claude intégré (§3) : démarrer, écrire,
//! redimensionner, arrêter. La sortie part vers l'UI en événements `pty-data`.
//! Rien d'autre : pas d'accès au moteur, pas de commande imposée hors shell.

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

pub struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct Ptys {
    next: AtomicU32,
    sessions: Mutex<HashMap<u32, Session>>,
}

#[derive(Clone, serde::Serialize)]
struct PtyData {
    id: u32,
    data: String,
}

#[derive(Clone, serde::Serialize)]
struct PtyExit {
    id: u32,
}

/// Shell de connexion de l'utilisateur ; lance `claude` s'il existe, sinon reste dans le shell.
const START: &str = "command -v claude >/dev/null 2>&1 && claude; exec zsh -l";

pub fn command(cwd: &str) -> CommandBuilder {
    let mut cmd = CommandBuilder::new("/bin/zsh");
    cmd.args(["-lc", START]);
    cmd.cwd(cwd);
    cmd.env("TERM", "xterm-256color");
    cmd
}

#[tauri::command]
pub fn pty_start(app: AppHandle, ptys: State<'_, Ptys>, cwd: String, cols: u16, rows: u16) -> Result<u32, String> {
    let cwd = if std::path::Path::new(&cwd).is_dir() { cwd } else { std::env::var("HOME").unwrap_or_else(|_| "/".into()) };
    let pair = native_pty_system()
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("pseudo-terminal impossible : {e}"))?;
    let child = pair.slave.spawn_command(command(&cwd)).map_err(|e| format!("shell impossible : {e}"))?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let id = ptys.next.fetch_add(1, Ordering::SeqCst) + 1;
    ptys.sessions.lock().map_err(|e| e.to_string())?.insert(id, Session { master: pair.master, writer, child });
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let _ = app.emit("pty-data", PtyData { id, data: String::from_utf8_lossy(&buf[..n]).into_owned() });
                }
            }
        }
        let _ = app.emit("pty-exit", PtyExit { id });
    });
    Ok(id)
}

#[tauri::command]
pub fn pty_write(ptys: State<'_, Ptys>, id: u32, data: String) -> Result<(), String> {
    let mut s = ptys.sessions.lock().map_err(|e| e.to_string())?;
    let session = s.get_mut(&id).ok_or("terminal inconnu")?;
    session.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(ptys: State<'_, Ptys>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let s = ptys.sessions.lock().map_err(|e| e.to_string())?;
    let session = s.get(&id).ok_or("terminal inconnu")?;
    session.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_stop(ptys: State<'_, Ptys>, id: u32) -> Result<(), String> {
    if let Some(mut session) = ptys.sessions.lock().map_err(|e| e.to_string())?.remove(&id) {
        let _ = session.child.kill();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_command_is_a_login_shell_in_the_given_folder() {
        let cmd = command("/tmp");
        let argv: Vec<String> = cmd.get_argv().iter().map(|a| a.to_string_lossy().into_owned()).collect();
        assert_eq!(argv, ["/bin/zsh", "-lc", START]);
        assert_eq!(cmd.get_cwd().map(|c| c.to_string_lossy().into_owned()), Some("/tmp".into()));
    }

    #[test]
    fn a_real_pty_echoes_what_is_written() {
        let pair = native_pty_system().openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 }).unwrap();
        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.args(["-c", "read line; echo \"vu:$line\""]);
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut writer = pair.master.take_writer().unwrap();
        writer.write_all(b"bonjour\n").unwrap();
        let mut out = String::new();
        let mut buf = [0u8; 1024];
        let start = std::time::Instant::now();
        while !out.contains("vu:bonjour") && start.elapsed().as_secs() < 5 {
            let n = reader.read(&mut buf).unwrap_or(0);
            if n == 0 {
                break;
            }
            out.push_str(&String::from_utf8_lossy(&buf[..n]));
        }
        let _ = child.wait();
        assert!(out.contains("vu:bonjour"), "sortie : {out:?}");
    }
}
