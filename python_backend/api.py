import json
import os
import re
import shutil
import subprocess
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
import requests
import webview

from .db import Database
from .media import (
    command_exists,
    extract_audio,
    extract_video_thumbnail,
    generate_srt,
    generate_ass_subtitles,
    generate_cta_badge_image,
    build_drawtext_filters,
    probe_media,
    render_flat_clip,
    inject_acoustic_cues_into_transcript,
)
from .transcription import transcribe_local, whisper_available, get_installed_whisper_models
from .llm import (
    detect_candidates_pipeline,
    unload_all_ollama_models,
    unload_all_lmstudio_models,
    get_loaded_models_status,
    preload_local_model,
    refine_transcript_with_llm,
    DEFAULT_MOMENTS_PROMPT,
    generate_social_copy_with_llm
)
from .telemetry import get_hardware_telemetry
from .services.project_service import (
    resolve_project_dir,
    open_media_file,
    open_folder,
    move_project_folder_action,
    sync_project_to_disk,
    restore_project_from_disk,
    find_project_file,
    auto_migrate_legacy_projects,
    PROJECT_FILE_NAME
)
from .logger import log_buffer, get_system_logs, clear_system_logs


def rebuild_words_from_segments(segments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    words = []
    for seg in segments:
        text = seg.get("text", "").strip()
        if not text:
            continue
        seg_words = text.split()
        if not seg_words:
            continue
        start = float(seg.get("start", 0.0))
        end = float(seg.get("end", start + 1.0))
        seg_duration = max(0.05, end - start)
        step = seg_duration / len(seg_words)
        for idx, w in enumerate(seg_words):
            w_start = start + idx * step
            w_end = w_start + step
            words.append({
                "text": w,
                "start": round(w_start, 2),
                "end": round(w_end, 2),
                "speaker": seg.get("speaker", "S1")
            })
    return words


def clean_srt_text(content: str) -> str:
    content = content.lstrip("\ufeff")
    lines = content.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    cleaned = []
    for line in lines:
        t = line.strip()
        if not t or t.isdigit():
            continue
        if re.match(r'^\d{1,2}:\d{2}:\d{2}[,\.]\d{3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,\.]\d{3}', t):
            continue
        no_tags = re.sub(r'<[^>]+>', '', t)
        no_tags = re.sub(r'\{[^}]+\}', '', no_tags).strip()
        if no_tags:
            cleaned.append(no_tags)
    return " ".join(cleaned).strip()


class Api:
    def __init__(self, data_dir: Optional[str] = None):
        self.data_dir = Path(data_dir) if data_dir else Path("data")
        os.makedirs(self.data_dir, exist_ok=True)
        self.db = Database(str(self.data_dir / "autoshorts.db"))
        self._window = None
        self._cancel_candidates_flag = False
        self._cancel_transcription_flag = False

        # Hook log buffer to emit real-time logs to WebView2
        def on_log_entry(entry):
            self.emit("log-event", entry)
        log_buffer.add_listener(on_log_entry)

        # Auto-migrate legacy projects to generate autoshorts.project if missing
        try:
            auto_migrate_legacy_projects(self.db)
        except Exception as e:
            print(f"Warning: could not run auto-migrate on init: {e}")

    def get_project_dir(self, project: Dict[str, Any]) -> Path:
        return resolve_project_dir(self.db, project)

    def read_subtitle_file(self, args: Any) -> Dict[str, Any]:
        """Reads and parses an SRT or VTT file, returning clean speech text and stats."""
        file_path = args.get("filePath") if isinstance(args, dict) else args
        p = Path(file_path)
        if not p.is_file():
            raise FileNotFoundError(f"El archivo no existe: {file_path}")
        with open(p, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
        clean_text = clean_srt_text(content)
        words_count = len(clean_text.split()) if clean_text else 0
        return {
            "path": str(p),
            "filename": p.name,
            "rawText": clean_text,
            "charCount": len(clean_text),
            "wordCount": words_count
        }

    def set_window(self, window):
        self._window = window

    def emit(self, event_name: str, payload: Any):
        if self._window:
            payload_json = json.dumps(payload)
            js = f"""
            window.dispatchEvent(new CustomEvent('{event_name}', {{ detail: {payload_json} }}));
            """
            try:
                self._window.evaluate_js(js)
            except Exception as e:
                print(f"Error emitting event {event_name}: {e}")

    def invoke(self, command: str, args: Optional[Dict[str, Any]] = None) -> Any:
        args = args or {}
        if not hasattr(self, command):
            err_msg = f"Unknown command: {command}"
            log_buffer.append(f"[Api.invoke] Error: {err_msg}")
            raise AttributeError(err_msg)
        try:
            method = getattr(self, command)
            return method(args)
        except Exception as e:
            log_buffer.append(f"[Api.invoke] Exception executing '{command}': {e}")
            raise

    def open_file_dialog(self, _args: Optional[Dict[str, Any]] = None) -> Optional[str]:
        """Opens native Windows file dialog and returns selected path."""
        if not self._window:
            return None
        file_types = (
            "Media Files (*.mp4;*.mov;*.mkv;*.mp3;*.wav;*.m4a)",
            "All Files (*.*)"
        )
        if isinstance(_args, dict) and _args.get("fileType") in ["subtitles", "srt"]:
            file_types = (
                "Subtítulos (*.srt;*.vtt;*.txt)",
                "Archivos SRT (*.srt)",
                "Todos los archivos (*.*)"
            )
        elif isinstance(_args, dict) and _args.get("fileTypes"):
            file_types = tuple(_args.get("fileTypes"))

        dialog_type = getattr(webview, "FileDialog", None)
        open_mode = dialog_type.OPEN if dialog_type else getattr(webview, "OPEN_DIALOG", 10)
        result = self._window.create_file_dialog(
            open_mode,
            allow_multiple=False,
            file_types=file_types
        )
        if result and len(result) > 0:
            return result[0]
        return None

    def get_app_config(self, _args: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        config_path = self.data_dir / "config.json"
        if config_path.exists():
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return {}

    def save_app_config(self, args: Any) -> Dict[str, Any]:
        config = args if isinstance(args, dict) else {}
        config_path = self.data_dir / "config.json"
        existing = self.get_app_config()
        existing.update(config)
        try:
            with open(config_path, "w", encoding="utf-8") as f:
                json.dump(existing, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"Error saving config.json: {e}")
        return existing

    def environment_status(self, _args: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        has_ollama = False
        installed_models = []
        try:
            r = requests.get("http://127.0.0.1:11434/api/tags", timeout=1.5)
            if r.ok:
                has_ollama = True
                data = r.json()
                installed_models = [m["name"] for m in data.get("models", []) if "name" in m]
        except Exception:
            pass

        has_lmstudio = False
        installed_lmstudio_models = []
        lmstudio_url = os.getenv("LMSTUDIO_BASE_URL", "http://127.0.0.1:1234/v1")
        try:
            r = requests.get(f"{lmstudio_url.rstrip('/')}/models", timeout=1.5)
            if r.ok:
                has_lmstudio = True
                data = r.json()
                installed_lmstudio_models = [
                    m["id"] for m in data.get("data", [])
                    if "id" in m and not m["id"].startswith("text-embedding")
                ]
        except Exception:
            pass

        whisper_models = []
        try:
            whisper_models = get_installed_whisper_models()
        except Exception as e:
            log_buffer.append(f"[environment_status] Error loading whisper models: {e}")
            whisper_models = [
                {"id": "large-v3-turbo", "name": "large-v3-turbo", "vram": "~3.2 GB", "desc": "Alta precisión y velocidad máxima optimizada (Faster Turbo)", "recommended": True, "downloaded": False},
                {"id": "large-v3", "name": "large-v3", "vram": "~4.5 GB", "desc": "Máxima precisión absoluta en acentos y jerga gamer", "recommended": False, "downloaded": False},
                {"id": "medium", "name": "medium", "vram": "~2.5 GB", "desc": "Gran precisión en diálogos y fondos ruidosos", "recommended": False, "downloaded": False},
                {"id": "small", "name": "small", "vram": "~1.2 GB", "desc": "Equilibrado para transcripción ágil en hardware estándar", "recommended": False, "downloaded": False},
                {"id": "base", "name": "base", "vram": "~0.7 GB", "desc": "Rápido y ligero para pruebas o equipos modestos", "recommended": False, "downloaded": False},
                {"id": "tiny", "name": "tiny", "vram": "~0.5 GB", "desc": "Ultrarrápido y mínimo consumo de memoria", "recommended": False, "downloaded": False},
            ]

        return {
            "dataDir": str(self.data_dir),
            "hasFfmpeg": command_exists("ffmpeg"),
            "hasFfprobe": command_exists("ffprobe"),
            "llmProvider": os.getenv("LLM_PROVIDER", "local"),
            "hasLocalWhisperModel": whisper_available(),
            "whisperModels": whisper_models,
            "hasOllama": has_ollama,
            "hasLmStudio": has_lmstudio,
            "installedOllamaModels": installed_models,
            "installedLmStudioModels": installed_lmstudio_models
        }

    def list_projects(self, _args: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        projs = self.db.list_projects()
        for p in projs:
            p["sourceExists"] = os.path.exists(p["sourcePath"]) if p.get("sourcePath") else False
        return projs

    def get_project_detail(self, args: Any) -> Dict[str, Any]:
        project_id = args.get("projectId") if isinstance(args, dict) else args
        detail = self.db.get_project_detail(project_id)
        if detail and "project" in detail:
            sp = detail["project"].get("sourcePath")
            detail["project"]["sourceExists"] = os.path.exists(sp) if sp else False
        return detail

    def get_default_project_dir(self, args: Any) -> str:
        source_path = args.get("sourcePath") if isinstance(args, dict) else args
        proj_name = Path(source_path).stem if source_path else "Proyecto"
        clean_name = re.sub(r'[\U00010000-\U0010ffff\u2600-\u27bf\ufe00-\ufe0f\u200d\u2300-\u23ff\u2b50-\u2b55]', '', proj_name)
        clean_name = re.sub(r'[\\/*?:"<>|#]', "", clean_name).strip() or "Proyecto"
        return str(Path.home() / "Documents" / "AutoShorts" / clean_name)

    def create_project_from_path(self, args: Any) -> Dict[str, Any]:
        if isinstance(args, dict):
            source_path = args.get("sourcePath") or args.get("path")
            transcription_mode = args.get("transcriptionMode", "local")
            caption_style = args.get("captionStyle", "modern-box")
            custom_project_dir = args.get("projectDir")
            move_source_video = bool(args.get("moveSourceVideo", False))
            workflow_goal = args.get("workflowGoal", "clips")
        else:
            source_path = args
            transcription_mode = "local"
            caption_style = "modern-box"
            custom_project_dir = None
            move_source_video = False
            workflow_goal = "clips"

        if not os.path.exists(source_path):
            raise FileNotFoundError(f"File not found: {source_path}")

        # Check if an existing autoshorts.project file already exists in source folder or custom dir
        existing_file = find_project_file(Path(source_path))
        if not existing_file and custom_project_dir and str(custom_project_dir).strip():
            existing_file = find_project_file(Path(str(custom_project_dir).strip()))

        if existing_file:
            print(f"[PROYECTO] Archivo de proyecto existente detectado en: {existing_file}. Restaurando datos...")
            try:
                detail = restore_project_from_disk(self.db, existing_file)
                if detail and "project" in detail:
                    return detail["project"]
            except Exception as e:
                print(f"Error al restaurar proyecto existente: {e}")

        if custom_project_dir and str(custom_project_dir).strip():
            target_dir = Path(str(custom_project_dir).strip())
        else:
            proj_name = Path(source_path).stem
            clean_name = re.sub(r'[\U00010000-\U0010ffff\u2600-\u27bf\ufe00-\ufe0f\u200d\u2300-\u23ff\u2b50-\u2b55]', '', proj_name)
            clean_name = re.sub(r'[\\/*?:"<>|#]', "", clean_name).strip() or "Proyecto"
            target_dir = Path.home() / "Documents" / "AutoShorts" / clean_name

        os.makedirs(target_dir, exist_ok=True)
        os.makedirs(target_dir / "audio", exist_ok=True)
        os.makedirs(target_dir / "clips", exist_ok=True)
        os.makedirs(target_dir / "summary", exist_ok=True)

        if move_source_video:
            target_file = target_dir / Path(source_path).name
            if target_file.resolve() != Path(source_path).resolve():
                try:
                    shutil.move(source_path, str(target_file))
                    source_path = str(target_file)
                except Exception as e:
                    print(f"Warning: could not move source video to project dir: {e}")
                    try:
                        shutil.copy2(source_path, str(target_file))
                        source_path = str(target_file)
                    except Exception:
                        pass

        duration = None
        try:
            probe = probe_media(source_path)
            duration = probe.get("durationSec")
        except Exception:
            pass

        proj = self.db.create_project(
            source_path=source_path,
            transcription_mode=transcription_mode,
            caption_style=caption_style,
            source_duration=duration,
            project_dir=str(target_dir),
            workflow_goal=workflow_goal
        )
        sync_project_to_disk(self.db, proj["id"], target_dir)
        return proj

    def update_project_workflow_goal(self, args: Any) -> Dict[str, Any]:
        project_id = args.get("projectId")
        workflow_goal = args.get("workflowGoal", "clips")
        return self.db.update_project_workflow_goal(project_id, workflow_goal)

    def probe_project(self, args: Any) -> Dict[str, Any]:
        project_id = args.get("projectId") if isinstance(args, dict) else args
        project = self.db.get_project(project_id)
        probe = probe_media(project["sourcePath"])
        self.db.update_project_status(project_id, "ingest", probe.get("durationSec"))
        return probe

    def extract_project_audio(self, args: Any) -> str:
        project_id = args.get("projectId") if isinstance(args, dict) else args
        project = self.db.get_project(project_id)
        proj_dir = self.get_project_dir(project)
        audio_path = extract_audio(project["sourcePath"], proj_dir / "audio")
        return str(audio_path)

    def transcribe_project(self, args: Any) -> Dict[str, Any]:
        if isinstance(args, dict):
            project_id = args.get("projectId")
            provider = args.get("provider", "local")
            api_key = args.get("apiKey")
            whisper_model = args.get("whisperModel") or "base"
            refine_with_llm = bool(args.get("refineWithLlm", False))
            llm_engine = args.get("llmEngine", "local")
            llm_model = args.get("llmModel")
            llm_api_key = args.get("llmApiKey")
            enable_thinking = bool(args.get("enableThinking", False))
        else:
            project_id = args
            provider = "local"
            api_key = None
            whisper_model = "base"
            refine_with_llm = False
            llm_engine = "local"
            llm_model = None
            llm_api_key = None
            enable_thinking = False

        self._cancel_transcription_flag = False
        project = self.db.get_project(project_id)
        self.db.update_project_status(project_id, "transcribing")
        proj_dir = self.get_project_dir(project)

        try:
            self.emit("transcription-progress", {"percentage": 0, "message": "Preparando pista de audio..."})
            audio_path = extract_audio(
                project["sourcePath"],
                proj_dir / "audio",
                is_cancelled=lambda: self._cancel_transcription_flag
            )

            if self._cancel_transcription_flag:
                self.db.update_project_status(project_id, "created")
                return {}

            def on_whisper_progress(pct: int):
                msg = f"Transcribiendo con Whisper ({pct}%)"
                self.emit("transcription-progress", {"percentage": pct, "message": msg})

            self.emit("transcription-progress", {"percentage": 0, "message": f"Cargando faster-whisper '{whisper_model}'..."})
            transcript = transcribe_local(
                str(audio_path),
                model_name=whisper_model,
                progress_callback=on_whisper_progress,
                is_cancelled=lambda: self._cancel_transcription_flag
            )

            if self._cancel_transcription_flag:
                self.db.update_project_status(project_id, "created")
                return {}

            if refine_with_llm and transcript.get("segments"):
                try:
                    def on_refine_progress(msg, cur, tot):
                        pct = int(round((cur / max(1, tot)) * 100))
                        self.emit("transcription-progress", {"percentage": pct, "message": msg})
                        self.emit("candidate-progress", {"message": msg, "current": cur, "total": tot})

                    print(f"Perfeccionando transcripción con IA ({llm_engine}:{llm_model})...")
                    refined_segments = refine_transcript_with_llm(
                        transcript.get("segments", []),
                        model_name=llm_model or "qwen2.5:7b",
                        provider=llm_engine or "local",
                        api_key=llm_api_key,
                        enable_thinking=enable_thinking,
                        on_progress=on_refine_progress,
                        is_cancelled=lambda: self._cancel_candidates_flag or self._cancel_transcription_flag
                    )
                    if self._cancel_transcription_flag:
                        self.db.update_project_status(project_id, "created")
                        return {}
                    transcript["segments"] = refined_segments
                    transcript["words"] = rebuild_words_from_segments(refined_segments)
                except Exception as e:
                    print(f"Nota en perfeccionamiento automático: {e}")

            if self._cancel_transcription_flag:
                self.db.update_project_status(project_id, "created")
                return {}

            # 3. Detect gunfire/explosions during silence and streamer shouts/screams
            try:
                self.emit("transcription-progress", {"percentage": 98, "message": "Analizando acústica (disparos y gritos)..."})
                print("Analizando audio para detectar disparos en silencio y gritos de streamer...")
                segs, words = inject_acoustic_cues_into_transcript(
                    transcript.get("segments", []),
                    transcript.get("words", []),
                    str(audio_path),
                    is_cancelled=lambda: self._cancel_transcription_flag
                )
                transcript["segments"] = segs
                transcript["words"] = words
            except InterruptedError:
                raise
            except Exception as e:
                print(f"Nota en detección acústica de disparos y gritos: {e}")

            self.emit("transcription-progress", {"percentage": 100, "message": "Transcripción completada"})

            raw_json = json.dumps(transcript, ensure_ascii=False, indent=2)
            saved = self.db.save_transcript(
                project_id=project_id,
                engine=provider,
                raw_json=raw_json,
                language=transcript.get("language", "es")
            )
            self.db.update_project_status(project_id, "analyzing", transcript.get("duration"))
            sync_project_to_disk(self.db, project_id, proj_dir)
            return saved
        except InterruptedError:
            print(f"[CANCELADO] Transcripcion del proyecto {project_id} cancelada inmediatamente.")
            self.db.update_project_status(project_id, "created")
            self.emit("transcription-progress", {"percentage": 0, "message": "Transcripción cancelada"})
            try:
                import gc
                gc.collect()
                import torch
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except Exception:
                pass
            return {}

    def inject_acoustic_cues(self, args: Any) -> Dict[str, Any]:
        """
        Runs acoustic detection on the project's audio to find gunshots/combat during silence
        and shouting peaks, injecting (DISPAROS / ACCIÓN) and (GRITOS / EUFORIA) into the transcript.
        """
        project_id = args.get("projectId") if isinstance(args, dict) else args
        detail = self.db.get_project_detail(project_id)
        transcript_record = detail.get("transcript")
        if not transcript_record:
            raise ValueError("El proyecto aún no tiene transcripción generada.")

        transcript_data = json.loads(transcript_record["rawJson"])
        proj_dir = self.get_project_dir(detail["project"])
        audio_path = proj_dir / "audio" / "transcription_audio.wav"
        if not audio_path.exists():
            audio_path = extract_audio(detail["project"]["sourcePath"], proj_dir / "audio")

        segs, words = inject_acoustic_cues_into_transcript(
            transcript_data.get("segments", []),
            transcript_data.get("words", []),
            str(audio_path)
        )
        transcript_data["segments"] = segs
        transcript_data["words"] = words

        raw_json = json.dumps(transcript_data, ensure_ascii=False, indent=2)
        saved = self.db.save_transcript(
            project_id=project_id,
            engine=transcript_record.get("engine", "local"),
            raw_json=raw_json,
            language=transcript_data.get("language", "es")
        )
        sync_project_to_disk(self.db, project_id, proj_dir)
        return saved

    def cancel_transcription(self, _args: Any = None) -> bool:
        self._cancel_transcription_flag = True
        self._cancel_candidates_flag = True
        self.emit("transcription-progress", {"percentage": 0, "message": "Cancelando y liberando memoria..."})
        try:
            unload_all_ollama_models()
        except Exception:
            pass
        try:
            unload_all_lmstudio_models()
        except Exception:
            pass
        try:
            import gc
            gc.collect()
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass
        return True


    def refine_project_transcript(self, args: Any) -> Dict[str, Any]:
        project_id = args.get("projectId") if isinstance(args, dict) else args
        llm_engine = args.get("provider", "local") if isinstance(args, dict) else "local"
        llm_model = args.get("modelName") if isinstance(args, dict) else None
        llm_api_key = args.get("apiKey") if isinstance(args, dict) else None
        enable_thinking = bool(args.get("enableThinking", False)) if isinstance(args, dict) else False

        detail = self.db.get_project_detail(project_id)
        transcript_record = detail.get("transcript")
        if not transcript_record:
            raise ValueError("El proyecto aún no tiene transcripción generada.")

        parsed_transcript = json.loads(transcript_record["rawJson"])
        segments = parsed_transcript.get("segments", [])
        if not segments:
            raise ValueError("La transcripción no contiene segmentos de voz.")

        self._cancel_candidates_flag = False
        def on_refine_progress(msg, cur, tot):
            if self._window:
                self._window.evaluate_js(f"window.__emitEvent && window.__emitEvent('candidate-progress', {{ message: '{msg}', current: {cur}, total: {tot} }})")

        refined_segments = refine_transcript_with_llm(
            segments,
            model_name=llm_model or "qwen2.5:7b",
            provider=llm_engine,
            api_key=llm_api_key,
            enable_thinking=enable_thinking,
            on_progress=on_refine_progress,
            is_cancelled=lambda: self._cancel_candidates_flag
        )
        parsed_transcript["segments"] = refined_segments
        parsed_transcript["words"] = rebuild_words_from_segments(refined_segments)

        raw_json = json.dumps(parsed_transcript, ensure_ascii=False, indent=2)
        saved = self.db.save_transcript(
            project_id=project_id,
            engine=transcript_record.get("engine", "local"),
            raw_json=raw_json,
            language=parsed_transcript.get("language", "es")
        )
        return saved

    def save_demo_transcript(self, args: Any) -> Dict[str, Any]:
        project_id = args.get("projectId") if isinstance(args, dict) else args
        demo = {
            "language": "es",
            "duration": 180.0,
            "speakers": ["S1"],
            "words": [
                {"text": "Bienvenidos", "start": 0.5, "end": 1.2, "speaker": "S1"},
                {"text": "a", "start": 1.2, "end": 1.4, "speaker": "S1"},
                {"text": "AutoShorts", "start": 1.4, "end": 2.0, "speaker": "S1"},
            ],
            "segments": [
                {"start": 0.0, "end": 60.0, "speaker": "S1", "text": "Este es un momento épico en la partida..."},
                {"start": 60.0, "end": 120.0, "speaker": "S1", "text": "¡No me puedo creer lo que acaba de pasar!"}
            ]
        }
        raw_json = json.dumps(demo, ensure_ascii=False, indent=2)
        saved = self.db.save_transcript(project_id, "demo", raw_json, "es")
        self.db.update_project_status(project_id, "analyzing", 180.0)
        return saved

    def cancel_candidate_generation(self, _args: Any = None) -> bool:
        self._cancel_candidates_flag = True
        try:
            unload_all_ollama_models()
        except Exception:
            pass
        try:
            unload_all_lmstudio_models()
        except Exception:
            pass
        return True

    def get_hardware_telemetry(self, _args: Any = None) -> Dict[str, Any]:
        return get_hardware_telemetry()

    def get_whisper_models(self, _args: Any = None) -> List[Dict[str, Any]]:
        return get_installed_whisper_models()

    def get_default_moments_prompt(self, _args: Any = None) -> str:
        return DEFAULT_MOMENTS_PROMPT

    def get_llm_memory_status(self, args: Any = None) -> Dict[str, Any]:
        """Checks if any local LLM model is currently resident in VRAM/RAM."""
        provider = args.get("provider") if isinstance(args, dict) else None
        lmstudio_url = args.get("lmstudioBaseUrl") if isinstance(args, dict) else None
        status = get_loaded_models_status(provider=provider, lmstudio_base_url=lmstudio_url)
        app_cfg = self.get_app_config()
        status["keepModelLoaded"] = bool(app_cfg.get("keepModelLoaded", False))
        return status

    def preload_llm_model(self, args: Any = None) -> Dict[str, Any]:
        """Explicitly loads a local model into memory and keeps it active."""
        args = args if isinstance(args, dict) else {}
        provider = args.get("provider", "local")
        model_name = args.get("modelName")
        lmstudio_url = args.get("lmstudioBaseUrl")

        if not model_name:
            app_cfg = self.get_app_config()
            if provider == "lmstudio":
                model_name = app_cfg.get("lmstudioModel")
            else:
                model_name = app_cfg.get("localLlmModel", "qwen2.5:7b")

        res = preload_local_model(model_name=model_name, provider=provider, lmstudio_base_url=lmstudio_url)
        status = self.get_llm_memory_status(args)
        status["success"] = res.get("success", False)
        status["error"] = res.get("error")
        return status

    def unload_llm_model(self, args: Any = None) -> Dict[str, Any]:
        """Explicitly frees local LLM VRAM/RAM immediately."""
        try:
            unload_all_ollama_models()
        except Exception:
            pass
        try:
            unload_all_lmstudio_models()
        except Exception:
            pass
        return self.get_llm_memory_status(args)

    def set_keep_model_loaded(self, args: Any = None) -> Dict[str, Any]:
        """Toggles the keepModelLoaded setting in config. If set to False, immediately unloads."""
        enabled = bool(args.get("enabled", False)) if isinstance(args, dict) else bool(args)
        self.save_app_config({"keepModelLoaded": enabled})
        if not enabled:
            try:
                unload_all_ollama_models()
                unload_all_lmstudio_models()
            except Exception:
                pass
        return self.get_llm_memory_status(args)

    def generate_project_copy(self, args: Any) -> Dict[str, Any]:
        if not isinstance(args, dict):
            raise ValueError("Invalid arguments")
        project_id = args.get("projectId")
        provider = args.get("provider", "local")
        model_name = args.get("modelName")
        api_key = args.get("apiKey")
        enable_thinking = bool(args.get("enableThinking", False))
        extra_context = args.get("extraContext")
        keep_loaded = bool(args.get("keepLoaded", False)) if "keepLoaded" in args else bool(self.get_app_config().get("keepModelLoaded", False))

        detail = self.db.get_project_detail(project_id)
        transcript_record = detail.get("transcript")
        if not transcript_record:
            raise ValueError("El proyecto aún no tiene transcripción generada.")

        parsed_transcript = json.loads(transcript_record["rawJson"])
        segments = parsed_transcript.get("segments", [])
        if not segments:
            raise ValueError("La transcripción no contiene segmentos de voz.")

        full_text = " ".join([s.get("text", "").strip() for s in segments if s.get("text")])

        print(f"Generando copy para redes con IA ({provider}:{model_name}, keep_loaded={keep_loaded})...")
        copy_data = generate_social_copy_with_llm(
            transcript_text=full_text,
            model_name=model_name or "qwen2.5:7b",
            provider=provider,
            api_key=api_key,
            enable_thinking=enable_thinking,
            extra_context=extra_context,
            keep_loaded=keep_loaded
        )
        return copy_data

    def generate_quick_copy(self, args: Any) -> Dict[str, Any]:
        """
        Generates viral social media copy directly from pasted transcript text (e.g. from Premiere)
        or a selected media file, without requiring a project.
        """
        if not isinstance(args, dict):
            raise ValueError("Invalid arguments")

        raw_text = str(args.get("transcriptText", "")).strip()
        media_path = args.get("mediaPath")
        extra_context = args.get("extraContext")
        provider = args.get("provider", "local")
        model_name = args.get("modelName")
        api_key = args.get("apiKey")
        enable_thinking = bool(args.get("enableThinking", False))
        keep_loaded = bool(args.get("keepLoaded", False)) if "keepLoaded" in args else bool(self.get_app_config().get("keepModelLoaded", False))

        if not raw_text and media_path:
            if not os.path.exists(media_path):
                raise FileNotFoundError(f"El archivo no existe: {media_path}")

            # If it's a subtitle file (.srt, .vtt, .txt, .sub):
            if media_path.lower().endswith((".srt", ".vtt", ".txt", ".sub")):
                with open(media_path, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()
                raw_text = clean_srt_text(content)
            else:
                temp_dir = self.data_dir / "temp_quick_copy"
                os.makedirs(temp_dir, exist_ok=True)
                wav_path = extract_audio(media_path, temp_dir)
                app_cfg = self.get_app_config()
                whisper_model = app_cfg.get("whisperModel", "base")
                t_res = transcribe_local(str(wav_path), model_name=whisper_model)
                segs = t_res.get("segments", [])
                raw_text = " ".join(s.get("text", "").strip() for s in segs)
                try:
                    if wav_path.exists():
                        os.remove(wav_path)
                except Exception:
                    pass

        if not raw_text:
            raise ValueError("Debes ingresar o cargar una transcripción / archivo SRT para generar el copy.")

        # Resolve active model for LM Studio if none specified or default
        if provider == "lmstudio" and (not model_name or model_name in ["qwen2.5:7b", "local-model"]):
            try:
                base_url = os.getenv("LMSTUDIO_BASE_URL", "http://127.0.0.1:1234/v1").rstrip("/")
                r = requests.get(f"{base_url}/models", timeout=1.5)
                if r.ok:
                    data = r.json().get("data", [])
                    chat_models = [m.get("id") for m in data if "embed" not in m.get("id", "").lower()]
                    if chat_models:
                        model_name = chat_models[0]
            except Exception:
                pass

        copy_data = generate_social_copy_with_llm(
            transcript_text=raw_text,
            model_name=model_name or "qwen2.5:7b",
            provider=provider,
            api_key=api_key,
            enable_thinking=enable_thinking,
            extra_context=extra_context,
            keep_loaded=keep_loaded
        )
        return copy_data

    def regenerate_candidate_copy(self, args: Any) -> Dict[str, Any]:
        """
        Regenerates full viral social media copy for an exported candidate from its own .srt
        or transcript words without modifying the candidate's hook/title.
        """
        candidate_id = args.get("candidateId") if isinstance(args, dict) else args
        provider = args.get("provider", "local") if isinstance(args, dict) else "local"
        model_name = args.get("modelName") if isinstance(args, dict) else None
        api_key = args.get("apiKey") if isinstance(args, dict) else None
        enable_thinking = bool(args.get("enableThinking", False)) if isinstance(args, dict) else False
        keep_loaded = bool(args.get("keepLoaded", False)) if isinstance(args, dict) and "keepLoaded" in args else bool(self.get_app_config().get("keepModelLoaded", False))

        candidate, project = self.db.get_candidate_with_project(candidate_id)
        transcript_record = self.db.latest_transcript(project["id"])
        if not transcript_record:
            raise ValueError("No hay transcripción disponible para este proyecto.")

        # Read clip SRT if exists or slice words from transcript
        raw_text = ""
        clips = self.db.get_clips(project["id"])
        clip = next((c for c in clips if c["candidateId"] == candidate_id), None)
        if clip and clip.get("captionAssPath") and os.path.exists(clip["captionAssPath"]):
            try:
                with open(clip["captionAssPath"], "r", encoding="utf-8", errors="replace") as f:
                    raw_text = clean_srt_text(f.read())
            except Exception:
                pass

        if not raw_text:
            normalized = json.loads(transcript_record["rawJson"])
            words = normalized.get("words", [])
            if not words and "segments" in normalized:
                words = rebuild_words_from_segments(normalized["segments"])
            clip_words = [w for w in words if w.get("end", 0) > candidate["startSec"] and w.get("start", 0) < candidate["endSec"]]
            raw_text = " ".join(w.get("text", "") for w in clip_words).strip()

        if not raw_text:
            raw_text = f"{candidate.get('hook', '')}. {candidate.get('rationale', '')}"

        # Resolve active model for LM Studio if none specified
        if provider == "lmstudio" and (not model_name or model_name in ["qwen2.5:7b", "local-model"]):
            try:
                base_url = os.getenv("LMSTUDIO_BASE_URL", "http://127.0.0.1:1234/v1").rstrip("/")
                r = requests.get(f"{base_url}/models", timeout=1.5)
                if r.ok:
                    data = r.json().get("data", [])
                    chat_models = [m.get("id") for m in data if "embed" not in m.get("id", "").lower()]
                    if chat_models:
                        model_name = chat_models[0]
            except Exception:
                pass

        copy_data = generate_social_copy_with_llm(
            transcript_text=raw_text,
            model_name=model_name or "qwen2.5:7b",
            provider=provider,
            api_key=api_key,
            enable_thinking=enable_thinking,
            extra_context=f"Título actual del clip (mantener este mismo concepto sin cambiarlo): {candidate['hook']}",
            keep_loaded=keep_loaded
        )

        full_copy = copy_data.get("full_copy") or copy_data.get("caption") or ""
        # Update description in DB without altering hook
        self.db.update_candidate_description(candidate_id, full_copy)

        return {
            "candidateId": candidate_id,
            "fullCopy": full_copy,
            "copyData": copy_data
        }

    def generate_candidates(self, args: Any) -> List[Dict[str, Any]]:
        if isinstance(args, dict):
            project_id = args.get("projectId")
            api_key = args.get("apiKey")
            provider = args.get("provider", "local")
            model_name = args.get("modelName")
            content_type = args.get("contentType", "gaming")
            target_duration = args.get("targetDuration", "60s")
            enable_thinking = bool(args.get("enableThinking", False))
            custom_prompt = args.get("customPrompt")
        else:
            project_id = args
            api_key = None
            provider = "local"
            model_name = None
            content_type = "gaming"
            target_duration = "60s"
            enable_thinking = False
            custom_prompt = None

        self._cancel_candidates_flag = False

        transcript_record = self.db.latest_transcript(project_id)
        if not transcript_record:
            raise ValueError("Transcribe the project before detecting moments.")

        normalized = json.loads(transcript_record["rawJson"])
        active_provider = provider or "local"

        def on_chunk_progress(status_msg, chunk_idx, total_chunks):
            self.emit("candidate-progress", {
                "message": status_msg,
                "current": chunk_idx,
                "total": total_chunks,
                "percentage": int((chunk_idx / total_chunks) * 100)
            })

        chosen_model = model_name
        if not chosen_model and active_provider in ["local", "ollama"]:
            env = self.environment_status()
            installed = env.get("installedOllamaModels", [])
            if installed:
                chosen_model = installed[0]
            else:
                chosen_model = "qwen2.5:7b"

        proj = self.db.get_project(project_id)
        proj_dir = self.get_project_dir(proj)
        new_audio_path = proj_dir / "audio" / "transcription_audio.wav"
        old_audio_path = self.data_dir / "projects" / project_id / "transcription_audio.wav"
        old_audio_path2 = self.data_dir / "projects" / (proj.get("name") or project_id) / "transcription_audio.wav"

        if new_audio_path.exists():
            audio_path = str(new_audio_path)
        elif old_audio_path.exists():
            audio_path = str(old_audio_path)
        elif old_audio_path2.exists():
            audio_path = str(old_audio_path2)
        else:
            audio_path = str(new_audio_path)

        # Pipeline de detección de momentos destacados
        drafts = detect_candidates_pipeline(
            transcript=normalized,
            provider=active_provider,
            api_key=api_key,
            model_name=chosen_model or "qwen2.5:7b",
            content_type=content_type,
            target_duration=target_duration,
            enable_thinking=enable_thinking,
            on_progress=on_chunk_progress,
            is_cancelled=lambda: self._cancel_candidates_flag,
            audio_path=audio_path if os.path.exists(audio_path) else None,
            custom_prompt=custom_prompt
        )

        if self._cancel_candidates_flag:
            if drafts:
                candidates = self.db.replace_candidates(project_id, drafts)
                self.db.update_project_status(project_id, "ready")
                return candidates
            self.db.update_project_status(project_id, "ready")
            return self.db.get_candidates(project_id)

        if not drafts:
            raise RuntimeError("No se detectaron momentos en la transcripción.")

        candidates = self.db.replace_candidates(project_id, drafts)
        self.db.update_project_status(project_id, "ready")
        sync_project_to_disk(self.db, project_id, proj_dir)
        return candidates

    def set_selected_clip_count(self, args: Any) -> List[Dict[str, Any]]:
        project_id = args.get("projectId")
        count = int(args.get("count", 3))
        return self.db.set_selected_clip_count(project_id, count)

    def toggle_candidate_dismissed(self, args: Any) -> bool:
        candidate_id = args.get("candidateId") if isinstance(args, dict) else args
        dismissed = bool(args.get("dismissed", True)) if isinstance(args, dict) else True
        return self.db.toggle_candidate_dismissed(candidate_id, dismissed)

    def select_output_directory(self, _args: Any = None) -> Optional[str]:
        if not self._window:
            return None
        dialog_type = getattr(webview, "FileDialog", None)
        folder_mode = dialog_type.FOLDER if dialog_type else getattr(webview, "FOLDER_DIALOG", 20)
        result = self._window.create_file_dialog(folder_mode)
        if result and len(result) > 0:
            return result[0]
        return None

    def render_flat_clip_for_candidate(self, args: Any) -> str:
        candidate_id = args.get("candidateId") if isinstance(args, dict) else args
        custom_dir = args.get("outputDir") if isinstance(args, dict) else None
        aspect_ratio = args.get("aspectRatio", "original") if isinstance(args, dict) else "original"
        burn_subtitles = bool(args.get("burnSubtitles", False)) if isinstance(args, dict) else False
        sub_ranges = args.get("subRanges") if isinstance(args, dict) else None
        transition = args.get("transition") if isinstance(args, dict) else None
        target_fps = int(args["fps"]) if isinstance(args, dict) and args.get("fps") and int(args["fps"]) in (30, 60) else None

        candidate, project = self.db.get_candidate_with_project(candidate_id)
        self.db.update_clip_for_candidate(candidate_id, "cutting")

        start_sec = float(args.get("startSec", candidate["startSec"])) if isinstance(args, dict) and "startSec" in args else candidate["startSec"]
        end_sec = float(args.get("endSec", candidate["endSec"])) if isinstance(args, dict) and "endSec" in args else candidate["endSec"]
        if start_sec != candidate["startSec"] or end_sec != candidate["endSec"]:
            try:
                self.db.update_candidate_trim(candidate_id, start_sec, end_sec)
            except Exception:
                pass

        caption_style = (
            args.get("captionStyle")
            if isinstance(args, dict) and args.get("captionStyle")
            else (project.get("captionStyle") or "tiktok-karaoke")
        )
        caption_position = (
            args.get("captionPosition", "bottom")
            if isinstance(args, dict)
            else "bottom"
        )
        caption_color = (
            args.get("captionColor")
            if isinstance(args, dict) and args.get("captionColor")
            else None
        )
        caption_highlight = (
            args.get("captionHighlight")
            if isinstance(args, dict) and args.get("captionHighlight")
            else None
        )
        cta_enabled = bool(args.get("ctaEnabled", False)) if isinstance(args, dict) else False
        cta_text = (
            args.get("ctaText")
            if isinstance(args, dict) and args.get("ctaText")
            else None
        )
        cta_position = (
            args.get("ctaPosition", "top")
            if isinstance(args, dict)
            else "top"
        )
        cta_animation = (
            args.get("ctaAnimation", "bounce-land")
            if isinstance(args, dict)
            else "bounce-land"
        )
        caption_lines = (
            args.get("captionLines", "1")
            if isinstance(args, dict)
            else "1"
        )
        single_line = (str(caption_lines) != "2")

        if custom_dir:
            out_dir = Path(custom_dir)
        else:
            proj_dir = self.get_project_dir(project)
            out_dir = proj_dir / "clips"
        os.makedirs(out_dir, exist_ok=True)

        # Detect if source video is portrait/vertical to ensure subs and CTA are framed for vertical even if aspect_ratio is 'original'
        source_probe = probe_media(project["sourcePath"])
        src_w = source_probe.get("width", 0)
        src_h = source_probe.get("height", 0)
        is_vert_video = (aspect_ratio == "9:16") or (src_h > src_w > 0)
        ass_aspect_ratio = "9:16" if is_vert_video else "16:9"

        # Sanitize hook for filename: strip all emojis, quotes, and invalid symbols
        raw_hook = candidate.get("hook", "").strip()
        no_emoji = re.sub(r'[\U00010000-\U0010ffff\u2600-\u27bf\ufe00-\ufe0f\u200d\u2300-\u23ff\u2b50-\u2b55]', '', raw_hook)
        safe_hook = re.sub(r'[\\/*?:"<>|#\'`¡¿!]', "", no_emoji)
        safe_hook = re.sub(r'\s+', ' ', safe_hook).strip()[:50]
        base_name = f"Clip {candidate['rank']:02d} - {safe_hook}" if safe_hook else f"Clip {candidate['rank']:02d}"
        output_path = out_dir / f"{base_name}.mp4"
        exported_srt_path = out_dir / f"{base_name}.srt"

        log_buffer.push(f"[Exportación] Preparando clip #{candidate.get('rank', 1)}: '{base_name}'...")

        drawtext_filters = None
        subtitle_filter = None
        srt_path = None
        cta_badge_path = None

        # 1. Generate high-fidelity CTA badge PNG if enabled
        if cta_enabled and cta_text and cta_text.strip():
            try:
                badge_file = out_dir / f"{base_name}_cta.png"
                generate_cta_badge_image(
                    text=cta_text,
                    output_path=str(badge_file),
                    is_vertical=is_vert_video
                )
                if badge_file.exists():
                    cta_badge_path = badge_file
            except Exception as e:
                print(f"Warning generating CTA badge: {e}")

        # 2. Generate Subtitles
        transcript_record = self.db.latest_transcript(project["id"])
        if transcript_record:
            try:
                normalized = json.loads(transcript_record["rawJson"])
                words = normalized.get("words", [])
                if not words and "segments" in normalized:
                    words = rebuild_words_from_segments(normalized["segments"])

                srt_content = generate_srt(words, start_sec, end_sec, sub_ranges=sub_ranges)

                # Always export the .srt alongside the .mp4 in the user's export folder!
                with open(exported_srt_path, "w", encoding="utf-8") as f:
                    f.write(srt_content)
                srt_path = str(exported_srt_path)

                # If subtitles are burned
                if burn_subtitles and caption_style != "none":
                    ass_content = generate_ass_subtitles(
                        words=words,
                        start_sec=start_sec,
                        end_sec=end_sec,
                        caption_style=caption_style,
                        position=caption_position,
                        aspect_ratio=ass_aspect_ratio,
                        primary_color_hex=caption_color,
                        highlight_color_hex=caption_highlight,
                        single_line=single_line,
                        sub_ranges=sub_ranges
                    )
                    if ass_content:
                        exported_ass_path = out_dir / f"{base_name}.ass"
                        with open(exported_ass_path, "w", encoding="utf-8") as f:
                            f.write(ass_content)
                        # Escape Windows path for ffmpeg ass filter
                        ass_posix = exported_ass_path.resolve().as_posix()
                        drive = ass_posix[0]
                        rest = ass_posix[2:].replace("'", r"'\''")
                        subtitle_filter = f"ass='{drive}\\:{rest}'"
            except Exception as e:
                print(f"Warning building captions: {e}")

        rendered_path = render_flat_clip(
            source_path=project["sourcePath"],
            start_sec=start_sec,
            end_sec=end_sec,
            output_path=output_path,
            drawtext_filters=drawtext_filters,
            aspect_ratio=aspect_ratio,
            subtitle_filter=subtitle_filter,
            cta_badge_path=cta_badge_path,
            cta_position=cta_position,
            caption_position=caption_position,
            cta_animation=cta_animation,
            sub_ranges=sub_ranges,
            transition=transition,
            target_fps=target_fps
        )

        self.db.update_clip_for_candidate(
            candidate_id=candidate_id,
            status="done",
            output_path=str(rendered_path),
            caption_path=srt_path
        )
        log_buffer.push(f"[Exportación] Clip completado y registrado en proyecto: {base_name}.mp4")
        return str(rendered_path)

    def update_candidate_trim(self, args: Any) -> Dict[str, Any]:
        candidate_id = args.get("candidateId")
        start_sec = float(args.get("startSec", 0.0))
        end_sec = float(args.get("endSec", 0.0))
        return self.db.update_candidate_trim(candidate_id, start_sec, end_sec)

    def delete_project(self, args: Any):

        project_id = args.get("projectId") if isinstance(args, dict) else args
        self.db.delete_project(project_id)

    def rename_project(self, args: Any) -> Dict[str, Any]:
        project_id = args.get("projectId")
        name = args.get("name")
        res = self.db.rename_project(project_id, name)
        sync_project_to_disk(self.db, project_id)
        return res

    def toggle_project_completed(self, args: Any) -> Dict[str, Any]:
        project_id = args.get("projectId") if isinstance(args, dict) else args
        proj = self.db.get_project(project_id)
        if not proj:
            raise ValueError(f"Project not found: {project_id}")
        new_status = "ready" if proj.get("status") == "completed" else "completed"
        self.db.update_project_status(project_id, new_status)
        return self.db.get_project(project_id)

    def relink_project_video(self, args: Any) -> Dict[str, Any]:
        project_id = args.get("projectId")
        new_source_path = args.get("newSourcePath")
        if not project_id:
            raise ValueError("Missing projectId")
        if not new_source_path or not os.path.exists(new_source_path):
            raise FileNotFoundError(f"El archivo seleccionado no existe: {new_source_path}")

        duration = None
        try:
            probe = probe_media(new_source_path)
            duration = probe.get("durationSec")
        except Exception:
            pass

        updated = self.db.relink_project(project_id, new_source_path, duration)
        updated["sourceExists"] = True
        return updated

    def update_transcript_segment(self, args: Any) -> Dict[str, Any]:
        project_id = args.get("projectId")
        index = int(args.get("index", 0))
        new_text = args.get("text", "").strip()
        record = self.db.latest_transcript(project_id)
        if not record:
            raise ValueError("No transcript found")
        data = json.loads(record["rawJson"])
        segs = data.get("segments", [])
        if 0 <= index < len(segs):
            segs[index]["text"] = new_text
            raw_json = json.dumps(data, ensure_ascii=False, indent=2)
            self.db.save_transcript(project_id, record["engine"], raw_json, record["language"])
        return {"success": True}

    def pull_ollama_model(self, args: Any):
        model_name = args.get("modelName") if isinstance(args, dict) else args
        url = "http://127.0.0.1:11434/api/pull"
        with requests.post(url, json={"name": model_name, "stream": True}, stream=True, timeout=600) as resp:
            if not resp.ok:
                raise RuntimeError(f"Ollama pull failed ({resp.status_code}): {resp.text}")
            for line in resp.iter_lines():
                if line:
                    data = json.loads(line.decode("utf-8"))
                    completed = data.get("completed", 0)
                    total = data.get("total", 1)
                    pct = int((completed / total) * 100) if total else 0
                    self.emit("ollama-pull-progress", {
                        "status": data.get("status", "Downloading..."),
                        "completed": completed,
                        "total": total,
                        "percentage": pct
                    })
        return True

    def install_ollama(self, _args: Any = None):
        raise RuntimeError("Descarga e instala Ollama desde https://ollama.com")

    def open_media_file(self, args: Any) -> bool:
        path = args.get("path") if isinstance(args, dict) else args
        return open_media_file(path)

    def open_folder(self, args: Any):
        path = args.get("path") if isinstance(args, dict) else args
        return open_folder(path)

    def open_project_folder(self, args: Any) -> Dict[str, Any]:
        project_id = args.get("projectId") if isinstance(args, dict) else args
        proj = self.db.get_project(project_id)
        proj_dir = self.get_project_dir(proj)
        if proj_dir.exists():
            try:
                os.startfile(str(proj_dir))
            except Exception as e:
                print(f"Error opening project folder: {e}")
                return {"success": False, "error": str(e)}
        return {"success": True, "projectDir": str(proj_dir)}

    def move_project_folder(self, args: Any) -> Dict[str, Any]:
        project_id = args.get("projectId")
        new_parent_dir = args.get("newParentDir")
        return move_project_folder_action(self.db, project_id, new_parent_dir, self.get_project_dir)

    def get_system_logs(self, args: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        limit = args.get("limit", 500) if isinstance(args, dict) else 500
        return get_system_logs(limit)

    def clear_system_logs(self, _args: Optional[Dict[str, Any]] = None) -> bool:
        clear_system_logs()
        return True

    def open_project_file_dialog(self, _args: Optional[Dict[str, Any]] = None) -> Optional[str]:
        if not self._window:
            return None
        file_types = (
            "AutoShorts Project (*.project;*.json)",
            "Todos los archivos (*.*)"
        )
        dialog_type = getattr(webview, "FileDialog", None)
        open_mode = dialog_type.OPEN if dialog_type else getattr(webview, "OPEN_DIALOG", 10)
        result = self._window.create_file_dialog(
            open_mode,
            allow_multiple=False,
            file_types=file_types
        )
        if result and len(result) > 0:
            return result[0]
        return None

    def import_existing_project(self, args: Any) -> Dict[str, Any]:
        path = args.get("path") if isinstance(args, dict) else args
        if not path:
            path = self.open_project_file_dialog()
            if not path:
                return {}
        p = Path(path)
        return restore_project_from_disk(self.db, p)


