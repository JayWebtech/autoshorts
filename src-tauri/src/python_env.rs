//! Managed Python environment for local Whisper transcription.
//!
//! The app does not ship a Python interpreter or PyTorch inside the installer
//! (that would add ~2 GB per platform). Instead it owns a virtual environment
//! under the app data directory and installs `openai-whisper` into it, so the
//! installed application never depends on whatever the user happens to have in
//! their global `site-packages`.
//!
//! Linux `.deb`/`.rpm` packages declare `python3`/`python3-venv` as
//! dependencies, so the installer pulls the interpreter; the heavy Python
//! packages land in our own venv on first run (or on demand from Settings).

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;

use anyhow::{anyhow, Context, Result};
use serde::Serialize;
use tauri::Emitter;

/// PyPI distribution that provides the `whisper` module and the `whisper` CLI.
pub const WHISPER_PACKAGE: &str = "openai-whisper";

/// Event stream consumed by the UI while the environment is being provisioned.
pub const PROGRESS_EVENT: &str = "python-env-progress";

const VENV_DIR_NAME: &str = "python-venv";

static VENV_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Remembers where the managed venv lives so the transcription module can find
/// it without threading the app data directory through every call site.
pub fn register_venv_dir(data_dir: &Path) {
    let _ = VENV_DIR.set(data_dir.join(VENV_DIR_NAME));
}

pub fn registered_venv_dir() -> Option<&'static Path> {
    VENV_DIR.get().map(PathBuf::as_path)
}

pub fn venv_python(venv_dir: &Path) -> PathBuf {
    if cfg!(windows) {
        venv_dir.join("Scripts").join("python.exe")
    } else {
        venv_dir.join("bin").join("python")
    }
}

pub fn venv_whisper_cli(venv_dir: &Path) -> PathBuf {
    if cfg!(windows) {
        venv_dir.join("Scripts").join("whisper.exe")
    } else {
        venv_dir.join("bin").join("whisper")
    }
}

fn runs(python: &Path, args: &[&str]) -> bool {
    Command::new(python)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

pub fn python_has_whisper(python: &Path) -> bool {
    runs(python, &["-c", "import whisper"])
}

/// `true` when the managed venv exists and can `import whisper`.
pub fn venv_ready(venv_dir: &Path) -> bool {
    let python = venv_python(venv_dir);
    python.is_file() && python_has_whisper(&python)
}

/// Candidate interpreters outside the managed venv.
fn python_candidates() -> &'static [&'static str] {
    if cfg!(windows) {
        &["python", "py", "python3"]
    } else {
        &["python3", "python"]
    }
}

fn resolve_on_path(cmd: &str) -> Option<PathBuf> {
    if Command::new(cmd)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
    {
        Some(PathBuf::from(cmd))
    } else {
        None
    }
}

/// Any interpreter able to create a virtualenv (does not need Whisper yet).
pub fn system_python() -> Option<PathBuf> {
    python_candidates().iter().find_map(|cmd| resolve_on_path(cmd))
}

/// Interpreter used for local transcription: the managed venv when it has
/// Whisper, otherwise a system Python that already imports it.
pub fn active_python() -> Option<PathBuf> {
    if let Some(venv_dir) = registered_venv_dir() {
        let python = venv_python(venv_dir);
        if python.is_file() && python_has_whisper(&python) {
            return Some(python);
        }
    }

    python_candidates()
        .iter()
        .filter_map(|cmd| resolve_on_path(cmd))
        .find(|python| python_has_whisper(python))
}

/// `whisper` executable: the managed venv first, then whatever is on `PATH`.
pub fn active_whisper_cli() -> Option<PathBuf> {
    if let Some(venv_dir) = registered_venv_dir() {
        let cli = venv_whisper_cli(venv_dir);
        if cli.is_file() && runs(&cli, &["--help"]) {
            return Some(cli);
        }
    }

    if cfg!(windows) {
        ["whisper", "whisper.exe"]
            .iter()
            .find_map(|cmd| resolve_on_path(cmd))
    } else {
        resolve_on_path("whisper")
    }
}

/// Snapshot returned to the settings screen.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PythonEnvStatus {
    /// Managed venv exists and can import `whisper`.
    pub ready: bool,
    /// Managed venv exists (even if Whisper is missing/partial).
    pub venv_created: bool,
    pub venv_dir: String,
    /// Interpreter that transcription will actually use.
    pub python: Option<String>,
    /// System interpreter available to create the venv.
    pub system_python: Option<String>,
    pub whisper_cli: Option<String>,
}

