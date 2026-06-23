import subprocess
import shutil
import json
from pathlib import Path
from .models import MediaProbe


def command_exists(name: str) -> bool:
    return shutil.which(name) is not None


def probe_media(path: str) -> MediaProbe:
    if not command_exists("ffprobe"):
        raise RuntimeError("ffprobe not found on PATH")
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json",
         "-show_format", "-show_streams", path],
        capture_output=True, text=True
    )
    if r.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {r.stderr.strip()}")
    data = json.loads(r.stdout)
    streams = data.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    duration = data.get("format", {}).get("duration")
    return MediaProbe(
        duration_sec=float(duration) if duration else None,
        has_video=video is not None,
        width=video.get("width") if video else None,
        height=video.get("height") if video else None,
        video_codec=video.get("codec_name") if video else None,
        audio_codec=audio.get("codec_name") if audio else None,
    )


def extract_audio(source_path: str, project_dir: Path) -> Path:
    if not command_exists("ffmpeg"):
        raise RuntimeError("ffmpeg not found on PATH")
    project_dir.mkdir(parents=True, exist_ok=True)
    output = project_dir / "transcription_audio.wav"
    r = subprocess.run(
        ["ffmpeg", "-y", "-i", source_path,
         "-vn", "-ac", "1", "-ar", "16000", str(output)],
        capture_output=True, text=True
    )
    if r.returncode != 0:
        raise RuntimeError(f"audio extraction failed: {r.stderr.strip()}")
    return output


def render_flat_clip(source_path: str, start_sec: float,
                     end_sec: float, output_path: Path) -> Path:
    if not command_exists("ffmpeg"):
        raise RuntimeError("ffmpeg not found on PATH")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        probe = probe_media(source_path)
        has_video = probe.has_video
    except Exception:
        has_video = False
    cmd = ["ffmpeg", "-y", "-i", source_path,
           "-ss", f"{start_sec:.3f}", "-to", f"{end_sec:.3f}"]
    if has_video:
        cmd += ["-vf", "crop=w='2*trunc(min(iw,ih*9/16)/2)':h='2*trunc(min(ih,iw*16/9)/2)'",
                "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p"]
    else:
        cmd += ["-vn"]
    cmd += ["-c:a", "aac", "-b:a", "192k", str(output_path)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"render failed: {r.stderr.strip()}")
    return output_path
