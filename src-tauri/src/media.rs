use std::{
    path::{Path, PathBuf},
    process::Command,
};

use anyhow::{anyhow, Context, Result};
use serde_json::Value;

use crate::models::MediaProbe;

pub fn command_exists(name: &str) -> bool {
    Command::new(name).arg("-version").output().is_ok()
}

pub fn probe_media(path: &str) -> Result<MediaProbe> {
    if !command_exists("ffprobe") {
        return Err(anyhow!("ffprobe is not installed or not available on PATH"));
    }

    let output = Command::new("ffprobe")
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

    let output = Command::new("ffmpeg")
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
    video_filter: Option<&str>,
) -> Result<PathBuf> {
    if !command_exists("ffmpeg") {
        return Err(anyhow!("ffmpeg is not installed or not available on PATH"));
    }

    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let start = format!("{start_sec:.3}");
    let end = format!("{end_sec:.3}");

    let probe = probe_media(source_path).ok();
    let has_video = probe.map(|p| p.has_video).unwrap_or(false);

    let mut cmd = Command::new("ffmpeg");
    cmd.args(["-y", "-ss", &start, "-to", &end, "-i", source_path]);

    if has_video {
        let mut filter = "crop=w='2*trunc(min(iw,ih*9/16)/2)':h='2*trunc(min(ih,iw*16/9)/2)'".to_string();
        if let Some(extra_filter) = video_filter {
            if !extra_filter.is_empty() {
                filter = format!("{},{}", filter, extra_filter);
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
