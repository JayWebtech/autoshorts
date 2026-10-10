import os
from pathlib import Path
from typing import Any, Dict, Optional


def check_youtube_copyright(url: str) -> Dict[str, Any]:
    """Checks license and metadata for a YouTube URL before downloading."""
    try:
        import yt_dlp
        ydl_opts = {
            "quiet": True,
            "skip_download": True,
            "extract_flat": True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            license_val = info.get("license") or "Standard YouTube License"
            is_cc = "creative commons" in license_val.lower()
            return {
                "isSafe": is_cc,
                "license": license_val,
                "title": info.get("title", "Video de YouTube"),
            }
    except Exception as e:
        return {"isSafe": True, "license": str(e), "title": "Video de YouTube"}


def download_youtube_video(url: str) -> str:
    """Downloads a YouTube video to Downloads/AutoShorts and returns the downloaded file path."""
    import yt_dlp
    download_dir = Path.home() / "Downloads" / "AutoShorts"
    os.makedirs(download_dir, exist_ok=True)
    out_template = str(download_dir / "%(title)s.%(ext)s")
    ydl_opts = {
        "outtmpl": out_template,
        "format": "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "quiet": False
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        filename = ydl.prepare_filename(info)
        return str(filename)
