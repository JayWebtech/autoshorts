/**
 * Pure helpers behind the pre-render clip editor.
 *
 * Everything here is framework-free so the crop math (which mirrors the
 * ffmpeg filter used by the backend) can be unit tested without booting Tauri.
 */

export type CaptionCue = {
  /** Absolute source time, in seconds. */
  start: number;
  /** Absolute source time, in seconds. */
  end: number;
  text: string;
};

/**
 * Per-clip caption styling on top of a preset.
 *
 * Mirrors `models::CaptionStyleOverride`; every field is optional so a clip
 * only stores what the user actually changed.
 */
export type CaptionStyleOverride = {
  fontFamily?: string | null;
  fontSize?: number | null;
  /** `#RRGGBB`. */
  textColor?: string | null;
  /** `#RRGGBB`. */
  outlineColor?: string | null;
  /** `#RRGGBB`. */
  boxColor?: string | null;
  /** 1 = outline + shadow, 3 = opaque box. */
  borderStyle?: number | null;
  outline?: number | null;
  bold?: boolean | null;
  uppercase?: boolean | null;
  /** 0 = top of the frame, 1 = bottom. */
  position?: number | null;
  /** Max line width as a fraction of the frame width (0.2 - 1). */
  maxWidth?: number | null;
};

export type ClipEdit = {
  candidateId: string;
  aspectRatio: string;
  cropX: number;
  cropY: number;
  captions: CaptionCue[];
  captionStyle: string | null;
  captionOverride?: CaptionStyleOverride | null;
  autoEdit?: AutoEditSettings | null;
};

/** How the renderer treats detected silence. */
export type AutoEditSilenceMode = "cut" | "speed";

/**
 * Per-clip auto-edit settings.
 *
 * Mirrors `models::AutoEditSettings`: the backend detects pauses with
 * ffmpeg `silencedetect`, protects anything the transcript says is spoken, and
 * then either removes the pause (`cut`) or plays it faster (`speed`).
 */
export type AutoEditSettings = {
  enabled: boolean;
  /** dBFS floor below which a stretch counts as silence. */
  silenceThresholdDb: number;
  /** Shortest pause worth touching, in seconds. */
  minSilenceSec: number;
  /** Breathing room kept on each side of a cut, in seconds. */
  paddingSec: number;
  silenceMode: AutoEditSilenceMode;
  /** Playback rate applied to silence in `speed` mode. */
  silenceSpeed: number;
  /** Punch-in factor applied to alternating realtime segments (1 = off). */
  punchInZoom: number;
};

export type ClipEditorCandidate = {
  id: string;
  projectId?: string;
  startSec: number;
  endSec: number;
  score?: number;
  hook?: string;
  rationale?: string;
  rank?: number;
  selected?: boolean;
};

/** Payload returned by `get_clip_editor`. */
export type ClipEditor = {
  candidate: ClipEditorCandidate;
  sourcePath: string;
  edit: ClipEdit;
  cues: CaptionCue[];
  captionStyle: string;
  sourceWidth: number | null;
  sourceHeight: number | null;
  /** Total source duration; bounds the clip window sliders. */
  sourceDurationSec?: number | null;
  sourceVideoCodec?: string | null;
  sourceAudioCodec?: string | null;
};

/** One still frame of a candidate, returned by `prepare_project_thumbnails`. */
export type CandidateThumbnail = {
  candidateId: string;
  path: string;
  /** Loopback HTTP URL for the `<img>` element. */
  url: string;
  timeSec: number;
};

/** Payload returned by `prepare_project_preview`. */
export type ClipPreview = {
  path: string;
  /**
   * Loopback HTTP URL the `<video>` element can open.
   *
   * WebKitGTK's media pipeline does not understand the `asset:` scheme, so the
   * backend serves the proxy over `http://127.0.0.1:<port>` with range support.
   */
  url: string;
  /** Absolute source time of the proxy's first frame. */
  startSec: number;
  /** Absolute source time of the proxy's last frame. */
  endSec: number;
};

export type AspectPreset = {
  id: string;
  label: string;
  width: number;
  height: number;
};

