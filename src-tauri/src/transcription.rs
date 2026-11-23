use std::{
    collections::{BTreeSet, HashSet},
    path::{Path, PathBuf},
    process::Stdio,
    sync::Mutex,
    time::Duration,
};

use anyhow::{anyhow, Context, Result};
use serde_json::Value;

use crate::models::{NormalizedTranscript, TranscriptSegment, TranscriptWord};
use crate::platform::{background_command, output_with_timeout, path_exists};

pub async fn transcribe_deepgram(audio_path: &str, api_key: &str) -> Result<NormalizedTranscript> {
    let bytes = tokio::fs::read(audio_path)
        .await
        .with_context(|| format!("reading audio file {audio_path}"))?;

    let response = reqwest::Client::new()
        .post("https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&diarize=true&punctuate=true&filler_words=true")
        .header("Authorization", format!("Token {api_key}"))
        .header("Content-Type", "audio/wav")
        .body(bytes)
        .send()
        .await
        .context("calling Deepgram")?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(anyhow!("Deepgram request failed ({status}): {body}"));
    }

    let value: Value = response.json().await.context("parsing Deepgram response")?;
    normalize_deepgram(value)
}

fn normalize_deepgram(value: Value) -> Result<NormalizedTranscript> {
    let alternative = value
        .pointer("/results/channels/0/alternatives/0")
        .ok_or_else(|| anyhow!("Deepgram response did not include an alternative transcript"))?;

    let language = value
        .pointer("/metadata/language")
        .and_then(Value::as_str)
        .unwrap_or("en")
        .to_string();

    let duration = value
        .pointer("/metadata/duration")
        .and_then(Value::as_f64)
        .unwrap_or_default();

    let raw_words = alternative
        .get("words")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("Deepgram response did not include word timestamps"))?;

    let mut speakers = BTreeSet::new();
    let mut words = Vec::with_capacity(raw_words.len());

    for word in raw_words {
        let text = word
            .get("punctuated_word")
            .or_else(|| word.get("word"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        if text.is_empty() {
            continue;
        }

        let speaker = word
            .get("speaker")
            .and_then(Value::as_i64)
            .map(|speaker| format!("S{}", speaker + 1));
        if let Some(speaker) = &speaker {
            speakers.insert(speaker.clone());
        }

        words.push(TranscriptWord {
            text,
            start: word
                .get("start")
                .and_then(Value::as_f64)
                .unwrap_or_default(),
            end: word.get("end").and_then(Value::as_f64).unwrap_or_default(),
            speaker,
        });
    }

    let segments = build_segments(&words);

    Ok(NormalizedTranscript {
        language,
        duration,
        speakers: speakers.into_iter().collect(),
        words,
        segments,
    })
}

pub fn build_segments(words: &[TranscriptWord]) -> Vec<TranscriptSegment> {
    let mut segments = Vec::new();
    let mut current: Option<TranscriptSegment> = None;

    for word in words {
        let should_break = current.as_ref().map_or(false, |segment| {
            let pause = word.start - segment.end;
            let speaker_changed = segment.speaker != word.speaker;
            let sentence_end = segment.text.ends_with(['.', '!', '?']);
            pause > 0.9 || speaker_changed || sentence_end
        });

        if should_break {
            if let Some(segment) = current.take() {
                segments.push(segment);
            }
        }

        match &mut current {
            Some(segment) => {
                segment.end = word.end;
                segment.text.push(' ');
                segment.text.push_str(&word.text);
            }
            None => {
                current = Some(TranscriptSegment {
                    start: word.start,
                    end: word.end,
                    speaker: word.speaker.clone(),
                    text: word.text.clone(),
                });
            }
        }
    }

    if let Some(segment) = current {
        segments.push(segment);
    }

    segments
}

/// Shown whenever no usable local Whisper install can be found.
pub const WHISPER_MISSING_MESSAGE: &str = "Local Whisper was not found. Install it with `python3 -m pip install -U openai-whisper` (on Windows: `py -m pip install -U openai-whisper`), then press Refresh. If your Python is somewhere unusual, set the AUTOSHORTS_PYTHON environment variable to the full path of that python executable.";

/// Exits 0 only for the openai-whisper package; a different PyPI package is
/// also called `whisper` but has no `load_model`.
const WHISPER_IMPORT_CHECK: &str =
    "import sys, whisper; sys.exit(0 if hasattr(whisper, 'load_model') else 3)";

/// `import whisper` pulls in torch, which can take a while the first time.
const PROBE_TIMEOUT: Duration = Duration::from_secs(90);

static WHISPER_PYTHON: Mutex<Option<PathBuf>> = Mutex::new(None);

/// True if local transcription can run, through Python or the whisper CLI.
pub fn whisper_available() -> bool {
    find_whisper_python().is_some() || find_whisper_cli().is_some()
}

/// Finds a Python interpreter that can import openai-whisper.
///
/// Checks every python on PATH (not just the first one, which on Windows is
/// often the Microsoft Store stub) and the usual install folders, so it works
/// for python.org, Microsoft Store, Python install manager, Homebrew, pyenv
/// and conda installs alike.
pub fn find_whisper_python() -> Option<PathBuf> {
    if let Some(cached) = WHISPER_PYTHON.lock().ok().and_then(|cached| cached.clone()) {
        return Some(cached);
    }
    let found = python_candidates()
        .into_iter()
        .find(|python| python_has_whisper(python))?;
    if let Ok(mut cached) = WHISPER_PYTHON.lock() {
        *cached = Some(found.clone());
    }
    Some(found)
}

fn python_has_whisper(python: &Path) -> bool {
    let mut command = background_command(python);
    command.args(["-c", WHISPER_IMPORT_CHECK]);
    output_with_timeout(command, PROBE_TIMEOUT)
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn python_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    for var in ["AUTOSHORTS_PYTHON", "WHISPER_PYTHON"] {
        if let Some(value) = std::env::var_os(var).filter(|value| !value.is_empty()) {
            candidates.push(PathBuf::from(value));
        }
    }

    let names: &[&str] = if cfg!(windows) {
        &["python.exe", "python3.exe", "py.exe"]
    } else {
        &["python3", "python"]
    };
    candidates.extend(executables_on_path(names));

    if cfg!(windows) {
        candidates.extend(py_launcher_interpreters());
    }
    candidates.extend(
        well_known_pythons()
            .into_iter()
            .filter(|candidate| path_exists(candidate)),
    );

    let mut seen = HashSet::new();
    candidates.retain(|candidate| {
        let key = std::fs::canonicalize(candidate).unwrap_or_else(|_| candidate.clone());
        seen.insert(key)
    });
    candidates
}

/// Every match for `names` in every PATH directory, in PATH order.
fn executables_on_path(names: &[&str]) -> Vec<PathBuf> {
    let Some(path) = std::env::var_os("PATH") else {
        return Vec::new();
    };
    std::env::split_paths(&path)
        .flat_map(|dir| names.iter().map(move |name| dir.join(name)))
        .filter(|candidate| path_exists(candidate))
        .collect()
}

/// Interpreters the Windows `py` launcher knows about (`py -0p`).
fn py_launcher_interpreters() -> Vec<PathBuf> {
    let mut command = background_command("py");
    command.arg("-0p");
    let Some(output) = output_with_timeout(command, Duration::from_secs(15)) else {
        return Vec::new();
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            // Lines look like ` -V:3.12 *   C:\Users\me\...\python.exe`.
            let drive = line.find(":\\")?.checked_sub(1)?;
            let candidate = PathBuf::from(line[drive..].trim());
            path_exists(&candidate).then_some(candidate)
        })
        .collect()
}

