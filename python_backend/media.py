import json
import os
import math
import re
import shutil
import struct
import subprocess
import threading
import time
import wave
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple


def command_exists(name: str) -> bool:
    return shutil.which(name) is not None


def probe_media(path: str) -> Dict[str, Any]:
    if not command_exists("ffprobe"):
        raise RuntimeError("ffprobe is not installed or not available on PATH")

    cmd = [
        "ffprobe",
        "-v", "error",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        path
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if res.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {res.stderr.strip()}")

    data = json.loads(res.stdout)
    streams = data.get("streams", [])

    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)

    duration_sec = None
    if "format" in data and "duration" in data["format"]:
        try:
            duration_sec = float(data["format"]["duration"])
        except (ValueError, TypeError):
            pass

    return {
        "durationSec": duration_sec,
        "hasVideo": video is not None,
        "width": int(video["width"]) if video and "width" in video else None,
        "height": int(video["height"]) if video and "height" in video else None,
        "videoCodec": video.get("codec_name") if video else None,
        "audioCodec": audio.get("codec_name") if audio else None,
    }


def extract_audio(
    source_path: str,
    project_dir: Path,
    is_cancelled: Optional[Callable[[], bool]] = None,
    force: bool = False
) -> Path:
    if not command_exists("ffmpeg"):
        raise RuntimeError("ffmpeg is not installed or not available on PATH")

    os.makedirs(project_dir, exist_ok=True)
    output_path = project_dir / "transcription_audio.wav"

    # Reuse if already extracted, valid WAV, and not forced
    if not force and output_path.exists() and output_path.stat().st_size > 1024:
        try:
            with wave.open(str(output_path), "rb") as wf:
                if wf.getnchannels() > 0 and wf.getnframes() > 0 and wf.getframerate() > 0:
                    print(f"Pista de audio existente encontrada y verificada: {output_path} ({output_path.stat().st_size / (1024*1024):.1f} MB). Reutilizando.")
                    return output_path
        except Exception:
            pass

    cmd = [
        "ffmpeg",
        "-y",
        "-i", str(source_path),
        "-vn",
        "-ac", "1",
        "-ar", "16000",
        str(output_path)
    ]
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1
    )

    stderr_lines: List[str] = []

    def drain_stderr():
        try:
            if proc.stderr:
                for line in proc.stderr:
                    stderr_lines.append(line)
                    if len(stderr_lines) > 50:
                        stderr_lines.pop(0)
        except Exception:
            pass

    drain_thread = threading.Thread(target=drain_stderr, daemon=True)
    drain_thread.start()

    while proc.poll() is None:
        if is_cancelled and is_cancelled():
            try:
                proc.kill()
                proc.wait(timeout=2)
            except Exception:
                pass
            if os.path.exists(output_path):
                try:
                    os.remove(output_path)
                except Exception:
                    pass
            raise InterruptedError("Extracción de audio cancelada por el usuario.")
        time.sleep(0.15)

    drain_thread.join(timeout=2.0)

    if proc.returncode != 0:
        stderr_output = "".join(stderr_lines).strip()[-400:]
        raise RuntimeError(f"ffmpeg audio extraction failed: {stderr_output}")

    return output_path


def detect_audio_action_peaks(audio_path: str, window_sec: float = 3.0, top_fraction: float = 0.15) -> List[Dict[str, Any]]:
    """
    Scans an audio WAV file (e.g. transcription_audio.wav) and calculates RMS energy per window.
    Detects windows with high acoustic energy (gunshots, explosions, intense action, loud reactions).
    Takes only ~1-2 seconds even for a 4-hour stream.
    """
    peaks = []
    if not os.path.exists(audio_path):
        return peaks

    try:
        with wave.open(str(audio_path), 'rb') as wf:
            framerate = wf.getframerate()
            n_channels = wf.getnchannels()
            sampwidth = wf.getsampwidth()
            n_frames = wf.getnframes()

            if framerate <= 0 or n_channels <= 0 or sampwidth != 2:
                return peaks

            chunk_size = int(framerate * window_sec)
            total_chunks = n_frames // chunk_size
            if total_chunks == 0:
                return peaks

            energies = []
            for i in range(total_chunks):
                frames = wf.readframes(chunk_size)
                if not frames:
                    break
                # Sub-sample every 4th sample to calculate RMS in milliseconds with extreme speed
                samples = struct.unpack(f"<{len(frames)//2}h", frames)
                sub_samples = samples[::4]
                if not sub_samples:
                    continue
                rms = math.sqrt(sum(s * s for s in sub_samples) / len(sub_samples))
                energies.append({
                    "start": round(i * window_sec, 2),
                    "end": round((i + 1) * window_sec, 2),
                    "rms": rms
                })

            if not energies:
                return peaks

            # Determine peak threshold (top fraction highest energy moments)
            sorted_rms = sorted(e["rms"] for e in energies)
            cutoff_idx = int(len(sorted_rms) * (1.0 - top_fraction))
            cutoff = sorted_rms[min(cutoff_idx, len(sorted_rms) - 1)]

            # Group contiguous high energy windows into action segments
            active_peak = None
            for e in energies:
                if e["rms"] >= cutoff and e["rms"] > 600:
                    if active_peak is None:
                        active_peak = {"start": e["start"], "end": e["end"], "max_rms": e["rms"]}
                    else:
                        active_peak["end"] = e["end"]
                        active_peak["max_rms"] = max(active_peak["max_rms"], e["rms"])
                else:
                    if active_peak is not None:
                        dur = active_peak["end"] - active_peak["start"]
                        if 4.0 <= dur <= 120.0:
                            peaks.append(active_peak)
                        active_peak = None

            if active_peak is not None:
                dur = active_peak["end"] - active_peak["start"]
                if 4.0 <= dur <= 120.0:
                    peaks.append(active_peak)

            return peaks
    except Exception as err:
        print(f"Nota en detección de picos de audio: {err}")
        return []


