use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentStatus {
    pub data_dir: String,
    pub has_ffmpeg: bool,
    pub has_ffprobe: bool,
    pub has_deepgram_key: bool,
    pub has_anthropic_key: bool,
    pub has_deepseek_key: bool,
    pub has_gemini_key: bool,
    pub has_openai_key: bool,
    pub has_openrouter_key: bool,
    pub has_groq_key: bool,
    pub has_openai_compatible_key: bool,
    pub openai_base_url: Option<String>,
    pub llm_provider: String,
    pub has_local_whisper_model: bool,
    pub has_ollama: bool,
    pub has_ytdlp: bool,
    /// True when a hardware video encoder was detected and probed successfully.
    pub gpu_accel: bool,
    /// Human-readable name of the encoder actually used for clip rendering.
    pub video_encoder: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaProbe {
    pub duration_sec: Option<f64>,
    pub has_video: bool,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: Option<String>,
    pub source_path: String,
    pub source_duration: Option<f64>,
    pub status: String,
    pub transcription_mode: String,
    pub caption_style: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transcript {
    pub id: String,
    pub project_id: String,
    pub engine: String,
    pub raw_json: String,
    pub language: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub id: String,
    pub project_id: String,
    pub start_sec: f64,
    pub end_sec: f64,
    pub score: f64,
    pub hook: String,
    pub rationale: String,
    pub rank: i64,
    pub selected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub id: String,
    pub candidate_id: String,
    pub status: String,
    pub output_path: Option<String>,
    pub face_track_json: Option<String>,
    pub caption_ass_path: Option<String>,
    pub render_log: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipCopy {
    pub id: String,
    pub clip_id: String,
    pub platform: String,
    pub hook_text: Option<String>,
    pub caption_text: Option<String>,
    pub hashtags: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDetail {
    pub project: Project,
    pub transcript: Option<Transcript>,
    pub candidates: Vec<Candidate>,
    pub clips: Vec<Clip>,
    pub copy: Vec<ClipCopy>,
    pub clip_edits: Vec<ClipEdit>,
}

/// One editable caption line, timed against the *source* media.
///
/// Times are absolute source seconds (not clip-relative) so the preview player
/// can compare them against `video.currentTime` without extra math.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionCue {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

/// Per-candidate framing and caption overrides applied at render time.
///
/// `crop_x`/`crop_y` are the position of the crop window inside the available
/// slack, normalized to 0..=1 (0.5 = centered).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipEdit {
    pub candidate_id: String,
    pub aspect_ratio: String,
    pub crop_x: f64,
    pub crop_y: f64,
    /// Empty means "derive captions from the transcript".
    #[serde(default)]
    pub captions: Vec<CaptionCue>,
    pub caption_style: Option<String>,
    /// Fine-grained caption look; overrides the preset named by
    /// `caption_style` field by field.
    #[serde(default)]
    pub caption_override: Option<CaptionStyleOverride>,
    /// Automatic tight-cut settings (silence removal + pacing).
    #[serde(default)]
    pub auto_edit: Option<AutoEditSettings>,
}

/// Auto-edit knobs for one clip.
///
/// `silence_mode` decides what happens to a detected pause: `cut` removes it
/// (jump cut) while `speed` keeps it but plays it faster, which reads as a
/// natural time-lapse instead of a hard jump.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoEditSettings {
    #[serde(default)]
    pub enabled: bool,
    /// Loudness below which audio counts as silence, in dBFS.
    #[serde(default = "default_silence_threshold_db")]
    pub silence_threshold_db: f64,
    /// Shortest pause worth touching, in seconds.
    #[serde(default = "default_min_silence_sec")]
    pub min_silence_sec: f64,
    /// Audio kept on each side of a cut, so consonants are not clipped.
    #[serde(default = "default_padding_sec")]
    pub padding_sec: f64,
    /// `cut` or `speed`.
    #[serde(default = "default_silence_mode")]
    pub silence_mode: String,
    /// Playback rate used when `silence_mode` is `speed`.
    #[serde(default = "default_silence_speed")]
    pub silence_speed: f64,
    /// Alternating punch-in zoom on speech segments; 1.0 disables it.
    #[serde(default = "default_punch_in_zoom")]
    pub punch_in_zoom: f64,
}

fn default_silence_threshold_db() -> f64 {
    -32.0
}

fn default_min_silence_sec() -> f64 {
    0.45
}

fn default_padding_sec() -> f64 {
    0.08
}

fn default_silence_mode() -> String {
    "cut".to_string()
}

fn default_silence_speed() -> f64 {
    1.6
}

fn default_punch_in_zoom() -> f64 {
    1.0
}

impl Default for AutoEditSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            silence_threshold_db: default_silence_threshold_db(),
            min_silence_sec: default_min_silence_sec(),
            padding_sec: default_padding_sec(),
            silence_mode: default_silence_mode(),
            silence_speed: default_silence_speed(),
            punch_in_zoom: default_punch_in_zoom(),
        }
    }
}

