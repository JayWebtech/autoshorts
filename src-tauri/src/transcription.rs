use std::collections::BTreeSet;
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::Stdio;

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Emitter;

use crate::models::{NormalizedTranscript, TranscriptSegment, TranscriptWord};

/// Whisper checkpoints supported by the download UI: (id, label, approx size in MB).
pub const WHISPER_MODELS: &[(&str, &str, u64)] = &[
    ("tiny", "Tiny", 75),
    ("base", "Base", 142),
    ("small", "Small", 466),
    ("medium", "Medium", 1500),
    ("large-v3", "Large v3", 3090),
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperModelInfo {
    pub id: String,
    pub label: String,
    pub size_mb: u64,
    pub downloaded: bool,
    pub path: Option<String>,
}

/// Directories where the Python `openai-whisper` package stores its checkpoints.
pub fn whisper_cache_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();

    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join(".cache").join("whisper"));
    }
    if let Ok(xdg) = std::env::var("XDG_CACHE_HOME") {
        if !xdg.trim().is_empty() {
            dirs.push(PathBuf::from(xdg).join("whisper"));
        }
    }
    if let Some(cache) = dirs::cache_dir() {
        dirs.push(cache.join("whisper"));
    }

    dirs.dedup();
    dirs
}

pub fn whisper_model_path(model: &str) -> PathBuf {
    let file = format!("{model}.pt");
    for dir in whisper_cache_dirs() {
        let candidate = dir.join(&file);
        if candidate.is_file() {
            return candidate;
        }
    }
    whisper_cache_dirs()
        .into_iter()
        .next()
        .unwrap_or_else(|| PathBuf::from(".").join("whisper"))
        .join(file)
}

pub fn whisper_model_downloaded(model: &str) -> bool {
    let path = whisper_model_path(model);
    std::fs::metadata(&path)
        .map(|meta| meta.is_file() && meta.len() > 0)
        .unwrap_or(false)
}

pub fn list_whisper_models() -> Vec<WhisperModelInfo> {
    WHISPER_MODELS
        .iter()
        .map(|(id, label, size_mb)| {
            let downloaded = whisper_model_downloaded(id);
            WhisperModelInfo {
                id: (*id).to_string(),
                label: (*label).to_string(),
                size_mb: *size_mb,
                downloaded,
                path: downloaded.then(|| whisper_model_path(id).to_string_lossy().to_string()),
            }
        })
        .collect()
}

