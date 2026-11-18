//! Runtime detection of GPU acceleration.
//!
//! Nothing here is required for the app to work: every lookup is best-effort and
//! falls back to the CPU implementation. Detection happens once per process and
//! is validated with a real probe (a tiny test encode for ffmpeg encoders, a
//! `torch` query for Whisper), because an encoder can be compiled into ffmpeg
//! while no usable GPU is present.
//!
//! Environment overrides:
//! - `AUTOSHORTS_VIDEO_ENCODER=x264|nvenc|videotoolbox|amf|vaapi` forces an encoder.
//! - `AUTOSHORTS_DISABLE_GPU=1` forces the CPU encoder.
//! - `AUTOSHORTS_WHISPER_DEVICE=cpu|cuda|mps` forces the Whisper device.

use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

/// Hardware video encoders we know how to drive, plus the CPU baseline.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VideoEncoder {
    Libx264,
    Nvenc,
    VideoToolbox,
    Amf,
    Vaapi,
}

impl VideoEncoder {
    pub fn id(self) -> &'static str {
        match self {
            VideoEncoder::Libx264 => "libx264",
            VideoEncoder::Nvenc => "h264_nvenc",
            VideoEncoder::VideoToolbox => "h264_videotoolbox",
            VideoEncoder::Amf => "h264_amf",
            VideoEncoder::Vaapi => "h264_vaapi",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            VideoEncoder::Libx264 => "libx264 (CPU)",
            VideoEncoder::Nvenc => "h264_nvenc (NVIDIA GPU)",
            VideoEncoder::VideoToolbox => "h264_videotoolbox (Apple GPU)",
            VideoEncoder::Amf => "h264_amf (AMD GPU)",
            VideoEncoder::Vaapi => "h264_vaapi (VA-API GPU)",
        }
    }

    pub fn is_hardware(self) -> bool {
        !matches!(self, VideoEncoder::Libx264)
    }
}

/// ffmpeg arguments that a given encoder requires.
pub struct EncoderPlan {
    /// Global options that must precede the input (e.g. `-vaapi_device`).
    pub pre_input: Vec<String>,
    /// Codec options (`-c:v ...`).
    pub codec: Vec<String>,
    /// Filter-chain suffix needed before the encoder accepts frames.
    pub filter_suffix: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HardwareInfo {
    /// Best encoder that actually works on this machine (CPU when none).
    pub video_encoder: VideoEncoder,
    /// Render node used for VA-API, when that is the selected backend.
    pub vaapi_device: Option<String>,
}

static INFO: OnceLock<HardwareInfo> = OnceLock::new();
static ENCODER_FAILED: AtomicBool = AtomicBool::new(false);
static WHISPER_DEVICE: OnceLock<String> = OnceLock::new();

/// Parse a user-supplied encoder name. Returns `None` for unknown values.
pub fn parse_encoder_override(value: &str) -> Option<VideoEncoder> {
    match value.trim().to_lowercase().as_str() {
        "" => None,
        "x264" | "libx264" | "cpu" => Some(VideoEncoder::Libx264),
        "nvenc" | "h264_nvenc" | "cuda" => Some(VideoEncoder::Nvenc),
        "videotoolbox" | "vt" | "h264_videotoolbox" => Some(VideoEncoder::VideoToolbox),
        "amf" | "h264_amf" => Some(VideoEncoder::Amf),
        "vaapi" | "h264_vaapi" => Some(VideoEncoder::Vaapi),
        _ => None,
    }
}

/// Map the output of the torch probe onto a Whisper device name.
pub fn parse_torch_device(output: &str) -> &'static str {
    let trimmed = output.trim().to_lowercase();
    if trimmed.starts_with("cuda") {
        "cuda"
    } else if trimmed.starts_with("mps") {
        "mps"
    } else {
        "cpu"
    }
}

fn env_flag(name: &str) -> bool {
    std::env::var(name)
        .map(|value| {
            let value = value.trim().to_lowercase();
            !value.is_empty() && value != "0" && value != "false" && value != "no"
        })
        .unwrap_or(false)
}