export const DEFAULT_ASPECT_RATIO = "9:16";

/** Output resolutions offered by the backend renderer. */
export const ASPECT_PRESETS: AspectPreset[] = [
  { id: "9:16", label: "9:16 Vertical", width: 1080, height: 1920 },
  { id: "1:1", label: "1:1 Square", width: 1080, height: 1080 },
  { id: "16:9", label: "16:9 Wide", width: 1920, height: 1080 },
  { id: "4:5", label: "4:5 Portrait", width: 1080, height: 1350 },
];

/** Caption style ids understood by the ASS/drawtext builders. */
export const CAPTION_STYLES: Array<{ id: string; label: string }> = [
  { id: "modern-box", label: "Modern Box" },
  { id: "classic-outline", label: "Classic Outline" },
  { id: "minimal-shadow", label: "Minimal Shadow" },
  { id: "vibrant-cyan", label: "Vibrant Cyan" },
  { id: "vibrant-yellow-box", label: "Vibrant Yellow Box" },
  { id: "vibrant-green", label: "Vibrant Green" },
  { id: "vibrant-red", label: "Vibrant Red" },
];

export const DEFAULT_CAPTION_STYLE = "modern-box";

/**
 * Defaults for a fresh auto-edit config; kept in sync with the serde defaults
 * of `models::AutoEditSettings`.
 */
export const DEFAULT_AUTO_EDIT: AutoEditSettings = {
  enabled: false,
  silenceThresholdDb: -32,
  minSilenceSec: 0.45,
  paddingSec: 0.08,
  silenceMode: "cut",
  silenceSpeed: 1.6,
  punchInZoom: 1,
};

/** Clamp ranges the backend enforces, so the UI can never send a rejected value. */
const AUTO_EDIT_LIMITS = {
  silenceThresholdDb: [-60, -8],
  minSilenceSec: [0.15, 5],
  paddingSec: [0, 0.5],
  silenceSpeed: [1.1, 4],
  punchInZoom: [1, 1.4],
} as const;

