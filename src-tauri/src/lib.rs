pub mod autoedit;
pub mod db;
pub mod hardware;
pub mod llm;
pub mod media;
pub mod media_server;
pub mod models;
pub mod naming;
pub mod progress;
pub mod python_env;
pub mod transcription;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use anyhow::{anyhow, Context, Result};
use tauri::{Emitter, Manager};

use db::Database;
use models::{
    Candidate, CandidateThumbnail, CaptionCue, CaptionStyleOverride, ClipEdit, ClipEditor,
    ClipPreview, EnvironmentStatus, MediaProbe, NormalizedTranscript, Project, ProjectDetail,
    Transcript, TranscriptWord,
};

#[derive(Clone, serde::Serialize)]
struct PullProgressPayload {
    status: String,
    completed: Option<u64>,
    total: Option<u64>,
    percentage: Option<f64>,
}

#[derive(Clone)]
struct AppState {
    db: Database,
    data_dir: PathBuf,
    /// Loopback HTTP server used to hand media files to the webview, which
    /// cannot open Tauri's `asset://` scheme from its media pipeline.
    media_server: media_server::MediaServer,
    /// Per-project preview render slots. The app pre-renders the proxy in the
    /// background and the editor asks for the same file, so both callers must
    /// queue instead of running two ffmpeg jobs on one output path.
    preview_locks: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
}

impl AppState {
    fn preview_lock(&self, project_id: &str) -> Arc<Mutex<()>> {
        let mut locks = self
            .preview_locks
            .lock()
            .expect("preview lock mutex poisoned");
        locks
            .entry(project_id.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }
}

#[tauri::command]
async fn environment_status(state: tauri::State<'_, AppState>) -> Result<EnvironmentStatus, String> {
    let llm_provider = std::env::var("LLM_PROVIDER")
        .unwrap_or_else(|_| "deepseek".to_string())
        .to_lowercase();

    let has_local_whisper_model = transcription::whisper_cli_exists() || transcription::whisper_python_exists();

    let has_ollama = reqwest::Client::new()
        .get("http://localhost:11434")
        .timeout(std::time::Duration::from_millis(1000))
        .send()
        .await
        .is_ok();

    Ok(EnvironmentStatus {
        data_dir: state.data_dir.to_string_lossy().to_string(),
        has_ffmpeg: media::command_exists("ffmpeg"),
        has_ffprobe: media::command_exists("ffprobe"),
        has_deepgram_key: std::env::var("DEEPGRAM_API_KEY").is_ok(),
        has_anthropic_key: std::env::var("ANTHROPIC_API_KEY").is_ok(),
        has_deepseek_key: std::env::var("DEEPSEEK_API_KEY").is_ok(),
        has_gemini_key: std::env::var("GEMINI_API_KEY").is_ok(),
        has_openai_key: std::env::var("OPENAI_API_KEY").is_ok(),
        has_openrouter_key: std::env::var("OPENROUTER_API_KEY").is_ok(),
        has_groq_key: std::env::var("GROQ_API_KEY").is_ok(),
        has_openai_compatible_key: std::env::var("OPENAI_COMPATIBLE_API_KEY").is_ok()
            || std::env::var("OPENAI_API_KEY").is_ok(),
        openai_base_url: std::env::var("OPENAI_BASE_URL")
            .ok()
            .filter(|value| !value.trim().is_empty()),
        llm_provider,
        has_local_whisper_model,
        has_ollama,
        has_ytdlp: media::command_exists("yt-dlp"),
        gpu_accel: hardware::active_video_encoder().is_hardware(),
        video_encoder: hardware::active_video_encoder().label().to_string(),
    })
}

#[tauri::command]
fn python_env_status(state: tauri::State<'_, AppState>) -> python_env::PythonEnvStatus {
    python_env::status(&state.data_dir)
}

/// Provisions the managed venv and installs `openai-whisper` into it. Blocking
/// (pip + a ~1-2 GB PyTorch download), so it runs off the async runtime.
#[tauri::command]
async fn install_python_env(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let data_dir = state.data_dir.clone();
    tokio::task::spawn_blocking(move || python_env::install(&app, &data_dir))
        .await
        .map_err(to_command_error)?
        .map_err(to_command_error)
}

#[tauri::command]
fn list_whisper_models() -> Vec<transcription::WhisperModelInfo> {
    transcription::list_whisper_models()
}

#[tauri::command]
async fn download_whisper_model(app: tauri::AppHandle, model_name: String) -> Result<(), String> {
    transcription::download_whisper_model(app, model_name)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn pull_ollama_model(
    app: tauri::AppHandle,
    model_name: String,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    
    let mut response = client
        .post("http://localhost:11434/api/pull")
        .json(&serde_json::json!({
            "name": model_name,
            "stream": true,
        }))
        .send()
        .await
        .map_err(|e| format!("Failed to connect to Ollama: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Ollama pull returned status {status}: {text}"));
    }

    let mut buffer = String::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        let chunk_str = String::from_utf8_lossy(&chunk);
        buffer.push_str(&chunk_str);

        // Process lines in buffer
        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].trim().to_string();
            buffer = buffer[pos + 1..].to_string();

            if line.is_empty() {
                continue;
            }

            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
                if let Some(err_msg) = val.get("error").and_then(|v| v.as_str()) {
                    return Err(err_msg.to_string());
                }

                let completed = val.get("completed").and_then(|v| v.as_u64());
                let total = val.get("total").and_then(|v| v.as_u64());

                let mut status = val.get("status")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Downloading...")
                    .to_string();

                if status.starts_with("downloading ") {
                    if let (Some(c), Some(t)) = (completed, total) {
                        let c_mb = c as f64 / 1024.0 / 1024.0;
                        let t_mb = t as f64 / 1024.0 / 1024.0;
                        if t_mb > 100.0 {
                            status = format!("Downloading weights: {:.1} MB / {:.1} MB", c_mb, t_mb);
                        } else {
                            status = format!("Downloading model components: {:.1} MB / {:.1} MB", c_mb, t_mb);
                        }
                    } else {
                        status = "Downloading model components...".to_string();
                    }
                }
                
                let percentage = if let (Some(c), Some(t)) = (completed, total) {
                    if t > 0 {
                        Some((c as f64 / t as f64) * 100.0)
                    } else {
                        None
                    }
                } else {
                    None
                };

                let payload = PullProgressPayload {
                    status,
                    completed,
                    total,
                    percentage,
                };

                let _ = app.emit("ollama-pull-progress", payload);
            }
        }
    }

    Ok(())
}

#[tauri::command]
async fn install_ollama(app: tauri::AppHandle) -> Result<(), String> {
    let _ = app.emit("ollama-install-status", "Checking if Ollama is already installed...");
    let launch = std::process::Command::new("open")
        .args(["-a", "Ollama"])
        .output();
    
    if let Ok(out) = launch {
        if out.status.success() {
            let _ = app.emit("ollama-install-status", "Ollama is installed. Launching...");
            for _ in 0..12 {
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                if reqwest::Client::new().get("http://localhost:11434").send().await.is_ok() {
                    let _ = app.emit("ollama-install-status", "Ollama started successfully!");
                    return Ok(());
                }
            }
        }
    }

    let brew_path = if std::path::Path::new("/opt/homebrew/bin/brew").exists() {
        Some("/opt/homebrew/bin/brew")
    } else if std::path::Path::new("/usr/local/bin/brew").exists() {
        Some("/usr/local/bin/brew")
    } else {
        None
    };

    if let Some(path) = brew_path {
        let _ = app.emit("ollama-install-status", "Installing Ollama via Homebrew Cask...");
        
        let output = std::process::Command::new(path)
            .args(["install", "--cask", "ollama"])
            .output()
            .map_err(|e| format!("Failed to run brew command: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            if !stderr.contains("already installed") {
                return Err(format!("Brew install failed: {}", stderr));
            }
        }

        let _ = app.emit("ollama-install-status", "Starting Ollama.app...");
        let launch = std::process::Command::new("open")
            .args(["-a", "Ollama"])
            .output();
        
        if let Ok(out) = launch {
            if out.status.success() {
                for _ in 0..12 {
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                    if reqwest::Client::new().get("http://localhost:11434").send().await.is_ok() {
                        let _ = app.emit("ollama-install-status", "Ollama started successfully!");
                        return Ok(());
                    }
                }
            }
        }
    }

    let _ = app.emit("ollama-install-status", "Downloading Ollama zip from official source...");
    let temp_dir = std::env::temp_dir();
    let zip_path = temp_dir.join("Ollama-darwin.zip");
    
    let response = reqwest::get("https://ollama.com/download/Ollama-darwin.zip")
        .await
        .map_err(|e| format!("Failed to download Ollama: {e}"))?;

    let bytes = response.bytes().await.map_err(|e| format!("Failed to read Ollama bytes: {e}"))?;
    std::fs::write(&zip_path, bytes).map_err(|e| format!("Failed to save Ollama zip: {e}"))?;

    let _ = app.emit("ollama-install-status", "Unzipping Ollama package...");
    let unzip_output = std::process::Command::new("unzip")
        .args(["-o", &zip_path.to_string_lossy().to_string(), "-d", &temp_dir.to_string_lossy().to_string()])
        .output()
        .map_err(|e| format!("Failed to unzip Ollama: {e}"))?;

    if !unzip_output.status.success() {
        return Err(format!("Failed to unzip: {}", String::from_utf8_lossy(&unzip_output.stderr)));
    }

    let _ = app.emit("ollama-install-status", "Installing to Applications folder...");
    let app_src = temp_dir.join("Ollama.app");
    
    let mv_output = std::process::Command::new("mv")
        .args([&app_src.to_string_lossy().to_string(), "/Applications/"])
        .output()
        .map_err(|e| format!("Failed to move Ollama to Applications: {e}"))?;

    if !mv_output.status.success() {
        let user_apps = dirs::home_dir()
            .ok_or_else(|| "Could not find home directory".to_string())?
            .join("Applications");
        std::fs::create_dir_all(&user_apps).map_err(|e| format!("Failed to create ~/Applications: {e}"))?;
        
        let mv_user_output = std::process::Command::new("mv")
            .args([&app_src.to_string_lossy().to_string(), &user_apps.to_string_lossy().to_string()])
            .output()
            .map_err(|e| format!("Failed to move Ollama to ~/Applications: {e}"))?;

        if !mv_user_output.status.success() {
            return Err(format!("Failed to install Ollama to Applications folder: {}", String::from_utf8_lossy(&mv_user_output.stderr)));
        }
    }

    let _ = app.emit("ollama-install-status", "Starting Ollama...");
    let launch = std::process::Command::new("open")
        .args(["-a", "Ollama"])
        .output();

    if launch.is_ok() {
        for _ in 0..12 {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            if reqwest::Client::new().get("http://localhost:11434").send().await.is_ok() {
                let _ = app.emit("ollama-install-status", "Ollama started successfully!");
                return Ok(());
            }
        }
    }

    Err("Ollama installed but could not be automatically started. Please open Ollama from your Applications folder.".to_string())
}