fn ffmpeg_available() -> bool {
    Command::new("ffmpeg")
        .arg("-version")
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

fn encoder_is_compiled_in(encoders_listing: &str, encoder: VideoEncoder) -> bool {
    encoders_listing.contains(encoder.id())
}

/// First `/dev/dri/renderD*` node, used by VA-API.
fn find_vaapi_device() -> Option<String> {
    let entries = std::fs::read_dir("/dev/dri").ok()?;
    let mut candidates: Vec<String> = entries
        .flatten()
        .map(|entry| entry.path().to_string_lossy().to_string())
        .filter(|path| {
            path.rsplit('/')
                .next()
                .map(|name| name.starts_with("renderD"))
                .unwrap_or(false)
        })
        .collect();
    candidates.sort();
    candidates.into_iter().next()
}

/// Verify the encoder can really encode on this machine, not just that it is
/// compiled into ffmpeg.
fn probe_encoder(encoder: VideoEncoder, vaapi_device: Option<&str>) -> bool {
    let mut cmd = Command::new("ffmpeg");
    cmd.args([
        "-hide_banner",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=256x256:r=30:d=0.2",
    ]);

    match encoder {
        VideoEncoder::Vaapi => {
            let Some(device) = vaapi_device else { return false };
            cmd.args(["-vaapi_device", device]);
            cmd.args(["-vf", "format=nv12,hwupload"]);
            cmd.args(["-c:v", encoder.id(), "-qp", "20"]);
        }
        VideoEncoder::VideoToolbox => {
            cmd.args(["-c:v", encoder.id(), "-allow_sw", "1"]);
        }
        _ => {
            cmd.args(["-c:v", encoder.id(), "-pix_fmt", "yuv420p"]);
        }
    }

    cmd.args(["-f", "null", "-"]);

    match cmd.output() {
        Ok(output) => output.status.success(),
        Err(_) => false,
    }
}

fn detect() -> HardwareInfo {
    let cpu = HardwareInfo {
        video_encoder: VideoEncoder::Libx264,
        vaapi_device: None,
    };

    if env_flag("AUTOSHORTS_DISABLE_GPU") || !ffmpeg_available() {
        return cpu;
    }

    let listing = Command::new("ffmpeg")
        .args(["-hide_banner", "-encoders"])
        .output()
        .map(|out| String::from_utf8_lossy(&out.stdout).to_string())
        .unwrap_or_default();

    let vaapi_device = find_vaapi_device();

    // Prefer the backend that is native to the platform to keep probing cheap.
    let candidates: &[VideoEncoder] = if cfg!(target_os = "macos") {
        &[
            VideoEncoder::VideoToolbox,
            VideoEncoder::Nvenc,
            VideoEncoder::Amf,
            VideoEncoder::Vaapi,
        ]
    } else if cfg!(windows) {
        &[
            VideoEncoder::Nvenc,
            VideoEncoder::Amf,
            VideoEncoder::VideoToolbox,
            VideoEncoder::Vaapi,
        ]
    } else {
        &[
            VideoEncoder::Nvenc,
            VideoEncoder::Vaapi,
            VideoEncoder::Amf,
            VideoEncoder::VideoToolbox,
        ]
    };

    let forced = std::env::var("AUTOSHORTS_VIDEO_ENCODER")
        .ok()
        .and_then(|value| parse_encoder_override(&value));

    let ordered: Vec<VideoEncoder> = match forced {
        Some(VideoEncoder::Libx264) => vec![VideoEncoder::Libx264],
        Some(forced_encoder) => vec![forced_encoder],
        None => candidates.to_vec(),
    };

    for encoder in ordered {
        if encoder == VideoEncoder::Libx264 {
            return cpu;
        }
        if encoder == VideoEncoder::Vaapi && vaapi_device.is_none() {
            continue;
        }
        if !encoder_is_compiled_in(&listing, encoder) {
            continue;
        }
        if probe_encoder(encoder, vaapi_device.as_deref()) {
            return HardwareInfo {
                video_encoder: encoder,
                vaapi_device: if encoder == VideoEncoder::Vaapi {
                    vaapi_device.clone()
                } else {
                    None
                },
            };
        }
    }

    cpu
}

/// Cached hardware profile. Detection runs once per process.
pub fn info() -> &'static HardwareInfo {
    INFO.get_or_init(detect)
}