impl AutoEditSettings {
    /// True when detected pauses should be kept and accelerated.
    pub fn keeps_silence(&self) -> bool {
        self.silence_mode == "speed"
    }

    /// Clamp every value into a range the renderer can honour.
    pub fn sanitized(mut self) -> Self {
        self.silence_threshold_db = clamp_finite(self.silence_threshold_db, -60.0, -8.0, -32.0);
        self.min_silence_sec = clamp_finite(self.min_silence_sec, 0.15, 5.0, 0.45);
        self.padding_sec = clamp_finite(self.padding_sec, 0.0, 0.5, 0.08);
        self.silence_speed = clamp_finite(self.silence_speed, 1.1, 4.0, 1.6);
        self.punch_in_zoom = clamp_finite(self.punch_in_zoom, 1.0, 1.4, 1.0);
        let mode = self.silence_mode.trim().to_ascii_lowercase();
        self.silence_mode = if mode == "speed" {
            "speed".to_string()
        } else {
            "cut".to_string()
        };
        self
    }
}

fn clamp_finite(value: f64, min: f64, max: f64, fallback: f64) -> f64 {
    if value.is_finite() {
        value.clamp(min, max)
    } else {
        fallback
    }
}

/// Caption look edited in the clip editor.
///
/// Every field is optional: `None` keeps whatever the selected preset
/// (`ClipEdit::caption_style`) defines, so a preset change still affects
/// untouched properties.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CaptionStyleOverride {
    /// Font family name, as known to fontconfig/libass.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    /// Font size in ASS canvas units (PlayResY = 1920).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_size: Option<f64>,
    /// Text colour as `#RRGGBB`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_color: Option<String>,
    /// Outline colour as `#RRGGBB`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outline_color: Option<String>,
    /// Box / shadow colour as `#RRGGBB`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub box_color: Option<String>,
    /// 1 = outline + shadow, 3 = opaque box behind the text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border_style: Option<u8>,
    /// Outline width, in ASS canvas units.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outline: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bold: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uppercase: Option<bool>,
    /// Vertical anchor of the caption block: 0.0 = top, 1.0 = bottom.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<f64>,
    /// Caption block width as a fraction of the frame width, 0.1..=1.0.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_width: Option<f64>,
}

impl CaptionStyleOverride {
    /// Clamp every supplied value into a range the ASS renderer can honour.
    pub fn sanitized(mut self) -> Self {
        self.font_family = self
            .font_family
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        self.font_size = self
            .font_size
            .filter(|value| value.is_finite())
            .map(|value| value.clamp(24.0, 200.0));
        self.text_color = sanitize_hex(self.text_color);
        self.outline_color = sanitize_hex(self.outline_color);
        self.box_color = sanitize_hex(self.box_color);
        self.border_style = self.border_style.map(|value| if value == 3 { 3 } else { 1 });
        self.outline = self
            .outline
            .filter(|value| value.is_finite())
            .map(|value| value.clamp(0.0, 20.0));
        self.position = self
            .position
            .filter(|value| value.is_finite())
            .map(|value| value.clamp(0.0, 1.0));
        self.max_width = self
            .max_width
            .filter(|value| value.is_finite())
            .map(|value| value.clamp(0.2, 1.0));
        self
    }
}