fn well_known_pythons() -> Vec<PathBuf> {
    let mut found = Vec::new();
    let home = dirs::home_dir();

    if cfg!(windows) {
        let env_dir = |name: &str| std::env::var_os(name).map(PathBuf::from);
        let local = env_dir("LOCALAPPDATA");
        if let Some(local) = &local {
            for dir in child_dirs(&local.join("Programs").join("Python")) {
                found.push(dir.join("python.exe"));
            }
            // Python install manager (the default for Python 3.14+).
            for dir in child_dirs(&local.join("Python")) {
                found.push(dir.join("python.exe"));
            }
        }
        for root in [env_dir("ProgramFiles"), Some(PathBuf::from("C:\\"))]
            .into_iter()
            .flatten()
        {
            for dir in child_dirs(&root) {
                let is_python = dir
                    .file_name()
                    .map(|name| name.to_string_lossy().to_ascii_lowercase().starts_with("python"))
                    .unwrap_or(false);
                if is_python {
                    found.push(dir.join("python.exe"));
                }
            }
        }
        for base in [home.clone(), local, env_dir("ProgramData")].into_iter().flatten() {
            for conda in ["anaconda3", "miniconda3", "miniforge3"] {
                found.push(base.join(conda).join("python.exe"));
            }
        }
    } else {
        for path in [
            "/opt/homebrew/bin/python3",
            "/usr/local/bin/python3",
            "/opt/local/bin/python3",
            "/usr/bin/python3",
        ] {
            found.push(PathBuf::from(path));
        }
        for dir in child_dirs(Path::new("/Library/Frameworks/Python.framework/Versions")) {
            found.push(dir.join("bin").join("python3"));
        }
        if let Some(home) = &home {
            found.push(home.join(".pyenv/shims/python3"));
            for conda in ["anaconda3", "miniconda3", "miniforge3", "opt/anaconda3", "opt/miniconda3"] {
                found.push(home.join(conda).join("bin/python3"));
            }
        }
    }
    found
}

