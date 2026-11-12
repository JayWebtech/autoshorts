use std::{
    path::{Path, PathBuf},
    process::Command,
};

use anyhow::{anyhow, Context, Result};
use serde_json::Value;

use crate::models::MediaProbe;

pub fn resolve_binary(name: &str) -> String {
    // 1. If command exists directly on PATH
    if Command::new(name).arg("-version").output().is_ok()
        || Command::new(name).arg("--version").output().is_ok()
    {
        return name.to_string();
    }

    // 2. Check standard system and package manager directories (macOS Homebrew, MacPorts, Linux)
    let search_paths = [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/local/sbin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ];

    for dir in search_paths {
        let full_path = Path::new(dir).join(name);
        if full_path.exists() {
            if Command::new(&full_path).arg("-version").output().is_ok()
                || Command::new(&full_path).arg("--version").output().is_ok()
            {
                return full_path.to_string_lossy().to_string();
            }
        }
    }

    // 3. Check user home directories
    if let Some(home) = dirs::home_dir() {
        let user_paths = [
            home.join(".cargo/bin").join(name),
            home.join(".local/bin").join(name),
            home.join("bin").join(name),
        ];
        for user_path in user_paths {
            if user_path.exists() {
                if Command::new(&user_path).arg("-version").output().is_ok()
                    || Command::new(&user_path).arg("--version").output().is_ok()
                {
                    return user_path.to_string_lossy().to_string();
                }
            }
        }
    }

    name.to_string()
}

pub fn command_exists(name: &str) -> bool {
    let bin = resolve_binary(name);
    Command::new(&bin).arg("-version").output().map(|o| o.status.success() || !o.stdout.is_empty()).unwrap_or(false)
        || Command::new(&bin).arg("--version").output().map(|o| o.status.success() || !o.stdout.is_empty()).unwrap_or(false)
}

pub fn probe_media(path: &str) -> Result<MediaProbe> {
    if !command_exists("ffprobe") {
        return Err(anyhow!("ffprobe is not installed or not available on PATH"));
    }

    let ffprobe_bin = resolve_binary("ffprobe");
    let output = Command::new(&ffprobe_bin)
        .args([
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            path,
        ])
        .output()
        .context("running ffprobe")?;

    if !output.status.success() {
        return Err(anyhow!(
            "ffprobe failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let json: Value = serde_json::from_slice(&output.stdout).context("parsing ffprobe JSON")?;
    let streams = json
        .get("streams")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let video = streams
        .iter()
        .find(|stream| stream.get("codec_type").and_then(Value::as_str) == Some("video"));
    let audio = streams
        .iter()
        .find(|stream| stream.get("codec_type").and_then(Value::as_str) == Some("audio"));

    let duration_sec = json
        .get("format")
        .and_then(|format| format.get("duration"))
        .and_then(Value::as_str)
        .and_then(|duration| duration.parse::<f64>().ok());

    Ok(MediaProbe {
        duration_sec,
        has_video: video.is_some(),
        width: video
            .and_then(|stream| stream.get("width"))
            .and_then(Value::as_i64),
        height: video
            .and_then(|stream| stream.get("height"))
            .and_then(Value::as_i64),
        video_codec: video
            .and_then(|stream| stream.get("codec_name"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        audio_codec: audio
            .and_then(|stream| stream.get("codec_name"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
    })
}

pub fn extract_audio(source_path: &str, project_dir: &Path) -> Result<PathBuf> {
    if !command_exists("ffmpeg") {
        return Err(anyhow!("ffmpeg is not installed or not available on PATH"));
    }

    std::fs::create_dir_all(project_dir)?;
    let output_path = project_dir.join("transcription_audio.wav");

    let ffmpeg_bin = resolve_binary("ffmpeg");
    let output = Command::new(&ffmpeg_bin)
        .args(["-y", "-i", source_path, "-vn", "-ac", "1", "-ar", "16000"])
        .arg(&output_path)
        .output()
        .context("running ffmpeg audio extraction")?;

    if !output.status.success() {
        return Err(anyhow!(
            "ffmpeg audio extraction failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    Ok(output_path)
}

pub fn render_flat_clip(
    source_path: &str,
    start_sec: f64,
    end_sec: f64,
    output_path: &Path,
    drawtext_filters: Option<&str>,
) -> Result<PathBuf> {
    if !command_exists("ffmpeg") {
        return Err(anyhow!("ffmpeg is not installed or not available on PATH"));
    }

    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let start = format!("{start_sec:.3}");
    let duration_sec = (end_sec - start_sec).max(0.1);
    let duration = format!("{duration_sec:.3}");

    let probe = probe_media(source_path).ok();
    let has_video = probe.map(|p| p.has_video).unwrap_or(false);

    let ffmpeg_bin = resolve_binary("ffmpeg");
    let mut cmd = Command::new(&ffmpeg_bin);
    cmd.args(["-y", "-ss", &start, "-i", source_path, "-t", &duration]);

    if has_video {
        let mut filter = "crop=w='2*trunc(min(iw,ih*9/16)/2)':h='2*trunc(min(ih,iw*16/9)/2)'".to_string();
        if let Some(drawtext) = drawtext_filters {
            if !drawtext.is_empty() {
                filter = format!("{},{}", filter, drawtext);
            }
        }
        cmd.args(["-vf", &filter]);
        cmd.args(["-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p"]);
    } else {
        cmd.arg("-vn");
    }

    cmd.args(["-c:a", "aac", "-b:a", "192k"]);
    cmd.arg(output_path);

    let output = cmd.output().context("running ffmpeg clip render")?;

    if !output.status.success() {
        return Err(anyhow!(
            "ffmpeg clip render failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    Ok(output_path.to_path_buf())
}