function clampInRange(value: number | null | undefined, min: number, max: number, fallback: number) {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * Sanitize auto-edit settings the same way `AutoEditSettings::sanitized` does.
 *
 * `null`/`undefined` stays `null` so an untouched clip keeps storing "no
 * auto-edit" instead of a default block nobody asked for.
 */
export function normalizeAutoEdit(
  settings: AutoEditSettings | null | undefined,
): AutoEditSettings | null {
  if (!settings) return null;
  const limits = AUTO_EDIT_LIMITS;
  return {
    enabled: Boolean(settings.enabled),
    silenceThresholdDb: clampInRange(
      settings.silenceThresholdDb,
      limits.silenceThresholdDb[0],
      limits.silenceThresholdDb[1],
      DEFAULT_AUTO_EDIT.silenceThresholdDb,
    ),
    minSilenceSec: clampInRange(
      settings.minSilenceSec,
      limits.minSilenceSec[0],
      limits.minSilenceSec[1],
      DEFAULT_AUTO_EDIT.minSilenceSec,
    ),
    paddingSec: clampInRange(
      settings.paddingSec,
      limits.paddingSec[0],
      limits.paddingSec[1],
      DEFAULT_AUTO_EDIT.paddingSec,
    ),
    silenceMode: settings.silenceMode === "speed" ? "speed" : "cut",
    silenceSpeed: clampInRange(
      settings.silenceSpeed,
      limits.silenceSpeed[0],
      limits.silenceSpeed[1],
      DEFAULT_AUTO_EDIT.silenceSpeed,
    ),
    punchInZoom: clampInRange(
      settings.punchInZoom,
      limits.punchInZoom[0],
      limits.punchInZoom[1],
      DEFAULT_AUTO_EDIT.punchInZoom,
    ),
  };
}

/** One-line description of what auto-edit will do, for the editor summary. */
export function autoEditSummary(settings: AutoEditSettings | null | undefined): string {
  const normalized = normalizeAutoEdit(settings);
  if (!normalized || !normalized.enabled) return "Auto-edit desligado";
  const mode =
    normalized.silenceMode === "speed"
      ? `pausas em ${Number(normalized.silenceSpeed.toFixed(2))}x`
      : "pausas cortadas";
  const punch = normalized.punchInZoom > 1 ? " + zoom dinâmico" : "";
  return `${mode} abaixo de ${normalized.silenceThresholdDb} dB (>= ${normalized.minSilenceSec}s)${punch}`;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Fall back to the default ratio for anything the backend would not accept. */
export function normalizeAspect(ratio: string | null | undefined): string {
  const value = (ratio ?? "").trim();
  const match = ASPECT_PRESETS.find((preset) => preset.id === value);
  return match ? match.id : DEFAULT_ASPECT_RATIO;
}

/** Width / height for a ratio id; unknown ratios fall back to 9:16. */
export function aspectValue(ratio: string | null | undefined): number {
  const preset = ASPECT_PRESETS.find((item) => item.id === normalizeAspect(ratio));
  const resolved = preset ?? ASPECT_PRESETS[0];
  return resolved.width / resolved.height;
}

/**
 * Crop window inside the source frame, in source pixels.
 *
 * Mirrors the ffmpeg expression used by the renderer:
 * `cw = min(iw, ih * a)`, `ch = min(ih, iw / a)`, offset by the normalized
 * slack position.
 */
export function cropGeometry(
  sourceW: number,
  sourceH: number,
  ratio: string,
  cropX: number,
  cropY: number,
): { width: number; height: number; x: number; y: number } {
  if (!Number.isFinite(sourceW) || !Number.isFinite(sourceH) || sourceW <= 0 || sourceH <= 0) {
    return { width: 0, height: 0, x: 0, y: 0 };
  }

  const a = aspectValue(ratio);
  let width: number;
  let height: number;
  if (sourceW / sourceH > a) {
    height = sourceH;
    width = sourceH * a;
  } else {
    width = sourceW;
    height = sourceW / a;
  }

  const x = (sourceW - width) * clamp01(cropX);
  const y = (sourceH - height) * clamp01(cropY);
  return { width, height, x, y };
}

/**
 * CSS `object-position` that reproduces the ffmpeg crop window.
 *
 * The stage is a box with the target aspect ratio and the video covers it
 * (`object-fit: cover`), so the rendered frame is exactly the crop window and
 * `object-position` pans inside the overflow — the same formula ffmpeg uses:
 * `x = (iw - ow) * cropX`. Sizing the video with percentages instead stretched
 * it whenever the stage box was not exactly the target ratio (the `max-height`
 * clamp), which is what made the picture look squeezed.
 */
export function cropObjectPosition(cropX: number, cropY: number): string {
  const x = Math.round(clamp01(cropX) * 1000) / 10;
  const y = Math.round(clamp01(cropY) * 1000) / 10;
  return `${x}% ${y}%`;
}

/**
 * Width cap that keeps a `aspect-ratio` stage inside `maxHeightVh`.
 *
 * Without it the CSS `max-height` clamps the box after the aspect ratio was
 * resolved, which distorts the picture and the caption overlay with it.
 */
export function stageMaxWidth(ratio: string, maxHeightVh: number): string {
  const height = Number.isFinite(maxHeightVh) && maxHeightVh > 0 ? maxHeightVh : 52;
  const width = (height * aspectValue(ratio)).toFixed(4);
  return `calc(${width}vh)`;
}

/** Caption active at an absolute source time, if any. */
export function cueAt(cues: CaptionCue[] | null | undefined, timeSec: number): CaptionCue | null {
  if (!cues || cues.length === 0 || !Number.isFinite(timeSec)) return null;

  // Cues are sorted by start, so a binary search finds the last one that has
  // begun. Scanning the whole array on every `timeupdate` (4x per second per
  // playing clip) was a measurable part of the editor feeling sluggish.
  let low = 0;
  let high = cues.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (cues[mid].start <= timeSec) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  // Walk back over cues that overlap the found one (long lines under short).
  for (let index = found; index >= 0 && index > found - 32; index -= 1) {
    const cue = cues[index];
    if (timeSec >= cue.start && timeSec < cue.end) return cue;
  }
  return null;
}

/** `canPlayType` codec strings for the containers webviews can open. */
const VIDEO_CODEC_MIME: Record<string, string> = {
  h264: "avc1.42E01E",
  hevc: "hvc1.1.6.L93.B0",
  vp8: "vp8",
  vp9: "vp09.00.10.08",
  av1: "av01.0.05M.08",
  mpeg4: "mp4v.20.8",
  theora: "theora",
};

const AUDIO_CODEC_MIME: Record<string, string> = {
  aac: "mp4a.40.2",
  mp3: "mp4a.40.34",
  opus: "opus",
  vorbis: "vorbis",
};

/** Codecs that only exist inside WebM; everything else is probed as MP4. */
const WEBM_VIDEO_CODECS = new Set(["vp8", "vp9", "av1"]);

/**
 * MIME string to hand to `HTMLMediaElement.canPlayType` for a probed source.
 *
 * Returns `null` when the codec is unknown, so callers can fall back to trying
 * the file and only then building a proxy.
 */
export function previewMimeType(
  videoCodec?: string | null,
  audioCodec?: string | null,
): string | null {
  const video = (videoCodec ?? "").trim().toLowerCase();
  if (!video) return null;
  // Unknown codec: we cannot even guess the container, so let the caller try
  // the raw file and fall back to a proxy on error.
  if (!VIDEO_CODEC_MIME[video]) return null;

  const container = WEBM_VIDEO_CODECS.has(video) ? "video/webm" : "video/mp4";
  const videoPart = VIDEO_CODEC_MIME[video];
  const audioPart = AUDIO_CODEC_MIME[(audioCodec ?? "").trim().toLowerCase()];
  const codecs = audioPart ? `${videoPart}, ${audioPart}` : videoPart;
  return `${container}; codecs="${codecs}"`;
}

/**
 * Whether the webview can play the source as-is.
 *
 * `null` means "unknown, just try it": WebKitGTK only decodes codecs its
 * GStreamer plugins provide, and a stock Linux install ships no H.264/AAC
 * decoder, which is exactly the case the preview proxy exists for.
 */
export function canPlayDirectly(
  videoCodec: string | null | undefined,
  audioCodec: string | null | undefined,
  canPlayType: (mime: string) => string,
): boolean | null {
  const mime = previewMimeType(videoCodec, audioCodec);
  if (!mime) return null;
  try {
    return canPlayType(mime) !== "";
  } catch {
    return null;
  }
}

/**
 * Whether the current webview needs a transcoded proxy even when
 * `canPlayType` claims support.
 *
 * WebKitGTK (Linux) answers `canPlayType` from GStreamer container support, so
 * an MP4 source reports "maybe" while the install has no H.264/AAC decoder.
 * Playback then yields a silent black frame with no `error` event, which is
 * why the proxy decision cannot rely on `canPlayType` alone on Linux.
 */
export function needsProxyFor(
  videoCodec: string | null | undefined,
  linuxWebview: boolean,
): boolean {
  if (!linuxWebview) return false;
  const codec = (videoCodec ?? "").trim().toLowerCase();
  return !WEBM_VIDEO_CODECS.has(codec);
}

/** True when running inside WebKitGTK on Linux. */
export function isLinuxWebview(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Linux/i.test(navigator.userAgent);
}

/** Absolute source time -> media time inside the preview. */
export function toPreviewTime(sourceTime: number, offsetSec: number): number {
  const offset = Number.isFinite(offsetSec) ? offsetSec : 0;
  return sourceTime - offset;
}

/** Media time inside the preview -> absolute source time. */
export function toSourceTime(previewTime: number, offsetSec: number): number {
  const offset = Number.isFinite(offsetSec) ? offsetSec : 0;
  return previewTime + offset;
}

/**
 * Drop unusable cues, clamp them into `[minStart, maxEnd]` and sort by start.
 *
 * Used both when loading saved edits and before saving, so the UI never sends
 * the backend something `ClipEdit::sanitized` would have to throw away.
 */
export function clampCues(
  cues: CaptionCue[] | null | undefined,
  minStart: number,
  maxEnd: number,
): CaptionCue[] {
  if (!cues || cues.length === 0) return [];

  const lower = Number.isFinite(minStart) ? minStart : 0;
  const upper = Number.isFinite(maxEnd) ? maxEnd : Number.POSITIVE_INFINITY;

  const result: CaptionCue[] = [];
  for (const cue of cues) {
    const text = (cue?.text ?? "").trim();
    if (!text) continue;
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end)) continue;

    const start = Math.min(upper, Math.max(lower, cue.start));
    const end = Math.min(upper, Math.max(lower, cue.end));
    if (end <= start) continue;

    result.push({ start, end, text });
  }

  return result.sort((left, right) => left.start - right.start);
}