/// Subdirectories of `dir`, newest-looking names first.
fn child_dirs(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut dirs: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.is_dir())
        .collect();
    dirs.sort();
    dirs.reverse();
    dirs
}

/// Finds the openai-whisper command-line tool (for example a pipx install,
/// where no system python can import the package).
pub fn find_whisper_cli() -> Option<PathBuf> {
    let names: &[&str] = if cfg!(windows) { &["whisper.exe"] } else { &["whisper"] };
    executables_on_path(names).into_iter().find(|candidate| {
        let mut command = background_command(candidate);
        command.arg("--help");
        output_with_timeout(command, PROBE_TIMEOUT)
            .map(|output| {
                output.status.success()
                    && String::from_utf8_lossy(&output.stdout).contains("word_timestamps")
            })
            .unwrap_or(false)
    })
}

fn normalize_whisper_raw_json(raw: serde_json::Value) -> Result<NormalizedTranscript> {
    let language = raw.get("language")
        .and_then(|v| v.as_str())
        .unwrap_or("en")
        .to_string();

    let segments_arr = raw.get("segments")
        .and_then(|v| v.as_array())
        .ok_or_else(|| anyhow!("Missing 'segments' in Whisper JSON"))?;

    let duration = segments_arr.last()
        .and_then(|s| s.get("end").and_then(|e| e.as_f64()))
        .unwrap_or(0.0);

    let mut segments = Vec::new();
    let mut words = Vec::new();

    for seg in segments_arr {
        let start = seg.get("start").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let end = seg.get("end").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let text = seg.get("text").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();

        segments.push(TranscriptSegment {
            start,
            end,
            speaker: Some("S1".to_string()),
            text,
        });

        if let Some(words_arr) = seg.get("words").and_then(|v| v.as_array()) {
            for w in words_arr {
                let word_text = w.get("word").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
                let word_start = w.get("start").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let word_end = w.get("end").and_then(|v| v.as_f64()).unwrap_or(0.0);

                words.push(TranscriptWord {
                    text: word_text,
                    start: word_start,
                    end: word_end,
                    speaker: Some("S1".to_string()),
                });
            }
        }
    }

    Ok(NormalizedTranscript {
        language,
        duration,
        speakers: vec!["S1".to_string()],
        words,
        segments,
    })
}

const TRANSCRIPT_BEGIN: &str = "@@AUTOSHORTS_TRANSCRIPT_BEGIN@@";
const TRANSCRIPT_END: &str = "@@AUTOSHORTS_TRANSCRIPT_END@@";

/// The transcript comes back on stdout rather than through a file: the
/// Microsoft Store build of Python silently redirects files it writes under
/// AppData to a private folder, so a JSON file written there never shows up
/// for the app ("reading output transcript JSON", issues #22, #28).
const TRANSCRIBE_SCRIPT: &str = r#"import json
import sys

