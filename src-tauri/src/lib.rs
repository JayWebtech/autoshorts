mod db;
mod llm;
mod media;
mod models;
mod transcription;

use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use tauri::{Emitter, Manager};

use db::Database;
use models::{
    Candidate, EnvironmentStatus, MediaProbe, NormalizedTranscript, Project, ProjectDetail,
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
}

#[tauri::command]
async fn environment_status(state: tauri::State<'_, AppState>) -> Result<EnvironmentStatus, String> {
    let llm_provider = std::env::var("LLM_PROVIDER")
        .unwrap_or_else(|_| "deepseek".to_string())
        .to_lowercase();

    let has_local_whisper_model = std::process::Command::new("python3")
        .args(["-c", "import whisper"])
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false);

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
        llm_provider,
        has_local_whisper_model,
        has_ollama,
    })
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
    state: tauri::State<'_, AppState>,
    project_id: String,
) -> Result<MediaProbe, String> {
    let project = state
        .db
        .get_project(&project_id)
        .map_err(to_command_error)?;
    let probe = media::probe_media(&project.source_path).map_err(to_command_error)?;
    state
        .db
        .update_project_status(&project_id, "ingest", probe.duration_sec)
        .map_err(to_command_error)?;
    Ok(probe)
}

#[tauri::command]
fn extract_project_audio(
    state: tauri::State<'_, AppState>,
    project_id: String,
) -> Result<String, String> {
    let project = state
        .db
        .get_project(&project_id)
        .map_err(to_command_error)?;
    let audio_path = media::extract_audio(&project.source_path, &project_dir(&state, &project_id))
        .map_err(to_command_error)?;
    Ok(audio_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn transcribe_project(
    state: tauri::State<'_, AppState>,
    project_id: String,
    provider: String,
    api_key: Option<String>,
) -> Result<Transcript, String> {
    let db = state.db.clone();
    let data_dir = state.data_dir.clone();
    let project = db.get_project(&project_id).map_err(to_command_error)?;
    db.update_project_status(&project_id, "transcribing", None)
        .map_err(to_command_error)?;

    let transcript = match provider.as_str() {
        "deepgram" => {
            let key = api_key
                .or_else(|| std::env::var("DEEPGRAM_API_KEY").ok())
                .ok_or_else(|| {
                    "Set DEEPGRAM_API_KEY or paste an API key to use cloud transcription."
                        .to_string()
                })?;
            let audio_path = media::extract_audio(
                &project.source_path,
                &data_dir.join("projects").join(&project_id),
            )
            .map_err(to_command_error)?;
            transcription::transcribe_deepgram(&audio_path.to_string_lossy(), &key)
                .await
                .map_err(to_command_error)?
        }
        "local" => {
            let has_python_whisper = std::process::Command::new("python3")
                .args(["-c", "import whisper"])
                .output()
                .map(|out| out.status.success())
                .unwrap_or(false);
            if !has_python_whisper {
                return Err("Python package 'openai-whisper' is not installed. Please run 'pip3 install openai-whisper' in your terminal.".to_string());
            }
            let audio_path = media::extract_audio(
                &project.source_path,
                &data_dir.join("projects").join(&project_id),
            )
            .map_err(to_command_error)?;
            transcription::transcribe_local(&audio_path.to_string_lossy(), &data_dir.to_string_lossy())
                .await
                .map_err(to_command_error)?
        }
        other => return Err(format!("Unsupported transcription provider: {other}")),
    };

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
    state: tauri::State<'_, AppState>,
    project_id: String,
    api_key: Option<String>,
    provider: Option<String>,
    model_name: Option<String>,
    _allow_demo: bool,
) -> Result<Vec<Candidate>, String> {
    let db = state.db.clone();
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
        _ => {
            let key = api_key
                .or_else(|| std::env::var("DEEPSEEK_API_KEY").ok())
                .ok_or_else(|| "Set DEEPSEEK_API_KEY or supply DeepSeek API Key to generate candidates.".to_string())?;
            llm::detect_candidates_with_deepseek(&normalized, &key)
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
fn render_flat_clip_for_candidate(
    state: tauri::State<'_, AppState>,
    candidate_id: String,
) -> Result<String, String> {
    let (candidate, project) = state
        .db
        .get_candidate_with_project(&candidate_id)
        .map_err(to_command_error)?;
    state
        .db
        .update_clip_for_candidate(&candidate_id, "cutting", None, None, None)
        .map_err(to_command_error)?;

    let output_path = documents_project_dir(&project)?
        .join("clips")
        .join(format!("clip-{:02}_flat.mp4", candidate.rank));
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create output dir: {}", e))?;
    }

    let mut srt_path = None;
    let mut video_filter = None;

    let probe = media::probe_media(&project.source_path).ok();
    let cropped_width = if let Some(p) = &probe {
        let iw = p.width.unwrap_or(1920) as f64;
        let ih = p.height.unwrap_or(1080) as f64;
        let w = (iw.min(ih * 9.0 / 16.0) / 2.0).floor() * 2.0;
        w as i64
    } else {
        1080
    };

    if let Ok(Some(transcript_record)) = state.db.latest_transcript(&project.id) {
        if let Ok(normalized) = serde_json::from_str::<NormalizedTranscript>(&transcript_record.raw_json) {
            let srt_content = generate_srt(&normalized.words, candidate.start_sec, candidate.end_sec);
            #[cfg(target_os = "windows")]
            let subtitles_dir = PathBuf::from(r"D:\AS\raw\subtitles");
            #[cfg(not(target_os = "windows"))]
            let subtitles_dir = project_dir(&state, &project.id);
            std::fs::create_dir_all(&subtitles_dir)
                .map_err(|e| format!("Failed to create subtitles dir: {}", e))?;
            let clip_srt_path = subtitles_dir.join(format!("clip-{}.srt", candidate.id));
            if std::fs::write(&clip_srt_path, srt_content).is_ok() {
                srt_path = Some(clip_srt_path);
            }
            if let Some(ref subtitle_path) = srt_path {
                video_filter = Some(build_subtitles_filter(subtitle_path));
            }
        }
    }

    match media::render_flat_clip(
        &project.source_path,
        candidate.start_sec,
        candidate.end_sec,
        &output_path,
        video_filter.as_deref(),
    ) {
        Ok(path) => {
            let path_string = path.to_string_lossy().to_string();
            let srt_string = srt_path.map(|p| p.to_string_lossy().to_string());
            state
                .db
                .update_clip_for_candidate(
                    &candidate_id,
                    "done",
                    Some(&path_string),
                    srt_string.as_deref(),
                    None,
                )
                .map_err(to_command_error)?;
            Ok(path_string)
        }
        Err(error) => {
            let err_msg = error.to_string();
            // Fallback retry rendering without captions overlay on any error
            match media::render_flat_clip(
                &project.source_path,
                candidate.start_sec,
                candidate.end_sec,
                &output_path,
                None,
            ) {
                Ok(path) => {
                    let path_string = path.to_string_lossy().to_string();
                    let srt_string = srt_path.map(|p| p.to_string_lossy().to_string());
                    let warning_msg = format!(
                        "Clip rendered successfully, but captions were skipped. Error: {}",
                        err_msg
                    );
                    state
                        .db
                        .update_clip_for_candidate(
                            &candidate_id,
                            "done",
                            Some(&path_string),
                            srt_string.as_deref(),
                            Some(&warning_msg),
                        )
                        .map_err(to_command_error)?;
                    Ok(path_string)
                }
                Err(retry_err) => {
                    let message = retry_err.to_string();
                    state
                        .db
                        .update_clip_for_candidate(&candidate_id, "error", None, None, Some(&message))
                        .map_err(to_command_error)?;
                    Err(message)
                }
            }
        }
    }
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
            let db = Database::open(&data_dir.join("autoshorts.sqlite"))?;
            app.manage(AppState { db, data_dir });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            environment_status,
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
            render_flat_clip_for_candidate,
            delete_project,
            rename_project
        ])
        .run(tauri::generate_context!())
        .expect("error while running AutoShorts");
}

fn project_dir(state: &AppState, project_id: &str) -> PathBuf {
    state.data_dir.join("projects").join(project_id)
}

fn documents_project_dir(project: &Project) -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    let base = PathBuf::from("D:\\AS\\raw");

    #[cfg(not(target_os = "windows"))]
    let base = {
        let documents_dir = dirs::document_dir()
            .ok_or_else(|| "Could not find your Documents folder for clip output.".to_string())?;
        documents_dir.join("AutoShorts").join(project_output_slug(project))
    };

    #[cfg(target_os = "windows")]
    let _ = project; // suppress unused warning on Windows

    std::fs::create_dir_all(&base).map_err(|e| format!("Failed to create output dir: {}", e))?;
    Ok(base)
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

fn to_command_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

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

fn build_subtitles_filter(subtitle_path: &Path) -> String {
    let path = subtitle_path
        .to_string_lossy()
        .replace('\\', "/");
    let escaped_path = path
        .replace(':', "\\\\:")
        .replace(' ', "\\\\ ");
    format!("subtitles={}", escaped_path)
}

fn build_drawtext_filters(
    words: &[TranscriptWord],
    start_sec: f64,
    end_sec: f64,
    cropped_width: i64,
    caption_style: &str,
) -> String {
    let mut drawtext_filters = Vec::new();

    let candidate_words: Vec<&TranscriptWord> = words
        .iter()
        .filter(|w| w.end > start_sec && w.start < end_sec)
        .collect();

    // Group into chunks of 2 words for fast-paced style captions
    for chunk in candidate_words.chunks(2) {
        if chunk.is_empty() {
            continue;
        }
        let first = chunk[0];
        let last = chunk[chunk.len() - 1];

        // Absolute timestamps for FFmpeg filter graph (due to output seeking keeping original PTS)
        let start_rel = first.start;
        let end_rel = last.end;
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

        let escaped_text = clean_text.replace('\'', "\\'");

        let drawtext = match caption_style {
            "classic-outline" => {
                // Classic yellow text with a bold outline (CapCut style)
                let borderw = ((fontsize as f64) * 0.1).clamp(2.0, 8.0).round() as i64;
                format!(
                    "drawtext=text='{}':x=(w-text_w)/2:y=h*0.65:fontsize={}:fontcolor=yellow:borderw={}:bordercolor=black:enable='between(t,{:.3},{:.3})'",
                    escaped_text, fontsize, borderw, start_rel, end_rel
                )
            }
            "minimal-shadow" => {
                // Sleek white text with a soft drop shadow (Minimalist)
                format!(
                    "drawtext=text='{}':x=(w-text_w)/2:y=h*0.7:fontsize={}:fontcolor=white:shadowcolor=black@0.5:shadowx=2:shadowy=2:enable='between(t,{:.3},{:.3})'",
                    escaped_text, fontsize, start_rel, end_rel
                )
            }
            "vibrant-cyan" => {
                // Modern Avenir Next look with clean cyan color and thin shadow
                format!(
                    "drawtext=text='{}':x=(w-text_w)/2:y=h*0.7:fontsize={}:fontcolor=0x00FFFF:shadowcolor=black@0.6:shadowx=2:shadowy=2:enable='between(t,{:.3},{:.3})'",
                    escaped_text, fontsize, start_rel, end_rel
                )
            }
            "vibrant-yellow-box" => {
                // Vibrant black text inside a solid yellow background box (Motivational/TikTok style)
                format!(
                    "drawtext=text='{}':x=(w-text_w)/2:y=h*0.72:fontsize={}:fontcolor=black:box=1:boxcolor=0xffff00e0:boxborderw={}:enable='between(t,{:.3},{:.3})'",
                    escaped_text, fontsize, padding, start_rel, end_rel
                )
            }
            "vibrant-green" => {
                // High-energy neon green text with outline & drop shadow (Hormozi style)
                let borderw = ((fontsize as f64) * 0.08).clamp(1.5, 6.0).round() as i64;
                format!(
                    "drawtext=text='{}':x=(w-text_w)/2:y=h*0.7:fontsize={}:fontcolor=0x39FF14:borderw={}:bordercolor=black:shadowcolor=black@0.6:shadowx=2:shadowy=2:enable='between(t,{:.3},{:.3})'",
                    escaped_text, fontsize, borderw, start_rel, end_rel
                )
            }
            "vibrant-red" => {
                // Dramatic red text with outline & drop shadow (Gaming/Drama style)
                let borderw = ((fontsize as f64) * 0.08).clamp(1.5, 6.0).round() as i64;
                format!(
                    "drawtext=text='{}':x=(w-text_w)/2:y=h*0.7:fontsize={}:fontcolor=0xFF3B30:borderw={}:bordercolor=black:shadowcolor=black@0.6:shadowx=2:shadowy=2:enable='between(t,{:.3},{:.3})'",
                    escaped_text, fontsize, borderw, start_rel, end_rel
                )
            }
            _ => {
                // modern-box (Default): white text with clean box background
                format!(
                    "drawtext=text='{}':x=(w-text_w)/2:y=h*0.72:fontsize={}:fontcolor=white:box=1:boxcolor=0x000000b0:boxborderw={}:enable='between(t,{:.3},{:.3})'",
                    escaped_text, fontsize, padding, start_rel, end_rel
                )
            }
        };
        drawtext_filters.push(drawtext);
    }

    drawtext_filters.join(",")
}