pub fn status(data_dir: &Path) -> PythonEnvStatus {
    let venv_dir = data_dir.join(VENV_DIR_NAME);
    PythonEnvStatus {
        ready: venv_ready(&venv_dir),
        venv_created: venv_python(&venv_dir).is_file(),
        venv_dir: venv_dir.to_string_lossy().to_string(),
        python: active_python().map(|p| p.to_string_lossy().to_string()),
        system_python: system_python().map(|p| p.to_string_lossy().to_string()),
        whisper_cli: active_whisper_cli().map(|p| p.to_string_lossy().to_string()),
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressPayload {
    status: String,
    percentage: Option<f64>,
}

fn emit(app: &tauri::AppHandle, status: impl Into<String>, percentage: Option<f64>) {
    let _ = app.emit(
        PROGRESS_EVENT,
        ProgressPayload {
            status: status.into(),
            percentage,
        },
    );
}

/// Runs pip, streaming its output to the UI. `label` prefixes the status lines
/// so the progress panel says what is being installed.
fn run_pip(
    app: &tauri::AppHandle,
    python: &Path,
    args: &[&str],
    label: &str,
    start: f64,
    end: f64,
) -> Result<()> {
    let mut child = Command::new(python)
        .args(["-m", "pip"])
        .args(args)
        .env("PIP_DISABLE_PIP_VERSION_CHECK", "1")
        .env("PIP_NO_INPUT", "1")
        .env("PYTHONUNBUFFERED", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .with_context(|| format!("running {} -m pip {}", python.display(), args.join(" ")))?;

    let stdout = child.stdout.take().context("capturing pip stdout")?;
    let stderr = child.stderr.take().context("capturing pip stderr")?;

    // pip splits progress (stdout) and warnings/errors (stderr); keep the last
    // stderr lines so a failure can be reported with the real reason.
    let stderr_handle = std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        let mut tail: Vec<String> = Vec::new();
        for line in reader.lines().map_while(Result::ok) {
            let line = line.trim().to_string();
            if line.is_empty() {
                continue;
            }
            tail.push(line);
            if tail.len() > 12 {
                tail.remove(0);
            }
        }
        tail
    });

    let reader = BufReader::new(stdout);
    let mut collected = 0usize;
    for line in reader.lines().map_while(Result::ok) {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        collected += 1;
        // pip prints one line per collected/downloaded/installed item; use the
        // count as a coarse progress signal that never goes backwards.
        let step = (collected.min(60) as f64) / 60.0;
        emit(
            app,
            format!("{label}: {line}"),
            Some(start + (end - start) * step),
        );
    }

    let status = child.wait().context("waiting for pip")?;
    let tail = stderr_handle.join().unwrap_or_default();
    if !status.success() {
        let detail = if tail.is_empty() {
            format!("exit code {}", status.code().unwrap_or(-1))
        } else {
            tail.join(" · ")
        };
        return Err(anyhow!("pip {label} failed: {detail}"));
    }
    Ok(())
}

/// Creates the managed venv (if needed) and installs `openai-whisper` in it.
pub fn install(app: &tauri::AppHandle, data_dir: &Path) -> Result<()> {
    let venv_dir = data_dir.join(VENV_DIR_NAME);
    let python = venv_python(&venv_dir);

    if venv_ready(&venv_dir) {
        emit(app, "Whisper já está instalado", Some(100.0));
        return Ok(());
    }

    if !python.is_file() {
        let system = system_python().ok_or_else(|| {
            anyhow!(
                "Python 3.9+ não encontrado. Instale o Python (python.org no Windows, \
                 `sudo apt install python3 python3-venv` no Debian/Ubuntu) e tente novamente."
            )
        })?;
        emit(app, "Criando ambiente virtual Python…", Some(2.0));
        std::fs::create_dir_all(&venv_dir).context("creating the venv directory")?;
        let output = Command::new(&system)
            .args(["-m", "venv"])
            .arg(&venv_dir)
            .output()
            .with_context(|| format!("creating a virtualenv with {}", system.display()))?;
        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr);
            return Err(anyhow!(
                "`{} -m venv` falhou. No Debian/Ubuntu instale python3-venv. {}",
                system.display(),
                detail.trim()
            ));
        }
    }

    if !python.is_file() {
        return Err(anyhow!(
            "o ambiente virtual foi criado em {} mas o interpretador não foi encontrado",
            venv_dir.display()
        ));
    }

    emit(app, "Atualizando pip…", Some(5.0));
    run_pip(
        app,
        &python,
        &["install", "--upgrade", "pip", "setuptools", "wheel"],
        "pip",
        5.0,
        15.0,
    )?;

    emit(
        app,
        format!("Instalando {WHISPER_PACKAGE} (baixa o PyTorch, ~1-2 GB)…"),
        Some(15.0),
    );
    run_pip(
        app,
        &python,
        &["install", "--upgrade", WHISPER_PACKAGE],
        WHISPER_PACKAGE,
        15.0,
        97.0,
    )?;

    if !venv_ready(&venv_dir) {
        return Err(anyhow!(
            "{WHISPER_PACKAGE} foi instalado mas `import whisper` continua falhando em {}",
            python.display()
        ));
    }

    emit(app, "Whisper pronto", Some(100.0));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn venv_paths_are_platform_specific() {
        let dir = Path::new("/tmp/venv");
        let python = venv_python(dir);
        let cli = venv_whisper_cli(dir);

        if cfg!(windows) {
            assert!(python.ends_with("Scripts/python.exe"));
            assert!(cli.ends_with("Scripts/whisper.exe"));
        } else {
            assert!(python.ends_with("bin/python"));
            assert!(cli.ends_with("bin/whisper"));
        }
    }

    #[test]
    fn status_reports_a_missing_environment() {
        let data_dir = std::env::temp_dir().join("autoshorts-python-env-test");
        let _ = std::fs::remove_dir_all(&data_dir);
        let status = status(&data_dir);

        assert!(!status.ready);
        assert!(!status.venv_created);
        assert!(status.venv_dir.ends_with(VENV_DIR_NAME));
    }

    #[test]
    fn venv_is_not_ready_without_the_interpreter() {
        let data_dir = std::env::temp_dir().join("autoshorts-python-env-test-2");
        let _ = std::fs::remove_dir_all(&data_dir);
        assert!(!venv_ready(&data_dir.join(VENV_DIR_NAME)));
    }
}