/// Encoder to use right now: the detected one, or libx264 once a GPU attempt failed.
pub fn active_video_encoder() -> VideoEncoder {
    if ENCODER_FAILED.load(Ordering::Relaxed) {
        VideoEncoder::Libx264
    } else {
        info().video_encoder
    }
}

/// Demote a hardware encoder after a real render failure so the remaining
/// clips in a batch go straight to the CPU path.
pub fn mark_video_encoder_failed(encoder: VideoEncoder) {
    if encoder.is_hardware() {
        ENCODER_FAILED.store(true, Ordering::Relaxed);
        eprintln!(
            "[autoshorts] {} failed at runtime; falling back to libx264",
            encoder.id()
        );
    }
}

/// ffmpeg arguments for the given encoder.
pub fn plan(encoder: VideoEncoder) -> EncoderPlan {
    match encoder {
        VideoEncoder::Libx264 => EncoderPlan {
            pre_input: Vec::new(),
            codec: vec![
                "-c:v".into(),
                "libx264".into(),
                "-preset".into(),
                "veryfast".into(),
                "-crf".into(),
                "20".into(),
                "-pix_fmt".into(),
                "yuv420p".into(),
            ],
            filter_suffix: "",
        },
        VideoEncoder::Nvenc => EncoderPlan {
            pre_input: Vec::new(),
            codec: vec![
                "-c:v".into(),
                "h264_nvenc".into(),
                "-preset".into(),
                "p4".into(),
                "-tune".into(),
                "hq".into(),
                "-rc".into(),
                "vbr".into(),
                "-cq".into(),
                "20".into(),
                "-b:v".into(),
                "0".into(),
                "-pix_fmt".into(),
                "yuv420p".into(),
            ],
            filter_suffix: "",
        },
        VideoEncoder::VideoToolbox => EncoderPlan {
            pre_input: Vec::new(),
            codec: vec![
                "-c:v".into(),
                "h264_videotoolbox".into(),
                "-b:v".into(),
                "8M".into(),
                "-allow_sw".into(),
                "1".into(),
                "-pix_fmt".into(),
                "yuv420p".into(),
            ],
            filter_suffix: "",
        },
        VideoEncoder::Amf => EncoderPlan {
            pre_input: Vec::new(),
            codec: vec![
                "-c:v".into(),
                "h264_amf".into(),
                "-quality".into(),
                "speed".into(),
                "-rc".into(),
                "cqp".into(),
                "-qp_i".into(),
                "20".into(),
                "-qp_p".into(),
                "22".into(),
                "-pix_fmt".into(),
                "yuv420p".into(),
            ],
            filter_suffix: "",
        },
        VideoEncoder::Vaapi => {
            let device = info().vaapi_device.clone().unwrap_or_default();
            if device.is_empty() {
                // No render node: silently use the CPU encoder instead.
                return plan(VideoEncoder::Libx264);
            }
            EncoderPlan {
                pre_input: vec!["-vaapi_device".into(), device],
                codec: vec![
                    "-c:v".into(),
                    "h264_vaapi".into(),
                    "-qp".into(),
                    "20".into(),
                ],
                // VA-API needs system frames uploaded to the device.
                filter_suffix: ",format=nv12,hwupload",
            }
        }
    }
}

/// Device to hand to Whisper: `cuda`, `mps` or `cpu`.
///
/// Uses the Python interpreter's own PyTorch build as the source of truth, so a
/// CPU-only torch install never selects a GPU. Cached after the first probe.
pub fn whisper_device() -> &'static str {
    whisper_device_for(None)
}