fn parse_percentage(line: &str) -> Option<f64> {
    let percent_index = line.find('%')?;
    let digits: String = line[..percent_index]
        .chars()
        .rev()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect::<Vec<char>>()
        .into_iter()
        .rev()
        .collect();
    digits.parse::<f64>().ok()
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WhisperDownloadPayload {
    status: String,
    percentage: Option<f64>,
}

/// Downloads a Whisper checkpoint by letting the Python package fetch it into its cache,
/// streaming progress back to the UI through the `whisper-model-progress` event.
pub async fn download_whisper_model(app: tauri::AppHandle, model: String) -> Result<()> {
    let model = model.trim().to_string();
    if model.is_empty() {
        return Err(anyhow!("No Whisper model was selected"));
    }

    if whisper_model_downloaded(&model) {
        let _ = app.emit(
            "whisper-model-progress",
            WhisperDownloadPayload {
                status: "Model already downloaded".to_string(),
                percentage: Some(100.0),
            },
        );
        return Ok(());
    }

    if !whisper_python_exists() {
        return Err(anyhow!(
            "O pacote Python 'whisper' não está instalado. Use \"Instalar Whisper\" nas configurações para baixá-lo automaticamente."
        ));
    }

    let python = find_python_command().ok_or_else(|| anyhow!("Python interpreter not found"))?;
    let label = WHISPER_MODELS
        .iter()
        .find(|(id, _, _)| *id == model)
        .map(|(_, label, _)| (*label).to_string())
        .unwrap_or_else(|| model.clone());

    let _ = app.emit(
        "whisper-model-progress",
        WhisperDownloadPayload {
            status: format!("Preparing {label} model..."),
            percentage: Some(0.0),
        },
    );

    let script = "import sys\nimport whisper\nwhisper.load_model(sys.argv[1])\nprint('AUTOSHORTS_MODEL_READY')\n";

    let app_handle = app.clone();
    let model_for_task = model.clone();
    let label_for_task = label.clone();

    tokio::task::spawn_blocking(move || -> Result<()> {
        let mut child = std::process::Command::new(&python)
            .args(["-c", script, &model_for_task])
            .env("PYTHONUNBUFFERED", "1")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .context("starting python whisper download")?;

        let mut stderr = child.stderr.take().context("capturing whisper stderr")?;
        let mut buffer: Vec<u8> = Vec::new();
        let mut byte = [0u8; 1];
        let mut last_percentage = 0.0_f64;
        let mut tail: Vec<String> = Vec::new();

        loop {
            match stderr.read(&mut byte) {
                Ok(0) => break,
                Ok(_) => {
                    if byte[0] == b'\r' || byte[0] == b'\n' {
                        if !buffer.is_empty() {
                            let line = String::from_utf8_lossy(&buffer).trim().to_string();
                            buffer.clear();
                            if line.is_empty() {
                                continue;
                            }
                            if let Some(percentage) = parse_percentage(&line) {
                                if percentage > last_percentage {
                                    last_percentage = percentage;
                                    let _ = app_handle.emit(
                                        "whisper-model-progress",
                                        WhisperDownloadPayload {
                                            status: format!(
                                                "Downloading {label_for_task} model: {percentage:.0}%"
                                            ),
                                            percentage: Some(percentage),
                                        },
                                    );
                                }
                            } else {
                                tail.push(line);
                                if tail.len() > 20 {
                                    tail.remove(0);
                                }
                            }
                        }
                    } else {
                        buffer.push(byte[0]);
                    }
                }
                Err(_) => break,
            }
        }

        let status = child.wait().context("waiting for whisper download")?;
        if !status.success() {
            return Err(anyhow!(
                "Whisper download failed: {}",
                tail.join(" | ")
            ));
        }

        if !whisper_model_downloaded(&model_for_task) {
            return Err(anyhow!(
                "Whisper finished but the checkpoint for '{}' was not found in {}",
                model_for_task,
                whisper_model_path(&model_for_task).to_string_lossy()
            ));
        }

        Ok(())
    })
    .await
    .context("spawn_blocking failed")??;

    let _ = app.emit(
        "whisper-model-progress",
        WhisperDownloadPayload {
            status: format!("{label} model ready"),
            percentage: Some(100.0),
        },
    );

    Ok(())
}

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

pub fn find_python_command() -> Option<String> {
    // The managed venv wins: it is the only interpreter we control, so it keeps
    // `import whisper` working after system Python upgrades.
    if let Some(python) = crate::python_env::active_python() {
        return Some(python.to_string_lossy().to_string());
    }

    let candidates: &[&str] = if cfg!(windows) {
        &["python", "py", "python3"]
    } else {
        &["python3", "python"]
    };

    for &cmd in candidates {
        if let Ok(out) = std::process::Command::new(cmd).args(["-c", "import whisper"]).output() {
            if out.status.success() {
                return Some(cmd.to_string());
            }
        }
    }
    for &cmd in candidates {
        if std::process::Command::new(cmd).arg("--version").output().is_ok() {
            return Some(cmd.to_string());
        }
    }
    None
}

pub fn whisper_cli_exists() -> bool {
    crate::python_env::active_whisper_cli().is_some()
}

pub fn whisper_python_exists() -> bool {
    crate::python_env::active_python().is_some()
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

/// Callback used to report transcription progress as a 0..=100 percentage.
pub type ProgressCallback = Box<dyn FnMut(f64) + Send>;

/// Parse `HH:MM:SS.mmm` (or `MM:SS.mmm`) into seconds.
fn parse_timestamp_token(token: &str) -> Option<f64> {
    let parts: Vec<&str> = token.trim().split(':').collect();
    match parts.as_slice() {
        [hours, minutes, seconds] => Some(
            hours.parse::<f64>().ok()? * 3600.0
                + minutes.parse::<f64>().ok()? * 60.0
                + seconds.parse::<f64>().ok()?,
        ),
        [minutes, seconds] => Some(
            minutes.parse::<f64>().ok()? * 60.0 + seconds.parse::<f64>().ok()?,
        ),
        [seconds] => seconds.parse::<f64>().ok(),
        _ => None,
    }
}

/// Whisper prints `[00:00:00.000 --> 00:00:05.000] text` for every decoded
/// segment, which gives us a real progress signal without extra tooling.
fn parse_segment_end_sec(line: &str) -> Option<f64> {
    let arrow = line.find("--> ")?;
    let rest = line[arrow + 4..].trim_start();
    let end = rest.split(']').next()?.trim();
    parse_timestamp_token(end)
}

/// Run a whisper process while streaming its stdout, mapping decoded segment
/// timestamps onto a 0..=100 progress value.
fn run_streaming(
    mut cmd: std::process::Command,
    total_duration: Option<f64>,
    on_progress: &mut Option<ProgressCallback>,
) -> Result<(std::process::ExitStatus, String, String)> {
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("starting whisper process")?;

    let stderr_handle = {
        let mut stderr = child.stderr.take().context("capturing whisper stderr")?;
        std::thread::spawn(move || {
            let mut buffer = String::new();
            let _ = stderr.read_to_string(&mut buffer);
            buffer
        })
    };

    let mut stdout_buffer = String::new();
    if let Some(stdout) = child.stdout.take() {
        let mut last_percentage = 0.0_f64;
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            stdout_buffer.push_str(&line);
            stdout_buffer.push('\n');

            if let (Some(total), Some(callback)) = (total_duration, on_progress.as_mut()) {
                if total > 0.0 {
                    if let Some(end) = parse_segment_end_sec(&line) {
                        let percentage = (end / total * 100.0).clamp(0.0, 99.0);
                        if percentage > last_percentage + 0.5 {
                            last_percentage = percentage;
                            callback(percentage);
                        }
                    }
                }
            }
        }
    }

    let status = child.wait().context("waiting for whisper process")?;
    let stderr_buffer = stderr_handle.join().unwrap_or_default();
    Ok((status, stdout_buffer, stderr_buffer))
}

pub async fn transcribe_local(
    audio_path: &str,
    model_dir: &str,
    model_size: &str,
    total_duration: Option<f64>,
    on_progress: Option<ProgressCallback>,
) -> Result<NormalizedTranscript> {
    let audio_path = audio_path.to_string();
    let model_dir = model_dir.to_string();
    let model_size = if model_size.trim().is_empty() {
        "base".to_string()
    } else {
        model_size.trim().to_string()
    };

    // On Windows the `whisper` console script prints every decoded segment to
    // the piped stdout, and that write can raise `OSError [Errno 22] Invalid
    // argument`, aborting the whole transcription. Our generated helper script
    // hardens sys.stdout/sys.stderr against exactly that, so prefer it there.
    if whisper_cli_exists() && !cfg!(windows) {
        let audio_path_buf = std::path::Path::new(&audio_path);
        let audio_dir = audio_path_buf.parent().ok_or_else(|| anyhow!("Invalid audio path parent"))?;
        let audio_stem = audio_path_buf.file_stem().ok_or_else(|| anyhow!("Invalid audio file stem"))?.to_string_lossy();
        
        let output_json_path = audio_dir.join(format!("{}.json", audio_stem));
        let output_json_path_str = output_json_path.to_string_lossy().to_string();
        let audio_dir_str = audio_dir.to_string_lossy().to_string();
        let audio_dir_clone = audio_dir.to_path_buf();
        let audio_stem_clone = audio_stem.to_string();
        let cli_model = model_size.clone();

        tokio::task::spawn_blocking(move || {
            let mut on_progress = on_progress;
            // Only pass a GPU device when PyTorch actually reports one; the CLI
            // fails hard on `--device cuda` when CUDA is unavailable.
            let device = crate::hardware::whisper_device();

            // Resolved once: probing the venv spawns the CLI, which imports
            // torch, so it must not run again for the CPU retry below.
            let whisper_cli = crate::python_env::active_whisper_cli()
                .unwrap_or_else(|| std::path::PathBuf::from("whisper"));

            let build = |device: Option<&str>| {
                let mut cmd = std::process::Command::new(&whisper_cli);
                cmd.arg(&audio_path)
                    .args(["--model", &cli_model])
                    .args(["--output_format", "json"])
                    .args(["--output_dir", &audio_dir_str])
                    .args(["--word_timestamps", "True"])
                    .args(["--verbose", "True"]);
                if let Some(device) = device {
                    cmd.args(["--device", device]);
                }
                // Keep stdout unbuffered so segment timestamps arrive as they are decoded.
                cmd.env("PYTHONUNBUFFERED", "1");
                cmd
            };

            let (mut status, mut stdout, mut stderr) = run_streaming(
                build((device != "cpu").then_some(device)),
                total_duration,
                &mut on_progress,
            )?;

            if !status.success() && device != "cpu" {
                // The `whisper` executable may run under a different interpreter
                // than the one we probed, so let it pick its own device.
                eprintln!(
                    "[autoshorts] whisper --device {device} failed; retrying with the default device"
                );
                let (retry_status, retry_stdout, retry_stderr) =
                    run_streaming(build(None), total_duration, &mut on_progress)?;
                status = retry_status;
                stdout = retry_stdout;
                stderr = retry_stderr;
            }

            if !status.success() {
                return Err(anyhow!("Whisper CLI failed:\nStderr: {}\nStdout: {}", stderr, stdout));
            }

            let json_bytes = std::fs::read(&output_json_path_str).context("reading output transcript JSON from CLI")?;
            let raw_json: serde_json::Value = serde_json::from_slice(&json_bytes).context("parsing output transcript JSON")?;
            
            // Clean up the output JSON file
            let _ = std::fs::remove_file(&output_json_path_str);
            
            // Clean up any extra formats whisper CLI might have written (it sometimes generates them by default)
            for ext in &["txt", "srt", "vtt", "tsv"] {
                let extra_file = audio_dir_clone.join(format!("{}.{}", audio_stem_clone, ext));
                if extra_file.exists() {
                    let _ = std::fs::remove_file(extra_file);
                }
            }

            normalize_whisper_raw_json(raw_json)
        })
        .await
        .context("spawn_blocking failed")?
    } else {
        // Resolve the directory where the model lives. We'll put transcribe.py there.
        let model_dir = std::path::Path::new(&model_dir);

        let script_path = model_dir.join("transcribe.py");
        // Always rewrite the helper script so existing installations pick up
        // the streaming segment output used for progress reporting.
        {
            let script_content = r#"import sys
import json
import whisper


class _SafeStream:
    """Best-effort writer that never aborts transcription.

    whisper prints every decoded segment when verbose=True. On Windows that
    write can raise OSError [Errno 22] "Invalid argument" (closed or
    re-directed console handle), which killed the whole run. Progress output
    is cosmetic, so swallow the error instead of failing.
    """

    def __init__(self, stream):
        self._stream = stream

    def write(self, data):
        try:
            return self._stream.write(data)
        except (OSError, ValueError, UnicodeError):
            return len(data)

    def flush(self):
        try:
            self._stream.flush()
        except (OSError, ValueError):
            pass

    def __getattr__(self, name):
        return getattr(self._stream, name)


def harden_streams():
    for name in ("stdout", "stderr"):
        stream = getattr(sys, name, None)
        if stream is None:
            continue
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
        setattr(sys, name, _SafeStream(stream))


def load_model(model_name, device):
    """Load on the GPU when asked to, falling back to CPU on any failure."""
    if device:
        try:
            return whisper.load_model(model_name, device=device)
        except Exception as exc:
            print(
                f"[autoshorts] device '{device}' unavailable ({exc}); using CPU",
                file=sys.stderr,
            )
    return whisper.load_model(model_name)

def main():
    # Must run before whisper prints anything: a broken stdout/stderr on
    # Windows would otherwise raise OSError mid-transcription.
    harden_streams()

    if len(sys.argv) < 3:
        print("Usage: transcribe.py <audio_path> <output_json_path> [model_name] [device]")
        sys.exit(1)
        
    audio_path = sys.argv[1]
    output_json_path = sys.argv[2]
    model_name = sys.argv[3] if len(sys.argv) > 3 else "base"
    device = sys.argv[4] if len(sys.argv) > 4 else ""
    
    # Load model. Uses the requested GPU device when one was detected
    # (CUDA / Apple MPS), otherwise the default CPU path.
    model = load_model(model_name, device)
    
    # Transcribe with word-level timestamps. verbose=True streams each decoded
    # segment ("[start --> end] text") to stdout, which the Rust side parses
    # into progress updates.
    result = model.transcribe(audio_path, word_timestamps=True, verbose=True)
    
    normalized = {
        "language": result.get("language", "en"),
        "duration": result.get("segments", [])[-1]["end"] if result.get("segments") else 0.0,
        "speakers": ["S1"],
        "words": [],
        "segments": []
    }
    
    for segment in result.get("segments", []):
        normalized["segments"].append({
            "start": segment["start"],
            "end": segment["end"],
            "speaker": "S1",
            "text": segment["text"].strip()
        })
        
        for word in segment.get("words", []):
            cleaned_text = word["word"].strip()
            normalized["words"].append({
                "text": cleaned_text,
                "start": word["start"],
                "end": word["end"],
                "speaker": "S1"
            })
            
    with open(output_json_path, "w", encoding="utf-8") as f:
        json.dump(normalized, f, indent=2, ensure_ascii=False)

if __name__ == "__main__":
    main()
"#;
            std::fs::write(&script_path, script_content).context("writing transcribe.py script")?;
        }

        let output_json_path = model_dir.join(format!("temp_transcript_{}.json", uuid::Uuid::new_v4()));
        let script_path_str = script_path.to_string_lossy().to_string();
        let output_json_path_str = output_json_path.to_string_lossy().to_string();

        // Prefer the checkpoint already downloaded by the app so transcription stays offline.
        let python_model = if whisper_model_downloaded(&model_size) {
            whisper_model_path(&model_size)
                .to_string_lossy()
                .to_string()
        } else {
            model_size.clone()
        };

        tokio::task::spawn_blocking(move || {
            let mut on_progress = on_progress;
            let python_bin = find_python_command().unwrap_or_else(|| "python".to_string());
            // Probed once per process inside this blocking task: importing
            // torch takes a moment, so it must not run on the async runtime.
            let device = crate::hardware::whisper_device_for(Some(&python_bin));
            let mut cmd = std::process::Command::new(&python_bin);
            cmd.arg(&script_path_str)
                .arg(&audio_path)
                .arg(&output_json_path_str)
                .arg(&python_model)
                .arg(device);
            // Keep stdout unbuffered so whisper's segment prints stream live.
            cmd.env("PYTHONUNBUFFERED", "1");

            let (status, stdout, stderr) = run_streaming(cmd, total_duration, &mut on_progress)?;

            if !status.success() {
                return Err(anyhow!("Python transcription script failed:\nStderr: {}\nStdout: {}", stderr, stdout));
            }

            let json_bytes = std::fs::read(&output_json_path_str).context("reading output transcript JSON")?;
            let transcript: NormalizedTranscript = serde_json::from_slice(&json_bytes).context("parsing output transcript JSON")?;
            
            // Cleanup temp file
            let _ = std::fs::remove_file(&output_json_path_str);

            Ok(transcript)
        })
        .await
        .context("spawn_blocking failed")?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn word(text: &str, start: f64, end: f64, speaker: &str) -> TranscriptWord {
        TranscriptWord {
            text: text.to_string(),
            start,
            end,
            speaker: Some(speaker.to_string()),
        }
    }

    #[test]
    fn parses_percentage_from_download_output() {
        assert_eq!(parse_percentage("Downloading 45%"), Some(45.0));
        assert_eq!(parse_percentage("12.5%"), Some(12.5));
        assert_eq!(parse_percentage("100% complete"), Some(100.0));
        assert_eq!(parse_percentage("no percent here"), None);
        assert_eq!(parse_percentage("%"), None);
    }

    #[test]
    fn parses_whisper_timestamps() {
        assert_eq!(parse_timestamp_token("00:00:05.500"), Some(5.5));
        assert_eq!(parse_timestamp_token("00:01:02.500"), Some(62.5));
        assert_eq!(parse_timestamp_token("01:02"), Some(62.0));
        assert_eq!(parse_timestamp_token("5.5"), Some(5.5));
        assert_eq!(parse_timestamp_token("not-a-time"), None);
        assert_eq!(parse_timestamp_token("1:2:3:4"), None);
    }

    #[test]
    fn parses_segment_end_from_whisper_output_line() {
        let line = "[00:00:00.000 --> 00:00:05.500]  hello world";
        assert_eq!(parse_segment_end_sec(line), Some(5.5));
        assert_eq!(parse_segment_end_sec("no timestamps here"), None);
    }

    #[test]
    fn build_segments_returns_empty_for_no_words() {
        assert!(build_segments(&[]).is_empty());
    }

    #[test]
    fn build_segments_joins_words_until_a_break() {
        let words = vec![
            word("Hello", 0.0, 0.5, "S1"),
            word("world.", 0.6, 1.0, "S1"),
            word("Next", 2.0, 2.5, "S1"),
            word("speaker", 2.6, 3.0, "S2"),
            word("here.", 3.1, 3.5, "S2"),
        ];

        let segments = build_segments(&words);
        assert_eq!(segments.len(), 3);
        assert_eq!(segments[0].text, "Hello world.");
        assert_eq!(segments[0].start, 0.0);
        assert_eq!(segments[0].end, 1.0);
        assert_eq!(segments[1].text, "Next");
        assert_eq!(segments[2].text, "speaker here.");
        assert_eq!(segments[2].speaker.as_deref(), Some("S2"));
    }

    #[test]
    fn build_segments_breaks_after_sentence_end() {
        let words = vec![
            word("Done.", 0.0, 0.5, "S1"),
            word("Again", 0.6, 1.0, "S1"),
        ];

        let segments = build_segments(&words);
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].text, "Done.");
        assert_eq!(segments[1].text, "Again");
    }

    #[test]
    fn normalizes_deepgram_response() {
        let value = json!({
            "metadata": { "language": "pt", "duration": 12.5 },
            "results": {
                "channels": [{
                    "alternatives": [{
                        "words": [
                            { "word": "hello", "punctuated_word": "Hello", "start": 0.0, "end": 0.4, "speaker": 0 },
                            { "word": "", "start": 0.4, "end": 0.5, "speaker": 0 },
                            { "word": "world", "start": 0.5, "end": 0.9, "speaker": 1 }
                        ]
                    }]
                }]
            }
        });

        let transcript = normalize_deepgram(value).unwrap();
        assert_eq!(transcript.language, "pt");
        assert_eq!(transcript.duration, 12.5);
        assert_eq!(transcript.words.len(), 2);
        assert_eq!(transcript.words[0].text, "Hello");
        assert_eq!(transcript.speakers, vec!["S1".to_string(), "S2".to_string()]);
        assert!(!transcript.segments.is_empty());
    }

    #[test]
    fn deepgram_response_without_alternative_is_an_error() {
        let value = json!({ "metadata": {} });
        assert!(normalize_deepgram(value).is_err());
    }

    #[test]
    fn deepgram_response_without_words_is_an_error() {
        let value = json!({
            "results": { "channels": [{ "alternatives": [{}] }] }
        });
        assert!(normalize_deepgram(value).is_err());
    }

    #[test]
    fn normalizes_whisper_raw_json() {
        let raw = json!({
            "language": "es",
            "segments": [{
                "start": 0.0,
                "end": 1.5,
                "text": " hola mundo ",
                "words": [
                    { "word": " hola ", "start": 0.0, "end": 0.6 },
                    { "word": " mundo ", "start": 0.6, "end": 1.5 }
                ]
            }]
        });

        let transcript = normalize_whisper_raw_json(raw).unwrap();
        assert_eq!(transcript.language, "es");
        assert_eq!(transcript.duration, 1.5);
        assert_eq!(transcript.segments.len(), 1);
        assert_eq!(transcript.segments[0].text, "hola mundo");
        assert_eq!(transcript.words.len(), 2);
        assert_eq!(transcript.words[1].text, "mundo");
        assert_eq!(transcript.speakers, vec!["S1".to_string()]);
    }

    #[test]
    fn whisper_json_without_segments_is_an_error() {
        assert!(normalize_whisper_raw_json(json!({ "language": "en" })).is_err());
    }

    #[test]
    fn whisper_model_catalog_is_not_empty() {
        assert!(!WHISPER_MODELS.is_empty());
        assert!(list_whisper_models().len() == WHISPER_MODELS.len());
    }
}
