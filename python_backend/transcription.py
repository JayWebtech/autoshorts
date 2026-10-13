import json
import os
from typing import Any, Callable, Dict, List, Optional
import warnings
import requests

warnings.filterwarnings("ignore", message=".*Triton.*")


WHISPER_SPECS = {
    "tiny": {"vram": "~0.5 GB (Faster)", "desc": "Ultra rápido, precisión básica", "recommended": False},
    "base": {"vram": "~0.7 GB (Faster)", "desc": "Rápido y ligero", "recommended": False},
    "small": {"vram": "~1.2 GB (Faster)", "desc": "Equilibrado para pruebas rápidas", "recommended": False},
    "medium": {"vram": "~2.5 GB (Faster)", "desc": "Gran precisión para la mayoría de audios", "recommended": False},
    "large-v3-turbo": {"vram": "~3.2 GB (Faster)", "desc": "Máxima velocidad + Altísima precisión (Recomendado para RTX 2060 12GB)", "recommended": True},
    "large-v3": {"vram": "~4.5 GB (Faster)", "desc": "Máxima precisión absoluta en español y jerga gamer", "recommended": False},
}


def faster_whisper_available() -> bool:
    try:
        import faster_whisper
        return True
    except ImportError:
        return False


def get_installed_whisper_models() -> List[Dict[str, Any]]:
    installed_ids = set()

    # 1. Check standard OpenAI Whisper cache
    cache_dir = os.path.expanduser("~/.cache/whisper")
    if os.path.exists(cache_dir):
        for f in os.listdir(cache_dir):
            if f.endswith(".pt"):
                installed_ids.add(f[:-3])

    # 2. Check faster-whisper Hugging Face cache
    hf_hub_dir = os.path.expanduser("~/.cache/huggingface/hub")
    if os.path.exists(hf_hub_dir):
        for d in os.listdir(hf_hub_dir):
            dl = d.lower()
            if "faster-whisper" in dl:
                for mid in ["large-v3-turbo", "large-v3", "medium", "small", "base", "tiny"]:
                    if mid in dl:
                        installed_ids.add(mid)

    models = []
    ordered_ids = ["large-v3-turbo", "large-v3", "medium", "base", "small", "tiny"]
    for mid in ordered_ids:
        spec = WHISPER_SPECS.get(mid, {"vram": "~2 GB", "desc": "Modelo estándar", "recommended": False})
        is_installed = mid in installed_ids or (mid == "large-v3-turbo" and "turbo" in installed_ids)
        models.append({
            "id": mid,
            "name": mid,
            "vram": spec["vram"],
            "desc": spec["desc"],
            "recommended": spec["recommended"],
            "downloaded": is_installed
        })
    return models


def whisper_available() -> bool:
    if faster_whisper_available():
        return True
    try:
        import whisper
        return True
    except ImportError:
        return False