/** Fonts offered in the caption style panel. */
export const FONT_FAMILIES: Array<{ id: string; label: string }> = [
  { id: "Inter", label: "Inter" },
  { id: "DejaVu Sans", label: "DejaVu Sans" },
  { id: "Liberation Sans", label: "Liberation Sans" },
  { id: "Noto Sans", label: "Noto Sans" },
  { id: "Impact", label: "Impact" },
  { id: "Georgia", label: "Georgia" },
  { id: "Courier New", label: "Courier New" },
];

/** Fully resolved style: preset defaults with the clip override applied. */
export type ResolvedCaptionStyle = {
  fontFamily: string;
  fontSize: number;
  textColor: string;
  outlineColor: string;
  boxColor: string;
  borderStyle: number;
  outline: number;
  bold: boolean;
  uppercase: boolean;
  position: number;
  maxWidth: number;
};

/** Style presets keyed by the same ids the backend understands. */
export const CAPTION_PRESET_DEFAULTS: Record<string, ResolvedCaptionStyle> = {
  "modern-box": {
    fontFamily: "Inter",
    fontSize: 81,
    textColor: "#FFFFFF",
    outlineColor: "#000000",
    boxColor: "#000000",
    borderStyle: 3,
    outline: 10,
    bold: true,
    uppercase: true,
    position: 0.76,
    maxWidth: 0.9,
  },
  "classic-outline": {
    fontFamily: "DejaVu Sans",
    fontSize: 78,
    textColor: "#FFFFFF",
    outlineColor: "#000000",
    boxColor: "#000000",
    borderStyle: 1,
    outline: 6,
    bold: true,
    uppercase: true,
    position: 0.82,
    maxWidth: 0.9,
  },
  "minimal-shadow": {
    fontFamily: "DejaVu Sans",
    fontSize: 72,
    textColor: "#FFFFFF",
    outlineColor: "#000000",
    boxColor: "#000000",
    borderStyle: 1,
    outline: 2,
    bold: false,
    uppercase: true,
    position: 0.85,
    maxWidth: 0.9,
  },
  "vibrant-cyan": {
    fontFamily: "Inter",
    fontSize: 84,
    textColor: "#22D3EE",
    outlineColor: "#000000",
    boxColor: "#000000",
    borderStyle: 1,
    outline: 8,
    bold: true,
    uppercase: true,
    position: 0.78,
    maxWidth: 0.9,
  },
  "vibrant-yellow-box": {
    fontFamily: "Inter",
    fontSize: 82,
    textColor: "#111111",
    outlineColor: "#000000",
    boxColor: "#FDE047",
    borderStyle: 3,
    outline: 8,
    bold: true,
    uppercase: true,
    position: 0.78,
    maxWidth: 0.9,
  },
  "vibrant-green": {
    fontFamily: "Inter",
    fontSize: 84,
    textColor: "#4ADE80",
    outlineColor: "#000000",
    boxColor: "#000000",
    borderStyle: 1,
    outline: 8,
    bold: true,
    uppercase: true,
    position: 0.78,
    maxWidth: 0.9,
  },
  "vibrant-red": {
    fontFamily: "Inter",
    fontSize: 84,
    textColor: "#F87171",
    outlineColor: "#000000",
    boxColor: "#000000",
    borderStyle: 1,
    outline: 8,
    bold: true,
    uppercase: true,
    position: 0.78,
    maxWidth: 0.9,
  },
};

