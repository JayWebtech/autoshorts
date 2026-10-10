import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional
import requests

from python_backend.media import (
    probe_media,
    render_autoedit_video,
)
from python_backend.llm import (
    plan_autoedit_narrative,
    generate_social_copy_with_llm,
)


def list_project_autoedits(
    db: Any,
    project_id: str,
    get_project_dir_fn: Callable[[Dict[str, Any]], Path]
) -> List[Dict[str, Any]]:
    project = db.get_project(project_id)
    if not project:
        return []

    # 1. Fetch DB records
    records = db.list_autoedits(project_id)
    db_paths = {r["outputPath"] for r in records}

    # 2. Also scan project's autoedit/ folder to auto-register existing MP4 files
    proj_dir = get_project_dir_fn(project)
    autoedit_dir = proj_dir / "autoedit"
    if autoedit_dir.exists():
        for mp4_file in autoedit_dir.glob("*.mp4"):
            str_path = str(mp4_file)
            if str_path not in db_paths:
                fname = mp4_file.name
                fmt = "shorts" if "Shorts" in fname or "9-16" in fname else "youtube"
                chap_file = mp4_file.with_suffix(".txt")
                chap_text = chap_file.read_text(encoding="utf-8", errors="replace") if chap_file.exists() else ""
                new_rec = db.save_autoedit(
                    project_id=project_id,
                    output_path=str_path,
                    format_mode=fmt,
                    target_duration_sec=120.0 if fmt == "shorts" else 480.0,
                    actual_duration_sec=None,
                    chapters_text=chap_text,
                    title=mp4_file.stem.replace("_", " "),
                    description=f"Montaje {fmt.capitalize()} ensamblado con IA.",
                    hashtags="#gaming #streamer #clips #viral"
                )
                records.append(new_rec)
                db_paths.add(str_path)

    # 3. Add file metadata (exists, fileSizeMb, filename)
    results = []
    for r in records:
        p = Path(r["outputPath"])
        exists = p.exists()
        size_mb = round(p.stat().st_size / (1024 * 1024), 1) if exists else 0.0
        r_copy = dict(r)
        r_copy["exists"] = exists
        r_copy["fileSizeMb"] = size_mb
        r_copy["filename"] = p.name
        results.append(r_copy)

    return results


def delete_project_autoedit(db: Any, args: Dict[str, Any]) -> Dict[str, Any]:
    autoedit_id = args.get("autoeditId")
    delete_file = bool(args.get("deleteFile", True))
    rec = db.get_autoedit(autoedit_id)
    if rec:
        if delete_file:
            try:
                p = Path(rec["outputPath"])
                if p.exists():
                    p.unlink()
                txt_p = p.with_suffix(".txt")
                if txt_p.exists():
                    txt_p.unlink()
            except Exception as e:
                print(f"Error borrando archivo de autoedit: {e}")
        db.delete_autoedit(autoedit_id)
    return {"success": True}


def generate_autoedit_copy_action(
    db: Any,
    args: Dict[str, Any],
    get_app_config_fn: Callable[[], Dict[str, Any]]
) -> Dict[str, Any]:
    autoedit_id = args.get("autoeditId")
    rec = db.get_autoedit(autoedit_id)
    if not rec:
        raise ValueError("AutoEdit no encontrado.")

    context = f"Video: {rec.get('title', 'Montaje')}\nFormato: {rec.get('formatMode')}\n"
    if rec.get("chaptersText"):
        context += f"Estructura:\n{rec['chaptersText']}\n"

    app_cfg = get_app_config_fn()
    llm_engine = app_cfg.get("llmEngine", "local")
    model_name = (
        app_cfg.get("localLlmModel", "qwen2.5:7b") if llm_engine == "local"
        else app_cfg.get("lmstudioModel") if llm_engine == "lmstudio"
        else app_cfg.get("openrouterModel")
    )
    api_key = app_cfg.get("openrouterKey") if llm_engine == "openrouter" else ""

    copy_res = generate_social_copy_with_llm(
        transcript_text=context,
        model_name=model_name or "qwen2.5:7b",
        provider=llm_engine,
        api_key=api_key
    )

    new_title = copy_res.get("hooks", [rec.get("title", "")])[0]
    new_desc = copy_res.get("caption", rec.get("description", ""))
    new_tags = " ".join(copy_res.get("hashtags", [])) or rec.get("hashtags", "")

    updated = db.update_autoedit_copy(autoedit_id, new_title, new_desc, new_tags)
    return {
        "success": True,
        "autoedit": updated,
        "copy": copy_res
    }