#[tauri::command]
fn create_project_from_path(
    state: tauri::State<'_, AppState>,
    path: String,
    transcription_mode: String,
    caption_style: String,
) -> Result<Project, String> {
    validate_media_extension(&path).map_err(to_command_error)?;
    let probe = media::probe_media(&path).ok();

    state
        .db
        .create_project(
            &path,
            &transcription_mode,
            &caption_style,
            probe.and_then(|probe| probe.duration_sec),
        )
        .map_err(to_command_error)
}

#[tauri::command]
fn list_projects(state: tauri::State<'_, AppState>) -> Result<Vec<Project>, String> {
    state.db.list_projects().map_err(to_command_error)
}

#[tauri::command]
fn get_project_detail(
    state: tauri::State<'_, AppState>,
    project_id: String,
) -> Result<ProjectDetail, String> {
    state
        .db
        .project_detail(&project_id)
        .map_err(to_command_error)
}

#[tauri::command]
fn probe_project(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    project_id: String,
) -> Result<MediaProbe, String> {
    let project = state
        .db
        .get_project(&project_id)
        .map_err(to_command_error)?;
    progress::emit(&app, "import", "Analyzing media…", None);
    let probe = media::probe_media(&project.source_path).map_err(to_command_error)?;
    state
        .db
        .update_project_status(&project_id, "ingest", probe.duration_sec)
        .map_err(to_command_error)?;
    progress::finish(&app, "import", "Media ready");
    Ok(probe)
}