/** Effective style: preset defaults with the clip override layered on top. */
export function resolveCaptionStyle(
  presetId: string | null | undefined,
  over: CaptionStyleOverride | null | undefined,
): ResolvedCaptionStyle {
  const base =
    CAPTION_PRESET_DEFAULTS[presetId ?? ""] ?? CAPTION_PRESET_DEFAULTS[DEFAULT_CAPTION_STYLE];

  const num = (value: number | null | undefined, min: number, max: number, fallback: number) =>
    value === null || value === undefined ? fallback : clampRange(value, min, max, fallback);
  const colour = (value: string | null | undefined, fallback: string) =>
    sanitizeHex(value) ?? fallback;
  const flag = (value: boolean | null | undefined, fallback: boolean) =>
    value === null || value === undefined ? fallback : value;

  return {
    fontFamily: over?.fontFamily?.trim() || base.fontFamily,
    fontSize: num(over?.fontSize, 24, 200, base.fontSize),
    textColor: colour(over?.textColor, base.textColor),
    outlineColor: colour(over?.outlineColor, base.outlineColor),
    boxColor: colour(over?.boxColor, base.boxColor),
    borderStyle: over?.borderStyle === 3 ? 3 : over?.borderStyle === 1 ? 1 : base.borderStyle,
    outline: num(over?.outline, 0, 20, base.outline),
    bold: flag(over?.bold, base.bold),
    uppercase: flag(over?.uppercase, base.uppercase),
    position: num(over?.position, 0, 1, base.position),
    maxWidth: num(over?.maxWidth, 0.2, 1, base.maxWidth),
  };
}