def execute_autoedit_assembly(
    db: Any,
    args: Dict[str, Any],
    get_project_dir_fn: Callable[[Dict[str, Any]], Path],
    emit_fn: Callable[[str, Dict[str, Any]], None],
    is_cancelled_fn: Callable[[], bool],
    get_app_config_fn: Callable[[], Dict[str, Any]]
) -> Dict[str, Any]:
    project_id = args.get("projectId")
    if not project_id:
        raise ValueError("Missing projectId")

    project = db.get_project(project_id)
    if not project:
        raise ValueError(f"Project not found: {project_id}")

    format_mode = str(args.get("formatMode", "youtube")).strip().lower()
    target_minutes = float(args.get("targetDurationMinutes", 12.0 if format_mode == "youtube" else 2.0))
    include_teaser = bool(args.get("includeTeaser", True))
    trim_silences = bool(args.get("trimSilences", True))
    assembly_style = str(args.get("assemblyStyle", "balanced")).strip().lower()
    custom_dir = args.get("outputDir")

    source_dur = project.get("durationSec")
    if not source_dur and project.get("sourcePath"):
        try:
            probe = probe_media(project["sourcePath"])
            source_dur = float(probe.get("duration", 0)) or None
        except Exception:
            source_dur = None

    all_candidates = db.get_candidates(project_id)
    if not all_candidates:
        raise ValueError("No hay momentos detectados en este proyecto. Genera momentos primero.")

    app_cfg = get_app_config_fn()
    llm_engine = app_cfg.get("llmEngine", "local")
    model_name = args.get("modelName")
    if not model_name:
        if llm_engine == "local":
            try:
                ps_res = requests.get("http://127.0.0.1:11434/api/ps", timeout=1.0)
                if ps_res.ok:
                    ps_models = ps_res.json().get("models", [])
                    if ps_models:
                        model_name = ps_models[0].get("name")
                        print(f"[AutoEdit] Usando modelo activo en Ollama: {model_name}")
            except Exception:
                pass
            if not model_name:
                model_name = app_cfg.get("localLlmModel")
        elif llm_engine == "lmstudio":
            try:
                lm_res = requests.get("http://127.0.0.1:1234/v1/models", timeout=1.0)
                if lm_res.ok:
                    lm_data = lm_res.json().get("data", [])
                    valid_models = [m["id"] for m in lm_data if not m.get("id", "").startswith("text-embedding")]
                    if valid_models:
                        model_name = valid_models[0]
                        print(f"[AutoEdit] Usando modelo activo en LM Studio: {model_name}")
            except Exception:
                pass
            if not model_name:
                model_name = app_cfg.get("lmstudioModel")
        elif llm_engine == "openrouter":
            model_name = app_cfg.get("openrouterModel")
    api_key = app_cfg.get("openrouterKey") if llm_engine == "openrouter" else None

    emit_fn("autoedit-progress", {
        "status": "planning",
        "message": "Estructurando guion narrativo y ubicando momentos con IA...",
        "percentage": 10
    })

    transcript_segments = []
    try:
        record = db.latest_transcript(project_id)
        if record and record.get("rawJson"):
            t_data = json.loads(record["rawJson"])
            transcript_segments = t_data.get("segments", [])
    except Exception as e:
        print(f"Aviso al cargar transcripción para autoedición: {e}")

    excluded_moment_ids = []
    if assembly_style == "alternative":
        try:
            prev_edits = db.list_autoedits(project_id)
            prev_texts = set()
            for pe in prev_edits:
                if pe.get("chaptersText"):
                    for line in pe["chaptersText"].splitlines():
                        txt = re.sub(r'^\s*\d+:\d+\s*', '', line).strip().lower()
                        if len(txt) > 3:
                            prev_texts.add(txt)
            for cand in all_candidates:
                c_hook = (cand.get("hook") or cand.get("title") or "").strip().lower()
                if any(pt in c_hook or c_hook in pt for pt in prev_texts if pt):
                    excluded_moment_ids.append(cand["id"])
        except Exception as e:
            print(f"Aviso al filtrar momentos previos: {e}")

    plan = plan_autoedit_narrative(
        candidates=all_candidates,
        target_duration_minutes=target_minutes,
        format_mode=format_mode,
        include_teaser=include_teaser,
        provider=llm_engine,
        model_name=model_name,
        api_key=api_key,
        transcript_segments=transcript_segments,
        trim_silences=trim_silences,
        assembly_style=assembly_style,
        excluded_moment_ids=excluded_moment_ids,
        max_source_duration=source_dur
    )

    if is_cancelled_fn():
        raise RuntimeError("Autoedición cancelada por el usuario.")

    proj_name = project.get("name") or Path(project["sourcePath"]).stem or project["id"]
    clean_name = re.sub(r'[\U00010000-\U0010ffff\u2600-\u27bf\ufe00-\ufe0f\u200d\u2300-\u23ff\u2b50-\u2b55]', '', proj_name)
    clean_name = re.sub(r'[\\/*?:"<>|#]', "", clean_name).strip()[:40]

    if custom_dir:
        out_dir = Path(custom_dir)
    else:
        proj_dir = get_project_dir_fn(project)
        out_dir = proj_dir / "autoedit"
    os.makedirs(out_dir, exist_ok=True)

    mode_label = "YouTube" if format_mode == "youtube" else "Shorts"
    dur_label = f"{int(round(target_minutes))}m" if target_minutes >= 1.0 else f"{int(round(target_minutes*60))}s"
    time_tag = datetime.now().strftime("%H%M%S")
    style_slug = f"_{assembly_style}" if assembly_style != "balanced" else ""
    output_filename = f"AutoEdit_{mode_label}_{dur_label}{style_slug}_{clean_name}_{time_tag}.mp4"
    output_path = out_dir / output_filename

    raw_aspect = str(args.get("aspectRatio", "original")).strip().lower()
    aspect_ratio = raw_aspect if raw_aspect in ["original", "9:16", "16:9"] else "original"

    def on_render_progress(current_idx: int, total_segs: int, msg: str):
        pct = 15 + int((current_idx / max(1, total_segs)) * 80)
        emit_fn("autoedit-progress", {
            "status": "rendering",
            "message": msg,
            "percentage": min(95, pct)
        })

    target_max_sec = target_minutes * 60.0

    render_res = render_autoedit_video(
        source_path=project["sourcePath"],
        plan=plan,
        aspect_ratio=aspect_ratio,
        trim_silences=trim_silences,
        output_path=output_path,
        max_duration_sec=target_max_sec,
        progress_callback=on_render_progress,
        is_cancelled=is_cancelled_fn
    )

    autoedit_title = f"{'TikTok' if format_mode == 'shorts' else 'YouTube'} - {clean_name}"
    autoedit_desc = f"Montaje dinámico de los mejores momentos del stream ({mode_label})."
    autoedit_hashtags = "#gaming #streamer #clips #viral"
    try:
        story_context = f"Video de gaming ({mode_label}). Momentos incluidos:\n" + "\n".join(
            f"- {s.get('hook', '')}" for s in plan.get("story_segments", [])
        )
        copy_res = generate_social_copy_with_llm(
            transcript_text=story_context,
            model_name=model_name or "qwen2.5:7b",
            provider=llm_engine,
            api_key=api_key
        )
        if copy_res.get("hooks"):
            autoedit_title = copy_res["hooks"][0]
        if copy_res.get("caption"):
            autoedit_desc = copy_res["caption"]
        if copy_res.get("hashtags"):
            autoedit_hashtags = " ".join(copy_res["hashtags"])
    except Exception as e:
        print(f"Nota: Copy generado con plantilla base ({e})")

    saved_autoedit = db.save_autoedit(
        project_id=project_id,
        output_path=str(render_res["video_path"]),
        format_mode=format_mode,
        target_duration_sec=target_max_sec,
        actual_duration_sec=render_res["total_duration"],
        chapters_text=render_res["chapters_text"],
        title=autoedit_title,
        description=autoedit_desc,
        hashtags=autoedit_hashtags
    )

    emit_fn("autoedit-progress", {
        "status": "done",
        "message": "Video ensamblado exitosamente.",
        "percentage": 100
    })

    return {
        "autoeditId": saved_autoedit["id"],
        "videoPath": render_res["video_path"],
        "chaptersPath": render_res["chapters_path"],
        "chaptersText": render_res["chapters_text"],
        "duration": render_res["total_duration"],
        "filename": output_filename,
        "formatMode": format_mode,
        "aspectRatio": aspect_ratio,
        "outputDir": str(out_dir),
        "title": autoedit_title,
        "description": autoedit_desc,
        "hashtags": autoedit_hashtags
    }