#[tauri::command]
fn extract_project_audio(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    project_id: String,
) -> Result<String, String> {
    let project = state
        .db
        .get_project(&project_id)
        .map_err(to_command_error)?;
    let progress_app = app.clone();
    let audio_path = media::extract_audio(
        &project.source_path,
        &project_dir(&state, &project_id),
        move |percentage| {
            progress::emit(&progress_app, "extract", "Extracting audio…", Some(percentage));
        },
    )
    .map_err(to_command_error)?;
    progress::finish(&app, "extract", "Audio extracted");
    Ok(audio_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn transcribe_project(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    project_id: String,
    provider: String,
    api_key: Option<String>,
    whisper_model: Option<String>,
) -> Result<Transcript, String> {
    let db = state.db.clone();
    let data_dir = state.data_dir.clone();
    let project = db.get_project(&project_id).map_err(to_command_error)?;
    db.update_project_status(&project_id, "transcribing", None)
        .map_err(to_command_error)?;
    let total_duration = media::probe_media(&project.source_path)
        .ok()
        .and_then(|probe| probe.duration_sec);

    let transcript = match provider.as_str() {
        "deepgram" => {
            let key = api_key
                .or_else(|| std::env::var("DEEPGRAM_API_KEY").ok())
                .ok_or_else(|| {
                    "Set DEEPGRAM_API_KEY or paste an API key to use cloud transcription."
                        .to_string()
                })?;
            let extract_app = app.clone();
            let audio_path = media::extract_audio(
                &project.source_path,
                &data_dir.join("projects").join(&project_id),
                move |percentage| {
                    progress::emit(&extract_app, "extract", "Extracting audio…", Some(percentage));
                },
            )
            .map_err(to_command_error)?;
            progress::emit(&app, "transcribe", "Transcribing with Deepgram…", None);
            transcription::transcribe_deepgram(&audio_path.to_string_lossy(), &key)
                .await
                .map_err(to_command_error)?
        }
        "local" => {
            let has_whisper = transcription::whisper_cli_exists() || transcription::whisper_python_exists();
            if !has_whisper {
                return Err("Whisper não está instalado. Abra as configurações e clique em \"Instalar Whisper\" para baixar as dependências Python automaticamente.".to_string());
            }
            let extract_app = app.clone();
            let audio_path = media::extract_audio(
                &project.source_path,
                &data_dir.join("projects").join(&project_id),
                move |percentage| {
                    progress::emit(&extract_app, "extract", "Extracting audio…", Some(percentage));
                },
            )
            .map_err(to_command_error)?;
            let model = whisper_model.unwrap_or_else(|| "base".to_string());
            let transcribe_app = app.clone();
            transcription::transcribe_local(
                &audio_path.to_string_lossy(),
                &data_dir.to_string_lossy(),
                &model,
                total_duration,
                Some(Box::new(move |percentage: f64| {
                    progress::emit(
                        &transcribe_app,
                        "transcribe",
                        "Transcribing audio…",
                        Some(percentage),
                    );
                })),
            )
            .await
            .map_err(to_command_error)?
        }
        other => return Err(format!("Unsupported transcription provider: {other}")),
    };

    progress::finish(&app, "transcribe", "Transcription complete");

    let raw_json = serde_json::to_string_pretty(&transcript).map_err(to_command_error)?;
    let saved = db
        .save_transcript(
            &project_id,
            &provider,
            &raw_json,
            Some(&transcript.language),
        )
        .map_err(to_command_error)?;
    db.update_project_status(&project_id, "analyzing", Some(transcript.duration))
        .map_err(to_command_error)?;
    Ok(saved)
}

#[tauri::command]
fn save_demo_transcript(
    state: tauri::State<'_, AppState>,
    project_id: String,
) -> Result<Transcript, String> {
    let transcript = demo_transcript();
    let raw_json = serde_json::to_string_pretty(&transcript).map_err(to_command_error)?;
    let saved = state
        .db
        .save_transcript(&project_id, "demo", &raw_json, Some(&transcript.language))
        .map_err(to_command_error)?;
    state
        .db
        .update_project_status(&project_id, "analyzing", Some(transcript.duration))
        .map_err(to_command_error)?;
    Ok(saved)
}

#[tauri::command]
async fn generate_candidates(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    project_id: String,
    api_key: Option<String>,
    provider: Option<String>,
    model_name: Option<String>,
    base_url: Option<String>,
    _allow_demo: bool,
) -> Result<Vec<Candidate>, String> {
    let db = state.db.clone();
    progress::emit(&app, "moments", "Finding viral moments…", None);
    let transcript = db
        .latest_transcript(&project_id)
        .map_err(to_command_error)?
        .ok_or_else(|| "Transcribe the project before detecting moments.".to_string())?;
    let normalized: NormalizedTranscript =
        serde_json::from_str(&transcript.raw_json).map_err(to_command_error)?;

    let active_provider = provider
        .or_else(|| std::env::var("LLM_PROVIDER").ok())
        .unwrap_or_else(|| "deepseek".to_string())
        .to_lowercase();

    let drafts = match active_provider.as_str() {
        "claude" => {
            let key = api_key
                .or_else(|| std::env::var("ANTHROPIC_API_KEY").ok())
                .ok_or_else(|| "Set ANTHROPIC_API_KEY or supply Claude API Key to generate candidates.".to_string())?;
            llm::detect_candidates_with_claude(&normalized, &key)
                .await
                .map_err(to_command_error)?
        }
        "local" | "ollama" => {
            let model = model_name
                .or_else(|| std::env::var("OLLAMA_MODEL").ok())
                .unwrap_or_else(|| "llama3.2".to_string());
            llm::detect_candidates_with_local_llm(&normalized, &model)
                .await
                .map_err(to_command_error)?
        }
        "gemini" => {
            let key = api_key
                .or_else(|| std::env::var("GEMINI_API_KEY").ok())
                .ok_or_else(|| "Set GEMINI_API_KEY or supply Gemini API Key to generate candidates.".to_string())?;
            llm::detect_candidates_with_gemini(&normalized, &key)
                .await
                .map_err(to_command_error)?
        }
        "openai" => {
            let key = api_key
                .or_else(|| std::env::var("OPENAI_API_KEY").ok())
                .ok_or_else(|| "Set OPENAI_API_KEY or supply OpenAI API Key to generate candidates.".to_string())?;
            llm::detect_candidates_with_openai(&normalized, &key)
                .await
                .map_err(to_command_error)?
        }
        "openrouter" => {
            let key = api_key
                .or_else(|| std::env::var("OPENROUTER_API_KEY").ok())
                .ok_or_else(|| "Set OPENROUTER_API_KEY or supply OpenRouter API Key to generate candidates.".to_string())?;
            llm::detect_candidates_with_openrouter(&normalized, &key, model_name.as_deref())
                .await
                .map_err(to_command_error)?
        }
        "groq" => {
            let key = api_key
                .or_else(|| std::env::var("GROQ_API_KEY").ok())
                .ok_or_else(|| "Set GROQ_API_KEY or supply Groq API Key to generate candidates.".to_string())?;
            llm::detect_candidates_with_groq(&normalized, &key)
                .await
                .map_err(to_command_error)?
        }
        "openai-compatible" | "openai_compatible" | "compatible" | "custom" => {
            // API keys are optional here: local servers (LM Studio, vLLM, llama.cpp) usually need none.
            let key = api_key
                .or_else(|| std::env::var("OPENAI_COMPATIBLE_API_KEY").ok())
                .or_else(|| std::env::var("OPENAI_API_KEY").ok())
                .filter(|value| !value.trim().is_empty());
            llm::detect_candidates_with_openai_compatible(
                &normalized,
                key.as_deref(),
                model_name.as_deref(),
                base_url.as_deref(),
            )
            .await
            .map_err(to_command_error)?
        }
        _ => {
            let key = api_key
                .or_else(|| std::env::var("DEEPSEEK_API_KEY").ok())
                .ok_or_else(|| "Set DEEPSEEK_API_KEY or supply DeepSeek API Key to generate candidates.".to_string())?;
            llm::detect_candidates_with_deepseek(&normalized, &key, model_name.as_deref())
                .await
                .map_err(to_command_error)?
        }
    };

    if drafts.is_empty() {
        return Err("No viable clip candidates were returned for this transcript.".to_string());
    }

    let candidates = db
        .replace_candidates(&project_id, &drafts)
        .map_err(to_command_error)?;
    db.update_project_status(&project_id, "ready", None)
        .map_err(to_command_error)?;
    progress::finish(&app, "moments", "Viral moments ready");
    Ok(candidates)
}

#[tauri::command]
fn set_selected_clip_count(
    state: tauri::State<'_, AppState>,
    project_id: String,
    count: usize,
) -> Result<Vec<Candidate>, String> {
    state
        .db
        .set_selected_clip_count(&project_id, count.clamp(0, 10))
        .map_err(to_command_error)
}

#[tauri::command]
fn get_clip_editor(
    state: tauri::State<'_, AppState>,
    candidate_id: String,
) -> Result<ClipEditor, String> {
    let (candidate, project) = state
        .db
        .get_candidate_with_project(&candidate_id)
        .map_err(to_command_error)?;
    let edit = state
        .db
        .clip_edit(&candidate_id)
        .map_err(to_command_error)?
        .unwrap_or_else(|| ClipEdit::default_for(&candidate_id));

    // Saved cues win; otherwise fall back to auto cues from the transcript.
    let cues = if edit.captions.is_empty() {
        auto_caption_cues(&state.db, &candidate).unwrap_or_default()
    } else {
        edit.captions.clone()
    };

    let caption_style = edit
        .caption_style
        .clone()
        .or_else(|| project.caption_style.clone())
        .filter(|style| !style.trim().is_empty())
        .unwrap_or_else(|| "modern-box".to_string());

    let probe = media::probe_media(&project.source_path).ok();

    Ok(ClipEditor {
        candidate,
        source_path: project.source_path,
        edit,
        cues,
        caption_style,
        source_width: probe.as_ref().and_then(|probe| probe.width),
        source_height: probe.as_ref().and_then(|probe| probe.height),
        source_duration_sec: probe
            .as_ref()
            .and_then(|probe| probe.duration_sec)
            .or(project.source_duration),
        source_video_codec: probe.as_ref().and_then(|probe| probe.video_codec.clone()),
        source_audio_codec: probe.as_ref().and_then(|probe| probe.audio_codec.clone()),
    })
}

/// Produce (and cache) a VP8/Opus proxy of the whole project source.
///
/// The editor needs a moving picture before the cut, but webviews only decode
/// the codecs their platform ships: WebKitGTK on a stock Linux install has no
/// H.264/AAC decoder, so an MP4 source renders a black frame.
///
/// One proxy per project serves every candidate: the editor seeks to the clip
/// start inside it instead of waiting for a per-clip transcode. The returned
/// URL goes through the loopback media server because WebKitGTK's media
/// pipeline cannot open Tauri's `asset://` scheme.
#[tauri::command]
async fn prepare_project_preview(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    project_id: String,
) -> Result<ClipPreview, String> {
    let db = state.db.clone();
    let data_dir = state.data_dir.clone();
    let server = state.media_server.clone();
    let job = state.preview_lock(&project_id);

    tokio::task::spawn_blocking(move || {
        let project = db.get_project(&project_id).map_err(to_command_error)?;

        let duration = media::probe_media(&project.source_path)
            .ok()
            .and_then(|probe| probe.duration_sec)
            .unwrap_or(0.0);

        let previews_dir = data_dir.join("projects").join(&project.id).join("previews");
        let output_path = previews_dir.join("source.webm");

        // A background pre-render may already own this project: wait for it
        // instead of transcoding the same file twice.
        let _guard = job.lock().expect("preview job mutex poisoned");

        if !output_path.is_file() {
            let label = "Preparando pré-visualização…";
            progress::emit(&app, "preview", label, Some(0.0));
            media::render_preview_proxy(
                &project.source_path,
                &output_path,
                Some(duration),
                |percentage| progress::emit(&app, "preview", label, Some(percentage)),
            )
            .map_err(|error| error.to_string())?;
            progress::finish(&app, "preview", label);
        }

        Ok(output_path)
    })
    .await
    .map_err(|error| error.to_string())?
    .map(|path| {
        let url = server.url_for(&path);
        ClipPreview {
            path: path.to_string_lossy().to_string(),
            url,
            start_sec: 0.0,
            end_sec: 0.0,
        }
    })
}

/// Produce (and cache) one still frame per candidate for the clip list.
///
/// The list used to show a grey `9:16` placeholder; a real frame at 35% of the
/// window makes moments recognisable at a glance. Frames are cached on disk
/// and re-rendered only when the clip window moves.
#[tauri::command]
async fn prepare_project_thumbnails(
    state: tauri::State<'_, AppState>,
    project_id: String,
) -> Result<Vec<CandidateThumbnail>, String> {
    let db = state.db.clone();
    let data_dir = state.data_dir.clone();
    let server = state.media_server.clone();

    tokio::task::spawn_blocking(move || {
        let project = db.get_project(&project_id).map_err(to_command_error)?;
        let candidates = db.list_candidates(&project_id).map_err(to_command_error)?;
        let thumbs_dir = data_dir
            .join("projects")
            .join(&project.id)
            .join("thumbs");
        std::fs::create_dir_all(&thumbs_dir).map_err(|error| error.to_string())?;

        let mut thumbnails = Vec::with_capacity(candidates.len());
        for candidate in candidates {
            let span = (candidate.end_sec - candidate.start_sec).max(0.0);
            let time_sec = candidate.start_sec + span * 0.35;
            let path = thumbs_dir.join(format!("{}.jpg", candidate.id));
            let cached = path
                .metadata()
                .map(|meta| meta.len() > 0)
                .unwrap_or(false);
            if !cached {
                if let Err(error) = media::render_thumbnail(&project.source_path, time_sec, &path) {
                    eprintln!(
                        "[thumbnails] skipping {}: {error}",
                        candidate.id
                    );
                    continue;
                }
            }
            let url = server.url_for(&path);
            thumbnails.push(CandidateThumbnail {
                candidate_id: candidate.id,
                path: path.to_string_lossy().to_string(),
                url,
                time_sec,
            });
        }

        Ok(thumbnails)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Copy one clip's caption look onto every candidate of the project.
///
/// Repeating the same font, colours and box settings on ten clips by hand is
/// busywork, so the editor offers a single "apply to all" action. Candidates
/// without a saved edit get one, which also keeps the list badge in sync.
#[tauri::command]
fn apply_caption_style_to_project(
    state: tauri::State<'_, AppState>,
    project_id: String,
    caption_style: Option<String>,
    caption_override: Option<CaptionStyleOverride>,
) -> Result<Vec<ClipEdit>, String> {
    let candidates = state
        .db
        .list_candidates(&project_id)
        .map_err(to_command_error)?;

    let mut saved = Vec::with_capacity(candidates.len());
    for candidate in candidates {
        let mut edit = state
            .db
            .clip_edit(&candidate.id)
            .map_err(to_command_error)?
            .unwrap_or_else(|| ClipEdit::default_for(&candidate.id));
        edit.caption_style = caption_style.clone();
        edit.caption_override = caption_override.clone();
        saved.push(
            state
                .db
                .save_clip_edit(&edit)
                .map_err(to_command_error)?,
        );
    }

    Ok(saved)
}

/// Move a candidate's clip window, so a cut can be stretched over a whole
/// sentence instead of stopping mid-word.
#[tauri::command]
fn update_candidate_range(
    state: tauri::State<'_, AppState>,
    candidate_id: String,
    start_sec: f64,
    end_sec: f64,
) -> Result<Candidate, String> {
    let candidate = state
        .db
        .update_candidate_range(&candidate_id, start_sec, end_sec)
        .map_err(to_command_error)?;

    // The cached frame was taken inside the old window; drop it so the list
    // re-renders the thumbnail on its next pass.
    let _ = std::fs::remove_file(
        state
            .data_dir
            .join("projects")
            .join(&candidate.project_id)
            .join("thumbs")
            .join(format!("{}.jpg", candidate.id)),
    );

    Ok(candidate)
}

/// Re-derive transcript captions for an arbitrary window, used when the user
/// stretches a clip and wants the lines that now fall inside it.
#[tauri::command]
fn caption_cues_for_range(
    state: tauri::State<'_, AppState>,
    project_id: String,
    start_sec: f64,
    end_sec: f64,
) -> Result<Vec<CaptionCue>, String> {
    let Some(record) = state
        .db
        .latest_transcript(&project_id)
        .map_err(to_command_error)?
    else {
        return Ok(Vec::new());
    };
    let normalized: NormalizedTranscript =
        serde_json::from_str(&record.raw_json).map_err(|error| error.to_string())?;
    Ok(cues_from_words(&normalized.words, start_sec, end_sec))
}

#[tauri::command]
fn save_clip_edit(state: tauri::State<'_, AppState>, edit: ClipEdit) -> Result<ClipEdit, String> {
    state.db.save_clip_edit(&edit).map_err(to_command_error)
}

/// Derive editor cues from the latest transcript, three words per line.
fn auto_caption_cues(db: &Database, candidate: &Candidate) -> Result<Vec<CaptionCue>> {
    let Some(record) = db.latest_transcript(&candidate.project_id)? else {
        return Ok(Vec::new());
    };
    let normalized: NormalizedTranscript = serde_json::from_str(&record.raw_json)?;
    Ok(cues_from_words(
        &normalized.words,
        candidate.start_sec,
        candidate.end_sec,
    ))
}

/// Chunk transcript words into absolute-time cues inside the clip window.
fn cues_from_words(words: &[TranscriptWord], start_sec: f64, end_sec: f64) -> Vec<CaptionCue> {
    words
        .iter()
        .filter(|word| word.end > start_sec && word.start < end_sec)
        .collect::<Vec<_>>()
        .chunks(3)
        .filter_map(|chunk| {
            let first = chunk.first()?;
            let last = chunk.last()?;
            let start = first.start.max(start_sec);
            let end = last.end.min(end_sec);
            if end <= start {
                return None;
            }
            Some(CaptionCue {
                start,
                end,
                text: chunk
                    .iter()
                    .map(|word| word.text.as_str())
                    .collect::<Vec<_>>()
                    .join(" "),
            })
        })
        .collect()
}

#[tauri::command]
async fn render_flat_clip_for_candidate(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    candidate_id: String,
) -> Result<String, String> {
    let db = state.db.clone();
    let data_dir = state.data_dir.clone();

    tokio::task::spawn_blocking(move || {
        let (candidate, project) = db
            .get_candidate_with_project(&candidate_id)
            .map_err(to_command_error)?;
        let edit = db
            .clip_edit(&candidate_id)
            .map_err(to_command_error)?
            .unwrap_or_else(|| ClipEdit::default_for(&candidate_id));
        db
            .update_clip_for_candidate(&candidate_id, "cutting", None, None, None)
            .map_err(to_command_error)?;
        let clip_label = format!("Rendering clip #{}…", candidate.rank);
        progress::emit(&app, "cut", clip_label.clone(), Some(0.0));

        let output_path = match documents_project_dir(&project) {
            Ok(dir) => {
                let clips_dir = dir.join("clips");
                // Name the file after the project, the clip rank and the hook
                // so the exported videos are identifiable outside the app.
                // A renamed project wins over the source file stem.
                let project_label = project
                    .name
                    .as_deref()
                    .map(str::trim)
                    .filter(|name| !name.is_empty())
                    .map(str::to_string)
                    .unwrap_or_else(|| project_output_slug(&project));
                let file_name = naming::clip_file_name(
                    &project_label,
                    candidate.rank,
                    &candidate.hook,
                    candidate.start_sec,
                    candidate.end_sec,
                );
                // Deterministic name on purpose: re-cutting a clip replaces its
                // previous render instead of piling up `-2`, `-3` duplicates.
                clips_dir.join(file_name)
            }
            Err(error) => {
                // Surface the failure as a clip error instead of leaving the
                // candidate stuck in `cutting` with a frozen 0% bar.
                let _ = db.update_clip_for_candidate(&candidate_id, "error", None, None, Some(&error));
                return Err(error);
            }
        };

        let mut caption_ass_path: Option<std::path::PathBuf> = None;

        // Probe once and reuse the result for the whole render.
        let probe = media::probe_media(&project.source_path).ok();
        let has_video = probe.as_ref().map(|probe| probe.has_video).unwrap_or(true);
        let has_audio = probe
            .as_ref()
            .map(|probe| probe.audio_codec.is_some())
            .unwrap_or(true);

        let caption_style = edit
            .caption_style
            .clone()
            .or_else(|| project.caption_style.clone())
            .unwrap_or_else(|| "modern-box".to_string());
        let project_data_dir = data_dir.join("projects").join(&project.id);
        let _ = std::fs::create_dir_all(&project_data_dir);

        // The transcript feeds both the caption text and the auto-edit speech
        // map, so parse it once.
        let normalized = db
            .latest_transcript(&project.id)
            .ok()
            .flatten()
            .and_then(|record| serde_json::from_str::<NormalizedTranscript>(&record.raw_json).ok());

        // Auto-edit is opt-in per clip. A failure (missing ffmpeg, unreadable
        // source) degrades to the normal render instead of losing the clip.
        let auto_edit_plan = edit
            .auto_edit
            .clone()
            .filter(|settings| settings.enabled)
            .and_then(|settings| {
                let words = normalized
                    .as_ref()
                    .map(|transcript| transcript.words.as_slice())
                    .unwrap_or(&[]);
                match autoedit::build_plan(
                    &project.source_path,
                    candidate.start_sec,
                    candidate.end_sec,
                    &settings,
                    words,
                ) {
                    Ok(plan) if !plan.is_noop() => Some(plan),
                    Ok(_) => None,
                    Err(error) => {
                        eprintln!("[autoshorts] auto-edit skipped: {error}");
                        None
                    }
                }
            });

        // Captions authored in the editor win; otherwise derive them from the
        // latest transcript exactly like before. With auto-edit the cues are
        // rewritten onto the compressed timeline and the ASS window becomes
        // `0..output_duration`.
        let mut cues: Vec<CaptionCue> = if !edit.captions.is_empty() {
            edit.captions.clone()
        } else {
            normalized
                .as_ref()
                .map(|transcript| {
                    cues_from_words(&transcript.words, candidate.start_sec, candidate.end_sec)
                })
                .unwrap_or_default()
        };
        let (caption_start, caption_end) = match auto_edit_plan.as_ref() {
            Some(plan) => {
                cues = autoedit::remap_cues(&cues, plan);
                (0.0, plan.output_duration)
            }
            None => (candidate.start_sec, candidate.end_sec),
        };

        let ass_content = if cues.is_empty() {
            None
        } else {
            // Plain-text sidecar kept for the UI / upload metadata.
            let srt_content = generate_srt_from_cues(&cues, caption_start, caption_end);
            let clip_srt_path = project_data_dir.join(format!("clip-{}.srt", candidate.id));
            let _ = std::fs::write(&clip_srt_path, srt_content);

            // One ASS file replaces the previous drawtext chain: ffmpeg
            // evaluates a single `ass` filter per frame.
            Some(build_ass_captions_from_cues(
                &cues,
                caption_start,
                caption_end,
                &caption_style,
                edit.caption_override.as_ref(),
            ))
        };

        if let Some(ass_content) = ass_content {
            let clip_ass_path =
                project_data_dir.join(format!("clip-{:02}_captions.ass", candidate.rank));
            if std::fs::write(&clip_ass_path, ass_content).is_ok() {
                caption_ass_path = Some(clip_ass_path);
            }
        }

        let segments: &[autoedit::RenderSegment] = auto_edit_plan
            .as_ref()
            .map(|plan| plan.segments.as_slice())
            .unwrap_or(&[]);

        let request = media::ClipRenderRequest {
            source_path: &project.source_path,
            start_sec: candidate.start_sec,
            end_sec: candidate.end_sec,
            output_path: &output_path,
            has_video,
            has_audio,
            ass_path: caption_ass_path.as_deref(),
            aspect_ratio: &edit.aspect_ratio,
            crop_x: edit.crop_x,
            crop_y: edit.crop_y,
            segments,
        };

        match media::render_flat_clip(&request, |percentage| {
            progress::emit(&app, "cut", clip_label.clone(), Some(percentage));
        }) {
            Ok(path) => {
                let path_string = path.to_string_lossy().to_string();
                let ass_string = caption_ass_path
                    .as_ref()
                    .map(|p| p.to_string_lossy().to_string());
                db
                    .update_clip_for_candidate(
                        &candidate_id,
                        "done",
                        Some(&path_string),
                        ass_string.as_deref(),
                        None,
                    )
                    .map_err(to_command_error)?;
                progress::finish(&app, "cut", clip_label.clone());
                Ok(path_string)
            }
            Err(error) => {
                let err_msg = error.to_string();
                // Only retry without captions when captions were actually used:
                // re-rendering blindly doubled the work on every failure.
                if caption_ass_path.is_none() {
                    db
                        .update_clip_for_candidate(&candidate_id, "error", None, None, Some(&err_msg))
                        .map_err(to_command_error)?;
                    return Err(err_msg);
                }

                let fallback = media::ClipRenderRequest {
                    ass_path: None,
                    ..request
                };
                match media::render_flat_clip(&fallback, |percentage| {
                    progress::emit(&app, "cut", clip_label.clone(), Some(percentage));
                }) {
                    Ok(path) => {
                        let path_string = path.to_string_lossy().to_string();
                        let warning_msg = format!(
                            "Clip rendered successfully, but captions were skipped. Error: {}",
                            err_msg
                        );
                        db
                            .update_clip_for_candidate(
                                &candidate_id,
                                "done",
                                Some(&path_string),
                                None,
                                Some(&warning_msg),
                            )
                            .map_err(to_command_error)?;
                        progress::finish(&app, "cut", clip_label.clone());
                        Ok(path_string)
                    }
                    Err(retry_err) => {
                        let message = retry_err.to_string();
                        db
                            .update_clip_for_candidate(&candidate_id, "error", None, None, Some(&message))
                            .map_err(to_command_error)?;
                        Err(message)
                    }
                }
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn delete_project(state: tauri::State<'_, AppState>, project_id: String) -> Result<(), String> {
    state.db.delete_project(&project_id).map_err(to_command_error)
}

#[tauri::command]
fn rename_project(
    state: tauri::State<'_, AppState>,
    project_id: String,
    name: String,
) -> Result<(), String> {
    state.db.rename_project(&project_id, &name).map_err(to_command_error)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = dotenvy::dotenv();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .context("resolving app data directory")?;
            std::fs::create_dir_all(&data_dir).context("creating app data directory")?;
            std::fs::create_dir_all(data_dir.join("models")).context("creating models directory")?;
            // Registered before anything can probe for Whisper: the managed
            // venv is what transcription should prefer over system Python.
            python_env::register_venv_dir(&data_dir);
            let db = Database::open(&data_dir.join("autoshorts.sqlite"))?;
            let media_server =
                media_server::MediaServer::start().context("starting the media server")?;
            app.manage(AppState {
                db,
                data_dir,
                media_server,
                preview_locks: Arc::new(Mutex::new(HashMap::new())),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            environment_status,
            list_whisper_models,
            download_whisper_model,
            pull_ollama_model,
            install_ollama,
            create_project_from_path,
            list_projects,
            get_project_detail,
            probe_project,
            extract_project_audio,
            transcribe_project,
            save_demo_transcript,
            generate_candidates,
            set_selected_clip_count,
            get_clip_editor,
            save_clip_edit,
            apply_caption_style_to_project,
            update_candidate_range,
            caption_cues_for_range,
            prepare_project_preview,
            prepare_project_thumbnails,
            render_flat_clip_for_candidate,
            delete_project,
            rename_project,
            check_youtube_copyright,
            download_youtube_video,
            python_env_status,
            install_python_env
        ])
        .run(tauri::generate_context!())
        .expect("error while running AutoShorts");
}

#[derive(serde::Serialize)]
pub struct CopyrightCheckResult {
    is_safe: bool,
    license: Option<String>,
}

#[tauri::command]
async fn check_youtube_copyright(url: String) -> Result<CopyrightCheckResult, String> {
    tokio::task::spawn_blocking(move || {
        let output = std::process::Command::new("yt-dlp")
            .args(&["--dump-json", &url])
            .output()
            .map_err(|e| format!("Failed to run yt-dlp: {}", e))?;

        if !output.status.success() {
            return Err("Failed to fetch video metadata from YouTube.".to_string());
        }

        let json_str = String::from_utf8_lossy(&output.stdout);
        let parsed: serde_json::Value = serde_json::from_str(&json_str).map_err(|_| "Failed to parse yt-dlp output".to_string())?;

        let license = parsed.get("license").and_then(|v| v.as_str()).map(|s| s.to_string());
        
        let is_safe = if let Some(lic) = &license {
            lic.to_lowercase().contains("creative commons") || lic.to_lowercase().contains("reuse allowed")
        } else {
            false
        };

        Ok(CopyrightCheckResult { is_safe, license })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn download_youtube_video(app: tauri::AppHandle, url: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        progress::emit(&app, "youtube", "Downloading video…", None);
        let downloads_dir = dirs::download_dir()
            .ok_or_else(|| "Could not find Downloads folder".to_string())?;
        
        let output_template = downloads_dir.join("AutoShorts_%(id)s.%(ext)s");
        let output_template_str = output_template.to_string_lossy().to_string();

        let output = std::process::Command::new("yt-dlp")
            .args(&[
                "--format", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
                "--merge-output-format", "mp4",
                "-o", &output_template_str,
                "--print", "after_move:filepath",
                "--no-simulate",
                &url
            ])
            .output()
            .map_err(|e| format!("Failed to run yt-dlp: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("yt-dlp failed: {}", stderr));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let filepath = stdout.lines().last().unwrap_or("").trim();

        if filepath.is_empty() || !std::path::Path::new(filepath).exists() {
            return Err("Could not locate downloaded file".to_string());
        }

        progress::finish(&app, "youtube", "Download complete");
        Ok(filepath.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn project_dir(state: &AppState, project_id: &str) -> PathBuf {
    state.data_dir.join("projects").join(project_id)
}

fn documents_project_dir(project: &Project) -> Result<PathBuf, String> {
    // Minimal Linux/WSL setups ship without `~/Documents` and without
    // `~/.config/user-dirs.dirs`, so `dirs::document_dir()` returns `None`.
    // Failing here aborted the render right after the 0% progress event.
    let base = dirs::document_dir()
        .or_else(|| {
            let candidate = dirs::home_dir()?.join("Documents");
            std::fs::create_dir_all(&candidate).ok()?;
            Some(candidate)
        })
        .or_else(|| {
            let fallback = dirs::data_dir()?;
            std::fs::create_dir_all(&fallback).ok()?;
            Some(fallback)
        })
        .ok_or_else(|| "Could not find a folder to write clips to.".to_string())?;

    Ok(base.join("AutoShorts").join(project_output_slug(project)))
}

fn project_output_slug(project: &Project) -> String {
    let stem = std::path::Path::new(&project.source_path)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(&project.id);
    let slug = stem
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();

    if slug.is_empty() {
        project.id.clone()
    } else {
        slug
    }
}

fn validate_media_extension(path: &str) -> Result<()> {
    let extension = std::path::Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .ok_or_else(|| anyhow!("Selected file does not have an extension"))?;

    let allowed = ["mp4", "mov", "mp3", "wav", "m4a"];
    if allowed.contains(&extension.as_str()) {
        Ok(())
    } else {
        Err(anyhow!(
            "Unsupported file type .{extension}. Use mp4, mov, mp3, wav, or m4a."
        ))
    }
}

fn demo_transcript() -> NormalizedTranscript {
    let lines = [
        "The surprising thing about short-form clips is that the best moment is rarely the loudest moment.",
        "It is usually the point where someone finally says the quiet part plainly and the listener can feel the stakes.",
        "That is why the system needs to understand the transcript as a story, not just search for keywords.",
        "A good clip opens with tension, resolves one idea, and ends before the energy leaks away.",
        "If you can rank those moments consistently, the rendering pipeline becomes much easier to trust.",
        "The creator still decides what represents them, but the machine removes the first exhausting pass through hours of footage.",
        "The goal is not to automate taste completely. The goal is to give taste a faster starting point.",
        "Once the strongest moments are visible, captions and platform copy become finishing work instead of discovery work.",
        "That is the workflow AutoShorts is designed around.",
    ];

    let mut words = Vec::new();
    let mut cursor = 0.0;
    for line in lines {
        for token in line.split_whitespace() {
            let clean = token.to_string();
            let end = cursor + 0.32;
            words.push(TranscriptWord {
                text: clean,
                start: cursor,
                end,
                speaker: Some("A".to_string()),
            });
            cursor = end + 0.08;
        }
        cursor += 0.75;
    }

    let segments = transcription::build_segments(&words);

    NormalizedTranscript {
        language: "en".to_string(),
        duration: cursor,
        speakers: vec!["A".to_string()],
        words,
        segments,
    }
}

fn to_command_error(error: impl Into<anyhow::Error>) -> String {
    let error = error.into();
    // `Display` on an `anyhow::Error` prints only the outermost context, so the
    // user would just see "calling X" with no cause. Walk the chain instead.
    let mut message = error.to_string();
    for cause in error.chain().skip(1) {
        let text = cause.to_string();
        if text.is_empty() || message.contains(&text) {
            continue;
        }
        message.push_str(": ");
        message.push_str(&text);
    }
    message
}

#[cfg(test)]
fn generate_srt(words: &[TranscriptWord], start_sec: f64, end_sec: f64) -> String {
    let mut srt = String::new();
    let mut index = 1;

    let candidate_words: Vec<&TranscriptWord> = words
        .iter()
        .filter(|w| w.end > start_sec && w.start < end_sec)
        .collect();

    for chunk in candidate_words.chunks(3) {
        if chunk.is_empty() {
            continue;
        }
        let first = chunk[0];
        let last = chunk[chunk.len() - 1];

        let start_rel = (first.start - start_sec).max(0.0);
        let end_rel = (last.end - start_sec).min(end_sec - start_sec).max(0.0);

        let text = chunk
            .iter()
            .map(|w| w.text.as_str())
            .collect::<Vec<_>>()
            .join(" ");

        srt.push_str(&format!("{index}\n"));
        srt.push_str(&format!(
            "{}\n",
            format_srt_time(start_rel, end_rel)
        ));
        srt.push_str(&format!("{text}\n\n"));
        index += 1;
    }

    srt
}

/// Serialize already-chunked cues as SRT, rebased onto `start_sec`. Cues are
/// absolute before the auto-edit remap and 0-based after it, so both paths run
/// through this helper.
fn generate_srt_from_cues(cues: &[CaptionCue], start_sec: f64, end_sec: f64) -> String {
    let mut srt = String::new();
    let mut index = 1;

    for cue in cues {
        let start_rel = (cue.start - start_sec).max(0.0);
        let end_rel = (cue.end - start_sec).min(end_sec - start_sec).max(0.0);
        if end_rel <= start_rel {
            continue;
        }
        srt.push_str(&format!("{index}\n"));
        srt.push_str(&format!("{}\n", format_srt_time(start_rel, end_rel)));
        srt.push_str(&format!("{}\n\n", cue.text.trim()));
        index += 1;
    }

    srt
}

fn format_srt_time(start: f64, end: f64) -> String {
    let format_time = |secs: f64| {
        let hours = (secs / 3600.0) as u32;
        let mins = ((secs % 3600.0) / 60.0) as u32;
        let secs_only = (secs % 60.0) as u32;
        let ms = ((secs.fract()) * 1000.0) as u32;
        format!("{hours:02}:{mins:02}:{secs_only:02},{ms:03}")
    };
    format!("{} --> {}", format_time(start), format_time(end))
}

/// ASS timestamps use `H:MM:SS.cc`.
fn format_ass_time(seconds: f64) -> String {
    let total = seconds.max(0.0);
    let hours = (total / 3600.0) as u32;
    let minutes = ((total % 3600.0) / 60.0) as u32;
    let secs = total % 60.0;
    format!("{hours}:{minutes:02}:{secs:05.2}")
}

/// Pick a font family that ships with the OS; libass falls back to its own
/// default when the family is missing.
fn caption_font_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "Segoe UI"
    } else if cfg!(target_os = "macos") {
        "Avenir Next"
    } else {
        "DejaVu Sans"
    }
}

/// Resolved ASS style for the caption line, after preset + user overrides.
struct AssCaptionStyle {
    font_family: String,
    font_size: f64,
    primary_colour: String,
    outline_colour: String,
    back_colour: String,
    border_style: u8,
    outline: f64,
    shadow: f64,
    bold: bool,
    margin_v: i64,
    margin_lr: i64,
}

/// ASS canvas the styles are authored against; libass scales it to the clip.
const ASS_CANVAS_WIDTH: f64 = 1080.0;
const ASS_CANVAS_HEIGHT: f64 = 1920.0;

/// Convert `#RRGGBB` into ASS `&HAABBGGRR`.
fn ass_colour(hex: &str, alpha: u8) -> Option<String> {
    let hex = hex.trim().trim_start_matches('#');
    if hex.len() != 6 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let red = &hex[0..2];
    let green = &hex[2..4];
    let blue = &hex[4..6];
    Some(format!("&H{alpha:02X}{blue}{green}{red}").to_ascii_uppercase())
}

/// Fold the user's overrides into the preset, field by field.
fn apply_caption_override(
    mut style: AssCaptionStyle,
    over: Option<&crate::models::CaptionStyleOverride>,
) -> AssCaptionStyle {
    let Some(over) = over else { return style };

    if let Some(font) = over.font_family.as_deref() {
        style.font_family = font.to_string();
    }
    if let Some(size) = over.font_size {
        style.font_size = size;
    }
    if let Some(colour) = over.text_color.as_deref().and_then(|hex| ass_colour(hex, 0x00)) {
        style.primary_colour = colour;
    }
    if let Some(colour) = over.outline_color.as_deref().and_then(|hex| ass_colour(hex, 0x00)) {
        style.outline_colour = colour;
    }
    if let Some(colour) = over.box_color.as_deref().and_then(|hex| ass_colour(hex, 0x50)) {
        style.back_colour = colour;
    }
    if let Some(border) = over.border_style {
        style.border_style = border;
    }
    if let Some(outline) = over.outline {
        style.outline = outline;
    }
    if let Some(bold) = over.bold {
        style.bold = bold;
    }
    if let Some(position) = over.position {
        // 0.0 = top, 1.0 = bottom; ASS margins are measured from the bottom.
        style.margin_v = ((1.0 - position) * (ASS_CANVAS_HEIGHT / 2.0)).round() as i64;
    }
    if let Some(width) = over.max_width {
        let margin = ((1.0 - width) / 2.0 * ASS_CANVAS_WIDTH).round() as i64;
        style.margin_lr = margin.clamp(0, 540);
    }
    style
}

/// Mirror the previous drawtext presets in ASS, using a 1080x1920 canvas so
/// libass scales them to whatever resolution the clip is encoded at.
fn ass_caption_style(name: &str) -> AssCaptionStyle {
    // Defaults describe the `modern-box` preset.
    let mut style = AssCaptionStyle {
        font_family: caption_font_name().to_string(),
        font_size: 81.0,
        primary_colour: "&H00FFFFFF".to_string(),
        outline_colour: "&H00000000".to_string(),
        back_colour: "&H50000000".to_string(),
        border_style: 3,
        outline: 10.0,
        shadow: 0.0,
        bold: true,
        margin_v: 458,
        margin_lr: 40,
    };

    match name {
        "classic-outline" => {
            style.primary_colour = "&H0000FFFF".to_string(); // yellow
            style.back_colour = "&H80000000".to_string();
            style.border_style = 1;
            style.outline = 5.0;
            style.shadow = 0.0;
            style.margin_v = 592;
        }
        "minimal-shadow" => {
            style.back_colour = "&H80000000".to_string();
            style.border_style = 1;
            style.outline = 0.0;
            style.shadow = 3.0;
            style.margin_v = 496;
        }
        "vibrant-cyan" => {
            style.primary_colour = "&H00FFFF00".to_string();
            style.back_colour = "&H80000000".to_string();
            style.border_style = 1;
            style.outline = 0.0;
            style.shadow = 3.0;
            style.margin_v = 496;
        }
        "vibrant-yellow-box" => {
            style.primary_colour = "&H00000000".to_string(); // black on yellow box
            style.back_colour = "&H1F00FFFF".to_string();
            style.border_style = 3;
            style.outline = 10.0;
            style.shadow = 0.0;
            style.margin_v = 458;
        }
        "vibrant-green" => {
            style.primary_colour = "&H0014FF39".to_string();
            style.back_colour = "&H80000000".to_string();
            style.border_style = 1;
            style.outline = 4.0;
            style.shadow = 2.0;
            style.margin_v = 496;
        }
        "vibrant-red" => {
            style.primary_colour = "&H00303BFF".to_string();
            style.back_colour = "&H80000000".to_string();
            style.border_style = 1;
            style.outline = 4.0;
            style.shadow = 2.0;
            style.margin_v = 496;
        }
        _ => {}
    }

    style
}

fn ass_escape_text(text: &str) -> String {
    text.chars()
        .filter(|c| !matches!(c, '{' | '}' | '\\' | '\n' | '\r'))
        .collect()
}

/// Build an ASS subtitle file for the clip.
///
/// Replaces the previous "one drawtext filter per word pair" approach: ffmpeg
/// now evaluates a single `ass` filter per frame, which is several times faster
/// on long clips.
#[cfg(test)]
fn build_ass_captions(
    words: &[TranscriptWord],
    start_sec: f64,
    end_sec: f64,
    caption_style: &str,
    over: Option<&crate::models::CaptionStyleOverride>,
) -> String {
    let mut ass = ass_document_header(caption_style, over);
    let uppercase = over.and_then(|value| value.uppercase).unwrap_or(true);

    let candidate_words: Vec<&TranscriptWord> = words
        .iter()
        .filter(|w| w.end > start_sec && w.start < end_sec)
        .collect();

    for chunk in candidate_words.chunks(2) {
        if chunk.is_empty() {
            continue;
        }
        let first = chunk[0];
        let last = chunk[chunk.len() - 1];
        let start_rel = (first.start - start_sec).max(0.0);
        let end_rel = (last.end - start_sec).min(end_sec - start_sec).max(0.0);
        if end_rel <= start_rel {
            continue;
        }
        let text = chunk
            .iter()
            .map(|w| w.text.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        let text = if uppercase { text.to_uppercase() } else { text };
        push_ass_dialogue(&mut ass, start_rel, end_rel, &text);
    }

    ass
}

/// Build an ASS subtitle file from explicit caption cues.
///
/// Cues are timed in absolute source seconds; they are filtered to the clip
/// window, clamped into it, and rendered uppercase like the transcript-derived
/// captions.
pub fn build_ass_captions_from_cues(
    cues: &[CaptionCue],
    start_sec: f64,
    end_sec: f64,
    style_name: &str,
    over: Option<&crate::models::CaptionStyleOverride>,
) -> String {
    let mut ass = ass_document_header(style_name, over);
    let uppercase = over.and_then(|value| value.uppercase).unwrap_or(true);

    for cue in cues {
        if cue.end <= start_sec || cue.start >= end_sec {
            continue;
        }
        let text = cue.text.trim();
        if text.is_empty() {
            continue;
        }
        let start_rel = (cue.start - start_sec).max(0.0);
        let end_rel = cue.end.min(end_sec) - start_sec;
        if end_rel <= start_rel {
            continue;
        }
        let text = if uppercase {
            text.to_uppercase()
        } else {
            text.to_string()
        };
        push_ass_dialogue(&mut ass, start_rel, end_rel, &text);
    }

    ass
}

/// Script info + styles + event header shared by every ASS writer.
fn ass_document_header(
    caption_style: &str,
    over: Option<&crate::models::CaptionStyleOverride>,
) -> String {
    let style = apply_caption_override(ass_caption_style(caption_style), over);
    let bold = if style.bold { -1 } else { 0 };

    let mut ass = String::new();
    ass.push_str("[Script Info]\n");
    ass.push_str("ScriptType: v4.00+\n");
    ass.push_str(&format!("PlayResX: {}\n", ASS_CANVAS_WIDTH as i64));
    ass.push_str(&format!("PlayResY: {}\n", ASS_CANVAS_HEIGHT as i64));
    ass.push_str("WrapStyle: 2\n");
    ass.push_str("ScaledBorderAndShadow: yes\n\n");

    ass.push_str("[V4+ Styles]\n");
    ass.push_str(
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, \
         BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, \
         BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n",
    );
    ass.push_str(&format!(
        "Style: Default,{font},{size},{primary},&H000000FF,{outline_c},{back},{bold},0,0,0,\
         100,100,0,0,{border},{outline_w},{shadow},2,{margin_lr},{margin_lr},{margin_v},1\n\n",
        font = style.font_family,
        size = style.font_size.round() as i64,
        primary = style.primary_colour,
        outline_c = style.outline_colour,
        back = style.back_colour,
        border = style.border_style,
        outline_w = style.outline,
        shadow = style.shadow,
        margin_lr = style.margin_lr,
        margin_v = style.margin_v,
    ));

    ass.push_str("[Events]\n");
    ass.push_str("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n");
    ass
}

fn push_ass_dialogue(ass: &mut String, start_rel: f64, end_rel: f64, text: &str) {
    ass.push_str(&format!(
        "Dialogue: 0,{},{},Default,,0,0,0,,{}\n",
        format_ass_time(start_rel),
        format_ass_time(end_rel),
        ass_escape_text(text)
    ));
}

/// Legacy drawtext builder, kept only as a reference for the old caption
/// presets. Rendering now burns a single ASS file instead.
#[allow(dead_code)]
fn build_drawtext_filters(
    words: &[TranscriptWord],
    start_sec: f64,
    end_sec: f64,
    cropped_width: i64,
    caption_style: &str,
) -> String {
    let candidate_words: Vec<&TranscriptWord> = words
        .iter()
        .filter(|w| w.end > start_sec && w.start < end_sec)
        .collect();

    if candidate_words.is_empty() {
        return String::new();
    }

    // Build font option once for drawtext filter
    let mut font_paths = vec![
        // macOS
        "/System/Library/Fonts/Supplemental/Futura.ttc".to_string(),
        "/System/Library/Fonts/Avenir Next.ttc".to_string(),
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf".to_string(),
        "/System/Library/Fonts/Helvetica.ttc".to_string(),
        // Windows standard
        "C:/Windows/Fonts/SegoeUIb.ttf".to_string(),
        "C:/Windows/Fonts/segoeuib.ttf".to_string(),
        "C:/Windows/Fonts/SegoeUI.ttf".to_string(),
        "C:/Windows/Fonts/segoeui.ttf".to_string(),
        "C:/Windows/Fonts/arialbd.ttf".to_string(),
        "C:/Windows/Fonts/arial.ttf".to_string(),
        // Linux
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf".to_string(),
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf".to_string(),
    ];
    if let Ok(windir) = std::env::var("WINDIR").or_else(|_| std::env::var("SystemRoot")) {
        let windir_fonts = format!("{}/Fonts", windir.replace('\\', "/"));
        font_paths.push(format!("{}/SegoeUIb.ttf", windir_fonts));
        font_paths.push(format!("{}/segoeuib.ttf", windir_fonts));
        font_paths.push(format!("{}/SegoeUI.ttf", windir_fonts));
        font_paths.push(format!("{}/arialbd.ttf", windir_fonts));
        font_paths.push(format!("{}/arial.ttf", windir_fonts));
    }

    let mut font_option = String::new();
    for path in &font_paths {
        if std::path::Path::new(path).exists() {
            let normalized_path = path.replace('\\', "/");
            let escaped_path = normalized_path.replace('\'', "'\\''");
            font_option = format!("fontfile='{}':", escaped_path);
            break;
        }
    }

    let mut drawtext_filters = Vec::new();

    // Group into chunks of 2 words for fast-paced style captions
    for chunk in candidate_words.chunks(2) {
        if chunk.is_empty() {
            continue;
        }
        let first = chunk[0];
        let last = chunk[chunk.len() - 1];

        // Timestamps relative to clip start (due to fast input seeking resetting stream PTS)
        let start_rel = (first.start - start_sec).max(0.0);
        let end_rel = (last.end - start_sec).min(end_sec - start_sec).max(0.0);
        if end_rel <= start_rel {
            continue;
        }

        let text = chunk
            .iter()
            .map(|w| w.text.to_uppercase())
            .collect::<Vec<_>>()
            .join(" ");

        // Clean text to avoid breaking filter parameters
        let clean_text: String = text.chars()
            .filter(|c| c.is_alphanumeric() || *c == ' ' || *c == '!' || *c == '?')
            .collect();

        // Responsive font size and padding box
        let fontsize = ((cropped_width as f64) * 0.075).clamp(16.0, 80.0).round() as i64;
        let padding = ((fontsize as f64) * 0.3).clamp(4.0, 24.0).round() as i64;


        let drawtext = match caption_style {
            "classic-outline" => {
                // Classic yellow text with a bold outline (CapCut style)
                let borderw = ((fontsize as f64) * 0.1).clamp(2.0, 8.0).round() as i64;
                format!(
                    "drawtext={}text='{}':x=(w-text_w)/2:y=h*0.65:fontsize={}:fontcolor=yellow:borderw={}:bordercolor=black:enable='between(t,{:.3},{:.3})'",
                    font_option, clean_text, fontsize, borderw, start_rel, end_rel
                )
            }
            "minimal-shadow" => {
                // Sleek white text with a soft drop shadow (Minimalist)
                format!(
                    "drawtext={}text='{}':x=(w-text_w)/2:y=h*0.7:fontsize={}:fontcolor=white:shadowcolor=black@0.5:shadowx=2:shadowy=2:enable='between(t,{:.3},{:.3})'",
                    font_option, clean_text, fontsize, start_rel, end_rel
                )
            }
            "vibrant-cyan" => {
                // Modern Avenir Next look with clean cyan color and thin shadow
                format!(
                    "drawtext={}text='{}':x=(w-text_w)/2:y=h*0.7:fontsize={}:fontcolor=0x00FFFF:shadowcolor=black@0.6:shadowx=2:shadowy=2:enable='between(t,{:.3},{:.3})'",
                    font_option, clean_text, fontsize, start_rel, end_rel
                )
            }
            "vibrant-yellow-box" => {
                // Vibrant black text inside a solid yellow background box (Motivational/TikTok style)
                format!(
                    "drawtext={}text='{}':x=(w-text_w)/2:y=h*0.72:fontsize={}:fontcolor=black:box=1:boxcolor=0xffff00e0:boxborderw={}:enable='between(t,{:.3},{:.3})'",
                    font_option, clean_text, fontsize, padding, start_rel, end_rel
                )
            }
            "vibrant-green" => {
                // High-energy neon green text with outline & drop shadow (Hormozi style)
                let borderw = ((fontsize as f64) * 0.08).clamp(1.5, 6.0).round() as i64;
                format!(
                    "drawtext={}text='{}':x=(w-text_w)/2:y=h*0.7:fontsize={}:fontcolor=0x39FF14:borderw={}:bordercolor=black:shadowcolor=black@0.6:shadowx=2:shadowy=2:enable='between(t,{:.3},{:.3})'",
                    font_option, clean_text, fontsize, borderw, start_rel, end_rel
                )
            }
            "vibrant-red" => {
                // Dramatic red text with outline & drop shadow (Gaming/Drama style)
                let borderw = ((fontsize as f64) * 0.08).clamp(1.5, 6.0).round() as i64;
                format!(
                    "drawtext={}text='{}':x=(w-text_w)/2:y=h*0.7:fontsize={}:fontcolor=0xFF3B30:borderw={}:bordercolor=black:shadowcolor=black@0.6:shadowx=2:shadowy=2:enable='between(t,{:.3},{:.3})'",
                    font_option, clean_text, fontsize, borderw, start_rel, end_rel
                )
            }
            _ => {
                // modern-box (Default): white text with clean box background
                format!(
                    "drawtext={}text='{}':x=(w-text_w)/2:y=h*0.72:fontsize={}:fontcolor=white:box=1:boxcolor=0x000000b0:boxborderw={}:enable='between(t,{:.3},{:.3})'",
                    font_option, clean_text, fontsize, padding, start_rel, end_rel
                )
            }
        };
        drawtext_filters.push(drawtext);
    }

    drawtext_filters.join(",")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::TranscriptWord;

    fn word(text: &str, start: f64, end: f64) -> TranscriptWord {
        TranscriptWord {
            text: text.to_string(),
            start,
            end,
            speaker: Some("S1".to_string()),
        }
    }

    fn project(source_path: &str) -> Project {
        Project {
            id: "project-id".to_string(),
            name: None,
            source_path: source_path.to_string(),
            source_duration: Some(120.0),
            status: "ingest".to_string(),
            transcription_mode: "local".to_string(),
            caption_style: Some("modern-box".to_string()),
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn command_errors_include_the_underlying_cause() {
        let error = anyhow::anyhow!("connection refused").context("calling endpoint");
        assert_eq!(
            to_command_error(error),
            "calling endpoint: connection refused"
        );
    }

    #[test]
    fn test_build_drawtext_filters_formatting() {
        let words = vec![word("Hello", 0.0, 1.0), word("world", 1.0, 2.0)];

        let result = build_drawtext_filters(&words, 0.0, 5.0, 1080, "classic-outline");
        assert!(!result.is_empty());
        assert!(result.contains("drawtext="));
        assert!(result.contains("text='HELLO WORLD'"));

        if result.contains("fontfile=") {
            assert!(result.contains("fontfile='"));
            assert!(!result.contains("\\:"));
        }
    }

    #[test]
    fn format_srt_time_uses_comma_milliseconds() {
        assert_eq!(format_srt_time(0.0, 1.5), "00:00:00,000 --> 00:00:01,500");
        assert_eq!(format_srt_time(62.5, 3661.25), "00:01:02,500 --> 01:01:01,250");
    }

    #[test]
    fn format_ass_time_uses_centiseconds() {
        assert_eq!(format_ass_time(0.0), "0:00:00.00");
        assert_eq!(format_ass_time(62.5), "0:01:02.50");
        assert_eq!(format_ass_time(3661.5), "1:01:01.50");
        assert_eq!(format_ass_time(-5.0), "0:00:00.00");
    }

    #[test]
    fn generate_srt_chunks_three_words_and_clips_to_window() {
        let words = vec![
            word("alpha", 0.0, 0.5),
            word("beta", 1.0, 1.5),
            word("gamma", 2.0, 2.5),
            word("delta", 3.0, 3.5),
            word("outside", 10.0, 10.5),
        ];

        let srt = generate_srt(&words, 0.0, 4.0);
        assert!(srt.starts_with("1\n00:00:00,000 --> 00:00:02,500\nalpha beta gamma\n\n"));
        assert!(
            srt.contains("2\n00:00:03,000 --> 00:00:03,500\ndelta\n\n"),
            "unexpected srt: {srt:?}"
        );
        assert!(!srt.contains("outside"));
    }

    #[test]
    fn generate_srt_is_empty_without_words_in_window() {
        let words = vec![word("alpha", 10.0, 11.0)];
        assert!(generate_srt(&words, 0.0, 5.0).is_empty());
    }

    #[test]
    fn ass_escape_text_strips_override_characters() {
        assert_eq!(ass_escape_text("a{b}c\\d\ne\rf"), "abcdef");
    }

    #[test]
    fn build_ass_captions_contains_header_and_uppercase_dialogue() {
        let words = vec![word("hello", 0.0, 0.5), word("world", 0.5, 1.0)];
        let ass = build_ass_captions(&words, 0.0, 5.0, "classic-outline", None);

        assert!(ass.contains("[Script Info]"));
        assert!(ass.contains("PlayResX: 1080"));
        assert!(ass.contains("PlayResY: 1920"));
        assert!(ass.contains("Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,HELLO WORLD"));
    }

    #[test]
    fn build_ass_captions_skips_degenerate_timings() {
        let words = vec![word("zero", 1.0, 1.0)];
        let ass = build_ass_captions(&words, 0.0, 5.0, "modern-box", None);
        assert!(!ass.contains("Dialogue:"));
    }

    #[test]
    fn build_ass_captions_from_cues_uppercases_and_clamps() {
        let cues = vec![
            CaptionCue {
                start: 0.5,
                end: 2.0,
                text: "first line".to_string(),
            },
            CaptionCue {
                start: 4.5,
                end: 9.0,
                text: "crosses the end".to_string(),
            },
        ];

        let ass = build_ass_captions_from_cues(&cues, 1.0, 5.0, "classic-outline", None);

        assert!(ass.contains("[Script Info]"));
        assert!(ass.contains("Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,FIRST LINE"));
        assert!(ass.contains("Dialogue: 0,0:00:03.50,0:00:04.00,Default,,0,0,0,,CROSSES THE END"));
    }

    #[test]
    fn build_ass_captions_from_cues_skips_cues_outside_window() {
        let cues = vec![
            CaptionCue {
                start: 0.0,
                end: 1.0,
                text: "before".to_string(),
            },
            CaptionCue {
                start: 10.0,
                end: 11.0,
                text: "after".to_string(),
            },
            CaptionCue {
                start: 2.0,
                end: 3.0,
                text: "   ".to_string(),
            },
        ];

        let ass = build_ass_captions_from_cues(&cues, 5.0, 8.0, "modern-box", None);

        assert!(!ass.contains("Dialogue:"));
        assert!(!ass.contains("BEFORE"));
        assert!(!ass.contains("AFTER"));
    }

    #[test]
    fn ass_caption_style_falls_back_to_modern_box() {
        let style = ass_caption_style("does-not-exist");
        assert_eq!(style.primary_colour, "&H00FFFFFF");
        assert_eq!(style.border_style, 3);
    }

    #[test]
    fn ass_colour_converts_rgb_to_ass_bgr_order() {
        assert_eq!(ass_colour("#FF0000", 0x00).as_deref(), Some("&H000000FF"));
        assert_eq!(ass_colour("00FF00", 0x50).as_deref(), Some("&H5000FF00"));
        assert_eq!(ass_colour("#0000ff", 0x00).as_deref(), Some("&H00FF0000"));
        assert_eq!(ass_colour("nope", 0x00), None);
    }

    #[test]
    fn caption_override_rewrites_font_colour_and_position() {
        let over = crate::models::CaptionStyleOverride {
            font_family: Some("Inter".to_string()),
            font_size: Some(120.0),
            text_color: Some("#FF0000".to_string()),
            outline_color: Some("#00FF00".to_string()),
            box_color: Some("#0000FF".to_string()),
            border_style: Some(1),
            outline: Some(2.0),
            bold: Some(false),
            uppercase: Some(false),
            position: Some(0.0),
            max_width: Some(0.5),
        };

        let header = ass_document_header("modern-box", Some(&over));
        assert!(header.contains("Default,Inter,120,&H000000FF"), "{header}");
        assert!(header.contains("&H0000FF00"), "{header}");
        assert!(header.contains("&H50FF0000"), "{header}");
        // Bold off, outline 1, position 0 (top) -> half canvas margin.
        assert!(header.contains(",0,0,0,0,100,100,0,0,1,2,0,2,270,270,960,1"), "{header}");
    }

    #[test]
    fn caption_override_can_keep_lowercase_text() {
        let cues = vec![CaptionCue {
            start: 1.0,
            end: 2.0,
            text: "Mixed Case".to_string(),
        }];
        let over = crate::models::CaptionStyleOverride {
            uppercase: Some(false),
            ..Default::default()
        };
        let ass = build_ass_captions_from_cues(&cues, 0.0, 5.0, "modern-box", Some(&over));
        assert!(ass.contains(",,Mixed Case"), "{ass}");
        assert!(!ass.contains("MIXED CASE"), "{ass}");
    }

    #[test]
    fn project_output_slug_sanitizes_file_stem() {
        assert_eq!(
            project_output_slug(&project("/tmp/My Video - Final!.mp4")),
            "My-Video---Final"
        );
        assert_eq!(project_output_slug(&project("/tmp/episode_01.mkv")), "episode_01");
    }

    #[test]
    fn project_output_slug_falls_back_to_project_id() {
        assert_eq!(project_output_slug(&project("/")), "project-id");
    }

    #[test]
    fn validate_media_extension_accepts_supported_types_case_insensitively() {
        for path in ["clip.mp4", "clip.MOV", "audio.mp3", "audio.wav", "audio.m4a"] {
            assert!(validate_media_extension(path).is_ok(), "{path} should be accepted");
        }
    }

    #[test]
    fn validate_media_extension_rejects_unknown_and_missing_extensions() {
        let unsupported = validate_media_extension("clip.avi").unwrap_err().to_string();
        assert!(unsupported.contains("Unsupported file type .avi"));

        let missing = validate_media_extension("clip").unwrap_err().to_string();
        assert!(missing.contains("does not have an extension"));
    }

    #[test]
    fn demo_transcript_has_words_and_segments() {
        let transcript = demo_transcript();
        assert!(!transcript.words.is_empty());
        assert!(!transcript.segments.is_empty());
        assert!(transcript.duration > 0.0);
        assert_eq!(transcript.speakers, vec!["A".to_string()]);
    }
}
