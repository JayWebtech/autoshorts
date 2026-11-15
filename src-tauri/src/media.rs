use std::{
    path::{Path, PathBuf},
    process::Command,
};

use anyhow::{anyhow, Context, Result};
use serde_json::Value;

use crate::models::MediaProbe;

/// Candidate directories searched when a helper binary (ffmpeg, ffprobe,
/// yt-dlp) is not reachable on the PATH of a GUI-launched app. Packaged
/// .app bundles on macOS and double-clicked apps on Windows inherit a
/// minimal PATH that omits Homebrew, winget and common manual install
/// locations, so `Command::new("ffmpeg")` fails with os error 2 even when
/// the binary is installed (issues #49, #42).
fn binary_search_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if cfg!(target_os = "macos") {
        dirs.push("/opt/homebrew/bin".into());
        dirs.push("/usr/local/bin".into());
    } else if cfg!(target_os = "linux") {
        dirs.push("/usr/local/bin".into());
        dirs.push("/usr/bin".into());
        dirs.push("/snap/bin".into());
    } else if cfg!(windows) {
        for exe in ["C:/ffmpeg/bin", "C:/Tools/ffmpeg/bin"] {
            dirs.push(exe.into());
        }
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            let winget = Path::new(&local).join("Microsoft/WinGet/Packages");
            if winget.is_dir() {
                if let Ok(entries) = std::fs::read_dir(&winget) {
                    for entry in entries.flatten() {
                        let bin = entry.path().join("ffmpeg").join("bin");
                        if bin.is_dir() {
                            dirs.push(bin);
                        }
                    }
                }
            }
        }
        if let Some(program_files) = std::env::var("ProgramFiles").ok() {
            dirs.push(Path::new(&program_files).join("ffmpeg/bin"));
        }
    }
    dirs
}

/// Resolve a helper binary to an executable path: honour an explicit
/// `AUTOSHORTS_FFMPEG`-style override, then the PATH, then known install
/// directories. Returns the path to use with `Command::new`.
pub fn resolve_binary(name: &str) -> Option<PathBuf> {
    let override_var = format!("AUTOSHORTS_{}", name.to_uppercase().replace('-', "_"));
    if let Ok(path) = std::env::var(&override_var) {
        let p = PathBuf::from(path);
        if p.is_file() {
            return Some(p);
        }
    }
    if Command::new(name).arg("-version").output().is_ok() {
        return Some(PathBuf::from(name));
    }
    let file_name = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    for dir in binary_search_dirs() {
        let candidate = dir.join(&file_name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

pub fn command_exists(name: &str) -> bool {
    resolve_binary(name).is_some()
}

/// Escape a filesystem path for use as a FFmpeg filtergraph argument
/// (e.g. drawtext `fontfile=`). FFmpeg splits filter options on `:` and
/// paths on `/` and `\`, so a Windows drive-letter path such as
/// `C:\Windows\Fonts\arialbd.ttf` breaks the filter chain with
/// "No option name near '/Windows/Fonts/...'" (issues #48, #41, #10, #34).
/// Normalising backslashes to `/` and backslash-escaping every `:` yields
/// `C\:/Windows/Fonts/arialbd.ttf`, which parses correctly when wrapped in
/// single quotes inside the filter description.
pub fn escape_filter_path(path: &str) -> String {
    path.replace('\\', "/").replace(':', "\\:")
}

pub fn probe_media(path: &str) -> Result<MediaProbe> {
    let ffprobe = resolve_binary("ffprobe")
        .ok_or_else(|| anyhow!("ffprobe is not installed or not available on PATH"))?;

    let output = Command::new(&ffprobe)
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
    let ffmpeg = resolve_binary("ffmpeg")
        .ok_or_else(|| anyhow!("ffmpeg is not installed or not available on PATH"))?;

    std::fs::create_dir_all(project_dir)?;
    let output_path = project_dir.join("transcription_audio.wav");

    let output = Command::new(&ffmpeg)
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
    let ffmpeg = resolve_binary("ffmpeg")
        .ok_or_else(|| anyhow!("ffmpeg is not installed or not available on PATH"))?;

    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let start = format!("{start_sec:.3}");
    let duration_sec = (end_sec - start_sec).max(0.1);
    let duration = format!("{duration_sec:.3}");

    let probe = probe_media(source_path).ok();
    let has_video = probe.map(|p| p.has_video).unwrap_or(false);

    let mut cmd = Command::new(&ffmpeg);
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
