//! Process and environment helpers that smooth over how desktop apps are launched.

use std::{
    collections::HashSet,
    ffi::{OsStr, OsString},
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    time::{Duration, Instant},
};

/// A `Command` for a background helper process (ffmpeg, python, whisper, ...).
/// On Windows this stops a console window from flashing up for every call.
pub fn background_command(program: impl AsRef<OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// Apps opened from Finder, the Dock or a desktop launcher do not inherit the
/// PATH a user's terminal has, so tools installed with Homebrew, pyenv, conda
/// or `pip --user` look "not installed" (issue #49). Rebuild PATH from the
/// user's login shell plus the usual install folders. Must run before any
/// threads are spawned.
pub fn augment_path_for_gui_launch() {
    if cfg!(windows) {
        return;
    }

    let mut entries: Vec<PathBuf> = Vec::new();
    if let Some(shell_path) = login_shell_path() {
        entries.extend(std::env::split_paths(&shell_path));
    }
    if let Some(current) = std::env::var_os("PATH") {
        entries.extend(std::env::split_paths(&current));
    }
    entries.extend(well_known_bin_dirs().into_iter().filter(|dir| dir.is_dir()));

    let mut seen = HashSet::new();
    entries.retain(|entry| !entry.as_os_str().is_empty() && seen.insert(entry.clone()));

    if let Ok(joined) = std::env::join_paths(entries) {
        std::env::set_var("PATH", joined);
    }
}

fn well_known_bin_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/opt/homebrew/sbin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/opt/local/bin"),
        PathBuf::from("/snap/bin"),
    ];
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join(".local/bin"));
        dirs.push(home.join("bin"));
        dirs.push(home.join(".pyenv/shims"));
        // `pip install --user` puts console scripts (e.g. `whisper`) here on macOS.
        if let Ok(read_dir) = std::fs::read_dir(home.join("Library/Python")) {
            let mut versions: Vec<PathBuf> = read_dir
                .filter_map(|entry| entry.ok().map(|entry| entry.path().join("bin")))
                .collect();
            versions.sort();
            versions.reverse();
            dirs.extend(versions);
        }
    }
    dirs
}

/// Asks the user's login shell for its PATH, giving up after a few seconds so
/// a slow or interactive shell profile can never block app startup.
fn login_shell_path() -> Option<OsString> {
    const MARKER: &str = "__AUTOSHORTS_PATH__";
    let shell = std::env::var("SHELL")
        .ok()
        .filter(|shell| !shell.trim().is_empty())
        .unwrap_or_else(|| {
            if cfg!(target_os = "macos") {
                "/bin/zsh".to_string()
            } else {
                "/bin/sh".to_string()
            }
        });

    let mut command = Command::new(&shell);
    command.args(["-ilc", &format!("printf '{MARKER}%s{MARKER}' \"$PATH\"")]);
    let output = output_with_timeout(command, Duration::from_secs(3))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let start = stdout.find(MARKER)? + MARKER.len();
    let end = start + stdout[start..].find(MARKER)?;
    let path = stdout[start..end].trim();
    if path.is_empty() {
        None
    } else {
        Some(OsString::from(path))
    }
}

/// Runs a command with stdin closed and stdout/stderr captured, killing it if
/// it has not finished within `timeout`. Returns `None` if it could not be
/// started or timed out.
pub fn output_with_timeout(mut command: Command, timeout: Duration) -> Option<Output> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().ok()?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdout_reader = std::thread::spawn(move || read_pipe(stdout));
    let stderr_reader = std::thread::spawn(move || read_pipe(stderr));

    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(25)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    };

    Some(Output {
        status,
        stdout: stdout_reader.join().unwrap_or_default(),
        stderr: stderr_reader.join().unwrap_or_default(),
    })
}

fn read_pipe(pipe: Option<impl Read>) -> Vec<u8> {
    let mut buffer = Vec::new();
    if let Some(mut pipe) = pipe {
        let _ = pipe.read_to_end(&mut buffer);
    }
    buffer
}

/// True if `path` exists. Unlike `Path::exists`, this also accepts Windows
/// app execution aliases (e.g. the `python.exe` in `WindowsApps`), which are
/// reparse points that `metadata` cannot follow.
pub fn path_exists(path: &Path) -> bool {
    path.exists() || path.symlink_metadata().is_ok()
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    /// Run under a Finder-like environment to reproduce issue #49:
    /// `env -i HOME="$HOME" SHELL="$SHELL" PATH=/usr/bin:/bin cargo test -- --ignored gui_launch`
    #[test]
    #[ignore]
    fn gui_launch_path_finds_homebrew_tools() {
        let before = std::env::var("PATH").unwrap_or_default();
        augment_path_for_gui_launch();
        let after = std::env::var("PATH").unwrap();
        println!("PATH before: {before}\nPATH after:  {after}");
        assert!(crate::media::command_exists("ffmpeg"), "ffmpeg still not found");
    }
}