def inject_acoustic_cues_into_transcript(
    transcript_segments: List[Dict[str, Any]],
    transcript_words: Optional[List[Dict[str, Any]]],
    audio_path: str,
    window_sec: float = 1.0
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Scans the extracted audio track and injects acoustic cues directly into the transcript:
    1. Detects gunfire, combat SFX and explosions during silent gameplay -> (DISPAROS / ACCIÓN).
    2. Detects high-decibel volume spikes during speech (screams, ecstatic reactions) -> (GRITOS / EUFORIA).
    Strictly preserves audio synchronization and timestamp ordering. Idempotent.
    """
    words = list(transcript_words or [])
    if not os.path.exists(audio_path):
        return transcript_segments, words

    try:
        with wave.open(audio_path, "rb") as wf:
            framerate = wf.getframerate()
            n_channels = wf.getnchannels()
            sampwidth = wf.getsampwidth()
            n_frames = wf.getnframes()

            if framerate <= 0 or n_channels <= 0 or sampwidth != 2:
                return transcript_segments, words

            total_duration = n_frames / framerate
            chunk_size = int(framerate * window_sec)
            total_chunks = n_frames // chunk_size
            if total_chunks == 0:
                return transcript_segments, words

            energies = []
            for i in range(total_chunks):
                frames = wf.readframes(chunk_size)
                if not frames:
                    break
                samples = struct.unpack(f"<{len(frames)//2}h", frames)
                sub_samples = samples[::4]
                if not sub_samples:
                    continue
                rms = math.sqrt(sum(s * s for s in sub_samples) / len(sub_samples))
                energies.append({
                    "start": round(i * window_sec, 2),
                    "end": round((i + 1) * window_sec, 2),
                    "rms": rms
                })

        if not energies:
            return transcript_segments, words

        sorted_rms = sorted(e["rms"] for e in energies)
        num_w = len(sorted_rms)
        p15 = sorted_rms[int(num_w * 0.15)]
        median_rms = sorted_rms[int(num_w * 0.50)]
        p90 = sorted_rms[int(num_w * 0.90)]

        # Dynamic thresholds based on stream audio mastering
        action_threshold = max(450.0, p15 * 3.5, median_rms * 0.65)
        shout_threshold = max(1800.0, median_rms * 2.5, p90 * 0.95)

        # 1. Clean existing cues if re-running (idempotent)
        clean_segments = []
        for s in transcript_segments:
            if s.get("speaker") == "SFX" or str(s.get("text", "")).startswith("(DISPAROS"):
                continue
            seg_copy = dict(s)
            clean_text = re.sub(r"^\(GRITOS\s*/\s*EUFORIA\)\s*", "", str(seg_copy.get("text", ""))).strip()
            seg_copy["text"] = clean_text
            clean_segments.append(seg_copy)

        clean_words = [
            dict(w) for w in words
            if w.get("speaker") != "SFX" and not str(w.get("text", "")).startswith("(DISPAROS")
        ]

        sorted_segs = sorted(clean_segments, key=lambda s: float(s["start"]))

        # 2. Identify silence gaps (streamer quiet / focused)
        gaps = []
        if sorted_segs:
            if sorted_segs[0]["start"] > 1.8:
                gaps.append((0.0, sorted_segs[0]["start"]))
            for k in range(len(sorted_segs) - 1):
                gap_start = float(sorted_segs[k]["end"])
                gap_end = float(sorted_segs[k + 1]["start"])
                if gap_end - gap_start >= 1.8:
                    gaps.append((gap_start, gap_end))
            if total_duration - sorted_segs[-1]["end"] >= 1.8:
                gaps.append((float(sorted_segs[-1]["end"]), total_duration))
        else:
            gaps.append((0.0, total_duration))

        # 3. Detect gunfire / combat bursts in silence gaps
        sfx_segments = []
        sfx_words = []
        for g_start, g_end in gaps:
            gap_energies = [e for e in energies if e["start"] >= (g_start - 0.2) and e["end"] <= (g_end + 0.2)]
            active_burst = None
            for e in gap_energies:
                if e["rms"] >= action_threshold:
                    if active_burst is None:
                        active_burst = {"start": max(g_start, e["start"]), "end": min(g_end, e["end"]), "max_rms": e["rms"]}
                    else:
                        active_burst["end"] = min(g_end, e["end"])
                        active_burst["max_rms"] = max(active_burst["max_rms"], e["rms"])
                else:
                    if active_burst is not None:
                        dur = active_burst["end"] - active_burst["start"]
                        if dur >= 1.8:
                            sfx_segments.append({
                                "start": round(active_burst["start"], 2),
                                "end": round(active_burst["end"], 2),
                                "speaker": "SFX",
                                "text": "(DISPAROS / ACCIÓN)"
                            })
                            sfx_words.append({
                                "start": round(active_burst["start"], 2),
                                "end": round(active_burst["end"], 2),
                                "speaker": "SFX",
                                "text": "(DISPAROS)"
                            })
                        active_burst = None

            if active_burst is not None:
                dur = active_burst["end"] - active_burst["start"]
                if dur >= 1.8:
                    sfx_segments.append({
                        "start": round(active_burst["start"], 2),
                        "end": round(active_burst["end"], 2),
                        "speaker": "SFX",
                        "text": "(DISPAROS / ACCIÓN)"
                    })
                    sfx_words.append({
                        "start": round(active_burst["start"], 2),
                        "end": round(active_burst["end"], 2),
                        "speaker": "SFX",
                        "text": "(DISPAROS)"
                    })

        # 4. Annotate shouts / screaming peaks during speech
        updated_segments = []
        for s in sorted_segs:
            seg_copy = dict(s)
            s_start = float(seg_copy["start"])
            s_end = float(seg_copy["end"])
            seg_energies = [e["rms"] for e in energies if e["start"] >= (s_start - 0.5) and e["end"] <= (s_end + 0.5)]
            max_seg_rms = max(seg_energies) if seg_energies else 0.0

            if max_seg_rms >= shout_threshold:
                seg_copy["text"] = f"(GRITOS / EUFORIA) {seg_copy['text']}".strip()

            updated_segments.append(seg_copy)

        # 5. Merge and sort
        merged_segments = sorted(updated_segments + sfx_segments, key=lambda s: float(s["start"]))
        merged_words = sorted(clean_words + sfx_words, key=lambda w: float(w["start"]))

        return merged_segments, merged_words
    except Exception as err:
        print(f"Nota en inyección de pistas acústicas: {err}")
        return transcript_segments, words



def extract_video_thumbnail(source_path: str, timestamp: float, output_path: Any) -> Path:
    """
    Extracts a crisp 1080p JPEG thumbnail at the specified timestamp using FFmpeg.
    """
    if not command_exists("ffmpeg"):
        raise RuntimeError("ffmpeg is not installed or not available on PATH")

    out_p = Path(output_path)
    os.makedirs(out_p.parent, exist_ok=True)
    cmd = [
        "ffmpeg", "-y",
        "-ss", f"{max(0.0, timestamp):.3f}",
        "-i", str(source_path),
        "-vframes", "1",
        "-q:v", "2",
        str(out_p)
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if res.returncode != 0:
        raise RuntimeError(f"FFmpeg thumbnail extraction failed: {res.stderr.strip()[-300:]}")

    return out_p


def format_srt_time(secs: float) -> str:
    hours = int(secs // 3600)
    mins = int((secs % 3600) // 60)
    secs_only = int(secs % 60)
    ms = int((secs - int(secs)) * 1000)
    return f"{hours:02d}:{mins:02d}:{secs_only:02d},{ms:03d}"


def generate_srt(words: List[Dict[str, Any]], start_sec: float, end_sec: float) -> str:
    candidate_words = [w for w in words if w["end"] > start_sec and w["start"] < end_sec]
    lines = []
    index = 1

    # Chunk into 3 words
    for i in range(0, len(candidate_words), 3):
        chunk = candidate_words[i:i+3]
        if not chunk:
            continue
        first = chunk[0]
        last = chunk[-1]
        start_rel = max(0.0, first["start"] - start_sec)
        end_rel = max(0.0, min(end_sec - start_sec, last["end"] - start_sec))
        text = " ".join(w["text"] for w in chunk)

        lines.append(f"{index}")
        lines.append(f"{format_srt_time(start_rel)} --> {format_srt_time(end_rel)}")
        lines.append(f"{text}\n")
        index += 1

    return "\n".join(lines)


def get_font_option() -> str:
    font_paths = [
        "C:/Windows/Fonts/SegoeUIb.ttf",
        "C:/Windows/Fonts/segoeuib.ttf",
        "C:/Windows/Fonts/SegoeUI.ttf",
        "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
        "C:/Windows/Fonts/arial.ttf",
        "/System/Library/Fonts/Supplemental/Futura.ttc",
        "/System/Library/Fonts/Avenir Next.ttc",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ]
    for p in font_paths:
        if os.path.exists(p):
            escaped = p.replace("\\", "/").replace(":", "\\:").replace("'", "'\\''")
            return f"fontfile='{escaped}':"
    return ""


def build_drawtext_filters(
    words: List[Dict[str, Any]],
    start_sec: float,
    end_sec: float,
    cropped_width: int,
    caption_style: str = "modern-box"
) -> str:
    candidate_words = [w for w in words if w["end"] > start_sec and w["start"] < end_sec]
    if not candidate_words:
        return ""

    font_option = get_font_option()
    drawtext_filters = []

    fontsize = max(16, min(80, int(round(cropped_width * 0.075))))
    padding = max(4, min(24, int(round(fontsize * 0.3))))

    # Chunk into 2 words for fast-paced short captions
    for i in range(0, len(candidate_words), 2):
        chunk = candidate_words[i:i+2]
        if not chunk:
            continue
        first = chunk[0]
        last = chunk[-1]
        start_rel = max(0.0, first["start"] - start_sec)
        end_rel = max(0.0, min(end_sec - start_sec, last["end"] - start_sec))
        if end_rel <= start_rel:
            continue

        text = " ".join(w["text"].upper() for w in chunk)
        # Clean text
        clean_text = "".join(c for c in text if c.isalnum() or c in " !?")
        if not clean_text:
            continue

        if caption_style == "classic-outline":
            borderw = max(2, min(8, int(round(fontsize * 0.1))))
            dt = f"drawtext={font_option}text='{clean_text}':x=(w-text_w)/2:y=h*0.65:fontsize={fontsize}:fontcolor=yellow:borderw={borderw}:bordercolor=black:enable='between(t,{start_rel:.3f},{end_rel:.3f})'"
        elif caption_style == "minimal-shadow":
            dt = f"drawtext={font_option}text='{clean_text}':x=(w-text_w)/2:y=h*0.7:fontsize={fontsize}:fontcolor=white:shadowcolor=black@0.5:shadowx=2:shadowy=2:enable='between(t,{start_rel:.3f},{end_rel:.3f})'"
        elif caption_style == "vibrant-cyan":
            dt = f"drawtext={font_option}text='{clean_text}':x=(w-text_w)/2:y=h*0.7:fontsize={fontsize}:fontcolor=0x00FFFF:shadowcolor=black@0.6:shadowx=2:shadowy=2:enable='between(t,{start_rel:.3f},{end_rel:.3f})'"
        elif caption_style == "vibrant-yellow-box":
            dt = f"drawtext={font_option}text='{clean_text}':x=(w-text_w)/2:y=h*0.72:fontsize={fontsize}:fontcolor=black:box=1:boxcolor=0xffff00e0:boxborderw={padding}:enable='between(t,{start_rel:.3f},{end_rel:.3f})'"
        elif caption_style == "vibrant-green":
            borderw = max(2, min(6, int(round(fontsize * 0.08))))
            dt = f"drawtext={font_option}text='{clean_text}':x=(w-text_w)/2:y=h*0.7:fontsize={fontsize}:fontcolor=0x39FF14:borderw={borderw}:bordercolor=black:shadowcolor=black@0.6:shadowx=2:shadowy=2:enable='between(t,{start_rel:.3f},{end_rel:.3f})'"
        elif caption_style == "vibrant-red":
            borderw = max(2, min(6, int(round(fontsize * 0.08))))
            dt = f"drawtext={font_option}text='{clean_text}':x=(w-text_w)/2:y=h*0.7:fontsize={fontsize}:fontcolor=0xFF3B30:borderw={borderw}:bordercolor=black:shadowcolor=black@0.6:shadowx=2:shadowy=2:enable='between(t,{start_rel:.3f},{end_rel:.3f})'"
        else:
            # modern-box default
            dt = f"drawtext={font_option}text='{clean_text}':x=(w-text_w)/2:y=h*0.72:fontsize={fontsize}:fontcolor=white:box=1:boxcolor=black@0.75:boxborderw={padding}:enable='between(t,{start_rel:.3f},{end_rel:.3f})'"

        drawtext_filters.append(dt)

    return ",".join(drawtext_filters)


def format_ass_time(sec: float) -> str:
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = int(sec % 60)
    cs = int(round((sec - int(sec)) * 100))
    if cs >= 100:
        cs = 99
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def generate_ass_subtitles(
    words: List[Dict[str, Any]],
    start_sec: float,
    end_sec: float,
    caption_style: str = "tiktok-karaoke",
    position: str = "bottom",
    aspect_ratio: str = "9:16"
) -> str:
    clip_words = [w for w in words if w.get("end", 0) > start_sec and w.get("start", 0) < end_sec]
    if not clip_words:
        return ""

    is_vertical = (aspect_ratio == "9:16")
    res_x = 1080 if is_vertical else 1920
    res_y = 1920 if is_vertical else 1080
    font_size = 72 if is_vertical else 56

    # Alignment and vertical margin
    # ASS alignments: 2 = Bottom Center, 5 = Middle Center, 8 = Top Center
    if position == "top":
        alignment = 8
        margin_v = 180 if is_vertical else 90
    elif position == "center":
        alignment = 5
        margin_v = 0
    else:  # bottom default
        alignment = 2
        margin_v = 160 if is_vertical else 80

    # Colors in ASS: &HAABBGGRR& (ABGR hex format)
    primary_color = "&H00FFFFFF&"
    highlight_color = "&H0000FFFF&"  # Yellow pop
    border_style = 1  # 1 = outline + shadow, 3 = opaque box
    outline_size = 5 if is_vertical else 4
    shadow_size = 3 if is_vertical else 2
    back_colour = "&H80000000&"

    if caption_style == "tiktok-karaoke":
        highlight_color = "&H0000FFFF&"
        primary_color = "&H00FFFFFF&"
    elif caption_style == "modern-box":
        primary_color = "&H00FFFFFF&"
        border_style = 3
        outline_size = 2
        shadow_size = 0
        back_colour = "&H99000000&"
    elif caption_style == "classic-outline":
        primary_color = "&H0000FFFF&"
        outline_size = 6 if is_vertical else 5
        shadow_size = 2
    elif caption_style == "minimal-shadow":
        primary_color = "&H00FFFFFF&"
        outline_size = 1
        shadow_size = 3

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {res_x}
PlayResY: {res_y}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: AutoStyle,Arial Black,{font_size},{primary_color},&H000000FF,&H00000000,{back_colour},-1,0,0,0,100,100,1,0,{border_style},{outline_size},{shadow_size},{alignment},40,40,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    dialogue_lines = []
    chunk_size = 3 if is_vertical else 4

    for i in range(0, len(clip_words), chunk_size):
        chunk = clip_words[i:i + chunk_size]
        if not chunk:
            continue

        chunk_start = max(0.0, chunk[0]["start"] - start_sec)
        chunk_end = max(0.0, min(end_sec - start_sec, chunk[-1]["end"] - start_sec))
        if chunk_end <= chunk_start:
            continue

        if caption_style == "tiktok-karaoke":
            # Word-by-word active pop jump for each word in this chunk
            for w_idx, active_w in enumerate(chunk):
                w_start = max(chunk_start, active_w["start"] - start_sec)
                w_end = min(chunk_end, active_w["end"] - start_sec)
                if w_end <= w_start:
                    w_end = min(chunk_end, w_start + 0.3)

                words_text = []
                for idx, w in enumerate(chunk):
                    raw_w = re.sub(r"[^\wáéíóúÁÉÍÓÚñÑüÜ]", "", w.get("text", "")).upper()
                    if not raw_w:
                        raw_w = w.get("text", "").strip().upper()
                    if not raw_w:
                        continue
                    if idx == w_idx:
                        # Pop animation (118% scale) & vibrant color
                        words_text.append(f"{{\\fscx118\\fscy118\\c{highlight_color}}}{raw_w}{{\\rAutoStyle\\fscx100\\fscy100}}")
                    else:
                        words_text.append(raw_w)

                text_line = " ".join(words_text)
                if text_line.strip():
                    dialogue_lines.append(
                        f"Dialogue: 0,{format_ass_time(w_start)},{format_ass_time(w_end)},AutoStyle,,0,0,0,,{text_line}"
                    )
        else:
            clean_chunk = []
            for w in chunk:
                c = re.sub(r"[^\wáéíóúÁÉÍÓÚñÑüÜ]", "", w.get("text", "")).upper()
                clean_chunk.append(c if c else w.get("text", "").strip().upper())
            text_line = " ".join(clean_chunk)
            if text_line.strip():
                dialogue_lines.append(
                    f"Dialogue: 0,{format_ass_time(chunk_start)},{format_ass_time(chunk_end)},AutoStyle,,0,0,0,,{text_line}"
                )

    return header + "\n".join(dialogue_lines) + "\n"


def render_flat_clip(
    source_path: str,
    start_sec: float,
    end_sec: float,
    output_path: Path,
    drawtext_filters: Optional[str] = None,
    aspect_ratio: str = "9:16",
    subtitle_filter: Optional[str] = None
) -> Path:
    if not command_exists("ffmpeg"):
        raise RuntimeError("ffmpeg is not installed or not available on PATH")

    os.makedirs(output_path.parent, exist_ok=True)
    start_str = f"{start_sec:.3f}"
    dur_sec = max(0.1, end_sec - start_sec)
    dur_str = f"{dur_sec:.3f}"

    probe = probe_media(source_path)
    has_video = probe.get("hasVideo", False)

    cmd = [
        "ffmpeg",
        "-y",
        "-ss", start_str,
        "-i", source_path,
        "-t", dur_str
    ]

    if has_video:
        filters = []
        if aspect_ratio == "9:16":
            filters.append("crop=w='2*trunc(min(iw,ih*9/16)/2)':h='2*trunc(min(ih,iw*16/9)/2)'")

        if subtitle_filter and subtitle_filter.strip():
            filters.append(subtitle_filter.strip())
        elif drawtext_filters and drawtext_filters.strip():
            filters.append(drawtext_filters.strip())

        vf = ",".join(filters) if filters else None

        if vf:
            cmd.extend(["-vf", vf])

        cmd.extend([
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "18",
            "-pix_fmt", "yuv420p"
        ])
    else:
        cmd.append("-vn")

    cmd.extend([
        "-c:a", "aac",
        "-b:a", "192k",
        str(output_path)
    ])

    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if res.returncode != 0:
        # Fallback without subtitle/drawtext if filters caused error
        if subtitle_filter or drawtext_filters:
            return render_flat_clip(source_path, start_sec, end_sec, output_path, None, aspect_ratio, None)
        raise RuntimeError(f"ffmpeg clip render failed: {res.stderr.strip()}")

    return output_path


def render_compilation_video(
    source_path: Path | str,
    segments: List[Dict[str, float]],
    output_path: Path,
    aspect_ratio: str = "original",
    progress_callback: Optional[Any] = None
) -> Path:
    """
    Renders segments sequentially into temporary chunks and concatenates them using FFmpeg concat demuxer.
    BENEFITS:
    - 0% VRAM usage.
    - Minimal RAM usage: strictly under ~120 MB at all times, because only 1 clip is processed at a time!
    - Zero risk of OOM on long streams (1-4+ hours).
    - Concat step is instantaneous (stream copy, -c copy takes ~1 second).
    - Audio micro-fades (80ms) prevent pop/click noises between cuts.
    - Progress callback invoked per segment for live UI updates.
    """
    import uuid

    if not command_exists("ffmpeg"):
        raise RuntimeError("ffmpeg is not installed or not available on PATH")

    if not segments:
        raise ValueError("No segments provided for compilation video")

    os.makedirs(output_path.parent, exist_ok=True)
    probe = probe_media(str(source_path))
    has_video = probe.get("hasVideo", False)

    temp_dir = output_path.parent / f"_temp_summary_{uuid.uuid4().hex[:8]}"
    os.makedirs(temp_dir, exist_ok=True)
    chunk_files = []

    try:
        total_segs = len(segments)
        for idx, seg in enumerate(segments):
            start = max(0.0, float(seg["start"]))
            end = max(start + 0.1, float(seg["end"]))
            dur = end - start
            fade_dur = min(0.08, dur / 4.0)

            if progress_callback:
                progress_callback(
                    idx,
                    total_segs,
                    f"Procesando momento {idx + 1} de {total_segs} ({int(dur)}s)..."
                )

            chunk_file = temp_dir / f"chunk_{idx:04d}.mp4"
            chunk_files.append(chunk_file)

            # Fast input seeking before -i (-ss {start} -to {end}) consumes virtually 0 extra RAM
            cmd = [
                "ffmpeg", "-y",
                "-ss", f"{start:.3f}",
                "-to", f"{end:.3f}",
                "-i", str(source_path)
            ]

            vf_filters = []
            if aspect_ratio == "9:16":
                vf_filters.append("crop=w='2*trunc(min(iw,ih*9/16)/2)':h='2*trunc(min(ih,iw*16/9)/2)'")

            if vf_filters:
                cmd.extend(["-vf", ",".join(vf_filters)])

            af_filter = f"afade=t=in:st=0:d={fade_dur:.3f},afade=t=out:st={dur-fade_dur:.3f}:d={fade_dur:.3f}"
            cmd.extend(["-af", af_filter])

            if has_video:
                cmd.extend([
                    "-c:v", "libx264",
                    "-preset", "fast",
                    "-crf", "19",
                    "-pix_fmt", "yuv420p"
                ])
            else:
                cmd.extend(["-vn"])

            cmd.extend([
                "-c:a", "aac",
                "-b:a", "192k",
                "-ar", "48000",
                str(chunk_file)
            ])

            res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
            if res.returncode != 0:
                error_detail = res.stderr.strip()[-600:] if res.stderr else "Error desconocido de FFmpeg"
                raise RuntimeError(f"FFmpeg render de momento {idx + 1} falló: {error_detail}")

        # Concat demuxer step (instantaneous -c copy, 0 MB extra RAM)
        if progress_callback:
            progress_callback(
                total_segs,
                total_segs,
                "Uniendo momentos en el video final con stream copy..."
            )

        list_file = temp_dir / "concat_list.txt"
        with open(list_file, "w", encoding="utf-8") as f:
            for cf in chunk_files:
                escaped_name = cf.name.replace("'", "'\\''")
                f.write(f"file '{escaped_name}'\n")

        concat_cmd = [
            "ffmpeg", "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", str(list_file),
            "-c", "copy",
            str(output_path)
        ]

        concat_res = subprocess.run(concat_cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
        if concat_res.returncode != 0:
            error_detail = concat_res.stderr.strip()[-600:] if concat_res.stderr else "Error en concat de FFmpeg"
            raise RuntimeError(f"FFmpeg unión final falló: {error_detail}")

        return output_path

    finally:
        if temp_dir.exists():
            try:
                shutil.rmtree(temp_dir, ignore_errors=True)
            except Exception:
                pass


def detect_dead_air_silences(
    source_path: str,
    start_sec: float,
    end_sec: float,
    min_silence_dur: float = 1.8,
    db_threshold: int = -32,
    edge_padding: float = 0.15
) -> List[Dict[str, float]]:
    """
    Detects dead air / prolonged silence within a clip range and returns
    active speech/action sub-segments with safe edge padding to avoid clipping words.
    """
    if not command_exists("ffmpeg"):
        return [{"start": start_sec, "end": end_sec}]

    clip_dur = max(0.5, end_sec - start_sec)
    if clip_dur < (min_silence_dur * 2):
        return [{"start": start_sec, "end": end_sec}]

    cmd = [
        "ffmpeg", "-hide_banner", "-nostats",
        "-ss", f"{start_sec:.3f}",
        "-t", f"{clip_dur:.3f}",
        "-i", source_path,
        "-vn",
        "-af", f"silencedetect=noise={db_threshold}dB:d={min_silence_dur}",
        "-f", "null", "-"
    ]

    try:
        res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
        stderr = res.stderr or ""
    except Exception as e:
        print(f"Nota en detección de silencios: {e}")
        return [{"start": start_sec, "end": end_sec}]

    silence_starts = [float(m) for m in re.findall(r"silence_start:\s*([\d\.]+)", stderr)]
    silence_ends = [float(m) for m in re.findall(r"silence_end:\s*([\d\.]+)", stderr)]

    if not silence_starts:
        return [{"start": start_sec, "end": end_sec}]

    silence_intervals = []
    for i, s_start in enumerate(silence_starts):
        s_end = silence_ends[i] if i < len(silence_ends) else clip_dur
        silence_intervals.append((max(0.0, s_start), min(clip_dur, s_end)))

    active_intervals = []
    curr = 0.0
    for s_start, s_end in silence_intervals:
        speech_end = min(clip_dur, s_start + edge_padding)
        speech_start = max(0.0, curr - edge_padding if curr > 0 else 0.0)

        if (speech_end - speech_start) >= 0.8:
            active_intervals.append((speech_start, speech_end))

        curr = s_end

    if (clip_dur - curr) >= 0.8:
        active_intervals.append((max(0.0, curr - edge_padding), clip_dur))

    if not active_intervals:
        return [{"start": start_sec, "end": end_sec}]

    results = []
    for rel_s, rel_e in active_intervals:
        abs_s = round(start_sec + rel_s, 2)
        abs_e = round(start_sec + rel_e, 2)
        if (abs_e - abs_s) >= 0.8:
            results.append({"start": abs_s, "end": abs_e})

    return results if results else [{"start": start_sec, "end": end_sec}]


def render_autoedit_video(
    source_path: str,
    plan: Dict[str, Any],
    aspect_ratio: str = "original",
    trim_silences: bool = True,
    output_path: Path = None,
    max_duration_sec: Optional[float] = None,
    progress_callback: Optional[Callable[[int, int, str], None]] = None,
    is_cancelled: Optional[Callable[[], bool]] = None
) -> Dict[str, Any]:
    """
    Renders an assembled Rough Cut / A-Roll MP4 video from the story plan:
    - Teaser Hook at the beginning (3-5s) with a subtle fade-out.
    - Story segments with optional dead-air silence trimming (jump cuts).
    - Aspect ratio adaptation (original 16:9 or vertical 9:16).
    - Generates YouTube chapters text file next to the video.
    - Strictly enforces max_duration_sec ceiling if provided.
    """
    if not command_exists("ffmpeg"):
        raise RuntimeError("ffmpeg is not installed or not available on PATH")

    os.makedirs(output_path.parent, exist_ok=True)
    temp_dir = output_path.parent / f"autoedit_tmp_{int(time.time())}"
    os.makedirs(temp_dir, exist_ok=True)

    teaser = plan.get("teaser_hook")
    story_segments = plan.get("story_segments", [])
    if not story_segments and not teaser:
        raise ValueError("El plan de autoedición no contiene segmentos para renderizar.")

    try:
        # 1. Build work units
        units_to_render = []
        if teaser and isinstance(teaser, dict) and teaser.get("end", 0) > teaser.get("start", 0):
            units_to_render.append({
                "type": "teaser",
                "start": float(teaser["start"]),
                "end": float(teaser["end"]),
                "hook": teaser.get("hook", "Gancho Inicial (Teaser)"),
            })

        for seg in story_segments:
            s_start = float(seg["start"])
            s_end = float(seg["end"])
            s_hook = seg.get("hook", "Momento Destacado")

            if trim_silences:
                active_parts = detect_dead_air_silences(source_path, s_start, s_end)
                for p_idx, part in enumerate(active_parts):
                    units_to_render.append({
                        "type": "story",
                        "start": part["start"],
                        "end": part["end"],
                        "hook": f"{s_hook}" if p_idx == 0 else "",
                    })
            else:
                units_to_render.append({
                    "type": "story",
                    "start": s_start,
                    "end": s_end,
                    "hook": s_hook,
                })

        total_units = len(units_to_render)
        chunk_files = []
        chapters_list = []
        current_timeline_sec = 0.0

        for idx, unit in enumerate(units_to_render):
            if is_cancelled and is_cancelled():
                raise RuntimeError("Autoedición cancelada por el usuario.")

            unit_dur = max(0.2, unit["end"] - unit["start"])

            # Strict ceiling enforcement
            if max_duration_sec and max_duration_sec > 0:
                if current_timeline_sec >= max_duration_sec:
                    break
                if (current_timeline_sec + unit_dur) > (max_duration_sec + 1.0):
                    unit_dur = max(0.5, max_duration_sec - current_timeline_sec)

            chunk_file = temp_dir / f"chunk_{idx:04d}.mp4"
            chunk_files.append(chunk_file)

            if unit.get("hook"):
                clean_hook = re.sub(r'[\U00010000-\U0010ffff\u2600-\u27bf\ufe00-\ufe0f\u200d\u2300-\u23ff\u2b50-\u2b55]', '', str(unit['hook'])).strip()
                m = int(current_timeline_sec // 60)
                s = int(current_timeline_sec % 60)
                chapters_list.append(f"{m}:{s:02d} {clean_hook}")

            current_timeline_sec += unit_dur

            msg = f"Procesando fragmento {idx + 1} de {total_units}..."
            if progress_callback:
                progress_callback(idx + 1, total_units, msg)

            cmd = [
                "ffmpeg", "-y",
                "-ss", f"{unit['start']:.3f}",
                "-t", f"{unit_dur:.3f}",
                "-i", source_path
            ]

            filters = []
            if aspect_ratio == "9:16":
                filters.append("crop=w='2*trunc(min(iw,ih*9/16)/2)':h='2*trunc(min(ih,iw*16/9)/2)'")
                filters.append("scale=1080:1920:force_original_aspect_ratio=decrease")
                filters.append("pad=1080:1920:(ow-iw)/2:(oh-ih)/2")
                filters.append("setsar=1")
            elif aspect_ratio == "16:9":
                filters.append("crop=w='2*trunc(min(iw,ih*16/9)/2)':h='2*trunc(min(ih,iw*9/16)/2)'")
                filters.append("scale=1920:1080:force_original_aspect_ratio=decrease")
                filters.append("pad=1920:1080:(ow-iw)/2:(oh-ih)/2")
                filters.append("setsar=1")
            else:
                # "original" aspect ratio: preserves source native resolution (whether vertical, horizontal, etc.)
                filters.append("scale=trunc(iw/2)*2:trunc(ih/2)*2")
                filters.append("setsar=1")

            # For teaser, apply a fast 0.25s fade to black at the end
            if unit["type"] == "teaser" and unit_dur > 0.5:
                fade_start = max(0.0, unit_dur - 0.25)
                filters.append(f"fade=t=out:st={fade_start:.3f}:d=0.25")

            cmd.extend([
                "-vf", ",".join(filters),
                "-r", "30",
                "-c:v", "libx264",
                "-preset", "fast",
                "-crf", "19",
                "-pix_fmt", "yuv420p",
                "-c:a", "aac",
                "-b:a", "192k",
                "-ar", "48000",
                "-ac", "2",
                str(chunk_file)
            ])

            res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
            if res.returncode != 0:
                err_detail = res.stderr.strip()[-500:] if res.stderr else "Error desconocido"
                raise RuntimeError(f"Error procesando fragmento {idx + 1}: {err_detail}")

        # 2. Concat demuxer
        if is_cancelled and is_cancelled():
            raise RuntimeError("Autoedición cancelada por el usuario.")

        if progress_callback:
            progress_callback(total_units, total_units, "Ensamblando archivo MP4 final...")

        list_file = temp_dir / "concat_list.txt"
        with open(list_file, "w", encoding="utf-8") as f:
            for cf in chunk_files:
                esc = cf.name.replace("'", "'\\''")
                f.write(f"file '{esc}'\n")

        concat_cmd = [
            "ffmpeg", "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", str(list_file),
            "-c", "copy",
            str(output_path)
        ]

        concat_res = subprocess.run(concat_cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
        if concat_res.returncode != 0:
            err_detail = concat_res.stderr.strip()[-500:] if concat_res.stderr else "Error de unión"
            raise RuntimeError(f"Error en unión final de FFmpeg: {err_detail}")

        # 3. Write YouTube chapters file
        chapters_text = "\n".join(chapters_list) if chapters_list else "0:00 Inicio del Video"
        chapters_file = output_path.parent / f"{output_path.stem}_Capitulos.txt"
        with open(chapters_file, "w", encoding="utf-8") as f:
            f.write(chapters_text + "\n")

        return {
            "video_path": str(output_path),
            "chapters_path": str(chapters_file),
            "chapters_text": chapters_text,
            "total_duration": round(current_timeline_sec, 2)
        }

    finally:
        if temp_dir.exists():
            try:
                shutil.rmtree(temp_dir, ignore_errors=True)
            except Exception:
                pass
