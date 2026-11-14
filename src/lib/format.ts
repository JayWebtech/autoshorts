/**
 * Pure formatting helpers shared by the UI.
 *
 * They live outside `main.tsx` so they can be unit tested without booting the
 * whole Tauri app.
 */

/** Render a model size in MB as a human readable string. */
export function formatModelSize(sizeMb: number) {
  return sizeMb >= 1000 ? `${(sizeMb / 1000).toFixed(1)} GB` : `${sizeMb} MB`;
}

/** Return the last path segment, handling both POSIX and Windows separators. */
export function fileName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Render seconds as `m:ss` (minutes are not zero padded). */
export function formatTime(seconds: number) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const remaining = Math.floor(safe % 60);
  return `${minutes}:${remaining.toString().padStart(2, "0")}`;
}

/** Format a clip window as `start - end`. */
export function formatTimeRange(start: number, end: number) {
  return `${formatTime(start)} - ${formatTime(end)}`;
}

/** Render 0..100 as an integer percentage, clamping out-of-range values. */
export function formatPercent(value: number) {
  const clamped = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
  return `${Math.round(clamped)}%`;
}

/**
 * Shorten the encoder description reported by the backend into a footer label.
 *
 * The Rust side sends values like `h264_nvenc (NVIDIA GPU)`; the footer only has
 * room for the backend name.
 */
export function formatEncoderLabel(encoder: string | null | undefined) {
  const value = (encoder ?? "").toLowerCase();
  if (value.includes("nvenc")) return "NVENC";
  if (value.includes("videotoolbox")) return "VideoToolbox";
  if (value.includes("vaapi")) return "VA-API";
  if (value.includes("amf")) return "AMF";
  if (value.includes("libx264") || value.includes("x264")) return "CPU";
  return "unknown";
}
