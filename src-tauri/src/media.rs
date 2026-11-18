use std::{
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use anyhow::{anyhow, Context, Result};
use serde_json::Value;

use crate::autoedit::RenderSegment;
use crate::hardware;
use crate::models::MediaProbe;

pub fn command_exists(name: &str) -> bool {
    Command::new(name).arg("-version").output().is_ok()
}

/// Parse a `-progress pipe:1` key/value pair into a position in seconds.
///
/// ffmpeg reports `out_time_us` and `out_time_ms`; despite the name, both are
/// expressed in microseconds on current builds, so both are divided by 1e6.
fn parse_ffmpeg_progress_time(key: &str, value: &str) -> Option<f64> {
    match key {
        "out_time_us" | "out_time_ms" => value.trim().parse::<f64>().ok().map(|us| us / 1_000_000.0),
        "out_time" => parse_clock_timestamp(value.trim()),
        _ => None,
    }
}

fn parse_clock_timestamp(token: &str) -> Option<f64> {
    let mut parts = token.split(':');
    let hours: f64 = parts.next()?.parse().ok()?;
    let minutes: f64 = parts.next()?.parse().ok()?;
    let seconds: f64 = parts.next()?.parse().ok()?;
    Some(hours * 3600.0 + minutes * 60.0 + seconds)
}

/// Run ffmpeg while streaming `-progress pipe:1` output into `on_progress`.
///
/// The callback is borrowed so a caller can retry the same job with a different
/// encoder (GPU first, CPU on failure) while keeping its progress reporting.
fn run_ffmpeg_with_progress(
    args: &[String],
    total_duration: Option<f64>,
    working_dir: Option<&Path>,
    on_progress: &mut dyn FnMut(f64),
) -> Result<()> {
    let mut command = Command::new("ffmpeg");
    command.args(["-progress", "pipe:1", "-nostats"]).args(args);
    if let Some(dir) = working_dir {
        command.current_dir(dir);
    }

    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("running ffmpeg")?;

    // Drain stderr on a helper thread so a full pipe never deadlocks the render.
    let stderr_handle = {
        let mut stderr = child.stderr.take().context("capturing ffmpeg stderr")?;
        std::thread::spawn(move || {
            let mut buffer = String::new();
            let _ = stderr.read_to_string(&mut buffer);
            buffer
        })
    };

    if let Some(stdout) = child.stdout.take() {
        let reader = BufReader::new(stdout);
        let mut last_percentage = 0.0_f64;
        for line in reader.lines() {
            let Ok(line) = line else { break };
            let Some((key, value)) = line.split_once('=') else {
                continue;
            };
            if key == "progress" && value.trim() == "end" {
                if last_percentage < 100.0 {
                    last_percentage = 100.0;
                    on_progress(100.0);
                }
                continue;
            }
            let Some(total) = total_duration else { continue };
            if total <= 0.0 {
                continue;
            }
            if let Some(position) = parse_ffmpeg_progress_time(key, value) {
                let percentage = (position / total * 100.0).clamp(0.0, 99.0);
                if percentage > last_percentage + 0.5 {
                    last_percentage = percentage;
                    on_progress(percentage);
                }
            }
        }
    }

    let status = child.wait().context("waiting for ffmpeg")?;
    let stderr = stderr_handle.join().unwrap_or_default();

    if !status.success() {
        return Err(anyhow!("ffmpeg failed: {}", stderr.trim()));
    }

    on_progress(100.0);
    Ok(())
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

/// Extract a 16 kHz mono WAV for transcription, reporting 0..=100 progress.
pub fn extract_audio(
    source_path: &str,
    project_dir: &Path,
    mut on_progress: impl FnMut(f64),
) -> Result<PathBuf> {
    if !command_exists("ffmpeg") {
        return Err(anyhow!("ffmpeg is not installed or not available on PATH"));
    }

    std::fs::create_dir_all(project_dir)?;
    let output_path = project_dir.join("transcription_audio.wav");

    let total_duration = probe_media(source_path).ok().and_then(|probe| probe.duration_sec);

    let args: Vec<String> = vec![
        "-y".into(),
        "-i".into(),
        source_path.to_string(),
        "-vn".into(),
        "-ac".into(),
        "1".into(),
        "-ar".into(),
        "16000".into(),
        output_path.to_string_lossy().to_string(),
    ];

    run_ffmpeg_with_progress(&args, total_duration, None, &mut on_progress)?;
    Ok(output_path)
}

/// Aspect ratio used when the caller does not specify one.
pub const DEFAULT_ASPECT_RATIO: &str = "9:16";

/// Canonicalize a user-supplied aspect ratio into one of the four supported
/// values, falling back to vertical video.
pub fn normalize_aspect_ratio(value: &str) -> &'static str {
    match value.trim().to_ascii_lowercase().as_str() {
        "1:1" | "1x1" | "square" => "1:1",
        "16:9" => "16:9",
        "4:5" => "4:5",
        _ => DEFAULT_ASPECT_RATIO,
    }
}

/// Output resolution for a clip. Normalizing here keeps the encoder from
/// working on 4K frames when the source is larger than a phone screen.
pub fn clip_dimensions(aspect_ratio: &str) -> (i64, i64) {
    match normalize_aspect_ratio(aspect_ratio) {
        "1:1" => (1080, 1080),
        "16:9" => (1920, 1080),
        "4:5" => (1080, 1350),
        _ => (1080, 1920),
    }
}

fn clamp_crop(value: f64) -> f64 {
    if value.is_finite() {
        value.clamp(0.0, 1.0)
    } else {
        0.5
    }
}

/// Build the crop + scale portion of the ffmpeg filter chain.
///
/// The crop window keeps the requested aspect ratio inside the source frame
/// and slides inside the remaining slack according to `crop_x`/`crop_y`
/// (0.0 = left/top, 0.5 = centered, 1.0 = right/bottom). Single-quoted
/// expressions protect the commas from ffmpeg's filter parser.
pub fn crop_and_scale_filter(aspect_ratio: &str, crop_x: f64, crop_y: f64) -> String {
    let ratio = normalize_aspect_ratio(aspect_ratio);
    let a = match ratio {
        "1:1" => 1.0,
        "16:9" => 16.0 / 9.0,
        "4:5" => 4.0 / 5.0,
        _ => 9.0 / 16.0,
    };
    let crop_x = clamp_crop(crop_x);
    let crop_y = clamp_crop(crop_y);
    let (width, height) = clip_dimensions(ratio);
    format!(
        "crop=w='2*trunc(min(iw,ih*{a})/2)':h='2*trunc(min(ih,iw/{a})/2)':\
         x='(iw-ow)*{crop_x}':y='(ih-oh)*{crop_y}',\
         scale={width}:{height}:flags=fast_bilinear"
    )
}

/// Height cap for the editor preview proxy. Small enough to encode the whole
/// source in roughly a minute, large enough to judge the crop.
pub const PREVIEW_HEIGHT: i64 = 480;

/// Downscale filter for the preview proxy, preserving aspect ratio and
/// keeping both dimensions even (required by VP8).
fn preview_scale_filter() -> String {
    format!(
        "scale=w='min(854,iw)':h='min({PREVIEW_HEIGHT},ih)':\
         force_original_aspect_ratio=decrease:force_divisible_by=2:\
         flags=fast_bilinear"
    )
}

/// ffmpeg arguments that transcode the whole source into a WebM proxy.
///
/// WebKitGTK can only decode what the installed GStreamer plugins provide, and
/// a stock Ubuntu install ships no H.264/AAC decoders, so a source MP4 simply
/// does not play inside the webview. A VP8/Opus WebM proxy does play with the
/// `vpx`, `matroska` and `opus` plugins that are present everywhere.
///
/// The proxy covers the entire media instead of a single clip window so one
/// encode serves every candidate of a project and the editor can seek freely.
/// Settings trade quality for speed: `deadline realtime` with `cpu-used 16`
/// encodes around 8x realtime on a laptop CPU.
pub fn preview_proxy_args(source_path: &str, output_path: &Path) -> Vec<String> {
    vec![
        "-y".into(),
        "-i".into(),
        source_path.to_string(),
        "-map".into(),
        "0:v:0".into(),
        "-map".into(),
        "0:a:0?".into(),
        "-vf".into(),
        preview_scale_filter(),
        "-r".into(),
        "20".into(),
        "-c:v".into(),
        "libvpx".into(),
        "-b:v".into(),
        "550k".into(),
        "-deadline".into(),
        "realtime".into(),
        "-cpu-used".into(),
        "16".into(),
        "-row-mt".into(),
        "1".into(),
        "-threads".into(),
        "4".into(),
        "-g".into(),
        "40".into(),
        "-c:a".into(),
        "libopus".into(),
        "-b:a".into(),
        "48k".into(),
        "-ac".into(),
        "1".into(),
        "-f".into(),
        "webm".into(),
        output_path.to_string_lossy().to_string(),
    ]
}

/// Transcode the whole source into a WebM preview proxy, reporting 0..=100
/// progress against `duration_sec`.
pub fn render_preview_proxy(
    source_path: &str,
    output_path: &Path,
    duration_sec: Option<f64>,
    mut on_progress: impl FnMut(f64),
) -> Result<PathBuf> {
    if !command_exists("ffmpeg") {
        return Err(anyhow!("ffmpeg is not installed or not available on PATH"));
    }

    let output_path = absolute_path(output_path);
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let duration = duration_sec.filter(|value| value.is_finite() && *value > 0.0);
    let args = preview_proxy_args(source_path, &output_path);
    run_ffmpeg_with_progress(&args, duration, None, &mut on_progress)?;
    Ok(output_path)
}

/// Width cap for candidate thumbnails in the clip list.
pub const THUMB_WIDTH: i64 = 360;

/// ffmpeg arguments that grab one frame as a small JPEG thumbnail.
///
/// `-ss` sits before `-i` so ffmpeg seeks by index instead of decoding from
/// the start; on a 12 minute source that turns a 4 second job into ~60 ms.
pub fn thumbnail_args(source_path: &str, time_sec: f64, output_path: &Path) -> Vec<String> {
    let timestamp = if time_sec.is_finite() && time_sec > 0.0 {
        time_sec
    } else {
        0.0
    };
    vec![
        "-y".into(),
        "-ss".into(),
        format!("{timestamp:.3}"),
        "-i".into(),
        source_path.to_string(),
        "-frames:v".into(),
        "1".into(),
        "-vf".into(),
        format!("scale=w='min({THUMB_WIDTH},iw)':h=-2:flags=fast_bilinear"),
        "-q:v".into(),
        "5".into(),
        "-an".into(),
        "-f".into(),
        "image2".into(),
        output_path.to_string_lossy().to_string(),
    ]
}

/// Render a single JPEG frame at `time_sec`, returning the written path.
pub fn render_thumbnail(source_path: &str, time_sec: f64, output_path: &Path) -> Result<PathBuf> {
    if !command_exists("ffmpeg") {
        return Err(anyhow!("ffmpeg is not installed or not available on PATH"));
    }

    let output_path = absolute_path(output_path);
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let args = thumbnail_args(source_path, time_sec, &output_path);
    let output = Command::new("ffmpeg")
        .args(&args)
        .output()
        .context("running ffmpeg for a thumbnail")?;
    if !output.status.success() {
        return Err(anyhow!(
            "ffmpeg failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(output_path)
}

/// Options for rendering a single clip.
pub struct ClipRenderRequest<'a> {
    pub source_path: &'a str,
    pub start_sec: f64,
    pub end_sec: f64,
    pub output_path: &'a Path,
    /// Whether the source has a video stream (probed once by the caller).
    pub has_video: bool,
    /// Whether the source has an audio stream (probed once by the caller).
    pub has_audio: bool,
    /// Optional ASS subtitle file burned into the video.
    pub ass_path: Option<&'a Path>,
    /// Target aspect ratio; see [`normalize_aspect_ratio`].
    pub aspect_ratio: &'a str,
    /// Horizontal crop position inside the slack, 0.0..=1.0.
    pub crop_x: f64,
    /// Vertical crop position inside the slack, 0.0..=1.0.
    pub crop_y: f64,
    /// Auto-edit cut list. Empty keeps the single-pass render path.
    pub segments: &'a [RenderSegment],
}

fn absolute_path(path: &Path) -> PathBuf {
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(path))
            .unwrap_or_else(|_| path.to_path_buf())
    }
}

/// Build the `ass` filter argument for a subtitle file.
///
/// The file is referenced by its bare name and ffmpeg's working directory is
/// set to the file's folder, which avoids `:`/`\` path escaping problems on
/// every platform (Windows drive letters included).
fn ass_filter_arg(ass_path: &Path) -> Option<String> {
    let name = ass_path.file_name()?.to_string_lossy().to_string();
    if name.is_empty() {
        return None;
    }
    let escaped: String = name
        .chars()
        .map(|c| match c {
            ':' | '\'' | ',' | '[' | ']' | ';' | '\\' => format!("\\{c}"),
            other => other.to_string(),
        })
        .collect();
    Some(format!("ass=filename={escaped}"))
}

/// Render a 9:16 clip, reporting clip-level 0..=100 progress.
pub fn render_flat_clip(
    request: &ClipRenderRequest<'_>,
    mut on_progress: impl FnMut(f64),
) -> Result<PathBuf> {
    if !command_exists("ffmpeg") {
        return Err(anyhow!("ffmpeg is not installed or not available on PATH"));
    }

    let output_path = absolute_path(request.output_path);
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let duration_sec = if request.segments.is_empty() {
        (request.end_sec - request.start_sec).max(0.1)
    } else {
        request
            .segments
            .iter()
            .map(RenderSegment::output_len)
            .sum::<f64>()
            .max(0.1)
    };

    // Normalize the ffmpeg progress stream (absolute media time) to the
    // 0..=100 window of this specific clip. `-ss` seeks before input
    // decoding, so reported positions already start near zero here.
    let mut on_clip_progress = move |percentage: f64| on_progress(percentage.clamp(0.0, 100.0));

    // Use the GPU encoder when one was detected *and* validated at startup.
    // A GPU that disappears (driver update, eGPU unplug, WSL passthrough lost)
    // demotes the whole process to libx264 instead of failing the batch.
    let encoder = hardware::active_video_encoder();
    match run_clip_ffmpeg(
        request,
        encoder,
        &output_path,
        duration_sec,
        &mut on_clip_progress,
    ) {
        Ok(()) => Ok(output_path),
        Err(error) if encoder.is_hardware() => {
            eprintln!(
                "[autoshorts] {} render failed ({}); retrying with libx264",
                encoder.id(),
                error
            );
            hardware::mark_video_encoder_failed(encoder);
            run_clip_ffmpeg(
                request,
                hardware::VideoEncoder::Libx264,
                &output_path,
                duration_sec,
                &mut on_clip_progress,
            )?;
            Ok(output_path)
        }
        Err(error) => Err(error),
    }
}

/// Build and run the ffmpeg command for one clip with the given encoder.
fn run_clip_ffmpeg(
    request: &ClipRenderRequest<'_>,
    encoder: hardware::VideoEncoder,
    output_path: &Path,
    duration_sec: f64,
    on_progress: &mut dyn FnMut(f64),
) -> Result<()> {
    let plan = hardware::plan(encoder);

    let source_path = absolute_path(Path::new(request.source_path));
    let source_arg = source_path.to_string_lossy().to_string();
    let output_arg = output_path.to_string_lossy().to_string();
    let start = format!("{:.3}", request.start_sec);

    let segments = relative_segments(request);
    let auto_edit = !segments.is_empty()
        && (segments.len() > 1
            || (segments[0].speed - 1.0).abs() > 1e-3
            || segments[0].zoom > 1.0 + 1e-9);

    // The trim filters index into the *source* window, so with a cut list the
    // input has to stay readable past the (shorter) output duration.
    let input_duration = if auto_edit {
        segments
            .iter()
            .map(|segment| segment.end)
            .fold(0.0_f64, f64::max)
            .max(0.1)
    } else {
        duration_sec
    };
    let duration = format!("{input_duration:.3}");

    let mut cmd = Command::new("ffmpeg");
    cmd.args(&plan.pre_input);
    cmd.args(["-y", "-ss", &start, "-i", &source_arg, "-t", &duration]);

    let mut ass_dir: Option<PathBuf> = None;
    let mut ass_filter: Option<String> = None;
    if let Some(ass_path) = request.ass_path {
        let ass_path = absolute_path(ass_path);
        if let Some(parent) = ass_path.parent() {
            ass_dir = Some(parent.to_path_buf());
        }
        ass_filter = ass_filter_arg(&ass_path);
    }

    if auto_edit {
        // Cut list path: trim every kept span, retime the accelerated ones and
        // concatenate them back into one continuous clip. Captions were already
        // remapped onto this compressed timeline by the caller.
        let graph = auto_edit_filter_graph(request, &segments, ass_filter.as_deref(), plan.filter_suffix);
        if graph.is_empty() {
            return Err(anyhow!("auto-edit produced an empty filter graph"));
        }
        cmd.args(["-filter_complex", &graph]);
        if request.has_video {
            cmd.args(["-map", "[vout]"]);
            cmd.args(&plan.codec);
        } else {
            cmd.arg("-vn");
        }
        if request.has_audio {
            cmd.args(["-map", "[ca]"]);
        }
    } else if request.has_video {
        let mut filters = vec![crop_and_scale_filter(
            request.aspect_ratio,
            request.crop_x,
            request.crop_y,
        )];

        if let Some(filter) = ass_filter {
            filters.push(filter);
        }

        let mut filter_chain = filters.join(",");
        // VA-API needs frames uploaded to the device before encoding.
        filter_chain.push_str(plan.filter_suffix);

        cmd.args(["-vf", &filter_chain]);
        cmd.args(&plan.codec);
    } else {
        cmd.arg("-vn");
    }

    cmd.args(["-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"]);
    cmd.arg(&output_arg);

    let args: Vec<String> = cmd
        .get_args()
        .map(|arg| arg.to_string_lossy().to_string())
        .collect();

    // `-progress` output is absolute media time, but `-ss` seeks before input
    // decoding, so reported positions already start near zero for this clip.
    run_ffmpeg_with_progress(&args, Some(duration_sec), ass_dir.as_deref(), on_progress)
}

/// Rewrite plan segments into the `-ss`-relative timeline used by the filters.
fn relative_segments(request: &ClipRenderRequest<'_>) -> Vec<RenderSegment> {
    let window = (request.end_sec - request.start_sec).max(0.1);
    request
        .segments
        .iter()
        .map(|segment| RenderSegment {
            start: (segment.start - request.start_sec).clamp(0.0, window),
            end: (segment.end - request.start_sec).clamp(0.0, window),
            speed: segment.speed.clamp(0.5, 4.0),
            zoom: segment.zoom.clamp(1.0, 1.4),
        })
        .filter(|segment| segment.end - segment.start > 0.01)
        .collect()
}

/// Build the `-filter_complex` graph that replays an auto-edit cut list.
///
/// Every kept span becomes a `trim`/`atrim` pair (plus `setpts`/`atempo` when
/// retimed), all spans are concatenated, and the crop/caption chain runs once on
/// the joined result so the framing stays identical across cuts. Punch-in zoom
/// is the exception: it must be baked per segment, before the concat.
fn auto_edit_filter_graph(
    request: &ClipRenderRequest<'_>,
    segments: &[RenderSegment],
    ass_filter: Option<&str>,
    filter_suffix: &str,
) -> String {
    let count = segments.len();
    let punch_per_segment = request.has_video && segments.iter().any(|segment| segment.zoom > 1.0 + 1e-9);
    let mut chains: Vec<String> = Vec::new();
    let mut concat_inputs = String::new();

    for (index, segment) in segments.iter().enumerate() {
        let start = format!("{:.3}", segment.start);
        let end = format!("{:.3}", segment.end);
        let speed = segment.speed.max(0.5);

        if request.has_video {
            let mut chain = format!(
                "[0:v]trim=start={start}:end={end},setpts=(PTS-STARTPTS)/{speed:.4}"
            );
            if punch_per_segment {
                chain.push(',');
                chain.push_str(&crop_and_scale_filter(
                    request.aspect_ratio,
                    request.crop_x,
                    request.crop_y,
                ));
                if segment.zoom > 1.0 + 1e-9 {
                    let (width, height) = clip_dimensions(request.aspect_ratio);
                    chain.push_str(&format!(
                        ",scale=iw*{:.4}:ih*{:.4}:flags=fast_bilinear,crop={width}:{height}",
                        segment.zoom, segment.zoom
                    ));
                }
            }
            chain.push_str(&format!("[v{index}]"));
            chains.push(chain);
            concat_inputs.push_str(&format!("[v{index}]"));
        }

        if request.has_audio {
            let mut chain = format!("[0:a]atrim=start={start}:end={end},asetpts=PTS-STARTPTS");
            if (speed - 1.0).abs() > 1e-3 {
                chain.push_str(&format!(",atempo={speed:.4}"));
            }
            chain.push_str(&format!("[a{index}]"));
            chains.push(chain);
            concat_inputs.push_str(&format!("[a{index}]"));
        }
    }

    if chains.is_empty() {
        return String::new();
    }

    let mut graph = chains.join(";");
    graph.push(';');
    match (request.has_video, request.has_audio) {
        (true, true) => graph.push_str(&format!(
            "{concat_inputs}concat=n={count}:v=1:a=1[cv][ca]"
        )),
        (true, false) => graph.push_str(&format!(
            "{concat_inputs}concat=n={count}:v=1:a=0[cv]"
        )),
        (false, true) => graph.push_str(&format!(
            "{concat_inputs}concat=n={count}:v=0:a=1[ca]"
        )),
        (false, false) => return String::new(),
    }

    if request.has_video {
        let mut filters: Vec<String> = Vec::new();
        if !punch_per_segment {
            filters.push(crop_and_scale_filter(
                request.aspect_ratio,
                request.crop_x,
                request.crop_y,
            ));
        }
        if let Some(filter) = ass_filter {
            filters.push(filter.to_string());
        }
        let suffix = filter_suffix.trim_start_matches(',');
        if !suffix.is_empty() {
            filters.push(suffix.to_string());
        }
        if filters.is_empty() {
            graph.push_str(";[cv]null[vout]");
        } else {
            graph.push_str(&format!(";[cv]{}[vout]", filters.join(",")));
        }
    }

    graph
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_microsecond_progress_values() {
        assert_eq!(parse_ffmpeg_progress_time("out_time_us", "1500000"), Some(1.5));
        assert_eq!(parse_ffmpeg_progress_time("out_time_ms", "250000"), Some(0.25));
        assert_eq!(parse_ffmpeg_progress_time("out_time_us", " 1000000 "), Some(1.0));
    }

    #[test]
    fn parses_clock_progress_values() {
        assert_eq!(parse_ffmpeg_progress_time("out_time", "00:01:02.5"), Some(62.5));
        assert_eq!(parse_ffmpeg_progress_time("out_time", "01:00:00"), Some(3600.0));
    }

    #[test]
    fn ignores_unknown_or_invalid_progress_keys() {
        assert_eq!(parse_ffmpeg_progress_time("speed", "1.2x"), None);
        assert_eq!(parse_ffmpeg_progress_time("out_time_us", "not-a-number"), None);
        assert_eq!(parse_ffmpeg_progress_time("out_time", "bad"), None);
    }

    #[test]
    fn parses_clock_timestamps() {
        assert_eq!(parse_clock_timestamp("00:00:00.000"), Some(0.0));
        assert_eq!(parse_clock_timestamp("01:02:03"), Some(3723.0));
        assert_eq!(parse_clock_timestamp("02:03"), None);
    }

    #[test]
    fn escapes_ass_filter_special_characters() {
        let arg = ass_filter_arg(Path::new("/tmp/a:b,c[d];e\\f.ass")).unwrap();
        assert_eq!(arg, "ass=filename=a\\:b\\,c\\[d\\]\\;e\\\\f.ass");
    }

    #[test]
    fn ass_filter_arg_uses_bare_file_name() {
        let arg = ass_filter_arg(Path::new("/home/user/project/captions.ass")).unwrap();
        assert_eq!(arg, "ass=filename=captions.ass");
    }

    #[test]
    fn ass_filter_arg_returns_none_without_file_name() {
        assert_eq!(ass_filter_arg(Path::new("/")), None);
    }

    #[test]
    fn absolute_path_keeps_absolute_paths() {
        assert_eq!(absolute_path(Path::new("/tmp/clip.mp4")), PathBuf::from("/tmp/clip.mp4"));
    }

    #[test]
    fn absolute_path_resolves_relative_paths() {
        assert!(absolute_path(Path::new("clip.mp4")).is_absolute());
    }

    #[test]
    fn clip_dimensions_match_aspect_ratio_table() {
        assert_eq!(clip_dimensions("9:16"), (1080, 1920));
        assert_eq!(clip_dimensions("1:1"), (1080, 1080));
        assert_eq!(clip_dimensions("16:9"), (1920, 1080));
        assert_eq!(clip_dimensions("4:5"), (1080, 1350));
        assert_eq!(clip_dimensions("unknown"), (1080, 1920));
    }

    #[test]
    fn normalize_aspect_ratio_accepts_aliases_and_falls_back() {
        assert_eq!(normalize_aspect_ratio("1:1"), "1:1");
        assert_eq!(normalize_aspect_ratio("1x1"), "1:1");
        assert_eq!(normalize_aspect_ratio("Square"), "1:1");
        assert_eq!(normalize_aspect_ratio(" 16:9 "), "16:9");
        assert_eq!(normalize_aspect_ratio("4:5"), "4:5");
        assert_eq!(normalize_aspect_ratio(""), DEFAULT_ASPECT_RATIO);
        assert_eq!(normalize_aspect_ratio("3:2"), DEFAULT_ASPECT_RATIO);
    }

    #[test]
    fn crop_and_scale_filter_builds_landscape_chain() {
        let filter = crop_and_scale_filter("16:9", 0.0, 1.0);
        assert!(filter.starts_with("crop=w='2*trunc(min(iw,ih*"), "{filter}");
        assert!(filter.contains("x='(iw-ow)*0'"), "{filter}");
        assert!(filter.contains("y='(ih-oh)*1'"), "{filter}");
        assert!(filter.contains("scale=1920:1080:flags=fast_bilinear"), "{filter}");
    }

    #[test]
    fn crop_and_scale_filter_clamps_positions() {
        let filter = crop_and_scale_filter("9:16", -3.0, f64::NAN);
        assert!(filter.contains("x='(iw-ow)*0'"), "{filter}");
        assert!(filter.contains("y='(ih-oh)*0.5'"), "{filter}");
        assert!(filter.contains("scale=1080:1920:flags=fast_bilinear"), "{filter}");
    }

    #[test]
    fn preview_proxy_args_target_webm_vp8_opus() {
        let args = preview_proxy_args("/media/source.mp4", Path::new("/tmp/preview.webm"));
        let joined = args.join(" ");
        // The proxy covers the whole media, so no trim flags are emitted.
        assert!(!joined.contains("-ss "), "{joined}");
        assert!(!joined.contains("-t "), "{joined}");
        assert!(joined.contains("-map 0:a:0?"), "{joined}");
        assert!(joined.contains("-c:v libvpx"), "{joined}");
        assert!(joined.contains("-c:a libopus"), "{joined}");
        assert!(joined.contains("-f webm"), "{joined}");
        assert!(joined.contains("force_divisible_by=2"), "{joined}");
        assert!(args.last().unwrap().ends_with("preview.webm"), "{joined}");
    }

    #[test]
    fn thumbnail_args_seek_before_input_and_scale_down() {
        let args = thumbnail_args("/media/source.mp4", 12.5, Path::new("/tmp/thumb.jpg"));
        let joined = args.join(" ");
        let seek = args.iter().position(|arg| arg == "-ss").unwrap();
        let input = args.iter().position(|arg| arg == "-i").unwrap();
        assert!(seek < input, "{joined}");
        assert!(joined.contains("12.500"), "{joined}");
        assert!(joined.contains("-frames:v 1"), "{joined}");
        assert!(joined.contains("-an"), "{joined}");
        assert!(joined.contains("min(360,iw)"), "{joined}");
        assert!(args.last().unwrap().ends_with("thumb.jpg"), "{joined}");
    }

    #[test]
    fn command_exists_rejects_missing_binary() {
        assert!(!command_exists("autoshorts-definitely-missing-binary"));
    }
}