function clampRange(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** Normalises `#RRGGBB`; anything else becomes `null`. */
export function sanitizeHex(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(raw)) return null;
  return raw.toUpperCase();
}

/** `#RRGGBB` + alpha -> `rgba()` usable by the live preview. */
export function hexToRgba(value: string, alpha: number): string {
  const hex = sanitizeHex(value) ?? "#FFFFFF";
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const a = clampRange(alpha, 0, 1, 1);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * CSS approximating what the ASS renderer will burn in.
 *
 * Sizes are scaled from the 1080x1920 ASS canvas to the on-screen stage so the
 * preview matches the exported clip closely enough to judge.
 */
export function captionPreviewStyle(
  style: ResolvedCaptionStyle,
  stageWidth: number,
): {
  fontFamily: string;
  fontSize: number;
  color: string;
  fontWeight: number;
  textTransform: "uppercase" | "none";
  maxWidth: string;
  top: string;
  transform: string;
  padding: string;
  borderRadius: string;
  background: string;
  WebkitTextStroke: string;
  textShadow: string;
} {
  const width = stageWidth > 0 ? stageWidth : 270;
  const scale = width / 1080;
  const fontSize = Math.max(9, style.fontSize * scale);
  const outlinePx = Math.max(0, style.outline * scale);
  const boxed = style.borderStyle === 3;

  return {
    fontFamily: `"${style.fontFamily}", system-ui, sans-serif`,
    fontSize,
    color: style.textColor,
    fontWeight: style.bold ? 800 : 500,
    textTransform: style.uppercase ? "uppercase" : "none",
    maxWidth: `${Math.round(style.maxWidth * 100)}%`,
    top: `${Math.round((1 - style.position) * 100)}%`,
    transform: "translate(-50%, -50%)",
    padding: boxed ? `${Math.round(fontSize * 0.28)}px ${Math.round(fontSize * 0.5)}px` : "0",
    borderRadius: boxed ? `${Math.round(fontSize * 0.18)}px` : "0",
    background: boxed ? hexToRgba(style.boxColor, 0.7) : "transparent",
    WebkitTextStroke: !boxed && outlinePx > 0 ? `${outlinePx}px ${style.outlineColor}` : "0",
    textShadow:
      !boxed && outlinePx > 0
        ? `0 ${outlinePx * 0.5}px ${outlinePx}px rgba(0, 0, 0, 0.65)`
        : "none",
  };
}