/// Keep `#RRGGBB` values, drop anything else.
fn sanitize_hex(value: Option<String>) -> Option<String> {
    let value = value?.trim().to_string();
    let hex = value.strip_prefix('#').unwrap_or(&value);
    if hex.len() == 6 && hex.chars().all(|c| c.is_ascii_hexdigit()) {
        Some(format!("#{}", hex.to_ascii_uppercase()))
    } else {
        None
    }
}

impl ClipEdit {
    pub fn default_for(candidate_id: &str) -> Self {
        Self {
            candidate_id: candidate_id.to_string(),
            aspect_ratio: crate::media::DEFAULT_ASPECT_RATIO.to_string(),
            crop_x: 0.5,
            crop_y: 0.5,
            captions: Vec::new(),
            caption_style: None,
            caption_override: None,
            auto_edit: None,
        }
    }

    /// Clamp user-supplied values into ranges the renderer can honour.
    pub fn sanitized(mut self) -> Self {
        self.aspect_ratio = crate::media::normalize_aspect_ratio(&self.aspect_ratio).to_string();
        self.crop_x = clamp_unit(self.crop_x);
        self.crop_y = clamp_unit(self.crop_y);
        self.caption_style = self
            .caption_style
            .map(|style| style.trim().to_string())
            .filter(|style| !style.is_empty());
        self.caption_override = self.caption_override.map(|value| value.sanitized());
        self.auto_edit = self.auto_edit.map(|value| value.sanitized());
        self.captions.retain(|cue| cue.end > cue.start && !cue.text.trim().is_empty());
        self
    }
}

fn clamp_unit(value: f64) -> f64 {
    if value.is_finite() {
        value.clamp(0.0, 1.0)
    } else {
        0.5
    }
}

/// Payload for the clip editor: saved overrides plus the captions to show.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipEditor {
    pub candidate: Candidate,
    pub source_path: String,
    pub edit: ClipEdit,
    /// Saved cues when the user edited them, otherwise the auto-generated ones.
    pub cues: Vec<CaptionCue>,
    pub caption_style: String,
    /// Source video dimensions, when ffprobe could read them.
    pub source_width: Option<i64>,
    pub source_height: Option<i64>,
    /// Total source duration, so the editor can extend the clip window.
    pub source_duration_sec: Option<f64>,
    /// Source codecs: the UI asks the webview whether it can decode them and
    /// falls back to a transcoded preview proxy when it cannot.
    pub source_video_codec: Option<String>,
    pub source_audio_codec: Option<String>,
}

/// One still frame of a candidate, shown in the clip list.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateThumbnail {
    pub candidate_id: String,
    pub path: String,
    /// Loopback HTTP URL the `<img>` element can open.
    pub url: String,
    /// Source time of the frame, in seconds.
    pub time_sec: f64,
}

/// Transcoded preview of the whole source, playable inside the webview.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipPreview {
    pub path: String,
    /// Loopback HTTP URL the `<video>` element can actually open.
    ///
    /// `asset://` is not understood by WebKitGTK's media pipeline, so the
    /// backend serves the file over `http://127.0.0.1:<port>` instead.
    pub url: String,
    /// Absolute source time of the first frame of the proxy (always 0).
    pub start_sec: f64,
    /// Absolute source time of the last frame of the proxy.
    pub end_sec: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedTranscript {
    pub language: String,
    pub duration: f64,
    pub speakers: Vec<String>,
    pub words: Vec<TranscriptWord>,
    pub segments: Vec<TranscriptSegment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptWord {
    pub text: String,
    pub start: f64,
    pub end: f64,
    pub speaker: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSegment {
    pub start: f64,
    pub end: f64,
    pub speaker: Option<String>,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateDraft {
    pub start: f64,
    pub end: f64,
    pub score: f64,
    pub hook: String,
    pub rationale: String,
}