/// Like [`whisper_device`], but probes `python` first.
///
/// The interpreter that will actually run Whisper is the only one whose PyTorch
/// build matters, so callers pass it when they know it.
pub fn whisper_device_for(python: Option<&str>) -> &'static str {
    WHISPER_DEVICE.get_or_init(|| {
        if let Ok(forced) = std::env::var("AUTOSHORTS_WHISPER_DEVICE") {
            match parse_torch_device(&forced) {
                "cuda" => return "cuda".to_string(),
                "mps" => return "mps".to_string(),
                _ => return "cpu".to_string(),
            }
        }
        if env_flag("AUTOSHORTS_DISABLE_GPU") {
            return "cpu".to_string();
        }

        const PROBE: &str = "import torch\n\
print('cuda' if torch.cuda.is_available() else ('mps' if getattr(torch.backends, 'mps', None) and torch.backends.mps.is_available() else 'cpu'))\n";

        let mut candidates: Vec<&str> = Vec::new();
        if let Some(bin) = python {
            candidates.push(bin);
        }
        candidates.extend_from_slice(if cfg!(windows) {
            &["python", "py", "python3"]
        } else {
            &["python3", "python"]
        });

        for cmd in candidates {
            if let Ok(output) = Command::new(cmd).args(["-c", PROBE]).output() {
                if output.status.success() {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    return parse_torch_device(&stdout).to_string();
                }
            }
        }
        "cpu".to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_known_encoder_overrides() {
        assert_eq!(parse_encoder_override("nvenc"), Some(VideoEncoder::Nvenc));
        assert_eq!(parse_encoder_override(" NVENC "), Some(VideoEncoder::Nvenc));
        assert_eq!(parse_encoder_override("x264"), Some(VideoEncoder::Libx264));
        assert_eq!(parse_encoder_override("cpu"), Some(VideoEncoder::Libx264));
        assert_eq!(
            parse_encoder_override("h264_vaapi"),
            Some(VideoEncoder::Vaapi)
        );
        assert_eq!(
            parse_encoder_override("videotoolbox"),
            Some(VideoEncoder::VideoToolbox)
        );
        assert_eq!(parse_encoder_override("amf"), Some(VideoEncoder::Amf));
    }

    #[test]
    fn rejects_unknown_encoder_overrides() {
        assert_eq!(parse_encoder_override(""), None);
        assert_eq!(parse_encoder_override("vulkan"), None);
    }

    #[test]
    fn maps_torch_probe_output_to_device() {
        assert_eq!(parse_torch_device("cuda\n"), "cuda");
        assert_eq!(parse_torch_device(" CUDA "), "cuda");
        assert_eq!(parse_torch_device("mps"), "mps");
        assert_eq!(parse_torch_device("cpu"), "cpu");
        assert_eq!(parse_torch_device(""), "cpu");
        assert_eq!(parse_torch_device("Traceback..."), "cpu");
    }

    #[test]
    fn libx264_plan_is_the_cpu_baseline() {
        let plan = plan(VideoEncoder::Libx264);
        assert!(plan.codec.contains(&"libx264".to_string()));
        assert!(plan.codec.contains(&"-crf".to_string()));
        assert!(plan.pre_input.is_empty());
        assert!(plan.filter_suffix.is_empty());
    }

    #[test]
    fn hardware_plans_select_their_encoder() {
        assert!(plan(VideoEncoder::Nvenc)
            .codec
            .contains(&"h264_nvenc".to_string()));
        assert!(plan(VideoEncoder::Amf)
            .codec
            .contains(&"h264_amf".to_string()));
        assert!(plan(VideoEncoder::VideoToolbox)
            .codec
            .contains(&"h264_videotoolbox".to_string()));
    }

    #[test]
    fn vaapi_plan_uploads_frames_and_sets_device() {
        // Without a render node the plan degrades to the CPU encoder.
        let plan = plan(VideoEncoder::Vaapi);
        if info().vaapi_device.is_some() {
            assert!(plan.codec.contains(&"h264_vaapi".to_string()));
            assert_eq!(plan.filter_suffix, ",format=nv12,hwupload");
            assert!(plan.pre_input.contains(&"-vaapi_device".to_string()));
        } else {
            assert!(plan.codec.contains(&"libx264".to_string()));
        }
    }

    #[test]
    fn cpu_encoder_is_not_hardware() {
        assert!(!VideoEncoder::Libx264.is_hardware());
        assert!(VideoEncoder::Nvenc.is_hardware());
    }

    #[test]
    fn detected_encoder_is_stable_across_calls() {
        assert_eq!(active_video_encoder(), active_video_encoder());
    }
}