def transcribe_local(
    audio_path: str,
    model_name: str = "large-v3-turbo",
    progress_callback: Optional[Any] = None,
    is_cancelled: Optional[Callable[[], bool]] = None
) -> Dict[str, Any]:
    import torch

    if is_cancelled and is_cancelled():
        raise InterruptedError("Transcripción cancelada antes de cargar el modelo.")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    gamer_initial_prompt = (
        "clutch, headshot, rushear, lootear, drop, respawn, hitbox, nerfeo, buff, "
        "streamer, lag, ping, push, dault, noob, ace, pentakill, clip, directo, "
        "discord, twitch, youtube, shorts, partida, gameplay, sniper, kill"
    )

    # 1. Try faster-whisper first (CTranslate2, ~4x faster, much lower VRAM)
    if faster_whisper_available():
        from faster_whisper import WhisperModel

        compute_type = "float16" if device == "cuda" else "int8"
        print(f"🚀 Using faster-whisper CTranslate2 '{model_name}' on {device} ({compute_type})...")

        if progress_callback:
            try:
                progress_callback(5)
            except Exception:
                pass

        try:
            model = WhisperModel(model_name, device=device, compute_type=compute_type)

            if is_cancelled and is_cancelled():
                del model
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                raise InterruptedError("Transcripción cancelada por el usuario.")

            segments_gen, info = model.transcribe(
                audio_path,
                language="es",
                initial_prompt=gamer_initial_prompt,
                word_timestamps=True,
                vad_filter=True,
                vad_parameters=dict(min_silence_duration_ms=500),
            )

            total_duration = float(info.duration) if info and info.duration else 1.0
            segments = []
            words = []

            for seg in segments_gen:
                if is_cancelled and is_cancelled():
                    del model
                    if torch.cuda.is_available():
                        torch.cuda.empty_cache()
                    raise InterruptedError("Transcripción cancelada por el usuario.")

                if progress_callback:
                    pct = min(99, max(5, int((float(seg.end) / total_duration) * 100)))
                    try:
                        progress_callback(pct)
                    except Exception:
                        pass

                segments.append({
                    "start": float(seg.start),
                    "end": float(seg.end),
                    "speaker": "S1",
                    "text": str(seg.text).strip()
                })

                if getattr(seg, "words", None):
                    for w in seg.words:
                        words.append({
                            "text": str(w.word).strip(),
                            "start": float(w.start),
                            "end": float(w.end),
                            "speaker": "S1"
                        })

            if progress_callback:
                try:
                    progress_callback(100)
                except Exception:
                    pass

            del model
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

            return {
                "language": getattr(info, "language", "es") or "es",
                "duration": total_duration,
                "speakers": ["S1"],
                "words": words,
                "segments": segments
            }

        except InterruptedError:
            print("🛑 Transcripción con faster-whisper cancelada.")
            raise
        except Exception as e:
            print(f"⚠️ faster-whisper error: {e}. Falling back to standard Whisper...")

    # 2. Fallback to standard OpenAI Whisper
    import whisper
    import tqdm
    import sys

    print(f"Loading standard Whisper model '{model_name}' on device: {device} (FP16: {device == 'cuda'})...")
    model = whisper.load_model(model_name, device=device)

    _ORIGINAL_TQDM = getattr(tqdm, "_ORIGINAL_TQDM", None)
    if _ORIGINAL_TQDM is None:
        _ORIGINAL_TQDM = tqdm.tqdm
        tqdm._ORIGINAL_TQDM = _ORIGINAL_TQDM

    class ProgressTqdm(_ORIGINAL_TQDM):
        def update(self, n=1):
            if is_cancelled and is_cancelled():
                raise InterruptedError("Transcripción cancelada por el usuario.")
            res = super().update(n)
            if self.total and self.total > 0 and progress_callback:
                try:
                    pct = min(100, max(0, int(round((self.n / self.total) * 100))))
                    progress_callback(pct)
                except Exception:
                    pass
            return res

    tqdm.tqdm = ProgressTqdm
    whisper_transcribe_mod = sys.modules.get("whisper.transcribe")
    if whisper_transcribe_mod and hasattr(whisper_transcribe_mod, "tqdm"):
        if hasattr(whisper_transcribe_mod.tqdm, "tqdm"):
            whisper_transcribe_mod.tqdm.tqdm = ProgressTqdm
        else:
            whisper_transcribe_mod.tqdm = ProgressTqdm

    if progress_callback:
        try:
            progress_callback(0)
        except Exception:
            pass

    try:
        result = model.transcribe(
            audio_path,
            word_timestamps=True,
            language="es",
            initial_prompt=gamer_initial_prompt,
            fp16=(device == "cuda"),
            verbose=False,
        )
    except InterruptedError:
        print("🛑 Transcripción con Whisper cancelada de inmediato por el usuario.")
        del model
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        raise
    finally:
        tqdm.tqdm = _ORIGINAL_TQDM
        whisper_transcribe_mod = sys.modules.get("whisper.transcribe")
        if whisper_transcribe_mod and hasattr(whisper_transcribe_mod, "tqdm"):
            if hasattr(whisper_transcribe_mod.tqdm, "tqdm"):
                whisper_transcribe_mod.tqdm.tqdm = _ORIGINAL_TQDM

    del model
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    segments_raw = result.get("segments", [])
    duration = segments_raw[-1]["end"] if segments_raw else 0.0

    segments = []
    words = []

    for seg in segments_raw:
        segments.append({
            "start": float(seg["start"]),
            "end": float(seg["end"]),
            "speaker": "S1",
            "text": str(seg["text"]).strip()
        })
        for w in seg.get("words", []):
            words.append({
                "text": str(w["word"]).strip(),
                "start": float(w["start"]),
                "end": float(w["end"]),
                "speaker": "S1"
            })

    return {
        "language": "es",
        "duration": duration,
        "speakers": ["S1"],
        "words": words,
        "segments": segments
    }


def transcribe_deepgram(audio_path: str, api_key: str) -> Dict[str, Any]:
    url = "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&diarize=true&language=es&utterances=true"
    headers = {
        "Authorization": f"Token {api_key}",
        "Content-Type": "audio/wav"
    }

    with open(audio_path, "rb") as f:
        audio_data = f.read()

    resp = requests.post(url, headers=headers, data=audio_data, timeout=300)
    if not resp.ok:
        raise RuntimeError(f"Deepgram transcription failed ({resp.status_code}): {resp.text}")

    data = resp.json()
    alt = (
        data.get("results", {})
        .get("channels", [{}])[0]
        .get("alternatives", [{}])[0]
    )

    words = []
    for w in alt.get("words", []):
        words.append({
            "text": w.get("punctuated_word", w.get("word", "")),
            "start": float(w.get("start", 0.0)),
            "end": float(w.get("end", 0.0)),
            "speaker": f"S{w.get('speaker', 0)}"
        })

    duration = float(data.get("metadata", {}).get("duration", 0.0))

    # Build segments from utterances or words
    segments = []
    for utt in alt.get("paragraphs", {}).get("paragraphs", []):
        for sentence in utt.get("sentences", []):
            segments.append({
                "start": float(sentence.get("start", 0.0)),
                "end": float(sentence.get("end", 0.0)),
                "speaker": "S1",
                "text": sentence.get("text", "").strip()
            })

    if not segments and words:
        # Group every 10 words into a segment if no sentences
        for i in range(0, len(words), 10):
            chunk = words[i:i+10]
            segments.append({
                "start": chunk[0]["start"],
                "end": chunk[-1]["end"],
                "speaker": "S1",
                "text": " ".join(w["text"] for w in chunk)
            })

    return {
        "language": "es",
        "duration": duration,
        "speakers": ["S1"],
        "words": words,
        "segments": segments
    }