import whisper

BEGIN = "@@AUTOSHORTS_TRANSCRIPT_BEGIN@@"
END = "@@AUTOSHORTS_TRANSCRIPT_END@@"


def main():
    if len(sys.argv) < 2:
        print("Usage: transcribe.py <audio_path> [model_name]", file=sys.stderr)
        sys.exit(1)

    audio_path = sys.argv[1]
    model_name = sys.argv[2] if len(sys.argv) > 2 else "base"

    # Uses MPS on Apple Silicon or CUDA when PyTorch supports it.
    model = whisper.load_model(model_name)
    result = model.transcribe(audio_path, word_timestamps=True)
    segments = result.get("segments") or []

    normalized = {
        "language": result.get("language") or "en",
        "duration": segments[-1]["end"] if segments else 0.0,
        "speakers": ["S1"],
        "words": [],
        "segments": [],
    }

    for segment in segments:
        normalized["segments"].append({
            "start": segment["start"],
            "end": segment["end"],
            "speaker": "S1",
            "text": segment["text"].strip(),
        })
        for word in segment.get("words", []):
            normalized["words"].append({
                "text": word["word"].strip(),
                "start": word["start"],
                "end": word["end"],
                "speaker": "S1",
            })

    sys.stdout.write("\n" + BEGIN + "\n" + json.dumps(normalized, ensure_ascii=True) + "\n" + END + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
"#;

/// Transcribes `audio_path` with local Whisper. `work_dir` is the app's data
/// folder, where the helper script is written.
pub async fn transcribe_local(audio_path: &str, work_dir: &Path) -> Result<NormalizedTranscript> {
    let audio_path = audio_path.to_string();
    let work_dir = work_dir.to_path_buf();

    tokio::task::spawn_blocking(move || {
        if let Some(python) = find_whisper_python() {
            return transcribe_with_python(&python, &audio_path, &work_dir);
        }
        if let Some(cli) = find_whisper_cli() {
            return transcribe_with_cli(&cli, &audio_path);
        }
        Err(anyhow!(WHISPER_MISSING_MESSAGE))
    })
    .await
    .context("local Whisper task failed")?
}

fn transcribe_with_python(python: &Path, audio_path: &str, work_dir: &Path) -> Result<NormalizedTranscript> {
    std::fs::create_dir_all(work_dir)
        .with_context(|| format!("creating {}", work_dir.display()))?;
    // Always rewrite, so a copy left by an older app version is replaced.
    let script_path = work_dir.join("transcribe.py");
    std::fs::write(&script_path, TRANSCRIBE_SCRIPT)
        .with_context(|| format!("writing {}", script_path.display()))?;

    let output = background_command(python)
        .arg(&script_path)
        .arg(audio_path)
        .arg("base")
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .stdin(Stdio::null())
        .output()
        .with_context(|| format!("running Whisper with {}", python.display()))?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() {
        return Err(anyhow!(
            "Whisper transcription failed (python: {}):\n{}",
            python.display(),
            tail(&stderr, 4000)
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json = stdout
        .rfind(TRANSCRIPT_BEGIN)
        .map(|begin| &stdout[begin + TRANSCRIPT_BEGIN.len()..])
        .and_then(|rest| rest.find(TRANSCRIPT_END).map(|end| rest[..end].trim()))
        .ok_or_else(|| {
            anyhow!(
                "Whisper finished but returned no transcript (python: {}).\n{}",
                python.display(),
                tail(&stderr, 4000)
            )
        })?;
    serde_json::from_str(json).context("parsing the Whisper transcript")
}

fn transcribe_with_cli(cli: &Path, audio_path: &str) -> Result<NormalizedTranscript> {
    let audio = Path::new(audio_path);
    let audio_dir = audio
        .parent()
        .ok_or_else(|| anyhow!("Invalid audio path {audio_path}"))?;
    let audio_stem = audio
        .file_stem()
        .ok_or_else(|| anyhow!("Invalid audio file name {audio_path}"))?
        .to_string_lossy()
        .to_string();
    let output_json_path = audio_dir.join(format!("{audio_stem}.json"));

    let output = background_command(cli)
        .arg(audio_path)
        .args(["--model", "base"])
        .args(["--output_format", "json"])
        .arg("--output_dir")
        .arg(audio_dir)
        .args(["--word_timestamps", "True"])
        .env("PYTHONIOENCODING", "utf-8")
        .stdin(Stdio::null())
        .output()
        .with_context(|| format!("running {}", cli.display()))?;

    if !output.status.success() {
        return Err(anyhow!(
            "Whisper CLI failed ({}):\n{}",
            cli.display(),
            tail(&String::from_utf8_lossy(&output.stderr), 4000)
        ));
    }

    let json_bytes = std::fs::read(&output_json_path).with_context(|| {
        format!(
            "reading output transcript JSON from CLI at {}",
            output_json_path.display()
        )
    })?;
    let raw_json: serde_json::Value =
        serde_json::from_slice(&json_bytes).context("parsing output transcript JSON")?;

    let _ = std::fs::remove_file(&output_json_path);
    // The CLI sometimes writes extra formats too.
    for ext in ["txt", "srt", "vtt", "tsv"] {
        let _ = std::fs::remove_file(audio_dir.join(format!("{audio_stem}.{ext}")));
    }

    normalize_whisper_raw_json(raw_json)
}

/// The last `max_chars` characters of `text`, for readable error messages.
fn tail(text: &str, max_chars: usize) -> &str {
    let text = text.trim();
    if max_chars == 0 {
        return "";
    }
    match text.char_indices().rev().nth(max_chars - 1) {
        Some((index, _)) => &text[index..],
        None => text,
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    const FAKE_OPENAI_WHISPER: &str = r#"
def load_model(name):
    return _Model()


class _Model:
    def transcribe(self, audio_path, word_timestamps=False):
        print("progress chatter on stdout before the transcript")
        return {
            "language": "en",
            "segments": [
                {
                    "start": 0.0,
                    "end": 1.5,
                    "text": " Hello café",
                    "words": [
                        {"word": " Hello", "start": 0.0, "end": 0.7},
                        {"word": " café", "start": 0.7, "end": 1.5},
                    ],
                },
            ],
        }
"#;

    /// A `python` wrapper that sees a fake `whisper` module, like an
    /// interpreter that has openai-whisper installed.
    fn fake_python(test_name: &str, whisper_module: &str) -> Option<(PathBuf, PathBuf)> {
        background_command("python3").arg("--version").output().ok()?;
        let dir = std::env::temp_dir().join(format!(
            "autoshorts-{test_name}-{}",
            std::process::id()
        ));
        let module_dir = dir.join("modules").join("whisper");
        std::fs::create_dir_all(&module_dir).unwrap();
        std::fs::write(module_dir.join("__init__.py"), whisper_module).unwrap();
        let python = dir.join("python");
        std::fs::write(
            &python,
            format!(
                "#!/bin/sh\nPYTHONPATH='{}' exec python3 \"$@\"\n",
                dir.join("modules").display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&python, std::fs::Permissions::from_mode(0o755)).unwrap();
        Some((dir, python))
    }

    #[test]
    fn transcribes_through_python_stdout() {
        let Some((dir, python)) = fake_python("whisper-stdout", FAKE_OPENAI_WHISPER) else {
            return;
        };
        assert!(python_has_whisper(&python));

        let transcript = transcribe_with_python(&python, "audio.wav", &dir).unwrap();
        assert_eq!(transcript.segments.len(), 1);
        assert_eq!(transcript.segments[0].text, "Hello café");
        assert_eq!(transcript.words.len(), 2);
        assert_eq!(transcript.words[1].text, "café");
        assert_eq!(transcript.duration, 1.5);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ignores_unrelated_whisper_package() {
        let Some((dir, python)) = fake_python("whisper-unrelated", "def create(): pass\n") else {
            return;
        };
        assert!(!python_has_whisper(&python));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn tail_keeps_the_end() {
        assert_eq!(tail("  abcdef  ", 3), "def");
        assert_eq!(tail("ab", 3), "ab");
    }
}
